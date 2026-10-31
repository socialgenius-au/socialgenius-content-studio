"""
C1 — router tests for POST /deconstruct-all, GET /deconstruct-all/status and GET /deconstruction/full.
Same real-database, direct-router-call convention as test_stage10_deconstruction_router.py. The 19
stage runners are recording fakes (no ffmpeg/OCR/Whisper/Anthropic); the background task launcher is
replaced with a spy so no real task is spawned.
"""
import pytest
from fastapi import HTTPException, Response
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.routers.reference_videos import deconstruct_all, get_deconstruct_all_status, get_full_deconstruction
from app.schemas.deconstruction_full import DeconstructionFullResponse
from app.services import deconstruction_orchestrator_svc as orch
from app.services.deconstruction_orchestrator_svc import STAGES
from tests.test_deconstruction_orchestrator_svc import (  # noqa: F401 -- fixtures + helpers
    _existing_test_user, ai_off, ai_on, cleanup, fake_runners, make_reference,
)

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def test_all_three_endpoints_return_404_for_an_unknown_reference_video():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        for call in (
            lambda: deconstruct_all(reference_video_id=999_999_999, response=Response(), db=db, user=user),
            lambda: get_deconstruct_all_status(reference_video_id=999_999_999, db=db, user=user),
            lambda: get_full_deconstruction(reference_video_id=999_999_999, db=db, user=user),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await call()
            assert exc_info.value.status_code == 404


async def test_wait_true_runs_inline_and_returns_200_with_every_stage_status(monkeypatch, ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            calls = []
            monkeypatch.setattr(orch, "default_runners", lambda: fake_runners(calls))
            response = Response()
            result = await deconstruct_all(reference_video_id=rv_id, response=response, wait=True, db=db, user=user)

            assert response.status_code == 200
            assert result.mode == "inline" and result.overall_status == "complete"
            assert result.video_analysis_id == va_id
            assert [s.key for s in result.stages] == [s.key for s in STAGES]
            assert {s.status for s in result.stages} == {"complete"}
            assert calls == [s.key for s in STAGES]
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_default_mode_claims_starts_the_background_run_and_returns_202_running(monkeypatch, ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            started = []
            monkeypatch.setattr("app.routers.reference_videos.start_background_deconstruction",
                                lambda user_id, rv, **kw: started.append((user_id, rv, kw)))
            result = await deconstruct_all(reference_video_id=rv_id, response=Response(), db=db, user=user)

            assert result.mode == "background" and result.overall_status == "running"
            assert result.orchestration["status"] == "running"
            assert started == [(user.id, rv_id, {"force_ai": False})]
            assert {s.status for s in result.stages} == {"not_run"}  # nothing has executed yet

            # The run is claimed, so a second click is refused instead of double-processing.
            with pytest.raises(HTTPException) as exc_info:
                await deconstruct_all(reference_video_id=rv_id, response=Response(), db=db, user=user)
            assert exc_info.value.status_code == 409
            assert len(started) == 1
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_status_endpoint_reports_progress_after_a_run(monkeypatch, ai_off):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            monkeypatch.setattr(orch, "default_runners", lambda: fake_runners([]))
            await deconstruct_all(reference_video_id=rv_id, response=Response(), wait=True, db=db, user=user)

            status = await get_deconstruct_all_status(reference_video_id=rv_id, db=db, user=user)
            by_key = {s["key"]: s for s in status["stages"]}
            assert status["orchestration"]["status"] == "complete"
            assert by_key["retention_devices"]["status"] == "skipped"  # AI not configured -> skipped, not failed
            assert by_key["editing_rhythm"]["status"] == "complete"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_full_endpoint_returns_a_schema_valid_structure_before_and_after_a_run(monkeypatch, ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            before = await get_full_deconstruction(reference_video_id=rv_id, db=db, user=user)
            DeconstructionFullResponse.model_validate(before)
            assert before["orchestration"] is None

            monkeypatch.setattr(orch, "default_runners", lambda: fake_runners([]))
            await deconstruct_all(reference_video_id=rv_id, response=Response(), wait=True, db=db, user=user)
            after = await get_full_deconstruction(reference_video_id=rv_id, db=db, user=user)
            DeconstructionFullResponse.model_validate(after)
            assert after["orchestration"]["status"] == "complete"
            assert after["video_analysis"]["id"] == va_id
            assert {s["status"] for s in after["stages"]} == {"complete"}

            # A wrong pinned analysis id is a 404, never a silent fallback to latest.
            with pytest.raises(HTTPException) as exc_info:
                await get_full_deconstruction(reference_video_id=rv_id, video_analysis_id=999_999_999, db=db, user=user)
            assert exc_info.value.status_code == 404
        finally:
            await cleanup(db, asset_id, rv_id)
