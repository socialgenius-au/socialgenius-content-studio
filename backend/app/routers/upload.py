import mimetypes
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import current_user
from app.models.asset import Asset
from app.models.user import User
from app.schemas.asset import AssetResponse

router = APIRouter()

_MIME_TO_TYPE: dict[str, str] = {}
for _t, _prefixes in {"video": ["video/"], "audio": ["audio/"], "image": ["image/"], "document": ["application/pdf"]}.items():
    for _p in _prefixes:
        _MIME_TO_TYPE[_p] = _t


def _classify(mime: str) -> str:
    for prefix, ftype in _MIME_TO_TYPE.items():
        if mime.startswith(prefix) or mime == prefix:
            return ftype
    return "other"


@router.post("/", response_model=AssetResponse)
async def upload_file(
    file: UploadFile = File(...),
    job_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    ext = Path(file.filename or "").suffix.lstrip(".").lower()
    if ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"File type .{ext} is not allowed",
        )

    content = await file.read()
    size = len(content)

    if size > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File exceeds size limit")

    user_dir = Path(settings.UPLOAD_DIR) / str(user.id)
    user_dir.mkdir(parents=True, exist_ok=True)

    stored_name = f"{uuid.uuid4().hex}.{ext}"
    file_path = user_dir / stored_name

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"

    asset = Asset(
        job_id=job_id,
        user_id=user.id,
        original_filename=file.filename or stored_name,
        stored_filename=stored_name,
        file_path=str(file_path),
        file_type=_classify(mime),
        mime_type=mime,
        file_size=size,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset
