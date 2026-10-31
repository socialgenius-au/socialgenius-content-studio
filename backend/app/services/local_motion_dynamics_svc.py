"""Video Deconstructor — Stage 9 (Motion / Camera / Transitions / Animation), Phase D2: LOCAL
MOTION DYNAMICS. Pure input (a video file path + one Shot's own [start_time, end_time] window) ->
output (a plain MEASURED-evidence dict) function — no SQLAlchemy, no VideoAnalysis/ReferenceVideo/
Shot ORM awareness, no database access, no router, no frontend dependency. A peer of
local_motion_evidence_svc.py (Phase D1), visual_motion_svc.py (Phase A/C1), and
transition_evidence_svc.py (B1).

WHAT THIS MODULE ANSWERS (and does NOT answer) — see the Stage-9 Phase D2.0/D2.1 read-only
audit/experiment series this module implements: D1 answers "what bounded local spatial-change
evidence was measured for this shot"; THIS module answers "how did those neutral measurements
vary spatially and temporally within the shot". It NEVER answers what object moved, why it moved,
whether it was animation, whether motion was important, whether a centroid is trustworthy,
whether a cell was "active", or whether movement was camera/person/screen/text motion — every one
of those remains an explicitly deferred INFERRED question for a future Stage-9 phase. This module
produces ZERO labels of any kind (no "moving", "static", "active", "important", "animation",
"object", "trajectory", "path", "confidence", "reliability").

ARCHITECTURE (per D2.0's own audit and D2.1's own validated experiment — see the external
`stage9-validation-corpus/d2{0,1}_*` files for the full evidence):
  - SEPARATE AnalysisAnnotation category (`local_motion_dynamics`), never additive fields on the
    existing `local_motion_evidence` row — see D2.2's own design report for the full evidence-
    semantics/failure-isolation/versioning/testability reasoning behind this choice.
  - D1's own algorithms are REUSED, never reimplemented: this module imports
    `_reconstruct_affine_matrix`/`_valid_overlap_mask`/`_grid_cell_bounds`/`_residual_pair_grid`/
    `_track_flow`/`_flow_pair_grid` from `local_motion_evidence_svc` and `_affine_pair`/
    `_boundary_safe_window`/`_extract_grayscale_frames_sync` from `visual_motion_svc` directly —
    exactly the reuse pattern the D2.1 experiment (`experiment.py`) already validated end-to-end.
    D1's own `measure_shot_local_motion` is NOT called and NOT modified — D2.0's own audit found
    D1's persisted `{temporal_mean, temporal_max}` aggregate cannot reconstruct the per-pair
    dynamics this module needs, so this module reruns its own thin per-pair driving loop
    (structurally similar to D1's own orchestration, but retaining each pair's own record instead
    of immediately aggregating it away) rather than requiring a refactor of the locked D1 file.
  - Sampling: the SAME explicit engineering default as D1 (`DEFAULT_SAMPLING_FPS`, imported
    directly from `local_motion_evidence_svc` — a single source of truth, never a duplicated
    literal) — an ENGINEERING DEFAULT, NOT claimed semantically optimal (see D1's own docstring
    for why).
  - Transient per-pair record: `pair_index`, `pair_start_time_seconds`, `pair_end_time_seconds`,
    `affine_success`, `valid_overlap_fraction`, `residual_grid`, `uncompensated_flow_grid`,
    `compensated_flow_grid` — held only inside `measure_shot_local_motion_dynamics`'s own call
    for the duration of one measurement, discarded once all bounded dynamics below are computed
    from it. NEVER persisted as a sequence — see D2.2's own design report items 8/20.
  - Timestamps are DERIVED (`safe_start + pair_index / sampling_fps`), never independently
    persisted — `sampling_fps` + `frame_pair_count` already suffice for exact recomputation.
  - Per-cell temporal dynamics (residual mean/p95/max; uncompensated/compensated flow
    median_dx/median_dy/median_magnitude/p95_magnitude) — bounded first-difference/availability/
    contiguity descriptors, NEVER a persisted sequence. See `_magnitude_dynamics`/
    `_signed_dynamics`'s own docstrings for the exact value-sign vs. delta-sign distinction this
    phase's own task worked through explicitly (dx=[-2,-1,+1] vs delta_dx=[+1,+2] — NOT the same
    concept, never conflated in this module's own field names).
  - Residual mean/p95/max are NON-NEGATIVE magnitude-type statistics (a pixel-residual can never
    be negative) — this module deliberately does NOT persist `value_positive_count`/
    `value_negative_count`/`value_zero_count` for them (see `_magnitude_dynamics`); those fields
    exist ONLY for genuinely signed per-pair statistics (flow `median_dx`/`median_dy`, see
    `_signed_dynamics`).
  - Temporal standard deviation is deliberately NOT persisted in this D2 MVP vector — THIS IS A
    SCOPE DECISION, NOT AN EXPERIMENTALLY PROVEN REDUNDANCY RESULT. D0.3 tested and rejected
    SPATIAL pixel-statistic redundancy (std/top-k%-mean correlated 0.93-0.99 with mean/p95 across
    pixels within one frame pair) — a completely different question from whether a TEMPORAL
    sequence's own standard deviation (variability of an already-computed per-pair statistic
    across pairs) would be redundant with `range`/`delta_sign_change_count`. No experiment has
    tested that temporal question; omitting it here is a minimal-first-vector MVP choice, kept
    open for a future increment if a real future consumer needs it (see D2.2's own report item 34
    Category B).
  - D1's own already-persisted `residual_grid[cell].mean/p95/max.temporal_mean/temporal_max` and
    `valid_overlap_fraction` are NEVER duplicated here — this module persists ONLY the additional
    temporal-dynamics descriptors D1 does not already have.
  - Spatial-distribution dynamics (argmax cell + weighted evidence centroid, per D2.1's own
    validated Method 1/Method 2) are computed for exactly FOUR streams: residual mean, residual
    p95, residual max, and compensated-flow median magnitude — see D2.2's own report item 12 for
    why uncompensated flow and compensated-flow p95-magnitude were excluded from this MVP (no
    demonstrated distinct localization value in the D2.1 experiment). Argmax NEVER arbitrarily
    resolves a tie (`is_tie`/`tied_cells` always explicit); the weighted centroid is `None` only
    and exactly when `total_weight == 0` — no other minimum-weight rule exists anywhere in this
    module. `most_frequent_argmax_cell` is likewise `None` whenever two-or-more cells tie for
    highest per-pair-argmax frequency, or when no pair produced a uniquely-resolved argmax at all
    — never an arbitrary selection (see `_argmax_summary`'s own docstring).

CENTROID SEMANTICS (carried forward verbatim from D2.1's own report): a centroid means ONLY "the
center of the measured evidence distribution over the coarse fixed 3x4 grid" — it is NEVER an
object center, a bounding-box center, a tracked position, a pixel-accurate position, or a
keyframe coordinate. Because the underlying grid is fixed and coarse (3 rows x 4 columns), the
centroid itself is inherently coarse-grained, never pixel-accurate geometry.

LOW-WEIGHT NOISE (D2.1's own central caveat, deliberately NOT solved here): a tiny non-zero total
evidence weight can produce a large apparent centroid movement on an otherwise static shot (D2.1
measured a real `cx_range` of 0.43 on a static control at 10fps). This module does NOT suppress,
threshold, or otherwise "fix" this — it persists centroid dynamics AND total-weight dynamics
side by side (see `_total_weight_summary`) so a later inference layer can judge reliability using
raw context this module never discards. `total_weight_temporal_mean`/`_max`/`_range` are
DESCRIPTIVE ONLY — never confidence, reliability, quality, trust, or a motion-strength score.

FEATURE-DENSITY LIMITATION (carried forward from D0.2/D1, not fixed here): `tracked_point_count`
dynamics (`_feature_availability_dynamics`) describe how often/how many features were actually
found — this is NOT a confidence or motion-strength measurement; a flat, low-texture region
offers `goodFeaturesToTrack` nothing to find regardless of whether it moved.

Bounded, fixed-size output only: no per-pair sequence, no pixel residual map, no feature track, no
frame/image, no dense flow field, no object identity, no keyframe sequence is ever returned by
`measure_shot_local_motion_dynamics` — output size is always relative to the fixed 12-cell grid
and the 4 retained spatial-distribution streams, never to `frame_pair_count`."""
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
from app.services.local_motion_evidence_svc import (
    DEFAULT_SAMPLING_FPS, GRID_COLS, GRID_ROWS, MINIMUM_ANALYZABLE_FRAMES,
    _flow_pair_grid, _grid_cell_bounds, _reconstruct_affine_matrix, _residual_pair_grid,
    _track_flow, _valid_overlap_mask,
)

