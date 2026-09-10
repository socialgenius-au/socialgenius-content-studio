"""
Video Deconstructor — Stage 10.2B3: Scene Orchestration & Persistence.

The FIRST test file exercising real Scene(...) creation in this whole engagement. Uses the same
real-database, direct create_async_engine/async_sessionmaker convention as every other test file
in this suite (see test_scene_details_model.py) — synthetic fixtures throughout; nothing here
touches the real, shared RV146 (id=146)/RV5127 (id=5127) rows this engagement has otherwise relied
on as clean reference data — the "RV146-shaped"/"RV5127-shaped" tests below use fresh, throwaway
fixtures whose numbers mirror the real benchmark's own real values, never the real rows themselves.

No real semantic reasoner or Anthropic call occurs anywhere in this file — every ReasonerResult is
hand-constructed via `_reasoner_result()`, a plain in-memory dataclass factory.
"""
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
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.scene_construction_svc import (
    BOUNDARY_DECISION_CATEGORY,
    SCENE_CONSTRUCTION_PASS_STATUS_KEY,
    CandidateReasoningRecord,
    SceneConstructionError,
    construct_and_persist_scenes,
)
from app.services.semantic_boundary_assembly_svc import CANDIDATE_MERGE_WINDOW_SECONDS
from app.services.semantic_reasoner.contract import ReasonerDecision, ReasonerResult

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_bare_analysis(db, user: User, duration: float | None = 60.0) -> tuple[int, int, int]:
    asset = Asset(
        user_id=user.id, original_filename="scene_construction_test.mp4", stored_filename="scene_construction_test_stored.mp4",
        file_path="uploads/scene_construction_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
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


def _reasoner_result(
    timestamp: float, is_semantic_boundary: bool | None, confidence: str,
    evidence_references: dict | None = None, provider: str = "anthropic", model: str = "claude-sonnet-4-6",
    reasoning: str = "test reasoning",
) -> ReasonerResult:
    decision = ReasonerDecision(
        is_semantic_boundary=is_semantic_boundary, confidence=confidence, confidence_score=None,
        reasoning=reasoning, evidence_references=evidence_references or {},
    )
    return ReasonerResult(decision=decision, provider=provider, model=model, candidate_timestamp=timestamp)


def _record(timestamp, is_semantic_boundary, confidence, evidence_references=None, source_nominations=None, **kwargs):
    return CandidateReasoningRecord(
        result=_reasoner_result(timestamp, is_semantic_boundary, confidence, evidence_references, **kwargs),
        source_nominations=source_nominations or [],
    )


# ---------------------------------------------------------------------------
# Zero / one / several accepted boundaries.
# ---------------------------------------------------------------------------

async def test_zero_accepted_boundaries_produces_one_whole_video_scene():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            records = [_record(30.0, False, "high"), _record(45.0, None, "low")]
            scenes = await construct_and_persist_scenes(db, va_id, records)
            assert len(scenes) == 1
            assert scenes[0].start_time == 0.0
            assert scenes[0].end_time == 60.0
            assert scenes[0].order == 0
            assert scenes[0].details is None
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_one_accepted_boundary_produces_two_scenes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            records = [_record(30.0, True, "high", {"supporting_shot_ids": [1]})]
            scenes = await construct_and_persist_scenes(db, va_id, records)
            assert len(scenes) == 2
            assert (scenes[0].start_time, scenes[0].end_time) == (0.0, 30.0)
            assert (scenes[1].start_time, scenes[1].end_time) == (30.0, 60.0)
            assert scenes[0].order == 0 and scenes[1].order == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_several_accepted_boundaries_produce_contiguous_scenes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=100.0)
        try:
            records = [
                _record(20.0, True, "high"), _record(50.0, True, "medium"), _record(80.0, True, "high"),
            ]
            scenes = await construct_and_persist_scenes(db, va_id, records)
            assert [(s.start_time, s.end_time) for s in scenes] == [
                (0.0, 20.0), (20.0, 50.0), (50.0, 80.0), (80.0, 100.0),
            ]
            assert [s.order for s in scenes] == [0, 1, 2, 3]
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Accepted-boundary policy: True/medium, True/high accepted; True/low, False, None rejected.
# ---------------------------------------------------------------------------

async def test_true_medium_and_true_high_are_accepted():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=100.0)
        try:
            records = [_record(20.0, True, "medium"), _record(60.0, True, "high")]
            scenes = await construct_and_persist_scenes(db, va_id, records)
            assert len(scenes) == 3  # both accepted -> 3 scenes
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_true_low_is_rejected_as_a_boundary():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            records = [_record(30.0, True, "low")]
            scenes = await construct_and_persist_scenes(db, va_id, records)
            assert len(scenes) == 1  # low confidence True never accepted
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_false_and_none_are_rejected_as_boundaries():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            records = [_record(20.0, False, "high"), _record(40.0, None, "high")]
            scenes = await construct_and_persist_scenes(db, va_id, records)
            assert len(scenes) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Every reasoner decision is nevertheless persisted as an AnalysisAnnotation.
