"""The Stage 10.3B Story Beat Reasoner router — the one place that decides which provider actually
reasons about a given candidate, so Stage 10 orchestration never hard-codes a provider. Deliberately
mirrors app/services/semantic_reasoner/router.py's own reason_about_boundary() shape and error
discipline exactly (same registry pattern, same honest-unconfigured default) -- but is a SEPARATE
module, never a shared/reused one, since the two reasoners answer different questions and may be
configured (or not) completely independently of one another:

    reason_about_story_beat_boundary(evidence_bundle)
      -> resolve provider: settings.STORY_BEAT_REASONER_PROVIDER
      -> look it up in _REASONER_PROVIDERS
      -> confirm it is configured
      -> call that provider's adapter (providers/) and return its normalized StoryBeatResult

Stage 10.3B2 registers the first real provider (AnthropicStoryBeatReasoner) below, but
STORY_BEAT_REASONER_PROVIDER still defaults to "" (see app/config.py) — an operator must explicitly
opt in, and AnthropicStoryBeatReasoner.is_configured() still gates every call on ANTHROPIC_API_KEY
actually being set. "Registered" is not "on by default".

No persistence of any kind happens here or anywhere in this package -- this router only ever
returns a StoryBeatResult in memory. Durable storage remains an explicitly deferred, later phase
(mirroring how the Semantic Scene reasoner's own durable store, app.services.
semantic_boundary_reasoning_store_svc, arrived a full separate phase after its router did).
"""
from app.config import settings

from .contract import StoryBeatReasoningError, StoryBeatResult
from .providers.anthropic_provider import AnthropicStoryBeatReasoner
from .providers.base import StoryBeatReasonerProvider

# One instance per provider — see this module's own docstring. Stateless aside from lazily caching
# its own SDK client (via app.services.claude.get_client()), so this is safe to share across every
# request/call, exactly like semantic_reasoner/router.py's own _REASONER_PROVIDERS dict.
_REASONER_PROVIDERS: dict[str, StoryBeatReasonerProvider] = {
    "anthropic": AnthropicStoryBeatReasoner(),
}


async def reason_about_story_beat_boundary(evidence_bundle: dict) -> StoryBeatResult:
    """The one entry point Stage 10 orchestration should call through — see this package's
    __init__.py. `evidence_bundle` is exactly one candidate's own bundle as produced by
    app.services.semantic_boundary_assembly_svc.assemble_semantic_boundary_candidates() —
    unmodified, not reshaped by this router (Stage 10.3A's own audit confirmed this bundle is
    reusable, unmodified, for Story Beat candidates too).

    Raises StoryBeatReasoningError, never returns a fabricated StoryBeatResult, when: no reasoner
    is configured (STORY_BEAT_REASONER_PROVIDER is empty — the default, until an operator opts
    in); the configured name is not registered; the registered provider reports itself
    unconfigured (e.g. ANTHROPIC_API_KEY missing); or the underlying call itself fails. A genuine
    "the reasoner tried and could not confidently tell" outcome is NOT one of these — it is a
    normal, successfully-returned StoryBeatResult whose own decision.is_story_beat_boundary is
    None.
    """
    provider_name = settings.STORY_BEAT_REASONER_PROVIDER
    if not provider_name:
        raise StoryBeatReasoningError(
            "No Story Beat reasoner is configured (STORY_BEAT_REASONER_PROVIDER is empty). "
            f"Set it to one of: {', '.join(sorted(_REASONER_PROVIDERS)) or '(none registered yet)'} "
            "to opt in explicitly — this is never a silent default."
        )

    provider = _REASONER_PROVIDERS.get(provider_name)
    if provider is None:
        raise StoryBeatReasoningError(
            f"STORY_BEAT_REASONER_PROVIDER '{provider_name}' is not a recognized Story Beat "
            f"reasoner (expected one of: {', '.join(sorted(_REASONER_PROVIDERS)) or '(none registered yet)'})."
        )

    if not provider.is_configured():
        raise StoryBeatReasoningError(
            f"Story Beat reasoner '{provider_name}' is registered but not configured (missing its "
            "required secret or setting)."
        )

    candidate_timestamp = evidence_bundle["candidate_timestamp"]
    decision = await provider.reason_about_story_beat_boundary(evidence_bundle, model=settings.STORY_BEAT_REASONER_MODEL)
    return StoryBeatResult(
        decision=decision,
        provider=provider.name,
        model=settings.STORY_BEAT_REASONER_MODEL,
        candidate_timestamp=candidate_timestamp,
        # Copied straight from the decision the provider itself returned -- this router has no
        # provider-specific knowledge of its own; the provider is the only place that knows which
        # prompt/reasoning-contract version it actually used.
        reasoning_contract_version=decision.reasoning_contract_version,
    )
