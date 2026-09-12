"""Stage 11.3 (pre-lock durability correction) — DURABLE HOOK REASONING ATTEMPT STORE.

INSPECTED FIRST, PER INSTRUCTION: both existing durable reasoning-attempt stores
(app.services.semantic_boundary_reasoning_store_svc and
app.services.story_beat_boundary_reasoning_store_svc) reuse the generic, category-discriminated
`AnalysisAnnotation` table under their own new category value — no dedicated table, no schema
migration, for either. `AnalysisAnnotation` already carries every column a Hook reasoning attempt
genuinely needs: `video_analysis_id` (linkage), `category` (identity), `start_time`/`end_time`
(the Hook Window's own bounds, carried directly rather than re-derived), `details` (JSON —
provider/model/prompt_version/hook_window_id/structured decision/evidence references, exactly the
same "id-only references, never copied raw evidence" discipline every other attempt row already
follows), `certainty`/`confidence_score` (categorical confidence lives in `details.confidence`,
mirroring Story Beat's own choice to leave the numeric column None since neither contract reports
a calibrated score), `reasoning` (the free-text justification), and `created_at` (ordering/audit).
No column that a Hook attempt needs is missing — a new table would duplicate this exact shape for
no structural reason, so this module is a deliberate SIBLING of the other two stores, never a
shared/reused class, reusing `AnalysisAnnotation` exactly as they do.

APPEND-ONLY (Section 2 of the durability correction): `persist_hook_reasoning_attempt` commits
immediately and NEVER deletes or overwrites a prior attempt — a rerun simply adds a new row.
Semantic outputs can legitimately vary between runs (VA5368 itself already demonstrated this: one
real run inferred `create_curiosity`, another inferred `provoke_attention` from the same evidence)
— both must remain durably auditable, exactly like Story Beat's own append-only history already
guarantees for boundary decisions.

NO FAILURE-RECORD CONCEPT — FOLLOWING EXISTING STAGE 10 CONVENTION, NOT INVENTING A NEW ONE:
neither semantic_boundary_reasoning_store_svc nor story_beat_boundary_reasoning_store_svc persists
anything for a FAILED reasoning call — a raised SemanticReasoningError/StoryBeatReasoningError
simply means nothing is written, and the affected candidate remains "unreasoned" for a future
retry (see find_unreasoned_candidates/find_unreasoned_story_beat_candidates). This store follows
the identical convention: a HookReasoningError raised by the reasoner (a provider error, malformed
response, fabricated evidence id, prohibited-language rejection, or any other contract-validation
failure) is never caught here — nothing is persisted, and hook_classification_svc's own call order
(assemble -> reason -> [this store] -> StrategicInsight) means the existing accepted
StrategicInsight, if any, is never touched when the reasoner call itself fails.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.services.hook_reasoner.contract import HookResult

HOOK_REASONING_ATTEMPT_CATEGORY = "hook_reasoning_attempt"
HOOK_REASONING_PASS_NAME = "hook_classification_v1"


def _hook_element_to_dict(element) -> dict:
    return {"element_type": element.element_type, "evidence_references": element.evidence_references}


async def persist_hook_reasoning_attempt(
    db: AsyncSession, video_analysis_id: int, hook_window: dict, result: HookResult,
) -> AnalysisAnnotation:
    """Durably persists ONE Hook reasoning attempt immediately — commits right away (crash-safe:
    a crash immediately after this call still leaves this attempt durably saved and auditable,
    even if the caller's subsequent StrategicInsight update never runs). Append-only: never
    deletes or overwrites a prior attempt; a rerun simply adds its own new row, distinguishable by
    `created_at` and this row's own `id`.

    `hook_window` is the exact `{"start_time", "end_time", "hook_window_id"}` shape
    hook_evidence_assembly_svc.assemble_hook_evidence_bundle already produces — reused unmodified,
    not reshaped by this store."""
    decision = result.decision
    details = {
        "hook_window_id": hook_window["hook_window_id"],
        "primary_type": decision.primary_type,
        "secondary_types": decision.secondary_types,
        "hook_elements": [_hook_element_to_dict(e) for e in decision.hook_elements],
        "probable_intent": decision.probable_intent,
        "confidence": decision.confidence,
        "evidence_references": decision.evidence_references,
        "provider": result.provider,
        "model": result.model,
        "prompt_version": result.reasoning_contract_version,
    }
    annotation = AnalysisAnnotation(
        video_analysis_id=video_analysis_id, shot_id=None, category=HOOK_REASONING_ATTEMPT_CATEGORY,
        start_time=hook_window["start_time"], end_time=hook_window["end_time"],
        details=details, certainty="INFERRED", confidence_score=None,
        reasoning=decision.reasoning, source="ai_reasoning", produced_by_pass=HOOK_REASONING_PASS_NAME,
    )
    db.add(annotation)
    await db.commit()
    await db.refresh(annotation)
    return annotation


async def load_hook_reasoning_attempts(db: AsyncSession, video_analysis_id: int) -> list[AnalysisAnnotation]:
    """Every durable Hook reasoning attempt for this VideoAnalysis, oldest first — the FULL
    history, never filtered to "latest only" (unlike Story Beat's own
    load_latest_story_beat_reasoning_results, which exists to feed construction a deduplicated
    view; Hook has no construction step, and orchestration always wants to know the specific new
    attempt id it just created, not a merged view). Never deletes, never mutates, tracks no
    "consumed" state — calling this twice with no new writes in between returns the identical
    result."""
    result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == HOOK_REASONING_ATTEMPT_CATEGORY,
        ).order_by(AnalysisAnnotation.created_at)
    )
    return list(result.scalars().all())
