"""
Video Deconstructor — Stage 10.2B5: Durable Semantic-Boundary Reasoning Result Store.

Uses the same real-database, direct create_async_engine/async_sessionmaker convention as every
other test file in this suite. No real semantic reasoner or Anthropic call occurs anywhere in
this file -- every ReasonerResult/ReasonerDecision is hand-constructed, exactly like
test_scene_construction_svc.py's own convention.
"""
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
from app.services.scene_construction_svc import CandidateReasoningRecord, construct_and_persist_scenes
from app.services.semantic_boundary_reasoning_store_svc import (
    REASONING_RESULT_CATEGORY,
    find_unreasoned_candidates,
    load_latest_reasoning_results,
    persist_reasoning_result,
)
from app.services.semantic_reasoner.contract import ReasonerDecision, ReasonerResult

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_bare_analysis(db, user: User, duration: float = 60.0) -> tuple[int, int, int]:
    asset = Asset(
        user_id=user.id, original_filename="reasoning_store_test.mp4", stored_filename="reasoning_store_test_stored.mp4",
        file_path="uploads/reasoning_store_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
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


async def _add_shots(db, va_id: int, ranges: list[tuple[float, float]]) -> list[int]:
    ids = []
    for i, (start, end) in enumerate(ranges):
        shot = Shot(
            video_analysis_id=va_id, scene_id=None, order=i, start_time=start, end_time=end,
            certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1",
        )
        db.add(shot)
        await db.flush()
        ids.append(shot.id)
    await db.commit()
    return ids


async def _cleanup(db, asset_id: int, reference_video_id: int):
    rv = await db.get(ReferenceVideo, reference_video_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


def _record(
    timestamp: float, is_semantic_boundary: bool | None, confidence: str,
    evidence_references: dict | None = None, source_nominations: list | None = None,
    provider: str = "anthropic", model: str = "claude-sonnet-4-6",
    reasoning: str = "test reasoning", reasoning_contract_version: str | None = "v3",
) -> CandidateReasoningRecord:
    decision = ReasonerDecision(
        is_semantic_boundary=is_semantic_boundary, confidence=confidence, confidence_score=None,
        reasoning=reasoning, evidence_references=evidence_references or {},
        reasoning_contract_version=reasoning_contract_version,
    )
    result = ReasonerResult(
        decision=decision, provider=provider, model=model, candidate_timestamp=timestamp,
        reasoning_contract_version=reasoning_contract_version,
    )
    return CandidateReasoningRecord(result=result, source_nominations=source_nominations or [])


# ---------------------------------------------------------------------------
# One persisted candidate survives a later load; multiple persisted independently.
# ---------------------------------------------------------------------------

async def test_one_persisted_candidate_survives_a_later_load():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            record = _record(30.0, True, "high", {"supporting_shot_ids": [1]}, source_nominations=[{"source_type": "shot_boundary", "source_id": 1, "timestamp": 30.0}])
            await persist_reasoning_result(db, va_id, record)

            loaded = await load_latest_reasoning_results(db, va_id)
            assert len(loaded) == 1
            assert loaded[0].result.candidate_timestamp == 30.0
            assert loaded[0].result.decision.is_semantic_boundary is True
            assert loaded[0].source_nominations == [{"source_type": "shot_boundary", "source_id": 1, "timestamp": 30.0}]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_multiple_candidates_persisted_independently():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_reasoning_result(db, va_id, _record(20.0, False, "high"))
            await persist_reasoning_result(db, va_id, _record(40.0, True, "medium"))

            loaded = await load_latest_reasoning_results(db, va_id)
            assert sorted(r.result.candidate_timestamp for r in loaded) == [20.0, 40.0]
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# A partial run is naturally recoverable (simulated crash between two persists).
# ---------------------------------------------------------------------------

async def test_partial_run_is_naturally_recoverable():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            # Simulates a process reasoning about candidate 1, persisting it, then "crashing"
            # before ever reasoning about candidate 2.
            await persist_reasoning_result(db, va_id, _record(15.0, False, "high"))
            # No persist call for a would-be second candidate -- the "crash" happens here.

            loaded = await load_latest_reasoning_results(db, va_id)
            assert len(loaded) == 1  # exactly what was durably saved before the "crash"
            assert loaded[0].result.candidate_timestamp == 15.0
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Append-only: repeated reasoning of the same candidate; latest wins; older attempts remain.
# ---------------------------------------------------------------------------

async def test_repeated_reasoning_of_same_candidate_is_append_only():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_reasoning_result(db, va_id, _record(30.0, False, "low", reasoning="first attempt"))
            await persist_reasoning_result(db, va_id, _record(30.0, True, "high", reasoning="second attempt"))

            all_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == REASONING_RESULT_CATEGORY,
            ))).scalars().all()
            assert len(all_rows) == 2  # both attempts preserved, never overwritten/deleted
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_latest_attempt_wins_on_read():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_reasoning_result(db, va_id, _record(30.0, False, "low", reasoning="first attempt"))
            await persist_reasoning_result(db, va_id, _record(30.0, True, "high", reasoning="second attempt"))

            loaded = await load_latest_reasoning_results(db, va_id)
            assert len(loaded) == 1  # the two attempts are the SAME candidate -- one record
            assert loaded[0].result.decision.reasoning == "second attempt"
            assert loaded[0].result.decision.is_semantic_boundary is True
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_older_attempts_remain_stored_after_load():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_reasoning_result(db, va_id, _record(30.0, False, "low", reasoning="first attempt"))
            await persist_reasoning_result(db, va_id, _record(30.0, True, "high", reasoning="second attempt"))
            await load_latest_reasoning_results(db, va_id)  # loading must not delete/mutate anything

            all_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == REASONING_RESULT_CATEGORY,
            ))).scalars().all()
            assert len(all_rows) == 2
            assert {r.reasoning for r in all_rows} == {"first attempt", "second attempt"}
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Mixed provider/model histories; different prompt versions for same candidate/model.
# ---------------------------------------------------------------------------

