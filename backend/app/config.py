from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Stage 11.3 pre-lock correction — the ONE place a currently-available Anthropic model id is
# defined for the three Deconstructor reasoners (Semantic Boundary / Story Beat / Hook) below.
# Before this fix, each of SEMANTIC_REASONER_MODEL/STORY_BEAT_REASONER_MODEL/HOOK_REASONER_MODEL
# independently hard-coded the identical literal "claude-sonnet-4-20250514" -- a since-retired
# model id that Anthropic now returns 404 for. That was a genuine system-level defect (a value
# meant to be "one shared default" was actually three separately-typed copies that could only be
# fixed by editing three places, and silently drifted out of date together) rather than a
# validation inconvenience specific to any one reasoner. Each reasoner's own *_MODEL setting
# remains an INTENTIONAL, independent override point (see each section's own docstring below for
# why) -- only the DEFAULT it falls back to is now deduplicated to this one constant. Bump this
# single value when Anthropic retires the current default; an operator who wants one specific
# reasoner on a different model still sets that reasoner's own *_MODEL env var, unaffected by this
# shared default either way.
#
# Deliberately NOT applied to CLAUDE_MODEL/AI_TEXT_MODEL above/below (both share this exact same
# stale literal too, and are almost certainly affected by the same retirement) -- those belong to
# the separate, pre-existing AI Tools / Job Planner surface this Deconstructor-stage task has no
# authorization to modify. Flagged, not fixed, in this pass -- see the Stage 11.3 pre-lock report.
_DEFAULT_ANTHROPIC_REASONER_MODEL = "claude-sonnet-5"


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

    # ── Stage 10.2B — Semantic Boundary Reasoner (app/services/semantic_reasoner/) ────────────
    # Deliberately SEPARATE from AI_TEXT_PROVIDER/AI_TEXT_MODEL above: that pair drives FREEFORM
    # TEXT generation for AI Tools (prompt/hook/script/caption generation); this pair drives a
    # STRUCTURED semantic-boundary DECISION (see app/services/semantic_reasoner/contract.py) and
    # may reasonably use a different provider/model, or none at all, without affecting AI Tools
    # in either direction. SEMANTIC_REASONER_PROVIDER empty ("") means "no semantic reasoner
    # configured" — the honest default: even though Stage 10.2B2 registers a real
    # AnthropicSemanticReasoner (see semantic_reasoner/router.py's own _REASONER_PROVIDERS), it
    # never runs unless an operator explicitly opts in by setting this to "anthropic" (and unless
    # ANTHROPIC_API_KEY, reused as-is from above, is also actually set) — never a silent default,
    # exactly like AnthropicProvider.is_configured() already gates every app/services/ai/ call.
    # SEMANTIC_REASONER_MODEL has a real default (unlike PROVIDER) since a provider, once
    # selected, needs *some* valid model name — _DEFAULT_ANTHROPIC_REASONER_MODEL above (Stage
    # 11.3 pre-lock correction; previously an independently-hard-coded, now-retired literal).
    SEMANTIC_REASONER_PROVIDER: str = ""
    SEMANTIC_REASONER_MODEL: str = _DEFAULT_ANTHROPIC_REASONER_MODEL

    # ── Stage 10.3B — Story Beat Reasoner (app/services/story_beat_reasoner/) ─────────────────
    # A SIBLING pair to SEMANTIC_REASONER_PROVIDER/MODEL above, never a reuse of it: Story Beat
    # answers a genuinely different question (see story_beat_reasoner/contract.py's own docstring)
    # and may reasonably run under a different provider/model, or none at all, independently of
    # whether the Semantic Scene reasoner is configured. Same honest-unconfigured discipline:
    # STORY_BEAT_REASONER_PROVIDER empty ("") means no Story Beat reasoner runs, even though Stage
    # 10.3B2 registers a real AnthropicStoryBeatReasoner (see story_beat_reasoner/router.py's own
    # _REASONER_PROVIDERS) — an operator must explicitly opt in, and
    # AnthropicStoryBeatReasoner.is_configured() still gates every call on ANTHROPIC_API_KEY
    # actually being set.
    STORY_BEAT_REASONER_PROVIDER: str = ""
    STORY_BEAT_REASONER_MODEL: str = _DEFAULT_ANTHROPIC_REASONER_MODEL

    # ── Stage 11.3 — Hook Reasoner (app/services/hook_reasoner/) ──────────────────────────────
    # A SIBLING pair to SEMANTIC_REASONER_PROVIDER/MODEL and STORY_BEAT_REASONER_PROVIDER/MODEL
    # above, never a reuse of either: Hook classification answers a genuinely different question
    # (what kind of hook appears inside an already-derived, fixed Hook Window — see
    # hook_reasoner/contract.py's own docstring) and may run under a different provider/model, or
    # none at all, independently of whether the other two reasoners are configured. Same honest-
    # unconfigured discipline: HOOK_REASONER_PROVIDER empty ("") means no Hook reasoner runs, even
    # though a real AnthropicHookReasoner is registered (see hook_reasoner/router.py's own
    # _REASONER_PROVIDERS) — an operator must explicitly opt in, and
    # AnthropicHookReasoner.is_configured() still gates every call on ANTHROPIC_API_KEY actually
    # being set.
    HOOK_REASONER_PROVIDER: str = ""
    HOOK_REASONER_MODEL: str = _DEFAULT_ANTHROPIC_REASONER_MODEL

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
