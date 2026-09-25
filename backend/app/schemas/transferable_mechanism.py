"""C3 -- Transferable Mechanism V1 response shapes.

Typed strictly (like the C2 anatomy) because this is OUR output contract: C4 consumes exactly this shape.
Every mechanism is INFERRED, carries a transferable principle SEPARATED from its non-transferable source
elements, cites only ids that exist in the pinned C2 anatomy, and is pinned to that anatomy's fingerprint.
"""
from pydantic import BaseModel


class NonTransferableOut(BaseModel):
    kind: str            # wording | brand_or_name | visual_specific | audio_specific | subject_matter | timing_specific | other
    description: str


class MechanismLimitations(BaseModel):
    model_stated: list[str] = []
    anatomy_gaps: list[dict] = []   # the C2 gaps relevant to this mechanism, propagated verbatim (field/kind/reason/section_number)


class MechanismProvenance(BaseModel):
    reference_video_id: int | None = None
    video_analysis_id: int | None = None
    anatomy_fingerprint: str | None = None
    anatomy_version: str | None = None
    taxonomy_version: str | None = None
    provider: str | None = None
    model: str | None = None
    prompt_version: str | None = None


class MechanismOut(BaseModel):
    mechanism_id: str
    mechanism_type: str
    other_label: str | None = None
    other_rationale: str | None = None
    statement: str
    scope: str                                   # video | sections
    section_numbers: list[int]
    supporting_evidence_ids: dict[str, list[int]]
    anatomy_features_used: list[str]
    transferable_principle: str
    non_transferable_elements: list[NonTransferableOut]
    confidence: str                              # low | medium | high
    certainty: str = "INFERRED"
    limitations: MechanismLimitations
    provenance: MechanismProvenance


class MechanismInputPin(BaseModel):
    anatomy_fingerprint: str | None = None          # the anatomy the stored result was derived from
    current_anatomy_fingerprint: str | None = None  # the anatomy as it is now (None if it cannot currently be built)
    anatomy_version: str | None = None


class MechanismSetProvenance(BaseModel):
    reasoning_attempt_id: int | None = None
    provider: str | None = None
    model: str | None = None
    prompt_version: str | None = None
    taxonomy_version: str | None = None
    certainty: str = "INFERRED"
    llm_calls: int = 0                            # provider calls made BY THIS REQUEST (0 for a read or a reused result)
    persisted: bool = True
    effective_since: str | None = None


class MechanismSetResponse(BaseModel):
    status: str                                   # not_run | current | stale | unknown
    reused: bool = False
    reference_video_id: int
    video_analysis_id: int
    input_pin: MechanismInputPin
    mechanism_count: int
    mechanisms: list[MechanismOut]
    overall_limitations: list[str]
    anatomy_gaps: list[dict]                      # every gap the source anatomy reported, propagated
    provenance: MechanismSetProvenance | None = None


class MechanismAttemptOut(BaseModel):
    attempt_id: int
    created_at: str | None = None
    is_effective: bool
    anatomy_fingerprint: str | None = None
    provider: str | None = None
    model: str | None = None
    prompt_version: str | None = None
    mechanism_count: int | None = None
    mechanisms: list[MechanismOut] = []
    overall_limitations: list[str] = []


class MechanismAttemptsResponse(BaseModel):
    reference_video_id: int
    video_analysis_id: int
    effective_attempt_id: int | None = None
    attempts: list[MechanismAttemptOut]
