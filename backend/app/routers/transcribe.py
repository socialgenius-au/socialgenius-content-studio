from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.deps import current_user
from app.models.asset import Asset
from app.models.transcript import Transcript
from app.models.user import User
from app.schemas.transcript import TranscriptResponse
from app.services import whisper_svc

router = APIRouter()


@router.post("/{asset_id}", response_model=TranscriptResponse)
async def transcribe_asset(
    asset_id: int,
    language: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Asset).where(Asset.id == asset_id, Asset.user_id == user.id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    if asset.file_type not in ("audio", "video"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Asset must be audio or video")

    raw = await whisper_svc.transcribe(asset.file_path, language=language)
    srt = whisper_svc.segments_to_srt(raw["segments"])

    transcript = Transcript(
        asset_id=asset.id,
        job_id=asset.job_id,
        user_id=user.id,
        language=raw.get("language", "en"),
        full_text=raw["text"],
        segments=raw["segments"],
        srt=srt,
        word_timestamps=False,
        model_used="base",
    )
    db.add(transcript)
    await db.commit()
    await db.refresh(transcript)
    return transcript


@router.get("/asset/{asset_id}", response_model=list[TranscriptResponse])
async def list_transcripts_for_asset(
    asset_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(
        select(Transcript).where(Transcript.asset_id == asset_id, Transcript.user_id == user.id)
        .order_by(Transcript.created_at.desc())
    )
    return result.scalars().all()