# Separate from every other stage's own executor/singleton — see local_motion_evidence_svc.py's
# own docstring for why functional isolation is this project's own established convention.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="local_motion_dynamics")

# The exact four spatial-distribution streams D2.1's own experiment validated as worth cross-cell
# argmax/centroid tracking for — see this module's own docstring and D2.2's own report item 12
# for why uncompensated flow and compensated-flow p95-magnitude are excluded from this MVP.
SPATIAL_STREAMS = ["residual_mean", "residual_p95", "residual_max", "compensated_flow_median_magnitude"]


def _sign(x: float) -> int:
    if x > 0:
        return 1
    if x < 0:
        return -1
    return 0


def _first_difference_sequence(sequence: list[float | None]) -> list[float | None]:
    """`deltas[i] = sequence[i+1] - sequence[i]` when BOTH are available (not None), else `None`.
    A `None` here means pair i or pair i+1 (or both) lacked this exact statistic — the gap this
    represents is never bridged by any consumer of this sequence."""
    deltas: list[float | None] = []
    for i in range(len(sequence) - 1):
        a, b = sequence[i], sequence[i + 1]
        deltas.append(b - a if (a is not None and b is not None) else None)
    return deltas


def _delta_sign_counts(deltas: list[float | None]) -> tuple[int, int, int]:
    positive = sum(1 for d in deltas if d is not None and d > 0)
    negative = sum(1 for d in deltas if d is not None and d < 0)
    zero = sum(1 for d in deltas if d is not None and d == 0)
    return positive, negative, zero


