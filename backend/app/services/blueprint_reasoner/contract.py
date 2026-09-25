"""C4 -- the model-independent RECONSTRUCTION BLUEPRINT contract: the one result shape every provider must
produce, so blueprint orchestration never needs to know which one actually answered.

A deliberate SIBLING of app.services.mechanism_reasoner (same package shape, same honest-unconfigured
discipline), never a reuse of it -- the question is different:

  C3 answers "which design mechanisms appear transferable?". C4 answers "given a NEW business / topic / audience /
  objective, how should a NEW piece of content be CONSTRUCTED using those transferable principles, without copying
  the reference?"

C4 produces a CONSTRUCTION BLUEPRINT (instructions), never final creative copy. It transfers STRUCTURE, never the
reference's subject matter, wording, names, visuals or any C3 non-transferable element, and it never claims
performance or causation.

INPUTS (all pinned, none re-read from raw evidence): the C2 anatomy (skeleton only -- no source wording is sent to
the provider), the persisted C3 effective mechanisms (their TRANSFERABLE principles only), and the caller's
NewContentIntent.

DETERMINISTIC vs SEMANTIC. Code owns: input validation, fingerprint / staleness checks, mechanism-existence and
disposition accounting, mandatory-point accounting, prohibited-element enforcement, evidence / provenance
validation, the source-copy guard, the final-copy guard, persistence and reuse. The provider owns only the
semantic choices: which mechanisms suit the new intent, how their principles map onto the new subject, section
purposes, sequence and the construction instructions.
"""
from dataclasses import dataclass, field

from app.services.semantic_reasoner.contract import VALID_CONFIDENCE_LEVELS

__all__ = [
    "BLUEPRINT_VERSION", "STRUCTURAL_ROLES", "RELATIONSHIPS", "NOT_USED_REASONS", "MAX_SECTIONS", "MAX_FIELD_CHARS",
    "MAX_LIST_ITEMS", "DURATION_TOLERANCE", "VALID_CONFIDENCE_LEVELS", "BlueprintReasoningError",
    "MechanismChoice", "SectionPlan", "UnassignedPoint", "BlueprintDecision", "BlueprintResult",
]

BLUEPRINT_VERSION = "c4-v1"

# What a section is FOR in the new piece -- a small, bounded vocabulary so C6 can map sections onto editor primitives.
STRUCTURAL_ROLES = frozenset({
    "opening", "setup", "development", "contrast", "pivot", "evidence", "demonstration", "resolution", "payoff",
    "call_to_action", "closing", "other",
})
# How a new section relates to the reference's anatomy (an evidence pointer, never a copy instruction).
RELATIONSHIPS = frozenset({"follows_reference_order", "adapts_reference_structure", "independent_of_reference"})
# Why a C3 mechanism was NOT used for this new intent.
NOT_USED_REASONS = frozenset({
    "unsuitable_for_objective", "unsuitable_for_platform", "unsupported_by_supplied_information", "conflicts_with_tone",
    "conflicts_with_prohibited_element", "redundant_with_another_mechanism", "other",
})

MAX_SECTIONS = 12
MAX_FIELD_CHARS = 600            # instructions, not scripts
MAX_LIST_ITEMS = 8
DURATION_TOLERANCE = 0.15        # planned total may differ from a supplied target by at most 15%


class BlueprintReasoningError(Exception):
    """Raised for "no blueprint reasoner is configured", "a configured reasoner's own call failed", a response that
    could not be parsed, OR a response that violates this contract's deterministic safeguards (an unknown mechanism id,
    a dropped mandatory point, a prohibited element, reproduced source wording, a non-transferable element carried
    across, final creative copy, a performance / causal claim, ...).

    NEVER equivalent to a valid blueprint. Nothing is persisted for a raised error, so the prior effective blueprint
    is untouched. `diagnostics` carries non-sensitive response METADATA only (stop_reason, block types, token counts)."""

    def __init__(self, message: str, diagnostics: dict | None = None):
        super().__init__(message)
        self.diagnostics = diagnostics


@dataclass
class MechanismChoice:
    """USED or NOT_USED for ONE C3 mechanism. Every C3 mechanism gets exactly one choice."""
    mechanism_id: str
    decision: str                       # USED | NOT_USED
    reason: str | None = None           # required for NOT_USED
    reason_category: str | None = None  # required for NOT_USED; one of NOT_USED_REASONS
    applied_in_sections: list[int] = field(default_factory=list)   # required (non-empty) for USED

    def __post_init__(self) -> None:
        if not isinstance(self.mechanism_id, str) or not self.mechanism_id.strip():
            raise ValueError("mechanism_id must be a non-empty string.")
        if self.decision not in ("USED", "NOT_USED"):
            raise ValueError(f"decision must be 'USED' or 'NOT_USED', got {self.decision!r}.")
        if (not isinstance(self.applied_in_sections, list)
                or not all(isinstance(n, int) and not isinstance(n, bool) for n in self.applied_in_sections)):
            raise ValueError("applied_in_sections must be a list of integers.")
        if self.decision == "USED":
            if not self.applied_in_sections:
                raise ValueError(f"{self.mechanism_id}: a USED mechanism must be applied in at least one section.")
            if self.reason_category is not None:
                raise ValueError(f"{self.mechanism_id}: reason_category is only valid for NOT_USED.")
        else:
            if self.applied_in_sections:
                raise ValueError(f"{self.mechanism_id}: a NOT_USED mechanism cannot be applied in any section.")
            if self.reason_category not in NOT_USED_REASONS:
                raise ValueError(f"{self.mechanism_id}: NOT_USED requires reason_category, one of {sorted(NOT_USED_REASONS)}.")
            if not isinstance(self.reason, str) or len(self.reason.strip()) < 8:
                raise ValueError(f"{self.mechanism_id}: NOT_USED requires a concrete reason (at least 8 characters).")


