from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.deps import current_user
from app.models.asset import Asset
from app.models.user import User
from app.schemas.video_export import ExportProjectRequest
from app.services import ffmpeg_svc

router = APIRouter()


async def _resolve_asset_path(db: AsyncSession, asset_id: int, user_id: int) -> str:
    result = await db.execute(select(Asset).where(Asset.id == asset_id, Asset.user_id == user_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Asset {asset_id} not found")
    return asset.file_path


# STEP 7.15F: real Video Studio V2 export — the ONLY thing the previous "Export Video" button
# did was flash a fake success toast (ReviewTab.tsx had no export logic at all). This performs
# an actual ffmpeg render of the current project (see ffmpeg_svc.render_project) and streams
# the resulting file straight back as the HTTP response body, so the browser's own download
# mechanism fires the moment rendering genuinely finishes — never before, and never on failure
# (a render error raises here as a real 4xx/5xx, which the frontend surfaces as a real error,
# not a success toast).
@router.post("/export")
async def export_project(
    body: ExportProjectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    if not body.video_clips:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Add at least one video clip before exporting.")

    clip_asset_ids = {c.asset_id for c in body.video_clips}
    audio_asset_ids_by_clip = {a.asset_id for a in body.audio_tracks}

    video_clips: list[dict] = []
    for c in body.video_clips:
        path = await _resolve_asset_path(db, c.asset_id, user.id)
        video_clips.append({
            "path": path,
            "trim_in": c.trim_in,
            "start_time": c.start_time,
            "end_time": c.end_time,
            "speed": c.speed,
            "color_grade": c.color_grade,
            "brightness": c.brightness,
            "contrast": c.contrast,
            "saturation": c.saturation,
            "transition": c.transition,
            "transition_duration": c.transition_duration,
            # Step 7.6A's own rule, reapplied server-side: once a clip's audio has been
            # separated onto its own A1 track (same asset id), the base timeline must not
            # ALSO carry that clip's original embedded audio — same "no duplicate audio"
            # principle already enforced in the live preview.
            "has_separated_audio": c.asset_id in audio_asset_ids_by_clip,
            # Step 7 (Original Video Audio controls): this clip's own explicit on/off + volume
            # — additive to has_separated_audio above, never a replacement for it.
            "muted": c.muted,
            "volume": c.volume,
            # STEP 7 (Platform Canvas / Full-Screen Video Acceptance): this clip's own Fit/Fill
            # + crop position, exactly as its live preview rendered it.
            "fit_mode": c.fit_mode,
            "crop_x": c.crop_x,
            "crop_y": c.crop_y,
        })

    # Phase 7 (Video Studio V2 — Export/FFmpeg Compositing Parity): this project's real ffmpeg
    # binary has no `drawtext` filter (see canvas_render_svc.py's own module docstring), so
    # render_project no longer burns text in via the old drawtext-based add_text_overlays() call
    # — text is now rendered as a real Pillow PNG and composited with `overlay`, the same path
    # every other new element type below uses. The dict shape changed to match: x/y stay RAW
    # PERCENT (not pre-resolved to pixels — canvas_render_svc/ffmpeg_svc do that conversion
    # themselves now, the same convention shapes/lower_thirds/subtitles use), "start"/"end"
    # became "start_time"/"end_time", and every Phase 3 (Advanced Text Properties) style field is
    # now carried through instead of being silently dropped.
    text_overlays: list[dict] = []
    for t in sorted(body.text_overlays, key=lambda t: t.order):
        text_overlays.append({
            "text": t.text,
            "start_time": t.start_time,
            "end_time": t.end_time,
            "x": t.x,
            "y": t.y,
            "font_size": t.font_size,
            "color": t.color,
            "align": t.align,
            "bold": t.bold,
            "underline": t.underline,
            "letter_spacing": t.letter_spacing,
            "line_spacing": t.line_spacing,
            "width_pct": t.width_pct,
            "opacity": t.opacity,
            "stroke_color": t.stroke_color,
            "stroke_width": t.stroke_width,
            "shadow_color": t.shadow_color,
            "shadow_blur": t.shadow_blur,
            "shadow_offset_x": t.shadow_offset_x,
            "shadow_offset_y": t.shadow_offset_y,
            "use_gradient": t.use_gradient,
            "gradient_from": t.gradient_from,
            "gradient_to": t.gradient_to,
            "bg_color": t.bg_color,
            "bg_opacity": t.bg_opacity,
            "bg_padding": t.bg_padding,
            "bg_border_radius": t.bg_border_radius,
            "bg_border_color": t.bg_border_color,
            "bg_border_width": t.bg_border_width,
            "bg_blur": t.bg_blur,
            "bg_full_width": t.bg_full_width,
        })

    # Phase 7 (deferred item A/D — V2 Insert/B-roll export parity).
    additional_video_clips: list[dict] = []
    for c in sorted(body.additional_video_clips, key=lambda c: c.order):
        path = await _resolve_asset_path(db, c.asset_id, user.id)
        additional_video_clips.append({
            "path": path,
            "trim_in": c.trim_in,
            "start_time": c.start_time,
            "end_time": c.end_time,
            "color_grade": c.color_grade,
            "brightness": c.brightness,
            "contrast": c.contrast,
            "saturation": c.saturation,
            "fit_mode": c.fit_mode,
            "crop_x": c.crop_x,
            "crop_y": c.crop_y,
            "insert_x": c.insert_x,
            "insert_y": c.insert_y,
            "insert_width": c.insert_width,
            "insert_height": c.insert_height,
            "opacity": c.opacity,
        })

    # Phase 7 (deferred item L — Shapes export parity). x/y/width/height stay raw percent, same
    # convention as text_overlays above now — canvas_render_svc resolves against the real canvas
    # size when it renders each shape's own PNG.
    shapes: list[dict] = []
    for sh in sorted(body.shapes, key=lambda s: s.order):
        shapes.append({
            "kind": sh.kind,
            "start_time": sh.start_time,
            "end_time": sh.end_time,
            "x": sh.x,
            "y": sh.y,
            "width": sh.width,
            "height": sh.height,
            "fill_color": sh.fill_color,
            "opacity": sh.opacity,
            "border_color": sh.border_color,
            "border_width": sh.border_width,
            "border_radius": sh.border_radius,
            "full_width": sh.full_width,
        })

    # Phase 7 (deferred item F — Lower Third export parity). show_logo is carried through for
    # shape fidelity but not rendered — no logo asset exists to render, in the live preview or
    # here (see ExportLowerThird's own docstring).
    lower_thirds: list[dict] = []
    for lt in sorted(body.lower_thirds, key=lambda l: l.order):
        lower_thirds.append({
            "name": lt.name,
            "title": lt.title,
            "start_time": lt.start_time,
            "end_time": lt.end_time,
            "x": lt.x,
            "y": lt.y,
            "width": lt.width,
            "height": lt.height,
        })

    # Phase 7 (deferred item N — Subtitle export parity). style_override stays a raw dict — the
    # same partial-override shape resolve_subtitle_style merges against subtitle_style below,
    # mirroring resolveSubtitleStyle's own client-side merge exactly.
    subtitles: list[dict] = []
    for sub in sorted(body.subtitles, key=lambda s: s.order):
        subtitles.append({
            "text": sub.text,
            "start_time": sub.start_time,
            "end_time": sub.end_time,
            "x": sub.x,
            "y": sub.y,
            "width": sub.width,
            "style_override": sub.style_override,
        })
    subtitle_style = body.subtitle_style.model_dump()

    media_overlays: list[dict] = []
    for o in sorted(body.media_overlays, key=lambda o: o.order):
        path = await _resolve_asset_path(db, o.asset_id, user.id)
        result = await db.execute(select(Asset).where(Asset.id == o.asset_id, Asset.user_id == user.id))
        asset = result.scalar_one()
        media_overlays.append({
            "path": path,
            "is_image": asset.file_type == "image",
            "start": o.start_time,
            "end": o.end_time,
            "x": o.x, "y": o.y, "width": o.width, "height": o.height,
            "opacity": o.opacity,
            "muted": o.muted, "volume": o.volume,
        })

    audio_tracks: list[dict] = []
    for a in body.audio_tracks:
        path = await _resolve_asset_path(db, a.asset_id, user.id)
        audio_tracks.append({
            "path": path,
            "trim_in": a.trim_in,
            "start_time": a.start_time,
            "end_time": a.end_time,
            "volume": a.volume,
        })

    project = {
        "canvas_width": body.canvas_width,
        "canvas_height": body.canvas_height,
        "video_clips": video_clips,
        "additional_video_clips": additional_video_clips,
        "text_overlays": text_overlays,
        "shapes": shapes,
        "lower_thirds": lower_thirds,
        "media_overlays": media_overlays,
        "subtitles": subtitles,
        "subtitle_style": subtitle_style,
        "audio_tracks": audio_tracks,
    }

    try:
        out_path = await ffmpeg_svc.render_project(project, user.id)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    return FileResponse(
        path=out_path,
        media_type="video/mp4",
        filename="video-studio-export.mp4",
    )
