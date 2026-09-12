"""Video Deconstructor — Stage 11.1: EDITING LOGIC — DETERMINISTIC MEASUREMENTS V1.

Answers ONLY "how is this video structurally edited?" — never "why did the editor do this?" and
never "did this editing improve retention/performance?" No reasoning, no LLM/Anthropic call, no
StrategicInsight row, and no interpretive label (no "fast"/"slow", no "exciting"/"boring") is
produced anywhere in this module. Every value here is arithmetic or a bounded, tolerance-based
temporal classification over already-persisted Stage 1-10 evidence — never a semantic judgment.

WHAT THIS MODULE DOES NOT DO (by design):
  - It never modifies a Shot, Scene, Story Beat, SpeechSegment, or any other source evidence row.
  - It never modifies or re-runs Stage 10 construction — Scene/Story Beat rows are read exactly
    as `scene_construction_svc`/`story_beat_construction_svc` (locked at 81d0d77) left them.
  - It never classifies a transition's TYPE (hard cut / fade / dissolve / wipe / crossover) —
    that classification does not exist anywhere in the current evidence (transition_evidence_svc
    and transition_similarity_evidence_svc both explicitly defer it to a future stage); this
    module reports transition-evidence COVERAGE only, never a fabricated type distribution.
  - It never labels a pacing phase "fast"/"medium"/"slow" — that would require a normative
    threshold this module deliberately does not introduce yet (per the Stage 11.1 brief).

PACING PHASES use Scene ranges AND Story Beat ranges as TWO INDEPENDENT segmentations, never
merged into one — mirroring the Stage 10 Application Access Checkpoint's own "no artificial
nesting" precedent for the same underlying reason: Scene and Story Beat are independently-computed
time partitions of the same video, and forcing them into one combined segmentation would
misrepresent the (real, observed on VA5368) case of a Story Beat straddling a Scene boundary.

SPEECH<->CUT ALIGNMENT tolerances live in exactly one place (see the two named constants below) —
never scattered inline. They are new, Stage-11-local constants: deliberately NOT
`CANDIDATE_MERGE_WINDOW_SECONDS` (Stage 10's "same real-world instant" candidate-dedup constant)
and NOT `TRANSITION_BOUNDARY_MARGIN_SECONDS` (Stage 9's transition-sampling window) — those answer
different questions for different stages; reusing either here by coincidence-of-value would invite
an unrelated future change to one to silently change this module's own behaviour.

PERSISTENCE: the existing open-category `AnalysisAnnotation` table, three new category values,
zero schema/migration — exactly the same reuse this project has applied at every other stage.
Three categories rather than one because each is a structurally different kind of row (one
video-level summary; N pacing-phase rows; N cut-alignment rows), mirroring how Stage 10 itself
never lumped structurally different facts into a single blob-shaped row. certainty="MEASURED" on
every row this module ever writes.

IDEMPOTENCY: delete-then-replace of this module's own three categories for the target
VideoAnalysis, all writes in one transaction ending in a single commit — the exact same pattern
`scene_construction_svc`/`story_beat_construction_svc` already established, applied here rather
than invented anew.
"""
from statistics import median, pstdev

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.video_analysis import VideoAnalysis
from app.services.story_beat_construction_svc import STORY_BEAT_CATEGORY

EDITING_RHYTHM_PROFILE_CATEGORY = "editing_rhythm_profile"
EDITING_PACING_PHASE_CATEGORY = "editing_pacing_phase"
EDITING_CUT_ALIGNMENT_CATEGORY = "editing_cut_alignment"
EDITING_RHYTHM_PASS_NAME = "editing_rhythm_profile_v1"

TRANSITION_EVIDENCE_CATEGORY = "transition_evidence"
AUDIO_SILENCE_CATEGORY = "audio_silence"

