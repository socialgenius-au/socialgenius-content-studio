"""Reusable carousel templates and branded layouts.

  GET    /carousel-templates/            your templates (summaries)
  POST   /carousel-templates/            save a carousel (or some slides) as a template
  GET    /carousel-templates/{id}        open
  PUT    /carousel-templates/{id}        rename / edit
  DELETE /carousel-templates/{id}
  POST   /carousel-templates/{id}/duplicate

A template is a complete PostDocument validated exactly like a carousel (so it can hold anything a carousel can: images from the user's own library, groups, masks, brand tokens, animation
settings). Applying one is done by the editor, which COPIES it with fresh ids; nothing here changes when a template is used. Every query is scoped to the signed-in user.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models.brand_kit import BrandKit
from app.models.carousel_template import CarouselTemplate
from app.models.user import User
from app.routers.carousels import BodyLimitedRoute
from app.schemas.carousel_assets import TemplateCreate, TemplateFull, TemplateSummary, TemplateUpdate
from app.services.carousel_validation import CarouselValidationError, check_asset_ownership, extract_metadata, validate_document
from app.services.media_access import create_media_token, rewrite_media_urls

MAX_TEMPLATES_PER_USER = 500

router = APIRouter(route_class=BodyLimitedRoute)


def _invalid(exc: CarouselValidationError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "invalid_document", "errors": exc.errors[:20]})


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")


async def _owned(db: AsyncSession, user: User, template_id: int) -> CarouselTemplate:
    row = (await db.execute(select(CarouselTemplate).where(CarouselTemplate.id == template_id, CarouselTemplate.user_id == user.id))).scalar_one_or_none()
    if row is None:
        raise _not_found()
    return row


async def _kit_must_be_mine(db: AsyncSession, user: User, kit_id: int | None) -> None:
    if kit_id is None:
        return
    if (await db.execute(select(BrandKit.id).where(BrandKit.id == kit_id, BrandKit.user_id == user.id))).scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "invalid_kit", "errors": ["brand_kit_id: not one of your Brand Kits"]})


def _present(row: CarouselTemplate, user: User) -> TemplateFull:
    token, _ttl = create_media_token(user.id)
    return TemplateFull(**TemplateSummary.model_validate(row).model_dump(), document=rewrite_media_urls(row.template_json, user.id, token))


def _apply(row: CarouselTemplate, doc: dict) -> None:
    meta = extract_metadata(doc)
    row.slide_count, row.platform_key, row.format_key = meta["slide_count"], meta["platform_key"], meta["format_key"]
    row.template_json = doc


@router.get("/", response_model=list[TemplateSummary])
async def list_templates(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    return (await db.execute(select(CarouselTemplate).where(CarouselTemplate.user_id == user.id).order_by(CarouselTemplate.updated_at.desc()).limit(MAX_TEMPLATES_PER_USER))).scalars().all()


@router.post("/", response_model=TemplateFull, status_code=status.HTTP_201_CREATED)
async def create_template(body: TemplateCreate, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    count = (await db.execute(select(func.count()).select_from(CarouselTemplate).where(CarouselTemplate.user_id == user.id))).scalar_one()
    if count >= MAX_TEMPLATES_PER_USER:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "limit", "message": f"You can keep up to {MAX_TEMPLATES_PER_USER} templates. Delete one first."})
    await _kit_must_be_mine(db, user, body.brand_kit_id)
    try:
        doc, assets = validate_document(body.document)
        await check_asset_ownership(db, user.id, assets)
    except CarouselValidationError as exc:
        raise _invalid(exc)
    row = CarouselTemplate(user_id=user.id, name=body.name.strip(), description=body.description.strip(), kind=body.kind, brand_kit_id=body.brand_kit_id, template_json=doc)
    _apply(row, doc)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _present(row, user)


@router.get("/{template_id}", response_model=TemplateFull)
async def get_template(template_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    return _present(await _owned(db, user, template_id), user)


@router.put("/{template_id}", response_model=TemplateFull)
async def update_template(template_id: int, body: TemplateUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    row = await _owned(db, user, template_id)
    await _kit_must_be_mine(db, user, body.brand_kit_id)
    if body.document is not None:
        try:
            doc, assets = validate_document(body.document)
            await check_asset_ownership(db, user.id, assets)
        except CarouselValidationError as exc:
            raise _invalid(exc)
        _apply(row, doc)
    if body.name is not None:
        row.name = body.name.strip()
    if body.description is not None:
        row.description = body.description.strip()
    if body.brand_kit_id is not None:
        row.brand_kit_id = body.brand_kit_id
    await db.commit()
    await db.refresh(row)
    return _present(row, user)


@router.post("/{template_id}/duplicate", response_model=TemplateFull, status_code=status.HTTP_201_CREATED)
async def duplicate_template(template_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    src = await _owned(db, user, template_id)
    count = (await db.execute(select(func.count()).select_from(CarouselTemplate).where(CarouselTemplate.user_id == user.id))).scalar_one()
    if count >= MAX_TEMPLATES_PER_USER:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "limit", "message": f"You can keep up to {MAX_TEMPLATES_PER_USER} templates. Delete one first."})
    row = CarouselTemplate(user_id=user.id, name=f"{src.name} (copy)"[:120], description=src.description, kind=src.kind, brand_kit_id=src.brand_kit_id, template_json=src.template_json)
    _apply(row, src.template_json)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _present(row, user)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    row = await _owned(db, user, template_id)
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
