"""Builds what the AI is shown: a small, bounded set of keyframes (downscaled) and the measured evidence that goes with them. Pure selection logic plus one image-preparation step.

No frame is ever invented or substituted: a frame whose file is missing is left out and reported as a limitation; if no frame at all can be read, nothing is sent to the AI.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
from pathlib import Path
from typing import Awaitable, Callable

MAX_SPEECH_TEXT = 300
MAX_OCR_TEXT = 120
MAX_SPEECH_ITEMS = 40
MAX_OCR_ITEMS = 60


def select_frames(frames: list[dict], max_frames: int) -> list[dict]:
    """`frames`: [{id, shot_order, timestamp, ...}]. One frame per shot first (the middle one), so every shot is seen; the first shot (the hook) is then given extra frames before any other,
    then the remaining shots round-robin, until `max_frames`. Result is in time order. Deterministic."""
    if max_frames <= 0 or not frames:
        return []
    by_shot: dict[int, list[dict]] = {}
    for f in sorted(frames, key=lambda f: (f["shot_order"], f["timestamp"])):
        by_shot.setdefault(f["shot_order"], []).append(f)
    shot_orders = sorted(by_shot)
    chosen: list[dict] = []
    left: dict[int, list[dict]] = {}
    for so in shot_orders:
        fs = by_shot[so]
        mid = fs[len(fs) // 2]
        chosen.append(mid)
        left[so] = [f for f in fs if f["id"] != mid["id"]]
    # extra frames: the hook shot first (up to two more), then round-robin
    order = [shot_orders[0]] * 2 + shot_orders
    for so in order:
        if len(chosen) >= max_frames:
            break
        if left.get(so):
            chosen.append(left[so].pop(0))
    if len(chosen) > max_frames:                                   # more shots than frames allowed: keep an even spread across time
        step = len(chosen) / max_frames
        chosen = [sorted(chosen, key=lambda f: f["timestamp"])[int(i * step)] for i in range(max_frames)]
    return sorted(chosen, key=lambda f: (f["timestamp"], f["id"]))


def build_input(evidence: dict, *, max_frames: int) -> dict:
    """`evidence` is the reference video's evidence as a plain dict (ReferenceVideoResponse.model_dump). Returns the bounded input: video facts, shots, selected frames (with file paths),
    speech and on-screen text with their ids and confidences, and a fingerprint of exactly what is being asked about."""
    shots = sorted(evidence.get("shots") or [], key=lambda s: s["order"])
    td = evidence.get("technical_details") or {}
    duration = ((td.get("container") or {}).get("duration_seconds")) or (shots[-1]["end_time"] if shots else None)
    all_frames, ocr = [], []
    for s in shots:
        for f in s.get("frames") or []:
            all_frames.append({"id": f["id"], "shot_order": s["order"], "timestamp": f["timestamp"], "path": f["asset_file_path"], "width": f.get("width"), "height": f.get("height")})
        for t in s.get("text_elements") or []:
            ocr.append({"id": t["id"], "shot_order": s["order"], "text": (t.get("text") or "")[:MAX_OCR_TEXT], "confidence": t.get("confidence_score")})
    selected = select_frames(all_frames, max_frames)
    sel_ids_by_shot: dict[int, list[int]] = {}
    for f in selected:
        sel_ids_by_shot.setdefault(f["shot_order"], []).append(f["id"])
    speech = [{"id": sp["id"], "start": sp["start_time"], "end": sp["end_time"], "text": (sp.get("text") or "")[:MAX_SPEECH_TEXT], "language": sp.get("language"), "confidence": sp.get("confidence_score")}
              for sp in (evidence.get("speech_segments") or [])][:MAX_SPEECH_ITEMS]
    out = {
        "video": {"duration_seconds": duration, "shot_count": len(shots)},
        "shots": [{"order": s["order"], "start": s["start_time"], "end": s["end_time"], "frame_ids": sel_ids_by_shot.get(s["order"], [])} for s in shots],
        "frames": selected,
        "speech": speech,
        "text": ocr[:MAX_OCR_ITEMS],
        "dropped": {"frames": len(all_frames) - len(selected), "ocr": max(0, len(ocr) - MAX_OCR_ITEMS), "speech": max(0, len(evidence.get("speech_segments") or []) - MAX_SPEECH_ITEMS)},
    }
    out["fingerprint"] = hashlib.sha256(json.dumps({k: out[k] for k in ("video", "shots", "speech", "text")} | {"frame_ids": [f["id"] for f in selected]}, sort_keys=True, default=str).encode()).hexdigest()
    return out


Runner = Callable[[str, int], Awaitable[bytes]]


async def _ffmpeg_jpeg(path: str, width: int) -> bytes:
    from app.services.ffmpeg_svc import FFMPEG_BIN
    proc = await asyncio.create_subprocess_exec(
        FFMPEG_BIN, "-v", "error", "-i", path, "-vf", f"scale='min({width},iw)':-2", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "5", "pipe:1",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate()
    if proc.returncode != 0 or not out:
        raise RuntimeError(err.decode("utf-8", "replace")[-200:] or "ffmpeg produced no image")
    return out


async def load_images(prepared: dict, width: int, runner: Runner | None = None) -> tuple[list[dict], list[str]]:
    """Reads each selected frame from disk and downsizes it to a JPEG of `width` pixels. Returns ([{frame_id, shot_order, timestamp, media_type, data}], limitations).
    A frame that is missing or unreadable is skipped and reported; nothing is fabricated."""
    run = runner or _ffmpeg_jpeg
    images, notes = [], []
    for f in prepared["frames"]:
        p = f["path"]
        if not p or not Path(p).is_file():
            notes.append(f"Frame {f['id']} (shot {f['shot_order']}, {f['timestamp']:.1f}s) is no longer on the server and was not shown.")
            continue
        try:
            data = await run(p, width)
        except Exception as exc:                          # noqa: BLE001
            notes.append(f"Frame {f['id']} could not be read ({type(exc).__name__}) and was not shown.")
            continue
        images.append({"frame_id": f["id"], "shot_order": f["shot_order"], "timestamp": f["timestamp"], "media_type": "image/jpeg", "data": base64.b64encode(data).decode("ascii")})
    return images, notes
