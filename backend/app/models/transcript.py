from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, JSON, Text, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Transcript(Base):
    __tablename__ = "transcripts"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[int | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    language: Mapped[str] = mapped_column(String(8), default="en")
    full_text: Mapped[str] = mapped_column(Text, nullable=False)
    segments: Mapped[list] = mapped_column(JSON, default=list)
    srt: Mapped[str | None] = mapped_column(Text, nullable=True)
    word_timestamps: Mapped[bool] = mapped_column(Boolean, default=False)
    model_used: Mapped[str] = mapped_column(String(32), default="base")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
