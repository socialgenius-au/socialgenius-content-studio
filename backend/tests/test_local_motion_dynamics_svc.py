"""Video Deconstructor — Stage 9 Phase D2: local_motion_dynamics_svc.py unit tests. Pure
input->output tests — no database, no router, no real video file (synthetic images only),
matching the isolation this module's own docstring establishes. Real-video and controlled-corpus
validation happen separately (see the Phase-D2 final report).

Covers: fixed 3x4 geometry reuse, pair-index/timestamp derivation, numeric-zero-vs-unavailable,
gap-breaks-continuity (no bridging), value-sign vs. delta-sign semantics (and their explicit
non-conflation), residual has no value-sign fields, delta sign-change semantics, longest
contiguous run, feature-availability context, affine-failure semantics, argmax unique/tie/
change-count/most-frequent handling (including the "tie never wins" rule), centroid calculation/
zero-total/range/delta-signs/displacement/gap-continuity, total-weight context (never suppressed
for low non-zero weight), bounded output, no persisted sequences, and a terminology/threshold
safety sweep.
"""
from unittest.mock import patch

import numpy as np
import pytest

from app.services import local_motion_dynamics_svc
from app.services.local_motion_dynamics_svc import (
    GRID_COLS, GRID_ROWS, MINIMUM_ANALYZABLE_FRAMES, SPATIAL_STREAMS,
    _argmax_cell, _argmax_summary, _centroid_summary, _delta_sign_change_count, _delta_sign_counts,
    _feature_availability_dynamics, _first_difference_sequence, _longest_contiguous_run,
    _magnitude_dynamics, _signed_dynamics, _spatial_stream_values, _total_weight_summary,
    _weighted_centroid, measure_shot_local_motion_dynamics,
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


def _blank_image(size=200, value=128) -> np.ndarray:
    return np.full((size, size), value, dtype=np.uint8)


# ---------------------------------------------------------------------------
# First-difference sequence / sign counting / sign-change / contiguous-run helpers.
# ---------------------------------------------------------------------------

def test_first_difference_sequence_computes_pairwise_deltas():
    deltas = _first_difference_sequence([1.0, 3.0, 2.0])
    assert deltas == [2.0, -1.0]


def test_first_difference_sequence_gap_produces_none_on_both_sides():
    deltas = _first_difference_sequence([1.0, None, 3.0])
    assert deltas == [None, None]  # neither delta can be computed across the missing middle value


def test_delta_sign_counts():
    positive, negative, zero = _delta_sign_counts([1.0, -1.0, 0.0, None, 2.0])
    assert (positive, negative, zero) == (2, 1, 1)


def test_delta_sign_change_count_worked_example():
    """The task's own explicit worked example: dx=[-2,-1,+1] -> delta_dx=[+1,+2] -- BOTH positive,
    so zero sign changes in the delta sequence itself (this test targets the delta-of-delta
    concept directly, not the value sequence)."""
    dx = [-2.0, -1.0, 1.0]
    deltas = _first_difference_sequence(dx)
    assert deltas == [1.0, 2.0]
    assert _delta_sign_change_count(deltas) == 0


def test_delta_sign_change_count_detects_a_real_flip():
    deltas = [1.0, 1.0, -1.0, -1.0]
    assert _delta_sign_change_count(deltas) == 1  # exactly one flip, between index 1 and 2


def test_delta_sign_change_count_never_bridges_a_gap():
    # A flip WOULD be detected between the two nonzero deltas if the gap were bridged; it must not be.
    deltas = [1.0, None, -1.0]
    assert _delta_sign_change_count(deltas) == 0


def test_delta_sign_change_count_zero_delta_never_counts_as_a_flip():
    deltas = [1.0, 0.0, -1.0]
    assert _delta_sign_change_count(deltas) == 0  # zero is neither positive nor negative on either side


def test_longest_contiguous_run():
    assert _longest_contiguous_run([True, True, False, True, True, True, False]) == 3
    assert _longest_contiguous_run([False, False]) == 0
    assert _longest_contiguous_run([]) == 0


# ---------------------------------------------------------------------------
# Value-sign vs. delta-sign semantics — the explicit non-conflation this phase's own task
# worked through.
# ---------------------------------------------------------------------------

def test_magnitude_dynamics_has_no_value_sign_fields():
    """Residual mean/p95/max (and flow magnitude) are non-negative by construction -- confirm the
    production dynamics vector never introduces a value-sign field for them."""
    result = _magnitude_dynamics([0.1, 0.2, 0.15])
    assert "value_positive_count" not in result
    assert "value_negative_count" not in result
    assert "value_zero_count" not in result


def test_signed_dynamics_carries_both_value_sign_and_delta_sign_distinctly():
    """The task's own worked example: dx=[-2,-1,+1] -- VALUE sign is negative,negative,positive
    (2 negative, 1 positive), but the first-difference delta_dx=[+1,+2] is entirely positive.
    These must never be conflated under one field name."""
    result = _signed_dynamics([-2.0, -1.0, 1.0])
    assert result["value_positive_count"] == 1
    assert result["value_negative_count"] == 2
    assert result["value_zero_count"] == 0
    assert result["delta_positive_count"] == 2
    assert result["delta_negative_count"] == 0
    assert result["delta_sign_change_count"] == 0


def test_signed_dynamics_zero_value_counts_as_zero_not_missing():
    result = _signed_dynamics([0.0, 1.0, 0.0])
    assert result["value_zero_count"] == 2
    assert result["available_pair_count"] == 3
    assert result["unavailable_pair_count"] == 0


# ---------------------------------------------------------------------------
# Availability / gap semantics — a genuine 0.0 is available; None is not; gaps never bridge.
# ---------------------------------------------------------------------------

def test_numeric_zero_remains_available_not_unavailable():
    result = _magnitude_dynamics([0.0, 0.0, 0.0])
    assert result["available_pair_count"] == 3
    assert result["unavailable_pair_count"] == 0
    assert result["range"] == pytest.approx(0.0)


def test_none_is_unavailable_and_breaks_range_and_run():
    result = _magnitude_dynamics([0.1, None, 0.3])
    assert result["available_pair_count"] == 2
    assert result["unavailable_pair_count"] == 1
    assert result["longest_contiguous_available_run"] == 1  # never bridges the gap
    assert result["range"] == pytest.approx(0.2)


def test_all_unavailable_sequence_has_none_range_and_zero_run():
    result = _magnitude_dynamics([None, None, None])
    assert result["available_pair_count"] == 0
    assert result["range"] is None
    assert result["longest_contiguous_available_run"] == 0


# ---------------------------------------------------------------------------
# Feature-availability context.
# ---------------------------------------------------------------------------

def test_feature_availability_zero_tracked_points_is_measured_not_unavailable():
    result = _feature_availability_dynamics([0, 0, 5])
    assert result["zero_feature_pair_count"] == 2
    assert result["tracked_point_count_temporal_mean"] == pytest.approx(5 / 3)
    assert result["tracked_point_count_temporal_min"] == 0
    assert result["tracked_point_count_temporal_max"] == 5
    assert result["longest_available_run"] == 1  # only the single pair with tracked_point_count > 0


def test_feature_availability_none_means_flow_never_computed():
    """None (e.g. compensated flow on an affine-failed pair) is a genuinely different case from a
    measured 0 -- it must not be averaged in or counted as a zero-feature pair."""
    result = _feature_availability_dynamics([None, 3, None])
    assert result["tracked_point_count_temporal_mean"] == pytest.approx(3.0)
    assert result["zero_feature_pair_count"] == 0


# ---------------------------------------------------------------------------
# Argmax — unique winner, exact tie, tie never wins, change count, most-frequent.
# ---------------------------------------------------------------------------

def test_argmax_cell_unique_winner():
    values = [0.1, 0.9, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    result = _argmax_cell(values)
    assert result["is_tie"] is False
    row, col = divmod(1, GRID_COLS)
    assert (result["row"], result["col"]) == (row, col)


def test_argmax_cell_exact_tie_is_recorded_never_arbitrarily_resolved():
    values = [0.5] * 12
    result = _argmax_cell(values)
    assert result["is_tie"] is True
    assert result["row"] is None and result["col"] is None
    assert len(result["tied_cells"]) == 12


def test_argmax_cell_all_none_is_unavailable():
    assert _argmax_cell([None] * 12) is None


def test_argmax_summary_tie_never_contributes_to_most_frequent_or_unique_count():
    tie = {"row": None, "col": None, "value": 0.5, "is_tie": True, "tied_cells": [[0, 0], [0, 1]]}
    resolved = {"row": 1, "col": 1, "value": 0.9, "is_tie": False, "tied_cells": [[1, 1]]}
    summary = _argmax_summary([tie, resolved, tie])
    assert summary["tie_count"] == 2
    assert summary["unique_argmax_cell_count"] == 1  # only the one resolved cell counted
    assert summary["most_frequent_argmax_cell"] == [1, 1]
    assert summary["most_frequent_argmax_frequency_count"] == 1


def test_argmax_summary_two_way_frequency_tie_is_none_never_arbitrary():
    a = {"row": 0, "col": 0, "value": 0.9, "is_tie": False, "tied_cells": [[0, 0]]}
    b = {"row": 1, "col": 1, "value": 0.9, "is_tie": False, "tied_cells": [[1, 1]]}
    summary = _argmax_summary([a, b])
    assert summary["most_frequent_argmax_cell"] is None
    assert summary["most_frequent_argmax_frequency_count"] is None


def test_argmax_summary_no_resolved_pair_most_frequent_is_none():
    tie = {"row": None, "col": None, "value": 0.5, "is_tie": True, "tied_cells": [[0, 0], [0, 1]]}
    summary = _argmax_summary([tie, None])
    assert summary["most_frequent_argmax_cell"] is None
    assert summary["unique_argmax_cell_count"] == 0


def test_argmax_change_count_only_compares_uniquely_resolved_adjacent_pairs():
    a = {"row": 0, "col": 0, "value": 0.9, "is_tie": False, "tied_cells": [[0, 0]]}
    b = {"row": 1, "col": 1, "value": 0.9, "is_tie": False, "tied_cells": [[1, 1]]}
    tie = {"row": None, "col": None, "value": 0.5, "is_tie": True, "tied_cells": [[0, 0], [0, 1]]}
    # a -> tie -> b: the tie breaks continuity, so this must NOT count as a change even though a != b.
    summary = _argmax_summary([a, tie, b])
    assert summary["argmax_cell_change_count"] == 0
    # a -> b directly (no gap): this DOES count.
    summary2 = _argmax_summary([a, b])
    assert summary2["argmax_cell_change_count"] == 1
    # a -> a -> b: exactly one real change.
    summary3 = _argmax_summary([a, a, b])
    assert summary3["argmax_cell_change_count"] == 1


def test_argmax_summary_available_pair_count_includes_ties():
    tie = {"row": None, "col": None, "value": 0.5, "is_tie": True, "tied_cells": [[0, 0], [0, 1]]}
    resolved = {"row": 1, "col": 1, "value": 0.9, "is_tie": False, "tied_cells": [[1, 1]]}
    summary = _argmax_summary([tie, resolved, None])
    assert summary["available_pair_count"] == 2  # tie + resolved; the None pair is excluded


# ---------------------------------------------------------------------------
# Weighted centroid — calculation, zero-total, low-weight-noise is never suppressed.
# ---------------------------------------------------------------------------

def test_weighted_centroid_calculation_matches_hand_worked_example():
    values = [None] * 12
    values[0] = 1.0  # r0c0 -- cell center (0.125, 1/6)
    values[3] = 1.0  # r0c3 -- cell center (0.875, 1/6)
    result = _weighted_centroid(values)
    assert result["cx"] == pytest.approx(0.5)  # exact midpoint of the two equally-weighted cells
    assert result["cy"] == pytest.approx(1 / 6)
    assert result["total_weight"] == pytest.approx(2.0)
    assert result["n_available_cells"] == 2


def test_weighted_centroid_zero_total_weight_is_none_never_frame_center():
    result = _weighted_centroid([0.0] * 12)
    assert result["cx"] is None and result["cy"] is None
    assert result["total_weight"] == pytest.approx(0.0)


def test_weighted_centroid_all_none_is_zero_total_weight_none_centroid():
    result = _weighted_centroid([None] * 12)
    assert result["cx"] is None and result["cy"] is None
    assert result["n_available_cells"] == 0


def test_weighted_centroid_tiny_nonzero_weight_is_not_suppressed():
    """D2.1's own central caveat: a tiny non-zero weight is NOT thresholded away -- the centroid
    is computed normally, however noise-sensitive that may be; only exact-zero triggers None."""
    values = [0.0] * 12
    values[0] = 1e-9
    result = _weighted_centroid(values)
    assert result["cx"] is not None
    assert result["total_weight"] == pytest.approx(1e-9)


# ---------------------------------------------------------------------------
# Centroid bounded summary — range, delta signs, displacement, gap continuity.
# ---------------------------------------------------------------------------

def test_centroid_summary_range_and_min_max():
    seq = [{"cx": 0.2, "cy": 0.3}, {"cx": 0.8, "cy": 0.1}, {"cx": 0.5, "cy": 0.5}]
    summary = _centroid_summary(seq)
    assert summary["cx_min"] == pytest.approx(0.2)
    assert summary["cx_max"] == pytest.approx(0.8)
    assert summary["cx_range"] == pytest.approx(0.6)
    assert summary["available_pair_count"] == 3


def test_centroid_summary_delta_sign_counts():
    seq = [{"cx": 0.2, "cy": 0.5}, {"cx": 0.5, "cy": 0.5}, {"cx": 0.1, "cy": 0.5}]
    summary = _centroid_summary(seq)
    assert summary["delta_cx_positive_count"] == 1
    assert summary["delta_cx_negative_count"] == 1
    assert summary["delta_cy_positive_count"] == 0
    assert summary["delta_cy_zero_count"] == 2


def test_centroid_summary_displacement_hand_worked():
    seq = [{"cx": 0.0, "cy": 0.0}, {"cx": 3.0, "cy": 4.0}]  # classic 3-4-5 triangle
    summary = _centroid_summary(seq)
    assert summary["displacement_temporal_mean"] == pytest.approx(5.0)
    assert summary["displacement_temporal_max"] == pytest.approx(5.0)


def test_centroid_summary_unavailable_gap_breaks_displacement_and_delta():
    seq = [{"cx": 0.2, "cy": 0.2}, {"cx": None, "cy": None}, {"cx": 0.9, "cy": 0.9}]
    summary = _centroid_summary(seq)
    assert summary["available_pair_count"] == 2
    assert summary["unavailable_pair_count"] == 1
    assert summary["displacement_temporal_mean"] is None  # no adjacent available pair exists
    assert summary["delta_cx_positive_count"] == 0


# ---------------------------------------------------------------------------
# Total-weight context — always present, never a confidence/threshold field.
# ---------------------------------------------------------------------------

def test_total_weight_summary_always_defined_even_when_centroid_unavailable():
    seq = [
        {"total_weight": 0.0, "n_available_cells": 3},
        {"total_weight": 0.4, "n_available_cells": 5},
    ]
    summary = _total_weight_summary(seq)
    assert summary["total_weight_temporal_mean"] == pytest.approx(0.2)
    assert summary["total_weight_temporal_max"] == pytest.approx(0.4)
    assert summary["total_weight_range"] == pytest.approx(0.4)
    assert summary["available_cell_count_temporal_mean"] == pytest.approx(4.0)
    for key in summary:
        assert "confidence" not in key and "reliability" not in key and "quality" not in key


# ---------------------------------------------------------------------------
# Spatial-stream value extraction — the exact 4 retained streams, correct grid alignment.
# ---------------------------------------------------------------------------

def test_spatial_streams_are_exactly_the_four_d21_validated_streams():
    assert SPATIAL_STREAMS == ["residual_mean", "residual_p95", "residual_max", "compensated_flow_median_magnitude"]


def test_spatial_stream_values_reads_correct_grid_and_key():
    residual_grid = [{"row": r, "col": c, "mean": float(r * GRID_COLS + c), "p95": 0.0, "max": 0.0}
                      for r in range(GRID_ROWS) for c in range(GRID_COLS)]
    pair = {"residual_grid": residual_grid, "compensated_flow_grid": None}
    values = _spatial_stream_values(pair, "residual_mean")
    assert values == [float(i) for i in range(12)]


def test_spatial_stream_values_none_grid_produces_all_none():
    pair = {"residual_grid": None, "compensated_flow_grid": None}
    assert _spatial_stream_values(pair, "residual_mean") == [None] * 12
    assert _spatial_stream_values(pair, "compensated_flow_median_magnitude") == [None] * 12


# ---------------------------------------------------------------------------
# Full pipeline (mocked extraction) — affine failure, bounded/fixed-size output, geometry reuse.
# ---------------------------------------------------------------------------

def test_fixed_grid_geometry_matches_d1():
    assert (GRID_ROWS, GRID_COLS) == (3, 4)
    assert MINIMUM_ANALYZABLE_FRAMES == 2


async def test_missing_video_file_raises_honestly():
    with pytest.raises(FileNotFoundError):
        await measure_shot_local_motion_dynamics("nonexistent_path_xyz.mp4", 0.0, 10.0)


async def test_insufficient_samples_honestly_reported(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    with patch.object(local_motion_dynamics_svc, "_extract_grayscale_frames_sync", return_value=[_textured_image()]):
        result = await measure_shot_local_motion_dynamics(str(video_path), 30.100, 30.150)
    assert result["insufficient_temporal_samples"] is True
    assert result["residual_dynamics"] is None
    assert result["uncompensated_flow_dynamics"] is None
    assert result["compensated_flow_dynamics"] is None
    assert result["spatial_distribution"] is None


async def test_pair_index_and_timestamp_derivation(tmp_path):
    """Timestamps are derived (safe_start + pair_index / sampling_fps), never independently
    persisted -- confirm the sampling metadata needed for that derivation IS returned, and that
    no raw per-pair index/timestamp key appears anywhere in the nested output."""
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(4)]
    with patch.object(local_motion_dynamics_svc, "_extract_grayscale_frames_sync", return_value=frames) as mock_extract:
        result = await measure_shot_local_motion_dynamics(str(video_path), 0.0, 10.0, sampling_fps=5.0)
    # safe_start is boundary-safety-inset from the raw start_time (reusing Phase A's own
    # _boundary_safe_window unmodified) -- this test only confirms it was passed straight
    # through to extraction, not that it equals the shot's raw, uninset start_time.
    safe_start, safe_end = local_motion_dynamics_svc._boundary_safe_window(0.0, 10.0)
    assert mock_extract.call_args.args[2] == pytest.approx(safe_start)
    assert result["frame_pair_count"] == 3
    assert result["sampling_fps"] == 5.0

    def _walk(obj):
        if isinstance(obj, dict):
            for forbidden_key in ("pair_index", "pair_start_time_seconds", "pair_end_time_seconds"):
                assert forbidden_key not in obj
            for v in obj.values():
                _walk(v)
        elif isinstance(obj, list):
            for item in obj:
                _walk(item)

    _walk(result)


async def test_affine_failure_leaves_residual_and_compensated_flow_unavailable_uncompensated_unaffected(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_blank_image(), _blank_image()]  # blank -> ORB finds no keypoints -> affine failure
    with patch.object(local_motion_dynamics_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_shot_local_motion_dynamics(str(video_path), 0.0, 10.0)

    assert result["affine_successful_pair_count"] == 0
    assert result["affine_failed_pair_count"] == 1
    for cell in result["residual_dynamics"]:
        assert cell["mean"]["available_pair_count"] == 0
        assert cell["mean"]["unavailable_pair_count"] == 1
    for cell in result["compensated_flow_dynamics"]:
        assert cell["median_magnitude"]["available_pair_count"] == 0
    # Uncompensated flow is UNAFFECTED by the affine failure -- parallel, independent stream.
    assert len(result["uncompensated_flow_dynamics"]) == 12
    for stream in SPATIAL_STREAMS:
        if stream != "compensated_flow_median_magnitude":
            continue
        assert result["spatial_distribution"][stream]["argmax"]["available_pair_count"] == 0
        assert result["spatial_distribution"][stream]["centroid"]["available_pair_count"] == 0


async def test_full_pipeline_produces_bounded_fixed_size_output(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(5)]
    with patch.object(local_motion_dynamics_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_shot_local_motion_dynamics(str(video_path), 0.0, 10.0, sampling_fps=5.0)

    assert result["insufficient_temporal_samples"] is False
    assert result["frame_pair_count"] == 4
    assert len(result["residual_dynamics"]) == 12
    assert len(result["uncompensated_flow_dynamics"]) == 12
    assert len(result["compensated_flow_dynamics"]) == 12
    assert set(result["spatial_distribution"].keys()) == set(SPATIAL_STREAMS)
    for stream_data in result["spatial_distribution"].values():
        assert set(stream_data.keys()) == {"argmax", "centroid", "total_weight"}
    # Boundedness: output size never grows with frame_pair_count -- always exactly 12 cells,
    # 4 streams, fixed field sets.
    for cell in result["residual_dynamics"]:
        assert set(cell.keys()) == {"row", "col", "mean", "p95", "max"}
        for stat in ("mean", "p95", "max"):
            assert "value_positive_count" not in cell[stat]


async def test_no_raw_sequence_persisted_anywhere_in_output(tmp_path):
    """Structural sweep: no field anywhere in the returned dict is a per-pair-length list (the
    only lists allowed are the fixed 12-cell grids and the fixed-length tied_cells list, which
    this check whitelists by name)."""
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(6)]
    with patch.object(local_motion_dynamics_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_shot_local_motion_dynamics(str(video_path), 0.0, 10.0, sampling_fps=5.0)

    def _walk(obj, path=""):
        if isinstance(obj, list):
            assert len(obj) <= 12, f"unexpectedly long list at {path} (len={len(obj)}) -- possible persisted sequence"
            for i, item in enumerate(obj):
                _walk(item, f"{path}[{i}]")
        elif isinstance(obj, dict):
            for k, v in obj.items():
                _walk(v, f"{path}.{k}")

    _walk(result)


async def test_temp_directory_removed_after_successful_run(tmp_path):
    import os
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(3)]
    captured_tmp_dirs = []

    def _spy_extract(ffmpeg_bin, video_path_, start, end, fps, tmp_dir):
        captured_tmp_dirs.append(tmp_dir)
        return frames

    with patch.object(local_motion_dynamics_svc, "_extract_grayscale_frames_sync", side_effect=_spy_extract):
        await measure_shot_local_motion_dynamics(str(video_path), 0.0, 10.0)

    assert len(captured_tmp_dirs) == 1
    assert not os.path.exists(captured_tmp_dirs[0])


def test_default_sampling_fps_matches_d1_single_source_of_truth():
    from app.services import local_motion_evidence_svc
    assert local_motion_dynamics_svc.DEFAULT_SAMPLING_FPS == local_motion_evidence_svc.DEFAULT_SAMPLING_FPS == 5.0


# ---------------------------------------------------------------------------
# No semantic labels, no thresholds.
# ---------------------------------------------------------------------------

async def test_no_camera_motion_or_animation_labels_in_actual_output(tmp_path):
    """Scans the actual STRUCTURED RETURN VALUE of a full pipeline run, not prose — the module's
    own docstrings legitimately discuss (in order to disclaim) exactly these words, the same
    convention already established for B1/C1/D1's own equivalent tests."""
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(4)]
    with patch.object(local_motion_dynamics_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_shot_local_motion_dynamics(str(video_path), 0.0, 10.0, sampling_fps=5.0)
    dumped = str(result).lower()
    for forbidden in ("object trajectory", "object path", "tracked object", "animation", "ease-in", "ease-out",
                       "constant velocity", "oscillation", "screen movement", "person movement",
                       "camera movement", "active cell", "important motion", "motion confidence",
                       "centroid confidence", "reliability score", "static", "handheld", "shake"):
        assert forbidden not in dumped


def test_no_thresholds_in_dynamics_helper_signatures():
    """Structural sweep of the helper functions' own field vectors -- no field name anywhere
    implies a threshold/cutoff/confidence concept."""
    sample = _magnitude_dynamics([0.1, 0.2])
    for key in sample:
        assert "threshold" not in key and "confidence" not in key and "score" not in key