# ---------------------------------------------------------------------------

async def test_every_decision_persisted_as_annotation_regardless_of_acceptance():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            records = [
                _record(10.0, True, "high", {"supporting_shot_ids": [1]}, source_nominations=[{"source_type": "shot_boundary", "source_id": 1, "timestamp": 10.0}]),
                _record(20.0, False, "medium"),
                _record(30.0, None, "low"),
                _record(40.0, True, "low"),
            ]
            await construct_and_persist_scenes(db, va_id, records)

            result = await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id,
                AnalysisAnnotation.category == BOUNDARY_DECISION_CATEGORY,
            ).order_by(AnalysisAnnotation.start_time))
            annotations = result.scalars().all()
            assert len(annotations) == 4
            assert [a.details["is_semantic_boundary"] for a in annotations] == [True, False, None, True]
            assert annotations[0].details["source_nominations"] == [{"source_type": "shot_boundary", "source_id": 1, "timestamp": 10.0}]
            assert all(a.certainty == "INFERRED" for a in annotations)
            assert all(a.source == "ai_reasoning" for a in annotations)
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Duration: authoritative source, Shot fallback, honest failure.
# ---------------------------------------------------------------------------

async def test_uses_reference_video_duration_when_available():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=34.15)
        try:
            scenes = await construct_and_persist_scenes(db, va_id, [])
            assert scenes[0].end_time == 34.15
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_falls_back_to_max_shot_end_time_when_duration_missing():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=None)
        try:
            await _add_shots(db, va_id, [(0.0, 20.0), (20.0, 43.9)])
            scenes = await construct_and_persist_scenes(db, va_id, [])
            assert scenes[0].end_time == 43.9
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_honest_failure_when_no_duration_source_exists():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=None)
        try:
            with pytest.raises(SceneConstructionError, match="No authoritative duration"):
                await construct_and_persist_scenes(db, va_id, [])
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Minimum-Scene-duration invariant: too close to 0, to D, to another boundary; never clamped.
# ---------------------------------------------------------------------------

async def test_boundary_too_close_to_zero_raises():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            too_close = CANDIDATE_MERGE_WINDOW_SECONDS - 0.01
            records = [_record(too_close, True, "high")]
            with pytest.raises(SceneConstructionError, match="video's own start"):
                await construct_and_persist_scenes(db, va_id, records)
            # Never silently clamped -- no Scene rows exist after the failure.
            result = await db.execute(select(Scene).where(Scene.video_analysis_id == va_id))
            assert result.scalars().all() == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_boundary_too_close_to_duration_raises():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            too_close = 60.0 - (CANDIDATE_MERGE_WINDOW_SECONDS - 0.01)
            records = [_record(too_close, True, "high")]
            with pytest.raises(SceneConstructionError, match="video's own end"):
                await construct_and_persist_scenes(db, va_id, records)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_adjacent_accepted_boundaries_too_close_raises_defensively():
    # Genuinely 10.2A-sourced candidates can never be this close to each other (proven in the
    # Stage 10.2B3 final-contract-lock audit) -- this defends only against non-conformant input.
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            gap = CANDIDATE_MERGE_WINDOW_SECONDS - 0.01
            records = [_record(20.0, True, "high"), _record(20.0 + gap, True, "high")]
            with pytest.raises(SceneConstructionError, match="closer than CANDIDATE_MERGE_WINDOW_SECONDS"):
                await construct_and_persist_scenes(db, va_id, records)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_boundary_exactly_at_the_minimum_distance_is_accepted():
    # The invariant is a strict "less than" floor -- exactly CANDIDATE_MERGE_WINDOW_SECONDS away
    # from an edge is valid, not a violation.
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            records = [_record(CANDIDATE_MERGE_WINDOW_SECONDS, True, "high")]
            scenes = await construct_and_persist_scenes(db, va_id, records)
            assert len(scenes) == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Correct boundary_start/boundary_end provenance.
# ---------------------------------------------------------------------------

async def test_boundary_start_end_provenance_shape():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            refs = {"supporting_speech_segment_ids": [713, 714], "supporting_shot_ids": [3907]}
            records = [_record(25.38, True, "medium", refs)]
            scenes = await construct_and_persist_scenes(db, va_id, records)

            assert scenes[0].details == {"boundary_start": None, "boundary_end": refs}
            assert scenes[1].details == {"boundary_start": refs, "boundary_end": None}
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Sub-shot Scene, multi-shot Scene, a technical cut occurring INSIDE a Scene; Shot.scene_id untouched.
# ---------------------------------------------------------------------------

