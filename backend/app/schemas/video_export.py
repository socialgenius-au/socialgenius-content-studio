from pydantic import BaseModel


# STEP 7.15F: shape mirrors Video Studio V2's own editor state (VideoClip/TextOverlay/
# MediaOverlay/AudioTrack in frontend/src/types/index.ts, and CanvasFormatState in
# StudioContext.tsx) as closely as field names allow — the frontend sends its live state
# almost as-is rather than translating into some other export-specific shape. `asset_id` is
# the one thing resolved server-side (via the DB, scoped to the current user) rather than
# trusted from the client — clips/overlays/audio only ever carry a numeric asset id here, never
# a raw file path or URL.

class ExportVideoClip(BaseModel):
    asset_id: int
    start_time: float
    end_time: float
    trim_in: float
    speed: float = 1
    color_grade: str = "none"
    brightness: float = 0
    contrast: float = 0
    saturation: float = 0
    transition: str = "cut"
    transition_duration: float = 0.5
    # STEP 7 (Original Video Audio controls): this clip's OWN embedded audio only — additive to
    # (never a replacement for) the existing "muted once separated to A1" rule computed from
    # audio_tracks below. Independent of A1's own volume, other clips, and overlay audio.
    muted: bool = False
    volume: float = 1.0
    # STEP 7 (Platform Canvas / Full-Screen Video Acceptance): how this clip's frame maps onto
    # the platform canvas — mirrors VideoClip.fitMode/cropOffsetX/Y in frontend/src/types/
    # index.ts exactly, including the "fit"/50/50 default for a clip saved before this field
    # existed, so the export always matches what that clip's own live preview showed.
    fit_mode: str = "fit"
    crop_x: float = 50.0
    crop_y: float = 50.0


class ExportTextOverlay(BaseModel):
    text: str
    start_time: float
    end_time: float
    x: float          # percent of canvas width
    y: float           # percent of canvas height
    font_size: int = 42
    color: str = "#FFFFFF"
    order: float = 0


class ExportMediaOverlay(BaseModel):
    asset_id: int
    start_time: float
    end_time: float
    x: float
    y: float
    width: float
    height: float
    opacity: float = 1.0
    order: float = 0
    # STEP 7.15H: a video-backed overlay's own audio (Instruction 5) — previously not sent to
    # the backend at all, so it could never have been mixed in regardless of what the renderer
    # did with it.
    muted: bool = False
    volume: float = 1.0


class ExportAudioTrack(BaseModel):
    asset_id: int
    start_time: float
    end_time: float
    trim_in: float
    volume: float = 1.0


class ExportProjectRequest(BaseModel):
    canvas_width: int
    canvas_height: int
    video_clips: list[ExportVideoClip]
    text_overlays: list[ExportTextOverlay] = []
    media_overlays: list[ExportMediaOverlay] = []
    audio_tracks: list[ExportAudioTrack] = []
