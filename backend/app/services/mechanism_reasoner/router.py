"""The C3 Mechanism Reasoner router -- the one place that decides which provider derives mechanisms, and
the one place the provider-independent validation is applied, so orchestration never hard-codes a provider
and no provider can bypass the safeguards. Same registry pattern and honest-unconfigured default as the
Hook/Retention routers.

No persistence happens here or anywhere in this package -- only an in-memory MechanismResult is returned.
Durable storage is app.services.transferable_mechanism_svc's own, separate job.
"""
from app.config import settings

from .anatomy_input import build_reasoner_input, validate_anatomy_input
from .contract import MechanismReasoningError, MechanismResult
from .providers.anthropic_provider import AnthropicMechanismReasoner
from .providers.base import MechanismReasonerProvider
from .validation import validate_decision

_REASONER_PROVIDERS: dict[str, MechanismReasonerProvider] = {
    "anthropic": AnthropicMechanismReasoner(),
}


def _registered() -> str:
    return ", ".join(sorted(_REASONER_PROVIDERS)) or "(none registered yet)"


async def derive_mechanisms(anatomy: dict) -> MechanismResult:
    """The one entry point mechanism orchestration should call. `anatomy` is exactly the C2 /anatomy response
    (unmodified). Raises MechanismInputError for an unusable anatomy (e.g. zero sections) BEFORE any provider is
    considered; MechanismReasoningError, never a fabricated result, when no reasoner is configured
    (MECHANISM_REASONER_PROVIDER empty -- the default, until an operator opts in), the name is not registered,
    the provider is unconfigured or fails, or the response violates the contract or any safeguard in
    validation.validate_decision. `mechanisms == []` is a normal, successful result."""
    validate_anatomy_input(anatomy)

    provider_name = settings.MECHANISM_REASONER_PROVIDER
    if not provider_name:
        raise MechanismReasoningError(
            "No Mechanism reasoner is configured (MECHANISM_REASONER_PROVIDER is empty). "
            f"Set it to one of: {_registered()} to opt in explicitly -- this is never a silent default."
        )
    provider = _REASONER_PROVIDERS.get(provider_name)
    if provider is None:
        raise MechanismReasoningError(
            f"MECHANISM_REASONER_PROVIDER '{provider_name}' is not a recognized Mechanism reasoner (expected one of: {_registered()})."
        )
    if not provider.is_configured():
        raise MechanismReasoningError(
            f"Mechanism reasoner '{provider_name}' is registered but not configured (missing its required secret or setting)."
        )

    decision = await provider.derive_mechanisms(build_reasoner_input(anatomy), model=settings.MECHANISM_REASONER_MODEL)
    validate_decision(decision, anatomy)
    return MechanismResult(
        decision=decision, provider=provider.name, model=settings.MECHANISM_REASONER_MODEL,
        reasoning_contract_version=decision.reasoning_contract_version,
    )
