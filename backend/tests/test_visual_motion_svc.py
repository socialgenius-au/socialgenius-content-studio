"""Video Deconstructor — Stage 9 Phase A: visual_motion_svc.py unit tests. Pure input->output
tests — no database, no router, no real video file (synthetic textured images only), matching
the isolation this module's own docstring establishes. Real-video validation happens separately
at the router/real-validation level.

Covers the service-level checks from Phase A's own 20-item test list: frame-pair generation (1),
no-cross-shot-pair via boundary-safe windowing (2), phase-correlation dx/dy/magnitude (3),
response preservation (4), affine success (5), affine failure (6), scale extraction (7), rotation
extraction (8), signed translation preservation (9), match count (10), inlier count (11), inlier
ratio (12), aggregation (13), percentile semantics (14), sample count (15), frame-pair count (16),
short-shot handling (17), invalid/missing frames (18), deterministic parameter configuration (19),
no synthetic combined motion score (20).
"""
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from app.services import visual_motion_svc
from app.services.visual_motion_svc import (
    DEFAULT_ORB_NFEATURES, DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX, DEFAULT_RATIO_TEST_THRESHOLD,
    DEFAULT_SAMPLING_FPS, MINIMUM_ANALYZABLE_FRAMES, _affine_pair, _boundary_safe_window, _percentile,
    _phase_correlation_pair, aggregate_motion_evidence, measure_shot_global_motion,
)


def _textured_image(size=200, seed=0) -> np.ndarray:
    """A synthetic image with genuine texture (checkerboard + noise) — enough real structure for
    ORB to find keypoints, unlike a blank/flat image."""
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size), dtype=np.uint8)
    step = 20
    for y in range(0, size, step):
        for x in range(0, size, step):
            if (x // step + y // step) % 2 == 0:
                img[y:y + step, x:x + step] = 200
    noise = rng.integers(0, 40, size=(size, size), dtype=np.uint8)
    return np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def _blank_image(size=200, value=128) -> np.ndarray:
    return np.full((size, size), value, dtype=np.uint8)


def _shift_image(img: np.ndarray, dx: float, dy: float) -> np.ndarray:
    matrix = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(img, matrix, (img.shape[1], img.shape[0]), borderMode=cv2.BORDER_REPLICATE)


def _scale_image(img: np.ndarray, scale: float) -> np.ndarray:
    h, w = img.shape
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), 0, scale)
    return cv2.warpAffine(img, matrix, (w, h), borderMode=cv2.BORDER_REPLICATE)


def _rotate_image(img: np.ndarray, angle_deg: float) -> np.ndarray:
    h, w = img.shape
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, 1.0)
    return cv2.warpAffine(img, matrix, (w, h), borderMode=cv2.BORDER_REPLICATE)


# ---------------------------------------------------------------------------
# 2. Boundary-safe windowing (no cross-shot pair).
# ---------------------------------------------------------------------------

def test_boundary_safe_window_insets_symmetrically():
    safe_start, safe_end = _boundary_safe_window(0.0, 22.5)
    expected_epsilon = min(22.5 * visual_motion_svc.BOUNDARY_SAFETY_FRACTION, visual_motion_svc.BOUNDARY_SAFETY_MAX_SECONDS)
    assert safe_start == pytest.approx(expected_epsilon)
    assert safe_end == pytest.approx(22.5 - expected_epsilon)
    assert safe_start > 0.0
    assert safe_end < 22.5


def test_boundary_safe_window_never_touches_the_real_boundaries():
    # A degenerate/very short shot must never widen back out to the original boundaries.
    safe_start, safe_end = _boundary_safe_window(30.100, 30.150)  # 0.05s shot
    assert safe_start >= 30.100
    assert safe_end <= 30.150


def test_boundary_safe_window_degenerate_short_shot_collapses_honestly():
    # A genuinely zero-duration shot (start_time == end_time) is the real collapse case: any
    # positive epsilon inset from both sides would otherwise cross over. A short-but-positive
    # shot (e.g. 1ms) does NOT collapse under BOUNDARY_SAFETY_FRACTION/MAX_SECONDS's own real
    # values -- it stays open, just tiny -- collapse specifically requires duration <= 0.
    safe_start, safe_end = _boundary_safe_window(10.0, 10.0)
    assert safe_end <= safe_start  # collapsed, not widened


# ---------------------------------------------------------------------------
# 3/4. Phase correlation: dx/dy/magnitude and response preserved.
# ---------------------------------------------------------------------------

