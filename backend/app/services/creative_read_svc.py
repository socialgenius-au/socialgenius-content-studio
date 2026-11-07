"""Creative Read service: gathers the evidence of a reference video, shows selected keyframes to the AI, and stores the evidence-cited findings as annotations on the video's analysis.

Stored in the existing `analysis_annotations` table (no new table): one `creative_read` row (summary, per-shot reads, limitations, what was shown) and one `creative_finding` row per finding.
All INFERRED, source `ai_vision`. Re-running with the same evidence, prompt version and model returns the stored result and makes NO paid call unless `force`. Nothing is persisted on failure.
"""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.user import User
from app.services.ai_metering import ai_scope
from app.services.creative_reader import CreativeReadError, CreativeReadInputError, read_video
from app.services.creative_reader.contract import CONFIDENCE_SCORE, CREATIVE_READ_PROMPT_VERSION, CREATIVE_READ_SCHEMA
from app.services.creative_reader.evidence import build_input, load_images
from app.services.deconstruction_aggregate_svc import build_full_deconstruction

SUMMARY_CATEGORY = "creative_read"
FINDING_CATEGORY = "creative_finding"
PASS_NAME = "creative_read"


def _view(summary_row: AnalysisAnnotation | None, finding_rows: list[AnalysisAnnotation], *, reused: bool) -> dict:
    if summary_row is None:
        return {"status": "not_run", "summary": None, "shots": [], "findings": [], "limitations": [], "provenance": None, "reused": False}
    d = summary_row.details or {}
    return {
        "status": "current", "summary": summary_row.reasoning, "shots": d.get("shots", []), "limitations": d.get("limitations", []), "reused": reused,
        "findings": [{"id": r.id, "start_time": r.start_time, "end_time": r.end_time, "certainty": r.certainty, "confidence": (r.details or {}).get("confidence"), **{k: v for k, v in (r.details or {}).items() if k != "confidence"}} for r in finding_rows],
        "provenance": {"schema": d.get("schema"), "prompt_version": d.get("prompt_version"), "provider": d.get("provider"), "model": d.get("model"), "basis": "ai_vision", "fingerprint": d.get("fingerprint"),
                       "frames_shown": d.get("frames_shown", []), "frames_missing": d.get("frames_missing", []), "usage": d.get("usage", {}), "created_at": summary_row.created_at},
    }


async def _load(db: AsyncSession, va_id: int) -> tuple[AnalysisAnnotation | None, list[AnalysisAnnotation]]:
    rows = (await db.execute(select(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category.in_([SUMMARY_CATEGORY, FINDING_CATEGORY]))
                             .order_by(AnalysisAnnotation.start_time, AnalysisAnnotation.id))).scalars().all()
    summary = next((r for r in rows if r.category == SUMMARY_CATEGORY), None)
    return summary, [r for r in rows if r.category == FINDING_CATEGORY]


async def load_creative_view(db: AsyncSession, va_id: int) -> dict:
    """The stored Creative Read of one exact analysis (status `not_run` when there is none). Pure read."""
    summary, findings = await _load(db, va_id)
    return _view(summary, findings, reused=False)


async def get_creative_read(db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None) -> dict:
    agg = await build_full_deconstruction(db, user, reference_video_id, video_analysis_id=video_analysis_id)
    summary, findings = await _load(db, agg["video_analysis"]["id"])
    return _view(summary, findings, reused=False)


async def run_creative_read(db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None, force: bool = False) -> dict:
    """Raises OrchestrationNotFound (unknown/foreign video), CreativeReadInputError (nothing to look at; nothing sent), CreativeReadError (no/failed/invalid reasoner; nothing persisted)."""
    agg = await build_full_deconstruction(db, user, reference_video_id, video_analysis_id=video_analysis_id)
    va_id = agg["video_analysis"]["id"]
    evidence = agg["evidence"].model_dump(mode="json") if hasattr(agg["evidence"], "model_dump") else agg["evidence"]
    if not evidence.get("shots"):
        raise CreativeReadInputError("Shot detection has not completed for this reference, so there is nothing to look at yet. Run Deconstruct first.")
    prepared = build_input(evidence, max_frames=settings.CREATIVE_READ_MAX_FRAMES)
    fingerprint = f"{prepared['fingerprint']}|{CREATIVE_READ_PROMPT_VERSION}|{settings.CREATIVE_READ_REASONER_PROVIDER}|{settings.CREATIVE_READ_REASONER_MODEL}"

    summary, findings = await _load(db, va_id)
    if summary is not None and not force and (summary.details or {}).get("fingerprint") == fingerprint:
        return _view(summary, findings, reused=True)

    images, missing = await load_images(prepared, settings.CREATIVE_READ_FRAME_WIDTH)
    if not images:
        raise CreativeReadInputError("None of this reference's keyframes can be read from the server (they are missing, which happens to files uploaded before persistent storage). "
                                     "Upload the original video again and run Deconstruct, then try again. Nothing was sent to the AI.")
    with ai_scope(reference_video_id=reference_video_id, video_analysis_id=va_id, user_id=user.id, reasoner="creative_read", force=force):
        result = await read_video(prepared, images)
    result.limitations.extend(missing)

    await db.execute(delete(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category.in_([SUMMARY_CATEGORY, FINDING_CATEGORY])))
    duration = prepared["video"].get("duration_seconds") or max((s["end"] for s in prepared["shots"]), default=0.0)
    db.add(AnalysisAnnotation(
        video_analysis_id=va_id, shot_id=None, category=SUMMARY_CATEGORY, start_time=0.0, end_time=float(duration), certainty="INFERRED", confidence_score=None,
        reasoning=result.summary, evidence_summary=f"{len(images)} keyframes shown to the AI with the measured speech, on-screen text and timing", source="ai_vision", produced_by_pass=PASS_NAME,
        details={"schema": CREATIVE_READ_SCHEMA, "prompt_version": result.prompt_version, "provider": settings.CREATIVE_READ_REASONER_PROVIDER, "model": result.model, "fingerprint": fingerprint,
                 "shots": [{"shot_order": s.shot_order, "focal_subject": s.focal_subject, "framing": s.framing, "notes": s.notes} for s in result.shots], "limitations": result.limitations,
                 "frames_shown": [im["frame_id"] for im in images], "frames_missing": [f["id"] for f in prepared["frames"] if f["id"] not in {im["frame_id"] for im in images}], "usage": result.usage}))
    for f in result.findings:
        db.add(AnalysisAnnotation(
            video_analysis_id=va_id, shot_id=None, category=FINDING_CATEGORY, start_time=f.start_time, end_time=f.end_time, certainty="INFERRED", confidence_score=CONFIDENCE_SCORE[f.confidence],
            reasoning=f.statement, evidence_summary=", ".join(f"{e['type']}:{e['id']}" for e in f.evidence), source="ai_vision", produced_by_pass=PASS_NAME,
            details={"kind": f.kind, "statement": f.statement, "confidence": f.confidence, "basis": "ai_vision", "shot_orders": f.shot_orders, "evidence": f.evidence, "mechanism_type": f.mechanism_type,
                     "transferable_principle": f.transferable_principle, "source_specific": f.source_specific}))
    await db.commit()
    summary, findings = await _load(db, va_id)
    return _view(summary, findings, reused=False)
