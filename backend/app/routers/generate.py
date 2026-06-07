import copy

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.deps import current_user
from app.models.brand import Brand
from app.models.job import Job
from app.models.user import User
from app.services import generate_svc

router = APIRouter()


class GenerateRequest(BaseModel):
    job_id: int
    step_number: int          # 1-based, matches plan.steps[].step
    platform: str
    tone: str = "professional"
    word_limit: int | None = None
    additional_context: str = ""
    save_to_step: bool = True  # persist result back into plan_json


class GenerateResponse(BaseModel):
    platform: str
    content_type: str
    content: str
    hashtags: list[str]
    character_count: int
    cta: str
    notes: str
    saved_to_step: bool


@router.post("/", response_model=GenerateResponse)
async def generate(
    body: GenerateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Job).where(Job.id == body.job_id, Job.user_id == user.id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if not job.plan_json:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Job has no plan — run /plan first")

    steps = job.plan_json.get("steps", [])
    step = next((s for s in steps if s.get("step") == body.step_number), None)
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Step {body.step_number} not found")

    brand_context = None
    if job.brand_id:
        br = await db.execute(select(Brand).where(Brand.id == job.brand_id))
        brand = br.scalar_one_or_none()
        if brand:
            brand_context = {
                "name": brand.name,
                "colors": brand.colors,
                "fonts": brand.fonts,
                "tone_of_voice": brand.tone_of_voice,
            }

    content = await generate_svc.generate_content(
        step=step,
        platform=body.platform,
        tone=body.tone,
        brand_context=brand_context,
        additional_context=body.additional_context,
        job_summary=job.plan_json.get("summary", ""),
        word_limit=body.word_limit,
    )

    if body.save_to_step:
        plan = copy.deepcopy(job.plan_json)
        for s in plan.get("steps", []):
            if s.get("step") == body.step_number:
                s["generated_content"] = content
                break
        job.plan_json = plan
        await db.commit()

    return GenerateResponse(**content, saved_to_step=body.save_to_step)
