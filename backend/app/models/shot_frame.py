"""Video Deconstructor — Stage 5 (Visual Evidence / Representative Frames). See
reference_video.py for shared module-level context.

ShotFrame is the promotion `shot.py`'s own docstring already anticipated: `Shot.keyframe_asset_id`
was designed to hold exactly ONE representative frame per shot ("one representative frame per
shot is Stage 6's [renumbered since: this project's Stage 5] whole MVP scope... promote to a real
table only if/when multiple frames per shot are ever needed"). Stage 5's approved design extracts
a small, duration-based SET of representative frames per shot (see
ffmpeg_svc.plan_representative_frame_timestamps), so that condition is now met.

`Shot.keyframe_asset_id` is NOT deprecated by this table — Stage 5 still populates it (with the
shot's own midpoint frame's asset), so anything that only ever wants one cheap thumbnail per shot
never needs to join into this table at all. This table carries the FULL representative-frame
evidence set.

Every fact here is MEASURED, never INFERRED — a frame's timestamp, dimensions, and pixel-level
measurements (luminance/black-frame/sharpness, see ffmpeg_svc.compute_frame_measurements) are
directly computed from the extracted image itself, no model, no judgment about WHAT the frame
shows. `measurements` (jsonb) exists for exactly the same reason
ReferenceVideo.technical_details/AnalysisAnnotation.details/StrategicInsight.details do: a small,
versioned, evolving payload that doesn't warrant its own narrow scalar columns and can grow a new
key later without a migration.

`asset_id` is RESTRICT, mirroring ReferenceVideo.asset_id's own reasoning: a ShotFrame's evidence
must never be allowed to go dangling under an existing analysis row. This project's own retry path
(app.routers.reference_videos) always deletes a ShotFrame row before deleting its Asset row, so
RESTRICT never blocks its own cleanup — it only prevents some OTHER, unrelated code path from
deleting a derived frame's Asset out from under a still-existing ShotFrame row.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.certainty import CERTAINTY_CHECK_SQL, CONFIDENCE_RANGE_CHECK_SQL

EXTRACTION_METHOD_MAX_LEN = 32


class ShotFrame(Base):
    __tablename__ = "shot_frames"

    id: Mapped[int] = mapped_column(primary_key=True)
    shot_id: Mapped[int] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), nullable=False)
    # Direct link, same precedent as Shot's own video_analysis_id (Stage 4) — every ShotFrame
    # reaches its VideoAnalysis/ReferenceVideo without a join through Shot.
    video_analysis_id: Mapped[int] = mapped_column(ForeignKey("video_analyses.id", ondelete="CASCADE"), nullable=False)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False)
    timestamp: Mapped[float] = mapped_column(Float, nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    extraction_method: Mapped[str] = mapped_column(String(EXTRACTION_METHOD_MAX_LEN), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    # Deterministic, pixel-only measurements — see this module's own docstring. Never a place for
    # semantic/interpretive content (no object/text/person labels belong here — see certainty.py
    # and this project's own Stage-5 design review for the exact fact/interpretation boundary).
    measurements: Mapped[dict] = mapped_column(JSON, default=dict)
    certainty: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    produced_by_pass: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(CERTAINTY_CHECK_SQL, name="ck_shot_frames_certainty_valid"),
        CheckConstraint(CONFIDENCE_RANGE_CHECK_SQL, name="ck_shot_frames_confidence_range"),
        UniqueConstraint("shot_id", "order", name="uq_shot_frames_shot_order"),
        Index("ix_shot_frames_shot_id", "shot_id"),
        Index("ix_shot_frames_video_analysis_id", "video_analysis_id"),
        Index("ix_shot_frames_asset_id", "asset_id"),
    )
