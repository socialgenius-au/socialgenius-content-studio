"""Video Deconstructor — Stage 11.3: HOOK CLASSIFICATION V1 orchestration + persistence.

Wires together, for one exact VideoAnalysis, exactly three existing/newly-built pieces in the
order they require -- adding no reasoning or construction logic of its own:
  1. `hook_evidence_assembly_svc.assemble_hook_evidence_bundle` -- reads the LOCKED Stage 11.2
     hook_window and gathers the bounded, factual evidence bundle scoped to it.
  2. `hook_reasoner.classify_hook` -- the provider-independent reasoning call over that bundle.
  3. Persistence as a single `StrategicInsight(category="hook")` row.

WHY StrategicInsight, NOT A NEW ATTEMPT-STORE TABLE (Section 8 of the Stage 11.3 brief): the
Scene/Story-Beat durable-attempt-store pattern (append-only, "latest per candidate timestamp",
`find_unreasoned_candidates`) exists specifically to handle MANY independent candidates per video,
reasoned about incrementally over multiple runs. A Hook Window is exactly ONE fixed target per
video -- there is no "which candidates are still unreasoned" question to ask, so that pattern does
not cleanly apply here (per the brief's own "if that architecture already exists and can be reused
CLEANLY" qualifier). What IS reused is the same SHAPE that pattern already establishes for a
reasoning conclusion (provider/model/prompt_version/confidence/reasoning/evidence_references),
written directly onto the one StrategicInsight row this stage ever produces per video -- an
existing, already-designed-for-exactly-this table (its own documented `category` list already
names "hook"), not a new one.

IDEMPOTENCY: delete-then-replace of this VideoAnalysis's own single `category="hook"`
StrategicInsight row, one commit -- the same convention Stage 11.1/11.2 already established,
chosen over Story Beat's own append-only-history pattern for the same single-target reason above.

certainty="INFERRED": this IS a genuine semantic judgment (unlike Stage 11.1/11.2's deterministic
MEASURED outputs) -- classifying hook type/elements/intent from evidence content is exactly the
kind of AI interpretation this project's own certainty vocabulary reserves INFERRED for.
"""
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.strategic_insight import StrategicInsight
from app.models.video_analysis import VideoAnalysis
from app.services.hook_evidence_assembly_svc import assemble_hook_evidence_bundle
from app.services.hook_reasoner import HookReasoningError, classify_hook

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
    result = await classify_hook(bundle)
    decision = result.decision

    details = {
        "hook_window_id": bundle["hook_window"]["hook_window_id"],
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

    return {**details, "confidence": decision.confidence, "strategic_insight_id": row.id}
