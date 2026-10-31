"""Video Deconstructor — Stage 9 (Motion / Camera / Transitions / Animation), Phase B1:
BOUNDARY-TRIGGERED TRANSITION EVIDENCE MVP. Pure input (a video file path + one Stage-4 shot
boundary's own timestamp, bracketed by its two adjacent Shots' own [start_time, end_time]) ->
output (a plain MEASURED-evidence dict) function — no SQLAlchemy, no VideoAnalysis/ReferenceVideo/
Shot ORM awareness, no database access, no router, no frontend dependency. A peer of
visual_motion_svc.py (Phase A) — this module does not import from, call, or modify that module's
own public entry point (measure_shot_global_motion); see "REUSE, NOT SHARING" below for exactly
what IS reused.

WHAT THIS MODULE ANSWERS (and does NOT answer) — see the Stage-9 Phase B0.3/B0.4/B0.4A read-only
benchmark/design work this module implements: "what did the luminance/frame-difference/affine/
phase-correlation evidence look like in the short window immediately around one already-detected
Stage-4 shot boundary?" It NEVER answers "was this a hard cut, a fade, a dissolve, or a dip-to-
black?" — that is an INFERRED classification explicitly deferred to a future Stage-9 phase. This
module produces ZERO transition-type labels of any kind (no "hard_cut", "fade", "dissolve",
"dip_to_black", "soft_cut") and zero interpreted-shape fields (no "isolated_spike",
"sustained_plateau", "declining", "monotonic_enough" — see aggregate_transition_evidence's own
docstring for the neutral, threshold-free fields used instead, per the B0.4A design correction).

CANDIDATE SOURCE — THIS INCREMENT ONLY (per the B1 spec's own explicit scope limitation): every
candidate window this module measures comes from an EXISTING Stage-4 shot boundary (the shared
instant between two already-persisted, adjacent Shot rows) — supplied entirely by the caller
(the router), which reads already-detected Shot boundaries and never asks this module (or Stage 4
itself) to detect anything. This module has NO independent coarse-scan capability of its own; a
gradual transition Stage 4 never flagged as a boundary is INVISIBLE to this increment. This is a
deliberate, explicitly stated MVP limitation (see B0.4A section 9/10), not an oversight — a future
increment may add a second, boundary-independent candidate source without changing anything in
this module's own boundary-triggered measurement logic.

REUSE, NOT SHARING (the B0.4A correction this module exists to satisfy): Phase A's own
`measure_shot_global_motion` extracts frames into ONE `tempfile.TemporaryDirectory()` for the
lifetime of that ONE call, guaranteed removed on return — by the time any other pass (including
this one) could run, those frames are already gone. This module therefore performs its OWN,
completely independent extraction into its OWN temporary directory, every single call — it never
assumes a Phase-A frame, a Stage-5 representative-frame Asset, or any prior transition-evidence
call's own frames still exist. What IS reused, as plain importable code (not shared state):
  - `visual_motion_svc._extract_grayscale_frames_sync` — the exact same ffmpeg single-pass
    extraction technique, called fresh with this module's own start/end/fps arguments and its own
    temp directory.
  - `visual_motion_svc._phase_correlation_pair` / `visual_motion_svc._affine_pair` — the exact
    same phase-correlation and ORB+RANSAC-affine pure functions, unmodified, called on this
    module's own freshly-extracted frame pairs.
  - `ffmpeg_svc.FRAME_BLACK_LUMINANCE_THRESHOLD` — Stage 5's own already-validated black-frame
    luminance cutoff, imported as a plain constant (never a Stage-5 function call) — this does NOT
    create a Stage-5 pass-completion dependency; see the router's own docstring for why this
    pass's sole analytical prerequisite remains Stage 4 alone.
None of visual_motion_svc.py or ffmpeg_svc.py is modified by this module in any way.

NEUTRAL, THRESHOLD-FREE MEASUREMENT ONLY (the B0.4A design correction's central rule): every field
this module computes is either a raw per-frame/per-pair value, or a deterministic mathematical
summary whose definition requires no magnitude cutoff (a slope, a min/max, an exact sign-count, an
index of a maximum) — see aggregate_transition_evidence's own docstring for the full field list
and exactly why each one qualifies. No "elevated", "near-zero", "sustained", "monotonic-enough", or
general phase-correlation "usable" concept exists anywhere in this module — the ONE narrow,
exact-value exception (an already-established black-frame flag combined with an exact
`response == 0.0`) is documented on `_phase_quality_issue` below.

BOUNDARY WINDOW — AN EXECUTION PARAMETER, NOT A TRANSITION-DURATION CLAIM: TRANSITION_BOUNDARY_
MARGIN_SECONDS below is the smallest deterministic margin chosen to reliably obtain multiple
10fps samples on BOTH sides of a boundary for measurement purposes; it is explicitly NOT a claim
that every (or any) real transition lasts this long — see this constant's own docstring."""
import asyncio
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from app.services.ffmpeg_svc import FRAME_BLACK_LUMINANCE_THRESHOLD
from app.services.visual_motion_svc import (
    DEFAULT_ORB_NFEATURES, DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX, DEFAULT_RATIO_TEST_THRESHOLD,
    _affine_pair, _extract_grayscale_frames_sync, _phase_correlation_pair,
)

