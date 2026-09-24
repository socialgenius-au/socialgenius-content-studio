"""
Stage 11.4 — Retention classification orchestration tests (candidate generation -> per-candidate
evidence assembly -> reasoner -> durable attempt -> ACCEPTANCE GATE -> atomic retention_device
replace). Real-database convention; the reasoner call itself is mocked at the
retention_classification_svc module boundary (patch.object on the name as imported there), matching
test_hook_classification_svc.py's own convention exactly. No real Anthropic call in this file.

Stage 11.4 acceptance-gate correction: a candidate is not itself a retention device. Every examined
candidate gets a durable reasoning attempt regardless of outcome; only candidates whose decision
carries is_retention_device=True enter the effective retention_device set.
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


async def _make_analysis_with_n_cuts(db, user, n, duration=None):
    """n well-separated Shot cuts -> exactly n independent candidates."""
    duration = duration if duration is not None else (n + 1) * 30.0
    asset = Asset(
        user_id=user.id, original_filename="retention_classify_mixed_test.mp4", stored_filename="retention_classify_mixed_test_stored.mp4",
        file_path="uploads/retention_classify_mixed_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()
    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
    db.add(va)
    await db.commit()
    edges = [i * 30.0 for i in range(n + 2)]
    for i in range(n + 1):
        db.add(Shot(video_analysis_id=va.id, scene_id=None, order=i, start_time=edges[i], end_time=edges[i + 1],
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


def _result(device_type="visual_change", is_retention_device=False, probable_attention_function=None,
            confidence="medium", reasoning="factual reasoning"):
    return RetentionResult(
        decision=RetentionDecision(
            is_retention_device=is_retention_device, device_type=device_type,
            confidence=confidence, reasoning=reasoning,
            probable_attention_function=probable_attention_function, evidence_references={},
        ),
        provider="anthropic", model="claude-sonnet-5", reasoning_contract_version="v3",
    )


def _ordinary_cut():
    """The canonical 'examined but not accepted' outcome: a real structural event, honestly
    labeled, with no accepted attention function."""
    return _result("visual_change", is_retention_device=False,
                    reasoning="An ordinary shot cut with no other supporting signal -- this is routine editing.")


def _accepted_device():
    return _result("scene_switch", is_retention_device=True, probable_attention_function="renew_attention",
                    reasoning="A scene change coincides with a materially new headline appearing -- this moment appears designed to renew attention.")


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
            assert result == {"candidates_examined": 0, "devices": []}
        finally:
            await _cleanup(db, asset.id, rv.id)


# ---------------------------------------------------------------------------
# Section 9 required fixtures.
# ---------------------------------------------------------------------------

async def test_ordinary_cut_examined_but_not_accepted():
    """Candidate generated, reasoner concludes ordinary structural event, attempt persisted, no
    retention_device created."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_ordinary_cut())):
                result = await classify_and_persist_retention_devices(db, va_id)

            assert result["candidates_examined"] == 2
            assert result["devices"] == []

            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert len(attempts) == 2
            assert all(a.details["is_retention_device"] is False for a in attempts)
            assert all(a.details["device_type"] == "visual_change" for a in attempts)
            assert all(a.details["probable_attention_function"] is None for a in attempts)

            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_ordinary_scene_change_examined_but_not_accepted():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            ordinary_scene_change = _result("scene_switch", is_retention_device=False,
                                             reasoning="The scene changed -- an ordinary structural transition with no other distinguishing signal.")
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=ordinary_scene_change)):
                result = await classify_and_persist_retention_devices(db, va_id)
            assert result["devices"] == []
            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert all(a.details["device_type"] == "scene_switch" and a.details["is_retention_device"] is False for a in attempts)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_unclear_candidate_attempt_persisted_no_effective_device():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            unclear = _result("unclear", is_retention_device=False, confidence="low",
                               reasoning="The evidence is too sparse to even confidently identify the structural form.")
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=unclear)):
                result = await classify_and_persist_retention_devices(db, va_id)
            assert result["devices"] == []
            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert len(attempts) == 2
            assert all(a.details["device_type"] == "unclear" for a in attempts)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_genuine_attention_management_event_is_accepted_and_persisted():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_accepted_device())):
                result = await classify_and_persist_retention_devices(db, va_id)

            assert len(result["devices"]) == 2
            for device in result["devices"]:
                assert device["device_type"] == "scene_switch"
                assert device["probable_attention_function"] == "renew_attention"
                assert device["reasoning_attempt_id"] is not None

            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            assert len(rows) == 2
            assert all(r.details["probable_attention_function"] == "renew_attention" for r in rows)
            assert all(r.certainty == "INFERRED" for r in rows)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_mixed_run_ten_examined_three_accepted_seven_rejected():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_n_cuts(db, user, n=10)
        try:
            outcomes = [_accepted_device() if i < 3 else _ordinary_cut() for i in range(10)]
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(side_effect=outcomes)):
                result = await classify_and_persist_retention_devices(db, va_id)

            assert result["candidates_examined"] == 10
            assert len(result["devices"]) == 3

            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert len(attempts) == 10
            accepted_attempts = [a for a in attempts if a.details["is_retention_device"]]
            rejected_attempts = [a for a in attempts if not a.details["is_retention_device"]]
            assert len(accepted_attempts) == 3
            assert len(rejected_attempts) == 7

            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            assert len(rows) == 3
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
                               new=AsyncMock(side_effect=[_accepted_device(), RetentionReasoningError("prohibited claim detected")])):
                with pytest.raises(RetentionReasoningError):
                    await classify_and_persist_retention_devices(db, va_id)

            # The first candidate's attempt was durably persisted before the second one failed.
            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert len(attempts) == 1

            # No retention_device row was ever written -- the atomic replace never ran, even
            # though the first candidate alone WAS accepted.
            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_rerun_appends_attempts_but_atomically_replaces_accepted_device_set():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_accepted_device())):
                first = await classify_and_persist_retention_devices(db, va_id)
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_ordinary_cut())):
                second = await classify_and_persist_retention_devices(db, va_id)

            # Attempts: appended across both runs -- 2 candidates x 2 runs = 4, none deleted.
            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert len(attempts) == 4
            first_attempt_ids = {a.id for a in attempts[:2]}
            assert first_attempt_ids == {d["reasoning_attempt_id"] for d in first["devices"]}

            # Effective retention_device set: replaced, not accumulated -- the second run REJECTED
            # both candidates, so the accepted set from the first run must be atomically cleared,
            # never accumulated alongside the new (empty) outcome.
            assert len(first["devices"]) == 2
            assert second["devices"] == []
            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_rejected_candidates_never_accumulate_as_effective_devices_across_reruns():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            for _ in range(3):
                with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_ordinary_cut())):
                    await classify_and_persist_retention_devices(db, va_id)

            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert len(attempts) == 6  # 2 candidates x 3 reruns, all rejected

            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_device_row_references_its_producing_attempt():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_two_cuts(db, user)
        try:
            with patch.object(retention_classification_svc, "classify_retention_candidate", new=AsyncMock(return_value=_accepted_device())):
                await classify_and_persist_retention_devices(db, va_id)

            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == RETENTION_DEVICE_CATEGORY,
            ))).scalars().all())
            attempts = {a.id for a in await load_retention_reasoning_attempts(db, va_id)}
            for row in rows:
                assert row.details["reasoning_attempt_id"] in attempts
        finally:
            await _cleanup(db, asset_id, rv_id)
