"""
Stage 11.3 (pre-lock durability correction) — hook_reasoning_store_svc tests. Real-database
convention; no LLM/Anthropic call anywhere in this file (HookResult objects are built directly).
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
from app.services.hook_reasoner.contract import HookDecision, HookElement, HookResult
from app.services.hook_reasoning_store_svc import (
    HOOK_REASONING_ATTEMPT_CATEGORY, HOOK_REASONING_PASS_NAME,
    load_hook_reasoning_attempts, persist_hook_reasoning_attempt,
)

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)

_HOOK_WINDOW = {"start_time": 0.0, "end_time": 3.0, "hook_window_id": 777}


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_analysis(db, user):
    asset = Asset(
        user_id=user.id, original_filename="hook_store_test.mp4", stored_filename="hook_store_test_stored.mp4",
        file_path="uploads/hook_store_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=10.0)
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


def _make_result(primary_type="question", intent=None):
    return HookResult(
        decision=HookDecision(
            primary_type=primary_type, confidence="medium", reasoning="test reasoning",
            hook_elements=[HookElement("spoken_line", {"supporting_speech_segment_ids": [1]})],
            probable_intent=intent, evidence_references={"supporting_speech_segment_ids": [1]},
        ),
        provider="anthropic", model="claude-sonnet-5", reasoning_contract_version="v1",
    )


async def test_persist_creates_row_with_correct_shape():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user)
        try:
            row = await persist_hook_reasoning_attempt(db, va_id, _HOOK_WINDOW, _make_result())
            assert row.category == HOOK_REASONING_ATTEMPT_CATEGORY
            assert row.produced_by_pass == HOOK_REASONING_PASS_NAME
            assert row.certainty == "INFERRED"
            assert row.confidence_score is None  # categorical confidence lives in details, not this column
            assert (row.start_time, row.end_time) == (0.0, 3.0)
            assert row.details["hook_window_id"] == 777
            assert row.reasoning == "test reasoning"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_append_only_never_overwrites():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user)
        try:
            first = await persist_hook_reasoning_attempt(db, va_id, _HOOK_WINDOW, _make_result("question"))
            second = await persist_hook_reasoning_attempt(db, va_id, _HOOK_WINDOW, _make_result("bold_claim"))
            assert first.id != second.id

            still_there = await db.get(AnalysisAnnotation, first.id)
            assert still_there is not None
            assert still_there.details["primary_type"] == "question"  # untouched by the second call
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_load_returns_full_history_oldest_first():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user)
        try:
            a = await persist_hook_reasoning_attempt(db, va_id, _HOOK_WINDOW, _make_result("question", intent="create_curiosity"))
            b = await persist_hook_reasoning_attempt(db, va_id, _HOOK_WINDOW, _make_result("bold_claim", intent="provoke_attention"))
            c = await persist_hook_reasoning_attempt(db, va_id, _HOOK_WINDOW, _make_result("proof_first"))

            attempts = await load_hook_reasoning_attempts(db, va_id)
            assert [x.id for x in attempts] == [a.id, b.id, c.id]
            assert [x.details["primary_type"] for x in attempts] == ["question", "bold_claim", "proof_first"]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_load_is_idempotent_and_never_mutates():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user)
        try:
            await persist_hook_reasoning_attempt(db, va_id, _HOOK_WINDOW, _make_result())
            first_read = await load_hook_reasoning_attempts(db, va_id)
            second_read = await load_hook_reasoning_attempts(db, va_id)
            assert [a.id for a in first_read] == [a.id for a in second_read]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_module_introduces_no_new_orm_model_or_migration():
    import ast
    import inspect
    import app.services.hook_reasoning_store_svc as module
    src = inspect.getsource(module)
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.ClassDef):
            bases = {b.id for b in node.bases if isinstance(b, ast.Name)}
            assert "Base" not in bases
    assert "alembic" not in src.lower()
    assert "ADD COLUMN" not in src.upper()
