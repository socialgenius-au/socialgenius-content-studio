"""
Video Deconstructor — Stage 7 (Audio / Speech / Transcript), Phase C router/pass tests.

Same real-database, direct-router-call, no-HTTP-client testing convention every other Stage 6
router test file already established (see test_reference_video_text.py's own docstring for the
shared rationale) — `speech_analysis_svc.analyze_speech` (Stage 7 Phase B) is mocked exactly the
same way `ocr_svc.detect_text_in_frame` is mocked in
test_forced_failure_leaves_no_orphaned_files_then_retries_cleanly, so these tests never load a
real Whisper model or touch a real media file — real end-to-end validation is a separate,
one-off manual check (see the implementation report), not part of this automated suite.

Covers the 14 requested checks: 1 (mocked analysis creates SpeechSegment rows), 2 (timing/text/
language mapping), 3 (raw diagnostics preserved), 4 (confidence_score NULL), 5 (speaker_label
NULL), 6 (certainty/provenance fields), 7 (empty/no-speech -> complete, zero rows, not failed),
8 (genuine Phase B failure -> failed, no orphan rows), 9 (retry after failure succeeds cleanly),
10 (repeated successful request does not duplicate), 11 (Unicode text round-trips), 12
(SpeechSegments never assigned to a Shot), 13 (missing/failing source media fails honestly), 14
(existing Stage 3-6 data is unchanged).
"""
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.shot_frame import ShotFrame
from app.models.speech_segment import SpeechSegment
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.routers.reference_videos import SPEECH_ANALYSIS_PASS_NAME, analyze_reference_video_speech
from app.services import speech_analysis_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, duration: float = 10.0) -> tuple[int, int, int]:
    """A ReferenceVideo with a VideoAnalysis whose technical_probe pass is already complete —
    Stage 7's own sole prerequisite (see analyze_reference_video_speech's own docstring for why
    it does not wait on Stage 4/5/6). No Shot/ShotFrame/TextElement fixture rows are created here
    — most tests below don't need them; the one test that does builds its own."""
    asset = Asset(
        user_id=user.id, original_filename="stage7_speech_test.mp4",
        stored_filename="stage7_speech_test_stored.mp4",
        file_path="uploads/stage7_speech_test.mp4", file_type="video",
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
            await db.delete(rv)  # cascades VideoAnalysis -> SpeechSegment/Shot/etc.
            await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


def _mocked_speech_result(**overrides) -> dict:
    base = {
        "full_text": "hello there, this is a test.",
        "detected_language": "en",
        "model_used": "base",
        "segments": [
            {"start_time": 0.0, "end_time": 1.5, "text": "hello there,",
             "analysis_details": {"avg_logprob": -0.2, "no_speech_prob": 0.01, "compression_ratio": 1.3, "temperature": 0.0}},
            {"start_time": 1.5, "end_time": 3.0, "text": "this is a test.",
             "analysis_details": {"avg_logprob": -0.35, "no_speech_prob": 0.02, "compression_ratio": 1.1, "temperature": 0.0}},
        ],
        "analysis_metadata": {"engine": "whisper", "model_used": "base", "language_requested": None},
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# 1/2/3/4/5/6. A successful mocked analysis creates correctly-mapped SpeechSegment rows.
# ---------------------------------------------------------------------------

async def test_successful_analysis_creates_correctly_mapped_speech_segments():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            with patch.object(speech_analysis_svc, "analyze_speech", new=AsyncMock(return_value=_mocked_speech_result())):
                response = await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["speech_analysis"] == "complete"
            assert response.latest_analysis.status == "complete"
            assert len(response.speech_segments) == 2

            first, second = response.speech_segments
            assert first.start_time == 0.0 and first.end_time == 1.5
            assert first.text == "hello there,"
            assert second.start_time == 1.5 and second.end_time == 3.0
            assert second.text == "this is a test."

            for seg in response.speech_segments:
                assert seg.language == "en"  # 4/2: detected language mapped onto every segment
                assert seg.certainty == "MEASURED"  # 6: direct-extraction certainty, never invented
                assert seg.confidence_score is None  # 4: never fabricated
                assert seg.speaker_label is None  # 5: no diarization yet
                assert seg.source == "whisper"
                assert seg.produced_by_pass == SPEECH_ANALYSIS_PASS_NAME

            # 3: raw diagnostics preserved verbatim.
            assert first.analysis_details == {"avg_logprob": -0.2, "no_speech_prob": 0.01, "compression_ratio": 1.3, "temperature": 0.0}
            assert second.analysis_details == {"avg_logprob": -0.35, "no_speech_prob": 0.02, "compression_ratio": 1.1, "temperature": 0.0}

            # Confirm directly against the DB too, not just the API response shape.
            rows = (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().all()
            assert len(rows) == 2
            assert all(r.confidence_score is None for r in rows)
            assert all(r.speaker_label is None for r in rows)
            assert all(r.certainty == "MEASURED" for r in rows)
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 7. Empty/no-speech result: pass becomes complete, zero rows, never failed.
# ---------------------------------------------------------------------------

async def test_no_speech_result_completes_successfully_with_zero_segments():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            empty_result = _mocked_speech_result(full_text="", segments=[])
            with patch.object(speech_analysis_svc, "analyze_speech", new=AsyncMock(return_value=empty_result)):
                response = await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["speech_analysis"] == "complete"
            assert response.latest_analysis.status == "complete"
            assert response.latest_analysis.error is None
            assert response.speech_segments == []

            rows = (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 8/9. A genuine Phase B failure fails the pass honestly, leaves no orphan rows, and a
#      subsequent retry succeeds cleanly.
# ---------------------------------------------------------------------------

async def test_genuine_failure_fails_pass_with_no_orphan_rows_then_retry_succeeds():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            with patch.object(speech_analysis_svc, "analyze_speech", new=AsyncMock(side_effect=RuntimeError("Failed to decode media for speech analysis: no such file"))):
                failed_response = await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["speech_analysis"] == "failed"
            assert failed_response.latest_analysis.status == "complete"  # last good checkpoint intact, not "failed" overall
            assert "Failed to decode media" in failed_response.latest_analysis.error
            assert failed_response.speech_segments == []

            rows = (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().all()
            assert rows == []  # no partial/orphan rows from the failed attempt

            # Retry, no failure this time — must succeed IN PLACE (same VideoAnalysis id).
            with patch.object(speech_analysis_svc, "analyze_speech", new=AsyncMock(return_value=_mocked_speech_result())):
                retried = await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)

            assert retried.latest_analysis.pass_status["speech_analysis"] == "complete"
            assert retried.latest_analysis.id == va_id  # same row, no duplicate VideoAnalysis version
            assert len(retried.speech_segments) == 2

            rows_after_retry = (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().all()
            assert len(rows_after_retry) == 2  # exactly the fresh set, nothing duplicated from the failed attempt
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 10. A repeated successful call is idempotent — never duplicates segments.
# ---------------------------------------------------------------------------

async def test_repeated_successful_call_does_not_duplicate_segments():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            mock_analyze = AsyncMock(return_value=_mocked_speech_result())
            with patch.object(speech_analysis_svc, "analyze_speech", new=mock_analyze):
                first = await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)
                second = await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)

            assert mock_analyze.await_count == 1  # idempotent early-return — never re-ran the analysis
            assert len(first.speech_segments) == 2
            assert [s.id for s in first.speech_segments] == [s.id for s in second.speech_segments]

            rows = (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().all()
            assert len(rows) == 2  # never duplicated
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 11. Unicode speech text round-trips exactly.
# ---------------------------------------------------------------------------

async def test_unicode_speech_text_round_trips():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            mixed_text = "यह एक परीक्षण है — this is a test — هذا اختبار"
            result = _mocked_speech_result(
                full_text=mixed_text, detected_language="hi",
                segments=[{"start_time": 0.0, "end_time": 3.0, "text": mixed_text, "analysis_details": {}}],
            )
            with patch.object(speech_analysis_svc, "analyze_speech", new=AsyncMock(return_value=result)):
                response = await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)

            assert response.speech_segments[0].text == mixed_text
            assert response.speech_segments[0].language == "hi"

            row = (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().one()
            assert row.text == mixed_text
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 12. SpeechSegments are never artificially assigned to a Shot.
# ---------------------------------------------------------------------------

async def test_speech_segments_are_never_assigned_to_a_shot():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            # A real Shot exists on this same VideoAnalysis — proves Stage 7 doesn't reach for it
            # even when one is available, not merely that it's absent.
            scene = Scene(video_analysis_id=va_id, order=0, start_time=0.0, end_time=10.0, certainty="MEASURED")
            db.add(scene)
            await db.flush()
            shot = Shot(scene_id=scene.id, video_analysis_id=va_id, order=0, start_time=0.0, end_time=10.0, certainty="MEASURED")
            db.add(shot)
            await db.commit()

            with patch.object(speech_analysis_svc, "analyze_speech", new=AsyncMock(return_value=_mocked_speech_result())):
                await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)

            rows = (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().all()
            assert len(rows) == 2
            assert all(r.shot_id is None for r in rows)  # never forced onto the existing Shot
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 13. Missing/failing source media fails honestly (via the real Phase B error shape).
# ---------------------------------------------------------------------------

async def test_missing_source_media_fails_honestly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            # The exact error shape Phase B's own _decode_audio_to_array raises for a genuinely
            # missing/unreadable file (see speech_analysis_svc.py) — mocked here rather than
            # actually invoking a real Whisper model load + real ffmpeg subprocess, but the
            # message text is the real one, not an invented placeholder.
            with patch.object(speech_analysis_svc, "analyze_speech", new=AsyncMock(
                side_effect=RuntimeError("Could not run the bundled ffmpeg executable for speech analysis: file not found")
            )):
                response = await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["speech_analysis"] == "failed"
            assert "Could not run the bundled ffmpeg executable" in response.latest_analysis.error
            assert response.speech_segments == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Prerequisite gating: technical_probe must be complete first.
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
        va = VideoAnalysis(reference_video_id=rv.id)  # status defaults to "pending", no pass_status yet
        db.add(va)
        await db.commit()
        rv_id, asset_id_ = rv.id, asset.id
        try:
            with pytest.raises(HTTPException) as exc_info:
                await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)
            assert exc_info.value.status_code == 409
        finally:
            await _cleanup(db, asset_id_, rv_id)


# ---------------------------------------------------------------------------
# 14. Existing Stage 3-6 data is completely unchanged by a Stage 7 pass.
# ---------------------------------------------------------------------------

async def test_existing_stage_3_through_6_data_is_unchanged():
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
            text_el = TextElement(
                video_analysis_id=va_id, shot_id=shot.id, text="SALE", x=0.1, y=0.1, width=0.2, height=0.1,
                start_time=1.0, end_time=1.0, certainty="MEASURED", confidence_score=0.9,
            )
            db.add(text_el)
            annotation = AnalysisAnnotation(
                video_analysis_id=va_id, shot_id=None, category="audio", start_time=0.0, end_time=1.0,
                certainty="OBSERVED",
            )
            db.add(annotation)
            await db.commit()

            before_shot_id, before_text_id, before_annotation_id = shot.id, text_el.id, annotation.id
            before_shot_span = (shot.start_time, shot.end_time, shot.certainty)
            before_text_snapshot = (text_el.text, text_el.x, text_el.confidence_score, text_el.certainty)
            before_annotation_snapshot = (annotation.category, annotation.certainty)

            with patch.object(speech_analysis_svc, "analyze_speech", new=AsyncMock(return_value=_mocked_speech_result())):
                await analyze_reference_video_speech(reference_video_id=rv_id, db=db, user=user)

            after_rv = await db.get(ReferenceVideo, rv_id)
            after_snapshot = (after_rv.duration, after_rv.width, after_rv.height, after_rv.technical_details)
            assert before_snapshot == after_snapshot

            after_shot = await db.get(Shot, before_shot_id)
            assert (after_shot.start_time, after_shot.end_time, after_shot.certainty) == before_shot_span

            after_text = await db.get(TextElement, before_text_id)
            assert (after_text.text, after_text.x, after_text.confidence_score, after_text.certainty) == before_text_snapshot

            after_annotation = await db.get(AnalysisAnnotation, before_annotation_id)
            assert (after_annotation.category, after_annotation.certainty) == before_annotation_snapshot

            # No ShotFrame was ever created — Stage 7 doesn't touch that table either.
            frames = (await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == va_id))).scalars().all()
            assert frames == []
        finally:
            await _cleanup(db, asset_id, rv_id)
