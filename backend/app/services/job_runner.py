"""Background job execution engine.

Walks a job's Claude-generated plan_json.steps and attempts to auto-execute
steps whose tool can run without additional parameters. Steps requiring
explicit user action are marked awaiting_manual with a clear note.
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.asset import Asset
from app.models.job import Job
from app.config import settings
from app.services.ws_manager import manager as ws_manager


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _has(key: str) -> bool:
    return bool(getattr(settings, key, None))


async def execute_job(job_id: int, user_id: int) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Job).where(Job.id == job_id, Job.user_id == user_id))
        job = result.scalar_one_or_none()
        if not job or not job.plan_json:
            return

        plan: dict[str, Any] = copy.deepcopy(job.plan_json)
        steps: list[dict] = plan.get("steps", [])

        # Stamp each step with exec tracking fields
        for step in steps:
            step.setdefault("exec_status", "pending")
            step.setdefault("exec_note", "")

        job.status = "running"
        job.plan_json = plan
        await db.commit()
        await ws_manager.broadcast(job_id, {"type": "status", "status": "running", "plan_json": plan})

        any_failed = False

        for step in steps:
            tool = step.get("tool", "manual")
            step["exec_status"] = "running"
            step["started_at"] = _now()
            job.plan_json = plan
            await db.commit()
            await ws_manager.broadcast(job_id, {"type": "step_update", "step": step, "plan_json": plan})

            try:
                await _run_step(db, step, tool, job_id, user_id, plan)
            except Exception as exc:
                step["exec_status"] = "failed"
                step["exec_note"] = str(exc)[:300]
                any_failed = True

            step.setdefault("exec_status", "done")
            step["finished_at"] = _now()
            job.plan_json = plan
            await db.commit()
            await ws_manager.broadcast(job_id, {"type": "step_update", "step": step, "plan_json": plan})

        job.status = "failed" if any_failed else "done"
        await db.commit()
        await ws_manager.broadcast(job_id, {"type": "status", "status": job.status, "plan_json": plan})


async def _run_step(db: Any, step: dict, tool: str, job_id: int, user_id: int, plan: dict) -> None:  # noqa: ARG001
    if tool == "manual":
        step["exec_status"] = "awaiting_manual"
        step["exec_note"] = "This step requires manual action."

    elif tool == "whisper":
        if not _has("ANTHROPIC_API_KEY"):  # proxy: if whisper is installed
            step["exec_status"] = "awaiting_manual"
            step["exec_note"] = "Whisper is available. Use POST /transcribe/{asset_id} with an uploaded audio/video asset."
            return

        asset_result = await db.execute(
            select(Asset)
            .where(Asset.job_id == job_id, Asset.file_type.in_(["audio", "video"]))
            .order_by(Asset.created_at.desc())
        )
        asset = asset_result.scalar_one_or_none()
        if not asset:
            step["exec_status"] = "skipped"
            step["exec_note"] = "No audio/video asset attached. Upload a file first, then use POST /transcribe/{asset_id}."
            return

        from app.services import whisper_svc
        result = await whisper_svc.transcribe(asset.file_path)
        step["exec_status"] = "done"
        step["exec_note"] = f"Transcribed {len(result.get('segments', []))} segments. Language: {result.get('language', '?')}."
        step["output"] = {"text_preview": result["text"][:300]}

    elif tool == "ffmpeg":
        asset_result = await db.execute(
            select(Asset)
            .where(Asset.job_id == job_id, Asset.file_type.in_(["audio", "video"]))
            .order_by(Asset.created_at.desc())
        )
        asset = asset_result.scalar_one_or_none()
        if not asset:
            step["exec_status"] = "awaiting_manual"
            step["exec_note"] = "No media asset. Upload a file then use POST /process with the desired operation."
        else:
            step["exec_status"] = "awaiting_manual"
            step["exec_note"] = f"Asset ready (id={asset.id}). Use POST /process to specify operation (extract_audio, resize, trim, add_subtitles, convert)."

    elif tool == "canva":
        if not _has("CANVA_CLIENT_ID"):
            step["exec_status"] = "skipped"
            step["exec_note"] = "CANVA_CLIENT_ID not configured. Use POST /canva/design when credentials are set."
        else:
            step["exec_status"] = "awaiting_manual"
            step["exec_note"] = "Use POST /canva/design to create a design from your brand template."

    elif tool == "beehiiv":
        if not _has("BEEHIIV_API_KEY"):
            step["exec_status"] = "skipped"
            step["exec_note"] = "BEEHIIV_API_KEY not configured. Use POST /publish/beehiiv when key is set."
        else:
            step["exec_status"] = "awaiting_manual"
            step["exec_note"] = "Use POST /publish/beehiiv with title and content_html to send the newsletter."

    elif tool == "gmb":
        if not _has("GMB_ACCESS_TOKEN"):
            step["exec_status"] = "skipped"
            step["exec_note"] = "GMB_ACCESS_TOKEN not configured. Use POST /publish/gmb when token is set."
        else:
            step["exec_status"] = "awaiting_manual"
            step["exec_note"] = "Use POST /publish/gmb with text content to post to Google Business Profile."

    elif tool == "apify":
        if not _has("APIFY_API_TOKEN"):
            step["exec_status"] = "skipped"
            step["exec_note"] = "APIFY_API_TOKEN not configured. Use POST /scrape with actor_id when token is set."
        else:
            step["exec_status"] = "awaiting_manual"
            step["exec_note"] = "Use POST /scrape with actor_id and input to run the Apify actor."

    elif tool == "pixabay":
        if not _has("PIXABAY_API_KEY"):
            step["exec_status"] = "skipped"
            step["exec_note"] = "PIXABAY_API_KEY not configured. Use GET /pixabay/search when key is set."
        else:
            from app.services import pixabay_svc
            query = step.get("action", plan.get("title", "content"))
            results = await pixabay_svc.search_images(query, per_page=5)
            step["exec_status"] = "done"
            step["exec_note"] = f"Found {results['total_hits']} images for '{query}'."
            step["output"] = {"preview_urls": [h.get("previewURL") for h in results["hits"][:3]]}

    else:
        step["exec_status"] = "done"
        step["exec_note"] = f"Tool '{tool}' — no automatic execution available."
