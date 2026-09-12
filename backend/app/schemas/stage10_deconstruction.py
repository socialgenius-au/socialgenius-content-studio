"""Video Deconstructor — Stage 10 Application Access Checkpoint response schemas.

Deliberately loose on the deeply-nested evidence/provenance shapes (typed as `dict`/`list[dict]`
rather than a fully-modeled Pydantic tree): those shapes already live in, and are owned by, the
existing Scene/Story Beat `details` JSON contracts (see scene.py / story_beat_construction_svc.py's
own docstrings for the exact locked key sets). Re-modeling every nested key here would create a
second, parallel schema for the same data that could silently drift from the real one — these
schemas exist only to give the two new Stage 10 endpoints a documented top-level shape, never to
re-specify what a boundary/evidence object contains.
"""
from pydantic import BaseModel


class Stage10RunResponse(BaseModel):
    video_analysis_id: int
    scene_candidates_reasoned: int
    story_beat_candidates_reasoned: int
    scenes_count: int
    story_beats_count: int


class StoryBeatNode(BaseModel):
    id: int
    start_time: float
    end_time: float
    boundary_status: str | None
    certainty: str
    boundary_start: dict | None
    boundary_end: dict | None
    co_nominated_attempt_ids: list[int]
    examined_unresolved_attempt_ids: list[int]
    unresolved_attempt_ids: list[int]


class SceneNode(BaseModel):
    id: int
    order: int
    start_time: float
    end_time: float
    narrative_role: str | None
    certainty: str
    confidence_score: float | None
    boundary_start: dict | None
    boundary_end: dict | None
    story_beats: list[StoryBeatNode]


class Stage10DeconstructionResponse(BaseModel):
    video_analysis_id: int
    reference_video_id: int
    duration: float | None
    scenes: list[SceneNode]
