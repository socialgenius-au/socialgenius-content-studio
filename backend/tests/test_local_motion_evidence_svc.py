"""Video Deconstructor — Stage 9 Phase D1: local_motion_evidence_svc.py unit tests. Pure
input->output tests — no database, no router, no real video file (synthetic images only),
matching the isolation this module's own docstring establishes. Real-video and controlled-corpus
validation happen separately (see the Phase-D1 final report).

Covers: fixed 3x4 grid geometry/order, residual mean/p95/max, valid-overlap exclusion, affine
failure -> unavailable compensated evidence (never identity substitution), zero-vs-unavailable
distinction, flow zero-tracked-point semantics, uncompensated/compensated flow structure,
per-cell boundedness, temporal aggregation semantics (including an explicit pooling-mistake
counter-example), sampling metadata, failure counts, and a terminology/safety sweep against
accidental classification labels or thresholds.
"""
import os
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from app.services import local_motion_evidence_svc
from app.services.local_motion_evidence_svc import (
    GRID_COLS, GRID_ROWS, MINIMUM_ANALYZABLE_FRAMES, _aggregate_flow_grid, _aggregate_residual_grid,
    _flow_pair_grid, _grid_cell_bounds, _reconstruct_affine_matrix, _residual_pair_grid,
    _temporal_aggregate, _temporal_aggregate_signed, _track_flow, _valid_overlap_mask,
    measure_shot_local_motion,
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
# Fixed grid geometry / row-major order.
# ---------------------------------------------------------------------------

def test_grid_has_exactly_12_cells_row_major_order():
    cells = _grid_cell_bounds((720, 1280))
    assert len(cells) == GRID_ROWS * GRID_COLS == 12
    expected_order = [(r, c) for r in range(GRID_ROWS) for c in range(GRID_COLS)]
    assert [(cell["row"], cell["col"]) for cell in cells] == expected_order


def test_grid_cell_bounds_cover_whole_frame_without_gaps_or_overlaps():
    h, w = 720, 1280
    cells = _grid_cell_bounds((h, w))
    covered = np.zeros((h, w), dtype=np.int32)
    for cell in cells:
        covered[cell["y0"]:cell["y1"], cell["x0"]:cell["x1"]] += 1
    assert covered.min() == 1  # every pixel covered exactly once
    assert covered.max() == 1


# ---------------------------------------------------------------------------
# Residual mean/p95/max, valid-overlap exclusion, zero-vs-unavailable.
# ---------------------------------------------------------------------------

def test_residual_pair_grid_computes_mean_p95_max():
    diff = np.zeros((720, 1280), dtype=np.float64)
    diff[0:240, 0:320] = 0.5  # fill the whole r0c0 cell with a known value
    mask = np.full((720, 1280), 255, dtype=np.uint8)
    cells = _grid_cell_bounds((720, 1280))
    grid = _residual_pair_grid(diff, mask, cells)
    r0c0 = next(c for c in grid if c["row"] == 0 and c["col"] == 0)
    assert r0c0["mean"] == pytest.approx(0.5)
    assert r0c0["p95"] == pytest.approx(0.5)
    assert r0c0["max"] == pytest.approx(0.5)
    r0c1 = next(c for c in grid if c["row"] == 0 and c["col"] == 1)
    assert r0c1["mean"] == pytest.approx(0.0)


def test_residual_pair_grid_excludes_invalid_overlap_pixels():
    diff = np.full((720, 1280), 1.0, dtype=np.float64)
    mask = np.zeros((720, 1280), dtype=np.uint8)  # nothing valid anywhere
    cells = _grid_cell_bounds((720, 1280))
    grid = _residual_pair_grid(diff, mask, cells)
    for cell in grid:
        assert cell["mean"] is None and cell["p95"] is None and cell["max"] is None  # unavailable, not fabricated 0


def test_zero_measured_residual_remains_numeric_zero_not_none():
    diff = np.zeros((720, 1280), dtype=np.float64)
    mask = np.full((720, 1280), 255, dtype=np.uint8)
    cells = _grid_cell_bounds((720, 1280))
    grid = _residual_pair_grid(diff, mask, cells)
    for cell in grid:
        assert cell["mean"] == 0.0 and cell["mean"] is not None  # a genuinely observed zero


def test_valid_overlap_mask_is_purely_geometric_no_threshold():
    # A pure translation by 100px: the right 100 columns of the destination have no valid source.
    M = np.array([[1.0, 0.0, 100.0], [0.0, 1.0, 0.0]])
    mask = _valid_overlap_mask(M, (100, 200))
    assert np.all(mask[:, :100] == 0)   # first 100 columns: no valid source pixel
    assert np.all(mask[:, 100:] == 255)  # remaining columns: fully valid, no partial/blended values


# ---------------------------------------------------------------------------
# Affine failure -> unavailable compensated evidence, never identity substitution.
# ---------------------------------------------------------------------------

async def test_affine_failure_produces_no_residual_contribution_for_that_pair(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_blank_image(), _blank_image()]  # blank images -> ORB finds no keypoints -> failure
    with patch.object(local_motion_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_shot_local_motion(str(video_path), 0.0, 10.0)

    assert result["affine_successful_pair_count"] == 0
    assert result["affine_failed_pair_count"] == 1
    assert result["affine_failure_reason_counts"] == {"insufficient_keypoints": 1}
    # residual_grid still has the full fixed 12-cell shape, but every cell is honestly empty —
    # never an identity/zero substitution for the failed pair.
    assert len(result["residual_grid"]) == 12
    for cell in result["residual_grid"]:
        assert cell["contributing_pair_count"] == 0
        assert cell["mean"]["temporal_mean"] is None
        assert cell["max"]["temporal_mean"] is None
    assert result["valid_overlap_fraction"] is None
    # Uncompensated flow is UNAFFECTED by the affine failure — it's a parallel, independent stream.
    assert len(result["uncompensated_flow_grid"]) == 12


# ---------------------------------------------------------------------------
# Flow zero-tracked-point semantics.
# ---------------------------------------------------------------------------

def test_flow_pair_grid_zero_tracked_points_is_none_not_zero():
    # An empty points list (e.g. from a completely flat/featureless image pair).
    cells = _grid_cell_bounds((720, 1280))
    grid = _flow_pair_grid([], cells, (720, 1280))
    assert len(grid) == 12
    for cell in grid:
        assert cell["tracked_point_count"] == 0
        assert cell["median_dx"] is None
        assert cell["median_dy"] is None
        assert cell["median_magnitude"] is None
        assert cell["p95_magnitude"] is None  # unavailable, never a fabricated 0.0


def test_flow_pair_grid_bins_points_by_source_position():
    points = [
        {"src_x": 10.0, "src_y": 10.0, "dx": 1.0, "dy": 2.0, "magnitude": np.hypot(1.0, 2.0)},  # r0c0
        {"src_x": 1000.0, "src_y": 600.0, "dx": -3.0, "dy": 0.0, "magnitude": 3.0},  # r2c3
    ]
    cells = _grid_cell_bounds((720, 1280))
    grid = _flow_pair_grid(points, cells, (720, 1280))
    r0c0 = next(c for c in grid if c["row"] == 0 and c["col"] == 0)
    r2c3 = next(c for c in grid if c["row"] == 2 and c["col"] == 3)
    assert r0c0["tracked_point_count"] == 1
    assert r0c0["median_dx"] == pytest.approx(1.0)
    assert r2c3["tracked_point_count"] == 1
    assert r2c3["median_dy"] == pytest.approx(0.0)
    other_cells = [c for c in grid if (c["row"], c["col"]) not in [(0, 0), (2, 3)]]
    assert all(c["tracked_point_count"] == 0 for c in other_cells)


def test_track_flow_on_textured_pair_detects_features_and_status():
    a = _textured_image(seed=1)
    b = _textured_image(seed=1)  # identical -> near-zero flow, but real features should be found
    results = _track_flow(a, b)
    assert len(results) > 0
    for r in results:
        assert "src_x" in r and "src_y" in r and "dx" in r and "dy" in r and "magnitude" in r


# ---------------------------------------------------------------------------
# Temporal aggregation semantics — mean/max, and an explicit pooling-mistake counter-example.
# ---------------------------------------------------------------------------

def test_temporal_aggregate_mean_and_max():
    result = _temporal_aggregate([0.1, 0.2, 0.9])
    assert result["temporal_mean"] == pytest.approx(0.4)
    assert result["temporal_max"] == pytest.approx(0.9)


def test_temporal_aggregate_empty_is_unavailable():
    result = _temporal_aggregate([])
    assert result["temporal_mean"] is None
    assert result["temporal_max"] is None


def test_temporal_aggregate_signed_has_no_max_field():
    result = _temporal_aggregate_signed([-2.0, 3.0])
    assert result["temporal_mean"] == pytest.approx(0.5)
    assert "temporal_max" not in result


def test_pooling_across_time_is_not_the_same_as_two_stage_aggregation():
    """Explicit counter-example matching the D0.3 experiment's own real finding: pooling raw
    values from multiple pairs BEFORE computing a percentile is not the same computation as
    computing the percentile PER PAIR then aggregating those. This module always does the latter
    -- this test proves the two really do diverge for a realistic skewed distribution."""
    # Pair 1: a cell almost entirely unchanged except a small hot region -> its OWN p95 is high.
    pair1_pixels = np.concatenate([np.zeros(950), np.full(50, 0.8)])  # 5% hot
    # Pair 2: a cell that is completely unchanged -> its own p95 is exactly 0.
    pair2_pixels = np.zeros(1000)
    per_pair_p95s = [float(np.percentile(pair1_pixels, 95, method="linear")), float(np.percentile(pair2_pixels, 95, method="linear"))]
    temporal_mean_of_p95s = float(np.mean(per_pair_p95s))

    pooled = np.concatenate([pair1_pixels, pair2_pixels])
    pooled_p95 = float(np.percentile(pooled, 95, method="linear"))

    assert per_pair_p95s[0] > 0.0  # pair 1's own p95 correctly sees its own hot region
    assert temporal_mean_of_p95s != pytest.approx(pooled_p95)  # the two computations genuinely diverge
    assert temporal_mean_of_p95s > pooled_p95  # pooling diluted the transient signal


def test_aggregate_residual_grid_never_pools_pixels_across_pairs():
    cells = _grid_cell_bounds((720, 1280))
    pair1 = _residual_pair_grid(np.full((720, 1280), 0.0), np.full((720, 1280), 255, dtype=np.uint8), cells)
    # Set one cell's own diff to a known nonzero value for pair 1 only.
    diff2 = np.zeros((720, 1280))
    diff2[0:240, 0:320] = 0.6
    pair2 = _residual_pair_grid(diff2, np.full((720, 1280), 255, dtype=np.uint8), cells)
    aggregated = _aggregate_residual_grid([pair1, pair2])
    r0c0 = next(c for c in aggregated if c["row"] == 0 and c["col"] == 0)
    assert r0c0["contributing_pair_count"] == 2
    assert r0c0["mean"]["temporal_mean"] == pytest.approx(0.3)  # mean of [0.0, 0.6], not a pooled pixel stat
    assert r0c0["mean"]["temporal_max"] == pytest.approx(0.6)  # preserves the transient pair's own value


def test_aggregate_flow_grid_total_tracked_point_count_sums_across_pairs():
    cells = _grid_cell_bounds((720, 1280))
    pts_a = [{"src_x": 10.0, "src_y": 10.0, "dx": 1.0, "dy": 0.0, "magnitude": 1.0}]
    pts_b = [{"src_x": 12.0, "src_y": 12.0, "dx": 1.0, "dy": 0.0, "magnitude": 1.0}] * 3
    grids = [_flow_pair_grid(pts_a, cells, (720, 1280)), _flow_pair_grid(pts_b, cells, (720, 1280))]
    aggregated = _aggregate_flow_grid(grids)
    r0c0 = next(c for c in aggregated if c["row"] == 0 and c["col"] == 0)
    assert r0c0["total_tracked_point_count"] == 4  # 1 + 3, summed across pairs
    assert r0c0["contributing_pair_count"] == 2


# ---------------------------------------------------------------------------
# Reconstruction matrix correctness (mirrors visual_motion_svc's own extraction convention).
# ---------------------------------------------------------------------------

def test_reconstruct_affine_matrix_matches_known_transform():
    affine_result = {"scale": 1.2, "rotation_deg": 5.0, "translation_x": 3.0, "translation_y": -2.0}
    M = _reconstruct_affine_matrix(affine_result)
    assert M[0, 2] == pytest.approx(3.0)
    assert M[1, 2] == pytest.approx(-2.0)
    recovered_scale = float(np.hypot(M[0, 0], M[1, 0]))
    recovered_rotation = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
    assert recovered_scale == pytest.approx(1.2)
    assert recovered_rotation == pytest.approx(5.0)


# ---------------------------------------------------------------------------
# Full pipeline (mocked extraction) — sampling metadata, insufficient-samples, boundedness.
# ---------------------------------------------------------------------------

async def test_missing_video_file_raises_honestly():
    with pytest.raises(FileNotFoundError):
        await measure_shot_local_motion("nonexistent_path_xyz.mp4", 0.0, 10.0)


async def test_insufficient_samples_honestly_reported(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    with patch.object(local_motion_evidence_svc, "_extract_grayscale_frames_sync", return_value=[_textured_image()]):
        result = await measure_shot_local_motion(str(video_path), 30.100, 30.150)
    assert result["insufficient_temporal_samples"] is True
    assert result["residual_grid"] is None
    assert result["uncompensated_flow_grid"] is None
    assert result["compensated_flow_grid"] is None


async def test_full_pipeline_produces_bounded_fixed_size_grids(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(4)]
    with patch.object(local_motion_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_shot_local_motion(str(video_path), 0.0, 10.0, sampling_fps=5.0)

    assert result["insufficient_temporal_samples"] is False
    assert result["sampling_fps"] == 5.0
    assert result["sample_count"] == 4
    assert result["frame_pair_count"] == 3
    assert len(result["residual_grid"]) == 12
    assert len(result["uncompensated_flow_grid"]) == 12
    assert len(result["compensated_flow_grid"]) == 12
    # Boundedness: the returned structure never grows with frame_pair_count.
    for cell in result["residual_grid"]:
        assert set(cell.keys()) == {"row", "col", "contributing_pair_count", "mean", "p95", "max"}


async def test_sampling_metadata_recorded_explicitly(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(3)]
    with patch.object(local_motion_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames) as mock_extract:
        result = await measure_shot_local_motion(str(video_path), 0.0, 10.0, sampling_fps=7.5)
    assert result["sampling_fps"] == 7.5
    assert mock_extract.call_args.args[4] == 7.5  # passed through to the extraction call itself


async def test_temp_directory_removed_after_successful_run(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(3)]
    captured_tmp_dirs = []

    def _spy_extract(ffmpeg_bin, video_path_, start, end, fps, tmp_dir):
        captured_tmp_dirs.append(tmp_dir)
        return frames

    with patch.object(local_motion_evidence_svc, "_extract_grayscale_frames_sync", side_effect=_spy_extract):
        await measure_shot_local_motion(str(video_path), 0.0, 10.0)

    assert len(captured_tmp_dirs) == 1
    assert not os.path.exists(captured_tmp_dirs[0])


async def test_temp_directory_removed_even_on_extraction_failure(tmp_path):
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    captured_tmp_dirs = []

    def _failing_extract(ffmpeg_bin, video_path_, start, end, fps, tmp_dir):
        captured_tmp_dirs.append(tmp_dir)
        raise RuntimeError("simulated ffmpeg failure")

    with patch.object(local_motion_evidence_svc, "_extract_grayscale_frames_sync", side_effect=_failing_extract):
        with pytest.raises(RuntimeError):
            await measure_shot_local_motion(str(video_path), 0.0, 10.0)

    assert len(captured_tmp_dirs) == 1
    assert not os.path.exists(captured_tmp_dirs[0])


def test_default_constants_documented():
    assert local_motion_evidence_svc.DEFAULT_SAMPLING_FPS == 5.0
    assert local_motion_evidence_svc.GRID_ROWS == 3
    assert local_motion_evidence_svc.GRID_COLS == 4
    assert MINIMUM_ANALYZABLE_FRAMES == 2


# ---------------------------------------------------------------------------
# No semantic labels, no thresholds, no confidence-from-tracked-point-count.
# ---------------------------------------------------------------------------

async def test_no_camera_motion_or_animation_labels_in_actual_output(tmp_path):
    """Scans the actual STRUCTURED RETURN VALUE of a full pipeline run, not prose — the module's
    own docstrings legitimately discuss (in order to disclaim) exactly these words, the same
    convention already established for B1/C1's own equivalent tests."""
    video_path = tmp_path / "fake.mp4"
    video_path.write_bytes(b"not a real video")
    frames = [_textured_image(seed=i) for i in range(4)]
    with patch.object(local_motion_evidence_svc, "_extract_grayscale_frames_sync", return_value=frames):
        result = await measure_shot_local_motion(str(video_path), 0.0, 10.0, sampling_fps=5.0)
    dumped = str(result).lower()
    for forbidden in ("static", "pan_left", "pan_right", "tilt_up", "tilt_down", "zoom_in", "zoom_out",
                      "handheld", "shake", "animation", "slide_in", "slide_out", "fade_in", "fade_out",
                      "confidence_score", "is_moving", "motion_detected", "active_cell", "importance"):
        assert forbidden not in dumped


def test_no_median_p75_p90_p99_stddev_topk_in_production_residual_vector():
    """D0.3 explicitly rejected median/p75/p90/p99/standard_deviation/top-k%-mean from the
    production vector -- confirm none of them leaked into the actual persisted cell shape."""
    diff = np.full((720, 1280), 0.3, dtype=np.float64)
    mask = np.full((720, 1280), 255, dtype=np.uint8)
    cells = _grid_cell_bounds((720, 1280))
    grid = _residual_pair_grid(diff, mask, cells)
    for cell in grid:
        assert set(cell.keys()) == {"row", "col", "mean", "p95", "max"}
