"""Learn stage: recommendations and what the person decided about them. Per user, per saved draft; see models/learning_record.py for the provenance rules.

No analytics are stored or invented here. A recommendation is recorded the first time the person acts on it; afterwards only its status and note change.
"""
import re
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models.learning_record import LearningRecord
from app.models.user import User
from app.models.video_studio_draft import VideoStudioDraft

router = APIRouter()

REC_KEY = re.compile(r"^[a-z0-9][a-z0-9_.:-]{0,78}$")
Status = Literal["open", "accepted", "dismissed", "tested"]


class RecommendationIn(BaseModel):
    status: Status
    note: str | None = Field(default=None, max_length=1000)
    # Written once, when the record is first created; ignored on later updates (provenance is immutable).
    text: str = Field(min_length=3, max_length=600)
    basis: Literal["evidence", "hypothesis"]
    evidence: list[str] = Field(default_factory=list, max_length=12)
    caveat: str | None = Field(default=None, max_length=600)
    rule_version: str = Field(default="", max_length=32)

    @field_validator("evidence")
    @classmethod
    def _short(cls, v: list[str]) -> list[str]:
        return [s[:300] for s in v]


class LearningRecordOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    draft_id: int | None
    draft_name: str
    blueprint_id: str | None
    reference_video_id: int | None
    rec_key: str
    text: str
    basis: str
    evidence: list[str]
    caveat: str | None
    rule_version: str
    status: str
    note: str | None
    created_at: datetime
    updated_at: datetime


async def _own_draft(db: AsyncSession, user: User, draft_id: int) -> VideoStudioDraft:
    d = (await db.execute(select(VideoStudioDraft).where(VideoStudioDraft.id == draft_id, VideoStudioDraft.user_id == user.id))).scalar_one_or_none()
    if d is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    return d


def _origin(draft: VideoStudioDraft) -> tuple[str | None, int | None]:
    """Blueprint id and reference video of the draft, read from the OWNER'S saved draft (never trusted from the request)."""
    plan = (draft.project_json or {}).get("blueprintPlan") if isinstance(draft.project_json, dict) else None
    if not isinstance(plan, dict):
        return None, None
    bid, rv = plan.get("blueprintId"), plan.get("referenceVideoId")
    return (bid if isinstance(bid, str) else None), (rv if isinstance(rv, int) and not isinstance(rv, bool) else None)


@router.get("/drafts/{draft_id}", response_model=list[LearningRecordOut])
async def list_for_draft(draft_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    await _own_draft(db, user, draft_id)
    rows = (await db.execute(select(LearningRecord).where(LearningRecord.user_id == user.id, LearningRecord.draft_id == draft_id).order_by(LearningRecord.id))).scalars().all()
    return rows


@router.put("/drafts/{draft_id}/recommendations/{rec_key}", response_model=LearningRecordOut)
async def set_recommendation_status(draft_id: int, rec_key: str, body: RecommendationIn, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    if not REC_KEY.match(rec_key):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid recommendation key")
    draft = await _own_draft(db, user, draft_id)
    row = (await db.execute(select(LearningRecord).where(LearningRecord.user_id == user.id, LearningRecord.draft_id == draft_id, LearningRecord.rec_key == rec_key))).scalar_one_or_none()
    if row is None:
        blueprint_id, reference_video_id = _origin(draft)
        row = LearningRecord(user_id=user.id, draft_id=draft_id, draft_name=draft.name, blueprint_id=blueprint_id, reference_video_id=reference_video_id, rec_key=rec_key,
                             text=body.text, basis=body.basis, evidence=body.evidence, caveat=body.caveat, rule_version=body.rule_version)
        db.add(row)
    row.status = body.status            # the ONLY fields that change after creation
    row.note = body.note
    await db.commit()
    await db.refresh(row)
    return row


class BriefIn(BaseModel):
    """The new video's brief, as far as it is filled in. Every field is optional: lessons are ranked on whatever is known."""
    product: str | None = Field(default=None, max_length=300)
    audience: str | None = Field(default=None, max_length=300)
    objective: str | None = Field(default=None, max_length=300)
    platform: str | None = Field(default=None, max_length=80)
    duration_seconds: float | None = Field(default=None, ge=0, le=600)
    cta: bool = False
    tone: list[str] = Field(default_factory=list, max_length=20)
    mandatory: list[str] = Field(default_factory=list, max_length=20)
    prohibited: list[str] = Field(default_factory=list, max_length=20)


@router.post("/relevant")
async def relevant_lessons(body: BriefIn, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """The person's ACCEPTED lessons ranked for this brief, each with its classification, confidence, source and why it is (or is not) relevant, including any conflict with the brief. Read-only; never another
    user's lessons; nothing is applied until the person selects lessons for a blueprint."""
    from app.services.learning_guidance import LESSONS_POLICY, RELEVANT_AT, rank_lessons
    brief = {"product": body.product, "audience": body.audience, "objective": body.objective, "platform": body.platform, "duration": body.duration_seconds, "cta": body.cta,
             "tone": body.tone, "mandatory": body.mandatory, "prohibited": body.prohibited}
    return {"lessons": await rank_lessons(db, user, brief), "relevant_at": RELEVANT_AT, "notice": LESSONS_POLICY}


@router.get("/accepted", response_model=list[LearningRecordOut])
async def accepted_lessons(exclude_draft_id: int | None = None, limit: int = 20, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """Recommendations this person ACCEPTED on their other videos: the reusable lessons. Newest first."""
    q = select(LearningRecord).where(LearningRecord.user_id == user.id, LearningRecord.status == "accepted")
    if exclude_draft_id is not None:
        q = q.where((LearningRecord.draft_id != exclude_draft_id) | (LearningRecord.draft_id.is_(None)))
    rows = (await db.execute(q.order_by(LearningRecord.updated_at.desc(), LearningRecord.id.desc()).limit(max(1, min(limit, 50))))).scalars().all()
    return rows