# Separate from every other stage's own executor/singleton — see visual_motion_svc.py's own
# docstring for why functional isolation (not accidental sharing) is this project's own
# established convention for each Deconstructor stage's pure engine-call service.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="transition_evidence")

# INITIAL EVIDENCE-BACKED RATE — from the Stage-9 Phase B0.3 controlled benchmark (10fps
# materially improved transition-shape resolution over 5fps for both the fade and dissolve
# controlled clips). NOT a universal constant for every future transition-adjacent task (mirrors
# visual_motion_svc.DEFAULT_SAMPLING_FPS's own "initial production baseline, not universal" framing)
# — deliberately this module's OWN named constant, structurally independent of Phase A's own
# DEFAULT_SAMPLING_FPS even though the two values differ (5.0 vs 10.0), so the two passes can
# evolve independently without accidental coupling. Phase A's own 5fps baseline is untouched by
# this module.
TRANSITION_BOUNDARY_SAMPLING_FPS = 10.0

# ENGINEERING SAMPLING DEFAULT, NOT A TRANSITION-DURATION ASSUMPTION (per the B1 spec's own
# explicit instruction): the smallest deterministic margin, on each side of a Stage-4 boundary,
# chosen to reliably obtain several 10fps samples on BOTH sides for measurement — at 10fps, 0.5s
# yields up to 5 samples per side. This is NOT a claim that any real transition lasts 0.5s, 1.0s,
# or any other duration; it is purely an extraction-window sizing parameter, clipped (see
# _boundary_candidate_window) to never exceed the two Shots immediately adjacent to the boundary
# being measured.
TRANSITION_BOUNDARY_MARGIN_SECONDS = 0.5

# A candidate window must produce at least this many analytical frames, WITH AT LEAST ONE ON EACH
# SIDE of the boundary timestamp, to produce any evidence at all — below this, the honest result is
# "insufficient_boundary_material", never a fabricated measurement (same discipline as Phase A's
# own MINIMUM_ANALYZABLE_FRAMES / insufficient_temporal_samples).
MINIMUM_ANALYZABLE_FRAMES = 2


def _boundary_candidate_window(
    boundary_timestamp: float, preceding_shot_start: float, following_shot_end: float,
    margin_seconds: float = TRANSITION_BOUNDARY_MARGIN_SECONDS,
) -> tuple[float, float]:
    """Returns (window_start, window_end): the boundary timestamp bracketed by `margin_seconds`
    on each side, clipped to the OUTER edges of the two Shots immediately adjacent to this
    specific boundary (`preceding_shot_start` is the earlier Shot's own start_time,
    `following_shot_end` is the later Shot's own end_time) — never any third Shot's own territory,
    per the B1 spec's own "never cross unrelated boundaries" requirement. Unlike
    visual_motion_svc._boundary_safe_window (which insets AWAY from a boundary to avoid crossing
    it), this window is deliberately centered ON the boundary, since measuring across it is this
    module's entire purpose."""
    window_start = max(boundary_timestamp - margin_seconds, preceding_shot_start)
    window_end = min(boundary_timestamp + margin_seconds, following_shot_end)
    return window_start, window_end