# The ONE place any Stage 11.1 timing tolerance lives (per the brief's own "do not silently
# scatter timing thresholds through the code" instruction). Both are first, deliberately
# unvalidated-against-a-benchmark defaults -- a plain 0.3s "close enough to call it deliberate"
# margin, not tuned against any specific video. Revisit as named constants change, never as
# inline literals reappearing elsewhere.
CUT_NEAR_SPEECH_BOUNDARY_TOLERANCE_SECONDS = 0.3
CUT_NEAR_SILENCE_TOLERANCE_SECONDS = 0.3


class EditingRhythmError(Exception):
    """Raised only when this module must refuse rather than guess: an unknown video_analysis_id,
    or no authoritative duration available at all (no ReferenceVideo.duration AND no Shot rows to
    fall back on) -- mirrors SceneConstructionError/StoryBeatConstructionError's own discipline
    exactly. Never raised for a merely-empty evidence type (zero Shots, zero SpeechSegments, zero
    Scenes) -- those are normal, honestly-degraded outcomes, not errors."""


async def _resolve_duration(db: AsyncSession, video_analysis_id: int) -> float:
    """Independently defined here (not imported from scene_construction_svc/
    story_beat_construction_svc) -- same reasoning those two modules already give for defining
    their own copies: this module has no coupling to either construction service. Reference Video
    duration is independent of Shot detection, so a video with zero Shots still resolves a real
    duration whenever Stage 3 (technical_probe) has already run."""
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise EditingRhythmError(f"VideoAnalysis {video_analysis_id} does not exist.")

    reference_video = await db.get(ReferenceVideo, video_analysis.reference_video_id)
    if reference_video is not None and reference_video.duration is not None:
        return reference_video.duration

    result = await db.execute(select(func.max(Shot.end_time)).where(Shot.video_analysis_id == video_analysis_id))
    max_shot_end = result.scalar_one_or_none()
    if max_shot_end is not None:
        return max_shot_end

    raise EditingRhythmError(
        f"No authoritative duration available for video_analysis_id={video_analysis_id}: "
        "ReferenceVideo.duration is unset and no Shot rows exist to fall back on."
    )


def _shot_duration_stats(shots: list[Shot]) -> dict:
    """Pure arithmetic over an already-fetched Shot list. Population standard deviation (divide by
    n, not n-1) -- this describes the actual observed spread of THIS video's own shots, not an
    estimate of some larger population, and stays well-defined (0.0, never NaN or a division by
    zero) for exactly one Shot. Every field is explicitly None -- never 0, never a fabricated
    value -- when zero Shots exist, so "no data" is never confused with "measured as zero"."""
    if not shots:
        return {
            "shot_count": 0, "average_shot_duration": None, "median_shot_duration": None,
            "minimum_shot_duration": None, "maximum_shot_duration": None, "shot_duration_stddev": None,
        }
    durations = [s.end_time - s.start_time for s in shots]
    return {
        "shot_count": len(shots),
        "average_shot_duration": sum(durations) / len(durations),
        "median_shot_duration": median(durations),
        "minimum_shot_duration": min(durations),
        "maximum_shot_duration": max(durations),
        "shot_duration_stddev": pstdev(durations),
    }


def _cuts_per_minute(shot_count: int, duration: float | None) -> float | None:
    """A cut is the boundary BETWEEN two shots -- max(0, shot_count - 1), never negative. None
    (not 0, not a divide-by-zero) when duration is unknown or non-positive -- "cannot compute" is
    never silently presented as "computed to be zero"."""
    if duration is None or duration <= 0:
        return None
    return max(0, shot_count - 1) / (duration / 60.0)


async def _transition_evidence_coverage(db: AsyncSession, video_analysis_id: int, shot_count: int) -> dict:
    """Honest substitute for a "transition-type distribution" -- no type classification (hard cut/
    fade/dissolve/wipe/crossover) exists anywhere in the current evidence (see this module's own
    docstring), so this reports only how many of this video's own shot-to-shot boundaries have ANY
    measured transition_evidence row at all, never a fabricated categorical breakdown."""
    total_boundaries = max(0, shot_count - 1)
    measured = (await db.execute(
        select(func.count()).select_from(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == TRANSITION_EVIDENCE_CATEGORY,
        )
    )).scalar_one()
    return {
        "total_shot_boundaries": total_boundaries,
        "boundaries_with_transition_evidence": measured,
        "note": (
            "No transition TYPE classification (hard cut / fade / dissolve / wipe / crossover) "
            "exists in the current evidence -- both transition_evidence_svc and "
            "transition_similarity_evidence_svc explicitly defer that to a future stage. This is "
            "coverage (evidence present or not), never a type distribution."
        ),
    }


