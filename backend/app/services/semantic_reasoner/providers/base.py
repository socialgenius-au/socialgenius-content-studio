"""The semantic-reasoner provider adapter interface -- the one shape every future provider (a
local/open-source model, Anthropic, OpenAI, a future multimodal model, a genuinely-validated
deterministic fallback) must implement, so router.py never needs to know which one it's actually
talking to. Deliberately mirrors app/services/ai/providers/base.py's own AIProvider shape (same
is_configured()-then-call structure, same "raise the shared error type, never fabricate a result"
discipline) rather than inventing a competing convention.

Stage 10.2B1 registers ZERO concrete implementations of this interface -- see router.py's own
empty provider registry and this package's own __init__.py.
"""
from abc import ABC, abstractmethod

from app.services.semantic_reasoner.contract import ReasonerDecision


class SemanticReasonerProvider(ABC):
    """One instance per provider, stateless aside from lazily caching its own SDK client (see
    app.services.ai.providers.anthropic_provider.AnthropicProvider for the pattern this should
    follow once a real implementation exists)."""

    name: str

    @abstractmethod
    def is_configured(self) -> bool:
        """Whether this provider has the secret(s)/setting(s) it needs -- checked by
        reason_about_boundary itself before making a call, not by the router, since only the
        provider knows what it actually needs (exact same division of responsibility as
        AIProvider.is_configured())."""

    @abstractmethod
    async def reason_about_boundary(self, evidence_bundle: dict, *, model: str) -> ReasonerDecision:
        """Answers exactly one question for exactly one candidate: given the coherent content
        immediately before and immediately after this candidate timestamp (per `evidence_bundle`,
        the unmodified per-candidate bundle Stage 10.2A already produces), does the after-content
        represent a genuinely distinct unit of coherent meaning from the before-content, rather
        than a continuation through a technical edit, pause, caption change, or visual change?

        Raises SemanticReasoningError (never returns a fabricated decision) if this provider is
        unconfigured, the underlying call fails for any reason, or its response cannot be parsed
        into a ReasonerDecision at all. A genuine "I examined the evidence and could not
        confidently tell" outcome is NOT an error -- it is a real ReasonerDecision with
        is_semantic_boundary=None (see contract.py's own docstring on why None != False).

        Must NEVER: translate/normalize the original transcript or OCR text found in
        `evidence_bundle` before persisting it anywhere (any translation a provider performs
        internally, if ever, stays strictly a private implementation detail — never overwrites
        canonical evidence); apply language-specific rules; hard-code any domain ontology
        (marketing/medical/educational/tutorial); or make any decision beyond the single question
        above (no hook/CTA/virality/Story-Beat/tutorial-teaching-point judgment).
        """
