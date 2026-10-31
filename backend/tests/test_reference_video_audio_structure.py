"""
Video Deconstructor — Stage 7 (Audio / Speech / Transcript), Phase D router/pass tests.

Same real-database, direct-router-call, no-HTTP-client convention as
test_reference_video_speech.py's own docstring — `audio_structure_svc.analyze_audio_structure`
is mocked exactly the same way `speech_analysis_svc.analyze_speech` is mocked there, so these
tests never run a real ffmpeg subprocess or touch a real media file.

Covers the 14 requested checks: 1 (successful detection persists silence annotations), 2 (exact
timing preserved), 3 (category/provenance correct), 4 (confidence NULL), 5 (no-silence completes
with zero rows), 6 (no-audio completes honestly), 7 (failure marks pass failed), 8 (failed run
leaves no partial rows), 9 (retry succeeds), 10 (repeated success does not duplicate), 11
(annotations not forced into Shots), 12 (speech_segments unaffected), 13 (Stage 3-6 response
unaffected), 14 (Unicode/other unrelated fields unaffected — verified via an unrelated TextElement
fixture surviving byte-for-byte).
"""
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.routers.reference_videos import AUDIO_STRUCTURE_PASS_NAME, analyze_reference_video_audio_structure
from app.services import audio_structure_svc

# Same real-database, no-Alembic, NullPool-engine convention every other router test file in this
# suite already established (see test_reference_video_speech.py's own docstring) — small helpers
# duplicated here rather than cross-imported, matching this project's own established convention
# (e.g. test_learn.py/test_reference_video_ingestion.py each define their own equivalent helpers).
_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, duration: float = 10.0) -> tuple[int, int, int]:
    """A ReferenceVideo with a VideoAnalysis whose technical_probe pass is already complete —
    the sole prerequisite this pass needs (see analyze_reference_video_audio_structure's own
    docstring)."""
    asset = Asset(
        user_id=user.id, original_filename="stage7_audio_structure_test.mp4",
        stored_filename="stage7_audio_structure_test_stored.mp4",
        file_path="uploads/stage7_audio_structure_test.mp4", file_type="video",
        mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()

    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()

    va = VideoAnalysis(
        reference_video_id=rv.id, status="complete",
        pass_status={"technical_probe": "complete"},
    )
    db.add(va)
    await db.flush()

    await db.commit()
    return rv.id, asset.id, va.id


async def _cleanup(db, asset_id: int, reference_video_id: int | None):
    if reference_video_id is not None:
        rv = await db.get(ReferenceVideo, reference_video_id)
        if rv:
            await db.delete(rv)  # cascades VideoAnalysis -> AnalysisAnnotation/SpeechSegment/etc.
            await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


def _mocked_audio_result(**overrides) -> dict:
    base = {
        "audio_stream_present": True,
        "media_duration": 10.0,
        "silence_intervals": [
            {"start_time": 0.0, "end_time": 1.5, "duration": 1.5},
            {"start_time": 5.0, "end_time": 6.2, "duration": 1.2},
        ],
        "detector": "ffmpeg_silencedetect",
        "noise_threshold_db": -40.0,
        "minimum_duration_seconds": 0.5,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# 1/2/3/4. Successful detection persists correctly-mapped, evidence-based annotations.
# ---------------------------------------------------------------------------

async def test_successful_detection_persists_correctly_mapped_silence_annotations():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            with patch.object(audio_structure_svc, "analyze_audio_structure", new=AsyncMock(return_value=_mocked_audio_result())):
                response = await analyze_reference_video_audio_structure(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["audio_structure"] == "complete"
            assert response.latest_analysis.status == "complete"
            assert response.audio_structure is not None
            assert response.audio_structure.audio_stream_present is True
            assert response.audio_structure.silence_count == 2
            assert len(response.audio_structure.silence_intervals) == 2

            first, second = response.audio_structure.silence_intervals
            assert first.start_time == 0.0 and first.end_time == 1.5
            assert second.start_time == 5.0 and second.end_time == 6.2

            for interval in response.audio_structure.silence_intervals:
                assert interval.certainty == "MEASURED"
                assert interval.confidence_score is None
                assert interval.source == "ffmpeg"
                assert interval.produced_by_pass == AUDIO_STRUCTURE_PASS_NAME
                assert interval.details["detector"] == "ffmpeg_silencedetect"
                assert interval.details["noise_threshold_db"] == -40.0

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "audio_silence",
            ))).scalars().all()
            assert len(rows) == 2
            assert all(r.confidence_score is None for r in rows)
            assert all(r.shot_id is None for r in rows)  # 11: never forced into a Shot
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 5. No silence detected: pass complete, zero rows, not failed.
# ---------------------------------------------------------------------------

