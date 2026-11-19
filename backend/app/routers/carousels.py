"""Carousel Creator documents: authenticated, per-user PostgreSQL storage.

  GET    /carousels/                 your carousels (summaries), newest first
  POST   /carousels/                 create (an existing id is refused with 409; nothing is ever overwritten by a create)
  GET    /carousels/{doc_id}         open (media URLs carry a fresh short-lived token)
  PUT    /carousels/{doc_id}         save; refused with 409 `version_conflict` if the server version is newer than `expected_version`, unless `force`
  POST   /carousels/{doc_id}/duplicate
  DELETE /carousels/{doc_id}

Every query is scoped to the signed-in user, so another user's carousel is indistinguishable from one that does not exist (404). Documents are validated and stripped of media tokens
by app.services.carousel_validation; images are referenced from the existing media storage, never stored here.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.routing import APIRoute
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models.carousel_document import CarouselDocument
from app.models.user import User
from app.schemas.carousel import CarouselCreate, CarouselFull, CarouselSaved, CarouselSummary, CarouselUpdate
from app.services.carousel_validation import (
    MAX_CAROUSELS_PER_USER, MAX_DOC_BYTES, CarouselValidationError, check_asset_ownership, extract_metadata, validate_document,
)
from app.services.media_access import create_media_token, rewrite_media_urls

MAX_BODY_BYTES = MAX_DOC_BYTES + 100_000


class BodyLimitedRoute(APIRoute):
    """Refuses an oversized request BEFORE its body is read into memory (FastAPI parses the body ahead of ordinary dependencies, so a dependency cannot do this).
    A request with no Content-Length (chunked) is still bounded afterwards by the document size check in carousel_validation."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            cl = request.headers.get("content-length")
            if cl and cl.isdigit() and int(cl) > MAX_BODY_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="That carousel is too large to save. Move large images into the media library.")
            return await original(request)

        return handler


router = APIRouter(route_class=BodyLimitedRoute)


def _invalid(exc: CarouselValidationError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "invalid_document", "errors": exc.errors[:20]})


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Carousel not found")


def _present(row: CarouselDocument, user: User) -> CarouselFull:
    """The carousel as its OWNER sees it: media URLs carry a fresh short-lived token. Nothing is written back."""
    token, _ttl = create_media_token(user.id)
    return CarouselFull(**CarouselSummary.model_validate(row).model_dump(), active_slide_id=row.active_slide_id, document=rewrite_media_urls(row.document_json, user.id, token))


async def _get_owned(db: AsyncSession, user: User, doc_id: str, *, lock: bool = False) -> CarouselDocument:
    q = select(CarouselDocument).where(CarouselDocument.user_id == user.id, CarouselDocument.doc_id == doc_id)
    if lock:
        q = q.with_for_update()
    row = (await db.execute(q)).scalar_one_or_none()
    if row is None:
        raise _not_found()
    return row


async def _count(db: AsyncSession, user: User) -> int:
    return (await db.execute(select(func.count()).select_from(CarouselDocument).where(CarouselDocument.user_id == user.id))).scalar_one()


def _apply(row: CarouselDocument, doc: dict, theme_id: str, active_slide_id: str | None) -> None:
    meta = extract_metadata(doc)
    row.title, row.slide_count, row.platform_key, row.format_key = meta["title"], meta["slide_count"], meta["platform_key"], meta["format_key"]
    row.blueprint_id, row.reference_video_id = meta["blueprint_id"], meta["reference_video_id"]
    row.theme_id = theme_id
    row.active_slide_id = active_slide_id if active_slide_id and any(p.get("id") == active_slide_id for p in doc.get("pages", [])) else None
    row.document_json = doc


@router.get("/", response_model=list[CarouselSummary])
async def list_carousels(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    rows = (await db.execute(select(CarouselDocument).where(CarouselDocument.user_id == user.id).order_by(CarouselDocument.updated_at.desc()).limit(MAX_CAROUSELS_PER_USER))).scalars().all()
    return rows


@router.post("/", response_model=CarouselFull, status_code=status.HTTP_201_CREATED)
async def create_carousel(body: CarouselCreate, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    try:
        doc, assets = validate_document(body.document)
        await check_asset_ownership(db, user.id, assets)
    except CarouselValidationError as exc:
        raise _invalid(exc)
    doc_id = doc["id"]
    existing = (await db.execute(select(CarouselDocument).where(CarouselDocument.user_id == user.id, CarouselDocument.doc_id == doc_id))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "exists", "message": "A carousel with this id already exists in your account; it was not changed.", "server_version": existing.version})
    if await _count(db, user) >= MAX_CAROUSELS_PER_USER:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "limit", "message": f"You can keep up to {MAX_CAROUSELS_PER_USER} carousels. Delete one first."})
    row = CarouselDocument(user_id=user.id, doc_id=doc_id, version=1, origin="browser_import" if body.imported_from == "browser" else "server", document_json=doc)
    _apply(row, doc, body.theme_id, body.active_slide_id)
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:        # a concurrent create of the same id: refuse, never overwrite
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "exists", "message": "A carousel with this id already exists in your account; it was not changed."})
    await db.refresh(row)
    return _present(row, user)


@router.get("/{doc_id}", response_model=CarouselFull)
async def get_carousel(doc_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    return _present(await _get_owned(db, user, doc_id), user)


@router.put("/{doc_id}", response_model=CarouselSaved)
async def update_carousel(doc_id: str, body: CarouselUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    try:
        doc, assets = validate_document(body.document, expected_doc_id=doc_id)
        await check_asset_ownership(db, user.id, assets)
    except CarouselValidationError as exc:
        raise _invalid(exc)
    row = await _get_owned(db, user, doc_id, lock=True)           # row lock: two overlapping saves are applied one after the other, each checked against the version it sees
    if row.version != body.expected_version and not body.force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "version_conflict", "message": "This carousel was saved from somewhere else since you opened it.", "server_version": row.version, "server_updated_at": row.updated_at.isoformat() if row.updated_at else None},
        )
    _apply(row, doc, body.theme_id, body.active_slide_id)
    row.version = row.version + 1
    await db.commit()
    await db.refresh(row)
    return CarouselSaved(doc_id=row.doc_id, version=row.version, updated_at=row.updated_at, title=row.title, slide_count=row.slide_count)


@router.post("/{doc_id}/duplicate", response_model=CarouselFull, status_code=status.HTTP_201_CREATED)
async def duplicate_carousel(doc_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    src = await _get_owned(db, user, doc_id)
    if await _count(db, user) >= MAX_CAROUSELS_PER_USER:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "limit", "message": f"You can keep up to {MAX_CAROUSELS_PER_USER} carousels. Delete one first."})
    new_id = f"car_{uuid.uuid4().hex[:12]}"
    doc = {**src.document_json, "id": new_id, "title": f"{src.title} (copy)"[:255]}
    row = CarouselDocument(user_id=user.id, doc_id=new_id, version=1, origin="duplicate", document_json=doc)
    _apply(row, doc, src.theme_id, src.active_slide_id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _present(row, user)


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_carousel(doc_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    row = await _get_owned(db, user, doc_id)
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
