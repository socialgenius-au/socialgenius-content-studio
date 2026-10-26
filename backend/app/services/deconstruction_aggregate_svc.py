"""Video Deconstructor — C1: AGGREGATE DECONSTRUCTION READ MODEL.

ONE read that returns everything the Deconstructor currently knows about one source, for one exact
VideoAnalysis, so the upcoming Content Anatomy layer (C2) can consume a single, complete, honest
structure instead of stitching four endpoints and direct database reads together.

PURE READ. Never creates, updates or deletes a row, never calls a reasoner or any external API. Every
section is assembled from ALREADY-PERSISTED data by reusing the existing readers:
  * `evidence`  -- the existing `_to_response` (Stage 3-9: shots + nested frames/text/objects/persistence/
    composition/motion, speech segments, audio structure, transition evidence, recurring text) embedded
    verbatim, not re-implemented.
  * `structure` -- `stage10_deconstruction_svc.get_stage10_deconstruction` (Scenes + Story Beats).
  * `editing_rhythm`, `hook`, `retention`, `strategic_insights` -- direct reads of the exact categories
    the Stage 11.x services write (constants imported from those services, never re-typed here).

NOTHING IS FABRICATED. A section whose analysis has not run is null / an empty collection, and
`availability` says so explicitly. HISTORICAL ROWS MUST NOT CRASH THE READER: retention reasoning
attempts written before the acceptance gate (prompt v1/v2) carry no `is_retention_device` key -- they
are surfaced with `is_retention_device: null` and `schema: "legacy_pre_acceptance_gate"`, and are NEVER
reinterpreted as accepted or rejected (a consumer must treat null as "no acceptance decision was ever
made", not as false or true). Likewise pre-gate `retention_device` rows lack `probable_attention_function`.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.strategic_insight import StrategicInsight
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.deconstruction_orchestrator_svc import (
    ORCHESTRATION_KEY, OrchestrationNotFound, compute_stage_statuses,
)
from app.services.editing_rhythm_svc import (
    EDITING_CUT_ALIGNMENT_CATEGORY, EDITING_PACING_PHASE_CATEGORY, EDITING_RHYTHM_PROFILE_CATEGORY,
)
from app.services.hook_classification_svc import HOOK_STRATEGIC_CATEGORY
from app.services.hook_reasoning_store_svc import HOOK_REASONING_ATTEMPT_CATEGORY
from app.services.hook_window_svc import HOOK_WINDOW_CATEGORY
from app.services.retention_candidate_assembly_svc import generate_retention_candidates
from app.services.retention_classification_svc import RETENTION_DEVICE_CATEGORY
from app.services.retention_reasoning_store_svc import RETENTION_REASONING_ATTEMPT_CATEGORY
from app.services.stage10_deconstruction_svc import get_stage10_deconstruction

LEGACY_RETENTION_SCHEMA = "legacy_pre_acceptance_gate"
CURRENT_RETENTION_SCHEMA = "acceptance_gate_v3"


async def _annotations(db: AsyncSession, video_analysis_id: int, category: str) -> list[AnalysisAnnotation]:
    return list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id, AnalysisAnnotation.category == category,
        ).order_by(AnalysisAnnotation.start_time, AnalysisAnnotation.id)
    )).scalars().all())


def _row(a: AnalysisAnnotation) -> dict:
    return {"id": a.id, "start_time": a.start_time, "end_time": a.end_time, "certainty": a.certainty,
            "reasoning": a.reasoning, "details": a.details or {}}


def _examined_candidate(a: AnalysisAnnotation) -> dict:
    d = a.details or {}
    return {
        "attempt_id": a.id, "created_at": a.created_at,
        "candidate_start": d.get("candidate_start", a.start_time), "candidate_end": d.get("candidate_end", a.end_time),
        "device_type": d.get("device_type"),
        # None (not False) for a legacy attempt: no acceptance decision was ever made for it.
        "is_retention_device": d.get("is_retention_device"),
        "probable_attention_function": d.get("probable_attention_function"),
        "confidence": d.get("confidence"), "reasoning": a.reasoning,
        "prompt_version": d.get("prompt_version"), "provider": d.get("provider"), "model": d.get("model"),
        "evidence_references": d.get("evidence_references") or {},
        "source_nominations": d.get("source_nominations") or [],
        "schema": CURRENT_RETENTION_SCHEMA if "is_retention_device" in d else LEGACY_RETENTION_SCHEMA,
    }


def _effective_device(a: AnalysisAnnotation) -> dict:
    d = a.details or {}
    return {
        "id": a.id, "start_time": a.start_time, "end_time": a.end_time,
        "device_type": d.get("device_type"), "probable_attention_function": d.get("probable_attention_function"),
        "confidence": d.get("confidence"), "reasoning": a.reasoning,
        "reasoning_attempt_id": d.get("reasoning_attempt_id"),
        "evidence_references": d.get("evidence_references") or {},
        "source_nominations": d.get("source_nominations") or [],
        "prompt_version": d.get("prompt_version"),
        "schema": CURRENT_RETENTION_SCHEMA if "probable_attention_function" in d else LEGACY_RETENTION_SCHEMA,
    }


async def _retention_section(db: AsyncSession, video_analysis_id: int) -> dict:
    attempts = await _annotations(db, video_analysis_id, RETENTION_REASONING_ATTEMPT_CATEGORY)
    latest_by_span: dict[tuple, AnalysisAnnotation] = {}
    for a in sorted(attempts, key=lambda x: (x.created_at is None, x.created_at, x.id)):
        d = a.details or {}
        latest_by_span[(round(d.get("candidate_start", a.start_time), 4), round(d.get("candidate_end", a.end_time), 4))] = a
    examined = [_examined_candidate(a) for a in sorted(latest_by_span.values(), key=lambda x: x.start_time)]
    devices = [_effective_device(a) for a in await _annotations(db, video_analysis_id, RETENTION_DEVICE_CATEGORY)]
    candidates = await generate_retention_candidates(db, video_analysis_id)
    return {
        # Deterministic, recomputed at read time from persisted evidence (cheap, never persisted here).
        "candidates": [
            {"candidate_start": c["candidate_start"], "candidate_end": c["candidate_end"],
             "source_types": sorted({n["source_type"] for n in c["source_nominations"]})}
            for c in candidates
        ],
        # Latest durable reasoning attempt per candidate span (accepted AND rejected).
        "examined": examined,
        # ACCEPTED devices only. An empty list is a valid, complete answer.
        "accepted_devices": devices,
        "attempts_total": len(attempts),
        "legacy_attempts": sum(1 for a in attempts if "is_retention_device" not in (a.details or {})),
    }


async def _hook_section(db: AsyncSession, video_analysis_id: int) -> dict:
    windows = await _annotations(db, video_analysis_id, HOOK_WINDOW_CATEGORY)
    insight = (await db.execute(select(StrategicInsight).where(
        StrategicInsight.video_analysis_id == video_analysis_id, StrategicInsight.category == HOOK_STRATEGIC_CATEGORY,
    ).order_by(StrategicInsight.id.desc()))).scalars().first()
    attempts = await _annotations(db, video_analysis_id, HOOK_REASONING_ATTEMPT_CATEGORY)
    return {
        "window": _row(windows[0]) if windows else None,
        "classification": None if insight is None else {
            "id": insight.id, "description": insight.description, "details": insight.details or {},
            "certainty": insight.certainty, "reasoning": insight.reasoning,
        },
        "reasoning_attempts": [
            {"id": a.id, "created_at": a.created_at, "primary_type": (a.details or {}).get("primary_type"),
             "probable_intent": (a.details or {}).get("probable_intent"), "confidence": (a.details or {}).get("confidence"),
             "provider": (a.details or {}).get("provider"), "model": (a.details or {}).get("model"),
             "prompt_version": (a.details or {}).get("prompt_version")}
            for a in sorted(attempts, key=lambda x: x.id)
        ],
    }


async def _editing_rhythm_section(db: AsyncSession, video_analysis_id: int) -> dict:
    profiles = await _annotations(db, video_analysis_id, EDITING_RHYTHM_PROFILE_CATEGORY)
    return {
        "profile": _row(profiles[0]) if profiles else None,
        "pacing_phases": [_row(a) for a in await _annotations(db, video_analysis_id, EDITING_PACING_PHASE_CATEGORY)],
        "cut_alignments": [_row(a) for a in await _annotations(db, video_analysis_id, EDITING_CUT_ALIGNMENT_CATEGORY)],
    }


async def build_full_deconstruction(
    db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None,
) -> dict:
    """The aggregate read. Raises OrchestrationNotFound (mapped to 404 by the router) if the reference
    video is not the caller's, or if a pinned `video_analysis_id` does not belong to it."""
    # Lazy: the router imports this module, and `_to_response` is the router's own evidence reader.
    from app.routers.reference_videos import _to_response

    user_id = user.id
    rv = (await db.execute(select(ReferenceVideo).where(
        ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user_id))).scalar_one_or_none()
    if rv is None:
        raise OrchestrationNotFound("Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if asset is None:
        raise OrchestrationNotFound("Reference video's underlying asset is missing")

    if video_analysis_id is None:
        va = (await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id)
                               .order_by(VideoAnalysis.created_at.desc(), VideoAnalysis.id.desc()).limit(1))).scalars().first()
    else:
        va = (await db.execute(select(VideoAnalysis).where(
            VideoAnalysis.id == video_analysis_id, VideoAnalysis.reference_video_id == rv.id))).scalar_one_or_none()
    if va is None:
        raise OrchestrationNotFound("No matching analysis record exists for this reference video")

    evidence = await _to_response(db, rv, asset, video_analysis_id=va.id)
    structure = await get_stage10_deconstruction(db, va.id)
    editing = await _editing_rhythm_section(db, va.id)
    hook = await _hook_section(db, va.id)
    retention = await _retention_section(db, va.id)
    insights = list((await db.execute(select(StrategicInsight).where(
        StrategicInsight.video_analysis_id == va.id).order_by(StrategicInsight.id))).scalars().all())

    ps = va.pass_status or {}
    return {
        "source": {
            "reference_video_id": rv.id, "asset_id": rv.asset_id, "original_filename": asset.original_filename,
            "source": rv.source, "original_url": rv.original_url, "rights_status": rv.rights_status, "created_at": rv.created_at,
        },
        "video_analysis": {
            "id": va.id, "status": va.status, "analysis_tier": va.analysis_tier, "created_at": va.created_at,
            "started_at": va.started_at, "completed_at": va.completed_at, "pass_status": ps,
        },
        "orchestration": ps.get(ORCHESTRATION_KEY),
        "stages": compute_stage_statuses(ps),
        "technical": {
            "duration": rv.duration, "width": rv.width, "height": rv.height, "fps": rv.fps, "codec": rv.codec,
            "has_audio": rv.has_audio, "details": rv.technical_details,
        },
        "evidence": evidence,
        "structure": structure,
        "editing_rhythm": editing,
        "hook": hook,
        "retention": retention,
        "strategic_insights": [
            {"id": i.id, "category": i.category, "description": i.description, "details": i.details or {},
             "certainty": i.certainty, "confidence_score": i.confidence_score, "reasoning": i.reasoning,
             "evidence_summary": i.evidence_summary, "source": i.source, "produced_by_pass": i.produced_by_pass}
            for i in insights
        ],
        "ai_configured": {
            "semantic_scenes": bool(settings.SEMANTIC_REASONER_PROVIDER),
            "story_beats": bool(settings.STORY_BEAT_REASONER_PROVIDER),
            "hook": bool(settings.HOOK_REASONER_PROVIDER),
            "retention": bool(settings.RETENTION_REASONER_PROVIDER),
        },
        "availability": {
            "technical": rv.duration is not None,
            "shots": len(evidence.shots) > 0,
            "speech": len(evidence.speech_segments) > 0,
            "audio_structure": evidence.audio_structure is not None,
            "text": len(evidence.recurring_elements) > 0 or any(len(s.text_elements) > 0 for s in evidence.shots),
            "scenes": len(structure["scenes"]) > 0,
            "story_beats": any(len(s["story_beats"]) > 0 for s in structure["scenes"]),
            "editing_rhythm": editing["profile"] is not None,
            "hook_window": hook["window"] is not None,
            "hook_classification": hook["classification"] is not None,
            "retention_examined": len(retention["examined"]) > 0,
            "retention_accepted_devices": len(retention["accepted_devices"]) > 0,
        },
    }
