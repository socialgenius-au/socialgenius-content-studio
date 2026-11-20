from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CarouselTemplate(Base):
    """A reusable carousel template or branded layout saved by one user.

    `template_json` is a complete PostDocument (validated like any carousel by app.services.carousel_validation) whose slides are the template. Applying a template always COPIES it
    (new ids) into a carousel; the template itself is never changed by use. `kind` is 'carousel' (a whole starting carousel) or 'layout' (one or a few slides to insert).
    Every query is scoped to `user_id`.
    """
    __tablename__ = "carousel_templates"
    __table_args__ = (Index("ix_carousel_template_user_updated", "user_id", "updated_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="carousel")
    slide_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    platform_key: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    format_key: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    brand_kit_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    template_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
