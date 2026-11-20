from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LibraryItem(Base):
    """A reusable design asset saved by one user for the Carousel Creator: a set of elements (a logo lock-up, a badge, a styled heading ...) or a slide background.

    `item_json` is `{"elements": [...]}` or `{"background": {...}}`, validated exactly like carousel content (app.services.carousel_validation), including that every picture it references is the
    user's own. Applying an item always COPIES it into a carousel with fresh ids; the item itself never changes when used. Every query is scoped to `user_id`.
    """
    __tablename__ = "library_items"
    __table_args__ = (Index("ix_library_item_user_updated", "user_id", "updated_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    item_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
