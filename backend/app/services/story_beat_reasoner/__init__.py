"""Stage 10.3 — Story Beat Reasoner: a sibling package to app.services.semantic_reasoner,
following the exact same provider-independent contract shape (see contract.py's own docstring for
why the two contracts are deliberately separate, never shared).

    Stage 10 orchestration (future)
      -> reason_about_story_beat_boundary(evidence_bundle)   <- this package's public entry point
      -> router._REASONER_PROVIDERS["anthropic"]              (registered Stage 10.3B2)
      -> providers.anthropic_provider.AnthropicStoryBeatReasoner (a future local/OpenAI/etc.
         provider can be added the same way, without this package's own callers changing at all)

Only reason_about_story_beat_boundary, StoryBeatDecision, StoryBeatResult, and
StoryBeatReasoningError are meant to be imported from outside this package — which provider is
active (if any), and how its own call is made, are internal implementation details the caller
never needs.

Stage 10.3B1 shipped ONLY the contract (StoryBeatDecision, StoryBeatResult,
StoryBeatReasoningError, VALID_EVIDENCE_REFERENCE_KEYS) — no provider, no router, no
`reason_about_story_beat_boundary()` entry point existed yet. Stage 10.3B2 registers the first
REAL reasoner (Anthropic Claude, reusing app.services.claude's own already-configured client), but
it runs ONLY when an operator explicitly opts in by setting STORY_BEAT_REASONER_PROVIDER="anthropic"
(default: "", unconfigured) AND has ANTHROPIC_API_KEY set — calling
reason_about_story_beat_boundary with neither set still raises StoryBeatReasoningError, never a
fabricated result.

NO PERSISTENCE of any kind exists anywhere in this package as of Stage 10.3B2 — every call returns
an in-memory StoryBeatResult only. No durable Story Beat storage, no Storyboard API/UI, and no
Stage 10.2 modification exist yet; all remain explicitly deferred, later phases.
"""
from app.services.story_beat_reasoner.contract import (
    VALID_CONFIDENCE_LEVELS,
    VALID_EVIDENCE_REFERENCE_KEYS,
    StoryBeatDecision,
    StoryBeatReasoningError,
    StoryBeatResult,
)
from app.services.story_beat_reasoner.router import reason_about_story_beat_boundary

__all__ = [
    "VALID_CONFIDENCE_LEVELS",
    "VALID_EVIDENCE_REFERENCE_KEYS",
    "StoryBeatDecision",
    "StoryBeatReasoningError",
    "StoryBeatResult",
    "reason_about_story_beat_boundary",
]
