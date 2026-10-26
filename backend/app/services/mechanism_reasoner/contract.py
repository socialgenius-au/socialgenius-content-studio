"""C3 — the model-independent TRANSFERABLE MECHANISM contract: the one result shape every provider must
produce, so mechanism orchestration never needs to know which one actually answered.

A deliberate SIBLING of app.services.retention_reasoner.contract (same package shape, same honest-
unconfigured discipline), never a reuse of it -- the question is different:

  C2 (Content Anatomy) answers "how is this content constructed?". C3 answers "what underlying design
  mechanisms APPEAR to be operating here, and which aspects of each are TRANSFERABLE to NEW content?"

C3 is NOT copying the source, rewriting the source, generating new content, predicting performance,
claiming causation, or building the reconstruction blueprint (that is C4).

INPUT: only the C2 Content Anatomy response, pinned by (reference_video_id, video_analysis_id,
provenance.fingerprint). Nothing here reads raw Stage 3-11 evidence. Null anatomy fields mean "unknown";
C2 `gaps` bound what may be claimed; zero accepted retention devices is valid.

OUTPUT: zero or more `Mechanism`s. `mechanisms == []` is a legitimate, successful outcome -- a mechanism is
created only when the anatomy supports it, never to make a result look complete.

WHAT THIS CONTRACT MUST NEVER CLAIM (enforced structurally in app.services.mechanism_reasoner.validation,
provider-independently, not merely requested by prompt): that anything made a video successful, retained or
engaged viewers, went viral, or converted; any effectiveness score or strong/weak rating; any unsupported
causal claim. Observed structure may be described directly; any INFERRED intent/purpose/function must be
cautiously hedged ("appears designed to...", "may function as...", "creates a structural...").

TRANSFERABILITY: every mechanism separates the TRANSFERABLE PRINCIPLE (an abstract, source-independent
structure that could be applied to entirely different content) from the NON-TRANSFERABLE SOURCE ELEMENTS
(the specific wording, names, visuals, subject matter, timing that belong to this source and must not be
carried over). The structure is what is learned; the source is not reproduced.

CERTAINTY: every C3 V1 mechanism is INFERRED. Nothing is upgraded to MEASURED/fact by being stated here.
"""
from dataclasses import dataclass, field

from app.services.semantic_reasoner.contract import VALID_CONFIDENCE_LEVELS

__all__ = [
    "TAXONOMY_VERSION", "MECHANISM_TYPES", "MECHANISM_TYPES_WITHOUT_OTHER", "NON_TRANSFERABLE_KINDS",
    "VALID_CONFIDENCE_LEVELS", "VALID_SCOPES", "CERTAINTY_INFERRED", "EVIDENCE_ID_KEYS", "ANATOMY_FEATURE_KEYS",
    "MechanismReasoningError", "NonTransferableElement", "Mechanism", "MechanismDecision", "MechanismResult",
]

# V1 taxonomy (approved). Controlled but extensible: new types are a one-line addition here plus a bump of
# TAXONOMY_VERSION; `other` is the explicit, evidence-supported escape hatch (label + rationale required).
TAXONOMY_VERSION = "v1"
MECHANISM_TYPES_WITHOUT_OTHER = (
    "hook_curiosity", "problem_tension", "information_reveal", "progression", "contrast", "proof_credibility",
    "demonstration", "pattern_interruption", "pacing_rhythm", "emotional_progression", "payoff_resolution",
    "cta_next_step", "visual_attention", "audio_attention", "text_attention",
)
MECHANISM_TYPES = frozenset(MECHANISM_TYPES_WITHOUT_OTHER) | {"other"}

# What kind of thing a NON-transferable source element is -- so the split is explicit and inspectable.
NON_TRANSFERABLE_KINDS = frozenset({
    "wording", "brand_or_name", "visual_specific", "audio_specific", "subject_matter", "timing_specific", "other",
})

VALID_SCOPES = frozenset({"video", "sections"})
CERTAINTY_INFERRED = "INFERRED"

# The evidence-id categories a mechanism may cite: exactly the keys C2 puts in a section's `evidence_ids`.
EVIDENCE_ID_KEYS = frozenset({
    "story_beats", "scenes", "shots", "speech_segments", "text_elements", "visual_objects", "silence_intervals",
    "transition_evidence", "pacing_phases", "retention_devices", "retention_attempts",
})

