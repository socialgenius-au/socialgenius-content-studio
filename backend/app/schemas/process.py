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
