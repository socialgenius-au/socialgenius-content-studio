"""Video Deconstructor — Stage 9 (Motion / Camera / Transitions / Animation), Phase A: TEMPORAL /
GLOBAL-MOTION EVIDENCE FOUNDATION. Pure input (a video file path + a shot's own [start_time,
end_time] window) -> output (a plain MEASURED-evidence dict) function — no SQLAlchemy, no
VideoAnalysis/ReferenceVideo/Shot ORM awareness, no database access, no router, no frontend
dependency. A peer of visual_object_svc.py (Phase A), visual_persistence_svc.py (Phase C1), and
visual_geometry_svc.py/visual_composition_svc.py (Composition MVP) — this module does not import
from, call, or modify any of those; Stage 8 remains untouched.

WHAT THIS MODULE ANSWERS (and does NOT answer) — see the Stage-9 Phase-0/0B read-only
inspection/experiment this module implements: "what global geometric change was MEASURED across
this shot's own analytical frame samples?" It NEVER answers "was this a pan/tilt/zoom/static
shot?" — that is an INFERRED classification explicitly deferred to a later Stage-9 phase. This
module produces zero labels of any kind (no "static", "moving", "pan", "tilt", "zoom", "shake").

EVIDENCE ARCHITECTURE (per the Phase-0B experiment's own real findings against Sameena's real
34.15s reference video):
  - Sampling: a modest FIXED rate, not adaptive — DEFAULT_SAMPLING_FPS (see its own docstring for
    exactly why this value and not another).
  - Two DELIBERATELY SEPARATE evidence streams, never averaged into one synthetic "motion score"
    (see aggregate_motion_evidence's own docstring point on this): phase correlation (cheap,
    translation-only, real per-pair "response" quality value) and ORB-feature + RANSAC-affine
    estimation (richer — scale/rotation too — but can genuinely fail on a low-texture pair, and a
    failure must never be silently reported as zero motion).
  - Masking: the Phase-0B experiment PROVED, on real footage, that excluding the union of Stage
    8's own large persistent detected regions from feature detection produced ZERO usable
    keypoints (0/89 pairs) — a strictly WORSE result than whole-frame + RANSAC's own built-in
    outlier rejection (which stayed clean, ~98% inlier ratio, throughout the same real footage).
    This module therefore analyzes the WHOLE frame; it does not mask, and does not import
    anything from Stage 8 to do so.
  - Transient frames only: every analytical frame this module extracts lives in one
    `tempfile.TemporaryDirectory()` for the lifetime of one `measure_shot_global_motion` call,
    guaranteed removed by that context manager's own `__exit__` on success OR any exception — no
    Asset, no ShotFrame, no JPEG/PNG ever outlives one call. Nothing here ever creates a
    persistent frame row of any kind; that decision belongs entirely to the caller (the router),
    which persists only the AGGREGATE dict this function returns, never a per-pair or per-frame
    record (see this module's own docstring on aggregate_motion_evidence for exactly why).

PHASE C1 ADDITION (MOTION DYNAMICS EVIDENCE): additive, backwards-compatible neutral statistics
computed from the SAME already-collected successful affine pairs a shot's own Phase-A aggregate
already produces -- no new sampling, no new extraction, no change to any existing field. See
aggregate_motion_evidence's own docstring for the exact new fields, the sign-change definition
(the sign of each PAIR'S OWN motion value, never a second-order delta-of-samples), and the
run-continuity rule (a failed affine pair breaks temporal adjacency for sign-change purposes --
two successful pairs on either side of a failure are never treated as consecutive). Explicitly
NOT implemented here, per this phase's own scope correction: no scale/rotation-driven translation
"correction" or "compensation" of any kind -- Phase C0 identified the coupling effect, but any
future correction would need the full affine transform, not a scale-only approximation; C1
reports the raw dynamics only. Still zero classification: no STATIC/PAN/TILT/ZOOM/ROTATION/
HANDHELD/MIXED label, no Shot.camera_movement write, no new threshold, still `certainty=
"MEASURED"`, still `produced_by_pass="global_motion_evidence_v1"` (an additive field set, not a
new pass version).

BOUNDARY SAFETY (the reason the caller must pass the SHOT's own start_time/end_time, never a
whole-video span): FFmpeg's own timestamp seeking can be imprecise by a small fraction of a
second, and this project's own real reference video has a real, sharp hard cut at ~30.100s (Shot
141 ends there, Shot 142 begins there) — a naive extraction spanning exactly [start_time,
end_time] risks a boundary-adjacent frame landing on the WRONG side of that cut, which would
corrupt this module's own within-shot motion measurement with what is actually cross-shot
discontinuity, not camera motion. This module therefore insets its own sampling window
symmetrically by a small safety margin (see BOUNDARY_SAFETY_FRACTION/BOUNDARY_SAFETY_MAX_SECONDS
below) before ever calling ffmpeg — the same order-of-magnitude epsilon-inset principle Stage 5's
own `plan_representative_frame_timestamps` already established for the identical reason (a sample
must land safely inside its own shot, never exactly on a boundary), reimplemented here as this
module's own named constants rather than importing Stage 5's private ones, to keep Stage 5
(LOCKED) and Stage 9 architecturally independent."""
import asyncio
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# Separate from every other stage's own executor/singleton — see this module's own docstring for
# why functional isolation (not accidental sharing) is this project's own established convention
# for each Deconstructor stage's pure engine-call service (see visual_object_svc.py's own
# identical reasoning).
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="visual_motion")

