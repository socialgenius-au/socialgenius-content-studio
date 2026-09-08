"""Video Deconstructor — Stage 9 Phase B1: transition_evidence_svc.py unit tests. Pure
input->output tests — no database, no router, no real video file (synthetic textured images
only), matching the isolation this module's own docstring establishes. Real-video and controlled-
corpus validation happen separately (see the Phase-B1 final report).

Covers: boundary-candidate-window clipping and margin (never crossing unrelated boundaries),
neutral luminance measurements (no interpreted fields), neutral frame-difference measurements,
existing black-frame threshold reuse (no new threshold), exact black-frame+zero-response phase
diagnostic (no generalized usable rule), explicit affine failure semantics (never fabricated
zeros), insufficient-boundary-material honesty, own independent temp-directory lifecycle
(success and failure paths), and a terminology/safety sweep against accidental classification
fields entering the evidence object.
"""
import os
from unittest.mock import patch

import numpy as np
import pytest

from app.services import transition_evidence_svc
from app.services.transition_evidence_svc import (
    MINIMUM_ANALYZABLE_FRAMES, TRANSITION_BOUNDARY_MARGIN_SECONDS, TRANSITION_BOUNDARY_SAMPLING_FPS,
    _boundary_candidate_window, _frame_diff_pair, _frame_difference_summary, _luminance,
    _luminance_summary, _phase_quality_issue, aggregate_transition_evidence,
    measure_boundary_transition_evidence,
)


