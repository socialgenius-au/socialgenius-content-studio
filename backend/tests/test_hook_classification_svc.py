"""
Stage 11.3 — Hook classification orchestration tests (assembly -> reasoner -> StrategicInsight
persistence). Real-database convention; the reasoner call itself is mocked at the
hook_classification_svc module boundary (patch.object on the name as imported there), matching how
this suite already mocks every other external-call boundary. No real Anthropic call in this file.
"""
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.strategic_insight import StrategicInsight
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services import hook_classification_svc
from app.services.hook_classification_svc import (
    HOOK_STRATEGIC_CATEGORY, HookClassificationError, classify_and_persist_hook,
)
from app.services.hook_reasoner.contract import HookDecision, HookElement, HookReasoningError, HookResult
from app.services.hook_window_svc import derive_and_persist_hook_window

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_ready_analysis(db, user, duration=10.0, shot_end=3.0):
    asset = Asset(
        user_id=user.id, original_filename="stage11_3_classify_test.mp4", stored_filename="stage11_3_classify_test_stored.mp4",
        file_path="uploads/stage11_3_classify_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()
    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
    db.add(va)
    await db.commit()
    db.add(Shot(video_analysis_id=va.id, scene_id=None, order=0, start_time=0.0, end_time=shot_end,
                certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
    await db.commit()
    await derive_and_persist_hook_window(db, va.id)  # locks a real Hook Window for these fixtures
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


def _result(primary_type, secondary_types=None, elements=None, intent=None, confidence="high", reasoning="factual reasoning"):
    return HookResult(
        decision=HookDecision(
            primary_type=primary_type, confidence=confidence, reasoning=reasoning,
            secondary_types=secondary_types or [], hook_elements=elements or [],
            probable_intent=intent, evidence_references={},
        ),
        provider="anthropic", model="claude-sonnet-4-20250514", reasoning_contract_version="v1",
    )


# ---------------------------------------------------------------------------
# Required fixtures — Section 11 of the brief.
# ---------------------------------------------------------------------------

async def test_clear_spoken_question_fixture():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_analysis(db, user)
        try:
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=0.2, end_time=2.8,
                                  text="have you ever wondered why some ads just work?", certainty="MEASURED", source="whisper"))
            await db.commit()
            speech = (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalar_one()

            mocked = _result("question", elements=[HookElement("spoken_question", {"supporting_speech_segment_ids": [speech.id]})], intent="create_curiosity")
            with patch.object(hook_classification_svc, "classify_hook", new=AsyncMock(return_value=mocked)):
                result = await classify_and_persist_hook(db, va_id)

            assert result["primary_type"] == "question"
            assert result["probable_intent"] == "create_curiosity"
            assert result["hook_elements"][0]["evidence_references"]["supporting_speech_segment_ids"] == [speech.id]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_clear_bold_claim_fixture():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_analysis(db, user)
        try:
            mocked = _result("bold_claim", intent="establish_credibility", confidence="medium")
            with patch.object(hook_classification_svc, "classify_hook", new=AsyncMock(return_value=mocked)):
                result = await classify_and_persist_hook(db, va_id)
            assert result["primary_type"] == "bold_claim"
            assert result["confidence"] == "medium"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_multimodal_hook_with_multiple_secondary_types_fixture():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_analysis(db, user)
        try:
            mocked = _result(
                "question", secondary_types=["direct_address", "curiosity_gap"],
                elements=[
                    HookElement("spoken_question", {"supporting_speech_segment_ids": [1]}),
                    HookElement("on_screen_text", {"supporting_text_element_ids": [2]}),
                    HookElement("face_to_camera", {"supporting_visual_object_ids": [3]}),
                ],
                intent="create_curiosity",
            )
            with patch.object(hook_classification_svc, "classify_hook", new=AsyncMock(return_value=mocked)):
                result = await classify_and_persist_hook(db, va_id)
            assert set(result["secondary_types"]) == {"direct_address", "curiosity_gap"}
            assert len(result["hook_elements"]) == 3
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_weak_insufficient_evidence_yields_unclear_fixture():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_analysis(db, user)
        try:
            mocked = _result("unclear", confidence="low", intent=None, reasoning="The available evidence is too sparse to indicate a recognizable pattern.")
            with patch.object(hook_classification_svc, "classify_hook", new=AsyncMock(return_value=mocked)):
                result = await classify_and_persist_hook(db, va_id)
            assert result["primary_type"] == "unclear"
            assert result["probable_intent"] is None
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_reasoner_error_propagates_uncaught():
    """A reasoner that raises (e.g. because it attempted a prohibited performance claim, already
    rejected at the provider layer) must propagate as HookReasoningError, never be swallowed or
    silently converted into a fabricated 'unclear' result."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_analysis(db, user)
        try:
            with patch.object(hook_classification_svc, "classify_hook", new=AsyncMock(side_effect=HookReasoningError("prohibited claim detected"))):
                with pytest.raises(HookReasoningError):
                    await classify_and_persist_hook(db, va_id)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_idempotent_rerun_replaces_not_accumulates():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_analysis(db, user)
        try:
            with patch.object(hook_classification_svc, "classify_hook", new=AsyncMock(return_value=_result("question"))):
                await classify_and_persist_hook(db, va_id)
            with patch.object(hook_classification_svc, "classify_hook", new=AsyncMock(return_value=_result("bold_claim"))):
                await classify_and_persist_hook(db, va_id)

            rows = list((await db.execute(select(StrategicInsight).where(
                StrategicInsight.video_analysis_id == va_id, StrategicInsight.category == HOOK_STRATEGIC_CATEGORY,
            ))).scalars().all())
            assert len(rows) == 1  # replaced, not accumulated
            assert rows[0].details["primary_type"] == "bold_claim"  # reflects the LATEST run
            assert rows[0].certainty == "INFERRED"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_provenance_strategic_insight_carries_full_reasoner_attribution():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_analysis(db, user)
        try:
            with patch.object(hook_classification_svc, "classify_hook", new=AsyncMock(return_value=_result("question"))):
                result = await classify_and_persist_hook(db, va_id)

            row = await db.get(StrategicInsight, result["strategic_insight_id"])
            assert row.details["provider"] == "anthropic"
            assert row.details["model"] == "claude-sonnet-4-20250514"
            assert row.details["prompt_version"] == "v1"
            assert row.details["hook_window_id"] is not None
            assert row.reasoning == "factual reasoning"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_not_found_raises():
    async with _TestSessionLocal() as db:
        with pytest.raises(HookClassificationError):
            await classify_and_persist_hook(db, 999_999_999)
