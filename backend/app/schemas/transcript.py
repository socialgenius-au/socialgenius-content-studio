from datetime import datetime
from pydantic import BaseModel


class TranscriptResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    asset_id: int
    job_id: int | None
    user_id: int
    language: str
    full_text: str
    segments: list
    srt: str | None
    word_timestamps: bool
    model_used: str
    created_at: datetime
