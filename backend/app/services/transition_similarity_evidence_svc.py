"""Video Deconstructor — Stage 9 (Motion / Camera / Transitions / Animation), Phase B2:
TRANSITION SIMILARITY EVIDENCE. Pure input (a video file path + one Stage-4 shot boundary's own
timestamp, bracketed by its two adjacent Shots' own [start_time, end_time]) -> output (a plain
MEASURED-evidence dict) function — no SQLAlchemy, no VideoAnalysis/ReferenceVideo/Shot ORM
awareness, no database access, no router, no frontend dependency. A peer of
transition_evidence_svc.py (Phase B1) — this module does not import from, call, or modify B1's
own public entry point (`measure_boundary_transition_evidence`); see "REUSE, NOT SHARING" below
for exactly what IS reused.

WHAT THIS MODULE ANSWERS (and does NOT answer) — see the Stage-9 Phase B2.0/B2.2/B2.3 read-only
experiment series this module implements: "how similar is the material immediately around an
already-known Stage-4 shot boundary, using a fixed, bounded, threshold-free set of similarity
measurements?" It NEVER answers "was this a hard cut, a fade, a dissolve, a wipe, or a
crossover?", and NEVER produces a trust/quality/confidence judgment about its own measurements —
those remain explicitly deferred to a future Stage-9 phase. This module produces ZERO transition-
type labels of any kind and ZERO trust/quality/confidence fields — see
`measure_boundary_transition_similarity`'s own docstring for the exact bounded field list this
restriction applies to.

REUSE, NOT SHARING (the same B0.4A-established discipline B1 itself follows): this module performs
its OWN, completely independent frame extraction into its OWN temporary directory, every single
call — it never assumes a Phase-A frame, a B1 frame, a Stage-5 representative-frame Asset, or any
prior call's own frames still exist. What IS reused, as plain importable code (not shared state):
  - `visual_motion_svc._extract_grayscale_frames_sync` — the exact same ffmpeg single-pass
    extraction technique B1 itself already reuses, called fresh with this module's own
    start/end/fps arguments and its own temp directory.
  - `transition_evidence_svc._frame_diff_pair` — B1's own already-validated normalized mean-
    absolute-pixel-difference family (0.0 = identical, 1.0 = maximally different). This module's
    own `similarity(a, b) := 1.0 - _frame_diff_pair(a, b)` — never a new metric, never SSIM, never
    a learned model (see the B2.2/B2.3 experiment series for why this exact family was chosen).
  - `transition_evidence_svc._boundary_candidate_window` — the same boundary-centered window
    construction B1 itself uses (clipped to the two adjacent Shots' own outer edges, never any
    third Shot's own territory).
  - `transition_evidence_svc.TRANSITION_BOUNDARY_SAMPLING_FPS` / `TRANSITION_BOUNDARY_MARGIN_
    SECONDS` / `MINIMUM_ANALYZABLE_FRAMES` — B1's own already-established engineering constants,
    imported directly (single source of truth, never a duplicated literal).
None of `transition_evidence_svc.py` or `visual_motion_svc.py` is modified by this module in any
way.

EXACT LOCKED PRODUCTION VECTOR (per the B2.3 experiment's own final minimality pass — see that
phase's own report for the full evidence behind every inclusion/exclusion decision): exactly FIVE
scalar fields, no more:
  - `cross_boundary_similarity`: `similarity(first extracted frame, last extracted frame)` of the
    boundary-candidate window — B2.3's own validated scheme-independent "wide/outer" reference
    (B2.2 proved a "wide" offset-based reference and a literal "outer" window-edge reference
    converge numerically once the window has real margin — collapsed into this one field).
  - `pre_window_edge_similarity` / `post_window_edge_similarity`: mean pairwise similarity among
    the outermost up-to-3 samples on each side of the boundary (B2.0's own original internal-
    consistency diagnostic) — is the "far" material genuinely stable?
  - `pre_trigger_adjacent_similarity` / `post_trigger_adjacent_similarity`: mean pairwise
    similarity among the up-to-3 samples nearest the boundary on each side (B2.2's own NEW
    diagnostic) — is the material immediately adjacent to the trigger itself stable, independent
    of whether the window's own far edge is?
Every other quantity investigated during B2.0-B2.3 (ratio forms, difference forms, the trigger-
vs-edge gap, the offset sweep, the pairwise similarity matrix) was explicitly EXCLUDED from
production — see B2.3's own report for why each is either numerically unstable (ratio forms, on
near-zero synthetic denominators), an exact arithmetic redundancy of two already-simpler fields
(difference/gap forms), or purely experimental/recomputable evidence never meant for bounded
persistence (the sweep/matrix/raw frames). A future consumer can derive any of those at read time
from the five fields above with zero information loss.

NULL SEMANTICS: a field is `None` if and only if its own required sample subset has fewer than 2
usable samples (no pair exists to compare) — never a fabricated 0.0/1.0. A genuinely computed
exact `0.0` (maximally different) or `1.0` (identical) similarity is a real, retained measured
value, never conflated with "insufficient material". The boundary as a whole is
`insufficient_boundary_material=True` (every field `None`) using EXACTLY B1's own established
gate (`sample_count < MINIMUM_ANALYZABLE_FRAMES or not has_before or not has_after`) — reused
conceptually, not duplicated as a new threshold."""
import asyncio
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app.services.visual_motion_svc import _extract_grayscale_frames_sync
from app.services.transition_evidence_svc import (
    MINIMUM_ANALYZABLE_FRAMES, TRANSITION_BOUNDARY_MARGIN_SECONDS, TRANSITION_BOUNDARY_SAMPLING_FPS,
    _boundary_candidate_window, _frame_diff_pair,
)

