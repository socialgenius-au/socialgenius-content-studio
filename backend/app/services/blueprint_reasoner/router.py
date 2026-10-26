"""The C4 Blueprint Reasoner router -- the one place that decides which provider derives the blueprint, and the one place
the provider-independent deterministic validation is applied, so orchestration never hard-codes a provider and no provider
can bypass the safeguards. Same registry pattern and honest-unconfigured default as the Hook/Retention/Mechanism routers.

No persistence happens here -- only an in-memory BlueprintResult is returned (see app.services.reconstruction_blueprint_svc).
"""
from app.config import settings

from .contract import BlueprintReasoningError, BlueprintResult
from .provider_input import build_reasoner_input
from .providers.anthropic_provider import AnthropicBlueprintReasoner
from .providers.base import BlueprintReasonerProvider
from .validation import BlueprintContext, validate_decision

_REASONER_PROVIDERS: dict[str, BlueprintReasonerProvider] = {
    "anthropic": AnthropicBlueprintReasoner(),
}


def _registered() -> str:
    return ", ".join(sorted(_REASONER_PROVIDERS)) or "(none registered yet)"


async def derive_blueprint(ctx: BlueprintContext) -> BlueprintResult:
    """The one entry point blueprint orchestration should call. Raises BlueprintReasoningError, never a fabricated result,
    when no reasoner is configured (BLUEPRINT_REASONER_PROVIDER empty -- the default, until an operator opts in), the name is
    not registered, the provider is unconfigured or fails, or the response violates the contract or any deterministic
    safeguard in validation.validate_decision."""
    provider_name = settings.BLUEPRINT_REASONER_PROVIDER
    if not provider_name:
        raise BlueprintReasoningError(
            "No Blueprint reasoner is configured (BLUEPRINT_REASONER_PROVIDER is empty). "
            f"Set it to one of: {_registered()} to opt in explicitly -- this is never a silent default.")
    provider = _REASONER_PROVIDERS.get(provider_name)
    if provider is None:
        raise BlueprintReasoningError(
            f"BLUEPRINT_REASONER_PROVIDER '{provider_name}' is not a recognized Blueprint reasoner (expected one of: {_registered()}).")
    if not provider.is_configured():
        raise BlueprintReasoningError(
            f"Blueprint reasoner '{provider_name}' is registered but not configured (missing its required secret or setting).")

    decision = await provider.derive_blueprint(build_reasoner_input(ctx), model=settings.BLUEPRINT_REASONER_MODEL)
    validate_decision(decision, ctx)
    return BlueprintResult(
        decision=decision, provider=provider.name, model=settings.BLUEPRINT_REASONER_MODEL,
        reasoning_contract_version=decision.reasoning_contract_version)
