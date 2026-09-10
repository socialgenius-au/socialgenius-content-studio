"""
Video Deconstructor — Stage 10.3B7-P2: Story Beat Construction V1.

Real-database, direct create_async_engine/async_sessionmaker convention (same as
tests/test_story_beat_boundary_reasoning_store_svc.py). NO real reasoner / Anthropic call anywhere
-- durable `story_beat_boundary_attempt` rows are hand-built via the B4/B5 store's own
persist_story_beat_reasoning_result. Construction is never invoked against VA159 or VA5368 here.
"""
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.story_beat_boundary_reasoning_store_svc import (
    StoryBeatReasoningRecord,
    persist_story_beat_reasoning_result,
)
from app.services.story_beat_construction_svc import (
    STORY_BEAT_CATEGORY,
    STORY_BEAT_CONSTRUCTION_PASS_NAME,
    STORY_BEAT_CONSTRUCTION_PASS_STATUS_KEY,
    STORY_BEAT_TRANSITION_CLUSTER_WINDOW_SECONDS,
    StoryBeatConstructionError,
    _dedup_transition_clusters,
    construct_and_persist_story_beats,
)
from app.services.story_beat_reasoner.contract import StoryBeatDecision, StoryBeatResult

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_analysis(db, user, duration=30.0):
    asset = Asset(
        user_id=user.id, original_filename="sb_construct_test.mp4", stored_filename="sb_construct_test_stored.mp4",
        file_path="uploads/sb_construct_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
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


async def _add_scenes(db, va_id, ranges):
    for i, (s, e) in enumerate(ranges):
        db.add(Scene(video_analysis_id=va_id, order=i, start_time=s, end_time=e,
                     certainty="INFERRED", source="ai_reasoning", produced_by_pass="semantic_scene_construction_v1"))
    await db.commit()


async def _add_shots(db, va_id, ranges):
    for i, (s, e) in enumerate(ranges):
        db.add(Shot(video_analysis_id=va_id, scene_id=None, order=i, start_time=s, end_time=e,
                    certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
    await db.commit()


async def _cleanup(db, asset_id, rv_id):
    rv = await db.get(ReferenceVideo, rv_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


async def _persist_attempt(db, va_id, ts, decision, confidence, *, speech_ids=None, shot_ids=None,
                           provider="anthropic", model="claude-sonnet-4-6", version="v1", reasoning="synthetic reasoning"):
    refs = {}
    if speech_ids is not None:
        refs["supporting_speech_segment_ids"] = list(speech_ids)
    if shot_ids is not None:
        refs["supporting_shot_ids"] = list(shot_ids)
    dec = StoryBeatDecision(is_story_beat_boundary=decision, confidence=confidence,
                            reasoning=reasoning, evidence_references=refs, reasoning_contract_version=version)
    res = StoryBeatResult(decision=dec, provider=provider, model=model, candidate_timestamp=ts,
                          reasoning_contract_version=version)
    rec = StoryBeatReasoningRecord(result=res, source_nominations=[{"source_type": "speech_gap", "source_id": 1, "timestamp": ts}])
    return await persist_story_beat_reasoning_result(db, va_id, rec)


async def _story_beats(db, va_id):
    return list((await db.execute(select(AnalysisAnnotation).where(
        AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
    ).order_by(AnalysisAnnotation.start_time))).scalars().all())


# ---------------------------------------------------------------------------
# Acceptance policy: True/high, True/medium accepted; True/low, False, None excluded.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("confidence", ["high", "medium"])
async def test_true_medium_or_high_accepted_as_boundary(confidence):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 10.0, True, confidence, speech_ids=[5, 6])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert [(b.start_time, b.end_time) for b in beats] == [(0.0, 10.0), (10.0, 30.0)]
            assert beats[0].details["boundary_end"]["reasoning_attempt_id"] is not None
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_true_low_excluded_gives_whole_video_no_accepted_boundary():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 10.0, True, "low", speech_ids=[5, 6])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert len(beats) == 1
            assert (beats[0].start_time, beats[0].end_time) == (0.0, 30.0)
            assert beats[0].details["boundary_status"] == "no_accepted_boundary"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_false_excluded():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 10.0, False, "high", speech_ids=[5, 6])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert len(beats) == 1 and beats[0].details["boundary_status"] == "no_accepted_boundary"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_none_is_unresolved_never_false_and_ids_retained():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            a1 = await _persist_attempt(db, va_id, 8.0, None, "low", speech_ids=[5, 6])
            a2 = await _persist_attempt(db, va_id, 20.0, None, "low", speech_ids=[7, 8])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert len(beats) == 1
            d = beats[0].details
            assert d["boundary_status"] == "no_accepted_boundary"
            assert d["boundary_start"] is None and d["boundary_end"] is None
            assert d["unresolved_attempt_ids"] == sorted([a1.id, a2.id])
            # None must NOT have been treated as False -- a False-only set would look identical here,
            # so also assert the unresolved ids are explicitly preserved (a False set would give []).
            assert d["unresolved_attempt_ids"] != []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_no_accepted_boundary_from_mixed_false_none_lowtrue_still_just_means_no_boundary():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 5.0, False, "high", speech_ids=[1, 2])
            n1 = await _persist_attempt(db, va_id, 12.0, None, "low", speech_ids=[3, 4])
            await _persist_attempt(db, va_id, 22.0, True, "low", speech_ids=[5, 6])  # excluded low
            beats = await construct_and_persist_story_beats(db, va_id)
            assert len(beats) == 1
            assert beats[0].details["boundary_status"] == "no_accepted_boundary"
            assert beats[0].details["unresolved_attempt_ids"] == [n1.id]  # only the None one
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_zero_reasoning_attempts_constructs_nothing():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            beats = await construct_and_persist_story_beats(db, va_id)
            assert beats == []
            assert await _story_beats(db, va_id) == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Source-edge provenance + internal boundary shape.
