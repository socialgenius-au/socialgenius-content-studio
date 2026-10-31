"""Video Deconstructor — Stage 1. See reference_video.py for shared module-level context.

Shot is a single, cut-bounded segment — the timing backbone most other analysis entities
(TextElement, VisualObject, AnalysisAnnotation) optionally reference via shot_id. Deliberately
absorbs the design brief's separate StoryboardFrame entity as a single keyframe_asset_id column
(one representative frame per shot is Stage 6's whole MVP scope) rather than a child table —
promote to a real table only if/when multiple frames per shot are ever needed.

`scene_id` is nullable (Stage 4 fix — was NOT NULL from Stage 1 through the Stage-4 design
review, relaxed via one additive `ALTER TABLE shots ALTER COLUMN scene_id DROP NOT NULL`, applied
and verified against the real dev database with zero data loss since the table was still empty).
This module's own original docstring already drew the exact distinction that made the original
NOT NULL wrong: a Shot's cut boundary is MEASURED (deterministic pixel-difference detection,
Stage 4); which Scene it narratively belongs to is INFERRED (Stage 15, not built yet). Forcing
every Shot to already reference a Scene would have meant either fabricating an ungrouped
placeholder Scene (a false semantic claim with no honest certainty value) or blocking Stage 4
outright — a Shot legitimately has `scene_id = NULL` until real scene-grouping inference exists.

`video_analysis_id` (Stage 4 fix, added alongside the scene_id relaxation above): Shot's ONLY
foreign key used to be scene_id -> Scene.video_analysis_id — fine when every Shot required a
Scene, but once scene_id can legitimately be NULL, a Shot with no Scene had no path back to its
VideoAnalysis/ReferenceVideo at all: an orphaned, unqueryable row. Added as one more nullable,
additive column (`ForeignKey("video_analyses.id", ondelete="CASCADE")`), populated directly by
every Stage-4-detected Shot; a future genuinely-scene-grouped Shot could in principle omit it and
reach its VideoAnalysis transitively via scene_id instead, mirroring how AnalysisAnnotation
already carries both a direct video_analysis_id and an optional shot_id in this same schema.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.certainty import CERTAINTY_CHECK_SQL, CONFIDENCE_RANGE_CHECK_SQL


class Shot(Base):
    __tablename__ = "shots"

    id: Mapped[int] = mapped_column(primary_key=True)
    scene_id: Mapped[int | None] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), nullable=True)
    # Stage 4: direct link to the owning VideoAnalysis — see this module's own docstring above
    # for why scene_id alone is no longer sufficient now that it can be NULL.
    video_analysis_id: Mapped[int | None] = mapped_column(ForeignKey("video_analyses.id", ondelete="CASCADE"), nullable=True)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    camera_movement: Mapped[str | None] = mapped_column(String(32), nullable=True)  # static|pan|zoom|... (Stage 13)
    # Deliberately points at the EXISTING Asset table (Stage 6 extracts a frame and stores it
    # the exact same way any other uploaded file is stored) — not a new asset-storage concept.
    keyframe_asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    certainty: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    produced_by_pass: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("end_time >= start_time", name="ck_shots_time_order"),
        CheckConstraint(CERTAINTY_CHECK_SQL, name="ck_shots_certainty_valid"),
        CheckConstraint(CONFIDENCE_RANGE_CHECK_SQL, name="ck_shots_confidence_range"),
        Index("ix_shots_scene_id", "scene_id"),
        Index("ix_shots_keyframe_asset_id", "keyframe_asset_id"),
        Index("ix_shots_video_analysis_id", "video_analysis_id"),
    )
