"""Background music in animated carousel exports (MP4): the REAL FFmpeg mixes a generated tone into the video and the result is measured.

Covers: an MP4 with an AAC track of the right length; volume, offset (silence before the music starts), trim and fades measurably change the sound; GIFs stay silent; and the guard rails
(only the user's own AUDIO file, a file with no audio is refused, bad trim / volume values are refused).
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
from app.models.asset import Asset
from app.models.user import User
from app.routers import carousel_video as cv
from app.services import ffmpeg_svc
from app.services.auth import create_token

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
            u = User(username=f"au_{secrets.token_hex(4)}", email=f"au_{secrets.token_hex(4)}@example.test", hashed_password="x", role="editor", is_active=True)
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


async def _db():
    async with Session() as db:
        yield db


def client():
    app = FastAPI()
    app.include_router(cv.router, prefix="/carousel-video")
    app.dependency_overrides[get_db] = _db
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=180)


def jpeg(color):
    b = io.BytesIO()
    Image.new("RGB", (64, 80), color).save(b, "JPEG", quality=80)
    return b.getvalue()


def pack(frames):
    return b"".join(struct.pack(">I", len(f)) + f for f in frames)


def tone(path, seconds=4, freq=440):
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}:sample_rate=44100", str(path)], check=True)


async def make_asset(user, path, file_type="audio"):
    async with Session() as db:
        a = Asset(user_id=user.id, original_filename=path.name, stored_filename=path.name, file_path=str(path), file_type=file_type, mime_type="audio/wav", file_size=path.stat().st_size)
        db.add(a)
        await db.commit()
        await db.refresh(a)
        return a


async def render(c, u, audio, frames=24, fps=12, fmt="mp4"):
    body = {"fps": fps, "width": 64, "height": 80, "frames": frames, "format": fmt}
    if audio is not None:
        body["audio"] = audio
    r = await c.post("/carousel-video/jobs", json=body, headers=bearer(u))
    if r.status_code != 201:
        return r, None
    job = r.json()["job_id"]
    await c.put(f"/carousel-video/jobs/{job}/frames", params={"start": 0}, content=pack([jpeg((i * 9 % 255, 80, 160)) for i in range(frames)]), headers=bearer(u))
    r = await c.post(f"/carousel-video/jobs/{job}/render", headers=bearer(u))
    assert r.status_code == 200, r.text
    d = await c.get(f"/carousel-video/jobs/{job}/download", headers=bearer(u))
    await c.delete(f"/carousel-video/jobs/{job}", headers=bearer(u))          # the app keeps at most two exports in progress per user
    return r, d.content


def info(path):
    err = subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    dur = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", err)
    return {"audio": "Audio: aac" in err, "video": "Video: h264" in err, "duration": int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + float(dur.group(3))}


def mean_volume(path, start=None, length=None):
    cmd = [ffmpeg_svc.FFMPEG_BIN, "-hide_banner"]
    if start is not None:
        cmd += ["-ss", str(start)]
    if length is not None:
        cmd += ["-t", str(length)]
    cmd += ["-i", str(path), "-vn", "-af", "volumedetect", "-f", "null", "-"]
    err = subprocess.run(cmd, capture_output=True, text=True).stderr
    m = re.search(r"mean_volume: (-?[\d.]+|-inf) dB", err)
    return -200.0 if (m is None or m.group(1) == "-inf") else float(m.group(1))


async def test_an_mp4_gets_an_aac_track_the_length_of_the_video_and_the_controls_change_the_sound(users, tmp_path):
    a, _ = users
    wav = tmp_path / "tone.wav"
    tone(wav, seconds=6)
    asset = await make_asset(a, wav)
    spec = lambda **k: {"asset_id": asset.id, **k}
    async with client() as c:
        _, plain = await render(c, a, None)
        (tmp_path / "plain.mp4").write_bytes(plain)
        assert info(tmp_path / "plain.mp4")["audio"] is False                                          # no music asked for: no audio track

        _, loud = await render(c, a, spec())                                                         # 24 frames at 12 fps = 2 s
        (tmp_path / "loud.mp4").write_bytes(loud)
        i = info(tmp_path / "loud.mp4")
        assert i["audio"] and i["video"] and abs(i["duration"] - 2.0) < 0.2                          # the 6 s tone is cut to the video

        _, quiet = await render(c, a, spec(volume=0.25))
        (tmp_path / "quiet.mp4").write_bytes(quiet)
        assert mean_volume(tmp_path / "loud.mp4") - mean_volume(tmp_path / "quiet.mp4") > 8           # 0.25x is about 12 dB quieter

        _, late = await render(c, a, spec(offset_ms=1000))                                           # music starts 1 s in
        (tmp_path / "late.mp4").write_bytes(late)
        assert mean_volume(tmp_path / "late.mp4", 0, 0.8) < -60                                       # silent before it starts...
        assert mean_volume(tmp_path / "late.mp4", 1.2, 0.6) > -30                                     # ...and playing after

        _, faded = await render(c, a, spec(fade_in_ms=1500))
        (tmp_path / "faded.mp4").write_bytes(faded)
        assert mean_volume(tmp_path / "faded.mp4", 0, 0.4) < mean_volume(tmp_path / "loud.mp4", 0, 0.4) - 6   # fading in: the start is much quieter

        _, outro = await render(c, a, spec(fade_out_ms=1500))
        (tmp_path / "outro.mp4").write_bytes(outro)
        assert mean_volume(tmp_path / "outro.mp4", 1.6, 0.4) < mean_volume(tmp_path / "loud.mp4", 1.6, 0.4) - 6   # fading out: the end is much quieter

        _, trimmed = await render(c, a, spec(trim_start_ms=500, trim_end_ms=1000))                  # only 0.5 s of music, then silence
        (tmp_path / "trim.mp4").write_bytes(trimmed)
        assert mean_volume(tmp_path / "trim.mp4", 0.1, 0.3) > -30 and mean_volume(tmp_path / "trim.mp4", 1.0, 0.8) < -60


async def test_a_gif_stays_silent_even_when_music_is_requested(users, tmp_path):
    a, _ = users
    wav = tmp_path / "tone.wav"
    tone(wav)
    asset = await make_asset(a, wav)
    async with client() as c:
        r, gif = await render(c, a, {"asset_id": asset.id}, frames=6, fps=10, fmt="gif")
        assert r.json()["format"] == "gif" and gif[:3] == b"GIF"


async def test_only_your_own_audio_files_with_real_audio_and_sane_settings_are_accepted(users, tmp_path):
    a, b = users
    wav = tmp_path / "tone.wav"
    tone(wav)
    mine, theirs = await make_asset(a, wav), await make_asset(b, wav)
    image_asset = await make_asset(a, wav, file_type="image")
    junk = tmp_path / "junk.mp3"
    junk.write_bytes(b"this is not audio at all" * 50)
    broken = await make_asset(a, junk)
    base = {"fps": 12, "width": 64, "height": 80, "frames": 12}
    async with client() as c:
        h = bearer(a)
        for audio, needle in [({"asset_id": theirs.id}, "audio file"), ({"asset_id": image_asset.id}, "audio file"), ({"asset_id": 99999999}, "audio file"), ({"asset_id": broken.id}, "no audio"),
                              ({"asset_id": mine.id, "trim_start_ms": 5000, "trim_end_ms": 1000}, "after its start")]:
            r = await c.post("/carousel-video/jobs", json={**base, "audio": audio}, headers=h)
            assert r.status_code == 422 and needle in r.text, (audio, r.text)
        for audio in [{"asset_id": mine.id, "volume": 3}, {"asset_id": mine.id, "volume": -1}, {"asset_id": mine.id, "fade_in_ms": -5}, {"asset_id": mine.id, "offset_ms": 10 ** 9}, {"asset_id": 0}]:
            assert (await c.post("/carousel-video/jobs", json={**base, "audio": audio}, headers=h)).status_code == 422
        assert (await c.post("/carousel-video/jobs", json={**base, "audio": {"asset_id": mine.id}}, headers=h)).status_code == 201       # and the valid one is fine


def test_the_audio_filter_clamps_fades_to_what_is_heard_and_places_the_music_on_the_timeline():
    spec = {"asset_id": 1, "trim_start_ms": 1000, "trim_end_ms": 4000, "offset_ms": 500, "volume": 0.5, "fade_in_ms": 10_000, "fade_out_ms": 1000}
    f = cv._audio_filter(spec, 10.0)
    assert f.startswith("atrim=start=1.000:end=4.000,asetpts=PTS-STARTPTS,volume=0.500")
    assert "afade=t=in:st=0:d=3.000" in f and "afade=t=out:st=2.000:d=1.000" in f                    # 3 s heard: the 10 s fade-in is cut to 3 s, the fade-out starts 1 s before the end
    assert "adelay=500:all=1" in f and f.endswith("apad=whole_dur=10.000")
    short = cv._audio_filter({**spec, "offset_ms": 9500, "trim_end_ms": 0}, 10.0)                       # only 0.5 s of video left after the music starts
    assert "afade=t=out:st=0.000:d=0.500" in short
