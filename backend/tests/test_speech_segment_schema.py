"""
Video Deconstructor — Stage 7 (Audio / Speech / Transcript), Phase A schema tests.

Same real-database, no-Alembic, `Base.metadata.create_all`-only approach test_video_analysis_schema.py
established for this project's first schema-test file (see that file's own docstring for the
NullPool-engine / never-blanket-rollback / plain-int-not-ORM-object infrastructure notes — all
reused verbatim here). Phase A adds exactly one new table (`speech_segments`, backing the new
`SpeechSegment` model) and touches no existing table — these tests exercise that new table
through the real ORM model and a real database connection, and separately confirm no existing
Stage 1-6 table gained a column it shouldn't have.

Covers the 10 requested checks: 1 (table/model creatable), 2 (VideoAnalysis/Shot relationships),
3 (start/end timing constraint), 4 (certainty constraint), 5 (confidence_score NULL/range), 6
(Unicode text preserved), 7 (speaker_label nullable), 8 (analysis_details JSON round-trips raw
diagnostics verbatim), 9 (ReferenceVideo/VideoAnalysis immutability/versioning unaffected), 10
(no Stage 1-6 table/schema altered).
"""
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.user import User
from app.models.video_analysis import VideoAnalysis

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user_id(db) -> int:
    """Reuses a real, already-seeded user rather than creating a throwaway one — keeps the
    `users` table itself completely untouched by this test file."""
    result = await db.execute(select(User).limit(1))
    return result.scalar_one().id


async def _make_test_asset(db, user_id: int) -> int:
    asset = Asset(
        user_id=user_id,
        original_filename="stage7_schema_test.mp4",
        stored_filename="stage7_schema_test_stored.mp4",
        file_path="uploads/stage7_schema_test.mp4",
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


async def _make_scene_and_shot(db, video_analysis_id: int) -> int:
    scene = Scene(video_analysis_id=video_analysis_id, order=0, start_time=0.0, end_time=10.0, certainty="MEASURED")
    db.add(scene)
    await db.flush()
    shot = Shot(scene_id=scene.id, video_analysis_id=video_analysis_id, order=0, start_time=0.0, end_time=10.0, certainty="MEASURED")
    db.add(shot)
    await db.flush()
    return shot.id


async def _cleanup(db, asset_id: int, reference_video_id: int | None):
    """ReferenceVideo cascades to every analysis child row it owns (including SpeechSegment, via
    video_analysis_id's own CASCADE) — the Asset (RESTRICT) must be deleted only after."""
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
# 1. The new table/model can be created and is queryable.
# ---------------------------------------------------------------------------

async def test_speech_segment_table_exists_and_is_queryable():
    async with _TestSessionLocal() as db:
        result = await db.execute(select(SpeechSegment).limit(1))
        result.scalars().all()  # no error == the table exists and is queryable


# ---------------------------------------------------------------------------
# 2. Relationships: a row links correctly to VideoAnalysis, and optionally to Shot.
# ---------------------------------------------------------------------------

async def test_speech_segment_links_to_video_analysis_and_optionally_shot():
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
            shot_id = await _make_scene_and_shot(db, analysis_id)

            with_shot = SpeechSegment(
                video_analysis_id=analysis_id, shot_id=shot_id,
                start_time=0.0, end_time=2.0, text="hello there", certainty="MEASURED",
            )
            without_shot = SpeechSegment(
                video_analysis_id=analysis_id, shot_id=None,
                start_time=2.0, end_time=4.0, text="a second segment", certainty="MEASURED",
            )
            db.add_all([with_shot, without_shot])
            await db.commit()

            result = await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == analysis_id).order_by(SpeechSegment.start_time))
            rows = result.scalars().all()
            assert len(rows) == 2
            assert rows[0].shot_id == shot_id
            assert rows[1].shot_id is None  # shot_id is genuinely optional, independent of video_analysis_id
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 3. start_time/end_time ordering is enforced.
# ---------------------------------------------------------------------------

