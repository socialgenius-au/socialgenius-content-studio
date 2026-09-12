"""
Stage 11.4 — Retention classification orchestration tests (candidate generation -> per-candidate
evidence assembly -> reasoner -> durable attempt -> atomic retention_device replace). Real-database
convention; the reasoner call itself is mocked at the retention_classification_svc module boundary
(patch.object on the name as imported there), matching test_hook_classification_svc.py's own
convention exactly. No real Anthropic call in this file.
"""
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services import retention_classification_svc
from app.services.retention_classification_svc import (
    RETENTION_DEVICE_CATEGORY, RetentionClassificationError, classify_and_persist_retention_devices,
)
from app.services.retention_reasoner.contract import RetentionDecision, RetentionReasoningError, RetentionResult
from app.services.retention_reasoning_store_svc import load_retention_reasoning_attempts

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_analysis_with_two_cuts(db, user, duration=60.0):
    """Two well-separated Shot cuts -> exactly two independent candidates."""
    asset = Asset(
        user_id=user.id, original_filename="retention_classify_test.mp4", stored_filename="retention_classify_test_stored.mp4",
        file_path="uploads/retention_classify_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()
    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
    db.add(va)
    await db.commit()
    for i, (start, end) in enumerate([(0.0, 10.0), (10.0, 40.0), (40.0, 60.0)]):
        db.add(Shot(video_analysis_id=va.id, scene_id=None, order=i, start_time=start, end_time=end,
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


def _result(device_type="visual_change", confidence="medium", reasoning="factual reasoning"):
    return RetentionResult(
        decision=RetentionDecision(device_type=device_type, confidence=confidence, reasoning=reasoning, evidence_references={}),
        provider="anthropic", model="claude-sonnet-5", reasoning_contract_version="v1",
    )


async def test_not_found_raises():
    async with _TestSessionLocal() as db:
        with pytest.raises(RetentionClassificationError):
            await classify_and_persist_retention_devices(db, 999_999_999)


async def test_zero_candidates_yields_zero_devices_no_error():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        asset = Asset(user_id=user.id, original_filename="empty.mp4", stored_filename="empty_stored.mp4",
                       file_path="uploads/empty.mp4", file_type="video", mime_type="video/mp4", file_size=1)
        db.add(asset)
        await db.flush()
        rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=5.0)
        db.add(rv)
        await db.flush()
        va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
        db.add(va)
        await db.commit()
        try:
            result = await classify_and_persist_retention_devices(db, va.id)
            assert result == {"candidates_considered": 0, "devices": []}
        finally:
            await _cleanup(db, asset.id, rv.id)


async def test_successful_run_persists_one_device_and_one_attempt_per_candidate():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_result("visual_change"))):
                result = await classify_and_persist_retention_devices(db, va_id)

            assert result["candidates_considered"] == 2
            assert len(result["devices"]) == 2
            for device in result["devices"]:
                assert device["device_type"] == "visual_change"
                assert device["reasoning_attempt_id"] is not None

            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            assert len(rows) == 2
            assert all(r.certainty == "INFERRED" for r in rows)

            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert len(attempts) == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_reasoner_error_stops_whole_run_and_touches_nothing_new():
    """A failure on ANY candidate stops the entire run (no partial device set is ever persisted) --
    the generalization of Hook's own 'a failed call stops everything below' discipline to a batch of
    many candidates. Attempts for candidates classified successfully BEFORE the failure remain
    durable; the effective retention_device set is left exactly as it was."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            with patch.object(retention_classification_svc, "classify_retention_candidate",
                               new=AsyncMock(side_effect=[_result("visual_change"), RetentionReasoningError("prohibited claim detected")])):
                with pytest.raises(RetentionReasoningError):
                    await classify_and_persist_retention_devices(db, va_id)

            # The first candidate's attempt was durably persisted before the second one failed.
            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert len(attempts) == 1

            # No retention_device row was ever written -- the atomic replace never ran.
            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_rerun_preserves_earlier_attempts_but_atomically_replaces_device_set():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_result("visual_change"))):
                first = await classify_and_persist_retention_devices(db, va_id)
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_result("pacing_change"))):
                second = await classify_and_persist_retention_devices(db, va_id)

            # Attempts: appended across both runs -- 2 candidates x 2 runs = 4, none deleted.
            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert len(attempts) == 4
            first_attempt_ids = {a.id for a in attempts[:2]}
            assert first_attempt_ids == {d["reasoning_attempt_id"] for d in first["devices"]}

            # Effective retention_device set: replaced, not accumulated -- still exactly 2 rows,
            # reflecting the SECOND (latest) run.
            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            assert len(rows) == 2
            assert all(r.details["device_type"] == "pacing_change" for r in rows)
            assert {r.details["reasoning_attempt_id"] for r in rows} == {d["reasoning_attempt_id"] for d in second["devices"]}
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_unclear_device_type_is_still_persisted_as_a_first_class_row():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_result("unclear", confidence="low"))):
                result = await classify_and_persist_retention_devices(db, va_id)
            assert all(d["device_type"] == "unclear" for d in result["devices"])

            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            assert len(rows) == 2  # never filtered out just because unclear
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_device_row_references_its_producing_attempt():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_result("visual_change"))):
                await classify_and_persist_retention_devices(db, va_id)

            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            attempts = {a.id for a in await load_retention_reasoning_attempts(db, va_id)}
            for row in rows:
                assert row.details["reasoning_attempt_id"] in attempts
        finally:
            await _cleanup(db, asset_id, rv_id)
