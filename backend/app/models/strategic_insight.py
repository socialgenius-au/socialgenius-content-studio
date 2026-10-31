"""Video Deconstructor — Stage 1. See reference_video.py for shared module-level context.

StrategicInsight replaces four narrower entities (MarketingInsight, AudienceInsight,
PositioningInsight, ViralityHypothesis) — and also carries Discoverability and Production
Inference, which never got their own entities in the first place — with one table
discriminated by `category`, per this project's own explicit instruction not to create a
separate table for every strategic dimension. Every one of these categories shares the exact
same shape (a description, evidence, confidence, reasoning) and is always INFERRED (or, for
production/original-tool questions, explicitly hedged) — a single table with an open `category`
value list is both leaner and more honest about how similar these claims structurally are than
six near-identical tables would have been.

`details` (jsonb) carries category-specific structured payloads that don't need their own
columns: e.g. a `virality_hypothesis` row's `details.required_data_to_strengthen` (Part 14's own
"what would strengthen this" field), or a `discoverability` row's
`details: {keywords, hashtags, title_suggestion, description_suggestion, tags}`.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.certainty import CERTAINTY_CHECK_SQL, CONFIDENCE_RANGE_CHECK_SQL


class StrategicInsight(Base):
    __tablename__ = "strategic_insights"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_analysis_id: Mapped[int] = mapped_column(ForeignKey("video_analyses.id", ondelete="CASCADE"), nullable=False)
    # Open string, not a DB enum — same reasoning as AnalysisAnnotation.category. Expected
    # values (documented, not DB-enforced, so a new one is a one-line addition later): hook,
    # story_structure, cta, content_objective, marketing_objective, business_objective,
    # audience, buyer_stage, pain_point, need, desire, solution, benefit, experience, proof,
    # offer, positioning, value_proposition, differentiation, retention_mechanism,
    # shareability, virality_hypothesis, platform_fit, discoverability, production_inference.
    category: Mapped[str] = mapped_column(String(48), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict)

    certainty: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    produced_by_pass: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(CERTAINTY_CHECK_SQL, name="ck_strategic_insights_certainty_valid"),
        CheckConstraint(CONFIDENCE_RANGE_CHECK_SQL, name="ck_strategic_insights_confidence_range"),
        Index("ix_strategic_insights_video_analysis_id", "video_analysis_id"),
        Index("ix_strategic_insights_category", "category"),
    )
