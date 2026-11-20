"""Request / response shapes for Brand Kits and Carousel templates."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class BrandKitBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kit: dict


class BrandKitSummary(BaseModel):
    id: int
    name: str
    primary: str | None = None
    logo_count: int = 0
    font_count: int = 0
    updated_at: datetime


class BrandKitFull(BaseModel):
    id: int
    name: str
    kit: dict
    created_at: datetime
    updated_at: datetime


class FontUploaded(BaseModel):
    asset_id: int
    url: str
    filename: str
    family_guess: str
    mime_type: str
    size: int


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    kind: Literal["carousel", "layout"] = "carousel"
    document: dict
    brand_kit_id: int | None = None


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    document: dict | None = None
    brand_kit_id: int | None = None


class TemplateSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    description: str
    kind: str
    slide_count: int
    platform_key: str
    format_key: str
    brand_kit_id: int | None = None
    created_at: datetime
    updated_at: datetime


class TemplateFull(TemplateSummary):
    document: dict
