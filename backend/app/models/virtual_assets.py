from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class VirtualAsset(Base):
    __tablename__ = "virtual_assets"
    key: Mapped[str] = mapped_column(String(110), primary_key=True)
    details: Mapped[dict] = mapped_column(JSON)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VirtualBookmark(Base):
    __tablename__ = "virtual_asset_bookmarks"
    workspace: Mapped[str] = mapped_column(String(80), primary_key=True)
    collection: Mapped[str] = mapped_column(String(80), primary_key=True)
    asset_key: Mapped[str] = mapped_column(ForeignKey("virtual_assets.key"), primary_key=True)


class VirtualProjectMedia(Base):
    __tablename__ = "virtual_asset_project_media"
    __table_args__ = (UniqueConstraint("user_id", "asset_key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    asset_key: Mapped[str] = mapped_column(ForeignKey("virtual_assets.key"))
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"))