def _shots_in_range(shots: list[Shot], range_start: float, range_end: float) -> list[Shot]:
    """Half-open [start, end) on the shot's own start_time -- safe and non-double-counting for
    every phase including the last, since no Shot's start_time ever equals the video's own
    duration (the last Shot's start is strictly before duration; its END is what equals it)."""
    return [s for s in shots if range_start <= s.start_time < range_end]


def _pacing_phase(partition_type: str, partition_id: int, start: float, end: float, shots_in_phase: list[Shot]) -> dict:
    stats = _shot_duration_stats(shots_in_phase)
    duration = end - start
    return {
        "partition_type": partition_type,  # "scene" | "story_beat"
        "partition_id": partition_id,  # Scene.id, or the story_beat AnalysisAnnotation.id
        "start_time": start, "end_time": end, "duration": duration,
        "shot_count": stats["shot_count"],
        "average_shot_duration": stats["average_shot_duration"],
        "cuts_per_minute": _cuts_per_minute(stats["shot_count"], duration),
        "contributing_shot_ids": [s.id for s in shots_in_phase],
    }


def _classify_cut(cut_timestamp: float, speech_segments: list[SpeechSegment], silence_annotations: list[AnalysisAnnotation]) -> dict:
    """Deterministic, tolerance-based structural classification ONLY -- never a claim about
    editorial intent. Checked in this explicit priority order: near a speech-segment BOUNDARY
    first (checked against every segment, not just the nearest), then strictly inside a speech
    segment, then near/inside a silence interval, then an honest "no evidence at all for this
    video" or "evidence exists elsewhere, but not near this specific cut" catch-all -- a cut is
    never left unclassified without saying so."""
    if not speech_segments and not silence_annotations:
        return {"classification": "no_speech_evidence", "evidence_id": None, "evidence_type": None}

    for seg in speech_segments:
        if (abs(cut_timestamp - seg.start_time) <= CUT_NEAR_SPEECH_BOUNDARY_TOLERANCE_SECONDS
                or abs(cut_timestamp - seg.end_time) <= CUT_NEAR_SPEECH_BOUNDARY_TOLERANCE_SECONDS):
            return {"classification": "near_speech_boundary", "evidence_id": seg.id, "evidence_type": "speech_segment"}

    for seg in speech_segments:
        if seg.start_time < cut_timestamp < seg.end_time:
            return {"classification": "during_speech_segment", "evidence_id": seg.id, "evidence_type": "speech_segment"}

    for ann in silence_annotations:
        lo = ann.start_time - CUT_NEAR_SILENCE_TOLERANCE_SECONDS
        hi = ann.end_time + CUT_NEAR_SILENCE_TOLERANCE_SECONDS
        if lo <= cut_timestamp <= hi:
            return {"classification": "near_silence", "evidence_id": ann.id, "evidence_type": "audio_silence"}

    return {"classification": "unclassified", "evidence_id": None, "evidence_type": None}


