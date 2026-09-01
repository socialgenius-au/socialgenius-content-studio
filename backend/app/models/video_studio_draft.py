from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, JSON, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


# Step 7.9: durable "Save Draft" storage for Video Studio V2 — deliberately its own table
# rather than reusing Job (tightly coupled to the AI prompt/plan/execute pipeline — `plan_json`
# is read by /jobs/{id}/execute expecting a "steps" shape) or Template (a prompt-generation
# template, listed by the *existing* "Templates" button in Create/Edit — reusing it here would
# make a saved video draft show up in that unrelated picker). `project_json` is intentionally
# untyped/opaque at this layer: the frontend owns the exact shape of what a "complete project"
# snapshot contains, the same way Job.plan_json and Template.plan_json are already opaque JSON
# blobs the backend just stores and returns as-is.
class VideoStudioDraft(Base):
    __tablename__ = "video_studio_drafts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    project_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
