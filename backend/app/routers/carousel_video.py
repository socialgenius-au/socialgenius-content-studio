"""Animated carousel export: frames in, MP4 / GIF out, encoded by the existing FFmpeg.

The browser renders every frame of the carousel's timeline itself (the same drawing code as the editor and the static exports, so transitions and element animations look exactly as
previewed) and sends them here as JPEGs. This router only stores them briefly, runs FFmpeg with FIXED arguments, and hands back the finished file. Nothing is kept in the database or in the
media library, and nothing is run that the client can choose.

  POST   /carousel-video/jobs                       {fps, width, height, frames, format} -> {job_id}
  PUT    /carousel-video/jobs/{id}/frames?start=N    body: repeated [4-byte big-endian length][JPEG]; frames must arrive in order
  POST   /carousel-video/jobs/{id}/render            runs FFmpeg
  GET    /carousel-video/jobs/{id}/download          the finished MP4 / GIF
  DELETE /carousel-video/jobs/{id}                   removes everything

Safety: a job id is an unguessable hex string living under a folder named for the signed-in user (another user's job looks like it does not exist); every limit below is enforced before
disk is used; frame files must really be JPEGs; at most MAX_ACTIVE_JOBS per user and one encode at a time on the server; abandoned jobs are removed after JOB_TTL_SECONDS.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import struct
import tempfile
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.deps import current_user
from app.models.user import User
from app.services import ffmpeg_svc

router = APIRouter()

MAX_FRAMES = 20_000
MAX_DIMENSION = 4096
MAX_FPS = 60
MAX_FRAME_BYTES = 4 * 1024 * 1024
MAX_REQUEST_BYTES = 64 * 1024 * 1024
MAX_JOB_BYTES = 1_500_000_000
MAX_ACTIVE_JOBS = 2
JOB_TTL_SECONDS = 2 * 60 * 60
ENCODE_TIMEOUT_SECONDS = 900
JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_encode_lock = asyncio.Semaphore(1)


class JobCreate(BaseModel):
    fps: int = Field(ge=1, le=MAX_FPS)
    width: int = Field(ge=2, le=MAX_DIMENSION)
    height: int = Field(ge=2, le=MAX_DIMENSION)
    frames: int = Field(ge=1, le=MAX_FRAMES)
    format: Literal["mp4", "gif"] = "mp4"


class JobCreated(BaseModel):
    job_id: str


class FramesAccepted(BaseModel):
    received: int
    next_frame: int


class Rendered(BaseModel):
    status: str
    size: int
    format: str


def _root(user: User) -> Path:
    return Path(tempfile.gettempdir()) / "carousel_video" / str(user.id)


def _job_dir(user: User, job_id: str) -> Path:
    if not JOB_ID_RE.match(job_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video job not found")
    d = _root(user) / job_id
    if not (d / "meta.json").is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video job not found")
    return d


def _read(d: Path) -> dict:
    return json.loads((d / "meta.json").read_text(encoding="utf8"))


def _write(d: Path, meta: dict) -> None:
    (d / "meta.json").write_text(json.dumps(meta), encoding="utf8")


def _prune(root: Path) -> list[Path]:
    """Removes abandoned jobs; returns the live ones."""
    live: list[Path] = []
    if not root.is_dir():
        return live
    now = time.time()
    for d in root.iterdir():
        if not d.is_dir():
            continue
        try:
            age = now - d.stat().st_mtime
        except OSError:
            continue
        if age > JOB_TTL_SECONDS:
            shutil.rmtree(d, ignore_errors=True)
        else:
            live.append(d)
    return live


@router.post("/jobs", response_model=JobCreated, status_code=status.HTTP_201_CREATED)
async def create_job(body: JobCreate, user: User = Depends(current_user)):
    if body.width % 2 or body.height % 2:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Video width and height must be even numbers.")
    root = _root(user)
    root.mkdir(parents=True, exist_ok=True)
    if len(_prune(root)) >= MAX_ACTIVE_JOBS:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "busy", "message": "You already have video exports in progress. Wait for them to finish or cancel them, then try again."})
    job_id = uuid.uuid4().hex
    d = root / job_id
    d.mkdir()
    _write(d, {"fps": body.fps, "width": body.width, "height": body.height, "frames": body.frames, "format": body.format, "next": 0, "bytes": 0, "state": "receiving"})
    return JobCreated(job_id=job_id)


@router.put("/jobs/{job_id}/frames", response_model=FramesAccepted)
async def put_frames(job_id: str, request: Request, start: int, user: User = Depends(current_user)):
    d = _job_dir(user, job_id)
    meta = _read(d)
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_REQUEST_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Send fewer frames per request.")
    if meta["state"] != "receiving":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This video job is no longer accepting frames.")
    if start != meta["next"]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "out_of_order", "message": f"Expected frame {meta['next']}, got {start}.", "next_frame": meta["next"]})
    data = await request.body()
    if len(data) > MAX_REQUEST_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Send fewer frames per request.")
    pos, n, total = 0, meta["next"], meta["bytes"]
    pending: list[tuple[int, bytes]] = []
    while pos < len(data):
        if pos + 4 > len(data):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Truncated frame data.")
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        pos += 4
        if length < 4 or length > MAX_FRAME_BYTES or pos + length > len(data):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A frame has an invalid size.")
        frame = data[pos:pos + length]
        pos += length
        if not frame.startswith(b"\xff\xd8\xff"):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Every frame must be a JPEG image.")
        if n >= meta["frames"]:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="More frames than the job declared.")
        total += length
        if total > MAX_JOB_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="This video is too large to export. Use a smaller size or a lower frame rate.")
        pending.append((n, frame))
        n += 1
    for idx, frame in pending:                       # nothing is written unless the whole batch was valid
        (d / f"frame_{idx:06d}.jpg").write_bytes(frame)
    meta["next"], meta["bytes"] = n, total
    _write(d, meta)
    return FramesAccepted(received=len(pending), next_frame=n)


def _encode_args(meta: dict, d: Path, out: Path) -> list[str]:
    src = str(d / "frame_%06d.jpg")
    if meta["format"] == "gif":
        fps = min(meta["fps"], 15)
        return [ffmpeg_svc.FFMPEG_BIN, "-y", "-framerate", str(meta["fps"]), "-i", src, "-vf", f"fps={fps},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", str(out)]
    return [ffmpeg_svc.FFMPEG_BIN, "-y", "-framerate", str(meta["fps"]), "-i", src, "-vf", "scale=in_range=pc:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart", str(out)]   # JPEG frames are full-range: convert to the standard limited-range yuv420p every player expects


@router.post("/jobs/{job_id}/render", response_model=Rendered)
async def render(job_id: str, user: User = Depends(current_user)):
    d = _job_dir(user, job_id)
    meta = _read(d)
    if meta["state"] == "done":
        out = d / f"out.{meta['format']}"
        return Rendered(status="done", size=out.stat().st_size, format=meta["format"])
    if meta["next"] != meta["frames"]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "incomplete", "message": f"Only {meta['next']} of {meta['frames']} frames arrived."})
    meta["state"] = "encoding"
    _write(d, meta)
    out = d / f"out.{meta['format']}"
    async with _encode_lock:                         # one encode at a time: FFmpeg is the heavy part of the server
        try:
            proc = await asyncio.create_subprocess_exec(*_encode_args(meta, d, out), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        except OSError:
            meta["state"] = "receiving"
            _write(d, meta)
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Video encoding is not available on this server.")
        try:
            _, err = await asyncio.wait_for(proc.communicate(), timeout=ENCODE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            meta["state"] = "receiving"
            _write(d, meta)
            raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Encoding took too long. Try a shorter video, a smaller size or a lower frame rate.")
    if proc.returncode != 0 or not out.is_file() or out.stat().st_size == 0:
        meta["state"] = "receiving"
        _write(d, meta)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="The server could not encode the video.")
    for f in d.glob("frame_*.jpg"):                  # the frames are no longer needed once the file exists
        f.unlink(missing_ok=True)
    meta["state"] = "done"
    _write(d, meta)
    return Rendered(status="done", size=out.stat().st_size, format=meta["format"])


@router.get("/jobs/{job_id}/download")
async def download(job_id: str, user: User = Depends(current_user)):
    d = _job_dir(user, job_id)
    meta = _read(d)
    out = d / f"out.{meta['format']}"
    if meta["state"] != "done" or not out.is_file():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The video is not ready yet.")
    return FileResponse(out, media_type="video/mp4" if meta["format"] == "mp4" else "image/gif", filename=f"carousel.{meta['format']}")


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(job_id: str, user: User = Depends(current_user)):
    d = _job_dir(user, job_id)
    shutil.rmtree(d, ignore_errors=True)
