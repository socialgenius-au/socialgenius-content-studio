from enum import Enum
from pydantic import BaseModel
from datetime import datetime
from app.schemas.asset import AssetResponse


class FFmpegOp(str, Enum):
    extract_audio = "extract_audio"
    add_subtitles = "add_subtitles"
    resize = "resize"
    trim = "trim"
    convert = "convert"


class ProcessRequest(BaseModel):
    asset_id: int
    operation: FFmpegOp
    job_id: int | None = None
    # convert / extract_audio
    output_format: str | None = None
    # resize
    width: int | None = None
    height: int | None = None
    # trim
    start_time: float | None = None
    end_time: float | None = None
    # add_subtitles
    subtitle_asset_id: int | None = None
    subtitle_text: str | None = None  # inline SRT if no subtitle asset


class ProcessResponse(BaseModel):
    asset: AssetResponse
    operation: str
    duration_seconds: float


class MergeRequest(BaseModel):
    asset_ids: list[int]        # in order: before, after, outro
    transition: str = "dissolve"  # cut | dissolve | whip_pan | fade_to_black | zoom_punch
    transition_duration: float = 0.5
    job_id: int | None = None


class MergeResponse(BaseModel):
    asset: AssetResponse
    duration_seconds: float


class TextOverlay(BaseModel):
    text: str
    start: float
    end: float
    x: str | int = "(w-text_w)/2"
    y: str | int = "h-th-40"
    font_size: int = 42
    font_color: str = "white"


class ExportRequest(BaseModel):
    asset_ids: list[int]                 # clips to merge, in order
    transition: str = "dissolve"          # cut | dissolve | whip_pan | fade_to_black | zoom_punch
    transition_duration: float = 0.5
    text_overlays: list[TextOverlay] = []
    audio_asset_id: int | None = None     # separate custom audio track
    audio_mode: str = "replace"           # replace | mix
    audio_original_volume: float = 0.0    # only used when audio_mode == "mix"
    audio_volume: float = 1.0
    job_id: int | None = None


class ExportResponse(BaseModel):
    asset: AssetResponse
    duration_seconds: float
    steps: list[str]
