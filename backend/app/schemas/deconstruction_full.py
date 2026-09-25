"""C1 — request/response shapes for the one-click deconstruction orchestrator and the aggregate
deconstruction read model. Sections other than `evidence` are deliberately loosely typed (plain dict/
list): they surface already-persisted AnalysisAnnotation/StrategicInsight `details` payloads whose own
shapes are owned (and versioned) by the stage that wrote them, and older rows legitimately lack newer
keys. `evidence` reuses the existing, already-typed ReferenceVideoResponse verbatim."""
from pydantic import BaseModel

from app.schemas.reference_video import ReferenceVideoResponse


class StageStatus(BaseModel):
    key: str
    label: str
    kind: str
    depends_on: list[str] = []
    status: str
    error: str | None = None
    reason: str | None = None
    degraded_inputs: list[str] = []
    summary: dict | None = None
    requires_ai: bool = False


class DeconstructionStatusResponse(BaseModel):
    reference_video_id: int
    video_analysis_id: int
    orchestration: dict | None = None
    stages: list[StageStatus]


class DeconstructionRunResponse(BaseModel):
    reference_video_id: int
    video_analysis_id: int
    mode: str                      # "background" (202, poll status) | "inline" (waited for completion)
    overall_status: str            # running | complete | partial | failed | interrupted
    orchestration: dict | None = None
    stages: list[StageStatus]


class DeconstructionFullResponse(BaseModel):
    """Everything the Deconstructor currently knows about one source, for one exact VideoAnalysis.
    Missing analyses are null / empty collections -- never fabricated."""
    source: dict
    video_analysis: dict
    orchestration: dict | None = None
    stages: list[StageStatus]
    technical: dict
    evidence: ReferenceVideoResponse
    structure: dict
    editing_rhythm: dict
    hook: dict
    retention: dict
    strategic_insights: list[dict]
    ai_configured: dict[str, bool]
    availability: dict[str, bool]