async def test_end_time_before_start_time_is_rejected():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(analysis)
            await db.flush()
            db.add(SpeechSegment(
                video_analysis_id=analysis.id, start_time=5.0, end_time=1.0,  # end < start
                text="invalid ordering", certainty="MEASURED",
            ))
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()  # genuinely needed after a real constraint violation
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 4. certainty is constrained to the shared, closed vocabulary.
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
            db.add(SpeechSegment(
                video_analysis_id=analysis.id, start_time=0.0, end_time=1.0,
                text="x", certainty="TOTALLY_MADE_UP",
            ))
            with pytest.raises(IntegrityError):
                await db.commit()
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
                db.add(SpeechSegment(
                    video_analysis_id=analysis.id, start_time=float(i), end_time=float(i + 1),
                    text=f"segment {i}", certainty=value,
                ))
            await db.commit()  # no IntegrityError == every real value is accepted
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 5. confidence_score: NULL is always fine; when present, must respect 0-1.
# ---------------------------------------------------------------------------

async def test_confidence_score_accepts_null_and_valid_range_but_rejects_out_of_range():
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

            # NULL — "confidence unavailable" must always be accepted, never forced to a fake value.
            null_conf = SpeechSegment(
                video_analysis_id=analysis_id, start_time=0.0, end_time=1.0,
                text="no confidence available", certainty="MEASURED", confidence_score=None,
            )
            # A genuinely defensible in-range value is accepted.
            valid_conf = SpeechSegment(
                video_analysis_id=analysis_id, start_time=1.0, end_time=2.0,
                text="some confidence", certainty="MEASURED", confidence_score=0.5,
            )
            db.add_all([null_conf, valid_conf])
            await db.commit()

            # Out-of-range is rejected.
            db.add(SpeechSegment(
                video_analysis_id=analysis_id, start_time=2.0, end_time=3.0,
                text="bad confidence", certainty="MEASURED", confidence_score=1.5,
            ))
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 6. Unicode transcript text is preserved exactly.
# ---------------------------------------------------------------------------

async def test_unicode_text_is_preserved_exactly():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(analysis)
            await db.flush()
            # Hindi (Devanagari), Urdu/Arabic script, mixed with plain English — same real
            # multi-script mix already proven to round-trip correctly in TextElement.text
            # (Stage 6's own real reference-video data).
            mixed_text = "यह एक परीक्षण है — this is a test — هذا اختبار"
            seg = SpeechSegment(
                video_analysis_id=analysis.id, start_time=0.0, end_time=3.0,
                text=mixed_text, certainty="MEASURED",
            )
            db.add(seg)
            await db.commit()
            seg_id = seg.id

            result = await db.execute(select(SpeechSegment).where(SpeechSegment.id == seg_id))
            fetched = result.scalar_one()
            assert fetched.text == mixed_text
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 7. speaker_label is a genuinely optional forward-compatibility placeholder.
# ---------------------------------------------------------------------------

async def test_speaker_label_may_be_null_or_set():
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

            unlabeled = SpeechSegment(
                video_analysis_id=analysis_id, start_time=0.0, end_time=1.0,
                text="no speaker attribution yet", certainty="MEASURED", speaker_label=None,
            )
            labeled = SpeechSegment(
                video_analysis_id=analysis_id, start_time=1.0, end_time=2.0,
                text="attributed to a speaker", certainty="MEASURED", speaker_label="Speaker 1",
            )
            db.add_all([unlabeled, labeled])
            await db.commit()

            result = await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == analysis_id).order_by(SpeechSegment.start_time))
            rows = result.scalars().all()
            assert rows[0].speaker_label is None
            assert rows[1].speaker_label == "Speaker 1"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 8. analysis_details preserves raw model diagnostics verbatim — never read as confidence.
# ---------------------------------------------------------------------------

async def test_analysis_details_round_trips_raw_diagnostics_verbatim():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(analysis)
            await db.flush()

            raw_diagnostics = {
                "engine": "whisper", "model": "base", "avg_logprob": -0.31,
                "no_speech_prob": 0.02, "compression_ratio": 1.4, "temperature": 0.0,
            }
            seg = SpeechSegment(
                video_analysis_id=analysis.id, start_time=0.0, end_time=1.0,
                text="x", certainty="MEASURED",
                confidence_score=None,  # deliberately NULL alongside raw diagnostics — see model docstring
                analysis_details=raw_diagnostics,
            )
            db.add(seg)
            await db.commit()
            seg_id = seg.id

            result = await db.execute(select(SpeechSegment).where(SpeechSegment.id == seg_id))
            fetched = result.scalar_one()
            assert fetched.analysis_details == raw_diagnostics  # every key/value preserved exactly
            assert fetched.confidence_score is None  # never fabricated from the raw diagnostics above
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 9. ReferenceVideo/VideoAnalysis immutability & versioning are unaffected by Stage 7.
# ---------------------------------------------------------------------------

