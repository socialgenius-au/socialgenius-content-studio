"""
Video Deconstructor — Stage 10 Application Access Checkpoint router tests.

Same real-database, direct-router-call, no-HTTP-client convention as
test_reference_video_audio_structure.py's own docstring. Covers the HTTP-facing concerns the
service-level test_stage10_deconstruction_svc.py suite does not: reference-video ownership/404,
and reasoning-failure -> 502 status mapping.
"""
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.routers.reference_videos import deconstruct_reference_video, get_reference_video_deconstruction
from app.services import stage10_deconstruction_svc
from app.services.semantic_reasoner.contract import SemanticReasoningError
from tests.test_stage10_deconstruction_svc import _accepting_beat_reasoner, _accepting_scene_reasoner

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_ready_reference(db, user, duration=30.0):
    asset = Asset(
        user_id=user.id, original_filename="stage10_router_test.mp4", stored_filename="stage10_router_test_stored.mp4",
        file_path="uploads/stage10_router_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()
    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
    db.add(va)
    await db.flush()
    db.add(Shot(video_analysis_id=va.id, scene_id=None, order=0, start_time=0.0, end_time=15.0,
                certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
    db.add(Shot(video_analysis_id=va.id, scene_id=None, order=1, start_time=15.0, end_time=30.0,
                certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
    await db.commit()
    return rv.id, asset.id, va.id


async def _cleanup(db, asset_id, rv_id):
    rv = await db.get(ReferenceVideo, rv_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


async def test_deconstruct_unknown_reference_video_is_404():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        with pytest.raises(HTTPException) as exc_info:
            await deconstruct_reference_video(reference_video_id=999_999_999, db=db, user=user)
        assert exc_info.value.status_code == 404


async def test_read_unknown_reference_video_is_404():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        with pytest.raises(HTTPException) as exc_info:
            await get_reference_video_deconstruction(reference_video_id=999_999_999, db=db, user=user)
        assert exc_info.value.status_code == 404


async def test_run_then_read_through_the_router_returns_the_constructed_scenes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            with patch.object(stage10_deconstruction_svc, "reason_about_boundary", new=AsyncMock(side_effect=_accepting_scene_reasoner)), \
                 patch.object(stage10_deconstruction_svc, "reason_about_story_beat_boundary", new=AsyncMock(side_effect=_accepting_beat_reasoner)):
                run_response = await deconstruct_reference_video(reference_video_id=rv_id, db=db, user=user)

            assert run_response.scenes_count == 2
            assert run_response.story_beats_count == 2

            read_response = await get_reference_video_deconstruction(reference_video_id=rv_id, db=db, user=user)
            assert read_response["reference_video_id"] == rv_id
            assert len(read_response["scenes"]) == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_reasoning_configuration_error_maps_to_502():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            with patch.object(
                stage10_deconstruction_svc, "reason_about_boundary",
                new=AsyncMock(side_effect=SemanticReasoningError("no reasoner configured")),
            ):
                with pytest.raises(HTTPException) as exc_info:
                    await deconstruct_reference_video(reference_video_id=rv_id, db=db, user=user)
                assert exc_info.value.status_code == 502
        finally:
            await _cleanup(db, asset_id, rv_id)
