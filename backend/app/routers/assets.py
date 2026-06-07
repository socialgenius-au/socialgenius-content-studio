"""Global asset management — list, download individual files, and bulk ZIP export."""
import io
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.deps import current_user
from app.models.asset import Asset
from app.models.user import User
from app.schemas.asset import AssetResponse

router = APIRouter()


@router.get("/", response_model=list[AssetResponse])
async def list_assets(
    file_type: str | None = Query(None, description="Filter by file_type (video, audio, image, document, thumbnail)"),
    job_id: int | None = Query(None, description="Filter to a specific job"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    q = select(Asset).where(Asset.user_id == user.id)
    if file_type:
        q = q.where(Asset.file_type == file_type)
    if job_id is not None:
        q = q.where(Asset.job_id == job_id)
    result = await db.execute(q.order_by(Asset.created_at.desc()))
    return result.scalars().all()


@router.get("/{asset_id}/download")
async def download_asset(
    asset_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Asset).where(Asset.id == asset_id, Asset.user_id == user.id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    if not Path(asset.file_path).exists():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="File no longer exists on disk")
    return FileResponse(
        path=asset.file_path,
        filename=asset.original_filename,
        media_type=asset.mime_type,
    )


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Asset).where(Asset.id == asset_id, Asset.user_id == user.id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    try:
        Path(asset.file_path).unlink(missing_ok=True)
    except OSError:
        pass

    await db.delete(asset)
    await db.commit()


class ZipRequest(BaseModel):
    asset_ids: list[int]


@router.post("/zip")
async def zip_assets(
    body: ZipRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    if not body.asset_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No asset IDs provided")
    if len(body.asset_ids) > 100:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Maximum 100 assets per ZIP")

    result = await db.execute(
        select(Asset).where(Asset.id.in_(body.asset_ids), Asset.user_id == user.id)
    )
    assets = result.scalars().all()

    if not assets:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No matching assets found")

    buf = io.BytesIO()
    seen_names: dict[str, int] = {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for asset in assets:
            p = Path(asset.file_path)
            if not p.exists():
                continue
            # Deduplicate filenames inside the archive
            name = asset.original_filename
            if name in seen_names:
                seen_names[name] += 1
                stem, ext = Path(name).stem, Path(name).suffix
                name = f"{stem}_{seen_names[name]}{ext}"
            else:
                seen_names[name] = 0
            zf.write(str(p), name)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=socialgenius-assets.zip"},
    )
