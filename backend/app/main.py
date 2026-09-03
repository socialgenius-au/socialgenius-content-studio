import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("app")

from app.config import settings
from app.database import engine, Base, AsyncSessionLocal
from app.limiter import limiter
from app.routers import auth, upload, plan, jobs, transcribe, process, publish, canva, scrape, pixabay, brands, generate, ws, assets, templates, video_studio_drafts, video_export, reference_videos

# Import all models so Base.metadata is fully populated before create_all
from app.models import (  # noqa: F401
    User, Brand, Job, Asset, Transcript, Template, VideoStudioDraft,
    # Video Deconstructor — Stage 1 (Core Analysis Data Model): eight new, siloed tables.
    # create_all only ever CREATES missing tables — it never alters or drops an existing one —
    # so this import list growing is what makes these 8 tables get created on next startup,
    # with zero effect on any table already in the database.
    ReferenceVideo, VideoAnalysis, Scene, Shot, TextElement, VisualObject,
    AnalysisAnnotation, StrategicInsight,
)

# ── Sentry ────────────────────────────────────────────────────────────────────
if settings.SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        traces_sample_rate=0.05,
        environment="production",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        if os.environ.get("RESET_DB") == "true":
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(Base.metadata.create_all)
    await _seed_users()
    yield
    if settings.REDIS_URL:
        from app.services.queue import close_pool
        await close_pool()


async def _seed_users() -> None:
    from sqlalchemy import select
    from app.services.auth import hash_password

    seeds = [
        {"username": "ayub",  "email": "ayub@socialgenius.au",  "role": "admin"},
        {"username": "priya", "email": "priya@socialgenius.au", "role": "editor"},
        {"username": "iqra",  "email": "iqra@socialgenius.au",  "role": "editor"},
    ]
    async with AsyncSessionLocal() as session:
        for seed in seeds:
            exists = (await session.execute(select(User).where(User.username == seed["username"]))).scalar_one_or_none()
            if not exists:
                session.add(User(
                    username=seed["username"],
                    email=seed["email"],
                    hashed_password=hash_password(f"{seed['username']}123"),
                    role=seed["role"],
                ))
        await session.commit()


app = FastAPI(
    title="SocialGenius Content Studio",
    version="4.0.0",
    lifespan=lifespan,
)

# ── Rate limiting ─────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


class UnhandledExceptionMiddleware(BaseHTTPMiddleware):
    # Starlette's add_middleware() inserts each new middleware at the *front* of the stack, so
    # the middleware added last ends up outermost. This must be added before CORSMiddleware
    # below so that CORSMiddleware wraps it, not the other way round — otherwise the response
    # built here never passes back out through CORSMiddleware and never gets CORS headers,
    # leaving the browser to report a same-origin-looking 500 as an opaque CORS failure instead
    # of surfacing the real error.
    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            logger.exception("Unhandled error on %s %s", request.method, request.url.path)
            return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.add_middleware(UnhandledExceptionMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://content-studio-frontend-production-84fe.up.railway.app",
        # Ayub staging test frontend (snapshot branch only) — see staging/ayub-video-studio-test-03-sep-2026.
        "https://frontend-ayubtest-contentstudio-production.up.railway.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

app.include_router(auth.router,       prefix="/auth",       tags=["auth"])
app.include_router(upload.router,     prefix="/upload",     tags=["upload"])
app.include_router(plan.router,       prefix="/plan",       tags=["plan"])
app.include_router(jobs.router,       prefix="/jobs",       tags=["jobs"])
app.include_router(transcribe.router, prefix="/transcribe", tags=["transcribe"])
app.include_router(process.router,    prefix="/process",    tags=["process"])
app.include_router(publish.router,    prefix="/publish",    tags=["publish"])
app.include_router(canva.router,      prefix="/canva",      tags=["canva"])
app.include_router(scrape.router,     prefix="/scrape",     tags=["scrape"])
app.include_router(pixabay.router,    prefix="/pixabay",    tags=["pixabay"])
app.include_router(brands.router,     prefix="/brands",     tags=["brands"])
app.include_router(generate.router,   prefix="/generate",   tags=["generate"])
app.include_router(assets.router,     prefix="/assets",     tags=["assets"])
app.include_router(templates.router,  prefix="/templates",  tags=["templates"])
app.include_router(video_studio_drafts.router, prefix="/video-studio-drafts", tags=["video-studio-drafts"])
app.include_router(video_export.router, prefix="/video-export", tags=["video-export"])
# Video Deconstructor — Stage 2 (Reference Video Ingestion) ONLY. See reference_videos.py's own
# module docstring for exact scope.
app.include_router(reference_videos.router, prefix="/reference-videos", tags=["reference-videos"])
app.include_router(ws.router,         prefix="/ws",         tags=["websocket"])


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "SocialGenius Content Studio", "version": "4.0.0"}


@app.get("/health/live", tags=["health"])
async def health_live():
    """Liveness probe — returns 200 as long as the process is up."""
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
async def health_ready():
    """Readiness probe — checks DB and (optionally) Redis connectivity."""
    checks: dict[str, str] = {}

    # Database
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception:
        checks["db"] = "error"

    # Redis (optional — only checked when REDIS_URL is set)
    if settings.REDIS_URL:
        try:
            import redis.asyncio as aioredis
            r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
            await r.ping()
            await r.aclose()
            checks["redis"] = "ok"
        except Exception:
            checks["redis"] = "error"
    else:
        checks["redis"] = "not_configured"

    all_ok = all(v in ("ok", "not_configured") for v in checks.values())
    status_code = 200 if all_ok else 503

    from fastapi.responses import JSONResponse
    return JSONResponse(
        content={"status": "ok" if all_ok else "degraded", **checks},
        status_code=status_code,
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    # Railway's edge proxy is the only thing that can reach this container, so trust
    # its X-Forwarded-For unconditionally — otherwise request.client.host (and every
    # slowapi rate limit keyed on it) sees the proxy's address for every request,
    # collapsing rate limits into one shared bucket across all real clients.
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, workers=1, forwarded_allow_ips="*")