# The bounded vocabulary of anatomy features a mechanism may say it used. Each is checked against the
# anatomy itself (validation.py), so a mechanism cannot claim to use a feature the anatomy does not show.
ANATOMY_FEATURE_KEYS = frozenset({
    # section-level (section scope: present in a cited section; video scope: present anywhere in the video)
    "transcript", "speech", "on_screen_text", "visual_objects", "silence", "cuts", "pacing", "transitions",
    "motion", "hook_window", "accepted_retention_device",
    # video-level (must be present at video level)
    "hook_classification", "structural_pattern", "progression", "pacing_profile",
})


class MechanismReasoningError(Exception):
    """Raised for "no mechanism reasoner is configured", "a configured reasoner's own call failed", a
    response that could not be parsed into a MechanismDecision, OR a response that violates this contract's
    structural prohibitions (invented evidence id / section / feature, an unsupported type, a performance or
    causal claim, reproduced source text, a missing transferable/non-transferable split, ...).

    NEVER equivalent to "no mechanisms": a genuine, considered "the anatomy does not support any mechanism"
    is a normal, successfully-returned MechanismDecision with `mechanisms == []`. Nothing is persisted for a
    raised error (existing Stage 10/11 convention), so the prior effective result is left untouched.

    `diagnostics` (optional) carries non-sensitive response METADATA for a provider-level failure -- stop_reason,
    block types, whether text existed, text length, token counts -- never the API key and never the payload."""

    def __init__(self, message: str, diagnostics: dict | None = None):
        super().__init__(message)
        self.diagnostics = diagnostics


@dataclass
class NonTransferableElement:
    kind: str
    description: str

    def __post_init__(self) -> None:
        if self.kind not in NON_TRANSFERABLE_KINDS:
            raise ValueError(f"non_transferable kind must be one of {sorted(NON_TRANSFERABLE_KINDS)}, got {self.kind!r}.")
        if not isinstance(self.description, str) or not self.description.strip():
            raise ValueError("a non-transferable element needs a non-empty description.")


