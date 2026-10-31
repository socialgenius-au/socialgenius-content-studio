from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.deps import current_user
from app.models.user import User
from app.models.video_studio_draft import VideoStudioDraft
from app.schemas.video_studio_draft import (
    VideoStudioDraftCreate, VideoStudioDraftUpdate, VideoStudioDraftSummary, VideoStudioDraftResponse,
)

router = APIRouter()


# Step 7.9: "My Drafts" list — summary only (see schema comment for why project_json is
# omitted here), newest-saved first so the draft someone just saved is the one they see first.
@router.get("/", response_model=list[VideoStudioDraftSummary])
async def list_drafts(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    result = await db.execute(
        select(VideoStudioDraft).where(VideoStudioDraft.user_id == user.id).order_by(VideoStudioDraft.updated_at.desc())
    )
    return result.scalars().all()


# Step 7.9: "Save Draft" (first save of a project that has no draft id yet) — creates a new row.
@router.post("/", response_model=VideoStudioDraftResponse, status_code=status.HTTP_201_CREATED)
async def create_draft(
    body: VideoStudioDraftCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    draft = VideoStudioDraft(user_id=user.id, name=body.name, project_json=body.project_json)
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return draft


# Step 7.9: "Open / Continue Editing" — full project_json for reconstructing the editor.
@router.get("/{draft_id}", response_model=VideoStudioDraftResponse)
async def get_draft(
    draft_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user),
):
    result = await db.execute(select(VideoStudioDraft).where(VideoStudioDraft.id == draft_id, VideoStudioDraft.user_id == user.id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    return draft


# Step 7.9: "Save Draft" on a project that already has a draft id — updates the existing row in
# place rather than creating a duplicate (Requirement 8).
@router.put("/{draft_id}", response_model=VideoStudioDraftResponse)
async def update_draft(
    draft_id: int,
    body: VideoStudioDraftUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(VideoStudioDraft).where(VideoStudioDraft.id == draft_id, VideoStudioDraft.user_id == user.id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    draft.name = body.name
    draft.project_json = body.project_json
    await db.commit()
    await db.refresh(draft)
    return draft


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(
    draft_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user),
):
    result = await db.execute(select(VideoStudioDraft).where(VideoStudioDraft.id == draft_id, VideoStudioDraft.user_id == user.id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    await db.delete(draft)
    await db.commit()
