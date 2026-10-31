"""Video Deconstructor — Stage 1. See reference_video.py for shared module-level context.

VisualObject is every detected object/product/person/logo/background region — the same
normalized geometry shape as TextElement (see that file's docstring for the rotation/scale/
anchor/opacity/z_index reasoning, identical here), plus a category label so foreground/
midground/background layering (z_index) and object type filtering are both queryable directly.

Stage 8, Phase B additions — RAW DETECTOR EVIDENCE vs. BUSINESS/CONTENT ROLE (the reason these
three additive changes exist; see visual_object_svc.py's own docstring for the detector side of
this same principle): a local torchvision object detector returns a native COCO label (e.g.
"cell phone", "keyboard", "laptop", "tv") plus a class id and a confidence score — this is
DIRECTLY MEASURED evidence. Which of this project's own five `category` values (person / product
/ logo / background / prop) that object actually PLAYS in the content — is a detected phone THE
advertised product, a background prop, or just part of the filming environment? — is a business/
contextual judgment this deterministic detector cannot honestly make. Phase B therefore:

  1. Adds `'object'` to the category CHECK — a sixth, deliberately NEUTRAL value meaning "a
     generic detected visual object whose content role is not yet known," used for every COCO
     label except "person" (see point 3 below). The five original values remain exactly as
     defined; nothing about them changed. A later, genuinely business-aware stage may reclassify
     a row's `category` (e.g. `'object'` -> `'product'`) once real context is available — that
     reclassification is explicitly OUT OF SCOPE for Phase B, which only ever writes `'object'`
     or `'person'`.
  2. Adds `class_id` (nullable Integer) — the detector's own raw native class index (e.g. COCO's
     77 for "cell phone"). `label` already carries the equally-identifying string form ("cell
     phone") for every practical query need; `class_id` is preserved anyway because it is cheap,
     exact, and was explicitly requested as evidence worth keeping — not because `label` is
     insufficient on its own.
  3. Adds `source_frame_id` (nullable FK -> shot_frames.id, RESTRICT) — WHICH EXACT Stage-5
     ShotFrame produced this detection, the same "never let evidence go dangling" reasoning
     TextElement.source_frame_asset_id already established (RESTRICT, not SET NULL — a Stage-5
     retry can only ever occur before Stage 8 has run against that Shot's now-complete frame set,
     since Stage 8 itself requires `visual_evidence` already complete before it runs at all, so
     this FK can never actually block a legitimate Stage-5 retry in practice). Nullable because a
     future, non-frame-derived VisualObject (e.g. one entirely INFERRED from cross-frame
     reasoning, not read off one specific image) may legitimately have no single source frame.

`source` is left at its original String(32) — Phase B writes `source="torchvision"` (the
producer/engine FAMILY name), the same convention TextElement/SpeechSegment already established
("easyocr"/"whisper", never an exact model variant). The exact model identifier (e.g.
"fasterrcnn_mobilenet_v3_large_320_fpn") is preserved verbatim in `evidence_summary` instead —
mirroring exactly where SpeechSegment's own Whisper model variant lives ("Local Whisper (base)
..."), never lost, never requiring a wider `source` column.

Category mapping applied by Phase B specifically (not a general rule for all future stages):
COCO's own "person" class maps to `category="person"` because that is the SAME structural
concept, not an interpretation (a detected person-shaped region genuinely IS what `category=
"person"` has always meant here — see point 1 above for why this is the ONE COCO label allowed
to keep an original category value). Every other COCO label Phase B ever persists gets
`category="object"` — never a guessed `"product"`/`"prop"`/`"logo"`/`"background"`.

Transform-default honesty (IMPORTANT — read before treating any of these six columns as
detector output): scale_x/scale_y/rotation/anchor_x/anchor_y/opacity/z_index are NOT measured by
a 2D bounding-box detector and never will be by one — Phase B writes them at their NOT-NULL
column defaults (1.0/1.0/0.0/0.5/0.5/1.0/0) purely because the column itself requires a value,
exactly the same "populated now, unused until a future stage can genuinely measure it" reasoning
TextElement's own Stage-1 docstring already established for these identical six columns. A
Phase-B row's own `evidence_summary` says so explicitly, in plain language, specifically so a
reader querying `rotation=0.0` on such a row is not misled into thinking 0 degrees was ever
actually observed.

Certainty: Phase B writes `certainty="MEASURED"` — the same choice, and the same reasoning,
already established for Stage 6's own OCR detections (TextElement): a neural detector's own
direct classification+confidence+geometry output, unmodified and un-interpreted by any human or
business judgment. This is NOT a claim that "a person/object definitely, physically exists" —
only that the detector's own algorithm produced exactly this label/box/score for this exact
frame; `evidence_summary` states this distinction explicitly on every row.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.certainty import CERTAINTY_CHECK_SQL, CONFIDENCE_RANGE_CHECK_SQL
from app.models.geometry import ANCHOR_NORMALIZED_CHECK_SQL, OPACITY_RANGE_CHECK_SQL, WH_NORMALIZED_CHECK_SQL, XY_NORMALIZED_CHECK_SQL

# Stage 8 Phase B added 'object' — see this module's own docstring point 1 for exactly why
# (a neutral value for a generic detected object whose content role is not yet known). The
# original five values are unchanged.
VISUAL_OBJECT_CATEGORY_CHECK_SQL = "category IN ('person', 'product', 'logo', 'background', 'prop', 'object')"


class VisualObject(Base):
    __tablename__ = "visual_objects"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_analysis_id: Mapped[int] = mapped_column(ForeignKey("video_analyses.id", ondelete="CASCADE"), nullable=False)
    shot_id: Mapped[int | None] = mapped_column(ForeignKey("shots.id", ondelete="SET NULL"), nullable=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    # Stage 8 Phase B — see this module's own docstring points 2/3. Both nullable/additive.
    class_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_frame_id: Mapped[int | None] = mapped_column(ForeignKey("shot_frames.id", ondelete="RESTRICT"), nullable=True)

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
        Index("ix_visual_objects_source_frame_id", "source_frame_id"),
    )