# Separate from every other stage's own executor/singleton — see transition_evidence_svc.py's own
# docstring for why functional isolation is this project's own established convention.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="transition_similarity")


def _similarity(a, b) -> float:
    """`1.0 - _frame_diff_pair(a, b)` — B1's own already-validated metric family, reused
    verbatim, never reimplemented. 1.0 = identical frames, 0.0 = maximally different."""
    return 1.0 - _frame_diff_pair(a, b)


def _pairwise_mean_similarity(frames: list, idxs: list[int]) -> float | None:
    """Mean of every UNIQUE UNORDERED pairwise similarity among `frames[i] for i in idxs`
    (never a self-comparison, never a duplicated symmetric pair) — exactly the B2.2/B2.3
    experiment's own mathematics. `None` when fewer than 2 indices are given (no pair exists —
    never a fabricated value for a single sample or an empty subset)."""
    if len(idxs) < 2:
        return None
    values = []
    for i in range(len(idxs)):
        for j in range(i + 1, len(idxs)):
            values.append(_similarity(frames[idxs[i]], frames[idxs[j]]))
    return sum(values) / len(values)


def _insufficient_result(sampling_fps: float, sample_count: int, boundary_timestamp: float, window_start: float, window_end: float) -> dict:
    return {
        "insufficient_boundary_material": True,
        "sampling_fps": sampling_fps, "sample_count": sample_count,
        "boundary_timestamp": boundary_timestamp, "window_start": window_start, "window_end": window_end,
        "cross_boundary_similarity": None,
        "pre_window_edge_similarity": None, "post_window_edge_similarity": None,
        "pre_trigger_adjacent_similarity": None, "post_trigger_adjacent_similarity": None,
    }


