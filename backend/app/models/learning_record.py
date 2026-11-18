from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LearningRecord(Base):
    """One recommendation the Learn stage made for ONE saved draft, and what the person decided about it (the smallest reusable learning mechanism).

    Provenance is kept: the recommendation text, its basis (`evidence` = derived from the measured project, `hypothesis` = an idea that needs testing) and the evidence behind it are written ONCE, when the
    recommendation is first acted on, and never rewritten; only `status` and `note` change afterwards. The draft's name, blueprint and reference video are snapshotted SERVER-SIDE from the owner's own draft, so
    a lesson still says where it came from after the draft is renamed or deleted (`draft_id` becomes NULL on deletion; the row stays). Every query is scoped to `user_id`.
    No audience-performance figures are ever stored here: nothing in the system produces any yet.
    """
    __tablename__ = "learning_records"
    __table_args__ = (UniqueConstraint("user_id", "draft_id", "rec_key", name="uq_learning_user_draft_rec"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    draft_id: Mapped[int | None] = mapped_column(ForeignKey("video_studio_drafts.id", ondelete="SET NULL"), nullable=True, index=True)
    draft_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    blueprint_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reference_video_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    rec_key: Mapped[str] = mapped_column(String(80), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    basis: Mapped[str] = mapped_column(String(16), nullable=False)          # evidence | hypothesis
    evidence: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    caveat: Mapped[str | None] = mapped_column(Text, nullable=True)
    rule_version: Mapped[str] = mapped_column(String(32), nullable=False, default="")

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")   # open | accepted | dismissed | tested
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
