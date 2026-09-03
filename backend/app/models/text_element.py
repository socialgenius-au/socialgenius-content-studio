"""Video Deconstructor — Stage 1. See reference_video.py for shared module-level context.

TextElement is every detected on-screen text/caption — position, timing, and (much
lower-confidence, always reflected via font_confidence/certainty) an estimated font. This is
the one analysis entity designed to map directly onto Video Studio's own TextOverlay at
reconstruction time (Stage 24) — its geometry columns exist specifically so that mapping is a
straightforward field-for-field conversion rather than a lossy translation.

rotation/scale/anchor/opacity/z_index are populated here from Stage 1 on (all default to their
"no transform" identity values) even though no Stage-1-through-20 analysis pass writes a
non-default value yet — retrofitting these onto a populated table later is the expensive
direction; adding them now, unused, costs nothing. The SAME three fields (rotation/scale/text
opacity) are also missing from Video Studio's own TextOverlay type today — that is a separate,
later, Stage 21 fix to EXISTING Video Studio code; this file only fixes the analysis side.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.certainty import CERTAINTY_CHECK_SQL, CONFIDENCE_RANGE_CHECK_SQL
from app.models.geometry import ANCHOR_NORMALIZED_CHECK_SQL, OPACITY_RANGE_CHECK_SQL, WH_NORMALIZED_CHECK_SQL, XY_NORMALIZED_CHECK_SQL


class TextElement(Base):
    __tablename__ = "text_elements"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_analysis_id: Mapped[int] = mapped_column(ForeignKey("video_analyses.id", ondelete="CASCADE"), nullable=False)
    shot_id: Mapped[int | None] = mapped_column(ForeignKey("shots.id", ondelete="SET NULL"), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)

    # Geometry — normalized 0-1 (see geometry.py's own docstring).
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False)
    height: Mapped[float] = mapped_column(Float, nullable=False)
    scale_x: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    scale_y: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    rotation: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # degrees
    anchor_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    anchor_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    opacity: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    z_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)

    font_family_estimate: Mapped[str | None] = mapped_column(String(128), nullable=True)
    font_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    certainty: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    produced_by_pass: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("end_time >= start_time", name="ck_text_elements_time_order"),
        CheckConstraint(XY_NORMALIZED_CHECK_SQL, name="ck_text_elements_xy_normalized"),
        CheckConstraint(WH_NORMALIZED_CHECK_SQL, name="ck_text_elements_wh_normalized"),
        CheckConstraint(ANCHOR_NORMALIZED_CHECK_SQL, name="ck_text_elements_anchor_normalized"),
        CheckConstraint(OPACITY_RANGE_CHECK_SQL, name="ck_text_elements_opacity_range"),
        CheckConstraint(CERTAINTY_CHECK_SQL, name="ck_text_elements_certainty_valid"),
        CheckConstraint(CONFIDENCE_RANGE_CHECK_SQL, name="ck_text_elements_confidence_range"),
        CheckConstraint(
            "font_confidence IS NULL OR (font_confidence >= 0 AND font_confidence <= 1)",
            name="ck_text_elements_font_confidence_range",
        ),
        Index("ix_text_elements_video_analysis_id", "video_analysis_id"),
        Index("ix_text_elements_shot_id", "shot_id"),
    )
