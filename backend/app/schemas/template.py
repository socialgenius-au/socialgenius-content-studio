from datetime import datetime
from pydantic import BaseModel


class TemplateResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int
    name: str
    description: str | None
    prompt: str
    plan_json: dict | None
    created_at: datetime
    updated_at: datetime
