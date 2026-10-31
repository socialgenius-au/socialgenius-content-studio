"""
Video Deconstructor — architectural provision: PINNED VideoAnalysis read path.

Same real-database, direct-router-call, no-HTTP-client convention as every other reference-video
router test file in this suite. Covers the exact non-negotiable behaviour this provision requires:

A. Existing/default caller (no video_analysis_id) still receives the latest analysis.
B. An explicit video_analysis_id returns that EXACT older analysis, even when a newer one exists.
C. An unknown video_analysis_id never silently falls back to latest — it 404s.
D. A video_analysis_id belonging to a DIFFERENT ReferenceVideo cannot be used to retrieve this
   ReferenceVideo's evidence — it 404s, never leaks the other video's data.
E. Explicit selection is read-only — no VideoAnalysis/ReferenceVideo row is created, deleted, or
   modified merely by reading with a pinned id.

This is purely an additive read-path change — no Tutorial/TeachingPoint domain object, no
migration, no mutation of any kind.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest
from fastapi import HTTPException

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.routers.reference_videos import get_reference_video

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_reference_with_two_analyses(db, user: User) -> tuple[int, int, int, int]:
    """One ReferenceVideo with TWO VideoAnalysis rows — an older one (already 'complete', with
    its own distinguishing pass_status) and a newer 'latest' one (a different, later
    analysis_tier and pass_status) — so a test can prove exactly which one was actually
    returned."""
    asset = Asset(
        user_id=user.id, original_filename="pinned_test.mp4", stored_filename="pinned_test_stored.mp4",
        file_path="uploads/pinned_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()

    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=10.0)
    db.add(rv)
    await db.flush()

    older = VideoAnalysis(
        reference_video_id=rv.id, analysis_tier="quick", status="complete",
        pass_status={"technical_probe": "complete", "marker": "older_analysis"},
    )
    db.add(older)
    # Committed in its OWN transaction (not just flushed) before the second row is created —
    # Postgres's own `now()`/CURRENT_TIMESTAMP is transaction-start time, not wall-clock, so two
    # rows inserted within the SAME transaction get an IDENTICAL created_at and make "latest by
    # created_at DESC" ambiguous. Real usage always creates these across separate requests
    # (separate transactions), so this mirrors that, not a change to the pass's own ordering rule.
    await db.commit()

    newer = VideoAnalysis(
        reference_video_id=rv.id, analysis_tier="deep", status="complete",
        pass_status={"technical_probe": "complete", "marker": "newer_analysis"},
    )
    db.add(newer)
    await db.commit()
    return rv.id, asset.id, older.id, newer.id


async def _make_second_unrelated_reference(db, user: User) -> tuple[int, int, int]:
    asset = Asset(
        user_id=user.id, original_filename="other_test.mp4", stored_filename="other_test_stored.mp4",
        file_path="uploads/other_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=5.0)
    db.add(rv)
    await db.flush()
    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={"marker": "other_video_analysis"})
    db.add(va)
    await db.flush()
    await db.commit()
    return rv.id, asset.id, va.id


async def _cleanup(db, asset_ids: list[int], reference_video_ids: list[int]):
    for rv_id in reference_video_ids:
        rv = await db.get(ReferenceVideo, rv_id)
        if rv:
            await db.delete(rv)
            await db.flush()
    for asset_id in asset_ids:
        asset = await db.get(Asset, asset_id)
        if asset:
            await db.delete(asset)
    await db.commit()


# ---------------------------------------------------------------------------
# A. Default (no video_analysis_id) — latest, unchanged behaviour.
# ---------------------------------------------------------------------------

async def test_default_call_returns_latest_analysis():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, older_id, newer_id = await _make_reference_with_two_analyses(db, user)
        try:
            response = await get_reference_video(reference_video_id=rv_id, video_analysis_id=None, db=db, user=user)
            assert response.latest_analysis.id == newer_id
            assert response.latest_analysis.pass_status["marker"] == "newer_analysis"
        finally:
            await _cleanup(db, [asset_id], [rv_id])


async def test_omitting_parameter_entirely_still_returns_latest():
    """Confirms the parameter is genuinely optional at the Python call level, not just when
    explicitly passed None."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, older_id, newer_id = await _make_reference_with_two_analyses(db, user)
        try:
            response = await get_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.id == newer_id
        finally:
            await _cleanup(db, [asset_id], [rv_id])


# ---------------------------------------------------------------------------
# B. Explicit video_analysis_id returns that exact older analysis.
# ---------------------------------------------------------------------------

async def test_explicit_older_analysis_id_returns_older_analysis_not_latest():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, older_id, newer_id = await _make_reference_with_two_analyses(db, user)
        try:
            response = await get_reference_video(reference_video_id=rv_id, video_analysis_id=older_id, db=db, user=user)
            assert response.latest_analysis.id == older_id
            assert response.latest_analysis.pass_status["marker"] == "older_analysis"
            assert response.latest_analysis.analysis_tier == "quick"
        finally:
            await _cleanup(db, [asset_id], [rv_id])


