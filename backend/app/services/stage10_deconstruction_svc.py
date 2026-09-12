"""Video Deconstructor — Stage 10 APPLICATION ACCESS CHECKPOINT.

This module adds NO new reasoning, NO new construction logic, and NO new schema. It exists solely
to make the already-built, already-locked Stage 10 pipelines — Semantic Scene Grouping
(`scene_construction_svc`) and Story Beat Construction V1 (`story_beat_construction_svc`, locked at
`ffa0fe5`) — reachable through the running application, exactly as the Stage 10 Completion Audit
identified as the single missing piece. Every reasoning/construction/persistence call below is a
call THROUGH to an existing, already-tested service function; this module only sequences them in
the order those services already require and assembles their already-persisted output for reading.

RUN SURFACE (`run_stage10_pipeline`): wires together, for one exact `video_analysis_id`, the exact
call order the existing services already document as their own contract:
  1. `semantic_boundary_assembly_svc` candidates are implicitly consulted via each store's own
     `find_unreasoned_*` helper (never re-implemented here).
  2. Any candidate with no durable reasoning attempt yet is reasoned about exactly once, through
     the existing `reason_about_boundary` / `reason_about_story_beat_boundary` routers — never a
     new/duplicate reasoning code path.
  3. Every result is persisted through the existing durable stores
     (`semantic_boundary_reasoning_store_svc` / `story_beat_boundary_reasoning_store_svc`).
  4. Construction is invoked through the existing, locked construction services
     (`scene_construction_svc.construct_and_persist_scenes` /
     `story_beat_construction_svc.construct_and_persist_story_beats`) exactly as they are.
Repeated execution is safe because every step already is: `find_unreasoned_*` never re-offers an
already-reasoned candidate (regardless of that reasoning's own outcome), each reasoning persistence
call commits immediately (crash-safe), Scene construction short-circuits when its own pass_status
is already "complete", and Story Beat construction is a deterministic delete-then-replace that
produces byte-identical rows when its durable input is unchanged. A later re-run after NEW evidence
appears simply reasons about the new candidates only and reconstructs from the updated durable set —
this module adds no idempotency logic of its own; it only relies on what these services already
guarantee.

READ SURFACE (`get_stage10_deconstruction`): assembles `Video -> ordered Scenes -> Story Beats
(associated by time-range overlap, computed HERE, at read time, never persisted) -> lightweight,
ID-based evidence/provenance references`. Deliberately does NOT add a Scene<->StoryBeat foreign key
or any nesting column — see scene.py's own long-standing "Shot.scene_id stays reserved; overlap is
always derived at read time" precedent, extended here to Story Beats for the exact same reason: a
Story Beat and a Scene are two independently-computed time partitions of the same video, and forcing
a single-parent assignment would misrepresent the (rare but real) case of a Beat straddling a Scene
boundary. A Beat whose range overlaps two Scenes is honestly listed under both.
"""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.text_element import TextElement
from app.models.video_analysis import VideoAnalysis
from app.services.scene_construction_svc import CandidateReasoningRecord, construct_and_persist_scenes
from app.services.semantic_boundary_assembly_svc import CANDIDATE_MERGE_WINDOW_SECONDS
from app.services.semantic_boundary_reasoning_store_svc import (
    find_unreasoned_candidates,
    load_latest_reasoning_results,
    persist_reasoning_result,
)
from app.services.semantic_reasoner.router import reason_about_boundary
from app.services.story_beat_boundary_reasoning_store_svc import (
    StoryBeatReasoningRecord,
    find_unreasoned_story_beat_candidates,
    persist_story_beat_reasoning_result,
)
from app.services.story_beat_construction_svc import STORY_BEAT_CATEGORY, construct_and_persist_story_beats
from app.services.story_beat_reasoner.router import reason_about_story_beat_boundary

SEMANTIC_BOUNDARY_DECISION_CATEGORY = "semantic_boundary_decision"


