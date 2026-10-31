"""Video Deconstructor — Stage 9 (Motion / Camera / Transitions / Animation), Phase D1: LOCAL
MOTION EVIDENCE. Pure input (a video file path + one Shot's own [start_time, end_time] window) ->
output (a plain MEASURED-evidence dict) function — no SQLAlchemy, no VideoAnalysis/ReferenceVideo/
Shot ORM awareness, no database access, no router, no frontend dependency. A peer of
visual_motion_svc.py (Phase A/C1) and transition_evidence_svc.py (B1) — reuses Phase A's own
`_affine_pair` / `_extract_grayscale_frames_sync` / `_boundary_safe_window` pure functions
unmodified, never redefining a second, incompatible global-motion estimator.

WHAT THIS MODULE ANSWERS (and does NOT answer) — see the Stage-9 Phase D0/D0.1/D0.2/D0.3
read-only inspection/experiment series this module implements: "what spatial pixel-residual and
sparse-feature-displacement evidence remains within a shot's own frame, after compensating for
the shot's own global (whole-frame) affine motion?" It NEVER answers "what object moved", "was
this animation", "was this a person/screen/camera pan" — every one of those remains an explicitly
deferred INFERRED question for a future Stage-9 phase. This module produces ZERO labels of any
kind (no "moving", "static", "active", "important", "animation", "object").

EVIDENCE ARCHITECTURE (per the Phase D0-D0.3 experiments' own real findings — see the external
`stage9-validation-corpus/d0{1,2,3}_*_experiment/report.md` files for the full evidence):
  - Sampling: a modest FIXED rate (DEFAULT_SAMPLING_FPS) — an ENGINEERING DEFAULT, NOT claimed
    semantically optimal. D0.1/D0.2 both found real sampling-rate sensitivity this project does
    not yet have enough real-world evidence to resolve into one "correct" rate; always recorded
    explicitly as measurement metadata, never a silent/implicit choice.
  - Global affine compensation: reuses `_affine_pair` verbatim (Phase A's own estimator) — no
    second, incompatible definition of "global motion" exists anywhere in this codebase. The
    matrix is reconstructed EXACTLY (see `_reconstruct_affine_matrix`) from `_affine_pair`'s own
    decomposed `{scale, rotation_deg, translation_x, translation_y}` output — mathematically
    exact for this 4-DOF similarity transform, never an approximation (validated throughout the
    D0.1-D0.3 experiment series).
  - Valid-overlap mask: the D0.1-validated purely GEOMETRIC mask (an all-255 mask warped forward
    with the SAME matrix, nearest-neighbor interpolation, no threshold) — pixels/features with no
    real corresponding source pixel after the warp never contribute to compensated evidence.
  - Fixed 3x4 spatial grid: content-independent, object-independent, detector-independent — the
    exact geometry the whole D0 experiment series validated. Row-major order, index = row *
    GRID_COLS + col (see `_grid_cell_bounds`'s own docstring).
  - Residual statistic vector: mean/p95/max ONLY — the exact, evidence-selected D0.3 vector.
    median/p75/p90/p99/standard_deviation/top-k%-mean were evaluated and explicitly REJECTED (see
    the D0.3 experiment's own external report) as either blind to realistic local/embedded change
    (median/p75/p90 stayed exactly 0.0 on both a real and a synthetic corpus) or redundant with
    this smaller vector (std/top-k%-mean correlated 0.93-0.99 with mean/p95 on the same data).
  - Sparse optical flow (goodFeaturesToTrack + calcOpticalFlowPyrLK), BOTH uncompensated (on the
    original consecutive frames) and compensated (on the frame already warped into the
    destination's own coordinate space, restricted to the valid-overlap region) — D0.2's own
    finding that these are genuinely complementary, PARALLEL measurements, never "better/worse"
    or "trusted/untrusted" relative to each other or to the residual grid.
  - Temporal aggregation kept explicitly SEPARATE from spatial aggregation (D0.3's own concrete
    finding: pooling raw pixel values across pairs before computing a percentile is NOT the same
    computation as aggregating already-computed per-pair statistics, and can catastrophically
    dilute a real, transient signal — D0.3 measured a real cell where the pooled-then-percentile
    P95 was exactly 0.0 while the temporal-mean-of-per-pair-P95 was 0.0017). Every persisted
    number here is a temporal aggregate OF an already-computed per-pair, per-cell statistic,
    never a statistic recomputed over pixels/features pooled across pairs.
  - Transient frames only: identical `tempfile.TemporaryDirectory()` discipline to Phase A/B1 —
    no Asset, no ShotFrame, no per-pair/per-pixel/per-feature record ever outlives one
    `measure_shot_local_motion` call; only this function's own bounded, fixed-size aggregate dict
    is returned to the caller.

FEATURE-DENSITY AND LOW-TEXTURE LIMITATIONS (both carried forward from D0.2, NOT fixed here — see
this phase's own explicit instruction not to attempt to "fix" them): a cell with zero tracked
points means NO USABLE TRACKED-FEATURE EVIDENCE WAS OBTAINED THERE — it does NOT mean no motion
occurred (a flat, low-texture region offers `goodFeaturesToTrack` nothing to find regardless of
whether it moved). D0.2 also found that compensated sparse flow may fail to localize a low-texture
local mover under simultaneous real global motion — this module does not attempt to fix that; the
residual grid exists specifically so optical flow's own evidence never needs to be universally
reliable on its own."""
import asyncio
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np

