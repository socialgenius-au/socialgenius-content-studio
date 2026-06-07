from datetime import datetime
from pydantic import BaseModel


class JobResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int
    brand_id: int | None
    title: str
    prompt: str
    plan_json: dict | None
    status: str
    created_at: datetime
    updated_at: datetime


class StatusUpdate(BaseModel):
    status: str