# INITIAL PRODUCTION BASELINE — selected from the Stage-9 Phase-0B real-video benchmark, NOT a
# universal constant for every future motion-adjacent task (see this module's own docstring):
#   - 2 fps showed real instability on the real reference (one severe phase-correlation outlier,
#     435px, against a well-behaved <1px baseline at denser rates).
#   - 5 fps produced clean, temporally-consistent global estimates throughout the real footage
#     (scale/rotation pinned near 1.0/0deg with no drift; 100% affine success; inlier ratio ~0.98).
#   - 10 fps was measurably cleaner still (inlier ratio ~0.99) but added little material
#     additional evidence value for THIS foundation's own purpose (global camera-motion evidence)
#     relative to its ~2x extraction/analysis cost over 5 fps.
#   - Denser, targeted sampling (e.g. around existing Stage-4/Stage-6 evidence windows, for future
#     transition/animation work) is explicitly a SEPARATE, later capability — this constant is
#     NOT claimed sufficient for that.
DEFAULT_SAMPLING_FPS = 5.0

# Same order-of-magnitude "keep every sample safely inside its own shot, never on a boundary"
# principle Stage 5's own FRAME_EPSILON_FRACTION/FRAME_EPSILON_MAX_SECONDS already established —
# reimplemented as this module's own constants (see this module's own docstring for why, rather
# than importing Stage 5's private ones).
BOUNDARY_SAFETY_FRACTION = 0.05
BOUNDARY_SAFETY_MAX_SECONDS = 0.15

# A shot's own inset sampling window must contain at least this many extracted frames (i.e. at
# least one frame PAIR) to produce any motion evidence at all — below this, the honest result is
# "insufficient_temporal_samples", never a fabricated zero-motion measurement.
MINIMUM_ANALYZABLE_FRAMES = 2

# INITIAL EVIDENCE-EXTRACTION PARAMETERS — carried over unchanged from the Stage-9 Phase-0B real
# benchmark's own values (see visual_motion_svc.py's own module docstring and the Phase-0B
# report). NOT tuned from, or claimed universal beyond, that one real static-camera video —
# candidates for recalibration once more real footage (including genuine camera-motion examples)
# is analyzed, the same "provisional, named, versioned" spirit every prior stage's own thresholds
# were held to (e.g. visual_object_svc.DEFAULT_CONFIDENCE_THRESHOLD).
DEFAULT_ORB_NFEATURES = 500
DEFAULT_RATIO_TEST_THRESHOLD = 0.75
DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX = 3.0


def _boundary_safe_window(start_time: float, end_time: float) -> tuple[float, float]:
    """Insets [start_time, end_time] symmetrically by a small safety margin so no extracted
    frame can land on or across a real shot boundary. Returns (safe_start, safe_end); if the
    inset collapses the window to non-positive duration (a genuinely very short shot), returns
    (start_time, start_time) — a zero-duration window the caller recognizes as unanalyzable
    (see measure_shot_global_motion's own insufficient_temporal_samples handling), never a
    fabricated wider window."""
    duration = end_time - start_time
    epsilon = min(duration * BOUNDARY_SAFETY_FRACTION, BOUNDARY_SAFETY_MAX_SECONDS)
    safe_start = start_time + epsilon
    safe_end = end_time - epsilon
    if safe_end <= safe_start:
        return start_time, start_time
    return safe_start, safe_end


