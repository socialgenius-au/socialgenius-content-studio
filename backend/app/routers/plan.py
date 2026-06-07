from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.deps import current_user
from app.limiter import limiter
from app.models.brand import Brand
from app.models.job import Job
from app.models.user import User
from app.schemas.job import JobResponse
from app.services.claude import generate_job_plan

router = APIRouter()


class PlanRequest(BaseModel):
    prompt: str
    title: str = ""
    brand_id: int | None = None


@router.post("/", response_model=JobResponse)
@limiter.limit("20/minute")
async def create_plan(
    request: Request,
    body: PlanRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    brand_context = None
    if body.brand_id:
        result = await db.execute(
            select(Brand).where(Brand.id == body.brand_id, Brand.user_id == user.id)
        )
        brand = result.scalar_one_or_none()
        if brand:
            brand_context = {
                "name": brand.name,
                "colors": brand.colors,
                "fonts": brand.fonts,
                "tone": brand.tone_of_voice,
            }

    plan = await generate_job_plan(body.prompt, brand_context)
    title = body.title or plan.get("title", body.prompt[:80])

    job = Job(
        user_id=user.id,
        brand_id=body.brand_id,
        title=title,
        prompt=body.prompt,
        plan_json=plan,
        status="pending",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job
