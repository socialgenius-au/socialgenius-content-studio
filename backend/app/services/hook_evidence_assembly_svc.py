"""Video Deconstructor — Stage 11.3: BOUNDED HOOK EVIDENCE BUNDLE ASSEMBLY.

Pure READ/ASSEMBLE layer over already-persisted evidence, scoped EXACTLY to the locked Stage 11.2
`hook_window` for one VideoAnalysis -- never the whole video. Mirrors
`semantic_boundary_assembly_svc`'s own discipline exactly: every query here is a SELECT, this
module never creates/updates/deletes a row, and it never itself makes a semantic judgment about
any of the evidence it gathers.

WHAT THIS MODULE DOES NOT DO:
  - It never decides the Hook Window's own boundaries -- it reads the ALREADY-PERSISTED,
    ALREADY-LOCKED Stage 11.2 `hook_window` row and raises if one does not exist yet, rather than
    silently deriving its own guess.
  - It never labels any fact "compelling", "effective", "curiosity-building", or any other
    interpretation -- every field in the returned bundle is a factual/measured or already-durably-
    recorded observation (a raw transcript string, a detected object label, a cut's own
    classification), never an adjective this module invents.
  - It never dumps the whole video's evidence -- every evidence type below is filtered to rows
    whose own time range genuinely OVERLAPS the Hook Window (`row.start_time < hook_end AND
    row.end_time > hook_start`), the exact same overlap test Stage 11.1's own phase attribution
    correction established.

EVIDENCE TYPES ASSEMBLED (Section 2 of the Stage 11.3 brief): SpeechSegments, on-screen TextElement
Occurrence Group heads, Shots, VisualObjects, motion/camera evidence (global/local motion
AnalysisAnnotation rows), transition evidence, audio_silence, overlapping Scene(s), overlapping
Story Beat(s), and the Stage 11.1 Editing Logic `editing_pacing_phase` rows (both Scene-based and
Story-Beat-based) whose own range overlaps the window -- plus any `editing_cut_alignment` rows
(individual cuts) that fall inside it.

Every AnalysisAnnotation-backed evidence type (motion/transition/silence/editing-phase) is
represented in the bundle via its own `id`, `category`, timestamps, and its own pre-existing
`evidence_summary` string -- a plain-language FACTUAL description every such row already carries
(e.g. "Deterministic FFmpeg silencedetect interval.") -- rather than this module re-deriving a
per-category custom description of its own.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.text_element import TextElement
from app.models.video_analysis import VideoAnalysis
from app.models.visual_object import VisualObject
from app.services.editing_rhythm_svc import EDITING_CUT_ALIGNMENT_CATEGORY, EDITING_PACING_PHASE_CATEGORY
from app.services.hook_window_svc import HOOK_WINDOW_CATEGORY
from app.services.story_beat_construction_svc import STORY_BEAT_CATEGORY

_MOTION_CATEGORIES = ["global_motion_evidence", "local_motion_evidence", "local_motion_dynamics"]
_TRANSITION_CATEGORIES = ["transition_evidence", "transition_similarity_evidence"]
_AUDIO_SILENCE_CATEGORY = "audio_silence"


class HookEvidenceAssemblyError(Exception):
    """Raised only when the prerequisite Stage 11.2 `hook_window` has not been computed yet for
    this VideoAnalysis, or the VideoAnalysis itself does not exist -- never for a genuinely empty
    evidence type (that degrades to an honest empty list in the bundle, exactly like every other
    Stage 10/11 module's own missing-evidence discipline)."""


def _overlaps(row_start: float, row_end: float, hook_start: float, hook_end: float) -> bool:
    return row_start < hook_end and row_end > hook_start


async def _load_hook_window(db: AsyncSession, video_analysis_id: int) -> AnalysisAnnotation:
    row = (await db.execute(select(AnalysisAnnotation).where(
        AnalysisAnnotation.video_analysis_id == video_analysis_id,
        AnalysisAnnotation.category == HOOK_WINDOW_CATEGORY,
    ))).scalar_one_or_none()
    if row is None:
        raise HookEvidenceAssemblyError(
            f"No Stage 11.2 hook_window exists yet for video_analysis_id={video_analysis_id} -- "
            "run derive_and_persist_hook_window first. This module never derives its own window."
        )
    return row


async def assemble_hook_evidence_bundle(db: AsyncSession, video_analysis_id: int) -> dict:
    """Stage 11.3's own single entry point. Returns a bounded, purely factual evidence bundle
    scoped to the already-locked Hook Window -- never creates, updates, or deletes any row.

    Raises HookEvidenceAssemblyError if the VideoAnalysis does not exist or Stage 11.2 has not
    run yet for it.
    """
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise HookEvidenceAssemblyError(f"VideoAnalysis {video_analysis_id} does not exist.")

    hook_window_row = await _load_hook_window(db, video_analysis_id)
    hook_start = hook_window_row.details["start_time"]
    hook_end = hook_window_row.details["end_time"]

    def q(model_or_rows):
        return [r for r in model_or_rows if _overlaps(r.start_time, r.end_time, hook_start, hook_end)]

    speech_segments = q(list((await db.execute(
        select(SpeechSegment).where(SpeechSegment.video_analysis_id == video_analysis_id).order_by(SpeechSegment.start_time)
    )).scalars().all()))

    text_elements = q(list((await db.execute(
        select(TextElement).where(
            TextElement.video_analysis_id == video_analysis_id,
            TextElement.occurrence_group_id.is_(None),  # canonical Occurrence Group heads only
        ).order_by(TextElement.start_time)
    )).scalars().all()))

    shots = q(list((await db.execute(
        select(Shot).where(Shot.video_analysis_id == video_analysis_id).order_by(Shot.order)
    )).scalars().all()))

    visual_objects = q(list((await db.execute(
        select(VisualObject).where(VisualObject.video_analysis_id == video_analysis_id)
    )).scalars().all()))

    motion_evidence = q(list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category.in_(_MOTION_CATEGORIES),
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all()))

    transition_evidence = q(list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category.in_(_TRANSITION_CATEGORIES),
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all()))

    audio_silence = q(list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == _AUDIO_SILENCE_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all()))

    scenes = q(list((await db.execute(
        select(Scene).where(Scene.video_analysis_id == video_analysis_id).order_by(Scene.order)
    )).scalars().all()))

    story_beats = q(list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all()))

    editing_pacing_phases = q(list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == EDITING_PACING_PHASE_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all()))

    cut_alignments = q(list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == EDITING_CUT_ALIGNMENT_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all()))

    return {
        "hook_window": {"start_time": hook_start, "end_time": hook_end, "hook_window_id": hook_window_row.id},
        "speech_segments": [
            {"id": s.id, "start_time": s.start_time, "end_time": s.end_time, "text": s.text, "language": s.language}
            for s in speech_segments
        ],
        "text_elements": [
            {"id": t.id, "start_time": t.start_time, "end_time": t.end_time, "text": t.text}
            for t in text_elements
        ],
        "shots": [
            {"id": sh.id, "order": sh.order, "start_time": sh.start_time, "end_time": sh.end_time}
            for sh in shots
        ],
        "visual_objects": [
            {"id": v.id, "label": v.label, "category": v.category, "start_time": v.start_time, "end_time": v.end_time}
            for v in visual_objects
        ],
        "motion_evidence": [
            {"id": a.id, "category": a.category, "start_time": a.start_time, "end_time": a.end_time, "fact": a.evidence_summary}
            for a in motion_evidence
        ],
        "transition_evidence": [
            {"id": a.id, "category": a.category, "start_time": a.start_time, "end_time": a.end_time, "fact": a.evidence_summary}
            for a in transition_evidence
        ],
        "audio_silence": [
            {"id": a.id, "start_time": a.start_time, "end_time": a.end_time, "fact": a.evidence_summary}
            for a in audio_silence
        ],
        "scenes": [
            {"id": sc.id, "order": sc.order, "start_time": sc.start_time, "end_time": sc.end_time}
            for sc in scenes
        ],
        "story_beats": [
            {"id": b.id, "start_time": b.start_time, "end_time": b.end_time, "boundary_status": (b.details or {}).get("boundary_status")}
            for b in story_beats
        ],
        "editing_pacing_phases": [
            {
                "id": p.id, "partition_type": (p.details or {}).get("partition_type"),
                "start_time": p.start_time, "end_time": p.end_time,
                "overlapping_shot_count": (p.details or {}).get("overlapping_shot_count"),
                "cuts_in_phase": (p.details or {}).get("cuts_in_phase"),
                "average_shot_exposure_duration": (p.details or {}).get("average_shot_exposure_duration"),
            }
            for p in editing_pacing_phases
        ],
        "cuts": [
            {"id": c.id, "cut_timestamp": c.start_time, "classification": (c.details or {}).get("classification")}
            for c in cut_alignments
        ],
    }
