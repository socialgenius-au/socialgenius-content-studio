from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AuthToken(Base):
    """One-time, expiring tokens emailed to a user: password-reset links and email-ownership-verification links.

    Only the SHA-256 hash of a token is ever stored (the raw value exists only in the email), so a database leak cannot be turned into
    a password reset. `used_at` is set when the token is consumed OR superseded by a newer one; a token is usable only while
    `used_at IS NULL AND expires_at > now()` (database clock). `email` is the address the link was sent to: a token stops working if the
    account's email changes after it was issued.
    """
    __tablename__ = "auth_tokens"
    __table_args__ = (
        CheckConstraint("purpose IN ('password_reset', 'email_verify')", name="ck_auth_tokens_purpose_valid"),
        Index("ix_auth_tokens_user_purpose_created", "user_id", "purpose", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(24), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    request_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
