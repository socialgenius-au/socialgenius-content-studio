"""
Stage 11.3 — Hook evidence bundle assembly tests. Real-database convention (same as
test_story_beat_construction_svc.py's own docstring). No LLM/Anthropic call anywhere in this file.
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.hook_evidence_assembly_svc import HookEvidenceAssemblyError, assemble_hook_evidence_bundle
from app.services.hook_window_svc import derive_and_persist_hook_window

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_analysis(db, user, duration=30.0):
    asset = Asset(
        user_id=user.id, original_filename="stage11_3_evidence_test.mp4", stored_filename="stage11_3_evidence_test_stored.mp4",
        file_path="uploads/stage11_3_evidence_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()
    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
    db.add(va)
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


async def test_no_hook_window_yet_raises():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            with pytest.raises(HookEvidenceAssemblyError):
                await assemble_hook_evidence_bundle(db, va_id)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_evidence_outside_hook_window_is_excluded():
    """Required fixture (Section 11): evidence outside the Hook Window must never appear in the
    bundle, even though it belongs to the same VideoAnalysis."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=0, start_time=0.0, end_time=3.0,
                        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            await db.commit()
            await derive_and_persist_hook_window(db, va_id)  # first Shot end (3.0s) -> hook window [0,3.0]

            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=1.0, end_time=2.0,
                                  text="inside the hook window", certainty="MEASURED", source="whisper"))
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=20.0, end_time=21.0,
                                  text="far outside the hook window", certainty="MEASURED", source="whisper"))
            await db.commit()

            bundle = await assemble_hook_evidence_bundle(db, va_id)
            texts = [s["text"] for s in bundle["speech_segments"]]
            assert "inside the hook window" in texts
            assert "far outside the hook window" not in texts
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_no_transcript_but_visual_and_text_evidence_present():
    """Required fixture (Section 11): a Hook Window with no SpeechSegment at all, but real
    on-screen text -- the bundle must still be useful, never empty just because transcript is
    absent."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=0, start_time=0.0, end_time=4.0,
                        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            await db.commit()
            await derive_and_persist_hook_window(db, va_id)

            db.add(TextElement(video_analysis_id=va_id, shot_id=None, text="LIMITED TIME OFFER",
                                x=0.1, y=0.1, width=0.5, height=0.2, start_time=0.5, end_time=3.5,
                                certainty="MEASURED", source="easyocr"))
            await db.commit()

            bundle = await assemble_hook_evidence_bundle(db, va_id)
            assert bundle["speech_segments"] == []
            assert len(bundle["text_elements"]) == 1
            assert bundle["text_elements"][0]["text"] == "LIMITED TIME OFFER"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_provenance_hook_window_id_present_and_ids_traceable():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=0, start_time=0.0, end_time=3.0,
                        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            await db.commit()
            await derive_and_persist_hook_window(db, va_id)

            speech = SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=0.5, end_time=2.0,
                                    text="hello", certainty="MEASURED", source="whisper")
            db.add(speech)
            await db.commit()

            bundle = await assemble_hook_evidence_bundle(db, va_id)
            assert bundle["hook_window"]["hook_window_id"] is not None
            assert bundle["speech_segments"][0]["id"] == speech.id
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_not_found_raises():
    async with _TestSessionLocal() as db:
        with pytest.raises(HookEvidenceAssemblyError):
            await assemble_hook_evidence_bundle(db, 999_999_999)
