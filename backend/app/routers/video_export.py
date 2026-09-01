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
        })

    text_overlays: list[dict] = []
    for t in sorted(body.text_overlays, key=lambda t: t.order):
        text_overlays.append({
            "text": t.text,
            "start": t.start_time,
            "end": t.end_time,
            "x": round(body.canvas_width * t.x / 100),
            "y": round(body.canvas_height * t.y / 100),
            "font_size": t.font_size,
            "font_color": t.color,
        })

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
        "text_overlays": text_overlays,
        "media_overlays": media_overlays,
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
