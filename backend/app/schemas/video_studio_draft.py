from datetime import datetime
from pydantic import BaseModel


class VideoStudioDraftCreate(BaseModel):
    name: str
    project_json: dict


class VideoStudioDraftUpdate(BaseModel):
    name: str
    project_json: dict


# List view — deliberately omits project_json (Requirement: "Each saved draft must at minimum
# display: name, last saved/updated date/time, an Open/Continue action" — the list only needs
# to render that, not ship every clip/overlay/asset over the wire for every row).
class VideoStudioDraftSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    created_at: datetime
    updated_at: datetime


# Full detail view — used only by GET /{id}, which is what "Open/Continue Editing" calls.
class VideoStudioDraftResponse(VideoStudioDraftSummary):
    project_json: dict
