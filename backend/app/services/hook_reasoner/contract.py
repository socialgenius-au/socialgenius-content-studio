"""Stage 11.3 — the model-independent HOOK CLASSIFICATION contract: the one result shape every
future provider (Anthropic, a local/open-source model, a different vendor entirely) must produce,
so Hook orchestration never needs to know which one actually answered.

DELIBERATELY A SIBLING of app.services.semantic_reasoner.contract and
app.services.story_beat_reasoner.contract, never a reuse or modification of either — this contract
answers a genuinely different question:

  "Given the evidence inside an ALREADY-DERIVED, FIXED Hook Window (Stage 11.2, locked), what kind
   of hook appears there, what elements form it, and what intent does the opening appear designed
   to serve?"

This is NOT a boundary-detection question (unlike ReasonerDecision/StoryBeatDecision, which decide
WHERE a boundary is) — the window is already fixed before this contract is ever invoked. Nothing
here selects, adjusts, or second-guesses the Hook Window itself.

WHAT THIS CONTRACT MUST NEVER CLAIM (Stage 11.3's own explicit, structurally-enforced scope limit
— see the Anthropic provider's own `_reject_prohibited_language` for where this is actually
checked, not merely requested by prompt):
  - Whether the hook performed well, retained viewers, converted, or caused virality.
  - Any effectiveness/quality SCORE or strong/weak rating of any kind.
  - Any claim about actual audience response — only what the content itself appears designed to do
    ("the opening appears designed to...", never "this hook successfully...").
A HookReasoningError is raised, not a fabricated HookDecision, if a provider's response contains
any such claim — see contract HOOK_REASONER discipline below and the provider's own enforcement.

HOOK TYPE VOCABULARY (Stage 11.3's own deliberately small V1 set — "do not create an enormous
taxonomy"): a bounded, open-with-an-"other"-escape-hatch list, mirroring how VisualObject's own
category CHECK constraint stays small and explicit rather than attempting to anticipate every
possible value. `primary_type` may also be "unclear" — a Hook is never forced into a category the
evidence does not actually support.

HOOK ELEMENTS vs. HOOK TYPE (Stage 11.3's own explicit multimodality requirement): a Hook is
frequently composed of more than one observable element (a spoken question AND on-screen text AND
a face-to-camera framing, for example) even though it has exactly one `primary_type`. Collapsing
those into a single label would lose real, evidence-traceable structure — `hook_elements` exists
specifically so each contributing element stays independently visible and independently cited.

PROBABLE INTENT — LIMITED INFERENCE (Stage 11.3's own explicit instruction): `probable_intent` may
be None ("insufficient evidence to infer an intent") or one of a small, equally bounded vocabulary.
This field is always semantically INFERRED, never a measured fact — but it remains an inference
about apparent DESIGN, never about audience response.
"""
from dataclasses import dataclass, field

# Reused verbatim from the Scene reasoner's own already-locked contract -- a genuinely shared,
# trivial primitive (an immutable 3-value tuple), exactly the same reuse story_beat_reasoner's own
# contract already makes for the identical reason.
from app.services.semantic_reasoner.contract import VALID_CONFIDENCE_LEVELS

__all__ = [
    "VALID_CONFIDENCE_LEVELS",
    "HOOK_TYPE_VALUES",
    "PRIMARY_HOOK_TYPE_VALUES",
    "HOOK_INTENT_VALUES",
    "VALID_EVIDENCE_REFERENCE_KEYS",
    "HookReasoningError",
    "HookElement",
    "HookDecision",
    "HookResult",
]

# Deliberately small, V1 vocabulary (Section 4 of the Stage 11.3 brief: "do not create an enormous
# taxonomy"). "other" is the escape hatch for a real hook that genuinely doesn't fit any named
# type -- never a reason to force a wrong-but-listed category instead.
HOOK_TYPE_VALUES = frozenset({
    "question", "bold_claim", "curiosity_gap", "direct_address", "problem_statement",
    "result_first", "proof_first", "pattern_interrupt", "relatable_statement",
    "demonstration", "offer_led", "other",
})
# primary_type additionally allows "unclear" -- a secondary type never does (an unclear secondary
# type is simply omitted from the list, never included as a value).
PRIMARY_HOOK_TYPE_VALUES = HOOK_TYPE_VALUES | {"unclear"}

# Equally small, equally bounded -- mirrors the Stage 11 Design Audit's own examples exactly.
# `None` (never a string) is how "insufficient evidence to infer an intent" is represented.
HOOK_INTENT_VALUES = frozenset({
    "create_curiosity", "establish_relevance", "surface_problem", "promise_result",
    "establish_credibility", "provoke_attention", "other",
})

# The bounded evidence-reference vocabulary a Hook Evidence Bundle (Stage 11.3's own
# hook_evidence_assembly_svc) can ever supply. A deliberate SUPERSET of Scene's/Story Beat's own
# four/five-key vocabularies -- Hook evidence genuinely spans Scene- and Story-Beat-level
# structural context (Section 2 of the brief explicitly lists both as bundle inputs), which
# neither of those earlier bundles ever needed to cite. `supporting_frame_ids` is excluded, same
# reasoning the Scene reasoner's own contract gives: no Stage 11.3 bundle carries frame evidence
# today. `supporting_annotation_ids` remains the generic catch-all for motion/transition/silence/
# editing-pacing-phase AnalysisAnnotation rows that have no more specific dedicated key.
VALID_EVIDENCE_REFERENCE_KEYS = frozenset({
    "supporting_shot_ids",
    "supporting_speech_segment_ids",
    "supporting_text_element_ids",
    "supporting_visual_object_ids",
    "supporting_scene_ids",
    "supporting_story_beat_ids",
    "supporting_annotation_ids",
})