def _frame_diff_pair(a: np.ndarray, b: np.ndarray) -> float:
    """Deterministic normalized mean-absolute-pixel-difference — the exact concept validated
    against real controlled fade/dissolve footage in Phase B0.3 (0.0 = identical frames, up to
    1.0 = maximally different 8-bit grayscale frames)."""
    return float(np.mean(np.abs(a.astype(np.int16) - b.astype(np.int16)))) / 255.0


def _luminance(a: np.ndarray) -> float:
    """Mean grayscale luminance (0-255) — see B0.4A's own reasoning for why mean (not median) is
    used: a fade is, by construction, a near-uniform whole-frame luminance shift, so mean and
    median are nearly identical for a true fade, but mean is more sensitive to a PARTIAL-frame
    darkening a median could be dominated away from."""
    return float(np.mean(a))


def _sign(x: float) -> int:
    if x > 0.0:
        return 1
    if x < 0.0:
        return -1
    return 0


def _phase_quality_issue(frame_a_is_black: bool, frame_b_is_black: bool, response: float) -> str | None:
    """The ONE narrow, exact-value diagnostic B0.4A authorizes (section 5/12): if either frame in
    a pair already meets the existing (Stage-5, reused-at-code-level) black-frame definition AND
    the phase-correlation `response` is EXACTLY the degenerate value Phase B0.3 empirically
    demonstrated (0.0 — observed as a numerically-plausible-looking but meaningless dx/dy on a
    fully-black frame), return "black_frame_zero_response". This is NOT a generalized response
    threshold — no other value of `response`, and no frame that is not already flagged black,
    ever produces a non-None result here."""
    if (frame_a_is_black or frame_b_is_black) and response == 0.0:
        return "black_frame_zero_response"
    return None


def _luminance_summary(values: list[float]) -> dict:
    """Neutral, threshold-free luminance measurements only — see this module's own docstring and
    the B0.4A design correction for why NO interpreted field (declining/rising/fade-like/
    monotonic-enough/plateau/ramp) exists here. `zero_delta_count` is EXACT numeric equality
    between consecutive samples only, never a "near-zero" tolerance band (which would require an
    unvalidated threshold). `sign_change_count` counts adjacent NON-ZERO deltas whose sign
    differs — a purely combinatorial fact, no magnitude involved. `regression_slope` is a
    deterministic ordinary-least-squares fit of luminance against sample index."""
    n = len(values)
    deltas = [values[i + 1] - values[i] for i in range(n - 1)]
    positive_delta_count = sum(1 for d in deltas if d > 0.0)
    negative_delta_count = sum(1 for d in deltas if d < 0.0)
    zero_delta_count = sum(1 for d in deltas if d == 0.0)
    sign_change_count = sum(
        1 for i in range(len(deltas) - 1)
        if _sign(deltas[i]) != 0 and _sign(deltas[i + 1]) != 0 and _sign(deltas[i]) != _sign(deltas[i + 1])
    )
    regression_slope = float(np.polyfit(range(n), values, 1)[0]) if n >= 2 else 0.0
    return {
        "values": values,
        "first_value": values[0],
        "last_value": values[-1],
        "min": min(values),
        "max": max(values),
        "signed_total_change": values[-1] - values[0],
        "regression_slope": regression_slope,
        "positive_delta_count": positive_delta_count,
        "negative_delta_count": negative_delta_count,
        "zero_delta_count": zero_delta_count,
        "sign_change_count": sign_change_count,
    }


def _frame_difference_summary(values: list[float]) -> dict:
    """Neutral, threshold-free frame-difference measurements only — no "elevated pair" concept,
    no run-length fields (deliberately omitted for this MVP per the B1 spec's own "otherwise omit
    them rather than complicate this MVP" instruction — a magnitude-free run-length definition was
    assessed as unnecessary complexity for this increment, not impossible)."""
    return {
        "values": values,
        "median": float(np.median(values)),
        "max": float(max(values)),
        "argmax_index": int(np.argmax(values)),
    }