def _delta_sign_change_count(deltas: list[float | None]) -> int:
    """Counts a sign flip between temporally ADJACENT deltas ONLY — `deltas[i]` and `deltas[i+1]`
    share pair i+1 as their common pivot, so a flip can only be counted when three CONSECUTIVE
    pairs (i, i+1, i+2) all produced this exact statistic. A gap (either delta is `None`) breaks
    the comparison, never bridged. A zero delta never itself counts as a "flip" on either side
    (sign 0 is neither positive nor negative) — same first-order-sign-of-value-vs-delta discipline
    established in visual_motion_svc.py's own `_axis_dynamics` (Phase C1)."""
    count = 0
    for i in range(len(deltas) - 1):
        d0, d1 = deltas[i], deltas[i + 1]
        if d0 is None or d1 is None:
            continue
        s0, s1 = _sign(d0), _sign(d1)
        if s0 != 0 and s1 != 0 and s0 != s1:
            count += 1
    return count


def _longest_contiguous_run(availability: list[bool]) -> int:
    """Longest run of consecutive `True` entries — used both for plain value availability and for
    "real feature found" availability (see `_feature_availability_dynamics`)."""
    longest = current = 0
    for available in availability:
        if available:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest


def _magnitude_dynamics(sequence: list[float | None]) -> dict:
    """Bounded temporal dynamics for a NON-NEGATIVE per-pair statistic sequence (residual
    mean/p95/max, or flow median_magnitude/p95_magnitude). `sequence[i]` is `None` when pair i
    produced no measurement for this cell/statistic (affine failure, no valid-overlap pixels, or
    zero tracked points) — never a fabricated 0.0. Deliberately does NOT report
    `value_positive_count`/`value_negative_count`/`value_zero_count` — a magnitude-type statistic
    is always >= 0 by construction, so "sign of the value" is either universally true or
    meaningless; see `_signed_dynamics` for the genuinely signed equivalent."""
    available = [v for v in sequence if v is not None]
    deltas = _first_difference_sequence(sequence)
    delta_positive, delta_negative, delta_zero = _delta_sign_counts(deltas)
    return {
        "available_pair_count": len(available),
        "unavailable_pair_count": len(sequence) - len(available),
        "delta_positive_count": delta_positive,
        "delta_negative_count": delta_negative,
        "delta_zero_count": delta_zero,
        "delta_sign_change_count": _delta_sign_change_count(deltas),
        "range": (max(available) - min(available)) if available else None,
        "longest_contiguous_available_run": _longest_contiguous_run([v is not None for v in sequence]),
    }


