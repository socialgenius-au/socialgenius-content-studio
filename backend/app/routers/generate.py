import copy

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.deps import current_user
from app.limiter import limiter
from app.models.brand import Brand
from app.models.job import Job
from app.models.user import User
from app.services import generate_svc
from app.services.ai import AIProviderError

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


class ChatRequest(BaseModel):
    prompt: str
    brand_id: int | None = None
    job_id: int | None = None
    context: dict = {}


class ChatResponse(BaseModel):
    content: str
    needs_approval: bool = False
    approval_summary: str | None = None


@router.post("/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat(
    request: Request,
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    brand_context = None
    if body.brand_id:
        br = await db.execute(select(Brand).where(Brand.id == body.brand_id, Brand.user_id == user.id))
        brand = br.scalar_one_or_none()
        if brand:
            brand_context = {
                "name": brand.name,
                "colors": brand.colors,
                "fonts": brand.fonts,
                "tone_of_voice": brand.tone_of_voice,
            }

    reply = await generate_svc.chat_reply(
        prompt=body.prompt,
        brand_context=brand_context,
        context=body.context,
    )
    return ChatResponse(**reply)


# STEP: Video Studio V2 AI Tools — AI Prompt Generator. Same brand_id -> Brand lookup pattern as
# /chat and /plan above (reused verbatim, not reinvented) — brand_context stays None whenever no
# real Brand row exists for this user (there currently is none at all in this environment), which
# generate_svc.generate_prompt already treats as "no brand context to include", never fabricated.
class PromptGeneratorRequest(BaseModel):
    instruction: str
    brand_id: int | None = None
    context: dict = {}


class PromptGeneratorResponse(BaseModel):
    prompt: str
    # Task 7 (usage/cost metadata): populated from whichever provider actually served this
    # request — never hard-coded to "anthropic", so the frontend can report accurate usage once
    # a provider other than Anthropic is switched on. The frontend doesn't display any of these
    # yet (no billing UI, per Task 7) but the data is captured now rather than discarded.
    provider: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None


@router.post("/prompt", response_model=PromptGeneratorResponse)
@limiter.limit("20/minute")
async def generate_prompt(
    request: Request,
    body: PromptGeneratorRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    brand_context = None
    if body.brand_id:
        br = await db.execute(select(Brand).where(Brand.id == body.brand_id, Brand.user_id == user.id))
        brand = br.scalar_one_or_none()
        if brand:
            brand_context = {
                "name": brand.name,
                "colors": brand.colors,
                "fonts": brand.fonts,
                "tone_of_voice": brand.tone_of_voice,
            }

    # Provider-neutral refactor: generate_svc.generate_prompt now routes through
    # app.services.ai (task "prompt_generation") instead of calling Anthropic directly — this
    # endpoint no longer knows or cares which provider actually served the request. Whether the
    # failure is "no provider configured" or "the configured provider's call failed", the
    # provider adapter raises the same AIProviderError with an already-clear, truthful message
    # (Task 4/5) — never a faked result.
    try:
        result = await generate_svc.generate_prompt(
            instruction=body.instruction,
            brand_context=brand_context,
            project_context=body.context,
        )
    except AIProviderError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return PromptGeneratorResponse(
        prompt=result.text,
        provider=result.provider,
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        estimated_cost_usd=result.estimated_cost_usd,
    )


@router.post("/", response_model=GenerateResponse)
@limiter.limit("30/minute")
async def generate(
    request: Request,
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