from app.services.visual_motion_svc import (
    DEFAULT_ORB_NFEATURES, DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX, DEFAULT_RATIO_TEST_THRESHOLD,
    _affine_pair, _boundary_safe_window, _extract_grayscale_frames_sync,
)

# Separate from every other stage's own executor/singleton — see visual_motion_svc.py's own
# docstring for why functional isolation is this project's own established convention.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="local_motion")

# ENGINEERING DEFAULT — see this module's own docstring. NOT claimed semantically optimal for
# local-motion/animation evidence; a starting configuration consistent with current Stage-9
# architecture, always recorded explicitly in persisted evidence metadata.
DEFAULT_SAMPLING_FPS = 5.0

# A shot's own inset sampling window must contain at least this many extracted frames (i.e. at
# least one frame PAIR) to produce any evidence at all — same discipline as Phase A's own
# MINIMUM_ANALYZABLE_FRAMES.
MINIMUM_ANALYZABLE_FRAMES = 2

# Fixed, content-independent, object-independent, detector-independent grid — see this module's
# own docstring. Never derived from VisualObject/TextElement/persistent_visual_element/OCR/any
# ground-truth region.
GRID_ROWS = 3
GRID_COLS = 4

# D0.2's own validated engineering configuration for goodFeaturesToTrack/calcOpticalFlowPyrLK —
# algorithm configuration, not a semantic threshold. Reused verbatim, per this phase's own
# instruction not to tune parameters during production implementation.
GFTT_MAX_CORNERS = 500
GFTT_QUALITY_LEVEL = 0.01
GFTT_MIN_DISTANCE = 10
GFTT_BLOCK_SIZE = 7
LK_WIN_SIZE = (21, 21)
LK_MAX_LEVEL = 3
LK_CRITERIA = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01)


def _reconstruct_affine_matrix(affine_result: dict) -> np.ndarray:
    """Exact reconstruction of the 2x3 similarity matrix from `_affine_pair`'s own decomposed
    output — see this module's own docstring for why this is exact, not approximate."""
    theta = np.radians(affine_result["rotation_deg"])
    s = affine_result["scale"]
    tx, ty = affine_result["translation_x"], affine_result["translation_y"]
    return np.array([
        [s * np.cos(theta), -s * np.sin(theta), tx],
        [s * np.sin(theta), s * np.cos(theta), ty],
    ], dtype=np.float64)


