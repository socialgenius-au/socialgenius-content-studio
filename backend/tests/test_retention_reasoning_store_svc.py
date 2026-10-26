"""
Stage 11.4 — retention_reasoning_store_svc tests. Real-database convention; no LLM/Anthropic call
anywhere in this file (RetentionResult objects are built directly).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.retention_reasoner.contract import RetentionDecision, RetentionResult
from app.services.retention_reasoning_store_svc import (
    RETENTION_REASONING_ATTEMPT_CATEGORY, RETENTION_REASONING_PASS_NAME,
    load_retention_reasoning_attempts, persist_retention_reasoning_attempt,
)

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)

_CANDIDATE = {
    "candidate_start": 10.0, "candidate_end": 10.4, "candidate_center": 10.2,
    "source_nominations": [{"source_type": "shot_cut", "source_id": 777, "timestamp": 10.2}],
}


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_analysis(db, user):
    asset = Asset(
        user_id=user.id, original_filename="retention_store_test.mp4", stored_filename="retention_store_test_stored.mp4",
        file_path="uploads/retention_store_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=30.0)
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


def _make_result(device_type="question", is_retention_device=False, probable_attention_function=None):
    return RetentionResult(
        decision=RetentionDecision(
            is_retention_device=is_retention_device, device_type=device_type, confidence="medium",
            reasoning="test reasoning", probable_attention_function=probable_attention_function,
            evidence_references={"supporting_speech_segment_ids": [1]},
        ),
        provider="anthropic", model="claude-sonnet-5", reasoning_contract_version="v1",
    )


async def test_persist_creates_row_with_correct_shape():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user)
        try:
            row = await persist_retention_reasoning_attempt(db, va_id, _CANDIDATE, _make_result())
            assert row.category == RETENTION_REASONING_ATTEMPT_CATEGORY
            assert row.produced_by_pass == RETENTION_REASONING_PASS_NAME
            assert row.certainty == "INFERRED"
            assert row.confidence_score is None
            assert (row.start_time, row.end_time) == (10.0, 10.4)
            assert row.details["candidate_center"] == 10.2
            assert row.details["source_nominations"] == _CANDIDATE["source_nominations"]
            assert row.details["is_retention_device"] is False
            assert row.details["probable_attention_function"] is None
            assert row.reasoning == "test reasoning"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_append_only_never_overwrites():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user)
        try:
            first = await persist_retention_reasoning_attempt(db, va_id, _CANDIDATE, _make_result("question"))
            second = await persist_retention_reasoning_attempt(db, va_id, _CANDIDATE, _make_result("pacing_change"))
            assert first.id != second.id

            still_there = await db.get(AnalysisAnnotation, first.id)
            assert still_there is not None
            assert still_there.details["device_type"] == "question"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_load_returns_full_history_oldest_first_across_candidates():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user)
        try:
            other_candidate = {**_CANDIDATE, "candidate_start": 50.0, "candidate_end": 50.2, "candidate_center": 50.1}
            a = await persist_retention_reasoning_attempt(db, va_id, _CANDIDATE, _make_result("question"))
            b = await persist_retention_reasoning_attempt(db, va_id, other_candidate, _make_result("pacing_change"))
            c = await persist_retention_reasoning_attempt(db, va_id, _CANDIDATE, _make_result("unclear"))

            attempts = await load_retention_reasoning_attempts(db, va_id)
            assert [x.id for x in attempts] == [a.id, b.id, c.id]
            assert [x.details["device_type"] for x in attempts] == ["question", "pacing_change", "unclear"]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_persist_records_accepted_decision_shape():
    """An ACCEPTED decision's attempt row carries both is_retention_device=True and its
    probable_attention_function -- the acceptance gate is visible in the durable audit trail, not
    only in the effective retention_device row."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user)
        try:
            row = await persist_retention_reasoning_attempt(
                db, va_id, _CANDIDATE, _make_result("scene_switch", is_retention_device=True, probable_attention_function="renew_attention")
            )
            assert row.details["is_retention_device"] is True
            assert row.details["probable_attention_function"] == "renew_attention"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_load_is_idempotent_and_never_mutates():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user)
        try:
            await persist_retention_reasoning_attempt(db, va_id, _CANDIDATE, _make_result())
            first_read = await load_retention_reasoning_attempts(db, va_id)
            second_read = await load_retention_reasoning_attempts(db, va_id)
            assert [a.id for a in first_read] == [a.id for a in second_read]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_module_introduces_no_new_orm_model_or_migration():
    import ast
    import inspect
    import app.services.retention_reasoning_store_svc as module
    src = inspect.getsource(module)
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.ClassDef):
            bases = {b.id for b in node.bases if isinstance(b, ast.Name)}
            assert "Base" not in bases
    assert "alembic" not in src.lower()
    assert "ADD COLUMN" not in src.upper()
