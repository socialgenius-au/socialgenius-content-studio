"""Authenticated stock discovery, collections and project selection."""
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.limiter import limiter
from app.models.asset import Asset
from app.models.user import User
from app.models.virtual_assets import VirtualAsset, VirtualBookmark, VirtualProjectMedia
from app.schemas.asset import AssetResponse
from app.services import virtual_assets as stock
from app.services.reference_source import _https_from
from app.services.virtual_asset_storage import stage_project_media

router = APIRouter()
Provider = Literal["pexels", "pixabay", "unsplash"]
MediaKind = Literal["image", "video"]


class Selection(BaseModel):
    key: str = Field(max_length=110)


class ProjectSelection(Selection):
    rights_confirmed: bool


class Bookmark(Selection):
    workspace: str = "personal"
    collection: str = "Saved references"


def directories(user: User) -> dict[str, tuple[str, ...]]:
    name = user.username.casefold()
    teams = stock.WORKSPACES if user.role == "admin" else {
        key: values for key, values in stock.WORKSPACES.items() if key == name
    }
    return {"personal": ("Saved references",), **teams}


async def resolve(key: str) -> dict:
    try:
        stock.parse_key(key)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        return await stock.resolve(key)
    except httpx.HTTPStatusError as exc:
        code = 404 if exc.response.status_code == 404 else 503
        raise HTTPException(code, "Provider could not resolve this asset") from exc
    except (ValueError, KeyError, httpx.RequestError) as exc:
        raise HTTPException(503, "Provider could not resolve this asset") from exc


async def get_or_record(db: AsyncSession, details: dict) -> VirtualAsset:
    existing = await db.get(VirtualAsset, details["key"])
    if existing:
        return existing
    try:
        async with db.begin_nested():
            existing = VirtualAsset(key=details["key"], details=stock.snapshot(details))
            db.add(existing)
            await db.flush()
    except IntegrityError:
        existing = await db.get(VirtualAsset, details["key"])
        if not existing:
            raise
    return existing


@router.get("/search")
@limiter.limit("30/minute")
async def search(request: Request, provider: Provider, kind: MediaKind, q: str = Query(min_length=2, max_length=100),
                 page: int = Query(1, ge=1, le=50), user: User = Depends(current_user)):
    if provider == "unsplash" and kind == "video":
        raise HTTPException(422, "Unsplash provides photos")
    try:
        return [stock.public(row) for row in await stock.search(provider, kind, q.strip(), page)]
    except (ValueError, httpx.HTTPError) as exc:
        raise HTTPException(503, f"{provider.title()} is unavailable. Check provider configuration or try again.") from exc


@router.get("/collections")
async def collections(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = []
    for workspace, industries in directories(user).items():
        scope = f"user:{user.id}" if workspace == "personal" else workspace
        rows = (await db.execute(select(VirtualBookmark.collection, VirtualAsset)
                .join(VirtualAsset, VirtualAsset.key == VirtualBookmark.asset_key)
                .where(VirtualBookmark.workspace == scope).order_by(VirtualAsset.recorded_at.desc()))).all()
        result.append({"workspace": workspace, "collections": [
            {"name": name, "phase_one_target": 260 if workspace != "personal" else None,
             "final_target": 515 if workspace != "personal" else None,
             "items": [{**row.details, "recorded_at": row.recorded_at} for collection, row in rows if collection == name]}
            for name in industries]})
    return result


@router.put("/bookmarks")
@limiter.limit("30/minute")
async def bookmark(request: Request, body: Bookmark, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    if body.collection not in directories(user).get(body.workspace, ()):
        raise HTTPException(403, "Collection is unavailable to your account")
    scope = f"user:{user.id}" if body.workspace == "personal" else body.workspace
    key = (scope, body.collection, body.key)
    if await db.get(VirtualBookmark, key):
        return {"duplicate": True}
    if not await db.get(VirtualAsset, body.key):
        await get_or_record(db, await resolve(body.key))
    db.add(VirtualBookmark(workspace=scope, collection=body.collection, asset_key=body.key))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if await db.get(VirtualBookmark, key):
            return {"duplicate": True}
        raise
    return {"duplicate": False}


@router.get("/availability/{key}")
@limiter.limit("20/minute")
async def availability(request: Request, key: str, user: User = Depends(current_user)):
    row = await resolve(key)
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            async with client.stream("GET", row["media"], headers={"Range": "bytes=0-0"}) as response:
                status = "available" if response.is_success else "unavailable"
    except httpx.RequestError:
        status = "unknown"
    return {"status": status, "item": stock.public(row)}


@router.post("/reference-use")
@limiter.limit("20/minute")
async def reference_use(request: Request, body: Selection, db: AsyncSession = Depends(get_db),
                        user: User = Depends(current_user)):
    row = await resolve(body.key)
    if row["provider"] == "unsplash":
        tracking = row["tracking"]
        if not _https_from(tracking, {"api.unsplash.com"}):
            raise HTTPException(503, "Unsplash use could not be registered")
        try:
            from urllib.parse import urlsplit
            link = urlsplit(tracking)
            await stock.unsplash(link.path + ("?" + link.query if link.query else ""))
        except (ValueError, httpx.HTTPError) as exc:
            raise HTTPException(503, "Unsplash use could not be registered") from exc
    await get_or_record(db, row)
    await db.commit()
    return stock.public(row)


@router.post("/project-media", response_model=AssetResponse)
@limiter.limit("12/minute")
async def project_media(request: Request, body: ProjectSelection, db: AsyncSession = Depends(get_db),
                        user: User = Depends(current_user)):
    if not body.rights_confirmed:
        raise HTTPException(422, "Confirm permission for the intended media use.")

    async def existing_media():
        statement = select(VirtualProjectMedia, Asset).join(Asset, Asset.id == VirtualProjectMedia.asset_id).where(
            VirtualProjectMedia.user_id == user.id, VirtualProjectMedia.asset_key == body.key)
        return (await db.execute(statement)).one_or_none()

    existing = await existing_media()
    if existing and Path(existing[1].file_path).is_file():
        return existing[1]
    details = await resolve(body.key)
    if details["provider"] == "unsplash":
        raise HTTPException(422, "Use Unsplash photos as attributed, provider-hosted references.")
    await get_or_record(db, details)
    try:
        async with stage_project_media(details, user.id) as asset:
            db.add(asset)
            await db.flush()
            if existing:
                existing[0].asset_id = asset.id
            else:
                db.add(VirtualProjectMedia(user_id=user.id, asset_key=body.key, asset_id=asset.id))
            await db.commit()
        return asset
    except IntegrityError:
        await db.rollback()
        winner = await existing_media()
        if winner and Path(winner[1].file_path).is_file():
            return winner[1]
        raise
    except (ValueError, httpx.HTTPError) as exc:
        raise HTTPException(503, "Could not retrieve project media from the provider") from exc
