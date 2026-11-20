from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BrandKit(Base):
    """A reusable, account-owned Brand Kit for the Carousel Creator: brand names, colours, logos, custom fonts and other reusable brand assets.

    (The older `brands` table is a different, simpler record used elsewhere; this one is separate and never touches it.)

    `kit_json` holds the validated kit (see app.services.brand_kit_validation). Pictures and font files are NOT stored here: the kit REFERENCES files in the existing media storage by asset
    id and token-free URL, and every referenced asset must belong to the same user. Every query is scoped to `user_id`.
    """
    __tablename__ = "brand_kits"
    __table_args__ = (Index("ix_brand_kit_user_updated", "user_id", "updated_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kit_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
