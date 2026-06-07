from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.deps import current_user
from app.models.job import Job
from app.models.template import Template
from app.models.user import User
from app.schemas.template import TemplateResponse

router = APIRouter()


class TemplateCreate(BaseModel):
    name: str
    description: str | None = None
    prompt: str
    plan_json: dict | None = None
    job_id: int | None = None   # if set, copies prompt + plan from that job


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    prompt: str | None = None


@router.get("/", response_model=list[TemplateResponse])
async def list_templates(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(
        select(Template).where(Template.user_id == user.id).order_by(Template.created_at.desc())
    )
    return result.scalars().all()


@router.post("/", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    body: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    prompt = body.prompt
    plan_json = body.plan_json

    if body.job_id:
        jr = await db.execute(select(Job).where(Job.id == body.job_id, Job.user_id == user.id))
        job = jr.scalar_one_or_none()
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
        prompt = job.prompt
        plan_json = job.plan_json

    tpl = Template(
        user_id=user.id,
        name=body.name,
        description=body.description,
        prompt=prompt,
        plan_json=plan_json,
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.get("/{template_id}", response_model=TemplateResponse)
async def get_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Template).where(Template.id == template_id, Template.user_id == user.id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return tpl


@router.put("/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: int,
    body: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Template).where(Template.id == template_id, Template.user_id == user.id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(tpl, field, value)

    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Template).where(Template.id == template_id, Template.user_id == user.id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    await db.delete(tpl)
    await db.commit()
