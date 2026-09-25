"""C4 -- Reconstruction Blueprint V1 request/response shapes.

`NewContentIntentIn` is the ONE definition of what a caller must supply about the NEW content; the service and
the API both validate through it. Required: product_service_or_topic, target_audience, objective. Everything
else is optional and is NEVER invented when missing -- a meaningful absence is recorded in the blueprint's `gaps`.

The blueprint is a CONSTRUCTION PLAN (instructions), never final creative copy: no hook lines, captions,
scripts, headlines, CTA wording or voiceover copy. It transfers STRUCTURE (the C3 transferable principles), never
the reference's subject matter, wording or non-transferable elements.
"""
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_REQUIRED_CHARS = 300
MAX_OPTIONAL_CHARS = 300
MAX_LIST_ITEMS = 20
MAX_LIST_ITEM_CHARS = 250
MIN_TARGET_SECONDS = 3.0
MAX_TARGET_SECONDS = 600.0


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _clean_list(values: list[str], field: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        c = _clean(v)
        if not c:
            raise ValueError(f"{field} must not contain an empty item")
        if len(c) > MAX_LIST_ITEM_CHARS:
            raise ValueError(f"{field} items must be at most {MAX_LIST_ITEM_CHARS} characters")
        if c.lower() not in seen:
            seen.add(c.lower())
            out.append(c)
    if len(out) > MAX_LIST_ITEMS:
        raise ValueError(f"{field} allows at most {MAX_LIST_ITEMS} items")
    return out


class DurationPlatformConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: str | None = Field(default=None, max_length=80)
    target_duration_seconds: float | None = None
    notes: str | None = Field(default=None, max_length=MAX_OPTIONAL_CHARS)

    @field_validator("platform", "notes")
    @classmethod
    def _strip(cls, v):
        return _clean(v) or None if isinstance(v, str) else v

    @field_validator("target_duration_seconds")
    @classmethod
    def _range(cls, v):
        if v is not None and not (MIN_TARGET_SECONDS <= v <= MAX_TARGET_SECONDS):
            raise ValueError(f"target_duration_seconds must be between {MIN_TARGET_SECONDS} and {MAX_TARGET_SECONDS}")
        return v


class NewContentIntentIn(BaseModel):
    """What the NEW content is for. Unknown keys are rejected (a typo must not silently drop a constraint)."""
    model_config = ConfigDict(extra="forbid")

    # REQUIRED
    product_service_or_topic: str = Field(max_length=MAX_REQUIRED_CHARS)
    target_audience: str = Field(max_length=MAX_REQUIRED_CHARS)
    objective: str = Field(max_length=MAX_REQUIRED_CHARS)
    # OPTIONAL -- never invented when absent
    business_or_brand: str | None = Field(default=None, max_length=MAX_OPTIONAL_CHARS)
    desired_cta: str | None = Field(default=None, max_length=MAX_OPTIONAL_CHARS)
    tone_style_constraints: list[str] = Field(default_factory=list)
    duration_platform_constraints: DurationPlatformConstraints | None = None
    mandatory_points: list[str] = Field(default_factory=list)
    prohibited_claims_or_elements: list[str] = Field(default_factory=list)

    @field_validator("product_service_or_topic", "target_audience", "objective")
    @classmethod
    def _required_text(cls, v: str):
        c = _clean(v)
        if len(c) < 3:
            raise ValueError("must be a meaningful, non-empty description (at least 3 characters)")
        return c

    @field_validator("business_or_brand", "desired_cta")
    @classmethod
    def _optional_text(cls, v):
        return (_clean(v) or None) if isinstance(v, str) else v

    @field_validator("tone_style_constraints", "mandatory_points", "prohibited_claims_or_elements")
    @classmethod
    def _lists(cls, v, info):
        return _clean_list(v, info.field_name)

    @model_validator(mode="after")
    def _no_contradiction(self):
        # a mandatory point that is also prohibited can never be satisfied
        prohibited = {p.lower() for p in self.prohibited_claims_or_elements}
        clash = [m for m in self.mandatory_points if m.lower() in prohibited]
        if clash:
            raise ValueError(f"a mandatory point cannot also be prohibited: {clash}")
        return self


class BlueprintRequest(BaseModel):
    """POST body. `intent` is required; everything else is optional pinning / cost control."""
    model_config = ConfigDict(extra="forbid")

    intent: NewContentIntentIn
    video_analysis_id: int | None = None
    anatomy_fingerprint: str | None = None        # pin: 409 if the current anatomy differs
    mechanism_attempt_id: int | None = None       # pin: 409 if the effective C3 result is a different attempt
    force: bool = False                           # re-derive even if an identical result exists (a NEW provider call)


# ── response ─────────────────────────────────────────────────────────────────────────────────

class BlueprintGap(BaseModel):
    field: str
    kind: str        # not_supplied | reference_gap | reference_limitation | unassigned_mandatory_point | provider_limitation | quality_note
    reason: str


class MechanismDisposition(BaseModel):
    mechanism_id: str
    mechanism_type: str
    decision: str                                 # USED | NOT_USED
    reason_category: str | None = None
    reason: str | None = None
    applied_in_sections: list[int] = []           # what the disposition DECLARES (explanatory / audit metadata only)
    authoritative_sections: list[int] = []        # computed from section.mechanisms_applied -- the AUTHORITATIVE execution mapping C6 consumes
    application_rationale: str | None = None      # USED (prompt v3+): HOW the transferable principle is instantiated in this blueprint
    transferable_principle: str                   # carried from C3 verbatim (the ONLY thing transferred)


class SourceAnatomyRelationship(BaseModel):
    relationship: str                             # follows_reference_order | adapts_reference_structure | independent_of_reference
    anatomy_section_numbers: list[int] = []


class BlueprintEvidenceRefs(BaseModel):
    anatomy_section_numbers: list[int] = []
    mechanism_ids: list[str] = []


class BlueprintSection(BaseModel):
    section_number: int
    section_purpose: str
    structural_role: str
    target_duration_seconds: float
    mechanisms_applied: list[str]
    source_anatomy_relationship: SourceAnatomyRelationship
    content_instruction: str
    required_information: list[str]
    visual_direction: str
    text_direction: str
    speech_direction: str
    pacing_direction: str
    transition_direction: str | None = None
    cta_direction: str | None = None
    mandatory_points_assigned: list[str]
    prohibited_elements: list[str]                # deterministic: the caller's prohibited claims/elements
    evidence_refs: BlueprintEvidenceRefs
    confidence: str
    limitations: list[str] = []


class MandatoryPointAccounting(BaseModel):
    id: str
    text: str
    status: str                                   # ASSIGNED | UNASSIGNED
    section_numbers: list[int] = []
    reason: str | None = None


class BlueprintConstraints(BaseModel):
    tone_style: list[str]
    duration_platform: dict | None = None
    prohibited_claims_or_elements: list[str]
    do_not_reproduce: list[dict]                  # C3 non-transferable elements: {mechanism_id, kind, description}
    copy_policy: str
    performance_policy: str


class Blueprint(BaseModel):
    blueprint_id: str
    blueprint_version: str
    intent: dict                                  # the normalised NewContentIntent this blueprint answers
    intent_summary: str                           # deterministic, built from the intent only
    structural_approach: str
    target: dict                                  # {platform, target_duration_seconds, planned_total_seconds}
    mechanisms_used: list[str]
    mechanisms_not_used: list[MechanismDisposition]
    mechanism_dispositions: list[MechanismDisposition]
    constraints: BlueprintConstraints
    sections: list[BlueprintSection]
    mandatory_point_accounting: list[MandatoryPointAccounting]
    gaps: list[BlueprintGap]
    limitations: list[str]
    provenance: dict


class BlueprintInputPin(BaseModel):
    anatomy_fingerprint: str | None = None
    current_anatomy_fingerprint: str | None = None
    mechanism_attempt_id: int | None = None
    current_mechanism_attempt_id: int | None = None
    intent_hash: str | None = None


class BlueprintSetProvenance(BaseModel):
    reasoning_attempt_id: int | None = None
    provider: str | None = None
    model: str | None = None
    prompt_version: str | None = None
    blueprint_version: str | None = None
    taxonomy_version: str | None = None
    certainty: str = "INFERRED"
    llm_calls: int = 0                            # provider calls made BY THIS REQUEST (0 for a read or a reused result)
    persisted: bool = True
    effective_since: str | None = None


class BlueprintResponse(BaseModel):
    status: str                                   # not_run | current | stale | unknown
    reused: bool = False
    reference_video_id: int
    video_analysis_id: int
    input_pin: BlueprintInputPin
    blueprint: Blueprint | None = None
    provenance: BlueprintSetProvenance | None = None


class BlueprintAttemptOut(BaseModel):
    attempt_id: int
    created_at: str | None = None
    is_effective: bool
    anatomy_fingerprint: str | None = None
    mechanism_attempt_id: int | None = None
    intent_hash: str | None = None
    provider: str | None = None
    model: str | None = None
    prompt_version: str | None = None
    section_count: int | None = None
    mechanisms_used: list[str] = []
    blueprint: Blueprint | None = None


class BlueprintAttemptsResponse(BaseModel):
    reference_video_id: int
    video_analysis_id: int
    effective_attempt_id: int | None = None
    attempts: list[BlueprintAttemptOut]
