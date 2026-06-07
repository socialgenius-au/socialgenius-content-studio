import mimetypes
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.deps import current_user
from app.models.asset import Asset
from app.models.user import User
from app.schemas.process import FFmpegOp, ProcessRequest, ProcessResponse
from app.schemas.asset import AssetResponse
from app.services import ffmpeg_svc

router = APIRouter()


@router.post("/", response_model=ProcessResponse)
async def process_asset(
    body: ProcessRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Asset).where(Asset.id == body.asset_id, Asset.user_id == user.id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    t0 = time.perf_counter()

    try:
        if body.operation == FFmpegOp.extract_audio:
            out_path = await ffmpeg_svc.extract_audio(asset.file_path, user.id)

        elif body.operation == FFmpegOp.add_subtitles:
            srt_path: str | None = None
            if body.subtitle_asset_id:
                sr = await db.execute(select(Asset).where(Asset.id == body.subtitle_asset_id, Asset.user_id == user.id))
                srt_asset = sr.scalar_one_or_none()
                if not srt_asset:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtitle asset not found")
                srt_path = srt_asset.file_path
            elif body.subtitle_text:
                # Write inline SRT to a temp file
                import uuid, aiofiles
                tmp = Path(asset.file_path).parent / f"{uuid.uuid4().hex}.srt"
                async with aiofiles.open(tmp, "w") as f:
                    await f.write(body.subtitle_text)
                srt_path = str(tmp)
            if not srt_path:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="subtitle_asset_id or subtitle_text required")
            out_path = await ffmpeg_svc.add_subtitles(asset.file_path, srt_path, user.id)

        elif body.operation == FFmpegOp.resize:
            if not body.width or not body.height:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="width and height required for resize")
            out_path = await ffmpeg_svc.resize(asset.file_path, body.width, body.height, user.id)

        elif body.operation == FFmpegOp.trim:
            if body.start_time is None or body.end_time is None:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="start_time and end_time required for trim")
            out_path = await ffmpeg_svc.trim(asset.file_path, body.start_time, body.end_time, user.id)

        elif body.operation == FFmpegOp.convert:
            if not body.output_format:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="output_format required for convert")
            out_path = await ffmpeg_svc.convert(asset.file_path, body.output_format, user.id)

        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown operation")

    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    size = out_path.stat().st_size
    mime = mimetypes.guess_type(str(out_path))[0] or "application/octet-stream"
    ftype = "audio" if mime.startswith("audio") else "video" if mime.startswith("video") else "other"

    new_asset = Asset(
        job_id=body.job_id or asset.job_id,
        user_id=user.id,
        original_filename=f"{body.operation.value}_{asset.original_filename}",
        stored_filename=out_path.name,
        file_path=str(out_path),
        file_type=ftype,
        mime_type=mime,
        file_size=size,
    )
    db.add(new_asset)
    await db.commit()
    await db.refresh(new_asset)

    return ProcessResponse(
        asset=AssetResponse.model_validate(new_asset),
        operation=body.operation.value,
        duration_seconds=round(time.perf_counter() - t0, 2),
    )
