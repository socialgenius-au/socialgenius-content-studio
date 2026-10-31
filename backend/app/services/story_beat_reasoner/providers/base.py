"""The Story Beat reasoner provider adapter interface -- the one shape every future provider (a
local/open-source model, Anthropic, OpenAI, a future multimodal model) must implement, so
router.py never needs to know which one it's actually talking to. Deliberately mirrors
app/services/semantic_reasoner/providers/base.py's own shape (same is_configured()-then-call
structure, same "raise the shared error type, never fabricate a result" discipline) -- but is a
SEPARATE interface, never a shared/reused class, because the underlying question differs (see
app.services.story_beat_reasoner.contract's own docstring).

Stage 10.3B1 shipped ZERO concrete implementations of this interface -- Stage 10.3B2 registers the
first one (AnthropicStoryBeatReasoner) below.
"""
from abc import ABC, abstractmethod

from app.services.story_beat_reasoner.contract import StoryBeatDecision


class StoryBeatReasonerProvider(ABC):
    """One instance per provider, stateless aside from lazily caching its own SDK client (see
    app.services.story_beat_reasoner.providers.anthropic_provider.AnthropicStoryBeatReasoner for
    the pattern this should follow)."""

    name: str

    @abstractmethod
    def is_configured(self) -> bool:
        """Whether this provider has the secret(s)/setting(s) it needs -- checked by
        reason_about_story_beat_boundary itself before making a call, not by the router, since
        only the provider knows what it actually needs (same division of responsibility as
        SemanticReasonerProvider.is_configured())."""

    @abstractmethod
    async def reason_about_story_beat_boundary(self, evidence_bundle: dict, *, model: str) -> StoryBeatDecision:
        """Answers exactly one question for exactly one candidate: at this candidate moment, does
        the source make a genuinely distinguishable rhetorical/communicative move, even if the
        underlying topic/proposition/function stays exactly the same? This is deliberately NOT
        "does a new Semantic Scene begin here" -- see contract.py's own docstring for the exact
        distinction.

        Raises StoryBeatReasoningError (never returns a fabricated decision) if this provider is
        unconfigured, the underlying call fails for any reason, or its response cannot be parsed
        into a StoryBeatDecision at all. A genuine "I examined the evidence and could not
        confidently tell" outcome is NOT an error -- it is a real StoryBeatDecision with
        is_story_beat_boundary=None.

        Must NEVER: translate/normalize the original transcript or OCR text found in
        `evidence_bundle` before persisting it anywhere; apply language-specific rules; hard-code
        any domain ontology (marketing/medical/educational/tutorial); assign, name, or return a
        Story Beat type/function/role of any kind; or require/depend on a Semantic Scene boundary
        existing nearby.
        """
