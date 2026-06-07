from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/socialgenius"
    SECRET_KEY: str = "change-me-in-production-use-32-chars-minimum"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 h

    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-4-20250514"

    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE_MB: int = 500

    ALLOWED_EXTENSIONS: list[str] = [
        "mp4", "mov", "avi", "mkv", "webm",
        "mp3", "wav", "m4a", "aac",
        "jpg", "jpeg", "png", "gif", "webp",
        "pdf", "srt",
    ]

    # ── Third-party integrations ──────────────────────────────────────────────
    BEEHIIV_API_KEY: str = ""
    BEEHIIV_PUBLICATION_ID: str = ""

    GMB_ACCESS_TOKEN: str = ""
    GMB_LOCATION_NAME: str = ""  # e.g. accounts/123/locations/456

    CANVA_CLIENT_ID: str = ""
    CANVA_CLIENT_SECRET: str = ""

    APIFY_API_TOKEN: str = ""

    PIXABAY_API_KEY: str = ""

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def fix_db_url(cls, v: str) -> str:
        """Railway provides postgres:// — coerce to asyncpg dialect."""
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql+asyncpg://", 1)
        if v.startswith("postgresql://") and "+asyncpg" not in v:
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v


settings = Settings()
