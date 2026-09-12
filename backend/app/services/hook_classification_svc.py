"""Video Deconstructor — Stage 11.3: HOOK CLASSIFICATION V1 orchestration + persistence.

Wires together, for one exact VideoAnalysis, four existing/newly-built pieces in the order they
require -- adding no reasoning or construction logic of its own:
  1. `hook_evidence_assembly_svc.assemble_hook_evidence_bundle` -- reads the LOCKED Stage 11.2
     hook_window and gathers the bounded, factual evidence bundle scoped to it.
  2. `hook_reasoner.classify_hook` -- the provider-independent reasoning call over that bundle.
     If this raises HookReasoningError, execution stops HERE -- neither step 3 nor step 4 below
     ever runs, so a failed call leaves both the attempt history and the existing accepted insight
     completely untouched (see hook_reasoning_store_svc's own docstring for why this mirrors the
     existing Stage 10 "no failure record" convention exactly, rather than inventing a new one).
  3. `hook_reasoning_store_svc.persist_hook_reasoning_attempt` -- durably records THIS attempt,
     append-only, before the accepted conclusion is ever touched (Stage 11.3 pre-lock durability
     correction: evidence -> reasoning attempt -> accepted conclusion, the same discipline Stage
     10 already established for Scene/Story Beat).
  4. Persistence of the single EFFECTIVE `StrategicInsight(category="hook")` row, which now
     references the exact attempt that produced it via `details.reasoning_attempt_id` -- never
     relying on duplicated provider/model strings alone for that traceability.

WHY StrategicInsight FOR THE ACCEPTED CONCLUSION, STILL DELETE-THEN-REPLACE: a Hook Window is
exactly one fixed target per video -- there is only ever one CURRENTLY EFFECTIVE Hook conclusion,
so idempotent replace (not Story Beat's own "latest wins, but every historical attempt stays
queryable via a merge" pattern) remains the right choice for THIS row specifically. What changed
in the durability correction is that the ATTEMPT itself is no longer discarded when the insight is
replaced -- it now lives on, forever, in hook_reasoning_store_svc's own append-only history,
findable by `reasoning_attempt_id` from the insight, or independently via
`load_hook_reasoning_attempts` for the full run-to-run history (including any earlier attempt that
is no longer the one referenced by the current effective insight).

certainty="INFERRED" on both the attempt and the insight: this IS a genuine semantic judgment
(unlike Stage 11.1/11.2's deterministic MEASURED outputs) -- classifying hook type/elements/intent
from evidence content is exactly the kind of AI interpretation this project's own certainty
vocabulary reserves INFERRED for.
"""
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.strategic_insight import StrategicInsight
from app.models.video_analysis import VideoAnalysis
from app.services.hook_evidence_assembly_svc import assemble_hook_evidence_bundle
from app.services.hook_reasoner import HookReasoningError, classify_hook
from app.services.hook_reasoning_store_svc import persist_hook_reasoning_attempt

HOOK_STRATEGIC_CATEGORY = "hook"
HOOK_CLASSIFICATION_PASS_NAME = "hook_classification_v1"


class HookClassificationError(Exception):
    """Raised only when the VideoAnalysis does not exist -- every other failure (missing Stage
    11.2 hook_window, a reasoner configuration/contract-violation error) propagates as the
    specific, already-descriptive exception the underlying module raises
    (HookEvidenceAssemblyError / HookReasoningError), never wrapped or hidden."""


def _hook_element_to_dict(element) -> dict:
    return {"element_type": element.element_type, "evidence_references": element.evidence_references}


async def classify_and_persist_hook(db: AsyncSession, video_analysis_id: int) -> dict:
    """Stage 11.3's single entry point. Raises HookClassificationError only if the VideoAnalysis
    does not exist; lets HookEvidenceAssemblyError (Stage 11.2 hasn't run) and HookReasoningError
    (no reasoner configured, or its response violated the contract) propagate unchanged."""
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise HookClassificationError(f"VideoAnalysis {video_analysis_id} does not exist.")

    bundle = await assemble_hook_evidence_bundle(db, video_analysis_id)
    result = await classify_hook(bundle)  # HookReasoningError here stops everything below -- see module docstring
    decision = result.decision

    # Durable, append-only attempt record FIRST -- committed before the effective insight is ever
    # touched, so a crash between this line and the insight update below still leaves this attempt
    # fully auditable (Stage 11.3 pre-lock durability correction).
    attempt = await persist_hook_reasoning_attempt(db, video_analysis_id, bundle["hook_window"], result)

    details = {
        "hook_window_id": bundle["hook_window"]["hook_window_id"],
        "reasoning_attempt_id": attempt.id,
        "start_time": bundle["hook_window"]["start_time"],
        "end_time": bundle["hook_window"]["end_time"],
        "primary_type": decision.primary_type,
        "secondary_types": decision.secondary_types,
        "hook_elements": [_hook_element_to_dict(e) for e in decision.hook_elements],
        "probable_intent": decision.probable_intent,
        "evidence_references": decision.evidence_references,
        "provider": result.provider,
        "model": result.model,
        "prompt_version": result.reasoning_contract_version,
    }

    await db.execute(delete(StrategicInsight).where(
        StrategicInsight.video_analysis_id == video_analysis_id,
        StrategicInsight.category == HOOK_STRATEGIC_CATEGORY,
    ))
    row = StrategicInsight(
        video_analysis_id=video_analysis_id,
        category=HOOK_STRATEGIC_CATEGORY,
        description=f"Hook Window [{details['start_time']}, {details['end_time']}]: primary_type={decision.primary_type}",
        details=details,
        certainty="INFERRED",
        confidence_score=None,  # categorical confidence lives in details/reasoning per this project's own convention
        reasoning=decision.reasoning,
        evidence_summary=None,
        source="ai_reasoning",
        produced_by_pass=HOOK_CLASSIFICATION_PASS_NAME,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    return {**details, "confidence": decision.confidence, "strategic_insight_id": row.id, "reasoning_attempt_id": attempt.id}