async def test_no_silence_completes_successfully_with_zero_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            no_silence_result = _mocked_audio_result(silence_intervals=[])
            with patch.object(audio_structure_svc, "analyze_audio_structure", new=AsyncMock(return_value=no_silence_result)):
                response = await analyze_reference_video_audio_structure(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["audio_structure"] == "complete"
            assert response.latest_analysis.error is None
            assert response.audio_structure.audio_stream_present is True
            assert response.audio_structure.silence_count == 0
            assert response.audio_structure.silence_intervals == []

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "audio_silence",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 6. No audio stream at all: pass complete, honest audio_stream_present=False.
# ---------------------------------------------------------------------------

async def test_no_audio_stream_completes_honestly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            no_audio_result = _mocked_audio_result(audio_stream_present=False, silence_intervals=[])
            with patch.object(audio_structure_svc, "analyze_audio_structure", new=AsyncMock(return_value=no_audio_result)):
                response = await analyze_reference_video_audio_structure(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["audio_structure"] == "complete"
            assert response.latest_analysis.pass_status["audio_structure_audio_present"] is False
            assert response.audio_structure.audio_stream_present is False
            assert response.audio_structure.silence_intervals == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 7/8/9. A genuine failure fails the pass honestly, leaves no orphan rows, retry succeeds.
# ---------------------------------------------------------------------------

async def test_genuine_failure_fails_pass_with_no_orphan_rows_then_retry_succeeds():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            with patch.object(audio_structure_svc, "analyze_audio_structure", new=AsyncMock(side_effect=RuntimeError("Could not read media for audio-structure analysis"))):
                failed_response = await analyze_reference_video_audio_structure(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["audio_structure"] == "failed"
            assert failed_response.latest_analysis.status == "complete"
            assert "Could not read media" in failed_response.latest_analysis.error
            assert failed_response.audio_structure is None  # pass never completed

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "audio_silence",
            ))).scalars().all()
            assert rows == []

            with patch.object(audio_structure_svc, "analyze_audio_structure", new=AsyncMock(return_value=_mocked_audio_result())):
                retried = await analyze_reference_video_audio_structure(reference_video_id=rv_id, db=db, user=user)

            assert retried.latest_analysis.pass_status["audio_structure"] == "complete"
            assert retried.latest_analysis.id == va_id
            assert retried.audio_structure.silence_count == 2

            rows_after_retry = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "audio_silence",
            ))).scalars().all()
            assert len(rows_after_retry) == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 10. Repeated successful call is idempotent — never duplicates annotations.
# ---------------------------------------------------------------------------

async def test_repeated_successful_call_does_not_duplicate_annotations():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            mock_analyze = AsyncMock(return_value=_mocked_audio_result())
            with patch.object(audio_structure_svc, "analyze_audio_structure", new=mock_analyze):
                first = await analyze_reference_video_audio_structure(reference_video_id=rv_id, db=db, user=user)
                second = await analyze_reference_video_audio_structure(reference_video_id=rv_id, db=db, user=user)

            assert mock_analyze.await_count == 1
            assert [i.id for i in first.audio_structure.silence_intervals] == [i.id for i in second.audio_structure.silence_intervals]

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "audio_silence",
            ))).scalars().all()
            assert len(rows) == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Prerequisite gating: technical_probe must be complete first. Deliberately NOT gated on
# speech_analysis — the two Stage 7 passes are independent.
# ---------------------------------------------------------------------------

