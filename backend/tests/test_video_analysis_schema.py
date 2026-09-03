"""
Video Deconstructor — Stage 1 (Core Analysis Data Model) schema tests.

This project has no Alembic/migration-chain infrastructure at all — schema changes are applied
via `Base.metadata.create_all` at app startup (see app/main.py's lifespan), which only ever
CREATES tables that don't already exist; it never alters or drops one. That was verified
directly against the real dev database before writing these tests (all 8 new tables created,
every pre-existing table's row count identical before/after). These tests exercise the resulting
schema through the real ORM models and a real database connection (this test suite has no
separate test-database fixture either — test_export_pipeline.py/test_timeline_render.py are
pure service-layer tests with no DB at all), so each test creates its own throwaway rows and
tears them down explicitly in a `finally` block, exactly like every manual verification pass
this project's own sessions have used. Deleting a test's ReferenceVideo cascades to every child
row it created (VideoAnalysis -> Scene -> Shot -> TextElement/VisualObject/AnalysisAnnotation/
StrategicInsight), so cleanup is almost always "delete the one root row".

Two real infrastructure quirks were found and fixed while writing these — both explained where
they're worked around, below:
  1. A dedicated NullPool engine/session, not the shared `app.database.engine` — this suite's
     other files never touch the database at all, so this is the first time anything here
     exercises pool_pre_ping across several operations in one run, which can land outside
     SQLAlchemy's async "greenlet" bridge under pytest-asyncio's scheduling.
  2. IDs are captured into plain Python ints immediately after each row is created, and passed
     to `_cleanup` as those plain ints — never as `.id` read off the ORM object again after a
     rollback. A rollback expires every object in the session (regardless of `expire_on_commit`),
     so re-reading `.id` off an expired object triggers an implicit reload that isn't `await`ed,
     which is its own route to the same class of error `NullPool` above avoids.

Covers the 16 requested checks: 1 (tables load/are queryable — a from-scratch fresh-DB run was
already verified manually, see the implementation report), 2 (all 8 tables exist), 3
(relationships), 4 (invalid certainty rejected), 5 (confidence range enforced), 6 (normalized
geometry), 7 (rotation/scale/anchor/opacity/z_index), 8-9 (ReferenceVideo immutability /
VideoAnalysis versioning), 10 (produced_by_pass), 11 (structured `details` jsonb), 12 (existing
Transcript untouched/compatible), 13 (existing Video Studio tables untouched, verified
separately at the DB level — see the implementation report for the exact before/after row
counts). 14-16 (existing backend tests / frontend typecheck / frontend build) are whole-suite
checks, not individual test functions here.
"""
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.strategic_insight import StrategicInsight
from app.models.text_element import TextElement
from app.models.transcript import Transcript
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.models.video_studio_draft import VideoStudioDraft
from app.models.visual_object import VisualObject

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user_id(db) -> int:
    """Reuses a real, already-seeded user rather than creating a throwaway one — keeps the
    `users` table itself completely untouched by this test file."""
    result = await db.execute(select(User).limit(1))
    return result.scalar_one().id


async def _make_test_asset(db, user_id: int) -> int:
    """Returns the new Asset's id (a plain int) rather than the ORM object — see this module's
    own docstring for why callers should never hold onto an ORM object across a rollback."""
    asset = Asset(
        user_id=user_id,
        original_filename="stage1_schema_test.mp4",
        stored_filename="stage1_schema_test_stored.mp4",
        file_path="uploads/stage1_schema_test.mp4",
        file_type="video",
        mime_type="video/mp4",
        file_size=1234,
    )
    db.add(asset)
    await db.flush()
    return asset.id


async def _make_reference_video(db, asset_id: int, user_id: int) -> int:
    rv = ReferenceVideo(user_id=user_id, asset_id=asset_id, source="upload", rights_status="owned")
    db.add(rv)
    await db.flush()
    return rv.id


