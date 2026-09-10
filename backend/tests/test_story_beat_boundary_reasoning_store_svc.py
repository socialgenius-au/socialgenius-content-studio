"""
Video Deconstructor — Stage 10.3B4: Durable Story Beat Reasoning Result Store.

Uses the same real-database, direct create_async_engine/async_sessionmaker convention as
tests/test_semantic_boundary_reasoning_store_svc.py. No real Story Beat reasoner or Anthropic call
occurs anywhere in this file -- every StoryBeatResult/StoryBeatDecision is hand-constructed.

No backfill support exists in this phase (an explicitly deferred, separate decision -- see the
module's own docstring), so this file carries no backfill tests, unlike its Scene-store sibling.
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
from app.services.story_beat_boundary_reasoning_store_svc import (
    STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY,
    STORY_BEAT_REASONING_PASS_NAME,
    StoryBeatReasoningRecord,
    find_unreasoned_story_beat_candidates,
    load_latest_story_beat_reasoning_results,
    persist_story_beat_reasoning_result,
)
from app.services.story_beat_reasoner.contract import StoryBeatDecision, StoryBeatResult

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_bare_analysis(db, user: User, duration: float = 60.0) -> tuple[int, int, int]:
    asset = Asset(
        user_id=user.id, original_filename="story_beat_store_test.mp4", stored_filename="story_beat_store_test_stored.mp4",
        file_path="uploads/story_beat_store_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
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


async def _add_shots(db, va_id: int, ranges: list[tuple[float, float]], order_offset: int = 0) -> list[int]:
    # Candidate assembly orders shots by Shot.order (not start_time) -- callers adding shots across
    # multiple _add_shots calls for the SAME video_analysis_id must pass a non-overlapping
    # order_offset, or the resulting shot sequence (and its derived shot_boundary candidates) will
    # not reflect the intended chronological order.
    ids = []
    for i, (start, end) in enumerate(ranges):
        shot = Shot(
            video_analysis_id=va_id, scene_id=None, order=order_offset + i, start_time=start, end_time=end,
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
    timestamp: float, is_story_beat_boundary: bool | None, confidence: str,
    evidence_references: dict | None = None, source_nominations: list | None = None,
    provider: str = "anthropic", model: str = "claude-sonnet-4-6",
    reasoning: str = "test reasoning", reasoning_contract_version: str | None = "v1",
) -> StoryBeatReasoningRecord:
    decision = StoryBeatDecision(
        is_story_beat_boundary=is_story_beat_boundary, confidence=confidence,
        reasoning=reasoning, evidence_references=evidence_references or {},
        reasoning_contract_version=reasoning_contract_version,
    )
    result = StoryBeatResult(
        decision=decision, provider=provider, model=model, candidate_timestamp=timestamp,
        reasoning_contract_version=reasoning_contract_version,
    )
    return StoryBeatReasoningRecord(result=result, source_nominations=source_nominations or [])


# ---------------------------------------------------------------------------
# (1)(2)(3) True / False / None results persist correctly.
# ---------------------------------------------------------------------------

async def test_true_result_persists_correctly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "high"))
            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert len(loaded) == 1
            assert loaded[0].result.decision.is_story_beat_boundary is True
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_false_result_persists_correctly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, False, "high"))
            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert loaded[0].result.decision.is_story_beat_boundary is False
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_none_result_persists_correctly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, None, "low"))
            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert loaded[0].result.decision.is_story_beat_boundary is None
            assert loaded[0].result.decision.is_story_beat_boundary is not False
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# (4)(5)(6)(7)(8) Confidence/reasoning/provider/model/prompt-version/evidence preserved.
# ---------------------------------------------------------------------------

async def test_confidence_preserved():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "medium"))
            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert loaded[0].result.decision.confidence == "medium"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_reasoning_preserved():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(
                db, va_id, _record(30.0, True, "high", reasoning="a rhetorical shift from setup to consequence"),
            )
            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert loaded[0].result.decision.reasoning == "a rhetorical shift from setup to consequence"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_provider_and_model_preserved():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(
                db, va_id, _record(30.0, True, "high", provider="anthropic", model="claude-sonnet-4-6"),
            )
            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert loaded[0].result.provider == "anthropic"
            assert loaded[0].result.model == "claude-sonnet-4-6"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_prompt_version_preserved():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "high", reasoning_contract_version="v1"))
            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert loaded[0].result.reasoning_contract_version == "v1"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_evidence_ids_preserved():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            refs = {"supporting_shot_ids": [1], "supporting_frame_ids": [], "supporting_speech_segment_ids": [101, 102]}
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "high", evidence_references=refs))
            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert loaded[0].result.decision.evidence_references == refs
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# (9)(10) certainty = INFERRED; correct produced_by_pass/source.
# ---------------------------------------------------------------------------

async def test_certainty_is_inferred_never_measured():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            annotation = await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "high"))
            assert annotation.certainty == "INFERRED"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_produced_by_pass_and_source_and_category_correct():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            annotation = await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "high"))
            assert annotation.produced_by_pass == STORY_BEAT_REASONING_PASS_NAME == "story_beat_reasoning_v1"
            assert annotation.source == "ai_reasoning"
            assert annotation.category == STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY == "story_beat_boundary_attempt"
        finally:
            await _cleanup(db, asset_id, rv_id)


def test_category_string_fits_the_column_length():
    # AnalysisAnnotation.category is String(32) -- verified BEFORE writing any persistence code,
    # per this engagement's own established StringDataRightTruncationError lesson.
    assert len(STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY) <= 32
    assert STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY == "story_beat_boundary_attempt"


# ---------------------------------------------------------------------------
# (11)(12)(13)(14) Append-only; second attempt never overwrites first; latest wins;
# historical prompt versions remain intact.
# ---------------------------------------------------------------------------

async def test_second_attempt_does_not_overwrite_first_append_only():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, False, "low", reasoning="first attempt"))
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "high", reasoning="second attempt"))

            all_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id,
                AnalysisAnnotation.category == STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY,
            ))).scalars().all()
            assert len(all_rows) == 2  # both attempts preserved, never overwritten/deleted
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_loader_returns_latest_attempt():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, False, "low", reasoning="first attempt"))
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "high", reasoning="second attempt"))

            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert len(loaded) == 1  # the two attempts are the SAME candidate -- one record
            assert loaded[0].result.decision.reasoning == "second attempt"
            assert loaded[0].result.decision.is_story_beat_boundary is True
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_older_attempts_remain_stored_after_load():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, False, "low", reasoning="first attempt"))
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "high", reasoning="second attempt"))
            await load_latest_story_beat_reasoning_results(db, va_id)  # loading must not delete/mutate anything

            all_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id,
                AnalysisAnnotation.category == STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY,
            ))).scalars().all()
            assert len(all_rows) == 2
            assert {r.reasoning for r in all_rows} == {"first attempt", "second attempt"}
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_historical_prompt_versions_remain_intact_alongside_newer_ones():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, False, "high", reasoning_contract_version="v1"))
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "medium", reasoning_contract_version="v2"))

            all_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id,
                AnalysisAnnotation.category == STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY,
            ))).scalars().all()
            versions = {r.details["prompt_version"] for r in all_rows}
            assert versions == {"v1", "v2"}  # both attempts distinguishable, neither rewritten

            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert loaded[0].result.reasoning_contract_version == "v2"  # latest wins, "v1" not lost
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# (15) Float-timestamp grouping follows the proven Scene-store tolerance logic.
# ---------------------------------------------------------------------------

async def test_float_timestamp_grouping_uses_proximity_not_exact_equality():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            # Two attempts at "the same" candidate whose own floats differ slightly (mirrors real
            # candidate-generation float drift already seen throughout this engagement).
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, False, "low"))
            await persist_story_beat_reasoning_result(db, va_id, _record(30.2, True, "high"))  # within tolerance

            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert len(loaded) == 1  # grouped as the same candidate, not two

            # A genuinely distant timestamp must NOT be merged into the same cluster.
            await persist_story_beat_reasoning_result(db, va_id, _record(45.0, True, "medium"))
            loaded = await load_latest_story_beat_reasoning_results(db, va_id)
            assert len(loaded) == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# (16)(17) Durable False/None both count as reasoned -- never re-offered as unreasoned.
# ---------------------------------------------------------------------------

async def test_durable_false_counts_as_reasoned():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_shots(db, va_id, [(0.0, 30.0), (30.0, 60.0)])
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, False, "high"))

            unreasoned = await find_unreasoned_story_beat_candidates(db, va_id)
            assert unreasoned == []  # the one live candidate (30.0) already has a False attempt
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_durable_none_counts_as_reasoned():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_shots(db, va_id, [(0.0, 30.0), (30.0, 60.0)])
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, None, "low"))

            unreasoned = await find_unreasoned_story_beat_candidates(db, va_id)
            assert unreasoned == []  # an undecided attempt still counts as "reasoned about"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# (18) find_unreasoned_story_beat_candidates recomputes the CURRENT live candidate set.
# ---------------------------------------------------------------------------

async def test_find_unreasoned_identifies_missing_ones():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_shots(db, va_id, [(0.0, 20.0), (20.0, 40.0), (40.0, 60.0)])
            # Two shot_boundary candidates exist live: 20.0 and 40.0. Reason about only one.
            await persist_story_beat_reasoning_result(db, va_id, _record(20.0, False, "high"))

            unreasoned = await find_unreasoned_story_beat_candidates(db, va_id)
            unreasoned_timestamps = [c["candidate_timestamp"] for c in unreasoned]
            assert unreasoned_timestamps == [40.0]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_find_unreasoned_recomputes_fresh_not_cached():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        # duration=90.0 fixed up front so both 30.0 and 60.0 remain genuine INTERIOR shot
        # boundaries (0.0 and 90.0 are the video's own outer edges, always excluded).
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=90.0)
        try:
            await _add_shots(db, va_id, [(0.0, 30.0), (30.0, 90.0)])
            unreasoned_before = await find_unreasoned_story_beat_candidates(db, va_id)
            assert [c["candidate_timestamp"] for c in unreasoned_before] == [30.0]

            # Evidence changes (the single long shot is split by a new cut at 60.0) -- a fresh
            # call must reflect it immediately, proving no stale/cached candidate list is reused.
            # Mutated via the ORM (not a raw Core UPDATE) so the session's identity map stays
            # consistent with the DB -- a raw table-level UPDATE would leave the already-loaded
            # Shot object's in-memory attributes stale for the rest of this session.
            existing_shot = (await db.execute(
                select(Shot).where(Shot.video_analysis_id == va_id, Shot.start_time == 30.0)
            )).scalar_one()
            existing_shot.end_time = 60.0
            await db.commit()
            await _add_shots(db, va_id, [(60.0, 90.0)], order_offset=2)
            unreasoned_after = await find_unreasoned_story_beat_candidates(db, va_id)
            assert sorted(c["candidate_timestamp"] for c in unreasoned_after) == [30.0, 60.0]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_find_unreasoned_makes_no_external_call():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            unreasoned = await find_unreasoned_story_beat_candidates(db, va_id)
            assert unreasoned == []  # zero evidence -> zero candidates -> zero unreasoned, no crash
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# (19) No final `story_beat` rows are ever created by this store.
# ---------------------------------------------------------------------------

async def test_no_final_story_beat_category_row_ever_created():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await persist_story_beat_reasoning_result(db, va_id, _record(30.0, True, "high"))

            final_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "story_beat",
            ))).scalars().all()
            assert final_rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


def test_module_defines_no_final_story_beat_construction_function():
    import app.services.story_beat_boundary_reasoning_store_svc as module
    for forbidden in ("construct_and_persist_story_beats", "construct_story_beats", "BOUNDARY_DECISION_CATEGORY"):
        assert not hasattr(module, forbidden)


# ---------------------------------------------------------------------------
# (20) No Scene durable-store behavior changed.
# ---------------------------------------------------------------------------

async def test_scene_durable_store_category_and_behavior_unchanged():
    from app.services.semantic_boundary_reasoning_store_svc import REASONING_RESULT_CATEGORY
    from app.services.scene_construction_svc import CandidateReasoningRecord
    from app.services.semantic_boundary_reasoning_store_svc import persist_reasoning_result
    from app.services.semantic_reasoner.contract import ReasonerDecision, ReasonerResult

    assert REASONING_RESULT_CATEGORY == "semantic_boundary_attempt"  # unchanged from Stage 10.2B5

    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            decision = ReasonerDecision(
                is_semantic_boundary=True, confidence="high", confidence_score=None,
                reasoning="x", evidence_references={},
            )
            result = ReasonerResult(decision=decision, provider="anthropic", model="claude-sonnet-4-6", candidate_timestamp=30.0)
            annotation = await persist_reasoning_result(db, va_id, CandidateReasoningRecord(result=result))
            assert annotation.category == "semantic_boundary_attempt"  # Scene's own category, untouched

            # And this new Story Beat category never appears among Scene's own rows.
            scene_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id,
                AnalysisAnnotation.category == STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY,
            ))).scalars().all()
            assert scene_rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# (21) Structural: this store can make no external API call.
# ---------------------------------------------------------------------------

def test_store_module_imports_no_anthropic_or_reasoner_router():
    import ast
    import inspect
    import app.services.story_beat_boundary_reasoning_store_svc as module

    tree = ast.parse(inspect.getsource(module))
    imported_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_names.add(node.module)

    assert "anthropic" not in imported_names
    assert not any(name.startswith("app.services.story_beat_reasoner.router") for name in imported_names)
    assert not any(name.startswith("app.services.story_beat_reasoner.providers") for name in imported_names)
    assert "reason_about_story_beat_boundary" not in imported_names


# ---------------------------------------------------------------------------
# (22) No migration required -- this store uses only the existing AnalysisAnnotation table.
# ---------------------------------------------------------------------------

def test_no_new_orm_model_or_migration_introduced():
    import ast
    import inspect
    import app.services.story_beat_boundary_reasoning_store_svc as module
    source = inspect.getsource(module)

    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            base_names = {b.id for b in node.bases if isinstance(b, ast.Name)}
            assert "Base" not in base_names, f"{node.name} defines a new ORM model -- a migration would be required"

    assert "alembic" not in source.lower()
    assert "ADD COLUMN" not in source.upper()
