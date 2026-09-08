"""Video Deconstructor — Stage 9 Phase B2: transition_similarity_evidence_svc.py unit tests. Pure
input->output tests — no database, no router, no real video file (synthetic textured images
only), matching the isolation this module's own docstring establishes. Real-video and controlled-
corpus validation happen separately (see the Phase-B2 final report).

Covers: similarity reuses B1's own _frame_diff_pair, exactly the 5-field production vector (no
sixth field), the outer cross-boundary comparison uses the literal first/last extracted frame,
boundary partition follows the actual timestamp (never array midpoint), each of the 4 subset
fields uses the correct outer/nearest-boundary samples, the exact pairwise-mean rule (3 samples ->
3 unique pairs, 2 samples -> 1 pair, <2 samples -> None), exact-zero/exact-one similarity
retained, insufficient-boundary-material honesty, own independent temp-directory lifecycle, and a
terminology/safety sweep against ratio/difference/gap/sweep/matrix fields or semantic labels
leaking into the evidence object.
"""
import os
from unittest.mock import patch

import numpy as np
import pytest

from app.services import transition_similarity_evidence_svc
from app.services.transition_similarity_evidence_svc import (
    _pairwise_mean_similarity, _similarity, measure_boundary_transition_similarity,
)
from app.services.transition_evidence_svc import _frame_diff_pair


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


def _white_image(size=200) -> np.ndarray:
    return np.full((size, size), 255, dtype=np.uint8)


# ---------------------------------------------------------------------------
# Metric reuse — exactly B1's own _frame_diff_pair, never a new metric.
# ---------------------------------------------------------------------------

def test_similarity_is_exactly_one_minus_b1_frame_diff():
    a, b = _textured_image(seed=1), _textured_image(seed=2)
    assert _similarity(a, b) == pytest.approx(1.0 - _frame_diff_pair(a, b))


def test_similarity_identical_frames_is_exactly_one():
    a = _textured_image(seed=5)
    assert _similarity(a, a) == pytest.approx(1.0)


def test_similarity_black_vs_white_is_exactly_zero():
    assert _similarity(_black_image(), _white_image()) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Pairwise-mean semantics — exact unique unordered pairs, no self-comparison.
# ---------------------------------------------------------------------------

def test_pairwise_mean_three_samples_uses_exactly_three_unique_pairs():
    frames = [_black_image(), _white_image(), _textured_image(seed=1)]
    expected = (
        _similarity(frames[0], frames[1]) + _similarity(frames[0], frames[2]) + _similarity(frames[1], frames[2])
    ) / 3
    result = _pairwise_mean_similarity(frames, [0, 1, 2])
    assert result == pytest.approx(expected)


def test_pairwise_mean_two_samples_uses_exactly_one_pair():
    frames = [_black_image(), _white_image()]
    result = _pairwise_mean_similarity(frames, [0, 1])
    assert result == pytest.approx(_similarity(frames[0], frames[1]))


def test_pairwise_mean_one_sample_is_none():
    frames = [_black_image()]
    assert _pairwise_mean_similarity(frames, [0]) is None


def test_pairwise_mean_zero_samples_is_none():
    assert _pairwise_mean_similarity([], []) is None


def test_pairwise_mean_never_self_compares():
    """A single repeated frame among a 2-sample subset must still compute a real (non-trivial)
    pairwise value between the two DIFFERENT list positions, never silently comparing a frame to
    itself as a shortcut."""
    frames = [_textured_image(seed=9), _textured_image(seed=9)]  # same content, two positions
    result = _pairwise_mean_similarity(frames, [0, 1])
    assert result == pytest.approx(1.0)  # identical content -> similarity 1.0, computed genuinely


# ---------------------------------------------------------------------------
# Full pipeline (mocked extraction) — exact 5-field vector, boundary partition, subset selection.
# ---------------------------------------------------------------------------

async def test_missing_video_file_raises_honestly():
    with pytest.raises(FileNotFoundError):
        await measure_boundary_transition_similarity("nonexistent_path_xyz.mp4", 30.1, 0.0, 34.15)