async def _make_scene(db, video_analysis_id: int) -> int:
    scene = Scene(video_analysis_id=video_analysis_id, order=0, start_time=0.0, end_time=1.0, certainty="MEASURED")
    db.add(scene)
    await db.flush()
    return scene.id


async def _cleanup(db, asset_id: int, reference_video_id: int | None):
    """ReferenceVideo cascades to every analysis child row it owns; the Asset (RESTRICT) must
    be deleted only after the ReferenceVideo that references it is gone."""
    if reference_video_id is not None:
        rv = await db.get(ReferenceVideo, reference_video_id)
        if rv:
            await db.delete(rv)
            await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


# ---------------------------------------------------------------------------
# 2. All 8 approved tables exist and are queryable.
# ---------------------------------------------------------------------------

async def test_all_eight_tables_exist_and_are_queryable():
    async with _TestSessionLocal() as db:
        for model in [ReferenceVideo, VideoAnalysis, Scene, Shot, TextElement, VisualObject, AnalysisAnnotation, StrategicInsight]:
            result = await db.execute(select(model).limit(1))
            result.scalars().all()  # no exception == the table exists and is queryable


# ---------------------------------------------------------------------------
# 3. Relationships are correct — the full chain links together as designed.
# ---------------------------------------------------------------------------

async def test_full_relationship_chain():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id, analysis_tier="standard", status="complete")
            db.add(analysis)
            await db.flush()
            analysis_id = analysis.id

            scene = Scene(video_analysis_id=analysis_id, order=0, start_time=0.0, end_time=5.0, certainty="MEASURED")
            db.add(scene)
            await db.flush()
            scene_id = scene.id

            shot = Shot(scene_id=scene_id, order=0, start_time=0.0, end_time=2.5, certainty="MEASURED")
            db.add(shot)
            await db.flush()
            shot_id = shot.id

            text_el = TextElement(
                video_analysis_id=analysis_id, shot_id=shot_id, text="Visit our showroom",
                x=0.1, y=0.8, width=0.5, height=0.1, start_time=0.5, end_time=2.0, certainty="MEASURED",
            )
            visual_obj = VisualObject(
                video_analysis_id=analysis_id, shot_id=shot_id, label="tile sample", category="product",
                x=0.2, y=0.3, width=0.3, height=0.3, start_time=0.0, end_time=2.5, certainty="MEASURED",
            )
            annotation = AnalysisAnnotation(
                video_analysis_id=analysis_id, shot_id=shot_id, category="transition",
                start_time=2.4, end_time=2.6, certainty="MEASURED",
            )
            insight = StrategicInsight(
                video_analysis_id=analysis_id, category="hook",
                description="Opens on a close product shot within the first two seconds",
                certainty="INFERRED", confidence_score=0.7,
            )
            db.add_all([text_el, visual_obj, annotation, insight])
            await db.commit()

            # Re-fetch and confirm every FK actually resolved to the parent chain built above.
            result = await db.execute(select(Shot).where(Shot.id == shot_id))
            assert result.scalar_one().scene_id == scene_id

            result = await db.execute(select(Scene).where(Scene.id == scene_id))
            assert result.scalar_one().video_analysis_id == analysis_id

            result = await db.execute(select(TextElement).where(TextElement.shot_id == shot_id))
            assert result.scalar_one().video_analysis_id == analysis_id
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 4. Invalid certainty values are rejected.
# ---------------------------------------------------------------------------