async def test_reference_video_and_video_analysis_versioning_unaffected():
    async with _TestSessionLocal() as db:
        user_id = await _existing_test_user_id(db)
        asset_id = await _make_test_asset(db, user_id)
        rv_id = None
        try:
            rv_id = await _make_reference_video(db, asset_id, user_id)
            original_rv = await db.get(ReferenceVideo, rv_id)
            original_created_at = original_rv.created_at
            original_source = original_rv.source

            # Two independent analysis "runs" against the SAME ReferenceVideo — mirrors this
            # project's own established re-analysis pattern (never mutate ReferenceVideo, never
            # mutate a prior VideoAnalysis; a new run is always a new row).
            first_analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(first_analysis)
            await db.flush()
            db.add(SpeechSegment(
                video_analysis_id=first_analysis.id, start_time=0.0, end_time=1.0,
                text="first run", certainty="MEASURED",
            ))
            await db.commit()
            first_analysis_id = first_analysis.id

            second_analysis = VideoAnalysis(reference_video_id=rv_id)
            db.add(second_analysis)
            await db.flush()
            db.add(SpeechSegment(
                video_analysis_id=second_analysis.id, start_time=0.0, end_time=1.0,
                text="second run", certainty="MEASURED",
            ))
            await db.commit()
            second_analysis_id = second_analysis.id

            # The ReferenceVideo itself was never touched by adding SpeechSegment rows to either run.
            result = await db.execute(select(ReferenceVideo).where(ReferenceVideo.id == rv_id))
            refetched_rv = result.scalar_one()
            assert refetched_rv.created_at == original_created_at
            assert refetched_rv.source == original_source

            # Both VideoAnalysis rows still coexist independently, each with its own SpeechSegment.
            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            analyses = result.scalars().all()
            assert {a.id for a in analyses} == {first_analysis_id, second_analysis_id}

            first_segments = (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == first_analysis_id))).scalars().all()
            second_segments = (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == second_analysis_id))).scalars().all()
            assert [s.text for s in first_segments] == ["first run"]
            assert [s.text for s in second_segments] == ["second run"]
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 10. No Stage 1-6 table gained a column, and no locked table was altered.
# ---------------------------------------------------------------------------

async def test_no_existing_stage_1_through_6_table_was_altered():
    """Phase A is additive-only: exactly one new table (`speech_segments`). This directly
    verifies, via information_schema, that none of the locked Stage 1-6 tables (or the
    unrelated, also-untouched `transcripts` table) gained a Stage-7-related column."""
    stage_1_6_tables = [
        "reference_videos", "video_analyses", "scenes", "shots", "text_elements",
        "visual_objects", "analysis_annotations", "strategic_insights", "shot_frames",
    ]
    async with _TestSessionLocal() as db:
        for table_name in stage_1_6_tables:
            result = await db.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name = :t"
            ), {"t": table_name})
            columns = {row[0] for row in result.fetchall()}
            assert columns, f"{table_name} unexpectedly has no columns at all — table missing?"
            assert not any("speech" in c.lower() for c in columns), (
                f"{table_name} unexpectedly gained a speech-related column: {columns}"
            )

        # The unrelated, existing Transcript table is untouched too — no speech_segment_id or
        # similar cross-reference was added to it.
        result = await db.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'transcripts'"
        ))
        transcript_columns = {row[0] for row in result.fetchall()}
        assert not any("speech" in c.lower() for c in transcript_columns)

        # And the new table exists with exactly the columns this model defines — nothing more.
        result = await db.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'speech_segments'"
        ))
        speech_columns = {row[0] for row in result.fetchall()}
        assert speech_columns == {
            "id", "video_analysis_id", "shot_id", "start_time", "end_time", "text", "language",
            "speaker_label", "certainty", "confidence_score", "reasoning", "evidence_summary",
            "source", "produced_by_pass", "created_at", "analysis_details",
        }
