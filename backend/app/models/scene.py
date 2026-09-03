"""Video Deconstructor — Stage 1. See reference_video.py for shared module-level context.

Scene groups an ordered run of Shots into a narrative unit. Shot boundaries (see shot.py) are
MEASURED (pixel-diff cut detection); which shots belong to the same Scene, and later (Stage 15)
each Scene's narrative_role (hook/setup/problem/solution/proof/cta/outro), are judgments —
always INFERRED, never MEASURED, reflected in this row's own `certainty` value.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.certainty import CERTAINTY_CHECK_SQL, CONFIDENCE_RANGE_CHECK_SQL


class Scene(Base):
    __tablename__ = "scenes"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_analysis_id: Mapped[int] = mapped_column(ForeignKey("video_analyses.id", ondelete="CASCADE"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    # Populated by Stage 15, not Stage 1 — nullable until then.
    narrative_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    certainty: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)  # ai_reasoning | research_reference
    # Traceability: which named analysis pass produced/last-touched this row (Stage 3+).
    produced_by_pass: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("end_time >= start_time", name="ck_scenes_time_order"),
        CheckConstraint(CERTAINTY_CHECK_SQL, name="ck_scenes_certainty_valid"),
        CheckConstraint(CONFIDENCE_RANGE_CHECK_SQL, name="ck_scenes_confidence_range"),
        Index("ix_scenes_video_analysis_id", "video_analysis_id"),
    )
