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

logger = logging.getLogger("app")

from app.config import settings
from app.database import engine, Base, AsyncSessionLocal
from app.limiter import limiter
from app.routers import auth, upload, plan, jobs, transcribe, process, publish, canva, scrape, pixabay, brands, generate, ws, assets, templates

# Import all models so Base.metadata is fully populated before create_all
from app.models import User, Brand, Job, Asset, Transcript, Template  # noqa: F401

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://content-studio-frontend-production-84fe.up.railway.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Catching Exception here (inside the CORS/ExceptionMiddleware stack) instead of letting it
# fall through to Starlette's outer ServerErrorMiddleware means CORS headers still get attached
# to the resulting error response — otherwise the browser reports a same-origin-looking 500 as
# an opaque CORS failure, hiding the real error from the frontend.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


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
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, workers=1)
