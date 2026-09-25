"""C2 — Content Anatomy V1 response shape.

Content Anatomy is a DETERMINISTIC structural map of one exact VideoAnalysis, derived purely from the C1
aggregate (`deconstruction/full`): WHAT happens, WHEN, what EVIDENCE supports it, and how the piece
PROGRESSES. It contains no strategy and no recommendation -- "why would another creator copy this" is
C3's question. Every interpretive field is null unless upstream evidence genuinely supplies it, and each
absence is listed in `gaps`.

Typed strictly here (unlike the aggregate) because this is OUR output contract: C3 and C4 consume exactly
this shape, so it must not drift silently.
"""
from pydantic import BaseModel


class Gap(BaseModel):
    field: str
    kind: str          # unsupported_in_v1 | not_established | analysis_not_run | ai_not_configured | stage_<status> | unusable_source
    reason: str
    section_number: int | None = None


class SectionSourceChoice(BaseModel):
    selected: str | None        # "story_beats" | "shots" | "pacing_phases" | None (nothing usable)
    reason: str
    considered: list[dict]      # every candidate skeleton, whether available/usable, and why


class SpeechItem(BaseModel):
    id: int
    start_time: float
    end_time: float
    text: str
    language: str | None = None
    overlap_seconds: float


class TextItem(BaseModel):
    id: int
    text: str
    start_time: float
    end_time: float
    confidence_score: float | None = None
    certainty: str | None = None
    # Set when Stage 6 grouped this text into a recurring element (e.g. a persistent caption/watermark).
    # A pointer to existing evidence only -- C2 never decides that such text is or is not meaningful.
    recurring_element_id: int | None = None


class ObjectFact(BaseModel):
    label: str
    category: str
    count: int


class VisualFacts(BaseModel):
    objects: list[ObjectFact] = []
    persistent_visual_element_count: int = 0
    keyframe_ids: list[int] = []
    motion_evidence_shot_ids: list[int] = []
    transition_evidence_ids: list[int] = []


class SilenceItem(BaseModel):
    id: int
    start_time: float
    end_time: float
    overlap_seconds: float


class AudioFacts(BaseModel):
    audio_stream_present: bool | None = None
    silence_intervals: list[SilenceItem] = []
    silence_seconds: float = 0.0


class PacingFacts(BaseModel):
    shot_count: int
    cut_count: int
    average_shot_exposure_seconds: float | None = None
    cuts_per_minute: float | None = None
    pacing_phase_ids: list[int] = []


class DeviceRef(BaseModel):
    """An ACCEPTED retention device (is_retention_device=True). Nothing else may appear here."""
    id: int
    start_time: float
    end_time: float
    device_type: str | None = None
    probable_attention_function: str | None = None
    confidence: str | None = None
    reasoning_attempt_id: int | None = None
    certainty: str = "INFERRED"


class RejectedCandidateRef(BaseModel):
    """A retention candidate that was examined but NOT accepted -- reference only, never a mechanism."""
    attempt_id: int | None = None
    candidate_start: float
    candidate_end: float
    device_type: str | None = None
    status: str                       # "rejected" | "no_acceptance_decision" (historical pre-gate attempt)
    reasoning_excerpt: str | None = None


class InterpretiveFields(BaseModel):
    narrative_role: str | None = None
    messaging_role: str | None = None
    emotional_function: str | None = None
    cta_role: str | None = None
    status: str = "unsupported_in_v1"


class AnatomySection(BaseModel):
    number: int
    start_time: float
    end_time: float
    duration: float
    source_partition: str             # story_beat | shot | pacing_phase
    source_ref: dict                  # the id (and any status) of the partition row this section came from
    is_opening: bool
    overlaps_hook_window: bool
    transcript_excerpt: str | None = None
    transcript_truncated: bool = False
    speech: list[SpeechItem] = []
    on_screen_text: list[TextItem] = []
    visual: VisualFacts
    audio: AudioFacts
    pacing: PacingFacts
    scene_refs: list[dict] = []
    shot_refs: list[int] = []
    story_beat_refs: list[int] = []
    retention_devices: list[DeviceRef] = []
    rejected_candidates: list[RejectedCandidateRef] = []
    interpretive: InterpretiveFields
    features: list[str] = []          # compact structural map: hook_window|speech|on_screen_text|silence|cut|accepted_retention_device
    evidence_ids: dict[str, list[int]] = {}
    certainty: str = "MEASURED"       # time-partition / overlap arithmetic over persisted evidence


class VideoAnatomy(BaseModel):
    duration: float
    section_count: int
    opening_section_number: int | None = None
    hook: dict
    pacing_profile: dict
    structural_pattern: dict
    progression: list[dict]
    retention: dict
    interpretive: InterpretiveFields


class AnatomyProvenance(BaseModel):
    anatomy_version: str
    reference_video_id: int | None = None
    video_analysis_id: int | None = None
    derived_from: str = "deconstruction/full"
    orchestration_status: str | None = None
    llm_calls: int = 0
    persisted: bool = False           # V1 is recomputed on every read; `fingerprint` pins what a consumer saw
    fingerprint: str                  # sha256 of the anatomy content + evidence ids (no timestamps)
    notes: list[str] = []


class ContentAnatomyResponse(BaseModel):
    video: VideoAnatomy
    section_source: SectionSourceChoice
    sections: list[AnatomySection]
    evidence_coverage: dict
    gaps: list[Gap]
    provenance: AnatomyProvenance
