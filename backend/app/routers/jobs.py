from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.deps import current_user
from app.models.asset import Asset
from app.models.job import Job
from app.models.user import User
from app.schemas.asset import AssetResponse
from app.schemas.job import JobResponse, StatusUpdate

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


@router.get("/{job_id}/assets", response_model=list[AssetResponse])
async def list_job_assets(
    job_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)
):
    result = await db.execute(select(Asset).where(Asset.job_id == job_id, Asset.user_id == user.id))
    return result.scalars().all()
