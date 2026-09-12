"""The Stage 11.4 Retention Reasoner router — the one place that decides which provider actually
classifies a given candidate, so retention orchestration never hard-codes a provider. Deliberately
mirrors app/services/hook_reasoner/router.py's own shape and error discipline exactly (same
registry pattern, same honest-unconfigured default) -- but is a SEPARATE module, never a shared/
reused one, since Retention classification answers a different question and may be configured (or
not) completely independently of the other reasoners.

No persistence of any kind happens here or anywhere in this package -- this router only ever
returns a RetentionResult in memory. Durable storage is app.services.retention_classification_svc's
own, separate job.
"""
from app.config import settings

from .contract import RetentionReasoningError, RetentionResult
from .providers.anthropic_provider import AnthropicRetentionReasoner
from .providers.base import RetentionReasonerProvider

_REASONER_PROVIDERS: dict[str, RetentionReasonerProvider] = {
    "anthropic": AnthropicRetentionReasoner(),
}


async def classify_retention_candidate(evidence_bundle: dict) -> RetentionResult:
    """The one entry point Retention orchestration should call through — see this package's
    __init__.py. `evidence_bundle` is exactly the bounded local evidence bundle produced by
    app.services.retention_candidate_assembly_svc.assemble_candidate_evidence_bundle() —
    unmodified, not reshaped by this router. Called ONCE PER CANDIDATE, never once per video.

    Raises RetentionReasoningError, never returns a fabricated RetentionResult, when: no reasoner
    is configured (RETENTION_REASONER_PROVIDER is empty — the default, until an operator opts in);
    the configured name is not registered; the registered provider reports itself unconfigured
    (e.g. ANTHROPIC_API_KEY missing); the underlying call itself fails; or the response violates
    this contract's own structural prohibitions. A genuine "the evidence does not clearly support a
    device type" outcome is NOT one of these — it is a normal, successfully-returned
    RetentionResult whose own decision.device_type is "unclear".
    """
    provider_name = settings.RETENTION_REASONER_PROVIDER
    if not provider_name:
        raise RetentionReasoningError(
            "No Retention reasoner is configured (RETENTION_REASONER_PROVIDER is empty). "
            f"Set it to one of: {', '.join(sorted(_REASONER_PROVIDERS)) or '(none registered yet)'} "
            "to opt in explicitly — this is never a silent default."
        )

    provider = _REASONER_PROVIDERS.get(provider_name)
    if provider is None:
        raise RetentionReasoningError(
            f"RETENTION_REASONER_PROVIDER '{provider_name}' is not a recognized Retention reasoner "
            f"(expected one of: {', '.join(sorted(_REASONER_PROVIDERS)) or '(none registered yet)'})."
        )

    if not provider.is_configured():
        raise RetentionReasoningError(
            f"Retention reasoner '{provider_name}' is registered but not configured (missing its "
            "required secret or setting)."
        )

    decision = await provider.classify_retention_candidate(evidence_bundle, model=settings.RETENTION_REASONER_MODEL)
    return RetentionResult(
        decision=decision,
        provider=provider.name,
        model=settings.RETENTION_REASONER_MODEL,
        reasoning_contract_version=decision.reasoning_contract_version,
    )