# ---------------------------------------------------------------------------

async def test_first_boundary_start_none_last_boundary_end_none_internal_has_exact_attempt_id():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=40.0)
        try:
            b1 = await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6])
            b2 = await _persist_attempt(db, va_id, 25.0, True, "medium", speech_ids=[9, 10])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert [(b.start_time, b.end_time) for b in beats] == [(0.0, 10.0), (10.0, 25.0), (25.0, 40.0)]
            assert beats[0].details["boundary_start"] is None
            assert beats[-1].details["boundary_end"] is None
            assert beats[0].details["boundary_end"]["reasoning_attempt_id"] == b1.id
            assert beats[1].details["boundary_start"]["reasoning_attempt_id"] == b1.id
            assert beats[1].details["boundary_end"]["reasoning_attempt_id"] == b2.id
            assert beats[2].details["boundary_start"]["reasoning_attempt_id"] == b2.id
            # reasoning_attempt_ids: only inferred edges, source bounds excluded
            assert beats[0].details["reasoning_attempt_ids"] == [b1.id]
            assert sorted(beats[1].details["reasoning_attempt_ids"]) == sorted([b1.id, b2.id])
            assert beats[2].details["reasoning_attempt_ids"] == [b2.id]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_boundary_object_is_ids_only_no_transcript_text():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6], shot_ids=[3],
                                   reasoning="the model's full prose reasoning that must NOT be copied into the beat row")
            beats = await construct_and_persist_story_beats(db, va_id)
            bo = beats[0].details["boundary_end"]
            assert set(bo) == {
                "reasoning_attempt_id", "candidate_timestamp", "provider", "model", "prompt_version",
                "confidence", "supporting_shot_ids", "supporting_frame_ids",
                "supporting_speech_segment_ids", "supporting_text_element_ids", "supporting_annotation_ids",
            }
            assert bo["supporting_speech_segment_ids"] == [5, 6]
            assert bo["supporting_shot_ids"] == [3]
            assert bo["supporting_frame_ids"] == [] and bo["supporting_text_element_ids"] == []
            import json
            assert "full prose reasoning" not in json.dumps(beats[0].details)
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Transition-cluster dedup policy (Verdict B).
# ---------------------------------------------------------------------------

def _fake(id_, ts, conf, speech):
    return SimpleNamespace(id=id_, start_time=ts, details={
        "confidence": conf, "evidence_references": {"supporting_speech_segment_ids": list(speech)},
    })


def test_transition_cluster_constant_is_1_5_and_not_the_candidate_window():
    from app.services.semantic_boundary_assembly_svc import CANDIDATE_MERGE_WINDOW_SECONDS
    assert STORY_BEAT_TRANSITION_CLUSTER_WINDOW_SECONDS == 1.5
    assert STORY_BEAT_TRANSITION_CLUSTER_WINDOW_SECONDS != CANDIDATE_MERGE_WINDOW_SECONDS