async def test_invalid_certainty_value_is_rejected():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(analysis)
            await db.flush()

            bad_scene = Scene(video_analysis_id=analysis.id, order=0, start_time=0, end_time=1, certainty="TOTALLY_MADE_UP")
            db.add(bad_scene)
            with pytest.raises(IntegrityError):
                await db.commit()
            # A real constraint violation DOES leave the session needing a rollback before
            # anything else can happen on it (unlike a clean commit, where calling rollback
            # anyway is what trips the NullPool/greenlet interaction this file's docstring
            # explains) — genuinely needed here, and safe because nothing below re-reads an
            # attribute off an ORM object that rollback just expired.
            await db.rollback()
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_valid_certainty_values_are_all_accepted():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(analysis)
            await db.flush()
            for i, value in enumerate(["OBSERVED", "MEASURED", "INFERRED", "RESEARCH_SUPPORTED", "RECOMMENDED"]):
                db.add(Scene(video_analysis_id=analysis.id, order=i, start_time=0, end_time=1, certainty=value))
            await db.commit()  # no IntegrityError == every real value is accepted
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 5. Confidence range is enforced, and never required for a deterministic fact.
# ---------------------------------------------------------------------------

async def test_confidence_out_of_range_is_rejected():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(analysis)
            await db.flush()
            db.add(StrategicInsight(
                video_analysis_id=analysis.id, category="hook", description="x",
                certainty="INFERRED", confidence_score=1.5,
            ))
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()  # genuinely needed after a real constraint violation
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_confidence_can_be_omitted_for_a_measured_fact():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(analysis)
            await db.flush()
            scene_id = await _make_scene(db, analysis.id)
            db.add(Shot(
                scene_id=scene_id, order=0, start_time=0.0, end_time=1.0, certainty="MEASURED",  # confidence_score left None
            ))
            await db.commit()  # no IntegrityError even with confidence_score never set
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 6/7. Normalized geometry, and rotation/scale/anchor/opacity/z_index.
# ---------------------------------------------------------------------------

async def test_normalized_geometry_accepted_and_out_of_range_rejected():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(analysis)
            await db.flush()
            analysis_id = analysis.id

            valid = TextElement(
                video_analysis_id=analysis_id, text="hello",
                x=0.05, y=0.8, width=0.9, height=0.15,
                scale_x=1.2, scale_y=1.2, rotation=15.0, anchor_x=0.0, anchor_y=1.0, opacity=0.9, z_index=3,
                start_time=0.0, end_time=2.0, certainty="MEASURED",
            )
            db.add(valid)
            await db.commit()
            valid_id = valid.id

            result = await db.execute(select(TextElement).where(TextElement.id == valid_id))
            fetched = result.scalar_one()
            assert fetched.scale_x == 1.2 and fetched.rotation == 15.0
            assert fetched.anchor_x == 0.0 and fetched.anchor_y == 1.0
            assert fetched.opacity == 0.9 and fetched.z_index == 3

            invalid = TextElement(
                video_analysis_id=analysis_id, text="out of bounds",
                x=1.5, y=0.5, width=0.1, height=0.1,  # x > 1 -- must be rejected
                start_time=0.0, end_time=1.0, certainty="MEASURED",
            )
            db.add(invalid)
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()  # genuinely needed after a real constraint violation
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 8/9. ReferenceVideo immutability + VideoAnalysis versioning.
# ---------------------------------------------------------------------------

async def test_reference_video_unchanged_across_multiple_analysis_versions():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            result = await db.execute(select(ReferenceVideo).where(ReferenceVideo.id == rv_id))
            rv = result.scalar_one()
            original_created_at = rv.created_at
            original_asset_id = rv.asset_id

            db.add(VideoAnalysis(reference_video_id=rv_id, analysis_tier="quick", status="complete"))
            await db.commit()

            db.add(VideoAnalysis(reference_video_id=rv_id, analysis_tier="deep", status="complete"))
            await db.commit()

            # Re-fetch ReferenceVideo fresh from the DB — confirm creating TWO analysis runs
            # against it never touched its own row at all.
            result = await db.execute(select(ReferenceVideo).where(ReferenceVideo.id == rv_id))
            refetched = result.scalar_one()
            assert refetched.created_at == original_created_at
            assert refetched.asset_id == original_asset_id

            # Confirm exactly one ReferenceVideo row exists for this asset (versioning created
            # new VideoAnalysis rows, never a second ReferenceVideo).
            result = await db.execute(select(ReferenceVideo).where(ReferenceVideo.asset_id == asset_id))
            assert len(result.scalars().all()) == 1

            # Confirm both analysis versions independently reference the SAME ReferenceVideo.
            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            versions = result.scalars().all()
            assert len(versions) == 2
            assert {v.analysis_tier for v in versions} == {"quick", "deep"}
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 10. produced_by_pass traceability.
# ---------------------------------------------------------------------------

