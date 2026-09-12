"""Stage 11.4 — Retention Reasoner: a sibling package to app.services.hook_reasoner, following the
exact same provider-independent contract shape.

    Retention orchestration (app.services.retention_classification_svc)
      -> classify_retention_candidate(evidence_bundle)        <- this package's public entry point,
                                                                   called ONCE PER CANDIDATE
      -> router._REASONER_PROVIDERS["anthropic"]               (registered Stage 11.4)
      -> providers.anthropic_provider.AnthropicRetentionReasoner (a future local/OpenAI/etc.
         provider can be added the same way, without this package's own callers changing at all)

Only classify_retention_candidate, RetentionDecision, RetentionResult, and RetentionReasoningError
are meant to be imported from outside this package — which provider is active (if any), and how its
own call is made, are internal implementation details the caller never needs.

Runs ONLY when an operator explicitly opts in by setting RETENTION_REASONER_PROVIDER="anthropic"
(default: "", unconfigured) AND has ANTHROPIC_API_KEY set — calling classify_retention_candidate
with neither set still raises RetentionReasoningError, never a fabricated result.

NO PERSISTENCE of any kind exists anywhere in this package — every call returns an in-memory
RetentionResult only. Durable storage is app.services.retention_classification_svc's own, separate
job.
"""
from app.services.retention_reasoner.contract import (
    RETENTION_DEVICE_TYPE_VALUES,
    RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR,
    VALID_CONFIDENCE_LEVELS,
    VALID_EVIDENCE_REFERENCE_KEYS,
    RetentionDecision,
    RetentionReasoningError,
    RetentionResult,
)
from app.services.retention_reasoner.router import classify_retention_candidate

__all__ = [
    "VALID_CONFIDENCE_LEVELS",
    "VALID_EVIDENCE_REFERENCE_KEYS",
    "RETENTION_DEVICE_TYPE_VALUES",
    "RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR",
    "RetentionDecision",
    "RetentionReasoningError",
    "RetentionResult",
    "classify_retention_candidate",
]
