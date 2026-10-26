"""
Video Deconstructor — Stage 11.2: Hook Window Derivation V1 tests.

Same real-database, direct-service-call convention as test_story_beat_construction_svc.py's own
docstring. No LLM/Anthropic call exists anywhere in this module or its tests -- every case here is
deterministic boundary selection over hand-built Scene/Story-Beat/Shot fixtures.
"""
import pytest
from sqlalchemy import select
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
from app.services.hook_window_svc import (
    HOOK_WINDOW_CATEGORY, MAX_HOOK_WINDOW_SECONDS, HookWindowError, derive_and_persist_hook_window,
)
from app.services.story_beat_construction_svc import STORY_BEAT_CATEGORY

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_analysis(db, user, duration=30.0):
    asset = Asset(
        user_id=user.id, original_filename="stage11_2_test.mp4", stored_filename="stage11_2_test_stored.mp4",
        file_path="uploads/stage11_2_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
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


async def _add_shots(db, va_id, ranges):
    for i, (s, e) in enumerate(ranges):
        db.add(Shot(video_analysis_id=va_id, scene_id=None, order=i, start_time=s, end_time=e,
                    certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
    await db.commit()


async def _add_scenes_with_accepted_boundary(db, va_id, ranges):
    """Ranges partition [0,D]; every Scene but the first gets a populated boundary_start, every
    Scene but the last gets a populated boundary_end -- mirrors real scene_construction_svc output
    exactly (a real accepted boundary, not the degenerate whole-video case)."""
    for i, (s, e) in enumerate(ranges):
        details = None
        if i > 0 or i < len(ranges) - 1:
            details = {
                "boundary_start": {"supporting_shot_ids": []} if i > 0 else None,
                "boundary_end": {"supporting_shot_ids": []} if i < len(ranges) - 1 else None,
            }
        db.add(Scene(video_analysis_id=va_id, order=i, start_time=s, end_time=e, details=details,
                     certainty="INFERRED", source="ai_reasoning", produced_by_pass="semantic_scene_construction_v1"))
    await db.commit()


async def _add_whole_video_scene_no_accepted_boundary(db, va_id, duration):
    db.add(Scene(video_analysis_id=va_id, order=0, start_time=0.0, end_time=duration, details=None,
                 certainty="INFERRED", source="ai_reasoning", produced_by_pass="semantic_scene_construction_v1"))
    await db.commit()


async def _add_story_beats_with_accepted_boundaries(db, va_id, ranges):
    """Mirrors real story_beat_construction_svc output: every beat but the first has a populated
    boundary_start, every beat but the last has a populated boundary_end."""
    for i, (s, e) in enumerate(ranges):
        db.add(AnalysisAnnotation(
            video_analysis_id=va_id, shot_id=None, category=STORY_BEAT_CATEGORY, start_time=s, end_time=e,
            details={
                "boundary_status": "constructed",
                "boundary_start": {"reasoning_attempt_id": 1} if i > 0 else None,
                "boundary_end": {"reasoning_attempt_id": 2} if i < len(ranges) - 1 else None,
            },
            certainty="INFERRED", source="story_beat_construction", produced_by_pass="story_beat_construction_v1",
        ))
    await db.commit()


async def _add_whole_video_story_beat_no_accepted_boundary(db, va_id, duration):
    db.add(AnalysisAnnotation(
        video_analysis_id=va_id, shot_id=None, category=STORY_BEAT_CATEGORY, start_time=0.0, end_time=duration,
        details={"boundary_status": "no_accepted_boundary", "boundary_start": None, "boundary_end": None},
        certainty="INFERRED", source="story_beat_construction", produced_by_pass="story_beat_construction_v1",
    ))
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


# ---------------------------------------------------------------------------
# Priority A — Story Beat boundary.
# ---------------------------------------------------------------------------

async def test_priority_a_early_story_beat_boundary_used():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _add_shots(db, va_id, [(0, 15), (15, 30)])
            await _add_scenes_with_accepted_boundary(db, va_id, [(0, 20), (20, 30)])  # later, should lose to Beat
            await _add_story_beats_with_accepted_boundaries(db, va_id, [(0, 5), (5, 30)])

            result = await derive_and_persist_hook_window(db, va_id)
            assert result["start_time"] == 0.0
            assert result["end_time"] == 5.0
            assert result["derived_from"] == "story_beat"
            assert result["fallback_reason"] is None

            first_beat = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
            ).order_by(AnalysisAnnotation.start_time))).scalars().first()
            assert result["source_id"] == first_beat.id
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_priority_a_story_beat_too_late_falls_through_to_scene():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=40.0)
        try:
            await _add_shots(db, va_id, [(0, 20), (20, 40)])
            await _add_scenes_with_accepted_boundary(db, va_id, [(0, 8), (8, 40)])       # usable
            await _add_story_beats_with_accepted_boundaries(db, va_id, [(0, 25), (25, 40)])  # too late (>15s guard)

            result = await derive_and_persist_hook_window(db, va_id)
            assert result["derived_from"] == "scene"
            assert result["end_time"] == 8.0
            beat_consideration = next(c for c in result["candidates_considered"] if c["source_type"] == "story_beat")
            assert beat_consideration["accepted"] is False
            assert "exceeds" in beat_consideration["reason_rejected"]
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Priority B — Scene boundary.
# ---------------------------------------------------------------------------