def _signed_dynamics(sequence: list[float | None]) -> dict:
    """Bounded temporal dynamics for a genuinely SIGNED per-pair statistic (flow
    median_dx/median_dy). Reports BOTH the VALUE sign (was the raw measured value itself
    positive/negative/zero that pair) and the DELTA sign (did the value rise/fall/stay between
    consecutive pairs) as two clearly separate field families — these are NOT the same concept
    (e.g. dx=[-2,-1,+1] has two negative values and one positive, but its own first difference
    delta_dx=[+1,+2] is entirely positive) and are never conflated under one ambiguous name."""
    available = [v for v in sequence if v is not None]
    deltas = _first_difference_sequence(sequence)
    delta_positive, delta_negative, delta_zero = _delta_sign_counts(deltas)
    return {
        "available_pair_count": len(available),
        "unavailable_pair_count": len(sequence) - len(available),
        "value_positive_count": sum(1 for v in available if v > 0),
        "value_negative_count": sum(1 for v in available if v < 0),
        "value_zero_count": sum(1 for v in available if v == 0),
        "delta_positive_count": delta_positive,
        "delta_negative_count": delta_negative,
        "delta_zero_count": delta_zero,
        "delta_sign_change_count": _delta_sign_change_count(deltas),
        "range": (max(available) - min(available)) if available else None,
        "longest_contiguous_available_run": _longest_contiguous_run([v is not None for v in sequence]),
    }


def _feature_availability_dynamics(sequence: list[int | None]) -> dict:
    """`sequence`: per-pair `tracked_point_count` for one cell — `None` when the flow itself was
    never computed for that pair (e.g. compensated flow on an affine-failed pair), NEVER when
    zero points were legitimately tracked (which remains a measured `0`, not `None`, exactly
    D1's own zero-vs-unavailable convention). Purely descriptive — NOT confidence, reliability,
    quality, or a motion-strength measurement (see this module's own docstring)."""
    available = [v for v in sequence if v is not None]
    zero_feature_pair_count = sum(1 for v in available if v == 0)
    return {
        "tracked_point_count_temporal_mean": (sum(available) / len(available)) if available else None,
        "tracked_point_count_temporal_min": min(available) if available else None,
        "tracked_point_count_temporal_max": max(available) if available else None,
        "zero_feature_pair_count": zero_feature_pair_count,
        # "available" here means a real tracked feature was found that pair (count > 0) — a
        # stricter, more informative sense than merely "the flow computation was attempted".
        "longest_available_run": _longest_contiguous_run([v is not None and v > 0 for v in sequence]),
    }


def _extract_residual_sequence(pairs: list[dict], idx: int, stat: str) -> list[float | None]:
    """One 12-cell-indexed residual statistic ('mean'/'p95'/'max') sequence across every pair —
    `None` whenever that pair's own affine estimation failed (`residual_grid is None`) OR that
    cell had zero valid-overlap pixels for that pair (D1's own per-cell `None`) — both are
    honestly "no measurement", never conflated with a genuinely measured `0.0`."""
    return [(p["residual_grid"][idx][stat] if p["residual_grid"] is not None else None) for p in pairs]


def _extract_flow_sequence(pairs: list[dict], grid_key: str, idx: int, stat: str) -> list:
    """One 12-cell-indexed flow statistic sequence across every pair, for either
    `"uncompensated_flow_grid"` (always present — computed unconditionally every pair, per D1's
    own "parallel stream" rule) or `"compensated_flow_grid"` (`None` for the whole pair when that
    pair's own affine estimation failed — compensated flow was never even attempted)."""
    out = []
    for p in pairs:
        grid = p[grid_key]
        out.append(grid[idx][stat] if grid is not None else None)
    return out


def _cell_center_norm(row: int, col: int) -> tuple[float, float]:
    return (col + 0.5) / GRID_COLS, (row + 0.5) / GRID_ROWS