def test_dedup_close_overlapping_speech_is_clustered():
    survivors, co = _dedup_transition_clusters([_fake(1, 10.0, "medium", [5, 6]), _fake(2, 10.9, "high", [5, 6])])
    assert [s.id for s in survivors] == [2]          # highest confidence wins
    assert co == {2: [1]}                             # discarded id recorded


def test_dedup_confidence_tie_earliest_timestamp_wins():
    survivors, co = _dedup_transition_clusters([_fake(1, 10.0, "medium", [5, 6]), _fake(2, 10.9, "medium", [5, 6])])
    assert [s.id for s in survivors] == [1]
    assert co == {1: [2]}


def test_dedup_final_deterministic_tie_lowest_id_wins():
    # Same confidence AND same timestamp -> lowest id. (Reachable only at the helper level; the
    # entry point's per-candidate latest-selection collapses identical-timestamp rows first.)
    survivors, co = _dedup_transition_clusters([_fake(7, 10.0, "high", [5, 6]), _fake(3, 10.0, "high", [5, 6])])
    assert [s.id for s in survivors] == [3]
    assert co == {3: [7]}


def test_dedup_close_but_non_overlapping_speech_stays_two_boundaries():
    survivors, co = _dedup_transition_clusters([_fake(1, 10.0, "high", [5, 6]), _fake(2, 10.8, "high", [20, 21])])
    assert [s.id for s in survivors] == [1, 2]
    assert co == {}


def test_dedup_overlapping_speech_but_far_apart_stays_two_boundaries():
    survivors, co = _dedup_transition_clusters([_fake(1, 10.0, "high", [5, 6]), _fake(2, 12.0, "high", [5, 6])])
    assert [s.id for s in survivors] == [1, 2]
    assert co == {}


def test_dedup_empty_speech_never_clusters():
    survivors, _ = _dedup_transition_clusters([_fake(1, 10.0, "high", []), _fake(2, 10.3, "high", [])])
    assert [s.id for s in survivors] == [1, 2]


async def test_end_to_end_cluster_records_co_nominated_on_the_beat():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            lo = await _persist_attempt(db, va_id, 10.0, True, "medium", speech_ids=[5, 6])
            hi = await _persist_attempt(db, va_id, 10.9, True, "high", speech_ids=[5, 6])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert len(beats) == 2  # one surviving boundary
            assert abs(beats[0].end_time - 10.9) < 1e-9  # the high-confidence winner's timestamp
            assert beats[0].details["boundary_end"]["reasoning_attempt_id"] == hi.id
            assert beats[0].details["co_nominated_attempt_ids"] == [lo.id]
            assert beats[1].details["co_nominated_attempt_ids"] == [lo.id]
            assert beats[0].details["boundary_end"]["co_nominated_attempt_ids"] == [lo.id]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_end_to_end_close_non_overlapping_speech_yields_short_middle_beat_no_min_duration():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6])
            await _persist_attempt(db, va_id, 10.8, True, "high", speech_ids=[20, 21])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert [(round(b.start_time, 4), round(b.end_time, 4)) for b in beats] == [(0.0, 10.0), (10.0, 10.8), (10.8, 30.0)]
            assert round(beats[1].end_time - beats[1].start_time, 4) == 0.8  # sub-second beat kept
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Scene / Shot independence (real overlap computed read-time).
# ---------------------------------------------------------------------------

