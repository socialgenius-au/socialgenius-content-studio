"""Stage 11.4 — the model-independent RETENTION DEVICE CLASSIFICATION contract: the one result
shape every future provider must produce, so retention orchestration never needs to know which one
actually answered.

DELIBERATELY A SIBLING of app.services.hook_reasoner.contract, never a reuse or modification of it
-- this contract answers a genuinely different question:

  "Given the bounded local evidence around one ALREADY-GENERATED, ALREADY-GROUPED candidate moment
   (Stage 11.4's own deterministic candidate assembly, never adjusted by this reasoner), what
   structural form does this moment take (device_type), and, separately, does it appear to function
   as an attention-maintenance / retention device (is_retention_device), and if so, in what way
   (probable_attention_function)?"

Unlike Hook classification (exactly one fixed window per video), Retention classification runs
ONCE PER CANDIDATE -- a video may produce zero, one, or many RetentionResult calls. Nothing here
selects, merges, or re-times a candidate; that is retention_candidate_assembly_svc's own, already-
complete job by the time this contract is ever invoked.

WHAT THIS CONTRACT MUST NEVER CLAIM (structurally enforced, not merely requested by prompt -- see
the Anthropic provider's own `_reject_prohibited_language`, deliberately reusing Hook's exact
enforcement mechanism and term list):
  - That this moment actually retained any viewer, held attention, drove engagement, or performed
    well in any measurable sense.
  - Any effectiveness/quality SCORE or strong/weak rating of any kind.
  - Only what the moment appears DESIGNED to do ("appears designed to maintain attention by...",
    never "this kept viewers watching").
A RetentionReasoningError is raised, not a fabricated RetentionDecision, if a provider's response
contains any such claim.

CANDIDATE != DEVICE (the Stage 11.4 acceptance-gate correction): a candidate merely means "something
happened here worth examining" -- it is never itself a strategic conclusion. `device_type` describes
the STRUCTURAL FORM of what happened (a cut, a scene change, text appearing, ...) and is set
regardless of whether the moment is accepted. `is_retention_device` is the SEPARATE, explicit
acceptance decision: whether the evidence plausibly supports this moment serving an attention-
maintenance FUNCTION, not merely that a structural event of some describable type occurred. Knowing
"there was a cut" (device_type="scene_switch") is not, by itself, evidence of a retention function
-- ordinary editing is an expected, legitimate, non-accepted outcome, not a failure. Acceptance is
never inferred from device_type or from confidence (see PROBABLE ATTENTION FUNCTION below and
providers/anthropic_provider.py's own prompt for the exact non-threshold-based judgment required).

DEVICE TYPE VOCABULARY (Stage 11.4's own deliberately small V1 set, per the brief's own explicit
list -- "do not invent proof/demo, open_loop, long-range curiosity_gap, or payoff_delay unless
evidence genuinely supports them" led to those four being left OUT of V1 entirely rather than
included-but-discouraged): visual_change, pacing_change, scene_switch, camera_movement,
text_reveal, question, emphasis, pattern_interrupt, other, unclear. Exactly one `device_type` per
candidate -- this contract does not attempt Hook's own multi-element/secondary-types shape, since a
retention candidate is already a single, bounded, pre-grouped moment (the grouping step is where
multiple co-occurring signals get combined), not a multi-part opening sequence.

PROBABLE ATTENTION FUNCTION (new, acceptance-gate correction): required (one of
RETENTION_FUNCTION_VALUES) when `is_retention_device` is True, and required to be None when False --
the contract enforces this pairing structurally so orchestration never has to guess whether an
accepted device actually carries a stated function. Always an INFERENCE about apparent design
("appears designed to renew attention..."), never a claim about actual viewer response, exactly
like Hook's own `probable_intent` field.

CONSERVATIVE-CLASSIFICATION RULES (Stage 11.4's own explicit requirement, enforced by the SYSTEM
PROMPT the Anthropic provider ships, not by this contract's own validation -- this contract only
constrains the SHAPE of a decision, never which evidence justifies which type):
  - `question` requires actual transcript or on-screen text evidence containing a question, never a
    bare structural "?" with no supporting content.
  - `pattern_interrupt` / `emphasis` require a genuine COMBINATION of evidence signals, never a
    single ordinary cut or an ordinary shot change alone.
  - A text-driven candidate requires more than a TextElement merely existing at this timestamp to
    be ACCEPTED as a retention device (Stage 11.4's text-reveal correction, introduced in prompt v2
    and re-expressed in prompt v3's acceptance-gate terms): a candidate nominated only by
    "text_appearance" must be weighed against routine caption/subtitle progression (text echoing
    concurrent speech as part of a steady stream of similar fragments) and persistent-watermark/
    garbled-OCR noise (near-identical variants of the same short string recurring across nearby
    candidates) -- both resolve to is_retention_device=False, absent a genuinely distinctive
    signal. device_type may still honestly be "text_reveal" in that case, since device_type
    describes structural FORM and is not the acceptance decision; a rejected candidate is
    represented by is_retention_device=False (with probable_attention_function=None), never merely
    by device_type="unclear". KNOWN V1 LIMITATION: this system cannot yet reliably distinguish
    ordinary scrolling/karaoke-style subtitle progression from a deliberate visual reveal using
    structural/text-content evidence alone; the reasoner is instructed to prefer
    is_retention_device=False when genuinely uncertain, rather than guess acceptance. Candidate
    generation itself is deliberately left UNCHANGED and still sensitive (every TextElement
    appearance still nominates a candidate) -- this correction narrows semantic ACCEPTANCE only,
    per the intended "sensitive candidate nomination -> conservative semantic acceptance"
    architecture.
"""
from dataclasses import dataclass, field

