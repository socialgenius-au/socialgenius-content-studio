"""The Stage 11.3 Hook Reasoner router — the one place that decides which provider actually
classifies a given Hook Window, so Hook orchestration never hard-codes a provider. Deliberately
mirrors app/services/story_beat_reasoner/router.py's own shape and error discipline exactly (same
registry pattern, same honest-unconfigured default) -- but is a SEPARATE module, never a shared/
reused one, since Hook classification answers a different question and may be configured (or not)
completely independently of the other two reasoners.

No persistence of any kind happens here or anywhere in this package -- this router only ever
returns a HookResult in memory. Durable storage is app.services.hook_classification_svc's own,
separate job.
"""
from app.config import settings

from .contract import HookReasoningError, HookResult
from .providers.anthropic_provider import AnthropicHookReasoner
from .providers.base import HookReasonerProvider

_REASONER_PROVIDERS: dict[str, HookReasonerProvider] = {
    "anthropic": AnthropicHookReasoner(),
}


async def classify_hook(evidence_bundle: dict) -> HookResult:
    """The one entry point Hook orchestration should call through — see this package's
    __init__.py. `evidence_bundle` is exactly the bounded Hook evidence bundle produced by
    app.services.hook_evidence_assembly_svc.assemble_hook_evidence_bundle() — unmodified, not
    reshaped by this router.

    Raises HookReasoningError, never returns a fabricated HookResult, when: no reasoner is
    configured (HOOK_REASONER_PROVIDER is empty — the default, until an operator opts in); the
    configured name is not registered; the registered provider reports itself unconfigured (e.g.
    ANTHROPIC_API_KEY missing); the underlying call itself fails; or the response violates this
    contract's own structural prohibitions. A genuine "the evidence does not clearly indicate a
    type" outcome is NOT one of these — it is a normal, successfully-returned HookResult whose own
    decision.primary_type is "unclear".
    """
    provider_name = settings.HOOK_REASONER_PROVIDER
    if not provider_name:
        raise HookReasoningError(
            "No Hook reasoner is configured (HOOK_REASONER_PROVIDER is empty). "
            f"Set it to one of: {', '.join(sorted(_REASONER_PROVIDERS)) or '(none registered yet)'} "
            "to opt in explicitly — this is never a silent default."
        )

    provider = _REASONER_PROVIDERS.get(provider_name)
    if provider is None:
        raise HookReasoningError(
            f"HOOK_REASONER_PROVIDER '{provider_name}' is not a recognized Hook reasoner "
            f"(expected one of: {', '.join(sorted(_REASONER_PROVIDERS)) or '(none registered yet)'})."
        )

    if not provider.is_configured():
        raise HookReasoningError(
            f"Hook reasoner '{provider_name}' is registered but not configured (missing its "
            "required secret or setting)."
        )

    decision = await provider.classify_hook(evidence_bundle, model=settings.HOOK_REASONER_MODEL)
    return HookResult(
        decision=decision,
        provider=provider.name,
        model=settings.HOOK_REASONER_MODEL,
        reasoning_contract_version=decision.reasoning_contract_version,
    )