def _spatial_stream_values(pair: dict, stream: str) -> list[float | None]:
    """Extracts one 12-cell (row-major) list of non-negative values (or `None`) for a named
    spatial-distribution stream from one transient pair record — `None` mirrors the same "no
    measurement" meaning used everywhere else in this module, never a fabricated `0.0`."""
    n_cells = GRID_ROWS * GRID_COLS
    if stream == "residual_mean":
        return [c["mean"] for c in pair["residual_grid"]] if pair["residual_grid"] is not None else [None] * n_cells
    if stream == "residual_p95":
        return [c["p95"] for c in pair["residual_grid"]] if pair["residual_grid"] is not None else [None] * n_cells
    if stream == "residual_max":
        return [c["max"] for c in pair["residual_grid"]] if pair["residual_grid"] is not None else [None] * n_cells
    if stream == "compensated_flow_median_magnitude":
        return (
            [c["median_magnitude"] for c in pair["compensated_flow_grid"]]
            if pair["compensated_flow_grid"] is not None else [None] * n_cells
        )
    raise ValueError(stream)  # defensive — SPATIAL_STREAMS is the only caller-facing source of stream names


def _argmax_cell(values: list[float | None]) -> dict | None:
    """Per-pair spatial-distribution argmax — see this module's own docstring: "center of the
    measured evidence distribution", NEVER an object/tracked position. `None` when every cell is
    `None` (no measurement at all that pair). Explicit tie recording — NEVER an arbitrary winner
    (first/lowest/highest index)."""
    indexed = [(i, v) for i, v in enumerate(values) if v is not None]
    if not indexed:
        return None
    max_val = max(v for _, v in indexed)
    tied = [i for i, v in indexed if v == max_val]
    if len(tied) > 1:
        return {
            "row": None, "col": None, "value": max_val, "is_tie": True,
            "tied_cells": [list(divmod(i, GRID_COLS)) for i in tied],
        }
    row, col = divmod(tied[0], GRID_COLS)
    return {"row": row, "col": col, "value": max_val, "is_tie": False, "tied_cells": [[row, col]]}


def _weighted_centroid(values: list[float | None]) -> dict:
    """Per-pair weighted-evidence centroid over FIXED, coarse cell centers — see this module's own
    docstring: never pixel-accurate geometry, never an object/bounding-box/tracked/keyframe
    position. `total_weight == 0` (all-`None` OR all-exactly-zero) -> `cx`/`cy` = `None` — the
    ONLY exact rule; no minimum-weight threshold of any kind."""
    total_weight = 0.0
    wx = wy = 0.0
    n_available = 0
    for idx, v in enumerate(values):
        if v is None:
            continue
        n_available += 1
        row, col = divmod(idx, GRID_COLS)
        x, y = _cell_center_norm(row, col)
        wx += v * x
        wy += v * y
        total_weight += v
    if total_weight == 0.0:
        return {"cx": None, "cy": None, "total_weight": total_weight, "n_available_cells": n_available}
    return {"cx": wx / total_weight, "cy": wy / total_weight, "total_weight": total_weight, "n_available_cells": n_available}