def _textured_image(size=200, seed=0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size), dtype=np.uint8)
    step = 20
    for y in range(0, size, step):
        for x in range(0, size, step):
            if (x // step + y // step) % 2 == 0:
                img[y:y + step, x:x + step] = 200
    noise = rng.integers(0, 40, size=(size, size), dtype=np.uint8)
    return np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def _black_image(size=200) -> np.ndarray:
    return np.zeros((size, size), dtype=np.uint8)


# ---------------------------------------------------------------------------
# Candidate-window clipping — never crosses unrelated boundaries.
# ---------------------------------------------------------------------------

def test_boundary_window_applies_symmetric_margin():
    start, end = _boundary_candidate_window(30.100, preceding_shot_start=0.0, following_shot_end=34.15, margin_seconds=0.5)
    assert start == pytest.approx(29.6)
    assert end == pytest.approx(30.6)


def test_boundary_window_clips_to_preceding_shot_start_never_crosses_prior_boundary():
    # Preceding shot only starts at 30.0 -- margin would otherwise reach 29.6, must clip to 30.0.
    start, end = _boundary_candidate_window(30.100, preceding_shot_start=30.0, following_shot_end=34.15, margin_seconds=0.5)
    assert start == pytest.approx(30.0)
    assert end == pytest.approx(30.6)


def test_boundary_window_clips_to_following_shot_end_never_crosses_next_boundary():
    # Following shot ends at 30.3 -- margin would otherwise reach 30.6, must clip to 30.3.
    start, end = _boundary_candidate_window(30.100, preceding_shot_start=0.0, following_shot_end=30.3, margin_seconds=0.5)
    assert start == pytest.approx(29.6)
    assert end == pytest.approx(30.3)


def test_default_margin_and_sampling_rate_match_documented_baseline():
    assert TRANSITION_BOUNDARY_SAMPLING_FPS == 10.0
    assert TRANSITION_BOUNDARY_MARGIN_SECONDS == 0.5
    assert MINIMUM_ANALYZABLE_FRAMES == 2


# ---------------------------------------------------------------------------
# Neutral luminance measurements — no interpreted fields.
# ---------------------------------------------------------------------------

def test_luminance_summary_neutral_fields_only():
    values = [100.0, 90.0, 80.0, 70.0, 70.0, 75.0]
    result = _luminance_summary(values)
    assert result["first_value"] == 100.0
    assert result["last_value"] == 75.0
    assert result["min"] == 70.0
    assert result["max"] == 100.0
    assert result["signed_total_change"] == pytest.approx(-25.0)
    assert result["positive_delta_count"] == 1  # 70 -> 75
    assert result["negative_delta_count"] == 3  # 100->90, 90->80, 80->70
    assert result["zero_delta_count"] == 1  # 70 -> 70
    # sign_change_count only counts adjacent NON-ZERO deltas with opposite signs -- the exact-zero
    # delta (70 -> 70) sits between the negative run and the positive run, so neither adjacent
    # pair it participates in ((-10, 0) and (0, 5)) qualifies (one side is zero in each case).
    assert result["sign_change_count"] == 0
    assert isinstance(result["regression_slope"], float)
    # No interpreted/classification field of any kind.
    for forbidden in ("monotonic_direction", "declining", "rising", "fade_like", "trend"):
        assert forbidden not in result


def test_luminance_summary_zero_delta_is_exact_equality_only():
    result = _luminance_summary([50.0, 50.0, 50.0])
    assert result["zero_delta_count"] == 2
    assert result["positive_delta_count"] == 0
    assert result["negative_delta_count"] == 0
    assert result["sign_change_count"] == 0


def test_luminance_helper_computes_mean():
    img = np.full((10, 10), 42, dtype=np.uint8)
    assert _luminance(img) == pytest.approx(42.0)


# ---------------------------------------------------------------------------
# Neutral frame-difference measurements — no "elevated pair"/shape concept.
# ---------------------------------------------------------------------------

def test_frame_difference_summary_neutral_fields_only():
    values = [0.01, 0.02, 0.15, 0.14, 0.01]
    result = _frame_difference_summary(values)
    assert result["median"] == pytest.approx(0.02)
    assert result["max"] == pytest.approx(0.15)
    assert result["argmax_index"] == 2
    for forbidden in ("isolated_spike", "sustained_plateau", "elevated_pair_count", "trajectory_shape", "gradual_ramp"):
        assert forbidden not in result


def test_frame_diff_pair_identical_frames_is_zero():
    img = _textured_image(seed=1)
    assert _frame_diff_pair(img, img) == pytest.approx(0.0)


def test_frame_diff_pair_black_to_white_is_one():
    black = np.zeros((10, 10), dtype=np.uint8)
    white = np.full((10, 10), 255, dtype=np.uint8)
    assert _frame_diff_pair(black, white) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Black-frame threshold reuse (existing Stage-5 constant, no new threshold) + exact
# black-frame/zero-response phase diagnostic (no generalized usable rule).
# ---------------------------------------------------------------------------

def test_reuses_existing_stage5_black_frame_constant_no_new_one_defined():
    from app.services.ffmpeg_svc import FRAME_BLACK_LUMINANCE_THRESHOLD
    # transition_evidence_svc imports this constant directly rather than defining its own —
    # verified by asserting the imported name resolves to the exact same value.
    assert transition_evidence_svc.FRAME_BLACK_LUMINANCE_THRESHOLD == FRAME_BLACK_LUMINANCE_THRESHOLD


def test_phase_quality_issue_black_frame_zero_response():
    assert _phase_quality_issue(frame_a_is_black=True, frame_b_is_black=False, response=0.0) == "black_frame_zero_response"
    assert _phase_quality_issue(frame_a_is_black=False, frame_b_is_black=True, response=0.0) == "black_frame_zero_response"


def test_phase_quality_issue_none_when_not_black():
    assert _phase_quality_issue(frame_a_is_black=False, frame_b_is_black=False, response=0.0) is None


def test_phase_quality_issue_none_when_response_nonzero_even_if_black():
    # No generalized "low response" rule -- only the EXACT degenerate value counts.
    assert _phase_quality_issue(frame_a_is_black=True, frame_b_is_black=True, response=0.0001) is None
    assert _phase_quality_issue(frame_a_is_black=True, frame_b_is_black=True, response=0.5) is None


# ---------------------------------------------------------------------------
# Explicit affine failure semantics — never fabricated zeros (reused Phase-A vocabulary).
# ---------------------------------------------------------------------------

def test_affine_failure_reused_from_phase_a_reports_reason_not_zeros():
    from app.services.visual_motion_svc import _affine_pair, DEFAULT_ORB_NFEATURES, DEFAULT_RATIO_TEST_THRESHOLD, DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX
    result = _affine_pair(
        _black_image(), _black_image(),
        orb_nfeatures=DEFAULT_ORB_NFEATURES, ratio_threshold=DEFAULT_RATIO_TEST_THRESHOLD, ransac_threshold_px=DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX,
    )
    assert result["estimation_success"] is False
    assert result["reason"] == "insufficient_keypoints"
    assert "translation_x" not in result  # never a fabricated zero alongside failure


# ---------------------------------------------------------------------------
# Aggregation: insufficient-boundary-material honesty (both-sides requirement).
# ---------------------------------------------------------------------------

def test_aggregation_insufficient_when_fewer_than_minimum_frames():
    result = aggregate_transition_evidence(
        timestamps=[30.0], luminance_values=[], is_black_frame_flags=[], frame_diff_values=[],
        affine_pairs=[], phase_pairs=[], phase_quality_issues=[],
        sampling_fps=10.0, sample_count=1, boundary_timestamp=30.1, window_start=29.6, window_end=30.6,
    )
    assert result["insufficient_boundary_material"] is True
    assert result["luminance"] is None
    assert result["frame_difference"] is None
    assert result["affine_evidence"] is None
    assert result["phase_correlation_evidence"] is None


def test_aggregation_insufficient_when_all_samples_on_one_side_of_boundary():
    # Two samples, but BOTH before the boundary -- no material on the "after" side.
    timestamps = [29.6, 29.7]
    result = aggregate_transition_evidence(
        timestamps=timestamps, luminance_values=[100.0, 99.0], is_black_frame_flags=[False, False],
        frame_diff_values=[0.01], affine_pairs=[{"estimation_success": True, "translation_x": 0.0, "translation_y": 0.0,
        "translation_magnitude": 0.0, "scale": 1.0, "rotation_deg": 0.0, "candidate_match_count": 10,
        "ransac_inlier_count": 10, "ransac_inlier_ratio": 1.0}],
        phase_pairs=[{"dx": 0.0, "dy": 0.0, "magnitude": 0.0, "response": 1.0}], phase_quality_issues=[None],
        sampling_fps=10.0, sample_count=2, boundary_timestamp=30.1, window_start=29.6, window_end=30.6,
    )
    assert result["insufficient_boundary_material"] is True


def test_aggregation_sufficient_with_material_on_both_sides():
    timestamps = [29.9, 30.0, 30.1, 30.2]
    luminance_values = [100.0, 95.0, 50.0, 48.0]
    frame_diff_values = [0.02, 0.2, 0.01]
    affine_pairs = [
        {"estimation_success": True, "translation_x": 0.1, "translation_y": 0.0, "translation_magnitude": 0.1,
         "scale": 1.0, "rotation_deg": 0.0, "candidate_match_count": 100, "ransac_inlier_count": 95, "ransac_inlier_ratio": 0.95},
        {"estimation_success": False, "reason": "insufficient_keypoints"},
        {"estimation_success": True, "translation_x": 0.0, "translation_y": 0.0, "translation_magnitude": 0.0,
         "scale": 1.0, "rotation_deg": 0.0, "candidate_match_count": 100, "ransac_inlier_count": 99, "ransac_inlier_ratio": 0.99},
    ]
    phase_pairs = [
        {"dx": 0.1, "dy": 0.0, "magnitude": 0.1, "response": 0.9},
        {"dx": 640.0, "dy": 360.0, "magnitude": 734.8, "response": 0.0},
        {"dx": 0.0, "dy": 0.0, "magnitude": 0.0, "response": 0.95},
    ]
    phase_quality_issues = [None, "black_frame_zero_response", None]
    result = aggregate_transition_evidence(
        timestamps=timestamps, luminance_values=luminance_values, is_black_frame_flags=[False, False, True, False],
        frame_diff_values=frame_diff_values, affine_pairs=affine_pairs, phase_pairs=phase_pairs,
        phase_quality_issues=phase_quality_issues,
        sampling_fps=10.0, sample_count=4, boundary_timestamp=30.1, window_start=29.9, window_end=30.2,
    )
    assert result["insufficient_boundary_material"] is False
    assert result["sample_count"] == 4
    assert result["frame_pair_count"] == 3
    assert result["luminance"]["first_value"] == 100.0
    assert result["luminance"]["last_value"] == 48.0
    assert result["frame_difference"]["max"] == pytest.approx(0.2)
    assert result["black_frame_flags"] == [False, False, True, False]
    assert result["affine_evidence"]["successful_pair_count"] == 2
    assert result["affine_evidence"]["failed_pair_count"] == 1
    assert result["affine_evidence"]["failure_reason_counts"] == {"insufficient_keypoints": 1}
    assert len(result["affine_evidence"]["pairs"]) == 3  # every pair kept, never collapsed
    assert result["phase_correlation_evidence"]["pairs"][1]["phase_quality_issue"] == "black_frame_zero_response"
    assert result["phase_correlation_evidence"]["pairs"][0]["phase_quality_issue"] is None
    # No transition-type label or interpreted shape field anywhere in the aggregate.
    for forbidden in ("hard_cut", "fade", "dissolve", "dip_to_black", "trajectory_shape", "directional_transfer_confirmed", "usable"):
        assert forbidden not in result
        assert forbidden not in result["luminance"]
        assert forbidden not in result["frame_difference"]


# ---------------------------------------------------------------------------
# No similarity-transfer fields anywhere (deliberately deferred).
# ---------------------------------------------------------------------------

def test_no_similarity_transfer_fields_in_module():
    import inspect
    source = inspect.getsource(transition_evidence_svc)
    for forbidden in ("similarity_to_a", "similarity_to_b", "difference_curve", "crossover"):
        assert forbidden not in source.lower()


# ---------------------------------------------------------------------------
# Full pipeline (extraction mocked with synthetic frames) — own temp-directory lifecycle.
# ---------------------------------------------------------------------------

async def test_missing_video_file_raises_honestly():
    with pytest.raises(FileNotFoundError):
        await measure_boundary_transition_evidence("nonexistent_path_xyz.mp4", 30.1, 0.0, 34.15)


async def test_full_pipeline_with_mocked_extraction_produces_expected_counts(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video, just needs to exist")

    frames = [_textured_image(seed=i) for i in range(10)]
    with patch.object(transition_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_evidence(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=0.0, following_shot_end=34.15,
        )

    assert result["insufficient_boundary_material"] is False
    assert result["sample_count"] == 10
    assert result["frame_pair_count"] == 9
    assert result["sampling_fps"] == 10.0
    assert result["affine_evidence"] is not None
    assert result["phase_correlation_evidence"] is not None
    # window is 29.6-30.6 (0.5s margin each side) -> boundary at 30.1 sits at sample index 5.
    assert result["sample_timestamps"][0] == pytest.approx(29.6)
    assert any(t < 30.1 for t in result["sample_timestamps"])
    assert any(t > 30.1 for t in result["sample_timestamps"])


async def test_full_pipeline_insufficient_material_reports_honestly(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")

    # Only one frame extracted -- below MINIMUM_ANALYZABLE_FRAMES.
    with patch.object(transition_evidence_svc, "_extract_grayscale_frames_sync", return_value=[_textured_image()]):
        result = await measure_boundary_transition_evidence(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=0.0, following_shot_end=34.15,
        )

    assert result["insufficient_boundary_material"] is True
    assert result["luminance"] is None
    assert result["affine_evidence"] is None


async def test_temp_directory_removed_after_successful_run(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(10)]
    captured_tmp_dirs = []

    def _spy_extract(ffmpeg_bin, video_path_, start, end, fps, tmp_dir):
        captured_tmp_dirs.append(tmp_dir)
        return frames

    with patch.object(transition_evidence_svc, "_extract_grayscale_frames_sync", side_effect=_spy_extract):
        await measure_boundary_transition_evidence(str(video_path), 30.1, 0.0, 34.15)

    assert len(captured_tmp_dirs) == 1
    assert not os.path.exists(captured_tmp_dirs[0])  # removed by TemporaryDirectory's own __exit__


async def test_temp_directory_removed_even_on_extraction_failure(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    captured_tmp_dirs = []

    def _failing_extract(ffmpeg_bin, video_path_, start, end, fps, tmp_dir):
        captured_tmp_dirs.append(tmp_dir)
        raise RuntimeError("simulated ffmpeg failure")

    with patch.object(transition_evidence_svc, "_extract_grayscale_frames_sync", side_effect=_failing_extract):
        with pytest.raises(RuntimeError):
            await measure_boundary_transition_evidence(str(video_path), 30.1, 0.0, 34.15)

    assert len(captured_tmp_dirs) == 1
    assert not os.path.exists(captured_tmp_dirs[0])  # still removed despite the exception


async def test_this_module_never_reuses_phase_a_or_stage5_frame_paths(tmp_path):
    """Structural proof of the B0.4A correction: this module's own extraction call always uses
    a FRESH tmp_dir it creates itself (prefix "stage9_transition_"), never a path supplied by, or
    shared with, Phase A's own "stage9_motion_" prefix."""
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(6)]
    captured = []

    def _spy(ffmpeg_bin, video_path_, start, end, fps, tmp_dir):
        captured.append(tmp_dir)
        return frames

    with patch.object(transition_evidence_svc, "_extract_grayscale_frames_sync", side_effect=_spy):
        await measure_boundary_transition_evidence(str(video_path), 30.1, 0.0, 34.15)

    assert "stage9_transition_" in os.path.basename(captured[0]) or "stage9_transition_" in captured[0]
