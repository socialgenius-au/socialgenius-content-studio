"""Video Deconstructor — Stage 11.4: RETENTION DEVICE DETECTION V1 orchestration + persistence.

Wires together, for one exact VideoAnalysis, the pieces in the order they require -- adding no new
reasoning or candidate-generation logic of its own:
  1. `retention_candidate_assembly_svc.generate_retention_candidates` -- deterministic candidate
     generation + anti-transitive grouping (Sections 3-4 of the brief). Zero candidates is a normal,
     legitimate outcome (e.g. a video with almost no structural events), not an error.
  2. For EACH candidate, in candidate_start order:
     a. `retention_candidate_assembly_svc.assemble_candidate_evidence_bundle` -- bounded local
        evidence around that one candidate only.
     b. `retention_reasoner.classify_retention_candidate` -- the provider-independent reasoning
        call. If this raises RetentionReasoningError, the ENTIRE RUN STOPS HERE -- no further
        candidates are classified, and the effective retention_device row set for this video is
        NOT touched at all (see "ATOMIC REPLACE" below). This deliberately generalizes Hook's own
        "a failed call stops everything below" discipline from "one window" to "the whole batch":
        a rerun (which will re-attempt every candidate, not just the failed one) is the intended
        recovery path, exactly like Story Beat's own resumable-attempt model.
     c. `retention_reasoning_store_svc.persist_retention_reasoning_attempt` -- durably records
        THIS candidate's attempt, append-only, before the effective row set is ever touched.
  3. ATOMIC REPLACE: only once every candidate has been successfully classified does this module
     delete the video's entire prior `retention_device` row set and write the fresh one -- an
     all-or-nothing swap, never a partial update, so a failed run never leaves some candidates from
     the new run mixed with stale candidates from an older one.

WHY delete-then-replace-the-whole-SET (Story Beat's own multi-row pattern), NOT Hook's own single-
row delete-then-replace: a video may have zero, one, or many retention_device candidates, exactly
like Story Beat's own many-row-per-video `story_beat` category -- never Hook's "exactly one target"
shape. `retention_reasoning_attempt` rows, by contrast, are NEVER deleted here or anywhere -- only
the effective `retention_device` conclusions are ever replaced; the durable attempt history that
produced every past run remains permanently queryable via `load_retention_reasoning_attempts`.

certainty="INFERRED" on every retention_device row (Hook's own precedent): this IS a genuine
semantic judgment, not a deterministic measurement -- classifying whether/what kind of device a
candidate represents is exactly the AI-interpretation category this project's own certainty
vocabulary reserves INFERRED for. `device_type="unclear"` is a legitimate, first-class outcome
(Hook's own primary_type="unclear" precedent) and IS persisted as a normal row, not filtered out --
downstream aggregation (explicitly deferred to a later Stage 11.4.x) can choose to exclude
"unclear" rows itself if it wants only confidently-typed devices.
"""
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.models.video_analysis import VideoAnalysis
from app.services.retention_candidate_assembly_svc import (
    assemble_candidate_evidence_bundle,
    generate_retention_candidates,
)
from app.services.retention_reasoner import classify_retention_candidate
from app.services.retention_reasoning_store_svc import persist_retention_reasoning_attempt

RETENTION_DEVICE_CATEGORY = "retention_device"
RETENTION_CLASSIFICATION_PASS_NAME = "retention_classification_v1"


class RetentionClassificationError(Exception):
    """Raised only when the VideoAnalysis does not exist -- every other failure (no reasoner
    configured, a configured reasoner's own call failing, a contract violation) propagates as the
    specific, already-descriptive RetentionReasoningError the underlying module raises, never
    wrapped or hidden."""


async def classify_and_persist_retention_devices(db: AsyncSession, video_analysis_id: int) -> dict:
    """Stage 11.4's single entry point. Raises RetentionClassificationError only if the
    VideoAnalysis does not exist; lets RetentionReasoningError (no reasoner configured, or a
    candidate's response violated the contract) propagate unchanged, stopping the whole run (see
    module docstring) without touching the existing effective retention_device row set.

    Returns `{"candidates_considered": int, "devices": [...]}` — one entry per persisted
    retention_device row, each carrying its own `reasoning_attempt_id`.
    """
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise RetentionClassificationError(f"VideoAnalysis {video_analysis_id} does not exist.")

    candidates = await generate_retention_candidates(db, video_analysis_id)

    device_rows: list[dict] = []
    for candidate in candidates:
        bundle = await assemble_candidate_evidence_bundle(db, video_analysis_id, candidate)
        result = await classify_retention_candidate(bundle)  # RetentionReasoningError here stops the whole run -- see module docstring
        decision = result.decision

        # Durable, append-only attempt record FIRST -- committed before the effective row set is
        # ever touched, so a crash between this line and the atomic replace below still leaves
        # every already-classified candidate's attempt fully auditable.
        attempt = await persist_retention_reasoning_attempt(db, video_analysis_id, candidate, result)

        device_rows.append({
            "candidate_start": candidate["candidate_start"],
            "candidate_end": candidate["candidate_end"],
            "source_nominations": candidate["source_nominations"],
            "reasoning_attempt_id": attempt.id,
            "device_type": decision.device_type,
            "confidence": decision.confidence,
            "reasoning": decision.reasoning,
            "evidence_references": decision.evidence_references,
            "provider": result.provider,
            "model": result.model,
            "prompt_version": result.reasoning_contract_version,
        })

    # ATOMIC REPLACE -- only reached once every candidate above was classified successfully.
    await db.execute(delete(AnalysisAnnotation).where(
        AnalysisAnnotation.video_analysis_id == video_analysis_id,
        AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
    ))
    persisted_rows: list[AnalysisAnnotation] = []
    for device in device_rows:
        row = AnalysisAnnotation(
            video_analysis_id=video_analysis_id,
            shot_id=None,
            category=RETENTION_DEVICE_CATEGORY,
            start_time=device["candidate_start"],
            end_time=device["candidate_end"],
            details={
                "source_nominations": device["source_nominations"],
                "reasoning_attempt_id": device["reasoning_attempt_id"],
                "device_type": device["device_type"],
                "confidence": device["confidence"],
                "evidence_references": device["evidence_references"],
                "provider": device["provider"],
                "model": device["model"],
                "prompt_version": device["prompt_version"],
            },
            certainty="INFERRED",
            confidence_score=None,
            reasoning=device["reasoning"],
            source="ai_reasoning",
            produced_by_pass=RETENTION_CLASSIFICATION_PASS_NAME,
        )
        db.add(row)
        persisted_rows.append(row)

    await db.commit()
    for row in persisted_rows:
        await db.refresh(row)

    return {
        "candidates_considered": len(candidates),
        "devices": [
            {
                "id": row.id,
                "start_time": row.start_time,
                "end_time": row.end_time,
                "device_type": row.details["device_type"],
                "confidence": row.details["confidence"],
                "reasoning_attempt_id": row.details["reasoning_attempt_id"],
            }
            for row in persisted_rows
        ],
    }