def aggregate_transition_evidence(
    *, timestamps: list[float], luminance_values: list[float], is_black_frame_flags: list[bool],
    frame_diff_values: list[float], affine_pairs: list[dict], phase_pairs: list[dict],
    phase_quality_issues: list[str | None], sampling_fps: float, sample_count: int,
    boundary_timestamp: float, window_start: float, window_end: float,
) -> dict:
    """Turns per-frame/per-pair measurements into ONE compact, per-boundary MEASURED evidence
    dict — the ONLY thing a caller should ever persist. `insufficient_boundary_material=True`
    (every other field None/empty) whenever fewer than MINIMUM_ANALYZABLE_FRAMES samples exist, OR
    no sample falls before the boundary, OR no sample falls after it — never a fabricated
    measurement for a boundary too close to a Shot's own edge to measure honestly.

    Affine/phase-correlation evidence is preserved PER PAIR (never collapsed into a single
    aggregate the way Phase A's own global-motion evidence is) — see this module's own docstring:
    transition identity depends on temporal SHAPE, and a single failed/degenerate pair hidden
    inside a median would erase exactly the evidence a future inference layer needs. Every affine
    failure keeps its own explicit `reason` (insufficient_keypoints/insufficient_matches/
    affine_estimation_failed) — never coerced to translation=0/scale=1/rotation=0."""
    has_before = any(t < boundary_timestamp for t in timestamps)
    has_after = any(t > boundary_timestamp for t in timestamps)
    insufficient = sample_count < MINIMUM_ANALYZABLE_FRAMES or not has_before or not has_after

    if insufficient:
        return {
            "insufficient_boundary_material": True,
            "sampling_fps": sampling_fps, "sample_count": sample_count, "frame_pair_count": 0,
            "boundary_timestamp": boundary_timestamp, "window_start": window_start, "window_end": window_end,
            "sample_timestamps": [], "luminance": None, "frame_difference": None, "black_frame_flags": [],
            "affine_evidence": None, "phase_correlation_evidence": None,
        }

    successes = [p for p in affine_pairs if p["estimation_success"]]
    failures = [p for p in affine_pairs if not p["estimation_success"]]
    failure_reason_counts: dict[str, int] = {}
    for f in failures:
        failure_reason_counts[f["reason"]] = failure_reason_counts.get(f["reason"], 0) + 1

    phase_correlation_pairs = [
        {**phase_pairs[i], "phase_quality_issue": phase_quality_issues[i]}
        for i in range(len(phase_pairs))
    ]

    return {
        "insufficient_boundary_material": False,
        "sampling_fps": sampling_fps, "sample_count": sample_count, "frame_pair_count": len(affine_pairs),
        "boundary_timestamp": boundary_timestamp, "window_start": window_start, "window_end": window_end,
        "sample_timestamps": timestamps,
        "luminance": _luminance_summary(luminance_values),
        "frame_difference": _frame_difference_summary(frame_diff_values),
        "black_frame_flags": is_black_frame_flags,
        "affine_evidence": {
            "pairs": affine_pairs,
            "successful_pair_count": len(successes),
            "failed_pair_count": len(failures),
            "failure_reason_counts": failure_reason_counts or None,
        },
        "phase_correlation_evidence": {"pairs": phase_correlation_pairs},
    }


