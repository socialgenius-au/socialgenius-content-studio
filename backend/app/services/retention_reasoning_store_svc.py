"""Stage 11.4 — DURABLE RETENTION DEVICE REASONING ATTEMPT STORE.

Deliberate SIBLING of app.services.hook_reasoning_store_svc, never a shared/reused class -- but
following the exact same, now-locked Stage 11.3 durability discipline the Stage 11.4 brief
explicitly requires be reused: evidence -> durable reasoning attempt -> accepted conclusion.

REUSES THE GENERIC `AnalysisAnnotation` TABLE, per the brief's own explicit instruction ("reuse
existing generic AnalysisAnnotation architecture if adequate") -- inspected first, confirmed
adequate exactly as hook_reasoning_store_svc's own docstring already confirmed for Hook: every
column a Retention attempt needs (`video_analysis_id`, `category`, `start_time`/`end_time` for the
candidate's own span, `details` JSON for candidate/source-nomination/device-type/evidence-reference/
provider/model/prompt-version data, `certainty`, `reasoning`, `created_at`) already exists. No new
table, no migration.

ONE ATTEMPT PER (candidate, classification run) -- unlike Hook (exactly one window per video), a
single VideoAnalysis run of Stage 11.4 produces MANY attempts, one per candidate. `details.
candidate_start`/`candidate_end` (never a separate persisted "candidate id", since candidates
themselves are deterministic and never independently stored before classification) is how a given
attempt is matched back to the specific candidate that produced it.

APPEND-ONLY: `persist_retention_reasoning_attempt` commits immediately and NEVER deletes or
overwrites a prior attempt -- a rerun of the whole video, or of a specific candidate span, simply
adds new rows alongside any earlier ones for the same span.

NO FAILURE-RECORD CONCEPT -- FOLLOWING EXISTING STAGE 10/11.3 CONVENTION, NOT INVENTING A NEW ONE:
exactly like hook_reasoning_store_svc, a raised RetentionReasoningError is never caught here --
nothing is persisted for a failed candidate classification, and retention_classification_svc's own
call order (assemble -> reason -> [this store] -> retention_device row) means a failed call for one
candidate leaves that candidate's own attempt history exactly as it already was.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.services.retention_reasoner.contract import RetentionResult

RETENTION_REASONING_ATTEMPT_CATEGORY = "retention_reasoning_attempt"
RETENTION_REASONING_PASS_NAME = "retention_classification_v1"


async def persist_retention_reasoning_attempt(
    db: AsyncSession, video_analysis_id: int, candidate: dict, result: RetentionResult,
) -> AnalysisAnnotation:
    """Durably persists ONE Retention reasoning attempt immediately — commits right away
    (crash-safe). Append-only: never deletes or overwrites a prior attempt for this or any other
    candidate; a rerun simply adds its own new row(s), distinguishable by `created_at` and this
    row's own `id`.

    `candidate` is the exact `{"candidate_start", "candidate_end", "candidate_center",
    "source_nominations"}` shape retention_candidate_assembly_svc.generate_retention_candidates
    already produces — reused unmodified, not reshaped by this store."""
    decision = result.decision
    details = {
        "candidate_start": candidate["candidate_start"],
        "candidate_end": candidate["candidate_end"],
        "candidate_center": candidate["candidate_center"],
        "source_nominations": candidate["source_nominations"],
        "device_type": decision.device_type,
        "confidence": decision.confidence,
        "evidence_references": decision.evidence_references,
        "provider": result.provider,
        "model": result.model,
        "prompt_version": result.reasoning_contract_version,
    }
    annotation = AnalysisAnnotation(
        video_analysis_id=video_analysis_id, shot_id=None, category=RETENTION_REASONING_ATTEMPT_CATEGORY,
        start_time=candidate["candidate_start"], end_time=candidate["candidate_end"],
        details=details, certainty="INFERRED", confidence_score=None,
        reasoning=decision.reasoning, source="ai_reasoning", produced_by_pass=RETENTION_REASONING_PASS_NAME,
    )
    db.add(annotation)
    await db.commit()
    await db.refresh(annotation)
    return annotation


async def load_retention_reasoning_attempts(db: AsyncSession, video_analysis_id: int) -> list[AnalysisAnnotation]:
    """Every durable Retention reasoning attempt for this VideoAnalysis, oldest first — the FULL
    history across every candidate and every run, never filtered to "latest only". Never deletes,
    never mutates, tracks no "consumed" state — calling this twice with no new writes in between
    returns the identical result."""
    result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == RETENTION_REASONING_ATTEMPT_CATEGORY,
        ).order_by(AnalysisAnnotation.created_at)
    )
    return list(result.scalars().all())