def _argmax_summary(argmax_sequence: list[dict | None]) -> dict:
    """Bounded temporal argmax dynamics for one spatial-distribution stream. A tied pair
    contributes to `tie_count` but NEVER to `unique_argmax_cell_count`,
    `most_frequent_argmax_cell`, or `argmax_cell_change_count` — only uniquely-resolved pairs
    participate in those. `most_frequent_argmax_cell` is `None` whenever two-or-more cells tie
    for the highest per-pair frequency, or when no pair was ever uniquely resolved — never an
    arbitrary selection. `argmax_cell_change_count` only compares pairs that are BOTH temporally
    adjacent in the original pair sequence AND both uniquely resolved — a tied/unavailable pair
    breaks continuity, never bridged."""
    available_pair_count = sum(1 for a in argmax_sequence if a is not None)
    tie_count = sum(1 for a in argmax_sequence if a is not None and a["is_tie"])

    resolved_cells = [(a["row"], a["col"]) for a in argmax_sequence if a is not None and not a["is_tie"]]
    unique_argmax_cell_count = len(set(resolved_cells))

    resolved_by_index = [
        (a["row"], a["col"]) if (a is not None and not a["is_tie"]) else None
        for a in argmax_sequence
    ]
    change_count = 0
    for i in range(len(resolved_by_index) - 1):
        a, b = resolved_by_index[i], resolved_by_index[i + 1]
        if a is None or b is None:
            continue
        if a != b:
            change_count += 1

    most_frequent_cell = None
    most_frequent_count = None
    if resolved_cells:
        freq: dict[tuple, int] = {}
        for c in resolved_cells:
            freq[c] = freq.get(c, 0) + 1
        max_freq = max(freq.values())
        top_cells = [c for c, n in freq.items() if n == max_freq]
        if len(top_cells) == 1:
            most_frequent_cell = list(top_cells[0])
            most_frequent_count = max_freq

    return {
        "available_pair_count": available_pair_count,
        "tie_count": tie_count,
        "unique_argmax_cell_count": unique_argmax_cell_count,
        "argmax_cell_change_count": change_count,
        "most_frequent_argmax_cell": most_frequent_cell,
        "most_frequent_argmax_frequency_count": most_frequent_count,
    }


def _centroid_summary(centroid_sequence: list[dict]) -> dict:
    """Bounded temporal centroid dynamics. An unavailable centroid (`total_weight == 0` that
    pair) breaks continuity for displacement/delta-sign purposes — never bridged."""
    cx_seq = [c["cx"] for c in centroid_sequence]
    cy_seq = [c["cy"] for c in centroid_sequence]
    available_cx = [v for v in cx_seq if v is not None]
    available_cy = [v for v in cy_seq if v is not None]
    available_pair_count = len(available_cx)
    unavailable_pair_count = len(cx_seq) - available_pair_count

    delta_cx = _first_difference_sequence(cx_seq)
    delta_cy = _first_difference_sequence(cy_seq)
    dcx_positive, dcx_negative, dcx_zero = _delta_sign_counts(delta_cx)
    dcy_positive, dcy_negative, dcy_zero = _delta_sign_counts(delta_cy)

    displacements = []
    for i in range(len(cx_seq) - 1):
        if cx_seq[i] is None or cx_seq[i + 1] is None or cy_seq[i] is None or cy_seq[i + 1] is None:
            continue  # gap -- never bridged
        dx = cx_seq[i + 1] - cx_seq[i]
        dy = cy_seq[i + 1] - cy_seq[i]
        displacements.append(float(np.hypot(dx, dy)))

    return {
        "available_pair_count": available_pair_count,
        "unavailable_pair_count": unavailable_pair_count,
        "cx_min": min(available_cx) if available_cx else None,
        "cx_max": max(available_cx) if available_cx else None,
        "cx_range": (max(available_cx) - min(available_cx)) if available_cx else None,
        "cy_min": min(available_cy) if available_cy else None,
        "cy_max": max(available_cy) if available_cy else None,
        "cy_range": (max(available_cy) - min(available_cy)) if available_cy else None,
        "delta_cx_positive_count": dcx_positive, "delta_cx_negative_count": dcx_negative, "delta_cx_zero_count": dcx_zero,
        "delta_cx_sign_change_count": _delta_sign_change_count(delta_cx),
        "delta_cy_positive_count": dcy_positive, "delta_cy_negative_count": dcy_negative, "delta_cy_zero_count": dcy_zero,
        "delta_cy_sign_change_count": _delta_sign_change_count(delta_cy),
        "displacement_temporal_mean": (sum(displacements) / len(displacements)) if displacements else None,
        "displacement_temporal_max": max(displacements) if displacements else None,
    }


def _total_weight_summary(centroid_sequence: list[dict]) -> dict:
    """RAW DESCRIPTIVE total-evidence-weight context accompanying a centroid stream — see this
    module's own docstring on low-weight noise. NEVER a confidence/reliability/quality/trust
    score. `total_weight`/`n_available_cells` are always real numbers for every pair (0.0/0 is a
    legitimate measured value, never `None`) — this summary never has an "unavailable" case."""
    weights = [c["total_weight"] for c in centroid_sequence]
    n_available = [c["n_available_cells"] for c in centroid_sequence]
    return {
        "total_weight_temporal_mean": (sum(weights) / len(weights)) if weights else None,
        "total_weight_temporal_max": max(weights) if weights else None,
        "total_weight_range": (max(weights) - min(weights)) if weights else None,
        "available_cell_count_temporal_mean": (sum(n_available) / len(n_available)) if n_available else None,
    }


