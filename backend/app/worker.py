"""ARQ background worker — run with: arq app.worker.WorkerSettings"""
from arq.connections import RedisSettings

from app.config import settings
from app.services.job_runner import execute_job as _execute_job


async def execute_job(ctx: dict, job_id: int, user_id: int) -> None:  # noqa: ARG001
    """ARQ task wrapper — ctx is injected by ARQ, forwarded args to job_runner."""
    await _execute_job(job_id, user_id)


class WorkerSettings:
    functions = [execute_job]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL or "redis://localhost:6379")
    max_jobs = 10
    job_timeout = 3600        # 1 hour max per job
    keep_result = 86400       # keep results for 24 h
    queue_name = "socialgenius"
