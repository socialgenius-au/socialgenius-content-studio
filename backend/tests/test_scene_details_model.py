"""
Video Deconstructor — Stage 10 structural provision: Scene.details v1.

Model-level tests only — no Stage 10 inference exists yet, so there is no router endpoint to
call; this exercises the `Scene` model directly against the real database, same
create_async_engine/async_sessionmaker convention as every other test file in this suite.

Covers: Scene can exist with details=NULL; the bounded v1 details structure persists/reads back
correctly; multiple ids of the same evidence type are preserved; missing optional keys remain
valid; persisting details never modifies any cited evidence row; Shot.scene_id remains untouched/
NULL; and Scene.start_time/end_time are fully independent of Shot boundaries (a Scene may begin
and end entirely inside one continuous technical Shot, without splitting or modifying it, and
without ever setting Shot.scene_id).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_reference_with_shot(db, user: User, shot_start: float = 0.0, shot_end: float = 60.0) -> tuple[int, int, int, int]:
    """One ReferenceVideo + VideoAnalysis + ONE continuous technical Shot spanning [shot_start,
    shot_end] — the exact worked example the task itself specifies (a single uninterrupted
    60-second shot)."""
    asset = Asset(
        user_id=user.id, original_filename="scene_details_test.mp4", stored_filename="scene_details_test_stored.mp4",
        file_path="uploads/scene_details_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()

    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=shot_end)
    db.add(rv)
    await db.flush()

    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={"scene_segmentation": "complete"})
    db.add(va)
    await db.flush()

    shot = Shot(
        video_analysis_id=va.id, scene_id=None, order=0, start_time=shot_start, end_time=shot_end,
        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1",
    )
    db.add(shot)
    await db.flush()

    await db.commit()
    return rv.id, asset.id, va.id, shot.id


async def _cleanup(db, asset_id: int, reference_video_id: int):
    rv = await db.get(ReferenceVideo, reference_video_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


# ---------------------------------------------------------------------------
# A. Scene can exist with details = NULL.
# ---------------------------------------------------------------------------

async def test_scene_can_exist_with_details_null():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_reference_with_shot(db, user)
        try:
            scene = Scene(
                video_analysis_id=va_id, order=0, start_time=12.0, end_time=43.0,
                certainty="INFERRED", details=None,
            )
            db.add(scene)
            await db.commit()
            await db.refresh(scene)
            assert scene.id is not None
            assert scene.details is None

            reloaded = await db.get(Scene, scene.id)
            assert reloaded.details is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# B. Bounded v1 details structure persists/reads correctly.
# ---------------------------------------------------------------------------

async def test_scene_persists_and_reads_bounded_v1_details():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_reference_with_shot(db, user)
        try:
            details = {
                "supporting_shot_ids": [shot_id],
                "supporting_frame_ids": [4501, 4502],
                "supporting_text_element_ids": [9001],
                "supporting_speech_segment_ids": [7001, 7002, 7003],
                "supporting_annotation_ids": [5001],
            }
            scene = Scene(
                video_analysis_id=va_id, order=0, start_time=12.0, end_time=43.0,
                certainty="INFERRED", details=details,
            )
            db.add(scene)
            await db.commit()
            scene_id = scene.id

            # Read back via a genuinely SEPARATE session/connection -- proves this round-tripped
            # through the real database column, not merely an in-memory Python attribute.
            async with _TestSessionLocal() as db2:
                reloaded = await db2.get(Scene, scene_id)
                assert reloaded.details == details
                assert reloaded.details["supporting_shot_ids"] == [shot_id]
                assert reloaded.details["supporting_speech_segment_ids"] == [7001, 7002, 7003]
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# C. Multiple supporting IDs of the same evidence type are preserved.
# ---------------------------------------------------------------------------

async def test_multiple_ids_of_same_evidence_type_preserved_in_order_and_count():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_reference_with_shot(db, user)
        try:
            many_ids = [100, 101, 102, 103, 104]
            scene = Scene(
                video_analysis_id=va_id, order=0, start_time=0.0, end_time=10.0,
                certainty="INFERRED", details={"supporting_speech_segment_ids": many_ids},
            )
            db.add(scene)
            await db.commit()
            scene_id = scene.id

            reloaded = await db.get(Scene, scene_id)
            assert reloaded.details["supporting_speech_segment_ids"] == many_ids
            assert len(reloaded.details["supporting_speech_segment_ids"]) == 5
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# D. Missing optional keys remain valid.
# ---------------------------------------------------------------------------

async def test_missing_optional_keys_remain_valid():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_reference_with_shot(db, user)
        try:
            # Only ONE of the five v1 keys present -- the other four are simply absent, not
            # present-with-an-empty-list -- both must be valid, since no key is required.
            scene = Scene(
                video_analysis_id=va_id, order=0, start_time=0.0, end_time=10.0,
                certainty="INFERRED", details={"supporting_shot_ids": [shot_id]},
            )
            db.add(scene)
            await db.commit()
            reloaded = await db.get(Scene, scene.id)
            assert reloaded.details == {"supporting_shot_ids": [shot_id]}
            assert "supporting_frame_ids" not in reloaded.details

            # An entirely empty details dict must also be valid (every key simply absent).
            scene2 = Scene(
                video_analysis_id=va_id, order=1, start_time=10.0, end_time=20.0,
                certainty="INFERRED", details={},
            )
            db.add(scene2)
            await db.commit()
            reloaded2 = await db.get(Scene, scene2.id)
            assert reloaded2.details == {}
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# E. Persisting details does not modify cited evidence rows.
# ---------------------------------------------------------------------------

async def test_persisting_details_never_modifies_cited_evidence_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_reference_with_shot(db, user)
        try:
            text_el = TextElement(
                video_analysis_id=va_id, shot_id=shot_id, text="pre-existing OCR text",
                x=0.1, y=0.1, width=0.2, height=0.1, start_time=5.0, end_time=5.0,
                certainty="MEASURED", confidence_score=0.9,
            )
            db.add(text_el)
            await db.commit()
            text_el_id = text_el.id
            before_text_snapshot = (text_el.text, text_el.confidence_score, text_el.start_time, text_el.end_time)

            before_shot = await db.get(Shot, shot_id)
            before_shot_snapshot = (before_shot.start_time, before_shot.end_time, before_shot.scene_id, before_shot.certainty)

            scene = Scene(
                video_analysis_id=va_id, order=0, start_time=12.0, end_time=43.0,
                certainty="INFERRED",
                details={"supporting_shot_ids": [shot_id], "supporting_text_element_ids": [text_el_id]},
            )
            db.add(scene)
            await db.commit()

            after_text = await db.get(TextElement, text_el_id)
            assert (after_text.text, after_text.confidence_score, after_text.start_time, after_text.end_time) == before_text_snapshot

            after_shot = await db.get(Shot, shot_id)
            assert (after_shot.start_time, after_shot.end_time, after_shot.scene_id, after_shot.certainty) == before_shot_snapshot
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# F. Shot.scene_id remains untouched/NULL.
# ---------------------------------------------------------------------------

async def test_shot_scene_id_remains_null_even_when_cited_in_scene_details():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_reference_with_shot(db, user)
        try:
            shot_before = await db.get(Shot, shot_id)
            assert shot_before.scene_id is None

            scene = Scene(
                video_analysis_id=va_id, order=0, start_time=12.0, end_time=43.0,
                certainty="INFERRED", details={"supporting_shot_ids": [shot_id]},
            )
            db.add(scene)
            await db.commit()

            shot_after = await db.get(Shot, shot_id)
            assert shot_after.scene_id is None  # never set, not by this row's own creation
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# G. Scene.start_time/end_time are independent of Shot boundaries — the exact worked example.
# ---------------------------------------------------------------------------

async def test_scene_time_range_independent_of_shot_boundaries_worked_example():
    """Shot: 0.0-60.0 (one continuous technical shot). Scene: 12.0-43.0 (entirely INSIDE the
    shot, on neither edge). Proves the Scene persists normally without splitting/modifying the
    Shot and without ever setting Shot.scene_id."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_reference_with_shot(db, user, shot_start=0.0, shot_end=60.0)
        try:
            shot_before = await db.get(Shot, shot_id)
            before_snapshot = (shot_before.start_time, shot_before.end_time, shot_before.scene_id)
            assert before_snapshot == (0.0, 60.0, None)

            scene = Scene(
                video_analysis_id=va_id, order=0, start_time=12.0, end_time=43.0,
                certainty="INFERRED", details={"supporting_shot_ids": [shot_id]},
            )
            db.add(scene)
            await db.commit()
            await db.refresh(scene)

            # The Scene's own range is genuinely narrower than, and fully contained inside, the
            # single Shot's own range -- no splitting occurred anywhere.
            assert scene.start_time == 12.0
            assert scene.end_time == 43.0
            assert shot_before.start_time < scene.start_time < scene.end_time < shot_before.end_time

            # The Shot row itself is completely unmodified by the Scene's own creation.
            shot_after = await db.get(Shot, shot_id)
            assert (shot_after.start_time, shot_after.end_time, shot_after.scene_id) == before_snapshot

            # Exactly one Shot row still exists for this VideoAnalysis -- no split occurred.
            shots = (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()
            assert len(shots) == 1
            assert shots[0].id == shot_id
        finally:
            await _cleanup(db, asset_id, rv_id)