async def test_rejected_before_technical_probe_completes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        asset = Asset(
            user_id=user.id, original_filename="not_probed.mp4", stored_filename="not_probed_stored.mp4",
            file_path="uploads/not_probed.mp4", file_type="video", mime_type="video/mp4", file_size=10,
        )
        db.add(asset)
        await db.flush()
        rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload")
        db.add(rv)
        await db.flush()
        va = VideoAnalysis(reference_video_id=rv.id)
        db.add(va)
        await db.commit()
        rv_id, asset_id_ = rv.id, asset.id
        try:
            with pytest.raises(HTTPException) as exc_info:
                await analyze_reference_video_audio_structure(reference_video_id=rv_id, db=db, user=user)
            assert exc_info.value.status_code == 409
        finally:
            await _cleanup(db, asset_id_, rv_id)


async def test_audio_structure_does_not_require_speech_analysis_complete():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            # speech_analysis was never run on this VideoAnalysis (pass_status has no such key) —
            # audio-structure analysis must succeed anyway.
            va = await db.get(VideoAnalysis, va_id)
            assert "speech_analysis" not in (va.pass_status or {})

            with patch.object(audio_structure_svc, "analyze_audio_structure", new=AsyncMock(return_value=_mocked_audio_result())):
                response = await analyze_reference_video_audio_structure(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["audio_structure"] == "complete"
            assert response.speech_segments == []  # 12: speech_segments genuinely unaffected/absent
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 12/13/14. speech_segments and existing Stage 3-6 data (and Unicode text) are unaffected.
# ---------------------------------------------------------------------------

async def test_speech_segments_and_stage_3_through_6_data_are_unaffected():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            before_rv = await db.get(ReferenceVideo, rv_id)
            before_snapshot = (before_rv.duration, before_rv.width, before_rv.height, before_rv.technical_details)

            scene = Scene(video_analysis_id=va_id, order=0, start_time=0.0, end_time=10.0, certainty="MEASURED")
            db.add(scene)
            await db.flush()
            shot = Shot(scene_id=scene.id, video_analysis_id=va_id, order=0, start_time=0.0, end_time=10.0, certainty="MEASURED")
            db.add(shot)
            await db.flush()
            mixed_text = "यह एक परीक्षण है — this is a test — هذا اختبار"
            text_el = TextElement(
                video_analysis_id=va_id, shot_id=shot.id, text=mixed_text, x=0.1, y=0.1, width=0.2, height=0.1,
                start_time=1.0, end_time=1.0, certainty="MEASURED", confidence_score=0.9,
            )
            db.add(text_el)
            speech_seg = SpeechSegment(
                video_analysis_id=va_id, shot_id=None, start_time=0.0, end_time=1.0,
                text="pre-existing speech segment", certainty="MEASURED",
            )
            db.add(speech_seg)
            await db.commit()

            before_shot_id, before_text_id, before_speech_id = shot.id, text_el.id, speech_seg.id
            before_text_snapshot = (text_el.text, text_el.x, text_el.confidence_score, text_el.certainty)

            with patch.object(audio_structure_svc, "analyze_audio_structure", new=AsyncMock(return_value=_mocked_audio_result())):
                response = await analyze_reference_video_audio_structure(reference_video_id=rv_id, db=db, user=user)

            after_rv = await db.get(ReferenceVideo, rv_id)
            after_snapshot = (after_rv.duration, after_rv.width, after_rv.height, after_rv.technical_details)
            assert before_snapshot == after_snapshot

            after_text = await db.get(TextElement, before_text_id)
            assert (after_text.text, after_text.x, after_text.confidence_score, after_text.certainty) == before_text_snapshot
            assert after_text.text == mixed_text  # 14: Unicode text unaffected

            after_speech = await db.get(SpeechSegment, before_speech_id)
            assert after_speech.text == "pre-existing speech segment"
            assert after_speech.shot_id is None

            # 12: the response's own speech_segments list still reflects the pre-existing row,
            # completely unaffected by this audio-structure pass.
            assert len(response.speech_segments) == 1
            assert response.speech_segments[0].text == "pre-existing speech segment"

            after_shot = await db.get(Shot, before_shot_id)
            assert after_shot.start_time == 0.0 and after_shot.end_time == 10.0
        finally:
            await _cleanup(db, asset_id, rv_id)