async def test_sub_shot_and_multi_shot_scene_with_shot_scene_id_untouched():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=43.9)
        try:
            shot_ids = await _add_shots(db, va_id, [(0.0, 39.866667), (39.866667, 43.9)])

            records = [_record(25.38, True, "medium", {"supporting_shot_ids": [shot_ids[0]]})]
            scenes = await construct_and_persist_scenes(db, va_id, records)

            # Scene 1 is entirely INSIDE the first (single, continuous) Shot -- a sub-shot Scene.
            assert scenes[0].start_time == 0.0 and scenes[0].end_time == 25.38
            assert scenes[0].end_time < 39.866667

            # Scene 2 SPANS both Shots -- the real technical cut at 39.866667 falls INSIDE it,
            # corresponding to no Scene boundary at all (it was never an accepted candidate here).
            assert scenes[1].start_time == 25.38 and scenes[1].end_time == 43.9
            assert scenes[1].start_time < 39.866667 < scenes[1].end_time

            # Shot.scene_id is never read or written by this module.
            for shot_id in shot_ids:
                shot = await db.get(Shot, shot_id)
                assert shot.scene_id is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# No existing evidence mutated.
# ---------------------------------------------------------------------------

async def test_no_existing_evidence_row_mutated():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            shot_ids = await _add_shots(db, va_id, [(0.0, 60.0)])
            speech = SpeechSegment(
                video_analysis_id=va_id, start_time=5.0, end_time=10.0, text="original text",
                certainty="MEASURED", source="whisper", produced_by_pass="speech_analysis_v1",
            )
            db.add(speech)
            await db.commit()
            speech_id = speech.id

            shot_before = await db.get(Shot, shot_ids[0])
            shot_snapshot = (shot_before.start_time, shot_before.end_time, shot_before.scene_id, shot_before.certainty)
            speech_before = await db.get(SpeechSegment, speech_id)
            speech_snapshot = (speech_before.start_time, speech_before.end_time, speech_before.text)

            records = [_record(30.0, True, "high", {"supporting_shot_ids": [shot_ids[0]], "supporting_speech_segment_ids": [speech_id]})]
            await construct_and_persist_scenes(db, va_id, records)

            shot_after = await db.get(Shot, shot_ids[0])
            assert (shot_after.start_time, shot_after.end_time, shot_after.scene_id, shot_after.certainty) == shot_snapshot
            speech_after = await db.get(SpeechSegment, speech_id)
            assert (speech_after.start_time, speech_after.end_time, speech_after.text) == speech_snapshot
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Idempotent rerun -- no duplicate Scene or decision-annotation rows.
# ---------------------------------------------------------------------------

async def test_idempotent_rerun_does_not_duplicate():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            records = [_record(30.0, True, "high", {"supporting_shot_ids": [1]})]
            first_scenes = await construct_and_persist_scenes(db, va_id, records)
            second_scenes = await construct_and_persist_scenes(db, va_id, records)

            assert len(first_scenes) == len(second_scenes) == 2
            all_scenes = (await db.execute(select(Scene).where(Scene.video_analysis_id == va_id))).scalars().all()
            assert len(all_scenes) == 2  # not 4 -- the second call short-circuited, no duplicates

            all_annotations = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == BOUNDARY_DECISION_CATEGORY,
            ))).scalars().all()
            assert len(all_annotations) == 1  # not 2

            va = await db.get(VideoAnalysis, va_id)
            assert va.pass_status[SCENE_CONSTRUCTION_PASS_STATUS_KEY] == "complete"
            assert "scene_segmentation" not in va.pass_status  # never collides with Stage 4's own key
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Provider/model provenance.
# ---------------------------------------------------------------------------

async def test_provider_model_provenance_recorded_on_video_analysis():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=60.0)
        try:
            records = [_record(30.0, True, "high", provider="anthropic", model="claude-sonnet-4-6")]
            await construct_and_persist_scenes(db, va_id, records)

            va = await db.get(VideoAnalysis, va_id)
            recorded = va.ai_provider_versions_used["semantic_scene_construction_v1"]
            assert recorded == {"provider": "anthropic", "model": "claude-sonnet-4-6"}
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# RV146-shaped and RV5127-shaped real cases (synthetic fixtures mirroring the real numbers).
# ---------------------------------------------------------------------------

async def test_rv146_shaped_case_zero_accepted_boundaries():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=34.15)
        try:
            # The real RV146 benchmark result: one candidate near 30.175, False/low.
            records = [_record(30.175, False, "low")]
            scenes = await construct_and_persist_scenes(db, va_id, records)
            assert len(scenes) == 1
            assert (scenes[0].start_time, scenes[0].end_time) == (0.0, 34.15)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_rv5127_shaped_case_one_accepted_boundary():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user, duration=43.9)
        try:
            # The real RV5127 benchmark result: ~12.083 False/high, ~25.380 True/medium (accepted),
            # ~39.910 False/medium.
            records = [
                _record(12.083, False, "high"),
                _record(25.380, True, "medium", {"supporting_speech_segment_ids": [713, 714], "supporting_shot_ids": [3907]}),
                _record(39.910, False, "medium"),
            ]
            scenes = await construct_and_persist_scenes(db, va_id, records)
            assert len(scenes) == 2
            assert (scenes[0].start_time, scenes[0].end_time) == (0.0, 25.380)
            assert (scenes[1].start_time, scenes[1].end_time) == (25.380, 43.9)
        finally:
            await _cleanup(db, asset_id, rv_id)