async def test_explicit_current_latest_id_still_works_explicitly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, older_id, newer_id = await _make_reference_with_two_analyses(db, user)
        try:
            response = await get_reference_video(reference_video_id=rv_id, video_analysis_id=newer_id, db=db, user=user)
            assert response.latest_analysis.id == newer_id
        finally:
            await _cleanup(db, [asset_id], [rv_id])


# ---------------------------------------------------------------------------
# C. Unknown video_analysis_id never falls back to latest.
# ---------------------------------------------------------------------------

async def test_unknown_video_analysis_id_404s_never_falls_back_to_latest():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, older_id, newer_id = await _make_reference_with_two_analyses(db, user)
        try:
            nonexistent_id = max(older_id, newer_id) + 1_000_000
            with pytest.raises(HTTPException) as exc_info:
                await get_reference_video(reference_video_id=rv_id, video_analysis_id=nonexistent_id, db=db, user=user)
            assert exc_info.value.status_code == 404
        finally:
            await _cleanup(db, [asset_id], [rv_id])


# ---------------------------------------------------------------------------
# D. video_analysis_id belonging to a different ReferenceVideo cannot leak.
# ---------------------------------------------------------------------------

async def test_analysis_id_from_another_reference_video_is_rejected_never_leaks():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, older_id, newer_id = await _make_reference_with_two_analyses(db, user)
        other_rv_id, other_asset_id, other_va_id = await _make_second_unrelated_reference(db, user)
        try:
            with pytest.raises(HTTPException) as exc_info:
                # Request reference_video A's own endpoint, but pass reference_video B's own
                # VideoAnalysis id — must be rejected, never silently served, never leaked.
                await get_reference_video(reference_video_id=rv_id, video_analysis_id=other_va_id, db=db, user=user)
            assert exc_info.value.status_code == 404

            # And the reverse must also be true: reference_video A's own analysis ids must not
            # be usable against reference_video B's own endpoint either.
            with pytest.raises(HTTPException) as exc_info2:
                await get_reference_video(reference_video_id=other_rv_id, video_analysis_id=older_id, db=db, user=user)
            assert exc_info2.value.status_code == 404
        finally:
            await _cleanup(db, [asset_id, other_asset_id], [rv_id, other_rv_id])


# ---------------------------------------------------------------------------
# E. Read-only — no mutation of any kind.
# ---------------------------------------------------------------------------

async def test_pinned_read_never_mutates_analysis_or_reference_video():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, older_id, newer_id = await _make_reference_with_two_analyses(db, user)
        try:
            before_older = await db.get(VideoAnalysis, older_id)
            before_newer = await db.get(VideoAnalysis, newer_id)
            before_rv = await db.get(ReferenceVideo, rv_id)
            before_older_snapshot = (before_older.status, dict(before_older.pass_status), before_older.analysis_tier)
            before_newer_snapshot = (before_newer.status, dict(before_newer.pass_status), before_newer.analysis_tier)
            before_rv_snapshot = (before_rv.duration, before_rv.rights_status)
            before_analysis_count = len((await db.execute(
                select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id)
            )).scalars().all())

            await get_reference_video(reference_video_id=rv_id, video_analysis_id=older_id, db=db, user=user)
            await get_reference_video(reference_video_id=rv_id, video_analysis_id=newer_id, db=db, user=user)
            await get_reference_video(reference_video_id=rv_id, db=db, user=user)  # default path too

            after_older = await db.get(VideoAnalysis, older_id)
            after_newer = await db.get(VideoAnalysis, newer_id)
            after_rv = await db.get(ReferenceVideo, rv_id)
            assert (after_older.status, dict(after_older.pass_status), after_older.analysis_tier) == before_older_snapshot
            assert (after_newer.status, dict(after_newer.pass_status), after_newer.analysis_tier) == before_newer_snapshot
            assert (after_rv.duration, after_rv.rights_status) == before_rv_snapshot
            after_analysis_count = len((await db.execute(
                select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id)
            )).scalars().all())
            assert after_analysis_count == before_analysis_count  # no row created or deleted
        finally:
            await _cleanup(db, [asset_id], [rv_id])


async def test_pinned_read_never_mutates_even_on_rejected_cross_video_attempt():
    """A rejected (404) cross-ReferenceVideo attempt must also leave everything untouched —
    confirms the rejection path itself performs no write."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, older_id, newer_id = await _make_reference_with_two_analyses(db, user)
        other_rv_id, other_asset_id, other_va_id = await _make_second_unrelated_reference(db, user)
        try:
            before_count = len((await db.execute(select(VideoAnalysis))).scalars().all())
            with pytest.raises(HTTPException):
                await get_reference_video(reference_video_id=rv_id, video_analysis_id=other_va_id, db=db, user=user)
            after_count = len((await db.execute(select(VideoAnalysis))).scalars().all())
            assert after_count == before_count
        finally:
            await _cleanup(db, [asset_id, other_asset_id], [rv_id, other_rv_id])
