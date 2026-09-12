"""
Video Deconstructor — Stage 10 Application Access Checkpoint tests.

Real-database, direct-service-call convention (same as test_story_beat_construction_svc.py's own
docstring). `reason_about_boundary` / `reason_about_story_beat_boundary` are mocked exactly the
same way this suite already mocks every other external-call boundary (patch.object on the name as
imported INTO stage10_deconstruction_svc, since that module imports the functions by name rather
than through a module reference) — no real Anthropic call happens anywhere in this file.

Covers: successful run, repeat/idempotent run (no re-reasoning, identical output), ordered read,
Scene/Story-Beat time-overlap assembly, provenance/evidence references retained, the VA159-style
zero-accepted-boundary degenerate case, not-found behaviour, and no mutation of raw evidence.
"""
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services import stage10_deconstruction_svc
from app.services.semantic_reasoner.contract import ReasonerDecision, ReasonerResult
from app.services.stage10_deconstruction_svc import (
    Stage10PipelineError, get_stage10_deconstruction, run_stage10_pipeline,
)
from app.services.story_beat_reasoner.contract import StoryBeatDecision, StoryBeatResult

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_analysis_with_shots(db, user, duration=30.0, shot_ranges=((0.0, 15.0), (15.0, 30.0))):
    """A ReferenceVideo + VideoAnalysis with real Shot rows, so semantic_boundary_assembly_svc's
    own candidate generation has at least one real shot_boundary nomination to reason about — the
    exact same fixture shape test_scene_construction_svc.py / test_semantic_boundary_assembly_svc.py
    already use, duplicated here per this suite's own established per-file-fixture convention."""
    asset = Asset(
        user_id=user.id, original_filename="stage10_access_test.mp4", stored_filename="stage10_access_test_stored.mp4",
        file_path="uploads/stage10_access_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()
    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
    db.add(va)
    await db.flush()
    for i, (s, e) in enumerate(shot_ranges):
        db.add(Shot(video_analysis_id=va.id, scene_id=None, order=i, start_time=s, end_time=e,
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


def _accepting_scene_reasoner(candidate: dict) -> ReasonerResult:
    return ReasonerResult(
        decision=ReasonerDecision(
            is_semantic_boundary=True, confidence="high", confidence_score=None,
            reasoning="test: accept", evidence_references={"supporting_shot_ids": [
                s["id"] for s in candidate.get("shots_overlapping", [])
            ]},
        ),
        provider="test-provider", model="test-model", candidate_timestamp=candidate["candidate_timestamp"],
        reasoning_contract_version="test-v1",
    )


def _accepting_beat_reasoner(candidate: dict) -> StoryBeatResult:
    return StoryBeatResult(
        decision=StoryBeatDecision(
            is_story_beat_boundary=True, confidence="high", reasoning="test: accept",
            evidence_references={"supporting_shot_ids": [s["id"] for s in candidate.get("shots_overlapping", [])]},
            reasoning_contract_version="test-v1",
        ),
        provider="test-provider", model="test-model", candidate_timestamp=candidate["candidate_timestamp"],
        reasoning_contract_version="test-v1",
    )


def _rejecting_scene_reasoner(candidate: dict) -> ReasonerResult:
    return ReasonerResult(
        decision=ReasonerDecision(is_semantic_boundary=False, confidence="high", confidence_score=None, reasoning="test: reject"),
        provider="test-provider", model="test-model", candidate_timestamp=candidate["candidate_timestamp"],
        reasoning_contract_version="test-v1",
    )


def _rejecting_beat_reasoner(candidate: dict) -> StoryBeatResult:
    return StoryBeatResult(
        decision=StoryBeatDecision(is_story_beat_boundary=False, confidence="high", reasoning="test: reject", reasoning_contract_version="test-v1"),
        provider="test-provider", model="test-model", candidate_timestamp=candidate["candidate_timestamp"],
        reasoning_contract_version="test-v1",
    )


async def test_successful_run_creates_scenes_and_story_beats():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_shots(db, user)
        try:
            with patch.object(stage10_deconstruction_svc, "reason_about_boundary", new=AsyncMock(side_effect=_accepting_scene_reasoner)), \
                 patch.object(stage10_deconstruction_svc, "reason_about_story_beat_boundary", new=AsyncMock(side_effect=_accepting_beat_reasoner)):
                result = await run_stage10_pipeline(db, va_id)

            assert result.scene_candidates_reasoned == 1  # one shot_boundary candidate (15.0)
            assert result.story_beat_candidates_reasoned == 1
            assert result.scenes_count == 2  # one accepted boundary -> two Scenes
            assert result.story_beats_count == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_repeat_run_is_idempotent_no_reasoning_and_same_output():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_shots(db, user)
        try:
            with patch.object(stage10_deconstruction_svc, "reason_about_boundary", new=AsyncMock(side_effect=_accepting_scene_reasoner)), \
                 patch.object(stage10_deconstruction_svc, "reason_about_story_beat_boundary", new=AsyncMock(side_effect=_accepting_beat_reasoner)):
                first = await run_stage10_pipeline(db, va_id)

                second_scene_mock = AsyncMock(side_effect=_accepting_scene_reasoner)
                second_beat_mock = AsyncMock(side_effect=_accepting_beat_reasoner)
                with patch.object(stage10_deconstruction_svc, "reason_about_boundary", new=second_scene_mock), \
                     patch.object(stage10_deconstruction_svc, "reason_about_story_beat_boundary", new=second_beat_mock):
                    second = await run_stage10_pipeline(db, va_id)

            # No candidate is re-offered once durably reasoned -- zero new reasoning calls.
            assert second.scene_candidates_reasoned == 0
            assert second.story_beat_candidates_reasoned == 0
            second_scene_mock.assert_not_awaited()
            second_beat_mock.assert_not_awaited()
            # Deterministic reconstruction from the same durable input -> identical counts.
            assert second.scenes_count == first.scenes_count
            assert second.story_beats_count == first.story_beats_count

            scenes = list((await db.execute(select(Scene).where(Scene.video_analysis_id == va_id))).scalars().all())
            assert len(scenes) == first.scenes_count  # no duplicate rows from the second run
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_read_surface_ordered_scenes_and_overlap_assembly_and_provenance():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_shots(db, user)
        try:
            with patch.object(stage10_deconstruction_svc, "reason_about_boundary", new=AsyncMock(side_effect=_accepting_scene_reasoner)), \
                 patch.object(stage10_deconstruction_svc, "reason_about_story_beat_boundary", new=AsyncMock(side_effect=_accepting_beat_reasoner)):
                await run_stage10_pipeline(db, va_id)

            deconstruction = await get_stage10_deconstruction(db, va_id)
            assert deconstruction["video_analysis_id"] == va_id
            assert deconstruction["reference_video_id"] == rv_id
            assert deconstruction["duration"] == 30.0

            scenes = deconstruction["scenes"]
            assert [s["order"] for s in scenes] == [0, 1]  # ordered
            assert (scenes[0]["start_time"], scenes[0]["end_time"]) == (0.0, 15.0)
            assert (scenes[1]["start_time"], scenes[1]["end_time"]) == (15.0, 30.0)

            # Every Story Beat's range overlaps exactly one of the two Scenes here (the single
            # accepted boundary sits at the same instant for both Scene and Story Beat in this
            # fixture) -- each Beat must appear under the Scene it genuinely overlaps.
            all_listed_beats = scenes[0]["story_beats"] + scenes[1]["story_beats"]
            assert len(all_listed_beats) == 2
            assert scenes[0]["story_beats"][0]["end_time"] == 15.0
            assert scenes[1]["story_beats"][0]["start_time"] == 15.0

            # Provenance survives the read: a real reasoning_attempt_id, provider, model, and
            # dereferenced (not just id-only) shot evidence.
            first_scene_boundary_end = scenes[0]["boundary_end"]
            assert first_scene_boundary_end is not None
            assert first_scene_boundary_end["provider"] == "test-provider"
            assert first_scene_boundary_end["confidence"] == "high"
            assert first_scene_boundary_end["reasoning_attempt_id"] is not None
            cited_shots = first_scene_boundary_end["evidence"]["supporting_shot_ids"]
            assert len(cited_shots) >= 1
            assert cited_shots[0]["start_time"] == 0.0  # dereferenced Shot, not a bare id

            beat_boundary_end = scenes[0]["story_beats"][0]["boundary_end"]
            assert beat_boundary_end["provider"] == "test-provider"
            assert beat_boundary_end["evidence"]["supporting_shot_ids"][0]["start_time"] == 0.0
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_degenerate_zero_accepted_boundary_case():
    """VA159-style: reasoning runs, nothing is accepted -- one whole-video Scene, one
    no_accepted_boundary Story Beat, correctly nested (the Beat spans the whole video, so it
    overlaps the single whole-video Scene)."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_shots(db, user)
        try:
            with patch.object(stage10_deconstruction_svc, "reason_about_boundary", new=AsyncMock(side_effect=_rejecting_scene_reasoner)), \
                 patch.object(stage10_deconstruction_svc, "reason_about_story_beat_boundary", new=AsyncMock(side_effect=_rejecting_beat_reasoner)):
                result = await run_stage10_pipeline(db, va_id)

            assert result.scenes_count == 1
            assert result.story_beats_count == 1

            deconstruction = await get_stage10_deconstruction(db, va_id)
            assert len(deconstruction["scenes"]) == 1
            scene = deconstruction["scenes"][0]
            assert (scene["start_time"], scene["end_time"]) == (0.0, 30.0)
            assert scene["boundary_start"] is None
            assert scene["boundary_end"] is None
            assert len(scene["story_beats"]) == 1
            assert scene["story_beats"][0]["boundary_status"] == "no_accepted_boundary"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_not_found_raises_stage10_pipeline_error():
    async with _TestSessionLocal() as db:
        with pytest.raises(Stage10PipelineError):
            await run_stage10_pipeline(db, 999_999_999)
        with pytest.raises(Stage10PipelineError):
            await get_stage10_deconstruction(db, 999_999_999)


async def test_no_mutation_of_raw_evidence():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis_with_shots(db, user)
        try:
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=1.0, end_time=2.0,
                                  text="original transcript text", certainty="MEASURED", source="whisper"))
            await db.commit()

            shots_before = [(s.id, s.start_time, s.end_time) for s in
                             (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()]
            speech_before = [(s.id, s.text) for s in
                              (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().all()]

            with patch.object(stage10_deconstruction_svc, "reason_about_boundary", new=AsyncMock(side_effect=_accepting_scene_reasoner)), \
                 patch.object(stage10_deconstruction_svc, "reason_about_story_beat_boundary", new=AsyncMock(side_effect=_accepting_beat_reasoner)):
                await run_stage10_pipeline(db, va_id)
            await get_stage10_deconstruction(db, va_id)

            shots_after = [(s.id, s.start_time, s.end_time) for s in
                            (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()]
            speech_after = [(s.id, s.text) for s in
                             (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().all()]

            assert shots_before == shots_after
            assert speech_before == speech_after
        finally:
            await _cleanup(db, asset_id, rv_id)
