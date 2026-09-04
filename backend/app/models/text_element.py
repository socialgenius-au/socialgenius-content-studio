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

Stage 6 (OCR / On-Screen Text) is the first pass to actually populate this table — see the
Stage-6 design review for the full certainty/provenance treatment. Three columns added then,
following this same file's own precedent above (add a nullable column now, unused until the
stage that needs it, rather than retrofit later):
  - source_frame_asset_id: which extracted frame this text was read from — same "which frame did
    this evidence come from" pattern as Shot.keyframe_asset_id / ShotFrame.asset_id, RESTRICT for
    the same "don't let evidence dangle" reasoning as ShotFrame.asset_id. May point at an
    already-existing Stage-5 ShotFrame's own Asset (no duplicate file) or a new Stage-6
    supplementary-frame Asset.
  - category: open string, same convention as AnalysisAnnotation.category/StrategicInsight.category
    — a text occurrence's ROLE (headline, CTA, disclaimer, username, etc.) is a semantic judgment
    Stage 6's deterministic OCR pass cannot honestly make; left NULL by Stage 6, populated only by
    a later, genuinely INFERRED stage.
  - style_details: small evolving JSON payload, same convention as
    ReferenceVideo.technical_details / AnalysisAnnotation.details — deterministic, pixel-sampled
    facts that don't warrant their own scalar columns (e.g. dominant_text_color,
    dominant_background_color, detected_script), computed the same Pillow/numpy way Stage 5's own
    frame measurements are.

Two-level evidence structure (post-Stage-6-manual-test refinement — see that review's own
"evidence-preserving canonical grouping" discussion for the full reasoning):

  EVERY row here is a raw, individual OCR observation — one specific engine's reading of one
  specific candidate frame. Rows are NEVER merged, edited, or deleted to "clean up" near-duplicate
  readings; every observation stays exactly as measured, permanently, for full audit.

  occurrence_group_id (added here) is how "the same LOCAL appearance, read more than once" is
  represented without ever touching the underlying rows: NULL means this row IS the canonical
  head of its own Occurrence Group (its own text/geometry/confidence ARE that group's canonical
  candidate — chosen as the highest-confidence raw observation among its members, never a
  synthetic average); a non-NULL value points at that head row, meaning "I am additional raw
  evidence for the same local appearance." A group's own overall visible time span is deliberately
  NEVER stored anywhere — it's derived at read time as min(members' start_time)..max(members'
  end_time), so nothing claims a continuous-visibility window beyond what was actually sampled.
  certainty stays "MEASURED" on every row regardless of head/member status — grouping is just an
  index over real observations, not a new kind of claim.

  A SEPARATE, explicitly INFERRED concept — "Recurring Element" (probably the same real on-screen
  element reappearing after a gap too large to treat as one continuous local appearance, e.g. a
  watermark seen at three separated moments) — is NOT represented here at all. It reuses the
  existing AnalysisAnnotation table (category="recurring_text_element", see ocr_svc.py's own
  linking logic) precisely so the two levels can never be confused: every TextElement row is
  unconditionally MEASURED evidence; a recurring-element cross-reference is unconditionally an
  AnalysisAnnotation row with certainty="INFERRED" and its own independent confidence_score.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, func
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

    # Stage 6 (OCR / On-Screen Text) additions — see this module's own docstring above.
    source_frame_asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"), nullable=True)
    category: Mapped[str | None] = mapped_column(String(48), nullable=True)
    style_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Occurrence Group (post-Stage-6-manual-test refinement) — see this module's own docstring
    # above. NULL = this row is the canonical head of its own group; non-NULL = this row is
    # additional raw evidence grouped under that head. SET NULL (not CASCADE) on delete: deleting
    # a head must never cascade-delete its members' own raw evidence — see ocr_svc.py's own
    # retry/cleanup logic, which always deletes a whole group (head + members) together anyway,
    # making this purely a defensive backstop against a future code path that doesn't.
    occurrence_group_id: Mapped[int | None] = mapped_column(ForeignKey("text_elements.id", ondelete="SET NULL"), nullable=True)

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
        Index("ix_text_elements_source_frame_asset_id", "source_frame_asset_id"),
        Index("ix_text_elements_occurrence_group_id", "occurrence_group_id"),
    )
