"""Stage 10.2B — the model-independent semantic-boundary reasoning CONTRACT: the one result shape
every future provider (a local/open-source model, Anthropic, OpenAI, a future multimodal model, a
genuinely-validated deterministic fallback) must produce, so Stage 10 orchestration never needs to
know which one actually answered a given candidate.

Deliberately mirrors app/services/ai/providers/base.py's own AIResult/AIProviderError shape (see
that module) rather than inventing a competing convention -- the two contracts stay SEPARATE
because they answer structurally different questions: AIResult carries freeform generated TEXT for
AI Tools (prompt/hook/script generation); ReasonerDecision carries a STRUCTURED semantic DECISION
about one candidate boundary. Sharing one dataclass between the two would force one of them to
grow fields the other doesn't need.

Stage 10.2B1 ships this contract with ZERO real reasoning behind it -- see router.py's own empty
provider registry. Nothing here makes, or is capable of making, an actual semantic judgment.
"""
from dataclasses import dataclass, field

# The three confidence levels this contract accepts -- a bounded, categorical vocabulary chosen
# deliberately over a bare float: an LLM's own self-reported "0.87" is not a calibrated
# probability and would be fabricated precision if presented as one (see the Stage 10.2B
# architecture audit's own Section 8). `confidence_score` below exists ALONGSIDE this categorical
# value for the rarer case a specific future provider genuinely reports a calibrated numeric
# signal (logprobs, embedding similarity) -- mirroring this schema's own long-established
# certainty (categorical, required) + confidence_score (numeric, optional) split already used on
# every analytical row (Scene, Shot, TextElement, VisualObject, AnalysisAnnotation).
VALID_CONFIDENCE_LEVELS = ("low", "medium", "high")

# The exact subset of Scene.details' own already-locked v1 key set (see app/models/scene.py) a
# semantic-boundary reasoner could ever plausibly cite, given what a Stage 10.2A evidence bundle
# actually contains (Shot / SpeechSegment / TextElement / AnalysisAnnotation references only --
# no ShotFrame evidence exists in a 10.2A bundle, so `supporting_frame_ids` is deliberately
# excluded here rather than accepted-but-always-empty). This is a STRICT SUBSET of Scene.details'
# five keys, never a superset -- evidence_references must stay directly, losslessly writable into
# a future Scene.details without translation or a second incompatible id-reference vocabulary.
VALID_EVIDENCE_REFERENCE_KEYS = frozenset({
    "supporting_shot_ids",
    "supporting_speech_segment_ids",
    "supporting_text_element_ids",
    "supporting_annotation_ids",
})


class SemanticReasoningError(Exception):
    """Raised for both "no semantic reasoner is configured" and "a configured reasoner's own call
    failed" (missing secret, network/timeout error, an outage, a response that could not be
    parsed into a ReasonerDecision at all) -- mirrors app.services.ai.providers.base.
    AIProviderError's own exact precedent (same two-purpose docstring, same "never returns a
    fabricated result" discipline) rather than inventing a second incompatible error taxonomy.

    Raising this is NEVER equivalent to a negative decision. A caller catching this must treat the
    affected candidate as genuinely UNREASONED — not yet decided, not decided "no" — see the
    Stage 10.2B architecture audit's Section 11 for how orchestration is expected to represent
    that distinction once orchestration itself is built (out of scope for this phase).
    """


def _validate_evidence_references(evidence_references: dict) -> None:
    unknown_keys = set(evidence_references) - VALID_EVIDENCE_REFERENCE_KEYS
    if unknown_keys:
        raise ValueError(
            f"evidence_references contains unsupported key(s) {sorted(unknown_keys)} -- only "
            f"{sorted(VALID_EVIDENCE_REFERENCE_KEYS)} are valid (the exact subset of Scene.details' "
            "own locked v1 keys a Stage 10.2A bundle can ever supply)."
        )
    for key, value in evidence_references.items():
        if not isinstance(value, list) or not all(isinstance(v, int) for v in value):
            raise ValueError(f"evidence_references['{key}'] must be a list of integer ids, got {value!r}.")


@dataclass
class ReasonerDecision:
    """The structured semantic decision itself -- provider-independent, never provider-specific.

    is_semantic_boundary: bool | None
        True  -> the reasoner concluded the content genuinely changes here.
        False -> the reasoner concluded the content does NOT genuinely change here.
        None  -> UNDECIDED: the reasoner examined the evidence but could not confidently tell
                 either way (e.g. one-sided evidence, an unsupported language, a genuinely
                 ambiguous case). This is NEVER equivalent to False -- "no" and "don't know" are
                 different outcomes with different downstream handling (see the Stage 10.2B
                 architecture audit's Section 11: an unconfirmed/undecided candidate must never
                 silently become part of "no Scene split here").

    confidence: one of VALID_CONFIDENCE_LEVELS -- required, categorical, never fabricated
        precision. Independent of is_semantic_boundary's own value: a confident "no" ("high",
        False) and an honestly uncertain "no" ("low", False) are both legitimate outcomes; so are
        a confident and an uncertain None.

    confidence_score: float | None -- left None unless a specific future provider genuinely
        reports a calibrated numeric signal (never estimated/averaged/invented at this layer).

    reasoning: short prose justification. Any before/after paraphrase a provider wants to offer
        belongs here as free text, never as a separate structured "summary" field -- see this
        module's own docstring on why ReasonerDecision does not carry one.

    evidence_references: which already-persisted ids (by category) this decision cites --
        REFERENCES ONLY, never copied transcript/OCR text or other evidence content. Restricted to
        VALID_EVIDENCE_REFERENCE_KEYS; every value is a list of ids (int), possibly empty, never
        required to cite every category.
    """
    is_semantic_boundary: bool | None
    confidence: str
    confidence_score: float | None
    reasoning: str
    evidence_references: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.confidence not in VALID_CONFIDENCE_LEVELS:
            raise ValueError(
                f"confidence must be one of {VALID_CONFIDENCE_LEVELS}, got {self.confidence!r}."
            )
        _validate_evidence_references(self.evidence_references)


@dataclass
class ReasonerResult:
    """The outer envelope returned by reason_about_boundary() on success -- mirrors AIResult's own
    provider/model metadata pattern. Always carries a real `decision` (never None): infrastructure
    failures raise SemanticReasoningError instead of returning a result with no decision, exactly
    like AIProvider.generate_text() never returns an AIResult for a failed call — this keeps
    "the call failed" (an exception) structurally distinct from "the call succeeded but the
    reasoner itself couldn't tell" (decision.is_semantic_boundary is None).
    """
    decision: ReasonerDecision
    provider: str
    model: str
    candidate_timestamp: float