def _insufficient_result(sampling_fps: float, sample_count: int) -> dict:
    return {
        "insufficient_temporal_samples": True,
        "sampling_fps": sampling_fps, "sample_count": sample_count, "frame_pair_count": 0,
        "affine_successful_pair_count": None, "affine_failed_pair_count": None,
        "residual_dynamics": None, "uncompensated_flow_dynamics": None, "compensated_flow_dynamics": None,
        "spatial_distribution": None,
    }


async def measure_shot_local_motion_dynamics(
    video_path: str, start_time: float, end_time: float, *,
    sampling_fps: float = DEFAULT_SAMPLING_FPS,
    orb_nfeatures: int = DEFAULT_ORB_NFEATURES,
    ratio_threshold: float = DEFAULT_RATIO_TEST_THRESHOLD,
    ransac_threshold_px: float = DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX,
) -> dict:
    """Measures local-motion DYNAMICS evidence for ONE shot's own [start_time, end_time] window of
    the given video file — see this module's own docstring for the full architecture. Reuses D1's
    own algorithms verbatim (never a second implementation); reruns its own thin per-pair driving
    loop rather than reading D1's persisted aggregate (which D2.0's own audit found cannot support
    this reconstruction) or requiring any modification to the locked D1 file.

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
    are represented as `insufficient_temporal_samples=True` or per-cell/per-stream bounded
    availability counts, never a fabricated non-zero result.

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
    with tempfile.TemporaryDirectory(prefix="stage9_local_motion_dynamics_") as tmp_dir:
        frames = await loop.run_in_executor(
            _executor, _extract_grayscale_frames_sync, ffmpeg_bin, video_path, safe_start, safe_end, sampling_fps, tmp_dir,
        )

        sample_count = len(frames)
        if sample_count < MINIMUM_ANALYZABLE_FRAMES:
            return _insufficient_result(sampling_fps, sample_count)

        shape_hw = frames[0].shape
        cell_bounds = _grid_cell_bounds(shape_hw)

        # The transient, ordered per-pair record sequence — held only for the duration of this
        # call, discarded once every bounded dynamics summary below has been computed from it.
        pairs: list[dict] = []

        for i in range(sample_count - 1):
            a, b = frames[i], frames[i + 1]
            pair_start = safe_start + i / sampling_fps
            pair_end = safe_start + (i + 1) / sampling_fps

            # Uncompensated flow never depends on affine success — computed unconditionally,
            # exactly D1's own "parallel stream" rule.
            uncompensated_points = await loop.run_in_executor(_executor, _track_flow, a, b, None)
            uncompensated_grid = _flow_pair_grid(uncompensated_points, cell_bounds, shape_hw)

            affine = await loop.run_in_executor(
                _executor,
                lambda a=a, b=b: _affine_pair(a, b, orb_nfeatures=orb_nfeatures, ratio_threshold=ratio_threshold, ransac_threshold_px=ransac_threshold_px),
            )

            record = {
                "pair_index": i,
                "pair_start_time_seconds": pair_start,
                "pair_end_time_seconds": pair_end,
                "affine_success": affine["estimation_success"],
                "valid_overlap_fraction": None,
                "residual_grid": None,
                "uncompensated_flow_grid": uncompensated_grid,
                "compensated_flow_grid": None,
            }

            if affine["estimation_success"]:
                M = _reconstruct_affine_matrix(affine)
                warped_a = await loop.run_in_executor(
                    _executor,
                    lambda a=a, M=M: cv2.warpAffine(a, M, (shape_hw[1], shape_hw[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0),
                )
                mask = _valid_overlap_mask(M, shape_hw)
                record["valid_overlap_fraction"] = float(np.mean(mask > 0))
                diff = cv2.absdiff(warped_a, b).astype(np.float64) / 255.0
                record["residual_grid"] = _residual_pair_grid(diff, mask, cell_bounds)

                compensated_points = await loop.run_in_executor(_executor, _track_flow, warped_a, b, mask)
                record["compensated_flow_grid"] = _flow_pair_grid(compensated_points, cell_bounds, shape_hw)
            # else: affine failure remains a failure -- NEVER substituted with identity, NEVER
            # fabricated. residual_grid/compensated_flow_grid/valid_overlap_fraction stay None for
            # this pair, honestly excluded from every dynamics calculation that depends on them.

            pairs.append(record)

    n_pairs = sample_count - 1
    affine_successful = sum(1 for p in pairs if p["affine_success"])
    affine_failed = n_pairs - affine_successful
    n_cells = GRID_ROWS * GRID_COLS

    residual_dynamics = []
    for idx in range(n_cells):
        row, col = divmod(idx, GRID_COLS)
        residual_dynamics.append({
            "row": row, "col": col,
            "mean": _magnitude_dynamics(_extract_residual_sequence(pairs, idx, "mean")),
            "p95": _magnitude_dynamics(_extract_residual_sequence(pairs, idx, "p95")),
            "max": _magnitude_dynamics(_extract_residual_sequence(pairs, idx, "max")),
        })

    uncompensated_flow_dynamics = []
    compensated_flow_dynamics = []
    for idx in range(n_cells):
        row, col = divmod(idx, GRID_COLS)
        uncompensated_flow_dynamics.append({
            "row": row, "col": col,
            "median_dx": _signed_dynamics(_extract_flow_sequence(pairs, "uncompensated_flow_grid", idx, "median_dx")),
            "median_dy": _signed_dynamics(_extract_flow_sequence(pairs, "uncompensated_flow_grid", idx, "median_dy")),
            "median_magnitude": _magnitude_dynamics(_extract_flow_sequence(pairs, "uncompensated_flow_grid", idx, "median_magnitude")),
            "p95_magnitude": _magnitude_dynamics(_extract_flow_sequence(pairs, "uncompensated_flow_grid", idx, "p95_magnitude")),
            "feature_availability": _feature_availability_dynamics(_extract_flow_sequence(pairs, "uncompensated_flow_grid", idx, "tracked_point_count")),
        })
        compensated_flow_dynamics.append({
            "row": row, "col": col,
            "median_dx": _signed_dynamics(_extract_flow_sequence(pairs, "compensated_flow_grid", idx, "median_dx")),
            "median_dy": _signed_dynamics(_extract_flow_sequence(pairs, "compensated_flow_grid", idx, "median_dy")),
            "median_magnitude": _magnitude_dynamics(_extract_flow_sequence(pairs, "compensated_flow_grid", idx, "median_magnitude")),
            "p95_magnitude": _magnitude_dynamics(_extract_flow_sequence(pairs, "compensated_flow_grid", idx, "p95_magnitude")),
            "feature_availability": _feature_availability_dynamics(_extract_flow_sequence(pairs, "compensated_flow_grid", idx, "tracked_point_count")),
        })

    spatial_distribution = {}
    for stream in SPATIAL_STREAMS:
        argmax_seq = []
        centroid_seq = []
        for p in pairs:
            values = _spatial_stream_values(p, stream)
            argmax_seq.append(_argmax_cell(values))
            centroid_seq.append(_weighted_centroid(values))
        spatial_distribution[stream] = {
            "argmax": _argmax_summary(argmax_seq),
            "centroid": _centroid_summary(centroid_seq),
            "total_weight": _total_weight_summary(centroid_seq),
        }

    return {
        "insufficient_temporal_samples": False,
        "sampling_fps": sampling_fps,
        "sample_count": sample_count,
        "frame_pair_count": n_pairs,
        "affine_successful_pair_count": affine_successful,
        "affine_failed_pair_count": affine_failed,
        # D1's own valid_overlap_fraction aggregate is deliberately NOT duplicated here — it
        # remains uniquely and sufficiently available on the existing D1 row (see this module's
        # own docstring).
        "residual_dynamics": residual_dynamics,
        "uncompensated_flow_dynamics": uncompensated_flow_dynamics,
        "compensated_flow_dynamics": compensated_flow_dynamics,
        "spatial_distribution": spatial_distribution,
    }
