"""The Stage 10.2B Semantic Boundary Reasoner router — the one place that decides which provider
actually reasons about a given candidate, so Stage 10 orchestration never hard-codes a provider.
Deliberately mirrors app/services/ai/router.py's own generate_text() shape and error discipline:

    reason_about_boundary(evidence_bundle)
      -> resolve provider: settings.SEMANTIC_REASONER_PROVIDER
      -> look it up in _REASONER_PROVIDERS
      -> confirm it is configured
      -> call that provider's adapter (providers/) and return its normalized ReasonerResult

Stage 10.2B2 registers the first real provider (AnthropicSemanticReasoner) below, but
SEMANTIC_REASONER_PROVIDER still defaults to "" (see app/config.py) — an operator must explicitly
opt in, and AnthropicSemanticReasoner.is_configured() still gates every call on ANTHROPIC_API_KEY
actually being set. "Registered" is not "on by default": this is the same honest-unconfigured
discipline the Stage 10.2B architecture audit required (Section 6/7), now with a real
implementation behind it instead of an empty registry.
"""
from app.config import settings

from .contract import ReasonerResult, SemanticReasoningError
from .providers.anthropic_provider import AnthropicSemanticReasoner
from .providers.base import SemanticReasonerProvider

# One instance per provider — see this module's own docstring. Stateless aside from lazily
# caching its own SDK client (via app.services.claude.get_client()), so this is safe to share
# across every request/call, exactly like app/services/ai/router.py's own _PROVIDERS dict.
_REASONER_PROVIDERS: dict[str, SemanticReasonerProvider] = {
    "anthropic": AnthropicSemanticReasoner(),
}


async def reason_about_boundary(evidence_bundle: dict) -> ReasonerResult:
    """The one entry point Stage 10 orchestration should call through — see this package's
    __init__.py. `evidence_bundle` is exactly one candidate's own bundle as produced by
    app.services.semantic_boundary_assembly_svc.assemble_semantic_boundary_candidates() —
    unmodified, not reshaped by this router.

    Raises SemanticReasoningError, never returns a fabricated ReasonerResult, when: no reasoner
    is configured (SEMANTIC_REASONER_PROVIDER is empty — the default, until an operator opts in);
    the configured name is not registered; the registered provider reports itself unconfigured
    (e.g. ANTHROPIC_API_KEY missing); or the underlying call itself fails. A genuine "the
    reasoner tried and could not confidently tell" outcome is NOT one of these — it is a normal,
    successfully-returned ReasonerResult whose own decision.is_semantic_boundary is None.
    """
    provider_name = settings.SEMANTIC_REASONER_PROVIDER
    if not provider_name:
        raise SemanticReasoningError(
            "No semantic boundary reasoner is configured (SEMANTIC_REASONER_PROVIDER is empty). "
            f"Set it to one of: {', '.join(sorted(_REASONER_PROVIDERS)) or '(none registered yet)'} "
            "to opt in explicitly — this is never a silent default."
        )

    provider = _REASONER_PROVIDERS.get(provider_name)
    if provider is None:
        raise SemanticReasoningError(
            f"SEMANTIC_REASONER_PROVIDER '{provider_name}' is not a recognized semantic reasoner "
            f"(expected one of: {', '.join(sorted(_REASONER_PROVIDERS)) or '(none registered yet)'})."
        )

    if not provider.is_configured():
        raise SemanticReasoningError(
            f"Semantic reasoner '{provider_name}' is registered but not configured (missing its "
            "required secret or setting)."
        )

    candidate_timestamp = evidence_bundle["candidate_timestamp"]
    decision = await provider.reason_about_boundary(evidence_bundle, model=settings.SEMANTIC_REASONER_MODEL)
    return ReasonerResult(
        decision=decision,
        provider=provider.name,
        model=settings.SEMANTIC_REASONER_MODEL,
        candidate_timestamp=candidate_timestamp,
        # Copied straight from the decision the provider itself returned -- this router has no
        # provider-specific knowledge of its own; the provider is the only place that knows which
        # prompt/reasoning-contract version it actually used (Stage 10.2B5).
        reasoning_contract_version=decision.reasoning_contract_version,
    )
