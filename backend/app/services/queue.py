"""ARQ job queue with graceful BackgroundTasks fallback when Redis is not configured."""
from __future__ import annotations

from typing import TYPE_CHECKING

from app.config import settings

if TYPE_CHECKING:
    from arq import ArqRedis

_pool: "ArqRedis | None" = None


async def _get_pool() -> "ArqRedis":
    global _pool
    from arq import create_pool
    from arq.connections import RedisSettings

    if _pool is None:
        _pool = await create_pool(
            RedisSettings.from_dsn(settings.REDIS_URL or "redis://localhost:6379"),
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def enqueue_execute_job(job_id: int, user_id: int) -> str | None:
    """Enqueue job execution via ARQ. Returns ARQ job ID or None on error."""
    pool = await _get_pool()
    arq_job = await pool.enqueue_job(
        "execute_job",
        job_id,
        user_id,
        _queue_name="socialgenius",
    )
    return arq_job.job_id if arq_job else None
