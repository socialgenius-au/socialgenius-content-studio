"""Animated carousel export: frames in, MP4 / GIF out. Uses the REAL FFmpeg (the one the application already bundles) to encode a handful of tiny frames and checks the result.

Covers: a full round trip with a valid H.264 MP4 of the right size / frame count / duration (and a GIF), per-user isolation, authentication, in-order frames, JPEG-only frames, size and
count limits, even dimensions, the active-job limit, cleanup, an incomplete job refusing to render, and FFmpeg failure handling.
"""
import io
import re
import secrets
import struct
import subprocess

import httpx
import pytest
from fastapi import FastAPI
from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.routers import carousel_video as cv
from app.services import ffmpeg_svc
from app.services.auth import create_token

# Windows only: closing an asyncio subprocess pipe after the event loop has gone raises an 'unraisable' warning during garbage collection. It is test-runner noise, not application behaviour.
pytestmark = pytest.mark.filterwarnings("ignore::pytest.PytestUnraisableExceptionWarning", "ignore::ResourceWarning")

_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
Session = async_sessionmaker(_engine, expire_on_commit=False)


@pytest.fixture(autouse=True)
def _tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(cv.tempfile, "gettempdir", lambda: str(tmp_path))


@pytest.fixture
async def users():
    made = []
    async with Session() as db:
        for _ in range(2):
            u = User(username=f"cv_{secrets.token_hex(4)}", email=f"cv_{secrets.token_hex(4)}@example.test", hashed_password="x", role="editor", is_active=True)
            db.add(u)
            made.append(u)
        await db.commit()
        for u in made:
            await db.refresh(u)
    yield made
    async with Session() as db:
        for u in made:
            row = await db.get(User, u.id)
            if row:
                await db.delete(row)
        await db.commit()


def bearer(u):
    return {"Authorization": f"Bearer {create_token(u.id, u.username, u.role, u.token_version)}"}


def jpeg(color, size=(64, 80)):
    b = io.BytesIO()
    Image.new("RGB", size, color).save(b, "JPEG", quality=80)
    return b.getvalue()


def pack(frames):
    return b"".join(struct.pack(">I", len(f)) + f for f in frames)


async def _override_db():
    async with Session() as db:                      # this test file's own NullPool engine, so no connection is shared across the per-test event loops
        yield db


def client():
    app = FastAPI()
    app.include_router(cv.router, prefix="/carousel-video")
    app.dependency_overrides[get_db] = _override_db
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=120)


def probe(path):
    r = subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-i", str(path)], capture_output=True, text=True)
    err = r.stderr
    dur = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", err)
    secs = int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + float(dur.group(3)) if dur else None
    line = next(l for l in err.splitlines() if "Video:" in l)
    return {"duration": secs, "video": re.search(r"Video: (\w+)", line).group(1), "size": re.search(r", (\d+)x(\d+)", line).groups(),
            "pix": re.search(r"(yuvj?420p|pal8|rgb\w*)", line).group(1), "range": "tv" if "(tv" in line else "pc"}


async def make_job(c, u, frames=12, fps=12, fmt="mp4", w=64, h=80):
    r = await c.post("/carousel-video/jobs", json={"fps": fps, "width": w, "height": h, "frames": frames, "format": fmt}, headers=bearer(u))
    assert r.status_code == 201, r.text
    return r.json()["job_id"]


