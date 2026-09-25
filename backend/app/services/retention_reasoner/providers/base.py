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
        """Answers two separate questions about one already-grouped candidate moment, given only the
        bounded local evidence around it: what structural form does it take (device_type, assigned
        regardless of acceptance), and does it appear to function as a retention device
        (is_retention_device, with probable_attention_function when accepted)? Never decides the
        candidate's own boundaries or grouping -- that is retention_candidate_assembly_svc's own,
        already-complete job.

        Raises RetentionReasoningError (never returns a fabricated decision) if this provider is
        unconfigured, the underlying call fails for any reason, its response cannot be parsed into
        a RetentionDecision at all, or its response violates this contract's own structural
        prohibitions (an invented evidence id, an unsupported device_type value, or any actual-
        retention/attention/engagement/performance claim). A genuine, considered "the evidence
        does not support an attention-maintenance function here" outcome is NOT an error -- it is a
        real RetentionDecision with is_retention_device=False and probable_attention_function=None
        (device_type still describes the structural form, e.g. an ordinary cut, and is "unclear"
        only when even that structural form cannot be confidently identified).

        Must NEVER: invent evidence not present in `evidence_bundle`; infer or claim actual viewer
        retention, attention, engagement, or watch time; assign an effectiveness/quality score or a
        strong/weak rating of any kind; translate/normalize original transcript or OCR text before
        citing it; or independently re-time/re-group the candidate itself.
        """
