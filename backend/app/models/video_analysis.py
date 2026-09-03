"""Video Deconstructor — Stage 1. See reference_video.py for the module-level context shared
by this whole schema.

VideoAnalysis is the versioned analysis-run container: every re-run of analysis against a
ReferenceVideo (a different tier, a re-run after a model upgrade, etc.) is a NEW row here,
never an update to a previous one — the ReferenceVideo it points at never changes, and neither
does any prior VideoAnalysis row. Every other analysis entity (Scene, Shot, TextElement,
VisualObject, AnalysisAnnotation, StrategicInsight) belongs to exactly one VideoAnalysis run.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

ANALYSIS_TIER_CHECK_SQL = "analysis_tier IN ('quick', 'standard', 'deep')"
ANALYSIS_STATUS_CHECK_SQL = "status IN ('pending', 'running', 'complete', 'failed')"


class VideoAnalysis(Base):
    __tablename__ = "video_analyses"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference_video_id: Mapped[int] = mapped_column(ForeignKey("reference_videos.id", ondelete="CASCADE"), nullable=False)
    analysis_tier: Mapped[str] = mapped_column(String(16), nullable=False, default="standard")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    # Stage 3's own job-orchestration bookkeeping — which named pass is running/done/failed.
    # Not populated by anything yet; the column exists so Stage 3 doesn't need a migration.
    pass_status: Mapped[dict] = mapped_column(JSON, default=dict)
    # Which provider/model actually served each pass of this run (Task 7's usage-metadata
    # groundwork) — recorded once per run here, not duplicated onto every individual claim row.
    ai_provider_versions_used: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(ANALYSIS_TIER_CHECK_SQL, name="ck_video_analyses_tier_valid"),
        CheckConstraint(ANALYSIS_STATUS_CHECK_SQL, name="ck_video_analyses_status_valid"),
        Index("ix_video_analyses_reference_video_id", "reference_video_id"),
    )
