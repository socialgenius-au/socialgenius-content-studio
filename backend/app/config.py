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

    # ── SocialGenius AI service (app/services/ai/) — provider-neutral AI Tools ────────────────
    # AI_TEXT_PROVIDER/AI_TEXT_MODEL choose the DEFAULT provider+model any AI task in
    # app/services/ai/tasks.py uses, unless that task pins its own override. Switching provider
    # means AI_TEXT_MODEL must also become a valid model name for that provider (there's no
    # single model string that means anything across Claude/GPT/Gemini) — CLAUDE_MODEL above is
    # untouched and still belongs only to the older, pre-existing Job Planner/AI Assistant code
    # (app/services/claude.py, generate_svc.generate_content/chat_reply), which this refactor
    # deliberately does not move onto this new layer.
    AI_TEXT_PROVIDER: str = "anthropic"
    AI_TEXT_MODEL: str = "claude-sonnet-4-20250514"
    # Only the currently-selected AI_TEXT_PROVIDER's key needs to actually be set — the other
    # two stay "" (falsy) until/unless that provider is selected, exactly like ANTHROPIC_API_KEY
    # already worked before this provider-neutral layer existed.
    OPENAI_API_KEY: str = ""
    GOOGLE_AI_API_KEY: str = ""

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

    # ── Production infrastructure ─────────────────────────────────────────────
    SENTRY_DSN: str = ""
    REDIS_URL: str | None = None   # e.g. redis://default:password@hostname:6379

    # ── Email notifications (Resend) ──────────────────────────────────────────
    RESEND_API_KEY: str = ""
    NOTIFY_FROM_EMAIL: str = "SocialGenius <notifications@socialgenius.au>"

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
