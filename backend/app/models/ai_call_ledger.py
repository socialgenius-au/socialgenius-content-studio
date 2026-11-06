"""Every Anthropic request attempt and what it may cost / did cost. See app/services/ai_metering.py. Created by create_all; nothing existing is altered.

No prompt text, no image data and no key is ever stored here: only a hash of the request, sizes, token counts, money, a status and (for exact-duplicate reuse) the model's own response."""
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AiCallLedger(Base):
    __tablename__ = "ai_call_ledger"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    phase_id: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference_video_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_analysis_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reasoner: Mapped[str] = mapped_column(String(64), nullable=False, default="unscoped")
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="anthropic")
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # reserved | succeeded | failed | refused_budget | refused_disabled | refused_model | duplicate_in_flight | cache_hit
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    forced: Mapped[bool] = mapped_column(nullable=False, default=False)
    est_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_read_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_write_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    est_input_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)   # what the prompt alone would cost (charged for a failed attempt that may have been billed)
    reserved_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)    # the ceiling held against the caps while the call is in flight
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)        # settled cost (0 until settled)
    error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    response_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_ai_ledger_phase_ref", "phase_id", "reference_video_id"),
        Index("ix_ai_ledger_hash", "request_hash"),
    )