class HookReasoningError(Exception):
    """Raised for "no Hook reasoner is configured", "a configured reasoner's own call failed", a
    response that could not be parsed into a HookDecision, OR a response that violates this
    contract's own structural prohibitions (an invented evidence id, an unsupported hook/intent
    type, or language claiming performance/retention/virality/conversion/effectiveness) -- a
    deliberately SEPARATE exception type from SemanticReasoningError/StoryBeatReasoningError
    (never a shared/aliased class), so a caller always knows which reasoning subsystem failed.

    Raising this is NEVER equivalent to a "no hook found" outcome -- a genuine "the evidence
    doesn't clearly indicate a type" is a normal, successfully-returned HookDecision with
    primary_type="unclear", not an error."""


def _validate_evidence_references(evidence_references: dict) -> None:
    unknown_keys = set(evidence_references) - VALID_EVIDENCE_REFERENCE_KEYS
    if unknown_keys:
        raise ValueError(
            f"evidence_references contains unsupported key(s) {sorted(unknown_keys)} -- only "
            f"{sorted(VALID_EVIDENCE_REFERENCE_KEYS)} are valid."
        )
    for key, value in evidence_references.items():
        if not isinstance(value, list) or not all(isinstance(v, int) for v in value):
            raise ValueError(f"evidence_references['{key}'] must be a list of integer ids, got {value!r}.")


@dataclass
class HookElement:
    """One observable, evidence-cited contributor to the Hook -- e.g. a spoken line, an on-screen
    headline, a visual subject, a camera/motion change, a cut/pattern interruption, an opening
    question. `element_type` is free-form-but-short (never validated against a fixed enum in V1 --
    the intent is to stay descriptive rather than force every real element into a rigid taxonomy
    on top of the already-bounded `primary_type`/`secondary_types` vocabulary); `evidence_references`
    IS validated, using the exact same bounded key set as the decision's own."""
    element_type: str
    evidence_references: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.element_type or not isinstance(self.element_type, str):
            raise ValueError(f"element_type must be a non-empty string, got {self.element_type!r}.")
        _validate_evidence_references(self.evidence_references)


@dataclass
class HookDecision:
    """The structured Hook classification itself -- provider-independent, never provider-specific.

    primary_type: one of PRIMARY_HOOK_TYPE_VALUES (including "unclear") -- required. Never forced
        to a real type when the evidence does not actually support one.

    secondary_types: zero or more of HOOK_TYPE_VALUES (never "unclear") -- a Hook may combine more
        than one recognizable pattern; never required to be non-empty.

    hook_elements: the specific observable elements that appear to compose the Hook, each with its
        own evidence citation (see HookElement) -- never collapsed into the single primary_type
        label.

    probable_intent: one of HOOK_INTENT_VALUES, or None when the evidence does not support even a
        limited inference -- ALWAYS an inference about apparent design ("the opening appears
        designed to..."), never a claim about actual audience response.

    confidence: one of VALID_CONFIDENCE_LEVELS -- required, categorical, never fabricated
        precision.

    reasoning: short prose justification -- factual/evidence-grounded, structurally forbidden (see
        HookReasoningError) from claiming performance, retention, conversion, virality, or an
        effectiveness/quality score of any kind.

    evidence_references: which already-persisted ids (by category) this decision's own
        primary_type/probable_intent judgment cites overall -- REFERENCES ONLY, restricted to
        VALID_EVIDENCE_REFERENCE_KEYS. Element-level citations belong on each HookElement instead;
        this field is the decision's own top-level provenance.

    reasoning_contract_version: which version of the PROMPT/reasoning instructions actually
        produced this decision -- same rationale as ReasonerResult/StoryBeatResult's own field.
    """
    primary_type: str
    confidence: str
    reasoning: str
    secondary_types: list[str] = field(default_factory=list)
    hook_elements: list[HookElement] = field(default_factory=list)
    probable_intent: str | None = None
    evidence_references: dict = field(default_factory=dict)
    reasoning_contract_version: str | None = None

    def __post_init__(self) -> None:
        if self.primary_type not in PRIMARY_HOOK_TYPE_VALUES:
            raise ValueError(f"primary_type must be one of {sorted(PRIMARY_HOOK_TYPE_VALUES)}, got {self.primary_type!r}.")
        invalid_secondary = set(self.secondary_types) - HOOK_TYPE_VALUES
        if invalid_secondary:
            raise ValueError(f"secondary_types contains invalid value(s) {sorted(invalid_secondary)} -- must be a subset of {sorted(HOOK_TYPE_VALUES)}.")
        if self.probable_intent is not None and self.probable_intent not in HOOK_INTENT_VALUES:
            raise ValueError(f"probable_intent must be None or one of {sorted(HOOK_INTENT_VALUES)}, got {self.probable_intent!r}.")
        if self.confidence not in VALID_CONFIDENCE_LEVELS:
            raise ValueError(f"confidence must be one of {VALID_CONFIDENCE_LEVELS}, got {self.confidence!r}.")
        _validate_evidence_references(self.evidence_references)


@dataclass
class HookResult:
    """The outer envelope returned by hook_reasoner.router.classify_hook() on success -- mirrors
    ReasonerResult's/StoryBeatResult's own provider/model metadata pattern exactly. Always carries
    a real `decision` (never None): infrastructure/contract-violation failures raise
    HookReasoningError instead."""
    decision: HookDecision
    provider: str
    model: str
    reasoning_contract_version: str | None = None