@dataclass
class SectionPlan:
    """ONE section of the NEW piece, as an instruction set -- never final copy."""
    section_number: int
    section_purpose: str
    structural_role: str
    target_duration_seconds: float
    mechanisms_applied: list[str]
    relationship: str
    anatomy_section_numbers: list[int]
    content_instruction: str
    required_information: list[str]
    visual_direction: str
    text_direction: str
    speech_direction: str
    pacing_direction: str
    transition_direction: str | None
    cta_direction: str | None
    mandatory_points_assigned: list[str]
    confidence: str
    limitations: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not isinstance(self.section_number, int) or isinstance(self.section_number, bool) or self.section_number < 1:
            raise ValueError(f"section_number must be a positive integer, got {self.section_number!r}.")
        label = f"section {self.section_number}"
        for name in ("section_purpose", "content_instruction", "visual_direction", "text_direction", "speech_direction", "pacing_direction"):
            v = getattr(self, name)
            if not isinstance(v, str) or not v.strip():
                raise ValueError(f"{label}: {name} is required and must be a non-empty string.")
            if len(v) > MAX_FIELD_CHARS:
                raise ValueError(f"{label}: {name} is {len(v)} characters (max {MAX_FIELD_CHARS}) -- a blueprint gives concise instructions, not a script.")
        for name in ("transition_direction", "cta_direction"):
            v = getattr(self, name)
            if v is not None and (not isinstance(v, str) or not v.strip() or len(v) > MAX_FIELD_CHARS):
                raise ValueError(f"{label}: {name} must be null or a non-empty string of at most {MAX_FIELD_CHARS} characters.")
        if self.structural_role not in STRUCTURAL_ROLES:
            raise ValueError(f"{label}: structural_role must be one of {sorted(STRUCTURAL_ROLES)}, got {self.structural_role!r}.")
        if (isinstance(self.target_duration_seconds, bool) or not isinstance(self.target_duration_seconds, (int, float))
                or not (0.5 <= self.target_duration_seconds <= 600)):
            raise ValueError(f"{label}: target_duration_seconds must be a number between 0.5 and 600, got {self.target_duration_seconds!r}.")
        if self.relationship not in RELATIONSHIPS:
            raise ValueError(f"{label}: source_anatomy_relationship.relationship must be one of {sorted(RELATIONSHIPS)}, got {self.relationship!r}.")
        for name, items in (("mechanisms_applied", self.mechanisms_applied), ("anatomy_section_numbers", self.anatomy_section_numbers),
                            ("required_information", self.required_information), ("mandatory_points_assigned", self.mandatory_points_assigned),
                            ("limitations", self.limitations)):
            if not isinstance(items, list):
                raise ValueError(f"{label}: {name} must be a list.")
        if not all(isinstance(x, str) and x.strip() for x in self.mechanisms_applied + self.mandatory_points_assigned):
            raise ValueError(f"{label}: mechanisms_applied and mandatory_points_assigned must contain non-empty id strings.")
        if not all(isinstance(n, int) and not isinstance(n, bool) for n in self.anatomy_section_numbers):
            raise ValueError(f"{label}: anatomy_section_numbers must be integers.")
        if (not all(isinstance(x, str) and x.strip() and len(x) <= MAX_FIELD_CHARS for x in self.required_information + self.limitations)
                or len(self.required_information) > MAX_LIST_ITEMS or len(self.limitations) > MAX_LIST_ITEMS):
            raise ValueError(f"{label}: required_information / limitations must be short non-empty strings (max {MAX_LIST_ITEMS} items).")
        if self.confidence not in VALID_CONFIDENCE_LEVELS:
            raise ValueError(f"{label}: confidence must be one of {VALID_CONFIDENCE_LEVELS}, got {self.confidence!r}.")


@dataclass
class UnassignedPoint:
    """A mandatory point the provider could not place in any section, with the reason -- never silently dropped."""
    id: str
    reason: str

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or not self.id.strip():
            raise ValueError("an unassigned mandatory point needs its id.")
        if not isinstance(self.reason, str) or len(self.reason.strip()) < 8:
            raise ValueError(f"{self.id}: an unassigned mandatory point needs a concrete reason (at least 8 characters).")


@dataclass
class BlueprintDecision:
    structural_approach: str
    mechanism_choices: list[MechanismChoice]
    sections: list[SectionPlan]
    unassigned_mandatory_points: list[UnassignedPoint] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)
    reasoning_contract_version: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.structural_approach, str) or not self.structural_approach.strip() or len(self.structural_approach) > 2 * MAX_FIELD_CHARS:
            raise ValueError("structural_approach is required (a concise description of the overall construction).")
        if not self.sections or len(self.sections) > MAX_SECTIONS:
            raise ValueError(f"a blueprint needs between 1 and {MAX_SECTIONS} sections, got {len(self.sections)}.")
        if not all(isinstance(x, MechanismChoice) for x in self.mechanism_choices):
            raise ValueError("mechanism_choices must be MechanismChoice items.")
        if not all(isinstance(x, SectionPlan) for x in self.sections):
            raise ValueError("sections must be SectionPlan items.")
        if not all(isinstance(x, UnassignedPoint) for x in self.unassigned_mandatory_points):
            raise ValueError("unassigned_mandatory_points must be UnassignedPoint items.")
        if not isinstance(self.limitations, list) or not all(isinstance(x, str) for x in self.limitations):
            raise ValueError("limitations must be a list of strings.")


@dataclass
class BlueprintResult:
    decision: BlueprintDecision
    provider: str
    model: str
    reasoning_contract_version: str | None = None
