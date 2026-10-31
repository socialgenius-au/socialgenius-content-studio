"""Video Deconstructor — Stage 1. See reference_video.py for shared module-level context.

AnalysisAnnotation replaces four narrower entities from the original design brief (AudioElement,
Transition, Animation, EditingTechnique) with one table discriminated by `category`. All four
are small, timeline-scoped annotations whose exact field shape isn't fully settled yet
(Animation/EditingTechnique especially) and whose real access pattern is always "everything for
this VideoAnalysis, grouped for one report" rather than independent cross-analysis querying —
exactly the situation `details` (jsonb) is for for: a category-specific payload can evolve
without a migration (e.g. Transition's `details: {cut_type, duration}`, Audio's
`details: {band_type, loudness_summary}`), and a not-yet-designed future annotation type (a
motion path, a keyframe curve) can be added as a new category value with a new `details` shape,
never a new table.

`category` is deliberately an open String, not a DB-level enum — new categories must stay a
one-line addition, never a migration (this is the direct opposite design choice from
`certainty`, whose five values ARE meant to be closed — see certainty.py's own docstring for
why the two fields are treated differently on purpose).
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.certainty import CERTAINTY_CHECK_SQL, CONFIDENCE_RANGE_CHECK_SQL


class AnalysisAnnotation(Base):
    __tablename__ = "analysis_annotations"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_analysis_id: Mapped[int] = mapped_column(ForeignKey("video_analyses.id", ondelete="CASCADE"), nullable=False)
    # Nullable: audio-band annotations aren't shot-scoped (they're independent ranges on the
    # audio track); transition/animation/editing-technique annotations usually are.
    shot_id: Mapped[int | None] = mapped_column(ForeignKey("shots.id", ondelete="SET NULL"), nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)  # audio | transition | animation | editing_technique
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict)

    certainty: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    produced_by_pass: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("end_time >= start_time", name="ck_analysis_annotations_time_order"),
        CheckConstraint(CERTAINTY_CHECK_SQL, name="ck_analysis_annotations_certainty_valid"),
        CheckConstraint(CONFIDENCE_RANGE_CHECK_SQL, name="ck_analysis_annotations_confidence_range"),
        Index("ix_analysis_annotations_video_analysis_id", "video_analysis_id"),
        Index("ix_analysis_annotations_shot_id", "shot_id"),
        Index("ix_analysis_annotations_category", "category"),
    )