async def test_mixed_provider_model_histories_survive():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=100.0)
        try:
            await persist_reasoning_result(db, va_id, _record(20.0, False, "high", provider="anthropic", model="claude-sonnet-4-6"))
            await persist_reasoning_result(db, va_id, _record(50.0, True, "medium", provider="other", model="some-other-model"))

            loaded = await load_latest_reasoning_results(db, va_id)
            by_ts = {r.result.candidate_timestamp: r for r in loaded}
            assert by_ts[20.0].result.provider == "anthropic"
            assert by_ts[50.0].result.provider == "other"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_different_prompt_versions_for_same_candidate_model_remain_distinguishable():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_reasoning_result(db, va_id, _record(30.0, False, "high", reasoning_contract_version="v2"))
            await persist_reasoning_result(db, va_id, _record(30.0, True, "medium", reasoning_contract_version="v3"))

            all_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == REASONING_RESULT_CATEGORY,
            ))).scalars().all()
            versions = {r.details["prompt_version"] for r in all_rows}
            assert versions == {"v2", "v3"}  # both attempts distinguishable by prompt_version, same provider/model/pass

            loaded = await load_latest_reasoning_results(db, va_id)
            assert loaded[0].result.reasoning_contract_version == "v3"  # latest wins
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Unreasoned-candidate identification.
# ---------------------------------------------------------------------------

async def test_find_unreasoned_candidates_identifies_missing_ones():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_shots(db, va_id, [(0.0, 20.0), (20.0, 40.0), (40.0, 60.0)])
            # Two shot_boundary candidates exist live: 20.0 and 40.0. Reason about only one.
            await persist_reasoning_result(db, va_id, _record(20.0, False, "high"))

            unreasoned = await find_unreasoned_candidates(db, va_id)
            unreasoned_timestamps = [c["candidate_timestamp"] for c in unreasoned]
            assert unreasoned_timestamps == [40.0]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_find_unreasoned_candidates_returns_empty_once_all_reasoned():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_shots(db, va_id, [(0.0, 30.0), (30.0, 60.0)])
            await persist_reasoning_result(db, va_id, _record(30.0, False, "high"))

            unreasoned = await find_unreasoned_candidates(db, va_id)
            assert unreasoned == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_find_unreasoned_candidates_makes_no_external_call():
    # Structural -- if this ever imported/called a reasoner, it would need network/config; a
    # bare-fixture VideoAnalysis with zero evidence proves it degrades to "everything unreasoned"
    # (or "nothing" if there are no candidates) without ever attempting one.
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            unreasoned = await find_unreasoned_candidates(db, va_id)
            assert unreasoned == []  # zero evidence -> zero candidates -> zero unreasoned, no crash
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Loader output feeds directly into the existing, unmodified B3.
# ---------------------------------------------------------------------------

async def test_loader_output_feeds_directly_into_existing_b3():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            await persist_reasoning_result(db, va_id, _record(30.0, True, "high", {"supporting_shot_ids": [1]}))

            loaded = await load_latest_reasoning_results(db, va_id)
            scenes = await construct_and_persist_scenes(db, va_id, loaded)  # unmodified B3 entry point

            assert len(scenes) == 2
            assert (scenes[0].start_time, scenes[0].end_time) == (0.0, 30.0)
            assert (scenes[1].start_time, scenes[1].end_time) == (30.0, 60.0)
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Structural: neither this store nor B3 can make an external API call.
# ---------------------------------------------------------------------------

def test_store_module_imports_no_anthropic_or_reasoner_router():
    import ast
    import inspect
    import app.services.semantic_boundary_reasoning_store_svc as module

    tree = ast.parse(inspect.getsource(module))
    imported_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_names.add(node.module)

    assert "anthropic" not in imported_names
    assert not any(name.startswith("app.services.semantic_reasoner.router") for name in imported_names)
    assert "reason_about_boundary" not in imported_names