from app.services.semantic_reasoner.contract import VALID_CONFIDENCE_LEVELS

__all__ = [
    "VALID_CONFIDENCE_LEVELS",
    "RETENTION_DEVICE_TYPE_VALUES",
    "RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR",
    "RETENTION_FUNCTION_VALUES",
    "VALID_EVIDENCE_REFERENCE_KEYS",
    "RetentionReasoningError",
    "RetentionDecision",
    "RetentionResult",
]

# Deliberately small, V1 vocabulary (Section 6 of the Stage 11.4 brief). "other" is the escape
# hatch for a real candidate that genuinely doesn't fit any named type. Explicitly EXCLUDES
# proof/demo, open_loop, long-range curiosity_gap, and payoff_delay -- those require either
# longer-range video context this per-candidate contract does not have, or evidence this V1
# pipeline cannot yet measure; adding them "just in case" would invite exactly the kind of
# unsupported classification the brief warns against.
RETENTION_DEVICE_TYPE_VALUES = frozenset({
    "visual_change", "pacing_change", "scene_switch", "camera_movement",
    "text_reveal", "question", "emphasis", "pattern_interrupt", "other",
})
# device_type additionally allows "unclear" -- a candidate is never forced into a named type the
# local evidence does not actually support.
RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR = RETENTION_DEVICE_TYPE_VALUES | {"unclear"}

# Bounded V1 vocabulary for the inferred FUNCTION an ACCEPTED device appears designed to serve
# (Stage 11.4 acceptance-gate correction, Section 7's own named examples). "other" is the escape
# hatch for a genuinely accepted device whose function doesn't fit any named one. Only meaningful
# when is_retention_device is True -- see RetentionDecision's own __post_init__ for the enforced
# pairing.
RETENTION_FUNCTION_VALUES = frozenset({
    "renew_attention", "reset_visual_rhythm", "introduce_new_information",
    "create_emphasis", "prompt_mental_response", "other",
})

# The bounded evidence-reference vocabulary a candidate's local evidence bundle
# (retention_candidate_assembly_svc.assemble_candidate_evidence_bundle) can ever supply --
# deliberately identical key set to Hook's own, since both bundles draw from the same underlying
# evidence tables/categories.
VALID_EVIDENCE_REFERENCE_KEYS = frozenset({
    "supporting_shot_ids",
    "supporting_speech_segment_ids",
    "supporting_text_element_ids",
    "supporting_visual_object_ids",
    "supporting_scene_ids",
    "supporting_story_beat_ids",
    "supporting_annotation_ids",
})


