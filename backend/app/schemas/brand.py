from datetime import datetime
from pydantic import BaseModel


class BrandCreate(BaseModel):
    name: str
    colors: dict = {}
    fonts: dict = {}
    logo_url: str | None = None
    tone_of_voice: str | None = None


class BrandResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int
    name: str
    colors: dict
    fonts: dict
    logo_url: str | None
    tone_of_voice: str | None
    created_at: datetime
