"""The Carousel Creator design library: reusable elements and backgrounds saved by the signed-in user.

  GET    /library-items/              your saved items (newest first)
  POST   /library-items/              save elements or a background
  GET    /library-items/{id}          open (media URLs carry a fresh short-lived token)
  PUT    /library-items/{id}          rename
  DELETE /library-items/{id}

An item is validated by wrapping it in a one-slide document and running the normal carousel validation, so it can hold anything a carousel can (images from the user's own library, links, QR
codes, masks, animations) and is subject to the same limits. Every query is scoped to the signed-in user; another user's item looks like it does not exist (404).
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models.library_item import LibraryItem
from app.models.user import User
from app.services.carousel_validation import CarouselValidationError, check_asset_ownership, validate_document
from app.services.media_access import create_media_token, rewrite_media_urls

MAX_ITEMS_PER_USER = 1000
MAX_ELEMENTS_PER_ITEM = 200

router = APIRouter()


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["elements", "background"]
    item: dict


class ItemRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ItemSummary(BaseModel):
    id: int
    name: str
    kind: str


class ItemFull(ItemSummary):
    item: dict


def _invalid(errors: list[str]) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "invalid_item", "errors": errors[:20]})


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Library item not found")


async def _owned(db: AsyncSession, user: User, item_id: int) -> LibraryItem:
    row = (await db.execute(select(LibraryItem).where(LibraryItem.id == item_id, LibraryItem.user_id == user.id))).scalar_one_or_none()
    if row is None:
        raise _not_found()
    return row


def _wrap(kind: str, item: dict) -> dict:
    """A minimal one-slide document around the item, so the carousel validator can check it."""
    page: dict = {"id": "lib_page", "background": {"kind": "solid", "color": "#FFFFFF"}, "elements": []}
    if kind == "elements":
        els = item.get("elements")
        if not isinstance(els, list) or not 1 <= len(els) <= MAX_ELEMENTS_PER_ITEM:
            raise CarouselValidationError([f"item.elements: a list of 1 to {MAX_ELEMENTS_PER_ITEM} elements"])
        page["elements"] = els
    else:
        bg = item.get("background")
        if not isinstance(bg, dict):
            raise CarouselValidationError(["item.background: a background object"])
        page["background"] = bg
    return {"kind": "post", "schemaVersion": 1, "id": "lib_item", "title": "item", "format": {"platformKey": "library", "formatKey": "item", "width": 1080, "height": 1350, "ratio": "4:5"}, "pages": [page]}


def _unwrap(kind: str, doc: dict) -> dict:
    page = doc["pages"][0]
    return {"elements": page["elements"]} if kind == "elements" else {"background": page["background"]}


def _present(row: LibraryItem, user: User) -> ItemFull:
    token, _ttl = create_media_token(user.id)
    return ItemFull(id=row.id, name=row.name, kind=row.kind, item=rewrite_media_urls(row.item_json, user.id, token))


@router.get("/", response_model=list[ItemSummary])
async def list_items(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    rows = (await db.execute(select(LibraryItem).where(LibraryItem.user_id == user.id).order_by(LibraryItem.updated_at.desc()).limit(MAX_ITEMS_PER_USER))).scalars().all()
    return [ItemSummary(id=r.id, name=r.name, kind=r.kind) for r in rows]


@router.post("/", response_model=ItemFull, status_code=status.HTTP_201_CREATED)
async def create_item(body: ItemCreate, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    count = (await db.execute(select(func.count()).select_from(LibraryItem).where(LibraryItem.user_id == user.id))).scalar_one()
    if count >= MAX_ITEMS_PER_USER:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "limit", "message": f"You can keep up to {MAX_ITEMS_PER_USER} library items. Delete some first."})
    try:
        doc, assets = validate_document(_wrap(body.kind, body.item))
        await check_asset_ownership(db, user.id, assets)
    except CarouselValidationError as exc:
        raise _invalid(exc.errors)
    row = LibraryItem(user_id=user.id, name=body.name.strip(), kind=body.kind, item_json=_unwrap(body.kind, doc))
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _present(row, user)


@router.get("/{item_id}", response_model=ItemFull)
async def get_item(item_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    return _present(await _owned(db, user, item_id), user)


@router.put("/{item_id}", response_model=ItemFull)
async def rename_item(item_id: int, body: ItemRename, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    row = await _owned(db, user, item_id)
    row.name = body.name.strip()
    await db.commit()
    await db.refresh(row)
    return _present(row, user)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    row = await _owned(db, user, item_id)
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
