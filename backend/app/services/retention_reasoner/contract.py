"""Stage 11.4 — the model-independent RETENTION DEVICE CLASSIFICATION contract: the one result
shape every future provider must produce, so retention orchestration never needs to know which one
actually answered.

DELIBERATELY A SIBLING of app.services.hook_reasoner.contract, never a reuse or modification of it
-- this contract answers a genuinely different question:

  "Given the bounded local evidence around one ALREADY-GENERATED, ALREADY-GROUPED candidate moment
   (Stage 11.4's own deterministic candidate assembly, never adjusted by this reasoner), does this
   moment appear to function as an attention-maintenance / retention device, and if so, which kind?"

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

DEVICE TYPE VOCABULARY (Stage 11.4's own deliberately small V1 set, per the brief's own explicit
list -- "do not invent proof/demo, open_loop, long-range curiosity_gap, or payoff_delay unless
evidence genuinely supports them" led to those four being left OUT of V1 entirely rather than
included-but-discouraged): visual_change, pacing_change, scene_switch, camera_movement,
text_reveal, question, emphasis, pattern_interrupt, other, unclear. Exactly one `device_type` per
candidate -- this contract does not attempt Hook's own multi-element/secondary-types shape, since a
retention candidate is already a single, bounded, pre-grouped moment (the grouping step is where
multiple co-occurring signals get combined), not a multi-part opening sequence.

CONSERVATIVE-CLASSIFICATION RULES (Stage 11.4's own explicit requirement, enforced by the SYSTEM
PROMPT the Anthropic provider ships, not by this contract's own validation -- this contract only
constrains the SHAPE of a decision, never which evidence justifies which type):
  - `question` requires actual transcript or on-screen text evidence containing a question, never a
    bare structural "?" with no supporting content.
  - `pattern_interrupt` / `emphasis` require a genuine COMBINATION of evidence signals, never a
    single ordinary cut or an ordinary shot change alone.
  - `text_reveal` requires more than a TextElement merely existing at this timestamp (Stage 11.4's
    own text-reveal correction, prompt v2): a candidate nominated only by "text_appearance" must be
    weighed against routine caption/subtitle progression (text echoing concurrent speech as part of
    a steady stream of similar fragments) and persistent-watermark/garbled-OCR noise (near-identical
    variants of the same short string recurring across nearby candidates) -- both default to
    "unclear", not "text_reveal", absent a genuinely distinctive signal. KNOWN V1 LIMITATION: this
    system cannot yet reliably distinguish ordinary scrolling/karaoke-style subtitle progression
    from a deliberate visual reveal using structural/text-content evidence alone; the reasoner is
    instructed to prefer "unclear" when genuinely uncertain rather than guess. Candidate generation
    itself is deliberately left UNCHANGED and still sensitive (every TextElement appearance still
    nominates a candidate) -- this correction narrows semantic ACCEPTANCE only, per the intended
    "sensitive candidate nomination -> conservative semantic acceptance" architecture.
"""
from dataclasses import dataclass, field

from app.services.semantic_reasoner.contract import VALID_CONFIDENCE_LEVELS

__all__ = [
    "VALID_CONFIDENCE_LEVELS",
    "RETENTION_DEVICE_TYPE_VALUES",
    "RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR",
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

    Raising this is NEVER equivalent to "this candidate is not a retention device" -- a genuine
    "the evidence doesn't clearly support a device type" is a normal, successfully-returned
    RetentionDecision with device_type="unclear", not an error. Orchestration decides separately
    whether an "unclear" decision is still worth persisting (see retention_classification_svc)."""


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

    device_type: one of RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR -- required. Never forced to a
        real type when the local evidence does not actually support one.

    confidence: one of VALID_CONFIDENCE_LEVELS -- required, categorical, never fabricated
        precision.

    reasoning: short prose justification -- factual/evidence-grounded, structurally forbidden (see
        RetentionReasoningError) from claiming actual retention, attention, engagement, watch time,
        or an effectiveness/quality score of any kind. Must phrase any design inference as
        "appears designed to..." never "this kept viewers watching."

    evidence_references: which already-persisted ids (by category) this decision cites --
        REFERENCES ONLY, restricted to VALID_EVIDENCE_REFERENCE_KEYS.

    reasoning_contract_version: which version of the PROMPT/reasoning instructions actually
        produced this decision.
    """
    device_type: str
    confidence: str
    reasoning: str
    evidence_references: dict = field(default_factory=dict)
    reasoning_contract_version: str | None = None

    def __post_init__(self) -> None:
        if self.device_type not in RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR:
            raise ValueError(
                f"device_type must be one of {sorted(RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR)}, got {self.device_type!r}."
            )
        if self.confidence not in VALID_CONFIDENCE_LEVELS:
            raise ValueError(f"confidence must be one of {VALID_CONFIDENCE_LEVELS}, got {self.confidence!r}.")
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
