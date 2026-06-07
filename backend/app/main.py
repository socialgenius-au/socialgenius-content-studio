import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import engine, Base, AsyncSessionLocal
from app.routers import auth, upload, plan, jobs, transcribe, process, publish, canva, scrape, pixabay, brands, generate, ws

# Import all models so Base.metadata is fully populated before create_all
from app.models import User, Brand, Job, Asset, Transcript  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _seed_users()
    yield


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
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
app.include_router(ws.router,         prefix="/ws",         tags=["websocket"])


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "SocialGenius Content Studio"}