async def measure_boundary_transition_similarity(
    video_path: str, boundary_timestamp: float, preceding_shot_start: float, following_shot_end: float, *,
    sampling_fps: float = TRANSITION_BOUNDARY_SAMPLING_FPS,
    margin_seconds: float = TRANSITION_BOUNDARY_MARGIN_SECONDS,
) -> dict:
    """Measures transition SIMILARITY evidence for ONE Stage-4 shot boundary — see this module's
    own docstring for the full architecture and the exact locked 5-field production vector.

    Args:
        video_path: the ORIGINAL ReferenceVideo source file's own path — same convention as
            `transition_evidence_svc.measure_boundary_transition_evidence`; this function never
            touches Stage-5 stills or any other derivative, and never reads B1's own frames.
        boundary_timestamp: the Stage-4-detected cut instant shared by the two adjacent Shots.
        preceding_shot_start/following_shot_end: the OUTER edges of the two Shots immediately
            adjacent to this boundary — the candidate window is clipped to these, never any third
            Shot's own territory (identical semantics to B1's own boundary window).
        sampling_fps/margin_seconds: named, documented, overridable parameters, defaulting to
            B1's own already-established engineering constants — never inlined magic numbers.

    Returns a plain dict — see `_insufficient_result`/the successful-path return below for the
    exact shape. Never raises for an honestly too-short boundary; that is represented as
    `insufficient_boundary_material=True` (every field `None`), never a fabricated measurement.

    Raises:
        FileNotFoundError / RuntimeError: a genuine, real failure (missing/unreadable video file,
            a real ffmpeg error) propagates as-is.
    """
    if not Path(video_path).is_file():
        raise FileNotFoundError(f"Original reference video source not found: {video_path!r}")

    import imageio_ffmpeg
    ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()

    window_start, window_end = _boundary_candidate_window(
        boundary_timestamp, preceding_shot_start, following_shot_end, margin_seconds,
    )

    loop = asyncio.get_event_loop()
    with tempfile.TemporaryDirectory(prefix="stage9_transition_similarity_") as tmp_dir:
        # This module's OWN extraction call, OWN temp directory — see this module's own docstring
        # ("REUSE, NOT SHARING") for why no B1/Phase-A/Stage-5 frame is ever assumed to exist here.
        frames = await loop.run_in_executor(
            _executor, _extract_grayscale_frames_sync, ffmpeg_bin, video_path, window_start, window_end, sampling_fps, tmp_dir,
        )

        sample_count = len(frames)
        timestamps = [window_start + i / sampling_fps for i in range(sample_count)]

        # EXACTLY B1's own gate (transition_evidence_svc.aggregate_transition_evidence) — reused
        # conceptually, never duplicated as a new/different threshold.
        has_before = any(t < boundary_timestamp for t in timestamps)
        has_after = any(t > boundary_timestamp for t in timestamps)
        if sample_count < MINIMUM_ANALYZABLE_FRAMES or not has_before or not has_after:
            return _insufficient_result(sampling_fps, sample_count, boundary_timestamp, window_start, window_end)

        # Boundary partition BY TIMESTAMP, never by array midpoint — identical rule to the
        # B2.2/B2.3 experiment series (`t < boundary_timestamp` -> PRE, otherwise -> POST; a
        # sample landing exactly ON the boundary timestamp is classified POST, matching the
        # experiment's own `find_boundary_index` convention exactly).
        pre_indices = [i for i, t in enumerate(timestamps) if t < boundary_timestamp]
        post_indices = [i for i, t in enumerate(timestamps) if t >= boundary_timestamp]

        cross_boundary_similarity = await loop.run_in_executor(_executor, _similarity, frames[0], frames[-1])

        pre_window_edge_idxs = pre_indices[:3]
        post_window_edge_idxs = post_indices[-3:]
        pre_trigger_adjacent_idxs = pre_indices[-3:]
        post_trigger_adjacent_idxs = post_indices[:3]

        pre_window_edge_similarity = await loop.run_in_executor(_executor, _pairwise_mean_similarity, frames, pre_window_edge_idxs)
        post_window_edge_similarity = await loop.run_in_executor(_executor, _pairwise_mean_similarity, frames, post_window_edge_idxs)
        pre_trigger_adjacent_similarity = await loop.run_in_executor(_executor, _pairwise_mean_similarity, frames, pre_trigger_adjacent_idxs)
        post_trigger_adjacent_similarity = await loop.run_in_executor(_executor, _pairwise_mean_similarity, frames, post_trigger_adjacent_idxs)

    return {
        "insufficient_boundary_material": False,
        "sampling_fps": sampling_fps, "sample_count": sample_count,
        "boundary_timestamp": boundary_timestamp, "window_start": window_start, "window_end": window_end,
        "cross_boundary_similarity": cross_boundary_similarity,
        "pre_window_edge_similarity": pre_window_edge_similarity,
        "post_window_edge_similarity": post_window_edge_similarity,
        "pre_trigger_adjacent_similarity": pre_trigger_adjacent_similarity,
        "post_trigger_adjacent_similarity": post_trigger_adjacent_similarity,
    }
