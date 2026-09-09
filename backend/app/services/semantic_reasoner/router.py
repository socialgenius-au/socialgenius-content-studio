"""The Stage 10.2B Semantic Boundary Reasoner router — the one place that decides which provider
actually reasons about a given candidate, so Stage 10 orchestration never hard-codes a provider.
Deliberately mirrors app/services/ai/router.py's own generate_text() shape and error discipline:

    reason_about_boundary(evidence_bundle)
      -> resolve provider: settings.SEMANTIC_REASONER_PROVIDER
      -> look it up in _REASONER_PROVIDERS
      -> confirm it is configured
      -> call that provider's adapter (providers/) and return its normalized ReasonerResult

Stage 10.2B1 registers ZERO real providers — _REASONER_PROVIDERS is deliberately empty, so every
call raises SemanticReasoningError ("no semantic reasoner configured") today. This is the honest
default the Stage 10.2B architecture audit required (Section 6/7): "unconfigured" is not "false".
A future Stage 10.2B2+ populates this dict with its first real implementation, exactly the way
app/services/ai/router.py's own _PROVIDERS dict already holds AnthropicProvider/OpenAIProvider/
GoogleProvider.
"""
from app.config import settings

from .contract import ReasonerResult, SemanticReasoningError
from .providers.base import SemanticReasonerProvider

# One instance per provider — see this module's own docstring. Empty as of Stage 10.2B1.
_REASONER_PROVIDERS: dict[str, SemanticReasonerProvider] = {}


async def reason_about_boundary(evidence_bundle: dict) -> ReasonerResult:
    """The one entry point Stage 10 orchestration should call through — see this package's
    __init__.py. `evidence_bundle` is exactly one candidate's own bundle as produced by
    app.services.semantic_boundary_assembly_svc.assemble_semantic_boundary_candidates() —
    unmodified, not reshaped by this router.

    Raises SemanticReasoningError, never returns a fabricated ReasonerResult, when: no reasoner
    is configured (SEMANTIC_REASONER_PROVIDER is empty — true for every call in Stage 10.2B1,
    since no real provider exists yet); the configured name is not registered; the registered
    provider reports itself unconfigured; or the underlying call itself fails. A genuine "the
    reasoner tried and could not confidently tell" outcome is NOT one of these — it is a normal,
    successfully-returned ReasonerResult whose own decision.is_semantic_boundary is None.
    """
    provider_name = settings.SEMANTIC_REASONER_PROVIDER
    if not provider_name:
        raise SemanticReasoningError(
            "No semantic boundary reasoner is configured (SEMANTIC_REASONER_PROVIDER is empty). "
            "Stage 10.2B1 ships this contract with zero real reasoners — see "
            "app/services/semantic_reasoner/router.py's own _REASONER_PROVIDERS for how a future "
            "phase registers one."
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
    )