async def test_beat_may_cross_scene_boundary_no_fk_no_truncation():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _add_scenes(db, va_id, [(0.0, 15.0), (15.0, 30.0)])
            await _persist_attempt(db, va_id, 20.0, True, "high", speech_ids=[5, 6])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert [(b.start_time, b.end_time) for b in beats] == [(0.0, 20.0), (20.0, 30.0)]
            # beat [0,20] straddles the Scene cut at 15 -- not snapped, not truncated
            scenes = list((await db.execute(select(Scene).where(Scene.video_analysis_id == va_id))).scalars().all())
            first = beats[0]
            overlapped = [s for s in scenes if min(first.end_time, s.end_time) - max(first.start_time, s.start_time) > 0]
            assert len(overlapped) == 2
            import json
            for b in beats:
                assert "scene_id" not in json.dumps(b.details)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_beat_may_cross_shot_boundary_and_shot_id_is_none():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _add_shots(db, va_id, [(0.0, 15.0), (15.0, 30.0)])
            await _persist_attempt(db, va_id, 20.0, True, "high", speech_ids=[5, 6])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert all(b.shot_id is None for b in beats)
            shots = list((await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all())
            first = beats[0]
            overlapped = [s for s in shots if min(first.end_time, s.end_time) - max(first.start_time, s.start_time) > 0]
            assert len(overlapped) == 2  # beat [0,20] contains the technical cut at 15
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# None inside a constructed beat.
# ---------------------------------------------------------------------------

async def test_none_inside_beat_recorded_without_altering_boundaries():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            b1 = await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6])
            n1 = await _persist_attempt(db, va_id, 18.0, None, "low", speech_ids=[100, 101])
            b2 = await _persist_attempt(db, va_id, 25.0, True, "high", speech_ids=[9, 10])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert [(b.start_time, b.end_time) for b in beats] == [(0.0, 10.0), (10.0, 25.0), (25.0, 30.0)]
            mid = beats[1]
            assert mid.details["examined_unresolved_attempt_ids"] == [n1.id]
            assert mid.details["boundary_start"]["reasoning_attempt_id"] == b1.id
            assert mid.details["boundary_end"]["reasoning_attempt_id"] == b2.id
            assert "examined_unresolved_attempt_ids" not in beats[0].details
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Idempotency / deliberate reconstruction.
# ---------------------------------------------------------------------------

async def test_deterministic_rerun_creates_no_duplicates():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6])
            first = await construct_and_persist_story_beats(db, va_id)
            second = await construct_and_persist_story_beats(db, va_id)
            assert [(b.start_time, b.end_time) for b in first] == [(b.start_time, b.end_time) for b in second]
            assert len(await _story_beats(db, va_id)) == 2  # not 4
            va = await db.get(VideoAnalysis, va_id)
            assert va.pass_status[STORY_BEAT_CONSTRUCTION_PASS_STATUS_KEY] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_newer_durable_attempt_causes_deliberate_reconstruction_and_old_attempts_untouched():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            old = await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6], reasoning="first attempt: boundary")
            beats1 = await construct_and_persist_story_beats(db, va_id)
            assert len(beats1) == 2

            # A newer attempt for the SAME candidate now says False.
            new = await _persist_attempt(db, va_id, 10.05, False, "high", speech_ids=[5, 6], reasoning="rerun: not a boundary")
            beats2 = await construct_and_persist_story_beats(db, va_id)
            assert len(beats2) == 1
            assert beats2[0].details["boundary_status"] == "no_accepted_boundary"

            # Both durable attempts still present and unchanged.
            attempts = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id,
                AnalysisAnnotation.category == "story_beat_boundary_attempt",
            ).order_by(AnalysisAnnotation.id))).scalars().all())
            assert {a.id for a in attempts} == {old.id, new.id}
            assert attempts[0].reasoning == "first attempt: boundary"
            assert attempts[1].reasoning == "rerun: not a boundary"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Provider/version provenance.
# ---------------------------------------------------------------------------

async def test_mixed_provider_model_provenance_recorded_and_preserved_per_boundary():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=40.0)
        try:
            await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6],
                                   provider="anthropic", model="claude-sonnet-4-6", version="v1")
            await _persist_attempt(db, va_id, 25.0, True, "high", speech_ids=[9, 10],
                                   provider="openai", model="gpt-x", version="v2")
            beats = await construct_and_persist_story_beats(db, va_id)
            va = await db.get(VideoAnalysis, va_id)
            recorded = va.ai_provider_versions_used[STORY_BEAT_CONSTRUCTION_PASS_NAME]
            assert recorded == [
                {"provider": "anthropic", "model": "claude-sonnet-4-6"},
                {"provider": "openai", "model": "gpt-x"},
            ]
            assert beats[0].details["boundary_end"]["prompt_version"] == "v1"
            assert beats[1].details["boundary_end"]["prompt_version"] == "v2"
            assert beats[1].details["boundary_end"]["provider"] == "openai"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_no_accepted_boundaries_clears_stale_provider_versions_entry():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6])
            await construct_and_persist_story_beats(db, va_id)
            va = await db.get(VideoAnalysis, va_id)
            assert STORY_BEAT_CONSTRUCTION_PASS_NAME in (va.ai_provider_versions_used or {})

            # Replace with a newer False attempt, reconstruct -> no accepted boundary -> entry cleared.
            await _persist_attempt(db, va_id, 10.05, False, "high", speech_ids=[5, 6])
            await construct_and_persist_story_beats(db, va_id)
            va = await db.get(VideoAnalysis, va_id)
            assert STORY_BEAT_CONSTRUCTION_PASS_NAME not in (va.ai_provider_versions_used or {})
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Error discipline.
# ---------------------------------------------------------------------------