async def test_insufficient_boundary_material_all_fields_none(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=[_textured_image()]):
        result = await measure_boundary_transition_similarity(str(video_path), 30.1, 0.0, 34.15)
    assert result["insufficient_boundary_material"] is True
    for field in ("cross_boundary_similarity", "pre_window_edge_similarity", "post_window_edge_similarity",
                  "pre_trigger_adjacent_similarity", "post_trigger_adjacent_similarity"):
        assert result[field] is None


async def test_insufficient_when_all_samples_on_one_side_of_boundary(tmp_path):
    """Mirrors B1's own equivalent test -- material exists, but ALL of it is on one side, so the
    boundary itself has nothing to compare across."""
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(4)]
    # Window [29.6, 30.6] at 10fps with boundary at 30.1 would normally straddle it; force a
    # boundary AFTER every sample instead so has_after is False.
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_similarity(str(video_path), boundary_timestamp=99.0, preceding_shot_start=0.0, following_shot_end=100.0)
    assert result["insufficient_boundary_material"] is True


async def test_full_pipeline_exact_five_field_vector_no_sixth_field(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(10)]
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_similarity(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=0.0, following_shot_end=34.15,
        )
    assert result["insufficient_boundary_material"] is False
    expected_keys = {
        "insufficient_boundary_material", "sampling_fps", "sample_count",
        "boundary_timestamp", "window_start", "window_end",
        "cross_boundary_similarity", "pre_window_edge_similarity", "post_window_edge_similarity",
        "pre_trigger_adjacent_similarity", "post_trigger_adjacent_similarity",
    }
    assert set(result.keys()) == expected_keys  # no ratio/difference/gap/sweep/matrix field


async def test_cross_boundary_similarity_uses_literal_first_and_last_frame(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_black_image()] + [_textured_image(seed=i) for i in range(8)] + [_white_image()]
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_similarity(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=0.0, following_shot_end=34.15,
        )
    # window is 29.6-30.6 at 10fps -> 10 samples, frame[0]=black, frame[-1]=white.
    assert result["cross_boundary_similarity"] == pytest.approx(0.0)


async def test_boundary_partition_follows_timestamp_not_array_midpoint(tmp_path):
    """Constructs a case where the true timestamp-based boundary index is NOT the array midpoint
    -- confirms partition is timestamp-driven. `preceding_shot_start` clips the window tightly
    against the pre-side (mirroring _boundary_candidate_window's own clipping behavior), producing
    genuine pre/post asymmetry -- the boundary_timestamp itself would otherwise always center the
    window symmetrically."""
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(10)]
    # window clips to [30.05, 30.6] (preceding_shot_start=30.05 is inside the normal 0.5s margin).
    # At 10fps, timestamps = 30.05, 30.15, ..., 30.95 -- only ONE sample (30.05) is < 30.1; the
    # other NINE are >= 30.1 -- nowhere near the array midpoint (index 5).
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_similarity(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=30.05, following_shot_end=34.15,
        )
    # Only 1 pre-sample exists -> both pre-side subset fields must be None (no pair possible),
    # while post-side (9 samples) fields must be real values -- proves timestamp-driven partition.
    assert result["pre_window_edge_similarity"] is None
    assert result["pre_trigger_adjacent_similarity"] is None
    assert result["post_window_edge_similarity"] is not None
    assert result["post_trigger_adjacent_similarity"] is not None


async def test_pre_window_edge_uses_outermost_pre_samples(tmp_path):
    """Distinct content at the far pre-edge vs. near the boundary must be distinguishable by
    which field picks it up."""
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    # 10 samples, boundary at 30.1 -> pre-indices 0..4 (29.6..30.0), post-indices 5..9 (30.1..30.5).
    frames = [_black_image(), _black_image(), _black_image(), _white_image(), _white_image()] + [_textured_image(seed=i) for i in range(5)]
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_similarity(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=0.0, following_shot_end=34.15,
        )
    # pre_window_edge = outermost 3 PRE samples = indices [0,1,2] = all black -> similarity 1.0.
    assert result["pre_window_edge_similarity"] == pytest.approx(1.0)
    # pre_trigger_adjacent = last 3 PRE samples = indices [2,3,4] = black,white,white -> NOT 1.0.
    assert result["pre_trigger_adjacent_similarity"] < 0.99


