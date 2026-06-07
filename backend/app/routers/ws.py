import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.job import Job
from app.services.auth import decode_token
from app.services.ws_manager import manager

router = APIRouter()


@router.websocket("/jobs/{job_id}")
async def ws_job_updates(websocket: WebSocket, job_id: int) -> None:
    token = websocket.query_params.get("token", "")
    payload = decode_token(token)
    if not payload:
        await websocket.close(code=4001)
        return

    user_id = int(payload["sub"])

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Job).where(Job.id == job_id, Job.user_id == user_id))
        job = result.scalar_one_or_none()
        if not job:
            await websocket.close(code=4003)
            return

        await manager.connect(websocket, job_id)

        # Send current state on connect
        await websocket.send_json({
            "type": "init",
            "job_id": job_id,
            "status": job.status,
            "plan_json": job.plan_json,
        })

    try:
        while True:
            # Heartbeat every 25 s — keeps Railway/nginx from timing out the connection
            await asyncio.sleep(25)
            await websocket.send_json({"type": "ping"})
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        manager.disconnect(websocket, job_id)