def _extract_grayscale_frames_sync(ffmpeg_bin: str, video_path: str, start_time: float, end_time: float, sampling_fps: float, tmp_dir: str) -> list[np.ndarray]:
    """Blocking ffmpeg extraction + grayscale load — always run via the executor. Extracts into
    `tmp_dir` (the CALLER's own TemporaryDirectory, removed by the caller regardless of outcome
    here) at a fixed fps within [start_time, end_time]. Returns frames in chronological order; an
    empty or too-short result is a normal, valid outcome for a short shot, never an error here."""
    import subprocess
    duration = end_time - start_time
    if duration <= 0:
        return []
    pattern = str(Path(tmp_dir) / "f_%06d.jpg")
    cmd = [
        ffmpeg_bin, "-y", "-ss", str(start_time), "-i", video_path, "-t", str(duration),
        "-vf", f"fps={sampling_fps}", "-qscale:v", "2", pattern,
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg extraction failed (exit {result.returncode}): {result.stderr.decode(errors='replace')[-500:]}")

    files = sorted(Path(tmp_dir).glob("f_*.jpg"))
    frames = []
    for f in files:
        img = Image.open(f).convert("L")
        frames.append(np.asarray(img, dtype=np.uint8))
    return frames


def _phase_correlation_pair(a: np.ndarray, b: np.ndarray) -> dict:
    """cv2.phaseCorrelate — frequency-domain global TRANSLATION estimate only (cannot measure
    scale/rotation — see this module's own docstring). Always succeeds numerically (no RANSAC,
    no minimum-feature-count failure mode); `response` is the library's own real correlation
    quality value, preserved verbatim, never discarded."""
    fa = a.astype(np.float32)
    fb = b.astype(np.float32)
    (dx, dy), response = cv2.phaseCorrelate(fa, fb)
    return {"dx": float(dx), "dy": float(dy), "magnitude": float((dx ** 2 + dy ** 2) ** 0.5), "response": float(response)}


def _affine_pair(
    a: np.ndarray, b: np.ndarray, *,
    orb_nfeatures: int, ratio_threshold: float, ransac_threshold_px: float,
) -> dict:
    """ORB features -> ratio-filtered brute-force matching -> estimateAffinePartial2D with
    RANSAC — the exact family the Phase-0B experiment validated against real footage. A failed
    estimate is reported honestly (estimation_success=False + a reason string) — NEVER as
    fabricated zero translation/scale/rotation, per this module's own docstring."""
    orb = cv2.ORB_create(nfeatures=orb_nfeatures)
    kp_a, des_a = orb.detectAndCompute(a, None)
    kp_b, des_b = orb.detectAndCompute(b, None)
    if des_a is None or des_b is None or len(kp_a) < 4 or len(kp_b) < 4:
        return {"estimation_success": False, "reason": "insufficient_keypoints"}

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    matches = bf.knnMatch(des_a, des_b, k=2)
    good = []
    for m_n in matches:
        if len(m_n) == 2:
            m, n = m_n
            if m.distance < ratio_threshold * n.distance:
                good.append(m)

    if len(good) < 4:
        return {"estimation_success": False, "reason": "insufficient_matches"}

    pts_a = np.float32([kp_a[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    pts_b = np.float32([kp_b[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    matrix, inliers = cv2.estimateAffinePartial2D(pts_a, pts_b, method=cv2.RANSAC, ransacReprojThreshold=ransac_threshold_px)
    if matrix is None:
        return {"estimation_success": False, "reason": "affine_estimation_failed"}

    inlier_count = int(inliers.sum()) if inliers is not None else 0
    tx, ty = float(matrix[0, 2]), float(matrix[1, 2])
    scale = float(np.sqrt(matrix[0, 0] ** 2 + matrix[1, 0] ** 2))
    rotation_deg = float(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0])))
    return {
        "estimation_success": True,
        "translation_x": tx, "translation_y": ty, "translation_magnitude": (tx ** 2 + ty ** 2) ** 0.5,
        "scale": scale, "rotation_deg": rotation_deg,
        "candidate_match_count": len(good), "ransac_inlier_count": inlier_count,
        "ransac_inlier_ratio": inlier_count / len(good) if good else 0.0,
    }


def _percentile(values: list[float], q: float) -> float:
    """Explicit, documented percentile semantics — NumPy's own 'linear' interpolation method,
    stated here rather than relying on an unstated implicit default (NumPy's own current default
    IS 'linear', but this project prefers naming it explicitly, matching its own established
    "never an unexplained magic default" discipline)."""
    return float(np.percentile(values, q, method="linear"))


# ─── Phase C1 — Motion Dynamics Evidence ─────────────────────────────────────────────────────
#
# Threshold-free neutral statistics over the SAME successful affine pairs Phase A already
# computes -- no new sampling, no scale/rotation-driven translation correction (explicitly out
# of scope, see this module's own docstring), no classification, no epsilon of any kind.
#
# MINIMUM_PAIRS_FOR_STANDARD_DEVIATION: population standard deviation of a single value is
# mathematically 0 -- but reporting that 0 would look identical to a genuinely OBSERVED zero
# spread across multiple pairs, silently hiding the fact that only one data point existed. This
# is the one place C1 withholds a value (returns None) below a minimum sample count, mirroring
# Phase A's own MINIMUM_ANALYZABLE_FRAMES precedent -- a "how much data before a statistic is
# even meaningful" rule, not a motion/stability/behavioral threshold. Median/min/max/range and
# every delta/sign count remain fully defined (and reported) even for a single successful pair.
MINIMUM_PAIRS_FOR_STANDARD_DEVIATION = 2


def _sign(x: float) -> int:
    """+1/-1/0 -- exact mathematical sign, no epsilon. Reused by every C1 sign-change count."""
    if x > 0.0:
        return 1
    if x < 0.0:
        return -1
    return 0


def _successful_runs(affine_pairs: list[dict]) -> list[list[int]]:
    """Returns every MAXIMAL contiguous run of pair-INDICES whose affine estimation succeeded --
    a failed pair always breaks a run. Two successful pairs separated by a failure are never
    treated as temporally adjacent anywhere in this module (see _axis_dynamics's own sign-change
    computation, which only ever compares consecutive indices WITHIN one run)."""
    runs: list[list[int]] = []
    current: list[int] = []
    for i, pair in enumerate(affine_pairs):
        if pair["estimation_success"]:
            current.append(i)
        else:
            if current:
                runs.append(current)
                current = []
    if current:
        runs.append(current)
    return runs


def _axis_dynamics(field: str, successes: list[dict], runs: list[list[int]], success_by_index: dict[int, dict]) -> dict:
    """Neutral dynamics for one signed per-pair field (translation_x, translation_y, or
    rotation_deg -- each is already itself a per-pair MOTION value, not a position, so its own
    sign IS the motion-direction fact this exists to report).

    `sign_change_count` counts adjacents WITHIN successful runs only (see _successful_runs) whose
    signs differ -- e.g. tx values [-2, -1, +1, +2, -1] (all one contiguous successful run) ->
    2 sign changes, exactly the worked example this phase's own spec gives. A value of exactly
    0.0 neither starts nor breaks a sign comparison (matching this project's own established
    zero-handling convention, e.g. transition_evidence_svc's own luminance sign_change_count) --
    the mathematically simplest rule, no epsilon: `sign(0.0) == 0`, and a comparison only counts
    when BOTH sides are non-zero and differ.

    `positive_delta_count`/`negative_delta_count`/`zero_delta_count` tally the RAW SIGN of every
    successful pair's own value (order-independent, unlike sign_change_count) -- "delta" here
    means the per-pair motion value itself (each affine pair's own translation/rotation IS
    already a delta between two frames), never a second-order delta-of-successive-values; see
    this module's own docstring for why the two concepts must not be confused.

    `standard_deviation` is None below MINIMUM_PAIRS_FOR_STANDARD_DEVIATION successful pairs --
    never a fabricated 0 for a single observation (see that constant's own docstring)."""
    values = [p[field] for p in successes]
    n = len(values)
    sign_changes = 0
    for run in runs:
        run_values = [success_by_index[i][field] for i in run]
        for a, b in zip(run_values, run_values[1:]):
            sa, sb = _sign(a), _sign(b)
            if sa != 0 and sb != 0 and sa != sb:
                sign_changes += 1
    mn, mx = float(min(values)), float(max(values))
    return {
        "positive_delta_count": sum(1 for v in values if v > 0.0),
        "negative_delta_count": sum(1 for v in values if v < 0.0),
        "zero_delta_count": sum(1 for v in values if v == 0.0),
        "sign_change_count": sign_changes,
        "median": float(np.median(values)), "min": mn, "max": mx, "range": mx - mn,
        "standard_deviation": float(np.std(values, ddof=0)) if n >= MINIMUM_PAIRS_FOR_STANDARD_DEVIATION else None,
    }


def _scale_dynamics(successes: list[dict]) -> dict:
    """Scale has no sign concept (always > 0 by construction of sqrt(...)) -- median/min/max/
    range/standard_deviation only, per this phase's own field list."""
    values = [p["scale"] for p in successes]
    n = len(values)
    mn, mx = float(min(values)), float(max(values))
    return {
        "median": float(np.median(values)), "min": mn, "max": mx, "range": mx - mn,
        "standard_deviation": float(np.std(values, ddof=0)) if n >= MINIMUM_PAIRS_FOR_STANDARD_DEVIATION else None,
    }


def _magnitude_dynamics(successes: list[dict]) -> dict:
    """Translation magnitude has no sign concept either (always >= 0) -- median/min/max/range/
    standard_deviation/p95, reusing this module's own _percentile for the p95 (explicit 'linear'
    semantics, same discipline as every other percentile in this module)."""
    values = [p["translation_magnitude"] for p in successes]
    n = len(values)
    mn, mx = float(min(values)), float(max(values))
    return {
        "median": float(np.median(values)), "min": mn, "max": mx, "range": mx - mn,
        "standard_deviation": float(np.std(values, ddof=0)) if n >= MINIMUM_PAIRS_FOR_STANDARD_DEVIATION else None,
        "p95": _percentile(values, 95),
    }


def _cross_stream_evidence(affine_agg: dict, phase_agg: dict) -> dict:
    """Neutral, deterministic comparisons between the two independently-measured evidence
    streams -- NEVER a agreement/disagreement/trustworthy/usable/confidence boolean (see this
    phase's own scope correction). `magnitude_ratio_affine_over_phase` is None when the phase
    denominator is EXACTLY 0.0 -- no epsilon substituted. Every difference is affine-minus-phase,
    documented explicitly here and in the field names themselves."""
    affine_mag = affine_agg["median_translation_magnitude"]
    phase_mag = phase_agg["median_translation_magnitude"]
    return {
        "magnitude_absolute_difference": abs(affine_mag - phase_mag),
        "magnitude_ratio_affine_over_phase": (affine_mag / phase_mag) if phase_mag != 0.0 else None,
        "signed_dx_difference_affine_minus_phase": affine_agg["median_translation_x"] - phase_agg["median_dx"],
        "signed_dy_difference_affine_minus_phase": affine_agg["median_translation_y"] - phase_agg["median_dy"],
    }


def aggregate_motion_evidence(phase_pairs: list[dict], affine_pairs: list[dict], *, sampling_fps: float, sample_count: int) -> dict:
    """Turns per-pair phase-correlation and affine results into ONE compact, per-shot MEASURED
    evidence dict — the ONLY thing a caller should ever persist (see this module's own docstring
    for why every per-pair/per-frame value stays transient). Deliberately keeps the two evidence
    streams SEPARATE — never averaged into one synthetic "motion score": phase correlation and
    affine/RANSAC estimation measure genuinely different things (translation-only vs. full
    similarity transform) with different, non-comparable failure modes; collapsing them would
    discard exactly the distinction a later inference stage needs to reason about independently.

    `sample_count < MINIMUM_ANALYZABLE_FRAMES` sets `insufficient_temporal_samples=True` and
    every aggregate field to None — never a fabricated zero-motion result for a shot too short to
    measure at all.

    PHASE C1 ADDITION: `affine["dynamics"]` (per-axis sign/variability statistics over the same
    successful pairs, see _axis_dynamics/_scale_dynamics/_magnitude_dynamics) and a new top-level
    `cross_stream` key (neutral affine-vs-phase comparison, see _cross_stream_evidence) — both
    None whenever zero affine pairs succeeded, exactly mirroring every existing affine field's own
    None-on-zero-success convention. Nothing existing above this paragraph changed."""
    n_pairs = len(phase_pairs)  # phase_pairs and affine_pairs are always the same length (one
    # entry per consecutive frame pair — see measure_shot_global_motion's own construction)
    insufficient = sample_count < MINIMUM_ANALYZABLE_FRAMES

    if insufficient or n_pairs == 0:
        return {
            "sampling_fps": sampling_fps, "sample_count": sample_count, "frame_pair_count": n_pairs,
            "insufficient_temporal_samples": True,
            "affine": None, "phase_correlation": None, "cross_stream": None,
        }

    successes = [p for p in affine_pairs if p["estimation_success"]]
    failures = [p for p in affine_pairs if not p["estimation_success"]]
    failure_reason_counts: dict[str, int] = {}
    for f in failures:
        failure_reason_counts[f["reason"]] = failure_reason_counts.get(f["reason"], 0) + 1

    if successes:
        tx_vals = [p["translation_x"] for p in successes]
        ty_vals = [p["translation_y"] for p in successes]
        mag_vals = [p["translation_magnitude"] for p in successes]
        scale_vals = [p["scale"] for p in successes]
        rot_vals = [p["rotation_deg"] for p in successes]
        match_vals = [p["candidate_match_count"] for p in successes]
        inlier_vals = [p["ransac_inlier_count"] for p in successes]
        inlier_ratio_vals = [p["ransac_inlier_ratio"] for p in successes]
        affine_agg = {
            "successful_pair_count": len(successes), "failed_pair_count": len(failures),
            "estimation_success_rate": len(successes) / n_pairs,
            "median_translation_x": float(np.median(tx_vals)), "median_translation_y": float(np.median(ty_vals)),
            "median_translation_magnitude": float(np.median(mag_vals)), "p95_translation_magnitude": _percentile(mag_vals, 95),
            "median_scale": float(np.median(scale_vals)),
            "max_abs_scale_deviation_from_1": float(max(abs(s - 1.0) for s in scale_vals)),
            "median_rotation_deg": float(np.median(rot_vals)), "max_abs_rotation_deg": float(max(abs(r) for r in rot_vals)),
            "median_candidate_match_count": float(np.median(match_vals)), "median_ransac_inlier_count": float(np.median(inlier_vals)),
            "median_ransac_inlier_ratio": float(np.median(inlier_ratio_vals)),
            "failure_reason_counts": failure_reason_counts or None,
        }
        # Phase C1 — additive only, every field above this line is unchanged.
        runs = _successful_runs(affine_pairs)
        success_by_index = {i: p for i, p in enumerate(affine_pairs) if p["estimation_success"]}
        affine_agg["dynamics"] = {
            "translation_x": _axis_dynamics("translation_x", successes, runs, success_by_index),
            "translation_y": _axis_dynamics("translation_y", successes, runs, success_by_index),
            "translation_magnitude": _magnitude_dynamics(successes),
            "rotation_deg": _axis_dynamics("rotation_deg", successes, runs, success_by_index),
            "scale": _scale_dynamics(successes),
            "successful_run_count": len(runs),
            "longest_successful_run_pair_count": max((len(r) for r in runs), default=0),
        }
    else:
        affine_agg = {
            "successful_pair_count": 0, "failed_pair_count": len(failures),
            "estimation_success_rate": 0.0,
            "median_translation_x": None, "median_translation_y": None,
            "median_translation_magnitude": None, "p95_translation_magnitude": None,
            "median_scale": None, "max_abs_scale_deviation_from_1": None,
            "median_rotation_deg": None, "max_abs_rotation_deg": None,
            "median_candidate_match_count": None, "median_ransac_inlier_count": None,
            "median_ransac_inlier_ratio": None,
            "failure_reason_counts": failure_reason_counts or None,
            "dynamics": None,  # Phase C1 — no successful pair exists to compute dynamics from.
        }

    pc_dx = [p["dx"] for p in phase_pairs]
    pc_dy = [p["dy"] for p in phase_pairs]
    pc_mag = [p["magnitude"] for p in phase_pairs]
    pc_response = [p["response"] for p in phase_pairs]
    phase_agg = {
        "median_dx": float(np.median(pc_dx)), "median_dy": float(np.median(pc_dy)),
        "median_translation_magnitude": float(np.median(pc_mag)), "p95_translation_magnitude": _percentile(pc_mag, 95),
        "median_response": float(np.median(pc_response)), "minimum_response": float(min(pc_response)),
    }

    # Phase C1 — neutral affine-vs-phase comparison, None whenever affine has no successful pair
    # to compare (phase_agg is always available at this point — n_pairs > 0 is already guaranteed).
    cross_stream = _cross_stream_evidence(affine_agg, phase_agg) if successes else None

    return {
        "sampling_fps": sampling_fps, "sample_count": sample_count, "frame_pair_count": n_pairs,
        "insufficient_temporal_samples": False,
        "affine": affine_agg, "phase_correlation": phase_agg,
        "cross_stream": cross_stream,
    }


async def measure_shot_global_motion(
    video_path: str, start_time: float, end_time: float, *,
    sampling_fps: float = DEFAULT_SAMPLING_FPS,
    orb_nfeatures: int = DEFAULT_ORB_NFEATURES,
    ratio_threshold: float = DEFAULT_RATIO_TEST_THRESHOLD,
    ransac_threshold_px: float = DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX,
) -> dict:
    """Measures global (whole-frame) motion evidence for ONE shot's own [start_time, end_time]
    window of the given video file — see this module's own docstring for the full architecture
    (boundary safety, transient frames, two-stream evidence, no classification).

    Args:
        video_path: the ORIGINAL ReferenceVideo source file's own path — this function has no
            idea where the video came from or what it represents; that is entirely the caller's
            responsibility (this module never touches Stage-5 stills or any other derivative).
        start_time/end_time: the Shot's own boundaries, exactly as Stage 4 measured them. This
            function insets its own sampling window safely inside them (see
            _boundary_safe_window) — it NEVER samples on or across a shot boundary.
        sampling_fps/orb_nfeatures/ratio_threshold/ransac_threshold_px: named, documented,
            overridable parameters (see this module's own top-level constants for the real-video
            evidence behind each default) — never inlined magic numbers at any call site.

    Returns the aggregate dict described in aggregate_motion_evidence's own docstring.

    Raises:
        FileNotFoundError / RuntimeError: a genuine, real failure (missing/unreadable video file,
            a real ffmpeg error) propagates as-is — this function never catches and swallows an
            error, and never fabricates a successful-but-empty result in a failure's place. An
            honestly too-short shot is NOT a failure — see insufficient_temporal_samples.
    """
    if not Path(video_path).is_file():
        raise FileNotFoundError(f"Original reference video source not found: {video_path!r}")

    import imageio_ffmpeg
    ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()

    safe_start, safe_end = _boundary_safe_window(start_time, end_time)

    loop = asyncio.get_event_loop()
    with tempfile.TemporaryDirectory(prefix="stage9_motion_") as tmp_dir:
        try:
            frames = await loop.run_in_executor(
                _executor, _extract_grayscale_frames_sync, ffmpeg_bin, video_path, safe_start, safe_end, sampling_fps, tmp_dir,
            )
        finally:
            # Belt-and-braces: TemporaryDirectory's own __exit__ already removes tmp_dir and
            # everything in it on the way out of this `with` block, on success OR any exception
            # raised above — nothing extra is needed here, but the try/finally makes the
            # guarantee explicit and keeps this function's own control flow easy to audit.
            pass

        sample_count = len(frames)
        if sample_count < MINIMUM_ANALYZABLE_FRAMES:
            return aggregate_motion_evidence([], [], sampling_fps=sampling_fps, sample_count=sample_count)

        phase_pairs, affine_pairs = [], []
        for i in range(sample_count - 1):
            a, b = frames[i], frames[i + 1]
            phase_pairs.append(await loop.run_in_executor(_executor, _phase_correlation_pair, a, b))
            affine_pairs.append(await loop.run_in_executor(
                _executor, lambda a=a, b=b: _affine_pair(a, b, orb_nfeatures=orb_nfeatures, ratio_threshold=ratio_threshold, ransac_threshold_px=ransac_threshold_px)
            ))

    return aggregate_motion_evidence(phase_pairs, affine_pairs, sampling_fps=sampling_fps, sample_count=sample_count)