def _valid_overlap_mask(matrix_2x3: np.ndarray, shape_hw: tuple) -> np.ndarray:
    """Purely geometric valid-overlap mask (D0.1-validated, no behavioral threshold): warp an
    all-255 mask FORWARD with the SAME matrix, nearest-neighbor interpolation (never blends
    across the border) and `BORDER_CONSTANT=0`. `valid = warped_mask > 0`."""
    h, w = shape_hw
    ones = np.full((h, w), 255, dtype=np.uint8)
    return cv2.warpAffine(ones, matrix_2x3, (w, h), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def _grid_cell_bounds(shape_hw: tuple) -> list[dict]:
    """Fixed 3x4 grid cell pixel bounds, ROW-MAJOR order (index = row * GRID_COLS + col: r0c0,
    r0c1, r0c2, r0c3, r1c0, r1c1, r1c2, r1c3, r2c0, r2c1, r2c2, r2c3) — the one ordering
    convention used consistently across this service, the router, the schema, and every test."""
    h, w = shape_hw
    cells = []
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            y0, y1 = int(h * row / GRID_ROWS), int(h * (row + 1) / GRID_ROWS)
            x0, x1 = int(w * col / GRID_COLS), int(w * (col + 1) / GRID_COLS)
            cells.append({"row": row, "col": col, "y0": y0, "y1": y1, "x0": x0, "x1": x1})
    return cells


def _residual_pair_grid(diff: np.ndarray, mask: np.ndarray, cell_bounds: list[dict]) -> list[dict]:
    """The D0.3-approved bounded statistic vector — mean/p95/max ONLY. `None` (never a fabricated
    0.0) for a cell with zero valid-overlap pixels."""
    grid = []
    for cell in cell_bounds:
        region_diff = diff[cell["y0"]:cell["y1"], cell["x0"]:cell["x1"]]
        region_mask = mask[cell["y0"]:cell["y1"], cell["x0"]:cell["x1"]]
        vals = region_diff[region_mask > 0]
        if vals.size == 0:
            grid.append({"row": cell["row"], "col": cell["col"], "mean": None, "p95": None, "max": None})
        else:
            grid.append({
                "row": cell["row"], "col": cell["col"],
                "mean": float(np.mean(vals)),
                "p95": float(np.percentile(vals, 95, method="linear")),
                "max": float(np.max(vals)),
            })
    return grid


def _track_flow(src_frame: np.ndarray, dst_frame: np.ndarray, feature_mask: np.ndarray | None = None) -> list[dict]:
    """`goodFeaturesToTrack` + `calcOpticalFlowPyrLK` — D0.2's own validated configuration,
    reused verbatim. `feature_mask` (uint8, nonzero=eligible) restricts WHERE features may be
    initially placed — used only to exclude the geometrically-invalid valid-overlap region for
    compensated flow, never to bias toward any ground-truth or detector region."""
    pts = cv2.goodFeaturesToTrack(
        src_frame, maxCorners=GFTT_MAX_CORNERS, qualityLevel=GFTT_QUALITY_LEVEL,
        minDistance=GFTT_MIN_DISTANCE, blockSize=GFTT_BLOCK_SIZE, mask=feature_mask,
    )
    if pts is None or len(pts) == 0:
        return []
    next_pts, status, _err = cv2.calcOpticalFlowPyrLK(
        src_frame, dst_frame, pts, None, winSize=LK_WIN_SIZE, maxLevel=LK_MAX_LEVEL, criteria=LK_CRITERIA,
    )
    results = []
    for i in range(len(pts)):
        if status[i][0] == 1:
            sx, sy = pts[i][0]
            dxp, dyp = next_pts[i][0]
            results.append({
                "src_x": float(sx), "src_y": float(sy),
                "dx": float(dxp - sx), "dy": float(dyp - sy),
                "magnitude": float(np.hypot(dxp - sx, dyp - sy)),
            })
    return results


def _flow_pair_grid(points: list[dict], cell_bounds: list[dict], shape_hw: tuple) -> list[dict]:
    """Bins successfully-tracked points into the fixed grid by their own SOURCE position. A cell
    with `tracked_point_count == 0` means NO USABLE TRACKED-FEATURE EVIDENCE WAS OBTAINED THERE —
    see this module's own docstring — never a claim that no motion occurred there."""
    h, w = shape_hw
    by_cell: dict[tuple, list[dict]] = {}
    for p in points:
        row = min(GRID_ROWS - 1, int(p["src_y"] * GRID_ROWS / h))
        col = min(GRID_COLS - 1, int(p["src_x"] * GRID_COLS / w))
        by_cell.setdefault((row, col), []).append(p)

    grid = []
    for cell in cell_bounds:
        members = by_cell.get((cell["row"], cell["col"]), [])
        if not members:
            grid.append({
                "row": cell["row"], "col": cell["col"], "tracked_point_count": 0,
                "median_dx": None, "median_dy": None, "median_magnitude": None, "p95_magnitude": None,
            })
        else:
            dxs = [m["dx"] for m in members]
            dys = [m["dy"] for m in members]
            mags = [m["magnitude"] for m in members]
            grid.append({
                "row": cell["row"], "col": cell["col"], "tracked_point_count": len(members),
                "median_dx": float(np.median(dxs)), "median_dy": float(np.median(dys)),
                "median_magnitude": float(np.median(mags)),
                "p95_magnitude": float(np.percentile(mags, 95, method="linear")),
            })
    return grid


def _temporal_aggregate(values: list[float]) -> dict:
    """The temporal-aggregation rule this module uses for every NON-NEGATIVE, magnitude-type
    per-pair statistic: `temporal_mean` (identical, for the residual "mean" statistic, to pooling
    every pixel across every pair — a true mathematical identity for equal-sized groups) AND
    `temporal_max` (preserves a rare, transient real event a temporal mean alone would dilute
    away — see the D0.3 experiment's own concrete demonstration of exactly this dilution risk for
    percentile-type statistics). `None` (never fabricated) when no pair contributed a value."""
    if not values:
        return {"temporal_mean": None, "temporal_max": None}
    return {"temporal_mean": float(np.mean(values)), "temporal_max": float(np.max(values))}


def _temporal_aggregate_signed(values: list[float]) -> dict:
    """For a SIGNED per-pair statistic (dx/dy): only `temporal_mean` is reported — a "max" of a
    signed value is not the same well-defined worst-case concept it is for a non-negative
    magnitude; that worst-case information remains available via the corresponding magnitude
    statistic's own `temporal_max`."""
    if not values:
        return {"temporal_mean": None}
    return {"temporal_mean": float(np.mean(values))}


def _aggregate_residual_grid(pair_grids: list[list[dict]]) -> list[dict]:
    """`pair_grids`: one 12-cell grid per successfully-affine-compensated pair (pairs where
    affine failed are already excluded — see `measure_shot_local_motion`). Aggregates temporally
    per cell, per statistic — never pools raw pixels across pairs (see this module's own
    docstring)."""
    n_cells = GRID_ROWS * GRID_COLS
    out = []
    for idx in range(n_cells):
        row, col = divmod(idx, GRID_COLS)
        means = [g[idx]["mean"] for g in pair_grids if g[idx]["mean"] is not None]
        p95s = [g[idx]["p95"] for g in pair_grids if g[idx]["p95"] is not None]
        maxes = [g[idx]["max"] for g in pair_grids if g[idx]["max"] is not None]
        out.append({
            "row": row, "col": col,
            # mean/p95/max are always co-defined per pair per cell (same valid-pixel-set gate),
            # so any one of the three lengths above equally represents "how many pairs
            # contributed a real measurement to this cell".
            "contributing_pair_count": len(means),
            "mean": _temporal_aggregate(means),
            "p95": _temporal_aggregate(p95s),
            "max": _temporal_aggregate(maxes),
        })
    return out


def _aggregate_flow_grid(pair_grids: list[list[dict]]) -> list[dict]:
    """Same per-cell temporal-aggregation discipline as `_aggregate_residual_grid`, applied to a
    sparse-flow pair-grid sequence (uncompensated OR compensated — identical shape/logic for
    both, per this phase's own "parallel measurements" requirement)."""
    n_cells = GRID_ROWS * GRID_COLS
    out = []
    for idx in range(n_cells):
        row, col = divmod(idx, GRID_COLS)
        total_tracked = sum(g[idx]["tracked_point_count"] for g in pair_grids)
        dxs = [g[idx]["median_dx"] for g in pair_grids if g[idx]["median_dx"] is not None]
        dys = [g[idx]["median_dy"] for g in pair_grids if g[idx]["median_dy"] is not None]
        mags = [g[idx]["median_magnitude"] for g in pair_grids if g[idx]["median_magnitude"] is not None]
        p95mags = [g[idx]["p95_magnitude"] for g in pair_grids if g[idx]["p95_magnitude"] is not None]
        out.append({
            "row": row, "col": col,
            "total_tracked_point_count": total_tracked,
            # pairs where >=1 point was actually tracked in this cell (never the same as
            # frame_pair_count — see this module's own docstring on feature-density limitations).
            "contributing_pair_count": len(mags),
            "median_dx": _temporal_aggregate_signed(dxs),
            "median_dy": _temporal_aggregate_signed(dys),
            "median_magnitude": _temporal_aggregate(mags),
            "p95_magnitude": _temporal_aggregate(p95mags),
        })
    return out


def _insufficient_result(sampling_fps: float, sample_count: int) -> dict:
    return {
        "insufficient_temporal_samples": True,
        "sampling_fps": sampling_fps, "sample_count": sample_count, "frame_pair_count": 0,
        "affine_successful_pair_count": None, "affine_failed_pair_count": None, "affine_failure_reason_counts": None,
        "valid_overlap_fraction": None,
        "residual_grid": None, "uncompensated_flow_grid": None, "compensated_flow_grid": None,
    }


async def measure_shot_local_motion(
    video_path: str, start_time: float, end_time: float, *,
    sampling_fps: float = DEFAULT_SAMPLING_FPS,
    orb_nfeatures: int = DEFAULT_ORB_NFEATURES,
    ratio_threshold: float = DEFAULT_RATIO_TEST_THRESHOLD,
    ransac_threshold_px: float = DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX,
) -> dict:
    """Measures local-motion evidence for ONE shot's own [start_time, end_time] window of the
    given video file — see this module's own docstring for the full architecture (boundary
    safety, transient frames, fixed spatial grid, residual + dual sparse-flow evidence, explicit
    temporal aggregation).

    Args:
        video_path: the ORIGINAL ReferenceVideo source file's own path — this function has no
            idea where the video came from; that is entirely the caller's responsibility.
        start_time/end_time: the Shot's own boundaries, exactly as Stage 4 measured them. This
            function insets its own sampling window safely inside them (reusing Phase A's own
            `_boundary_safe_window`) — it NEVER samples on or across a shot boundary.
        sampling_fps/orb_nfeatures/ratio_threshold/ransac_threshold_px: named, documented,
            overridable parameters — never inlined magic numbers at any call site.

    Returns a plain dict — see `_insufficient_result`/the successful-path return below for the
    exact shape. Never raises for an honestly too-short or low-texture/low-feature shot; those
    are represented as `insufficient_temporal_samples=True` or per-cell `None`/zero-count
    evidence, never a fabricated non-zero result.

    Raises:
        FileNotFoundError / RuntimeError: a genuine, real failure (missing/unreadable video file,
            a real ffmpeg error) propagates as-is.
    """
    if not Path(video_path).is_file():
        raise FileNotFoundError(f"Original reference video source not found: {video_path!r}")

    import imageio_ffmpeg
    ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()

    safe_start, safe_end = _boundary_safe_window(start_time, end_time)

    loop = asyncio.get_event_loop()
    with tempfile.TemporaryDirectory(prefix="stage9_local_motion_") as tmp_dir:
        frames = await loop.run_in_executor(
            _executor, _extract_grayscale_frames_sync, ffmpeg_bin, video_path, safe_start, safe_end, sampling_fps, tmp_dir,
        )

        sample_count = len(frames)
        if sample_count < MINIMUM_ANALYZABLE_FRAMES:
            return _insufficient_result(sampling_fps, sample_count)

        shape_hw = frames[0].shape
        cell_bounds = _grid_cell_bounds(shape_hw)

        affine_successful = 0
        failure_reason_counts: dict[str, int] = {}
        valid_overlap_fractions: list[float] = []
        uncompensated_pair_grids: list[list[dict]] = []
        residual_pair_grids: list[list[dict]] = []
        compensated_pair_grids: list[list[dict]] = []

        for i in range(sample_count - 1):
            a, b = frames[i], frames[i + 1]

            # Uncompensated flow never depends on affine success — computed unconditionally, as
            # its own separate, parallel evidence stream (see this module's own docstring).
            uncompensated_points = await loop.run_in_executor(_executor, _track_flow, a, b, None)
            uncompensated_pair_grids.append(_flow_pair_grid(uncompensated_points, cell_bounds, shape_hw))

            affine = await loop.run_in_executor(
                _executor,
                lambda a=a, b=b: _affine_pair(a, b, orb_nfeatures=orb_nfeatures, ratio_threshold=ratio_threshold, ransac_threshold_px=ransac_threshold_px),
            )
            if affine["estimation_success"]:
                affine_successful += 1
                M = _reconstruct_affine_matrix(affine)
                warped_a = await loop.run_in_executor(
                    _executor,
                    lambda a=a, M=M: cv2.warpAffine(a, M, (shape_hw[1], shape_hw[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0),
                )
                mask = _valid_overlap_mask(M, shape_hw)
                valid_overlap_fractions.append(float(np.mean(mask > 0)))
                diff = cv2.absdiff(warped_a, b).astype(np.float64) / 255.0
                residual_pair_grids.append(_residual_pair_grid(diff, mask, cell_bounds))

                compensated_points = await loop.run_in_executor(_executor, _track_flow, warped_a, b, mask)
                compensated_pair_grids.append(_flow_pair_grid(compensated_points, cell_bounds, shape_hw))
            else:
                # Affine failure remains a failure — NEVER substituted with identity, NEVER
                # fabricated as compensated evidence. This pair contributes nothing to
                # residual_pair_grids/compensated_pair_grids/valid_overlap_fractions; it is
                # honestly excluded, its own reason tallied instead.
                failure_reason_counts[affine["reason"]] = failure_reason_counts.get(affine["reason"], 0) + 1

    n_pairs = sample_count - 1
    affine_failed = n_pairs - affine_successful

    return {
        "insufficient_temporal_samples": False,
        "sampling_fps": sampling_fps, "sample_count": sample_count, "frame_pair_count": n_pairs,
        "affine_successful_pair_count": affine_successful, "affine_failed_pair_count": affine_failed,
        "affine_failure_reason_counts": failure_reason_counts or None,
        "valid_overlap_fraction": (
            {"temporal_mean": float(np.mean(valid_overlap_fractions)), "temporal_min": float(np.min(valid_overlap_fractions))}
            if valid_overlap_fractions else None
        ),
        # Always the full fixed-size 12-cell grid (never collapsed to a bare None) once the shot
        # itself has enough samples — matching Phase A's own "affine" field precedent, where zero
        # successful pairs still produces a real dict with every median field None, never a None
        # field itself. Every helper below already handles an empty pair-grid list honestly
        # (contributing_pair_count=0, every statistic None) rather than requiring a special case.
        "residual_grid": _aggregate_residual_grid(residual_pair_grids),
        "uncompensated_flow_grid": _aggregate_flow_grid(uncompensated_pair_grids),
        "compensated_flow_grid": _aggregate_flow_grid(compensated_pair_grids),
    }