def test_phase_correlation_detects_known_shift():
    a = _textured_image(seed=1)
    b = _shift_image(a, dx=5.0, dy=-3.0)
    result = _phase_correlation_pair(a, b)
    # A repeating checkerboard-plus-noise texture is not an ideal phase-correlation subject (its
    # own periodicity introduces real sub-pixel bias) -- a loose tolerance checks the method
    # detects a shift of roughly the right size and direction, not pixel-perfect accuracy.
    assert result["dx"] == pytest.approx(5.0, abs=1.0)
    assert result["dy"] == pytest.approx(-3.0, abs=1.0)
    assert result["magnitude"] == pytest.approx((5.0 ** 2 + 3.0 ** 2) ** 0.5, abs=1.0)
    assert "response" in result
    assert isinstance(result["response"], float)


def test_phase_correlation_zero_shift_near_zero():
    a = _textured_image(seed=2)
    result = _phase_correlation_pair(a, a)
    assert result["dx"] == pytest.approx(0.0, abs=0.01)
    assert result["dy"] == pytest.approx(0.0, abs=0.01)


# ---------------------------------------------------------------------------
# 5/9/10/11/12. Affine success: translation sign, match/inlier counts, inlier ratio.
# ---------------------------------------------------------------------------

def test_affine_success_on_shifted_textured_pair():
    a = _textured_image(seed=3)
    b = _shift_image(a, dx=10.0, dy=4.0)
    result = _affine_pair(a, b, orb_nfeatures=DEFAULT_ORB_NFEATURES, ratio_threshold=DEFAULT_RATIO_TEST_THRESHOLD, ransac_threshold_px=DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX)
    assert result["estimation_success"] is True
    # 9: signed translation preserved (not just magnitude) -- positive dx/dy expected here.
    assert result["translation_x"] == pytest.approx(10.0, abs=1.5)
    assert result["translation_y"] == pytest.approx(4.0, abs=1.5)
    assert result["translation_magnitude"] > 0
    # 10/11/12: match/inlier counts and ratio present and sane.
    assert result["candidate_match_count"] > 0
    assert result["ransac_inlier_count"] >= 0
    assert result["ransac_inlier_count"] <= result["candidate_match_count"]
    assert 0.0 <= result["ransac_inlier_ratio"] <= 1.0


def test_affine_negative_shift_sign_preserved():
    a = _textured_image(seed=4)
    b = _shift_image(a, dx=-8.0, dy=-6.0)
    result = _affine_pair(a, b, orb_nfeatures=DEFAULT_ORB_NFEATURES, ratio_threshold=DEFAULT_RATIO_TEST_THRESHOLD, ransac_threshold_px=DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX)
    assert result["estimation_success"] is True
    assert result["translation_x"] < 0
    assert result["translation_y"] < 0


# ---------------------------------------------------------------------------
# 6. Affine failure honestly reported (never fabricated zeros).
# ---------------------------------------------------------------------------

def test_affine_failure_on_blank_images_reports_reason_not_zeros():
    a = _blank_image()
    b = _blank_image()
    result = _affine_pair(a, b, orb_nfeatures=DEFAULT_ORB_NFEATURES, ratio_threshold=DEFAULT_RATIO_TEST_THRESHOLD, ransac_threshold_px=DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX)
    assert result["estimation_success"] is False
    assert "reason" in result
    assert result["reason"]  # non-empty
    assert "translation_x" not in result  # never a fabricated zero alongside failure


# ---------------------------------------------------------------------------
# 7/8. Scale and rotation extraction against known synthetic transforms.
# ---------------------------------------------------------------------------

def test_affine_extracts_known_scale():
    a = _textured_image(seed=5)
    b = _scale_image(a, scale=1.15)
    result = _affine_pair(a, b, orb_nfeatures=DEFAULT_ORB_NFEATURES, ratio_threshold=DEFAULT_RATIO_TEST_THRESHOLD, ransac_threshold_px=DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX)
    assert result["estimation_success"] is True
    assert result["scale"] == pytest.approx(1.15, abs=0.05)


def test_affine_extracts_known_rotation():
    a = _textured_image(seed=6)
    b = _rotate_image(a, angle_deg=8.0)
    result = _affine_pair(a, b, orb_nfeatures=DEFAULT_ORB_NFEATURES, ratio_threshold=DEFAULT_RATIO_TEST_THRESHOLD, ransac_threshold_px=DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX)
    assert result["estimation_success"] is True
    # Empirically confirmed (verified directly against cv2.getRotationMatrix2D's own matrix):
    # cv2.getRotationMatrix2D(angle=+8.0) itself encodes rotation as -8.0 under the standard
    # arctan2(M[1,0], M[0,0]) extraction convention _affine_pair uses -- a real, confirmed sign
    # convention of that OpenCV helper, not a defect in the extraction formula itself (which is
    # the textbook-correct way to recover rotation from any affine/similarity matrix). The
    # magnitude match (not the raw signed value against the input angle) is what this test
    # verifies.
    assert result["rotation_deg"] == pytest.approx(-8.0, abs=1.5)