async def test_frames_in_mp4_out_with_the_right_codec_size_and_duration_and_the_job_is_cleaned_up(users, tmp_path):
    a, _ = users
    async with client() as c:
        job = await make_job(c, a, frames=12, fps=12)
        colors = [(i * 20, 255 - i * 20, 128) for i in range(12)]
        r = await c.put(f"/carousel-video/jobs/{job}/frames", params={"start": 0}, content=pack([jpeg(x) for x in colors[:6]]), headers=bearer(a))
        assert r.status_code == 200 and r.json() == {"received": 6, "next_frame": 6}
        r = await c.put(f"/carousel-video/jobs/{job}/frames", params={"start": 6}, content=pack([jpeg(x) for x in colors[6:]]), headers=bearer(a))
        assert r.json()["next_frame"] == 12
        r = await c.post(f"/carousel-video/jobs/{job}/render", headers=bearer(a))
        assert r.status_code == 200 and r.json()["status"] == "done" and r.json()["format"] == "mp4" and r.json()["size"] > 500
        d = await c.get(f"/carousel-video/jobs/{job}/download", headers=bearer(a))
        assert d.status_code == 200 and d.headers["content-type"] == "video/mp4" and 'filename="carousel.mp4"' in d.headers["content-disposition"]
        out = tmp_path / "x.mp4"
        out.write_bytes(d.content)
        info = probe(out)
        assert info["video"] == "h264" and info["size"] == ("64", "80") and info["pix"] == "yuv420p" and info["range"] == "tv"
        assert abs(info["duration"] - 1.0) < 0.15                                            # 12 frames at 12 fps
        assert not list((tmp_path / "carousel_video" / str(a.id) / job).glob("frame_*.jpg"))   # frames are removed once encoded
        assert (await c.delete(f"/carousel-video/jobs/{job}", headers=bearer(a))).status_code == 204
        assert not (tmp_path / "carousel_video" / str(a.id) / job).exists()
        assert (await c.get(f"/carousel-video/jobs/{job}/download", headers=bearer(a))).status_code == 404


async def test_a_gif_can_be_made_from_the_same_frames(users, tmp_path):
    a, _ = users
    async with client() as c:
        job = await make_job(c, a, frames=6, fps=10, fmt="gif")
        await c.put(f"/carousel-video/jobs/{job}/frames", params={"start": 0}, content=pack([jpeg((i * 40, 0, 255 - i * 40)) for i in range(6)]), headers=bearer(a))
        r = await c.post(f"/carousel-video/jobs/{job}/render", headers=bearer(a))
        assert r.json()["format"] == "gif"
        d = await c.get(f"/carousel-video/jobs/{job}/download", headers=bearer(a))
        assert d.headers["content-type"] == "image/gif" and d.content[:6] in (b"GIF87a", b"GIF89a")


async def test_another_users_job_looks_like_it_does_not_exist_and_everything_needs_a_session(users):
    a, b = users
    async with client() as c:
        job = await make_job(c, a, frames=2)
        for method, url in [("put", f"/carousel-video/jobs/{job}/frames?start=0"), ("post", f"/carousel-video/jobs/{job}/render"), ("get", f"/carousel-video/jobs/{job}/download"), ("delete", f"/carousel-video/jobs/{job}")]:
            r = await getattr(c, method)(url, headers=bearer(b)) if method != "put" else await c.put(url, content=pack([jpeg((1, 2, 3))]), headers=bearer(b))
            assert r.status_code == 404, (method, r.status_code)
        for method, url in [("post", "/carousel-video/jobs"), ("put", f"/carousel-video/jobs/{job}/frames?start=0"), ("get", f"/carousel-video/jobs/{job}/download")]:
            assert (await getattr(c, method)(url)).status_code in (401, 403)
        assert (await c.get(f"/carousel-video/jobs/{job}/download", headers=bearer(a))).status_code == 409          # the owner's job is still there (not ready)


@pytest.mark.parametrize("job_id", ["../../etc/passwd", "..%2F..", "a" * 31, "G" * 32, "0" * 32])
async def test_job_ids_are_validated_so_a_path_can_never_be_smuggled_in(users, job_id):
    a, _ = users
    async with client() as c:
        for r in [await c.post(f"/carousel-video/jobs/{job_id}/render", headers=bearer(a)), await c.delete(f"/carousel-video/jobs/{job_id}", headers=bearer(a))]:
            assert r.status_code in (404, 405)


