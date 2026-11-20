from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CarouselCreate(BaseModel):
    """`document` is the full PostDocument; its `id` becomes the carousel's id (unique per user). An existing id is refused (409), never overwritten."""
    document: dict
    theme_id: str = Field(default="forest", max_length=32)
    active_slide_id: str | None = Field(default=None, max_length=64)
    imported_from: Literal["browser"] | None = None


class CarouselUpdate(BaseModel):
    """`expected_version` is the version the editor last saw. If the server has moved on, the update is refused (409) unless `force` is set, which is an explicit "keep my version" choice."""
    document: dict
    expected_version: int = Field(ge=1)
    theme_id: str = Field(default="forest", max_length=32)
    active_slide_id: str | None = Field(default=None, max_length=64)
    force: bool = False


class CarouselSummary(BaseModel):
    model_config = {"from_attributes": True}

    doc_id: str
    title: str
    slide_count: int
    platform_key: str
    format_key: str
    theme_id: str
    blueprint_id: str | None = None
    reference_video_id: int | None = None
    origin: str
    version: int
    created_at: datetime
    updated_at: datetime


class CarouselFull(CarouselSummary):
    active_slide_id: str | None = None
    document: dict


class CarouselSaved(BaseModel):
    """What an accepted save returns: just enough for the editor to keep its version in step."""
    doc_id: str
    version: int
    updated_at: datetime
    title: str
    slide_count: int