async def measure_boundary_transition_evidence(
    video_path: str, boundary_timestamp: float, preceding_shot_start: float, following_shot_end: float, *,
    sampling_fps: float = TRANSITION_BOUNDARY_SAMPLING_FPS,
    margin_seconds: float = TRANSITION_BOUNDARY_MARGIN_SECONDS,
    orb_nfeatures: int = DEFAULT_ORB_NFEATURES,
    ratio_threshold: float = DEFAULT_RATIO_TEST_THRESHOLD,
    ransac_threshold_px: float = DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX,
) -> dict:
    """Measures boundary-triggered transition evidence for ONE Stage-4 shot boundary. See this
    module's own docstring for the full architecture (own independent transient extraction, no
    frame reuse of any kind, neutral-only measurement fields, boundary-triggered candidate source
    only).

    Args:
        video_path: the ORIGINAL ReferenceVideo source file's own path — same convention as
            visual_motion_svc.measure_shot_global_motion; this function never touches Stage-5
            stills or any other derivative.
        boundary_timestamp: the Stage-4-detected cut instant shared by the two adjacent Shots
            (the earlier Shot's own end_time, equal to the later Shot's own start_time).
        preceding_shot_start/following_shot_end: the OUTER edges of the two Shots immediately
            adjacent to this boundary — the candidate window is clipped to these, never any third
            Shot's own territory.
        sampling_fps/margin_seconds/orb_nfeatures/ratio_threshold/ransac_threshold_px: named,
            documented, overridable parameters — never inlined magic numbers at any call site.

    Returns the aggregate dict described in aggregate_transition_evidence's own docstring.

    Raises:
        FileNotFoundError / RuntimeError: a genuine, real failure propagates as-is — this function
            never catches and swallows an error, and never fabricates a successful-but-empty
            result in a failure's place. Insufficient boundary material is NOT a failure — see
            insufficient_boundary_material in the returned dict.
    """
    if not Path(video_path).is_file():
        raise FileNotFoundError(f"Original reference video source not found: {video_path!r}")

    import imageio_ffmpeg
    ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()

    window_start, window_end = _boundary_candidate_window(
        boundary_timestamp, preceding_shot_start, following_shot_end, margin_seconds,
    )

    loop = asyncio.get_event_loop()
    with tempfile.TemporaryDirectory(prefix="stage9_transition_") as tmp_dir:
        # This module's OWN extraction call, OWN temp directory — see this module's own docstring
        # ("REUSE, NOT SHARING") for why no Phase-A/Stage-5 frame is ever assumed to exist here.
        frames = await loop.run_in_executor(
            _executor, _extract_grayscale_frames_sync, ffmpeg_bin, video_path, window_start, window_end, sampling_fps, tmp_dir,
        )

        sample_count = len(frames)
        # Timestamps derived the same way ffmpeg's own `-vf fps=N` extraction assigns them
        # (window_start + i / sampling_fps) — _extract_grayscale_frames_sync itself returns frames
        # only, never timestamps, so this is computed here rather than duplicating ffmpeg's own
        # internal frame-numbering logic.
        timestamps = [window_start + i / sampling_fps for i in range(sample_count)]

        has_before = any(t < boundary_timestamp for t in timestamps)
        has_after = any(t > boundary_timestamp for t in timestamps)
        if sample_count < MINIMUM_ANALYZABLE_FRAMES or not has_before or not has_after:
            return aggregate_transition_evidence(
                timestamps=timestamps, luminance_values=[], is_black_frame_flags=[], frame_diff_values=[],
                affine_pairs=[], phase_pairs=[], phase_quality_issues=[],
                sampling_fps=sampling_fps, sample_count=sample_count,
                boundary_timestamp=boundary_timestamp, window_start=window_start, window_end=window_end,
            )

        luminance_values = [_luminance(f) for f in frames]
        is_black_frame_flags = [v <= FRAME_BLACK_LUMINANCE_THRESHOLD for v in luminance_values]

        frame_diff_values: list[float] = []
        affine_pairs: list[dict] = []
        phase_pairs: list[dict] = []
        phase_quality_issues: list[str | None] = []
        for i in range(sample_count - 1):
            a, b = frames[i], frames[i + 1]
            frame_diff_values.append(await loop.run_in_executor(_executor, _frame_diff_pair, a, b))
            phase = await loop.run_in_executor(_executor, _phase_correlation_pair, a, b)
            phase_pairs.append(phase)
            phase_quality_issues.append(_phase_quality_issue(is_black_frame_flags[i], is_black_frame_flags[i + 1], phase["response"]))
            affine_pairs.append(await loop.run_in_executor(
                _executor,
                lambda a=a, b=b: _affine_pair(a, b, orb_nfeatures=orb_nfeatures, ratio_threshold=ratio_threshold, ransac_threshold_px=ransac_threshold_px),
            ))

    return aggregate_transition_evidence(
        timestamps=timestamps, luminance_values=luminance_values, is_black_frame_flags=is_black_frame_flags,
        frame_diff_values=frame_diff_values, affine_pairs=affine_pairs, phase_pairs=phase_pairs,
        phase_quality_issues=phase_quality_issues, sampling_fps=sampling_fps, sample_count=sample_count,
        boundary_timestamp=boundary_timestamp, window_start=window_start, window_end=window_end,
    )