async def test_frames_must_arrive_in_order_and_be_real_jpegs_and_a_bad_batch_writes_nothing(users, tmp_path):
    a, _ = users
    async with client() as c:
        job = await make_job(c, a, frames=4)
        h = bearer(a)
        r = await c.put(f"/carousel-video/jobs/{job}/frames", params={"start": 2}, content=pack([jpeg((1, 1, 1))]), headers=h)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "out_of_order"
        for bad in [pack([b"\x89PNG\r\n\x1a\n" + b"0" * 50]), pack([jpeg((1, 1, 1)), b"not a jpeg at all"]), struct.pack(">I", 1000) + b"\xff\xd8\xff", struct.pack(">I", cv.MAX_FRAME_BYTES + 1) + b"x"]:
            r = await c.put(f"/carousel-video/jobs/{job}/frames", params={"start": 0}, content=bad, headers=h)
            assert r.status_code == 422, r.text
        assert not list((tmp_path / "carousel_video" / str(a.id) / job).glob("frame_*.jpg"))              # nothing from the failed batches
        r = await c.put(f"/carousel-video/jobs/{job}/frames", params={"start": 0}, content=pack([jpeg((i, i, i)) for i in range(5)]), headers=h)
        assert r.status_code == 422 and "More frames" in r.text                                          # 5 frames for a 4-frame job
        r = await c.post(f"/carousel-video/jobs/{job}/render", headers=h)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "incomplete"


async def test_job_parameters_are_bounded_and_dimensions_must_be_even(users):
    a, _ = users
    async with client() as c:
        h = bearer(a)
        for body in [{"fps": 0, "width": 64, "height": 64, "frames": 1}, {"fps": 61, "width": 64, "height": 64, "frames": 1}, {"fps": 30, "width": 64, "height": 64, "frames": 0},
                     {"fps": 30, "width": 64, "height": 64, "frames": cv.MAX_FRAMES + 1}, {"fps": 30, "width": 5000, "height": 64, "frames": 1}, {"fps": 30, "width": 64, "height": 64, "frames": 1, "format": "avi"}]:
            assert (await c.post("/carousel-video/jobs", json=body, headers=h)).status_code == 422
        r = await c.post("/carousel-video/jobs", json={"fps": 30, "width": 63, "height": 64, "frames": 1}, headers=h)
        assert r.status_code == 422 and "even" in r.text


async def test_a_user_can_only_have_a_few_exports_in_progress_and_abandoned_ones_expire(users, tmp_path, monkeypatch):
    a, _ = users
    async with client() as c:
        jobs = [await make_job(c, a, frames=1) for _ in range(cv.MAX_ACTIVE_JOBS)]
        r = await c.post("/carousel-video/jobs", json={"fps": 12, "width": 64, "height": 64, "frames": 1}, headers=bearer(a))
        assert r.status_code == 409 and r.json()["detail"]["code"] == "busy"
        import os, time
        old = time.time() - cv.JOB_TTL_SECONDS - 60
        os.utime(tmp_path / "carousel_video" / str(a.id) / jobs[0], (old, old))
        await make_job(c, a, frames=1)                                                                   # the abandoned one was removed, so there is room again
        assert not (tmp_path / "carousel_video" / str(a.id) / jobs[0]).exists()


async def test_the_total_size_of_a_job_is_capped(users, monkeypatch):
    a, _ = users
    monkeypatch.setattr(cv, "MAX_JOB_BYTES", 3000)
    async with client() as c:
        job = await make_job(c, a, frames=50)
        big = jpeg((10, 20, 30), size=(200, 200))
        r = await c.put(f"/carousel-video/jobs/{job}/frames", params={"start": 0}, content=pack([big] * 6), headers=bearer(a))
        assert r.status_code == 413


async def test_an_ffmpeg_failure_is_reported_plainly_and_the_job_stays_usable(users, monkeypatch):
    a, _ = users
    real_ffmpeg = ffmpeg_svc.FFMPEG_BIN
    monkeypatch.setattr(ffmpeg_svc, "FFMPEG_BIN", "definitely-not-ffmpeg-xyz")
    async with client() as c:
        job = await make_job(c, a, frames=2)
        await c.put(f"/carousel-video/jobs/{job}/frames", params={"start": 0}, content=pack([jpeg((1, 2, 3)), jpeg((3, 2, 1))]), headers=bearer(a))
        r = await c.post(f"/carousel-video/jobs/{job}/render", headers=bearer(a))
        assert r.status_code == 503 and "not available" in r.text
        monkeypatch.setattr(ffmpeg_svc, "FFMPEG_BIN", real_ffmpeg)
        r = await c.post(f"/carousel-video/jobs/{job}/render", headers=bearer(a))                       # and once FFmpeg is back the same job encodes
        assert r.status_code == 200 and r.json()["status"] == "done"
