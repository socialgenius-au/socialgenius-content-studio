from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database import get_db
from app.deps import current_user
from app.models.asset import Asset
from app.models.job import Job
from app.models.user import User
from app.schemas.asset import AssetResponse
from app.schemas.job import JobResponse, StatusUpdate
from app.services import job_runner

router = APIRouter()

VALID_STATUSES = {"pending", "running", "done", "failed"}


@router.get("/", response_model=list[JobResponse])
async def list_jobs(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(
        select(Job).where(Job.user_id == user.id).order_by(Job.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(select(Job).where(Job.id == job_id, Job.user_id == user.id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


@router.patch("/{job_id}/status", response_model=JobResponse)
async def update_status(
    job_id: int,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Status must be one of {VALID_STATUSES}")

    result = await db.execute(select(Job).where(Job.id == job_id, Job.user_id == user.id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    job.status = body.status
    await db.commit()
    await db.refresh(job)
    return job


@router.post("/{job_id}/execute")
async def execute_job(
    job_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Job).where(Job.id == job_id, Job.user_id == user.id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if not job.plan_json:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Job has no plan yet — run /plan first")
    if job.plan_json.get("error") or not job.plan_json.get("steps"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Job's plan failed to generate (unparseable Claude response) — re-run /plan before executing",
        )
    if job.status == "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job is already running")

    if settings.REDIS_URL:
        from app.services.queue import enqueue_execute_job
        await enqueue_execute_job(job_id, user.id)
    else:
        # Fallback to in-process background task when Redis is not configured
        background_tasks.add_task(job_runner.execute_job, job_id, user.id)

    return {"message": "Execution started", "job_id": job_id, "status": "running", "queue": "arq" if settings.REDIS_URL else "local"}


@router.get("/{job_id}/assets", response_model=list[AssetResponse])
async def list_job_assets(
    job_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
):
    result = await db.execute(select(Asset).where(Asset.job_id == job_id, Asset.user_id == user.id))
    return result.scalars().all()