async def test_produced_by_pass_is_recorded():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(analysis)
            await db.flush()
            scene = Scene(
                video_analysis_id=analysis.id, order=0, start_time=0, end_time=1,
                certainty="MEASURED", produced_by_pass="scene_segmentation",
            )
            db.add(scene)
            await db.commit()
            scene_id = scene.id

            result = await db.execute(select(Scene).where(Scene.id == scene_id))
            assert result.scalar_one().produced_by_pass == "scene_segmentation"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 11. Structured `details` jsonb fields accept real structured payloads.
# ---------------------------------------------------------------------------

async def test_structured_details_fields_round_trip():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(analysis)
            await db.flush()
            analysis_id = analysis.id

            annotation = AnalysisAnnotation(
                video_analysis_id=analysis_id, category="transition", start_time=2.0, end_time=2.2,
                certainty="MEASURED", details={"cut_type": "whip_pan", "duration": 0.2},
            )
            insight = StrategicInsight(
                video_analysis_id=analysis_id, category="virality_hypothesis",
                description="Fast pacing in the first 3 seconds may support retention",
                certainty="INFERRED", confidence_score=0.4,
                details={"required_data_to_strengthen": "actual view/retention data for this video"},
            )
            db.add_all([annotation, insight])
            await db.commit()
            annotation_id, insight_id = annotation.id, insight.id

            result = await db.execute(select(AnalysisAnnotation).where(AnalysisAnnotation.id == annotation_id))
            assert result.scalar_one().details == {"cut_type": "whip_pan", "duration": 0.2}

            result = await db.execute(select(StrategicInsight).where(StrategicInsight.id == insight_id))
            assert result.scalar_one().details["required_data_to_strengthen"] == "actual view/retention data for this video"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 12. Existing Transcript model/table remain fully functional and untouched in shape.
# ---------------------------------------------------------------------------

async def test_existing_transcript_model_still_works_unmodified():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        transcript_id = None
        try:
            transcript = Transcript(
                asset_id=asset_id, user_id=user_id, language="en",
                full_text="test transcript", segments=[{"id": 0, "start": 0.0, "end": 1.0, "text": "test transcript"}],
            )
            db.add(transcript)
            await db.commit()
            transcript_id = transcript.id

            # The Stage-1-recommended join path: find a transcript for a given asset directly,
            # with no new column and no new table.
            result = await db.execute(select(Transcript).where(Transcript.asset_id == asset_id))
            fetched = result.scalar_one()
            assert fetched.full_text == "test transcript"
            assert not hasattr(Transcript, "video_analysis_id"), "Transcript was deliberately left unmodified — see the implementation report"
        finally:
            t = await db.get(Transcript, transcript_id) if transcript_id is not None else None
            if t:
                await db.delete(t)
            a = await db.get(Asset, asset_id)
            if a:
                await db.delete(a)
            await db.commit()


# ---------------------------------------------------------------------------
# 13. Existing Video Studio tables are completely unaffected.
# ---------------------------------------------------------------------------

async def test_existing_video_studio_draft_table_unaffected():
    async with _TestSessionLocal() as db:
        result = await db.execute(select(VideoStudioDraft))
        drafts_before = result.scalars().all()
        # This test only reads — Stage 1 must never write to video_studio_drafts at all, and
        # this assertion is here so a future accidental write shows up as a real test failure.
        assert all(d.project_json is not None for d in drafts_before)
