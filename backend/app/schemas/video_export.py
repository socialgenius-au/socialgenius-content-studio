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


# Phase 7 (Video Studio V2 — Export/FFmpeg Compositing Parity). Mirrors Phase 1's own
# additionalVideoClips (frontend/src/types/index.ts's VideoClip, reused for V2) as closely as
# ExportVideoClip mirrors V1's — a REAL second video layer, not the older /process/export
# endpoint's single-transition shape. Deliberately no speed/transition fields: Video Studio V2
# never exposed those controls for V2 clips (Phase 1's own tracked item E), so export doesn't
# invent support the editor itself doesn't have. B-roll audio is NOT modeled here at all — a
# "kept" B-roll audio track is already a completely ordinary AudioTrack (same assetId, same
# timing) that flows through the existing audio_tracks list below unchanged; "muted"/"removed"
# means no AudioTrack was ever created. This clip's own embedded audio is never mapped by the
# renderer regardless — matching the live preview's own always-muted V2 <video> element exactly.
class ExportAdditionalVideoClip(BaseModel):
    asset_id: int
    start_time: float
    end_time: float
    trim_in: float
    color_grade: str = "none"
    brightness: float = 0
    contrast: float = 0
    saturation: float = 0
    fit_mode: str = "fit"
    crop_x: float = 50.0
    crop_y: float = 50.0
    insert_x: float = 56.0
    insert_y: float = 56.0
    insert_width: float = 38.0
    insert_height: float = 38.0
    opacity: float = 1.0
    order: float = 0


class ExportTextOverlay(BaseModel):
    text: str
    start_time: float
    end_time: float
    x: float          # percent of canvas width
    y: float           # percent of canvas height
    font_size: int = 42
    color: str = "#FFFFFF"
    order: float = 0
    # Phase 7: this project's real ffmpeg binary (imageio_ffmpeg's bundled static build) turned
    # out to have no `drawtext` filter at all — confirmed by direct execution, not assumed — so
    # text is no longer burned in via drawtext/drawbox at all. Every field below is rendered as
    # a real Pillow image (canvas_render_svc.render_text_overlay_png) and composited with the
    # `overlay` filter, which IS present. That gives genuine support for fields drawtext could
    # never have reproduced anyway: gradient fill, per-character letter_spacing, rounded-corner/
    # blurred backgrounds, real stroke/shadow. Two gaps remain, both documented rather than
    # silently approximated: italic renders upright (no italic DejaVu Sans variant is bundled —
    # see app/assets/fonts/LICENSE.txt) and font family is always DejaVu Sans (no other font
    # file is bundled/guaranteed present on the render host).
    align: str = "left"
    bold: bool = False
    underline: bool = False
    letter_spacing: float = 0
    line_spacing: float = 1.15
    width_pct: float | None = None  # None = default ~90% of canvas width, matching pre-Phase-7 sizing
    opacity: float = 1.0
    stroke_color: str | None = None
    stroke_width: float = 0
    shadow_color: str | None = None
    shadow_blur: float = 0
    shadow_offset_x: float = 0
    shadow_offset_y: float = 0
    use_gradient: bool = False
    gradient_from: str | None = None
    gradient_to: str | None = None
    bg_color: str | None = None  # None = "caller didn't send this" -> no background chip rendered
    bg_opacity: float = 0.5
    bg_padding: float = 8
    bg_border_radius: float = 0
    bg_border_color: str | None = None
    bg_border_width: float = 0
    bg_blur: bool = False
    bg_full_width: bool = False


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


# Phase 7 — Requirement (Shapes export/ffmpeg compositing, deferred item L). Rendered as a real
# raster image via canvas_render_svc.render_shape_png, not approximated through ffmpeg's own
# drawbox filter (which has no filled-ellipse or rounded-corner primitive at all) — so 'circle'
# renders as a real filled ellipse and border_radius produces a real rounded rectangle, both
# genuinely accurate rather than square/plain-rectangle approximations. See that module's own
# docstring for why PNG-overlay compositing is this phase's rendering strategy throughout.
class ExportShape(BaseModel):
    kind: str
    start_time: float
    end_time: float
    x: float
    y: float
    width: float
    height: float
    fill_color: str
    opacity: float = 1.0
    border_color: str | None = None
    border_width: float = 0
    border_radius: float = 0
    full_width: bool = False
    order: float = 0


# Phase 7 — Requirement (Lower Third export/ffmpeg compositing, deferred item F). showLogo is
# accepted but not rendered — deferred item H already flags that no actual logo asset exists to
# render, in the live preview OR here; carrying the field through keeps the export request shape
# a faithful mirror of the editor's own LowerThird rather than silently dropping it.
class ExportLowerThird(BaseModel):
    name: str
    title: str = ""
    start_time: float
    end_time: float
    x: float = 5
    y: float = 78
    width: float = 55
    height: float = 14
    show_logo: bool = False
    order: float = 0


# Phase 7 — Requirement (Subtitle export/ffmpeg compositing, deferred item N). Mirrors
# SubtitleStyle (frontend/src/types/index.ts) exactly — the same "global style, per-segment
# override" shape CreateEditTab.tsx's own resolveSubtitleStyle merges client-side; the identical
# merge happens server-side in ffmpeg_svc.composite_subtitles, so preview and export resolve a
# segment's real style the same way.
class ExportSubtitleStyle(BaseModel):
    font_size: int = 36
    color: str = "#FFFFFF"
    bg_color: str = "#000000"
    bg_opacity: float = 0.6
    align: str = "center"
    outline_color: str | None = None
    outline_width: float = 0
    shadow_color: str | None = None
    shadow_blur: float = 0


class ExportSubtitle(BaseModel):
    text: str
    start_time: float
    end_time: float
    x: float = 10
    y: float = 82
    width: float = 80
    # A PARTIAL style — any key present here overrides subtitle_style's own value for this one
    # segment; any key absent/omitted falls back to the project's global subtitle_style, exactly
    # matching styleOverride's own optional-partial semantics in the frontend type.
    style_override: dict = {}
    order: float = 0


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
    # Phase 7 additions — every one defaults to empty/default so a request built before this
    # phase (or a test that only cares about V1) behaves identically to today.
    additional_video_clips: list[ExportAdditionalVideoClip] = []
    text_overlays: list[ExportTextOverlay] = []
    shapes: list[ExportShape] = []
    lower_thirds: list[ExportLowerThird] = []
    media_overlays: list[ExportMediaOverlay] = []
    subtitles: list[ExportSubtitle] = []
    subtitle_style: ExportSubtitleStyle = ExportSubtitleStyle()
    audio_tracks: list[ExportAudioTrack] = []
