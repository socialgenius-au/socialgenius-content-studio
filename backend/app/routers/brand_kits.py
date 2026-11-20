"""Brand Kits for the Carousel Creator: reusable, account-owned sets of brand names, colours, logos, custom fonts and brand assets.

  GET    /brand-kits/                 your kits (summaries)
  POST   /brand-kits/                 create
  GET    /brand-kits/{id}             open (media URLs carry a fresh short-lived token)
  PUT    /brand-kits/{id}             replace
  DELETE /brand-kits/{id}
  POST   /brand-kits/{id}/duplicate
  POST   /brand-kits/fonts            upload a font file into the existing media storage (validated by extension and by the file's own bytes)

Pictures and fonts are never stored in the kit: it references the user's own assets, which are checked (ownership AND kind) on every save. Every query is scoped to the signed-in
user, so another user's kit is indistinguishable from one that does not exist (404).
"""
from __future__ import annotations

import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import current_user
from app.models.asset import Asset
from app.models.brand_kit import BrandKit
from app.models.user import User
from app.schemas.carousel_assets import BrandKitBody, BrandKitFull, BrandKitSummary, FontUploaded
from app.services.brand_kit_validation import (
    MAX_FONT_BYTES, MAX_KITS_PER_USER, BrandKitValidationError, check_font_file, check_kit_assets, validate_kit,
)
from app.services.media_access import create_media_token, rewrite_media_urls

router = APIRouter()


def _invalid(exc: BrandKitValidationError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "invalid_kit", "errors": exc.errors[:20]})


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand Kit not found")


def _summary(row: BrandKit) -> BrandKitSummary:
    kit = row.kit_json or {}
    return BrandKitSummary(id=row.id, name=row.name, primary=(kit.get("colors") or {}).get("primary"), logo_count=len(kit.get("logos") or []), font_count=len(kit.get("fonts") or []), updated_at=row.updated_at)


def _present(row: BrandKit, user: User) -> BrandKitFull:
    token, _ttl = create_media_token(user.id)
    return BrandKitFull(id=row.id, name=row.name, kit=rewrite_media_urls(row.kit_json, user.id, token), created_at=row.created_at, updated_at=row.updated_at)


async def _owned(db: AsyncSession, user: User, kit_id: int) -> BrandKit:
    row = (await db.execute(select(BrandKit).where(BrandKit.id == kit_id, BrandKit.user_id == user.id))).scalar_one_or_none()
    if row is None:
        raise _not_found()
    return row


async def _count(db: AsyncSession, user: User) -> int:
    return (await db.execute(select(func.count()).select_from(BrandKit).where(BrandKit.user_id == user.id))).scalar_one()


@router.get("/", response_model=list[BrandKitSummary])
async def list_kits(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    rows = (await db.execute(select(BrandKit).where(BrandKit.user_id == user.id).order_by(BrandKit.updated_at.desc()).limit(MAX_KITS_PER_USER))).scalars().all()
    return [_summary(r) for r in rows]


@router.post("/fonts", response_model=FontUploaded, status_code=status.HTTP_201_CREATED)
async def upload_font(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    content = await file.read(MAX_FONT_BYTES + 1)
    try:
        ext, mime = check_font_file(file.filename or "", content)
    except BrandKitValidationError as exc:
        raise _invalid(exc)
    user_dir = Path(settings.UPLOAD_DIR) / str(user.id)
    user_dir.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}.{ext}"
    path = user_dir / stored
    async with aiofiles.open(path, "wb") as f:
        await f.write(content)
    asset = Asset(user_id=user.id, original_filename=(file.filename or stored)[:512], stored_filename=stored, file_path=str(path), file_type="font", mime_type=mime, file_size=len(content))
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    token, _ttl = create_media_token(user.id)
    guess = Path(file.filename or "Custom font").stem.replace("_", " ").replace("-", " ").strip()[:60] or "Custom font"
    return FontUploaded(asset_id=asset.id, url=f"/uploads/{user.id}/{stored}?mt={token}", filename=asset.original_filename, family_guess=guess, mime_type=mime, size=len(content))


@router.post("/", response_model=BrandKitFull, status_code=status.HTTP_201_CREATED)
async def create_kit(body: BrandKitBody, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    if await _count(db, user) >= MAX_KITS_PER_USER:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "limit", "message": f"You can keep up to {MAX_KITS_PER_USER} Brand Kits. Delete one first."})
    try:
        kit, images, fonts = validate_kit(body.kit, user.id)
        await check_kit_assets(db, user.id, images, fonts)
    except BrandKitValidationError as exc:
        raise _invalid(exc)
    row = BrandKit(user_id=user.id, name=body.name.strip(), kit_json=kit)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _present(row, user)


@router.get("/{kit_id}", response_model=BrandKitFull)
async def get_kit(kit_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    return _present(await _owned(db, user, kit_id), user)


@router.put("/{kit_id}", response_model=BrandKitFull)
async def update_kit(kit_id: int, body: BrandKitBody, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    row = await _owned(db, user, kit_id)
    try:
        kit, images, fonts = validate_kit(body.kit, user.id)
        await check_kit_assets(db, user.id, images, fonts)
    except BrandKitValidationError as exc:
        raise _invalid(exc)
    row.name = body.name.strip()
    row.kit_json = kit
    await db.commit()
    await db.refresh(row)
    return _present(row, user)


@router.post("/{kit_id}/duplicate", response_model=BrandKitFull, status_code=status.HTTP_201_CREATED)
async def duplicate_kit(kit_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    src = await _owned(db, user, kit_id)
    if await _count(db, user) >= MAX_KITS_PER_USER:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "limit", "message": f"You can keep up to {MAX_KITS_PER_USER} Brand Kits. Delete one first."})
    row = BrandKit(user_id=user.id, name=f"{src.name} (copy)"[:120], kit_json=src.kit_json)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _present(row, user)


@router.delete("/{kit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_kit(kit_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    row = await _owned(db, user, kit_id)
    await db.delete(row)                       # the kit only REFERENCES uploaded files; they stay in the media library
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