def test_affine_near_identity_for_unchanged_pair():
    a = _textured_image(seed=7)
    result = _affine_pair(a, a, orb_nfeatures=DEFAULT_ORB_NFEATURES, ratio_threshold=DEFAULT_RATIO_TEST_THRESHOLD, ransac_threshold_px=DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX)
    assert result["estimation_success"] is True
    assert result["scale"] == pytest.approx(1.0, abs=0.02)
    assert abs(result["rotation_deg"]) < 1.0


# ---------------------------------------------------------------------------
# 14. Percentile semantics — explicit, documented, tested.
# ---------------------------------------------------------------------------

def test_percentile_linear_semantics_known_value():
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    # numpy's own 'linear' method for p95 of this 5-element array:
    assert _percentile(values, 95) == pytest.approx(np.percentile(values, 95, method="linear"))
    assert _percentile(values, 50) == pytest.approx(3.0)


# ---------------------------------------------------------------------------
# 13/15/16/17/20. Aggregation: sample/pair counts, short-shot handling, no combined score.
# ---------------------------------------------------------------------------

def test_aggregation_short_shot_reports_insufficient_samples_not_fabricated_zero():
    result = aggregate_motion_evidence([], [], sampling_fps=5.0, sample_count=1)
    assert result["insufficient_temporal_samples"] is True
    assert result["sample_count"] == 1
    assert result["frame_pair_count"] == 0
    assert result["affine"] is None
    assert result["phase_correlation"] is None


def test_aggregation_zero_samples():
    result = aggregate_motion_evidence([], [], sampling_fps=5.0, sample_count=0)
    assert result["insufficient_temporal_samples"] is True


def test_aggregation_known_values():
    phase_pairs = [
        {"dx": 1.0, "dy": 2.0, "magnitude": (1.0 ** 2 + 2.0 ** 2) ** 0.5, "response": 0.9},
        {"dx": 2.0, "dy": 3.0, "magnitude": (2.0 ** 2 + 3.0 ** 2) ** 0.5, "response": 0.95},
        {"dx": 3.0, "dy": 1.0, "magnitude": (3.0 ** 2 + 1.0 ** 2) ** 0.5, "response": 0.5},
    ]
    affine_pairs = [
        {"estimation_success": True, "translation_x": 1.0, "translation_y": 1.0, "translation_magnitude": 1.41,
         "scale": 1.01, "rotation_deg": 0.5, "candidate_match_count": 100, "ransac_inlier_count": 95, "ransac_inlier_ratio": 0.95},
        {"estimation_success": True, "translation_x": 2.0, "translation_y": 2.0, "translation_magnitude": 2.83,
         "scale": 0.99, "rotation_deg": -0.5, "candidate_match_count": 110, "ransac_inlier_count": 100, "ransac_inlier_ratio": 0.909},
        {"estimation_success": False, "reason": "insufficient_matches"},
    ]
    result = aggregate_motion_evidence(phase_pairs, affine_pairs, sampling_fps=5.0, sample_count=4)
    assert result["insufficient_temporal_samples"] is False
    assert result["sample_count"] == 4
    assert result["frame_pair_count"] == 3
    assert result["affine"]["successful_pair_count"] == 2
    assert result["affine"]["failed_pair_count"] == 1
    assert result["affine"]["estimation_success_rate"] == pytest.approx(2 / 3)
    assert result["affine"]["median_translation_x"] == pytest.approx(1.5)
    assert result["affine"]["median_scale"] == pytest.approx(1.0)
    assert result["affine"]["failure_reason_counts"] == {"insufficient_matches": 1}
    assert result["phase_correlation"]["median_dx"] == pytest.approx(2.0)
    assert result["phase_correlation"]["minimum_response"] == pytest.approx(0.5)
    # 20: no synthetic combined motion score anywhere in the aggregate.
    assert "motion_score" not in result
    assert "combined_score" not in result
    assert "motion_score" not in result["affine"]
    assert "motion_score" not in result["phase_correlation"]