class RetentionReasoningError(Exception):
    """Raised for "no retention reasoner is configured", "a configured reasoner's own call
    failed", a response that could not be parsed into a RetentionDecision, OR a response that
    violates this contract's own structural prohibitions (an invented evidence id, an unsupported
    device_type value, or language claiming actual retention/attention/engagement/performance) --
    a deliberately SEPARATE exception type from HookReasoningError, never a shared/aliased class.

    Raising this is NEVER equivalent to "this candidate is not a retention device" -- a genuine,
    considered "no, the evidence doesn't support an attention-maintenance function here" is a
    normal, successfully-returned RetentionDecision with is_retention_device=False (device_type may
    still be a real structural label, or "unclear"), not an error. Orchestration persists a durable
    reasoning attempt for EVERY successfully-returned decision regardless of is_retention_device,
    and includes only is_retention_device=True decisions in the effective retention_device set (see
    retention_classification_svc)."""


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
class RetentionDecision:
    """The structured Retention Device classification for ONE candidate -- provider-independent.

    is_retention_device: REQUIRED, explicit acceptance decision -- whether the evidence plausibly
        supports this moment serving an attention-maintenance FUNCTION. Never inferred from
        device_type or confidence by any caller; this field IS the acceptance gate (Stage 11.4
        acceptance-gate correction). False is a normal, expected, non-failure outcome -- ordinary
        editing with no evidence of a specific function.

    device_type: one of RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR -- required, REGARDLESS of
        is_retention_device. Describes the structural FORM of the candidate event (a cut, a scene
        change, text appearing, ...), never by itself a claim that the moment is an accepted
        device. Never forced to a real type when the local evidence does not actually support one.

    probable_attention_function: one of RETENTION_FUNCTION_VALUES when is_retention_device is True
        -- REQUIRED in that case, and REQUIRED to be None when is_retention_device is False (the
        pairing is structurally enforced below). Always an inference about apparent DESIGN
        ("appears designed to renew attention..."), never a claim about actual viewer response.

    confidence: one of VALID_CONFIDENCE_LEVELS -- required, categorical, never fabricated
        precision. NEVER used by any caller as an acceptance threshold -- a low-confidence
        attention-function inference may still be accepted, and a high-confidence "there was a
        cut" alone must not be accepted merely because confidence is high.

    reasoning: short prose justification -- factual/evidence-grounded, structurally forbidden (see
        RetentionReasoningError) from claiming actual retention, attention, engagement, watch time,
        or an effectiveness/quality score of any kind. Must phrase any design inference as
        "appears designed to..." never "this kept viewers watching."

    evidence_references: which already-persisted ids (by category) this decision cites --
        REFERENCES ONLY, restricted to VALID_EVIDENCE_REFERENCE_KEYS.

    reasoning_contract_version: which version of the PROMPT/reasoning instructions actually
        produced this decision.
    """
    is_retention_device: bool
    device_type: str
    confidence: str
    reasoning: str
    probable_attention_function: str | None = None
    evidence_references: dict = field(default_factory=dict)
    reasoning_contract_version: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.is_retention_device, bool):
            raise ValueError(f"is_retention_device must be a bool, got {self.is_retention_device!r}.")
        if self.device_type not in RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR:
            raise ValueError(
                f"device_type must be one of {sorted(RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR)}, got {self.device_type!r}."
            )
        if self.confidence not in VALID_CONFIDENCE_LEVELS:
            raise ValueError(f"confidence must be one of {VALID_CONFIDENCE_LEVELS}, got {self.confidence!r}.")
        if self.is_retention_device:
            if self.probable_attention_function not in RETENTION_FUNCTION_VALUES:
                raise ValueError(
                    f"probable_attention_function must be one of {sorted(RETENTION_FUNCTION_VALUES)} "
                    f"when is_retention_device is True, got {self.probable_attention_function!r}."
                )
        elif self.probable_attention_function is not None:
            raise ValueError(
                f"probable_attention_function must be None when is_retention_device is False, "
                f"got {self.probable_attention_function!r} -- a non-accepted candidate has no accepted function."
            )
        _validate_evidence_references(self.evidence_references)


@dataclass
class RetentionResult:
    """The outer envelope returned by retention_reasoner.router.classify_retention_candidate() on
    success -- mirrors HookResult's own provider/model metadata pattern exactly. Always carries a
    real `decision` (never None): infrastructure/contract-violation failures raise
    RetentionReasoningError instead."""
    decision: RetentionDecision
    provider: str
    model: str
    reasoning_contract_version: str | None = None
