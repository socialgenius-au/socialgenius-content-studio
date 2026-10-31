"""The Hook reasoner provider adapter interface -- the one shape every future provider (a local/
open-source model, Anthropic, OpenAI, a future multimodal model) must implement, so router.py never
needs to know which one it's actually talking to. Deliberately mirrors
app/services/story_beat_reasoner/providers/base.py's own shape exactly -- but is a SEPARATE
interface, never a shared/reused class, since the underlying question differs (see
app.services.hook_reasoner.contract's own docstring).
"""
from abc import ABC, abstractmethod

from app.services.hook_reasoner.contract import HookDecision


class HookReasonerProvider(ABC):
    """One instance per provider, stateless aside from lazily caching its own SDK client (see
    app.services.hook_reasoner.providers.anthropic_provider.AnthropicHookReasoner for the pattern
    this should follow)."""

    name: str

    @abstractmethod
    def is_configured(self) -> bool:
        """Whether this provider has the secret(s)/setting(s) it needs -- checked by classify_hook
        itself before making a call, not by the router, since only the provider knows what it
        actually needs (same division of responsibility as the other two reasoners)."""

    @abstractmethod
    async def classify_hook(self, evidence_bundle: dict, *, model: str) -> HookDecision:
        """Answers exactly one question: given the evidence inside an already-fixed Hook Window,
        what kind of hook appears there, what elements compose it, and what apparent intent does
        it serve? Never decides the window itself -- that is Stage 11.2's own, already-locked job.

        Raises HookReasoningError (never returns a fabricated decision) if this provider is
        unconfigured, the underlying call fails for any reason, its response cannot be parsed into
        a HookDecision at all, or its response violates this contract's own structural
        prohibitions (an invented evidence id, an unsupported type value, or any performance/
        retention/virality/conversion/effectiveness claim). A genuine "the evidence does not
        clearly indicate a type" outcome is NOT an error -- it is a real HookDecision with
        primary_type="unclear".

        Must NEVER: invent evidence not present in `evidence_bundle`; infer or claim viewer
        response, retention, conversion, or virality; assign an effectiveness/quality score or a
        strong/weak rating of any kind; translate/normalize original transcript or OCR text before
        citing it; or independently re-derive/adjust the Hook Window's own boundaries.
        """