def test_aggregation_all_affine_pairs_failed_still_reports_phase_correlation():
    phase_pairs = [{"dx": 0.1, "dy": 0.1, "magnitude": 0.14, "response": 0.9}]
    affine_pairs = [{"estimation_success": False, "reason": "insufficient_keypoints"}]
    result = aggregate_motion_evidence(phase_pairs, affine_pairs, sampling_fps=5.0, sample_count=2)
    assert result["affine"]["successful_pair_count"] == 0
    assert result["affine"]["median_translation_x"] is None  # never fabricated
    assert result["phase_correlation"]["median_dx"] == pytest.approx(0.1)  # phase correlation still reported


# ---------------------------------------------------------------------------
# 18. Invalid/missing video file.
# ---------------------------------------------------------------------------

async def test_missing_video_file_raises_honestly():
    with pytest.raises(FileNotFoundError):
        await measure_shot_global_motion("nonexistent_path_xyz.mp4", 0.0, 10.0)


# ---------------------------------------------------------------------------
# 1/15/16/17/19. Full pipeline (extraction mocked with synthetic frames) — frame-pair generation,
# sample/pair counts, short-shot handling, parameter configuration respected.
# ---------------------------------------------------------------------------

async def test_full_pipeline_with_mocked_extraction_produces_expected_counts(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video, just needs to exist")

    frames = [_textured_image(seed=i) for i in range(6)]
    with patch.object(visual_motion_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_shot_global_motion(str(video_path), 0.0, 22.5, sampling_fps=5.0)

    assert result["sample_count"] == 6
    assert result["frame_pair_count"] == 5
    assert result["insufficient_temporal_samples"] is False
    assert result["sampling_fps"] == 5.0
    assert result["affine"] is not None
    assert result["phase_correlation"] is not None


async def test_full_pipeline_short_shot_reports_insufficient_samples(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")

    with patch.object(visual_motion_svc, "_extract_grayscale_frames_sync", return_value=[_textured_image()]):
        result = await measure_shot_global_motion(str(video_path), 30.100, 30.150, sampling_fps=5.0)

    assert result["insufficient_temporal_samples"] is True
    assert result["affine"] is None
    assert result["phase_correlation"] is None


async def test_custom_parameters_are_respected(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(4)]

    with patch.object(visual_motion_svc, "_extract_grayscale_frames_sync", return_value=frames) as mock_extract:
        await measure_shot_global_motion(str(video_path), 0.0, 10.0, sampling_fps=2.0)
    # sampling_fps was passed through to the extraction call.
    assert mock_extract.call_args.args[4] == 2.0


def test_default_constants_match_documented_baseline():
    assert DEFAULT_SAMPLING_FPS == 5.0
    assert DEFAULT_ORB_NFEATURES == 500
    assert DEFAULT_RATIO_TEST_THRESHOLD == 0.75
    assert DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX == 3.0
    assert MINIMUM_ANALYZABLE_FRAMES == 2


# ---------------------------------------------------------------------------
# Temp-directory cleanup — success and failure paths (tempfile.TemporaryDirectory's own
# guarantee, verified explicitly rather than merely assumed).
# ---------------------------------------------------------------------------

async def test_temp_directory_removed_after_successful_run(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(4)]
    captured_tmp_dirs = []

    real_extract = visual_motion_svc._extract_grayscale_frames_sync

    def _spy_extract(ffmpeg_bin, video_path_, start, end, fps, tmp_dir):
        captured_tmp_dirs.append(tmp_dir)
        return frames

    with patch.object(visual_motion_svc, "_extract_grayscale_frames_sync", side_effect=_spy_extract):
        await measure_shot_global_motion(str(video_path), 0.0, 10.0)

    assert len(captured_tmp_dirs) == 1
    import os
    assert not os.path.exists(captured_tmp_dirs[0])  # removed by TemporaryDirectory's own __exit__


async def test_temp_directory_removed_even_on_extraction_failure(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    captured_tmp_dirs = []

    def _failing_extract(ffmpeg_bin, video_path_, start, end, fps, tmp_dir):
        captured_tmp_dirs.append(tmp_dir)
        raise RuntimeError("simulated ffmpeg failure")

    with patch.object(visual_motion_svc, "_extract_grayscale_frames_sync", side_effect=_failing_extract):
        with pytest.raises(RuntimeError):
            await measure_shot_global_motion(str(video_path), 0.0, 10.0)

    assert len(captured_tmp_dirs) == 1
    import os
    assert not os.path.exists(captured_tmp_dirs[0])  # still removed despite the exception