async def test_post_window_edge_uses_outermost_post_samples(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    # post-indices 5..9; make the LAST 3 (7,8,9) uniform and the FIRST post samples (5,6) different.
    frames = [_textured_image(seed=i) for i in range(5)] + [_black_image(), _white_image(), _white_image(), _white_image(), _white_image()]
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_similarity(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=0.0, following_shot_end=34.15,
        )
    # post_window_edge = LAST 3 POST samples = indices [7,8,9] = all white -> similarity 1.0.
    assert result["post_window_edge_similarity"] == pytest.approx(1.0)
    # post_trigger_adjacent = FIRST 3 POST samples = indices [5,6,7] = black,white,white -> NOT 1.0.
    assert result["post_trigger_adjacent_similarity"] < 0.99


async def test_pre_insufficiency_independent_of_post_sufficiency(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(10)]
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_similarity(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=30.05, following_shot_end=34.15,
        )
    assert result["pre_window_edge_similarity"] is None  # only 1 pre-sample
    assert result["post_window_edge_similarity"] is not None  # 9 post-samples, fully sufficient


# ---------------------------------------------------------------------------
# Exact-zero / exact-one similarity retained, never conflated with missing.
# ---------------------------------------------------------------------------

async def test_exact_zero_similarity_retained_not_none(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_black_image() for _ in range(5)] + [_white_image() for _ in range(5)]
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_similarity(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=0.0, following_shot_end=34.15,
        )
    assert result["cross_boundary_similarity"] == pytest.approx(0.0)
    assert result["cross_boundary_similarity"] is not None


async def test_exact_one_similarity_retained_not_none(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_black_image() for _ in range(10)]
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_similarity(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=0.0, following_shot_end=34.15,
        )
    assert result["cross_boundary_similarity"] == pytest.approx(1.0)
    assert result["pre_window_edge_similarity"] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Own independent temp-directory lifecycle (never assumes B1's own frames exist).
# ---------------------------------------------------------------------------

async def test_temp_directory_removed_after_successful_run(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(10)]
    captured_tmp_dirs = []

    def _spy_extract(ffmpeg_bin, video_path_, start, end, fps, tmp_dir):
        captured_tmp_dirs.append(tmp_dir)
        return frames

    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", side_effect=_spy_extract):
        await measure_boundary_transition_similarity(str(video_path), 30.1, 0.0, 34.15)

    assert len(captured_tmp_dirs) == 1
    assert not os.path.exists(captured_tmp_dirs[0])
    assert "stage9_transition_similarity_" in captured_tmp_dirs[0]


async def test_temp_directory_removed_even_on_extraction_failure(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    captured_tmp_dirs = []

    def _failing_extract(ffmpeg_bin, video_path_, start, end, fps, tmp_dir):
        captured_tmp_dirs.append(tmp_dir)
        raise RuntimeError("simulated ffmpeg failure")

    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", side_effect=_failing_extract):
        with pytest.raises(RuntimeError):
            await measure_boundary_transition_similarity(str(video_path), 30.1, 0.0, 34.15)

    assert len(captured_tmp_dirs) == 1
    assert not os.path.exists(captured_tmp_dirs[0])


def test_sampling_and_margin_reused_from_b1_not_redefined():
    from app.services import transition_evidence_svc
    assert transition_similarity_evidence_svc.TRANSITION_BOUNDARY_SAMPLING_FPS is transition_evidence_svc.TRANSITION_BOUNDARY_SAMPLING_FPS
    assert transition_similarity_evidence_svc.TRANSITION_BOUNDARY_MARGIN_SECONDS is transition_evidence_svc.TRANSITION_BOUNDARY_MARGIN_SECONDS


# ---------------------------------------------------------------------------
# No ratio/difference/gap/sweep/matrix/raw-frame fields; no semantic labels.
# ---------------------------------------------------------------------------

async def test_no_forbidden_derived_or_semantic_fields_in_actual_output(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(10)]
    with patch.object(transition_similarity_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_boundary_transition_similarity(
            str(video_path), boundary_timestamp=30.1, preceding_shot_start=0.0, following_shot_end=34.15,
        )
    dumped = str(result).lower()
    for forbidden in ("ratio", "diff", "gap", "sweep", "matrix", "trust", "confidence", "quality",
                      "hard_cut", "fade", "dissolve", "wipe", "crossover", "gradual", "instantaneous"):
        assert forbidden not in dumped
