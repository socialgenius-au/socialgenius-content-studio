"""Video Deconstructor — Stage 1. See reference_video.py for shared module-level context.

Scene groups an ordered run of Shots into a narrative unit. Shot boundaries (see shot.py) are
MEASURED (pixel-diff cut detection); which shots belong to the same Scene, and later (Stage 15)
each Scene's narrative_role (hook/setup/problem/solution/proof/cta/outro), are judgments —
always INFERRED, never MEASURED, reflected in this row's own `certainty` value.

Stage 10 structural provision (Semantic Scene Grouping readiness — see the Stage 10.0/10.0B
read-only audits for the full reasoning): `start_time`/`end_time` above are a Scene's own
independently-INFERRED temporal range — NEVER derived from, nested inside, or required to align
with any Shot's own boundaries (a semantic change may occur inside one continuous technical
shot, and a Scene may begin/end mid-shot, span several shots, or overlap only part of one).
`Shot.scene_id` therefore remains unused/reserved by design — it cannot represent a shot split
across multiple Scenes, so it is never the authoritative Scene<->Shot relationship; any future
consumer derives shot/Scene overlap at read time by comparing the two independent time ranges.

`details` (nullable JSON, added for Stage 10): STRUCTURED EVIDENCE CITATION ONLY — which
already-persisted Stage 1-9 rows (shots/frames/text/speech/annotations) support this Scene's own
boundary, as bounded id lists. It is deliberately NOT a place for semantic/narrative output of
any kind (no role, no Story Beat data, no confidence breakdown, no reasoning/evidence-summary
prose — those already have their own columns on this row, or belong on a future, separate Story
Beat evidence row) — see the `details` column's own docstring below for the exact bounded v1 key
set. Populated by scene_construction_svc.construct_and_persist_scenes (Stage 10.2B3) — see that
column's own docstring below for the exact shape and the one case (zero accepted boundaries) it
is still left NULL for.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, func
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
    # Stage 10 structural provision — STRUCTURED EVIDENCE CITATION ONLY, never semantic output.
    # Bounded v1 contract (all keys optional, all values lists of integer ids, never required,
    # never exhaustive-by-assumption — a future evidence type gets its own new
    # `supporting_<type>_ids` key only when it actually exists and is explicitly designed in):
    #   supporting_shot_ids              -> Shot.id
    #   supporting_frame_ids             -> ShotFrame.id
    #   supporting_text_element_ids      -> TextElement.id
    #   supporting_speech_segment_ids    -> SpeechSegment.id
    #   supporting_annotation_ids        -> AnalysisAnnotation.id (category-agnostic)
    # Every value is a REFERENCE by id, never a copy of the cited row's own content (no verbatim
    # transcript/OCR text, no frame descriptions) — the cited row remains the single source of
    # truth. Explicitly NOT for: semantic/narrative/Story-Beat role, confidence breakdown,
    # reasoning/evidence-summary prose (this row's own `reasoning`/`evidence_summary` columns
    # already own that), UI/rendering hints, tutorial-authoring or reconstruction instructions,
    # or any other unstructured/arbitrary output — never a generic metadata dumping ground.
    # Nullable, no default: populated by scene_construction_svc.construct_and_persist_scenes as
    # {"boundary_start": <evidence-ref dict>|None, "boundary_end": <evidence-ref dict>|None} for
    # every accepted-boundary Scene it builds; left NULL only for the zero-accepted-boundary,
    # whole-video case (neither side has anything to cite) — equally valid either way.
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
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
