"""Stage 10.3 — Story Beat Reasoner: a sibling package to app.services.semantic_reasoner,
following the exact same provider-independent contract shape (see contract.py's own docstring for
why the two contracts are deliberately separate, never shared).

Stage 10.3B1 ships ONLY the contract (StoryBeatDecision, StoryBeatResult,
StoryBeatReasoningError, VALID_EVIDENCE_REFERENCE_KEYS) -- no provider, no router, no
`reason_about_story_beat()` entry point exists yet. Calling any Story Beat reasoning is not yet
possible; this package currently defines only the SHAPE a future reasoning result must take,
exactly mirroring how app.services.semantic_reasoner.contract (Stage 10.2B1) preceded its own
first real provider (Stage 10.2B2) by one full, separately-reviewed phase.
"""
from app.services.story_beat_reasoner.contract import (
    VALID_CONFIDENCE_LEVELS,
    VALID_EVIDENCE_REFERENCE_KEYS,
    StoryBeatDecision,
    StoryBeatReasoningError,
    StoryBeatResult,
)

__all__ = [
    "VALID_CONFIDENCE_LEVELS",
    "VALID_EVIDENCE_REFERENCE_KEYS",
    "StoryBeatDecision",
    "StoryBeatReasoningError",
    "StoryBeatResult",
]
