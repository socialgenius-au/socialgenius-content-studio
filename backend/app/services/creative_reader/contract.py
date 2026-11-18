"""Creative Read: the model-independent result of letting an AI LOOK at selected keyframes of a reference video next to the measured evidence (timing, speech, on-screen text).

What it is for: evidence-backed, hedged observations about how a video holds attention and persuades, phrased so the reusable part (a mechanism and a transferable principle) is separate from
what is specific to this one video. What it must never be: a performance verdict, a copy of the source's wording, or a conclusion the cited evidence does not support.

Every finding therefore carries: a kind, a hedged statement, a time range, the shots it concerns, the ids of the evidence it cites (frames the model was shown, speech segments, on-screen text, shots),
a categorical confidence, and a mechanism type from the existing C3 vocabulary. Certainty is always INFERRED with basis `ai_vision`. See validation.py for what is enforced in code.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.services.mechanism_reasoner.contract import MECHANISM_TYPES

CREATIVE_READ_PROMPT_VERSION = "cr-v1"
CREATIVE_READ_SCHEMA = "creative-read-v1"
FINDING_KINDS = ("hook_visual", "attention_focus", "emotional_register", "persuasion_device", "visual_pattern", "audio_visual_relation", "text_use")
EVIDENCE_TYPES = ("frame", "speech", "text", "shot")
VALID_CONFIDENCE = ("low", "medium", "high")
CONFIDENCE_SCORE = {"low": 0.3, "medium": 0.6, "high": 0.85}
MECHANISM_VOCABULARY = tuple(sorted(MECHANISM_TYPES))


class CreativeReadError(Exception):
    """No reasoner configured / the call failed / the response was unparseable or broke a rule (nothing is persisted)."""


class CreativeReadInputError(Exception):
    """The evidence needed to look at the video is missing (for example no keyframes on disk). Nothing was sent to the AI."""


@dataclass(frozen=True)
class ShotRead:
    shot_order: int
    focal_subject: str
    framing: str
    notes: str | None = None


@dataclass(frozen=True)
class Finding:
    kind: str
    statement: str
    start_time: float
    end_time: float
    shot_orders: list[int]
    evidence: list[dict]                  # [{"type": "frame"|"speech"|"text"|"shot", "id": int}]
    confidence: str
    mechanism_type: str
    transferable_principle: str | None = None
    source_specific: str | None = None


@dataclass(frozen=True)
class CreativeReadResult:
    summary: str
    shots: list[ShotRead]
    findings: list[Finding]
    limitations: list[str] = field(default_factory=list)
    model: str = ""
    prompt_version: str = CREATIVE_READ_PROMPT_VERSION
    usage: dict = field(default_factory=dict)