async def test_priority_b_no_story_beat_boundary_but_early_scene_boundary():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _add_shots(db, va_id, [(0, 10), (10, 30)])
            await _add_scenes_with_accepted_boundary(db, va_id, [(0, 6), (6, 30)])
            await _add_whole_video_story_beat_no_accepted_boundary(db, va_id, 30.0)  # zero accepted

            result = await derive_and_persist_hook_window(db, va_id)
            assert result["derived_from"] == "scene"
            assert result["end_time"] == 6.0
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Priority C — Shot fallback.
# ---------------------------------------------------------------------------

async def test_priority_c_no_beat_or_scene_boundary_uses_first_shot_fallback():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _add_shots(db, va_id, [(0, 4), (4, 30)])
            await _add_whole_video_scene_no_accepted_boundary(db, va_id, 30.0)
            await _add_whole_video_story_beat_no_accepted_boundary(db, va_id, 30.0)

            result = await derive_and_persist_hook_window(db, va_id)
            assert result["derived_from"] == "shot_fallback"
            assert result["end_time"] == 4.0
            first_shot = (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id).order_by(Shot.order))).scalars().first()
            assert result["source_id"] == first_shot.id
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Priority D — time fallback (the VA159 shape: one long Shot covering the whole video).
# ---------------------------------------------------------------------------

async def test_priority_d_one_long_shot_covering_entire_video_falls_to_time_fallback():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=34.15)
        try:
            await _add_shots(db, va_id, [(0, 30.1), (30.1, 34.15)])  # first Shot itself exceeds the guard
            await _add_whole_video_scene_no_accepted_boundary(db, va_id, 34.15)
            await _add_whole_video_story_beat_no_accepted_boundary(db, va_id, 34.15)

            result = await derive_and_persist_hook_window(db, va_id)
            assert result["derived_from"] == "time_fallback"
            assert result["end_time"] == MAX_HOOK_WINDOW_SECONDS
            assert result["source_id"] is None
            assert result["fallback_reason"] is not None
            shot_consideration = next(c for c in result["candidates_considered"] if c["source_type"] == "shot_fallback")
            assert shot_consideration["accepted"] is False
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_priority_d_zero_evidence_at_all_still_produces_time_fallback():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=20.0)
        try:
            result = await derive_and_persist_hook_window(db, va_id)  # no Shots, no Scenes, no Beats at all
            assert result["derived_from"] == "time_fallback"
            assert result["end_time"] == MAX_HOOK_WINDOW_SECONDS  # 15 <= 20
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Edge cases.
# ---------------------------------------------------------------------------

async def test_very_short_video_time_fallback_clamped_to_duration():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=5.0)
        try:
            result = await derive_and_persist_hook_window(db, va_id)
            assert result["derived_from"] == "time_fallback"
            assert result["end_time"] == 5.0  # min(15, 5) -- never exceeds the video's own duration
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_hook_window_never_exceeds_video_duration_even_from_shot_fallback():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=8.0)
        try:
            await _add_shots(db, va_id, [(0, 8.0)])  # single Shot spans the whole (short) video
            result = await derive_and_persist_hook_window(db, va_id)
            assert result["end_time"] <= 8.0
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_zero_duration_protection_raises():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=0.0)
        try:
            with pytest.raises(HookWindowError):
                await derive_and_persist_hook_window(db, va_id)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_not_found_raises():
    async with _TestSessionLocal() as db:
        with pytest.raises(HookWindowError):
            await derive_and_persist_hook_window(db, 999_999_999)


# ---------------------------------------------------------------------------
# Idempotency, provenance, no mutation.
# ---------------------------------------------------------------------------

async def test_idempotent_rerun_replaces_not_accumulates():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _add_shots(db, va_id, [(0, 15), (15, 30)])
            await _add_story_beats_with_accepted_boundaries(db, va_id, [(0, 5), (5, 30)])

            first = await derive_and_persist_hook_window(db, va_id)
            second = await derive_and_persist_hook_window(db, va_id)
            assert first == second

            rows = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == HOOK_WINDOW_CATEGORY,
            ))).scalars().all())
            assert len(rows) == 1
            assert rows[0].certainty == "MEASURED"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_no_mutation_of_source_evidence():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _add_shots(db, va_id, [(0, 15), (15, 30)])
            await _add_story_beats_with_accepted_boundaries(db, va_id, [(0, 5), (5, 30)])

            shots_before = [(s.id, s.start_time, s.end_time) for s in
                             (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()]
            beats_before = [(b.id, b.details) for b in
                             (await db.execute(select(AnalysisAnnotation).where(
                                 AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
                             ))).scalars().all()]

            await derive_and_persist_hook_window(db, va_id)

            shots_after = [(s.id, s.start_time, s.end_time) for s in
                            (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()]
            beats_after = [(b.id, b.details) for b in
                            (await db.execute(select(AnalysisAnnotation).where(
                                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
                            ))).scalars().all()]
            assert shots_before == shots_after
            assert beats_before == beats_after
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_candidates_considered_records_every_source_regardless_of_outcome():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            await _add_shots(db, va_id, [(0, 15), (15, 30)])
            await _add_scenes_with_accepted_boundary(db, va_id, [(0, 20), (20, 30)])
            await _add_story_beats_with_accepted_boundaries(db, va_id, [(0, 5), (5, 30)])

            result = await derive_and_persist_hook_window(db, va_id)
            source_types = {c["source_type"] for c in result["candidates_considered"]}
            assert source_types == {"story_beat", "scene", "shot_fallback"}
            scene_c = next(c for c in result["candidates_considered"] if c["source_type"] == "scene")
            assert scene_c["accepted"] is False  # 20s > 15s guard, correctly rejected even though a Beat won anyway
        finally:
            await _cleanup(db, asset_id, rv_id)