class Stage10PipelineError(Exception):
    """Raised only for conditions this module itself must refuse rather than silently paper over
    (an unknown video_analysis_id). Never raised for a reasoner/construction error genuinely raised
    by the underlying services — those (SemanticReasoningError, StoryBeatReasoningError,
    SceneConstructionError, StoryBeatConstructionError) propagate unchanged, so a caller can tell
    exactly which existing, already-documented failure mode actually occurred."""


@dataclass
class Stage10RunResult:
    """Summary of one `run_stage10_pipeline` call — counts only, never a copy of the constructed
    rows themselves (the read surface is the one place for that)."""
    video_analysis_id: int
    scene_candidates_reasoned: int
    story_beat_candidates_reasoned: int
    scenes_count: int
    story_beats_count: int


async def run_stage10_pipeline(db: AsyncSession, video_analysis_id: int) -> Stage10RunResult:
    """The RUN SURFACE. See this module's own docstring for the exact call order and why repeated
    execution is safe. Raises Stage10PipelineError if the VideoAnalysis does not exist; otherwise
    lets any underlying reasoning/construction error propagate exactly as that service defines it."""
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise Stage10PipelineError(f"VideoAnalysis {video_analysis_id} does not exist.")

    # --- Semantic Scene Grouping (Stage 10.2) ---
    unreasoned_scene_candidates = await find_unreasoned_candidates(db, video_analysis_id)
    for candidate in unreasoned_scene_candidates:
        result = await reason_about_boundary(candidate)
        await persist_reasoning_result(
            db, video_analysis_id,
            CandidateReasoningRecord(result=result, source_nominations=candidate["source_nominations"]),
        )
    scene_reasoning_results = await load_latest_reasoning_results(db, video_analysis_id)
    scenes = await construct_and_persist_scenes(db, video_analysis_id, scene_reasoning_results)

    # --- Story Beat Construction (Stage 10.3, locked methodology at ffa0fe5) ---
    unreasoned_beat_candidates = await find_unreasoned_story_beat_candidates(db, video_analysis_id)
    for candidate in unreasoned_beat_candidates:
        result = await reason_about_story_beat_boundary(candidate)
        await persist_story_beat_reasoning_result(
            db, video_analysis_id,
            StoryBeatReasoningRecord(result=result, source_nominations=candidate["source_nominations"]),
        )
    story_beats = await construct_and_persist_story_beats(db, video_analysis_id)

    return Stage10RunResult(
        video_analysis_id=video_analysis_id,
        scene_candidates_reasoned=len(unreasoned_scene_candidates),
        story_beat_candidates_reasoned=len(unreasoned_beat_candidates),
        scenes_count=len(scenes),
        story_beats_count=len(story_beats),
    )


def _evidence_ref_ids(evidence_references: dict, key: str) -> list[int]:
    return list((evidence_references or {}).get(key) or [])