async def test_boundary_at_source_edge_raises_rather_than_emitting_zero_duration():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 0.0, True, "high", speech_ids=[5, 6])
            with pytest.raises(StoryBeatConstructionError, match="zero/negative-duration"):
                await construct_and_persist_story_beats(db, va_id)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_boundary_outside_duration_raises():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 999.0, True, "high", speech_ids=[5, 6])
            with pytest.raises(StoryBeatConstructionError, match="outside this video's own duration"):
                await construct_and_persist_story_beats(db, va_id)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_duration_falls_back_to_max_shot_end_when_reference_duration_missing():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            rv = await db.get(ReferenceVideo, rv_id)
            rv.duration = None
            await db.commit()
            await _add_shots(db, va_id, [(0.0, 12.0), (12.0, 27.5)])
            await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6])
            beats = await construct_and_persist_story_beats(db, va_id)
            assert (beats[-1].start_time, beats[-1].end_time) == (10.0, 27.5)  # max(Shot.end_time)
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Final-row semantics + non-mutation + structural.
# ---------------------------------------------------------------------------

async def test_final_row_semantics():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6])
            beats = await construct_and_persist_story_beats(db, va_id)
            for b in beats:
                assert b.category == "story_beat"
                assert b.certainty == "INFERRED"
                assert b.source == "story_beat_construction"
                assert b.produced_by_pass == "story_beat_construction_v1"
                assert b.shot_id is None
                assert b.reasoning is None
                import json
                blob = json.dumps(b.details)
                for banned in ("narrative_role", "beat_type", "rhetorical_move", "hook", "cta",
                               "teaching_point", "tutorial", "scene_id"):
                    assert banned not in blob
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_no_semantic_scene_or_reasoning_rows_mutated():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _add_scenes(db, va_id, [(0.0, 30.0)])
            # a Scene-side attempt row + snapshot row, to prove construction leaves them alone
            db.add(AnalysisAnnotation(video_analysis_id=va_id, shot_id=None, category="semantic_boundary_attempt",
                                     start_time=5.0, end_time=5.0, details={"is_semantic_boundary": False, "confidence": "high"},
                                     certainty="INFERRED", source="ai_reasoning", produced_by_pass="semantic_boundary_reasoning_v1"))
            db.add(AnalysisAnnotation(video_analysis_id=va_id, shot_id=None, category="semantic_boundary_decision",
                                     start_time=5.0, end_time=5.0, details={"is_semantic_boundary": False, "confidence": "high"},
                                     certainty="INFERRED", source="ai_reasoning", produced_by_pass="semantic_boundary_reasoning_v1"))
            await db.commit()

            def _counts():
                return db.execute(select(AnalysisAnnotation.category, func.count()).where(
                    AnalysisAnnotation.video_analysis_id == va_id).group_by(AnalysisAnnotation.category))

            before = dict((await _counts()).all())
            await _persist_attempt(db, va_id, 10.0, True, "high", speech_ids=[5, 6])
            await construct_and_persist_story_beats(db, va_id)
            after = dict((await _counts()).all())

            assert before["semantic_boundary_attempt"] == after["semantic_boundary_attempt"] == 1
            assert before["semantic_boundary_decision"] == after["semantic_boundary_decision"] == 1
            scenes = (await db.execute(select(func.count()).select_from(Scene).where(Scene.video_analysis_id == va_id))).scalar_one()
            assert scenes == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


def test_module_makes_no_external_api_import_and_no_scene_construction_import():
    import ast
    import inspect
    import app.services.story_beat_construction_svc as module
    tree = ast.parse(inspect.getsource(module))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    assert "anthropic" not in names
    assert not any(n.startswith("app.services.story_beat_reasoner.router") for n in names)
    assert not any(n.startswith("app.services.story_beat_reasoner.providers") for n in names)
    assert "reason_about_story_beat_boundary" not in names
    assert "app.services.scene_construction_svc" not in names  # sibling, never a reuse


def test_module_introduces_no_orm_model_or_migration():
    import ast
    import inspect
    import app.services.story_beat_construction_svc as module
    src = inspect.getsource(module)
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.ClassDef):
            bases = {b.id for b in node.bases if isinstance(b, ast.Name)}
            assert "Base" not in bases
    assert "alembic" not in src.lower()
    assert "ADD COLUMN" not in src.upper()