async def compute_and_persist_editing_rhythm(db: AsyncSession, video_analysis_id: int) -> dict:
    """Stage 11.1's single entry point. Reads already-persisted Shot/Scene/Story-Beat/
    SpeechSegment/audio_silence/transition_evidence rows for one exact VideoAnalysis, computes
    every deterministic measurement this module defines, and persists them (delete-then-replace,
    one commit) under three AnalysisAnnotation categories. Never mutates any source evidence row,
    never touches Stage 10 construction, never calls a reasoner or any external API.

    Raises EditingRhythmError only if the VideoAnalysis does not exist or no duration is
    resolvable at all -- every other missing-evidence case (no Shots, no transcript, no silence,
    no Scenes, no accepted Story Beat boundaries) degrades to explicit None/empty values, never a
    fabricated number.
    """
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise EditingRhythmError(f"VideoAnalysis {video_analysis_id} does not exist.")

    duration = await _resolve_duration(db, video_analysis_id)

    shots = list((await db.execute(
        select(Shot).where(Shot.video_analysis_id == video_analysis_id).order_by(Shot.order)
    )).scalars().all())
    speech_segments = list((await db.execute(
        select(SpeechSegment).where(SpeechSegment.video_analysis_id == video_analysis_id).order_by(SpeechSegment.start_time)
    )).scalars().all())
    silence_annotations = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == AUDIO_SILENCE_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all())
    scenes = list((await db.execute(
        select(Scene).where(Scene.video_analysis_id == video_analysis_id).order_by(Scene.order)
    )).scalars().all())
    story_beats = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all())

    shot_stats = _shot_duration_stats(shots)
    transition_coverage = await _transition_evidence_coverage(db, video_analysis_id, shot_stats["shot_count"])
    video_level = {
        **shot_stats,
        "cuts_per_minute": _cuts_per_minute(shot_stats["shot_count"], duration),
        "video_duration": duration,
        "transition_evidence": transition_coverage,
        "contributing_shot_ids": [s.id for s in shots],
    }

    scene_phases = [
        _pacing_phase("scene", scene.id, scene.start_time, scene.end_time, _shots_in_range(shots, scene.start_time, scene.end_time))
        for scene in scenes
    ]
    story_beat_phases = [
        _pacing_phase("story_beat", beat.id, beat.start_time, beat.end_time, _shots_in_range(shots, beat.start_time, beat.end_time))
        for beat in story_beats
    ]

    cut_alignments = []
    for i in range(len(shots) - 1):
        cut_timestamp = shots[i].end_time
        classification = _classify_cut(cut_timestamp, speech_segments, silence_annotations)
        cut_alignments.append({
            "cut_timestamp": cut_timestamp,
            "before_shot_id": shots[i].id, "after_shot_id": shots[i + 1].id,
            **classification,
        })

    await db.execute(delete(AnalysisAnnotation).where(
        AnalysisAnnotation.video_analysis_id == video_analysis_id,
        AnalysisAnnotation.category.in_([
            EDITING_RHYTHM_PROFILE_CATEGORY, EDITING_PACING_PHASE_CATEGORY, EDITING_CUT_ALIGNMENT_CATEGORY,
        ]),
    ))

    db.add(AnalysisAnnotation(
        video_analysis_id=video_analysis_id, shot_id=None, category=EDITING_RHYTHM_PROFILE_CATEGORY,
        start_time=0.0, end_time=duration, details=video_level,
        certainty="MEASURED", confidence_score=None, reasoning=None,
        source="deterministic_measurement", produced_by_pass=EDITING_RHYTHM_PASS_NAME,
    ))
    for phase in (*scene_phases, *story_beat_phases):
        db.add(AnalysisAnnotation(
            video_analysis_id=video_analysis_id, shot_id=None, category=EDITING_PACING_PHASE_CATEGORY,
            start_time=phase["start_time"], end_time=phase["end_time"], details=phase,
            certainty="MEASURED", confidence_score=None, reasoning=None,
            source="deterministic_measurement", produced_by_pass=EDITING_RHYTHM_PASS_NAME,
        ))
    for cut in cut_alignments:
        db.add(AnalysisAnnotation(
            video_analysis_id=video_analysis_id, shot_id=cut["before_shot_id"], category=EDITING_CUT_ALIGNMENT_CATEGORY,
            start_time=cut["cut_timestamp"], end_time=cut["cut_timestamp"], details=cut,
            certainty="MEASURED", confidence_score=None, reasoning=None,
            source="deterministic_measurement", produced_by_pass=EDITING_RHYTHM_PASS_NAME,
        ))

    await db.commit()

    return {
        "video_level": video_level,
        "scene_phases": scene_phases,
        "story_beat_phases": story_beat_phases,
        "cut_alignments": cut_alignments,
    }