async def _fetch_evidence_lookup(db: AsyncSession, video_analysis_id: int, boundary_dicts: list[dict]) -> dict:
    """Batch-fetches every Shot/SpeechSegment/TextElement/AnalysisAnnotation id ever cited across
    the supplied boundary evidence_references dicts, ONE query per evidence type (never one query
    per boundary) — returns `{"shots": {id: dict}, "speech_segments": {id: dict}, ...}` lightweight
    summaries only, never the full row. `boundary_dicts` are plain `evidence_references`-shaped
    dicts (the same bounded key set both Scene and Story Beat already use)."""
    shot_ids: set[int] = set()
    speech_ids: set[int] = set()
    text_ids: set[int] = set()
    annotation_ids: set[int] = set()
    for refs in boundary_dicts:
        shot_ids.update(_evidence_ref_ids(refs, "supporting_shot_ids"))
        speech_ids.update(_evidence_ref_ids(refs, "supporting_speech_segment_ids"))
        text_ids.update(_evidence_ref_ids(refs, "supporting_text_element_ids"))
        annotation_ids.update(_evidence_ref_ids(refs, "supporting_annotation_ids"))

    shots: dict[int, dict] = {}
    if shot_ids:
        rows = (await db.execute(select(Shot).where(Shot.id.in_(shot_ids)))).scalars().all()
        shots = {
            s.id: {
                "id": s.id, "start_time": s.start_time, "end_time": s.end_time,
                "keyframe_asset_id": s.keyframe_asset_id,
            } for s in rows
        }

    speech: dict[int, dict] = {}
    if speech_ids:
        rows = (await db.execute(select(SpeechSegment).where(SpeechSegment.id.in_(speech_ids)))).scalars().all()
        speech = {
            s.id: {
                "id": s.id, "start_time": s.start_time, "end_time": s.end_time,
                "excerpt": (s.text or "")[:160],
            } for s in rows
        }

    text: dict[int, dict] = {}
    if text_ids:
        rows = (await db.execute(select(TextElement).where(TextElement.id.in_(text_ids)))).scalars().all()
        text = {
            t.id: {
                "id": t.id, "start_time": t.start_time, "end_time": t.end_time,
                "excerpt": (t.text or "")[:160],
            } for t in rows
        }

    annotations: dict[int, dict] = {}
    if annotation_ids:
        rows = (await db.execute(select(AnalysisAnnotation).where(AnalysisAnnotation.id.in_(annotation_ids)))).scalars().all()
        annotations = {
            a.id: {"id": a.id, "start_time": a.start_time, "end_time": a.end_time, "category": a.category}
            for a in rows
        }

    return {"shots": shots, "speech_segments": speech, "text_elements": text, "annotations": annotations}


def _dereference(evidence_references: dict, lookup: dict) -> dict:
    """Expands one bounded evidence_references dict's id lists into the lightweight summaries
    `_fetch_evidence_lookup` already fetched — an id with no matching row (should not normally
    happen, but evidence is never re-verified here) is simply omitted, never fabricated."""
    return {
        "supporting_shot_ids": [lookup["shots"][i] for i in _evidence_ref_ids(evidence_references, "supporting_shot_ids") if i in lookup["shots"]],
        "supporting_speech_segment_ids": [lookup["speech_segments"][i] for i in _evidence_ref_ids(evidence_references, "supporting_speech_segment_ids") if i in lookup["speech_segments"]],
        "supporting_text_element_ids": [lookup["text_elements"][i] for i in _evidence_ref_ids(evidence_references, "supporting_text_element_ids") if i in lookup["text_elements"]],
        "supporting_annotation_ids": [lookup["annotations"][i] for i in _evidence_ref_ids(evidence_references, "supporting_annotation_ids") if i in lookup["annotations"]],
    }


def _scene_boundary_provenance(timestamp: float | None, decisions_by_timestamp: dict[float, AnalysisAnnotation], lookup: dict) -> dict | None:
    """A Scene boundary is just its own start_time/end_time by construction — the matching
    `semantic_boundary_decision` row (the one this exact boundary was accepted from) is looked up
    directly by that timestamp rather than through `load_latest_reasoning_results` (which discards
    the row's own id), so `reasoning_attempt_id` below is real, not fabricated."""
    if timestamp is None:
        return None
    row = decisions_by_timestamp.get(timestamp)
    if row is None:
        return None
    details = row.details or {}
    return {
        "reasoning_attempt_id": row.id,
        "candidate_timestamp": row.start_time,
        "provider": details.get("provider"),
        "model": details.get("model"),
        "prompt_version": details.get("prompt_version"),
        "confidence": details.get("confidence"),
        "evidence": _dereference(details.get("evidence_references") or {}, lookup),
    }


def _story_beat_boundary_provenance(boundary: dict | None, lookup: dict) -> dict | None:
    if boundary is None:
        return None
    evidence_refs = {k: v for k, v in boundary.items() if k.startswith("supporting_")}
    out = {k: v for k, v in boundary.items() if not k.startswith("supporting_")}
    out["evidence"] = _dereference(evidence_refs, lookup)
    return out


