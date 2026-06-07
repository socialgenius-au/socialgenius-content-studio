"""Local Whisper transcription — runs in a thread pool to avoid blocking the event loop."""
import asyncio
import re
from concurrent.futures import ThreadPoolExecutor

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="whisper")
_model = None
_lock = asyncio.Lock()


async def _get_model():
    global _model
    if _model is None:
        async with _lock:
            if _model is None:
                import whisper  # type: ignore[import]
                loop = asyncio.get_event_loop()
                _model = await loop.run_in_executor(_executor, lambda: whisper.load_model("base"))
    return _model


async def transcribe(file_path: str, language: str | None = None) -> dict:
    """Return {text, segments, language, duration} dict from Whisper."""
    model = await _get_model()
    kwargs = {"fp16": False}
    if language:
        kwargs["language"] = language

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, lambda: model.transcribe(file_path, **kwargs))
    return {
        "text": result["text"].strip(),
        "segments": [
            {
                "id": s["id"],
                "start": round(s["start"], 2),
                "end": round(s["end"], 2),
                "text": s["text"].strip(),
            }
            for s in result.get("segments", [])
        ],
        "language": result.get("language", "en"),
    }


def segments_to_srt(segments: list[dict]) -> str:
    """Convert Whisper segments to SRT subtitle format."""
    lines = []
    for i, seg in enumerate(segments, 1):
        start = _fmt_time(seg["start"])
        end = _fmt_time(seg["end"])
        lines.append(f"{i}\n{start} --> {end}\n{seg['text']}\n")
    return "\n".join(lines)


def _fmt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
