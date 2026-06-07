from pydantic import BaseModel
from typing import Any


class BeehiivPublishRequest(BaseModel):
    job_id: int | None = None
    title: str
    subtitle: str = ""
    content_html: str
    status: str = "draft"          # draft | confirmed
    send_at: str | None = None     # ISO 8601 datetime


class BeehiivPublishResponse(BaseModel):
    post_id: str
    status: str
    web_url: str | None = None


class GMBPublishRequest(BaseModel):
    job_id: int | None = None
    text: str
    call_to_action_type: str = "LEARN_MORE"
    call_to_action_url: str | None = None
    media_url: str | None = None


class GMBPublishResponse(BaseModel):
    post_name: str
    state: str
    create_time: str | None = None


class CanvaDesignRequest(BaseModel):
    job_id: int | None = None
    title: str
    design_type: str = "PRESENTATION"  # PRESENTATION | SOCIAL_MEDIA | POSTER | etc.
    brand_template_id: str | None = None
    data: dict[str, Any] = {}


class CanvaDesignResponse(BaseModel):
    design_id: str
    edit_url: str
    thumbnail_url: str | None = None


class ApifyRunRequest(BaseModel):
    actor_id: str
    input: dict[str, Any] = {}
    job_id: int | None = None
    timeout_secs: int = 60


class ApifyRunResponse(BaseModel):
    run_id: str
    status: str
    dataset_id: str | None = None
    items: list[Any] = []


class PixabaySearchResponse(BaseModel):
    total: int
    total_hits: int
    hits: list[dict]