@dataclass
class Mechanism:
    """One apparent design mechanism, as returned by a provider (before anatomy-aware validation).

    mechanism_type: one of MECHANISM_TYPES. `other` additionally requires `other_label` + `other_rationale`.
    statement: observed structure may be stated directly; any asserted intent/purpose/function must be hedged
        ("appears designed to...", "may function as...", "creates a structural...").
    scope: "video" or "sections"; `section_numbers` must be non-empty for "sections".
    supporting_evidence_ids: {anatomy evidence category: [ids]} -- REFERENCES ONLY, every id must exist in
        the SAME pinned anatomy (for a "sections" scope, inside the cited sections; for a "video" scope, anywhere in
        it). At least one is required.
    anatomy_features_used: which anatomy features the inference rests on (ANATOMY_FEATURE_KEYS); at least one.
    transferable_principle: the abstract, source-independent structure -- required.
    non_transferable_elements: the source-specific things NOT to carry over -- at least one required.
    confidence: low | medium | high -- categorical, never a threshold, never fabricated precision.
    limitations: what the anatomy does not establish that bears on THIS mechanism (model-stated; C3 adds the
        anatomy's own gaps deterministically).
    certainty: always INFERRED in V1.
    """
    mechanism_type: str
    statement: str
    scope: str
    section_numbers: list[int]
    supporting_evidence_ids: dict
    anatomy_features_used: list[str]
    transferable_principle: str
    non_transferable_elements: list[NonTransferableElement]
    confidence: str
    limitations: list[str] = field(default_factory=list)
    other_label: str | None = None
    other_rationale: str | None = None
    certainty: str = CERTAINTY_INFERRED

    def __post_init__(self) -> None:
        if self.mechanism_type not in MECHANISM_TYPES:
            raise ValueError(f"mechanism_type must be one of {sorted(MECHANISM_TYPES)}, got {self.mechanism_type!r}.")
        if self.mechanism_type == "other":
            if not (isinstance(self.other_label, str) and self.other_label.strip()
                    and isinstance(self.other_rationale, str) and self.other_rationale.strip()):
                raise ValueError("mechanism_type 'other' requires an explicit evidence-supported other_label and other_rationale.")
            if self.other_label.strip().lower().replace(" ", "_").replace("-", "_") in MECHANISM_TYPES_WITHOUT_OTHER:
                raise ValueError(f"other_label {self.other_label!r} duplicates a named taxonomy type -- use that type instead.")
        elif self.other_label or self.other_rationale:
            raise ValueError("other_label/other_rationale are only valid when mechanism_type is 'other'.")
        if not isinstance(self.statement, str) or not self.statement.strip():
            raise ValueError("statement must be a non-empty string.")
        if self.scope not in VALID_SCOPES:
            raise ValueError(f"scope must be one of {sorted(VALID_SCOPES)}, got {self.scope!r}.")
        if (not isinstance(self.section_numbers, list) or not all(isinstance(n, int) and not isinstance(n, bool) for n in self.section_numbers)
                or len(set(self.section_numbers)) != len(self.section_numbers)):
            raise ValueError(f"section_numbers must be a list of distinct integers, got {self.section_numbers!r}.")
        if self.scope == "sections" and not self.section_numbers:
            raise ValueError("scope 'sections' requires at least one section number.")
        if not isinstance(self.supporting_evidence_ids, dict):
            raise ValueError("supporting_evidence_ids must be an object.")
        unknown = set(self.supporting_evidence_ids) - EVIDENCE_ID_KEYS
        if unknown:
            raise ValueError(f"supporting_evidence_ids has unsupported key(s) {sorted(unknown)}; valid: {sorted(EVIDENCE_ID_KEYS)}.")
        for key, ids in self.supporting_evidence_ids.items():
            if not isinstance(ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
                raise ValueError(f"supporting_evidence_ids['{key}'] must be a list of integer ids, got {ids!r}.")
        if not any(self.supporting_evidence_ids.values()):
            raise ValueError("a mechanism must cite at least one supporting evidence id -- unsupported mechanisms are not created.")
        if (not isinstance(self.anatomy_features_used, list) or not self.anatomy_features_used
                or not all(isinstance(f, str) for f in self.anatomy_features_used)):
            raise ValueError("anatomy_features_used must be a non-empty list of feature names.")
        bad = set(self.anatomy_features_used) - ANATOMY_FEATURE_KEYS
        if bad:
            raise ValueError(f"anatomy_features_used has unknown feature(s) {sorted(bad)}; valid: {sorted(ANATOMY_FEATURE_KEYS)}.")
        if not isinstance(self.transferable_principle, str) or not self.transferable_principle.strip():
            raise ValueError("transferable_principle is required -- a mechanism with no transferable structure is not a mechanism.")
        if not self.non_transferable_elements or not all(isinstance(e, NonTransferableElement) for e in self.non_transferable_elements):
            raise ValueError("at least one non_transferable element is required -- the source-specific part must be separated explicitly.")
        if self.confidence not in VALID_CONFIDENCE_LEVELS:
            raise ValueError(f"confidence must be one of {VALID_CONFIDENCE_LEVELS}, got {self.confidence!r}.")
        if not isinstance(self.limitations, list) or not all(isinstance(x, str) for x in self.limitations):
            raise ValueError("limitations must be a list of strings.")
        if self.certainty != CERTAINTY_INFERRED:
            raise ValueError(f"certainty must be {CERTAINTY_INFERRED!r} in C3 V1, got {self.certainty!r}.")


@dataclass
class MechanismDecision:
    """The provider-independent result for ONE anatomy: zero or more mechanisms plus overall limitations.
    `mechanisms == []` is valid; then `overall_limitations` should say why (C3 adds a default if it does not)."""
    mechanisms: list[Mechanism] = field(default_factory=list)
    overall_limitations: list[str] = field(default_factory=list)
    reasoning_contract_version: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.mechanisms, list) or not all(isinstance(m, Mechanism) for m in self.mechanisms):
            raise ValueError("mechanisms must be a list of Mechanism.")
        if not isinstance(self.overall_limitations, list) or not all(isinstance(x, str) for x in self.overall_limitations):
            raise ValueError("overall_limitations must be a list of strings.")


@dataclass
class MechanismResult:
    """The outer envelope returned by mechanism_reasoner.router.derive_mechanisms() on success. `decision` is
    always real (never None): infrastructure/contract failures raise MechanismReasoningError instead."""
    decision: MechanismDecision
    provider: str
    model: str
    reasoning_contract_version: str | None = None
