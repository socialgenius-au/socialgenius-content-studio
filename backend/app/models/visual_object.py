"""Video Deconstructor — Stage 1. See reference_video.py for shared module-level context.

VisualObject is every detected object/product/person/logo/background region — the same
normalized geometry shape as TextElement (see that file's docstring for the rotation/scale/
anchor/opacity/z_index reasoning, identical here), plus a category label so foreground/
midground/background layering (z_index) and object type filtering are both queryable directly.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.certainty import CERTAINTY_CHECK_SQL, CONFIDENCE_RANGE_CHECK_SQL
from app.models.geometry import ANCHOR_NORMALIZED_CHECK_SQL, OPACITY_RANGE_CHECK_SQL, WH_NORMALIZED_CHECK_SQL, XY_NORMALIZED_CHECK_SQL

VISUAL_OBJECT_CATEGORY_CHECK_SQL = "category IN ('person', 'product', 'logo', 'background', 'prop')"


class VisualObject(Base):
    __tablename__ = "visual_objects"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_analysis_id: Mapped[int] = mapped_column(ForeignKey("video_analyses.id", ondelete="CASCADE"), nullable=False)
    shot_id: Mapped[int | None] = mapped_column(ForeignKey("shots.id", ondelete="SET NULL"), nullable=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)

    # Geometry — identical shape/convention to TextElement (see geometry.py).
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False)
    height: Mapped[float] = mapped_column(Float, nullable=False)
    scale_x: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    scale_y: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    rotation: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    anchor_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    anchor_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    opacity: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    z_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)

    certainty: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    produced_by_pass: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("end_time >= start_time", name="ck_visual_objects_time_order"),
        CheckConstraint(VISUAL_OBJECT_CATEGORY_CHECK_SQL, name="ck_visual_objects_category_valid"),
        CheckConstraint(XY_NORMALIZED_CHECK_SQL, name="ck_visual_objects_xy_normalized"),
        CheckConstraint(WH_NORMALIZED_CHECK_SQL, name="ck_visual_objects_wh_normalized"),
        CheckConstraint(ANCHOR_NORMALIZED_CHECK_SQL, name="ck_visual_objects_anchor_normalized"),
        CheckConstraint(OPACITY_RANGE_CHECK_SQL, name="ck_visual_objects_opacity_range"),
        CheckConstraint(CERTAINTY_CHECK_SQL, name="ck_visual_objects_certainty_valid"),
        CheckConstraint(CONFIDENCE_RANGE_CHECK_SQL, name="ck_visual_objects_confidence_range"),
        Index("ix_visual_objects_video_analysis_id", "video_analysis_id"),
        Index("ix_visual_objects_shot_id", "shot_id"),
        Index("ix_visual_objects_category", "category"),
    )
