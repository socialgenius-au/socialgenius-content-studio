"""The Retention reasoner provider adapter interface -- the one shape every future provider must
implement, so router.py never needs to know which one it's actually talking to. Deliberately
mirrors app/services/hook_reasoner/providers/base.py's own shape exactly -- but is a SEPARATE
interface, never a shared/reused class, since the underlying question differs (see
app.services.retention_reasoner.contract's own docstring): one Hook call classifies a single fixed
window, while one Retention call classifies a single already-grouped CANDIDATE, of which a video
may have zero, one, or many.
"""
from abc import ABC, abstractmethod

from app.services.retention_reasoner.contract import RetentionDecision


class RetentionReasonerProvider(ABC):
    """One instance per provider, stateless aside from lazily caching its own SDK client (see
    app.services.retention_reasoner.providers.anthropic_provider.AnthropicRetentionReasoner for the
    pattern this should follow)."""

    name: str

    @abstractmethod
    def is_configured(self) -> bool:
        """Whether this provider has the secret(s)/setting(s) it needs -- checked by
        classify_retention_candidate itself before making a call, not by the router."""

    @abstractmethod
    async def classify_retention_candidate(self, evidence_bundle: dict, *, model: str) -> RetentionDecision:
        """Answers exactly one question: given the bounded local evidence around one already-
        grouped candidate moment, does it appear to function as a retention device, and if so which
        kind? Never decides the candidate's own boundaries or grouping -- that is
        retention_candidate_assembly_svc's own, already-complete job.

        Raises RetentionReasoningError (never returns a fabricated decision) if this provider is
        unconfigured, the underlying call fails for any reason, its response cannot be parsed into
        a RetentionDecision at all, or its response violates this contract's own structural
        prohibitions (an invented evidence id, an unsupported device_type value, or any actual-
        retention/attention/engagement/performance claim). A genuine "the evidence does not clearly
        support a device type" outcome is NOT an error -- it is a real RetentionDecision with
        device_type="unclear".

        Must NEVER: invent evidence not present in `evidence_bundle`; infer or claim actual viewer
        retention, attention, engagement, or watch time; assign an effectiveness/quality score or a
        strong/weak rating of any kind; translate/normalize original transcript or OCR text before
        citing it; or independently re-time/re-group the candidate itself.
        """