async def get_stage10_deconstruction(db: AsyncSession, video_analysis_id: int) -> dict:
    """The READ SURFACE. See this module's own docstring for the exact tree shape and why Scene<->
    StoryBeat association is computed here, at read time, rather than persisted. Raises
    Stage10PipelineError if the VideoAnalysis does not exist. Never mutates any row."""
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise Stage10PipelineError(f"VideoAnalysis {video_analysis_id} does not exist.")

    reference_video = await db.get(ReferenceVideo, video_analysis.reference_video_id)
    duration = reference_video.duration if reference_video else None

    scenes = list((await db.execute(
        select(Scene).where(Scene.video_analysis_id == video_analysis_id).order_by(Scene.order)
    )).scalars().all())

    beats = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all())

    decision_rows = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == SEMANTIC_BOUNDARY_DECISION_CATEGORY,
        )
    )).scalars().all())
    # Exactly one accepted decision can exist at a Scene's own boundary timestamp by construction
    # (scene_construction_svc builds Scene edges FROM accepted-decision timestamps) -- preferring
    # is_semantic_boundary=True on a tie is a defensive, never-expected-to-matter tiebreak, not a
    # new selection rule.
    decisions_by_timestamp: dict[float, AnalysisAnnotation] = {}
    for row in decision_rows:
        existing = decisions_by_timestamp.get(row.start_time)
        if existing is None or ((row.details or {}).get("is_semantic_boundary") is True):
            decisions_by_timestamp[row.start_time] = row

    # Batch-fetch every evidence id referenced anywhere across every Scene/Beat boundary, once.
    all_boundary_evidence_dicts: list[dict] = []
    for scene in scenes:
        details = scene.details or {}
        for side in ("boundary_start", "boundary_end"):
            if details.get(side):
                all_boundary_evidence_dicts.append(details[side])
    for beat in beats:
        beat_details = beat.details or {}
        for side in ("boundary_start", "boundary_end"):
            if beat_details.get(side):
                all_boundary_evidence_dicts.append(beat_details[side])
    lookup = await _fetch_evidence_lookup(db, video_analysis_id, all_boundary_evidence_dicts)

    beat_payloads = []
    for beat in beats:
        details = beat.details or {}
        beat_payloads.append({
            "id": beat.id,
            "start_time": beat.start_time,
            "end_time": beat.end_time,
            "boundary_status": details.get("boundary_status"),
            "certainty": beat.certainty,
            "boundary_start": _story_beat_boundary_provenance(details.get("boundary_start"), lookup),
            "boundary_end": _story_beat_boundary_provenance(details.get("boundary_end"), lookup),
            "co_nominated_attempt_ids": details.get("co_nominated_attempt_ids", []),
            "examined_unresolved_attempt_ids": details.get("examined_unresolved_attempt_ids", []),
            "unresolved_attempt_ids": details.get("unresolved_attempt_ids", []),
        })

    scene_payloads = []
    for scene in scenes:
        details = scene.details or {}
        boundary_start_ts = scene.start_time if details.get("boundary_start") else None
        boundary_end_ts = scene.end_time if details.get("boundary_end") else None

        # Time-range overlap, computed here, never persisted (see module docstring). A Beat
        # straddling two Scenes' shared edge is honestly listed under both, never forced to pick one.
        overlapping = [
            bp for bp, beat in zip(beat_payloads, beats)
            if beat.start_time < scene.end_time and beat.end_time > scene.start_time
        ]

        scene_payloads.append({
            "id": scene.id,
            "order": scene.order,
            "start_time": scene.start_time,
            "end_time": scene.end_time,
            "narrative_role": scene.narrative_role,
            "certainty": scene.certainty,
            "confidence_score": scene.confidence_score,
            "boundary_start": _scene_boundary_provenance(boundary_start_ts, decisions_by_timestamp, lookup),
            "boundary_end": _scene_boundary_provenance(boundary_end_ts, decisions_by_timestamp, lookup),
            "story_beats": overlapping,
        })

    return {
        "video_analysis_id": video_analysis_id,
        "reference_video_id": video_analysis.reference_video_id,
        "duration": duration,
        "scenes": scene_payloads,
    }
