"""Stage 11.3 — Hook Reasoner: a sibling package to app.services.semantic_reasoner and
app.services.story_beat_reasoner, following the exact same provider-independent contract shape.

    Hook orchestration (app.services.hook_classification_svc)
      -> classify_hook(evidence_bundle)                      <- this package's public entry point
      -> router._REASONER_PROVIDERS["anthropic"]              (registered Stage 11.3)
      -> providers.anthropic_provider.AnthropicHookReasoner    (a future local/OpenAI/etc.
         provider can be added the same way, without this package's own callers changing at all)

Only classify_hook, HookDecision, HookElement, HookResult, and HookReasoningError are meant to be
imported from outside this package — which provider is active (if any), and how its own call is
made, are internal implementation details the caller never needs.

Runs ONLY when an operator explicitly opts in by setting HOOK_REASONER_PROVIDER="anthropic"
(default: "", unconfigured) AND has ANTHROPIC_API_KEY set — calling classify_hook with neither set
still raises HookReasoningError, never a fabricated result.

NO PERSISTENCE of any kind exists anywhere in this package — every call returns an in-memory
HookResult only. Durable storage is app.services.hook_classification_svc's own, separate job.
"""
from app.services.hook_reasoner.contract import (
    HOOK_INTENT_VALUES,
    HOOK_TYPE_VALUES,
    PRIMARY_HOOK_TYPE_VALUES,
    VALID_CONFIDENCE_LEVELS,
    VALID_EVIDENCE_REFERENCE_KEYS,
    HookDecision,
    HookElement,
    HookReasoningError,
    HookResult,
)
from app.services.hook_reasoner.router import classify_hook

__all__ = [
    "VALID_CONFIDENCE_LEVELS",
    "VALID_EVIDENCE_REFERENCE_KEYS",
    "HOOK_TYPE_VALUES",
    "PRIMARY_HOOK_TYPE_VALUES",
    "HOOK_INTENT_VALUES",
    "HookDecision",
    "HookElement",
    "HookReasoningError",
    "HookResult",
    "classify_hook",
]
