"""Video Deconstructor — Stage 1 (Core Analysis Data Model). Entirely new, siloed schema: this
file and its seven siblings (video_analysis.py, scene.py, shot.py, text_element.py,
visual_object.py, analysis_annotation.py, strategic_insight.py) touch NO existing Video Studio
table. Reference-video ingestion, ffmpeg extraction, and every analysis pass are explicitly
Stage 2+ — nothing here does any of that; this is schema only.

ReferenceVideo is the one entity in this whole system meant to be immutable once created — it
represents the original, as-uploaded source. No update code path against its own fields is
written anywhere in this codebase; "new analysis" is always a new VideoAnalysis row pointing
back at the SAME ReferenceVideo, never a mutation of this one (see video_analysis.py).
"""
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Only two ingestion paths are anticipated (Stage 2's own scope); kept as a plain, open string
# rather than a DB-level enum for the same reason `category` fields elsewhere in this schema
# are open — see certainty.py's docstring for why closed-vs-open sets are decided per field, not
# uniformly.
REFERENCE_VIDEO_SOURCE_CHECK_SQL = "source IN ('upload', 'url')"
RIGHTS_STATUS_CHECK_SQL = "rights_status IN ('owned', 'licensed', 'unknown_third_party')"


class ReferenceVideo(Base):
    __tablename__ = "reference_videos"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # RESTRICT, not CASCADE: the underlying Asset should not be deletable out from under an
    # immutable analysis record — a real-world "user deletes their media library asset" action
    # colliding with this is a genuine Stage-2-and-later product question (nothing in this
    # codebase can create a ReferenceVideo yet, so it cannot occur today); flagged in the
    # implementation report rather than silently decided.
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)  # "upload" | "url" (Stage 2)
    original_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    # Technical facts (Stage 3 populates these — a stale "Stage 4" reference from before
    # Ingestion became its own Stage 2; nullable since nothing wrote them until now).
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    codec: Mapped[str | None] = mapped_column(String(64), nullable=True)
    has_audio: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Stage 3 (Reference Video Technical Analysis) — Option B from the Stage-3 design review:
    # one additive, controlled, versioned JSON column for the deterministic technical facts that
    # don't warrant their own scalar column (container bitrate, pixel format, per-stream
    # bitrates, rotation, stream counts, etc.) — same rationale AnalysisAnnotation.details/
    # StrategicInsight.details already established elsewhere in this schema: a stable, documented
    # shape (see ffmpeg_svc.TECHNICAL_DETAILS_SCHEMA_VERSION and
    # ffmpeg_svc.probe_technical_metadata's own docstring for the exact structure) that can grow
    # a new key later without a migration, rather than either bloating this table with 8+ more
    # narrow columns or an unrestricted raw-ffmpeg-dump.
    #
    # IMPORTANT — this column was NOT created by `Base.metadata.create_all` at app startup: this
    # project has no Alembic/migration chain, and create_all only creates tables that don't exist
    # yet — it never ALTERs an existing one. `reference_videos` already existed from Stage 1, so
    # this column required one explicit, manually-run, additive DDL statement (executed and
    # verified against the real dev database as part of the Stage 3 implementation; see the
    # Stage 3 implementation report for the exact before/after verification):
    #     ALTER TABLE reference_videos ADD COLUMN technical_details JSON;
    # No existing row's data was touched — every pre-existing ReferenceVideo simply gained this
    # column with a NULL value, which is exactly its correct "not yet analyzed" state.
    technical_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Part 17's rights gate (Stage 27 enforces it; the column exists from Stage 1 so nothing
    # downstream ever has to retrofit it onto already-existing rows).
    rights_status: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown_third_party")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(REFERENCE_VIDEO_SOURCE_CHECK_SQL, name="ck_reference_videos_source_valid"),
        CheckConstraint(RIGHTS_STATUS_CHECK_SQL, name="ck_reference_videos_rights_status_valid"),
        Index("ix_reference_videos_user_id", "user_id"),
        Index("ix_reference_videos_asset_id", "asset_id"),
    )
