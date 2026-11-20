from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CarouselDocument(Base):
    """One saved Carousel Creator document, owned by one user.

    `document_json` is the complete PostDocument (slides in order, with every layout, text, image reference, shape, background, layer and the canvas format, plus the Deconstructor
    blueprint provenance); the frontend owns its exact shape, validated server-side by app.services.carousel_validation. Images are NEVER stored here: an image element holds the id
    and the media URL of a file that lives in the existing media storage (the `assets` table / uploads volume), and media tokens are stripped before saving.

    `version` is the optimistic-concurrency counter: it starts at 1 and goes up by one on every accepted update, so an update made against an older version is refused (409) instead
    of silently overwriting newer work. `doc_id` is the id the editor gave the document (unique per user), which lets a browser-only carousel be imported without changing its id.
    Every query is scoped to `user_id`.
    """
    __tablename__ = "carousel_documents"
    __table_args__ = (
        UniqueConstraint("user_id", "doc_id", name="uq_carousel_user_doc"),
        Index("ix_carousel_user_updated", "user_id", "updated_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    doc_id: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    slide_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    platform_key: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    format_key: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    theme_id: Mapped[str] = mapped_column(String(32), nullable=False, default="forest")
    active_slide_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    blueprint_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reference_video_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    origin: Mapped[str] = mapped_column(String(24), nullable=False, default="server")       # server | browser_import | duplicate
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    document_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
