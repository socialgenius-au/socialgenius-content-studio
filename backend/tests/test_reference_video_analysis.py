"""
Video Deconstructor — Stage 3 (Reference Video Technical Analysis) tests.

Same real-database, direct-function-call approach test_reference_video_ingestion.py and
test_video_analysis_schema.py already established (see those files' own docstrings for the
NullPool-engine / never-blanket-rollback / plain-int-not-ORM-object infrastructure notes,
reused verbatim here). analyze_reference_video is called directly, same as
ingest_reference_video already is — this project has no HTTP test client anywhere.

Covers: successful analysis populates the right facts (with an exact-value assertion against a
known synthetic fixture, not a fuzzy one); technical_details' schema version and stable shape;
certainty discipline (fields this probe mechanism can never determine stay None, never guessed);
audio-absent is a valid outcome, not a failure; a malformed file fails safely with the
technical columns left untouched; ReferenceVideo's identity fields are unchanged by analysis;
zero Scene/Shot/etc. rows are ever created; retry-after-failure creates a new VideoAnalysis
version (never mutates the failed one); two genuinely concurrent requests against the same
pending row never produce two conflicting runs; a second call after completion is idempotent;
a stale "running" row (simulating a crashed process) is treated as failed and retried; a rotation
tag is correctly parsed when present in the probe text (fed in via a monkeypatched `_probe`,
since this exact toolchain could not be made to produce a genuinely rotation-tagged real file —
see the Stage 3 implementation report for that finding).
"""
import asyncio

from fastapi import HTTPException
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
from app.models.strategic_insight import StrategicInsight
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.models.visual_object import VisualObject
from app.routers.reference_videos import analyze_reference_video
from app.services import ffmpeg_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)

FIXTURE_DIR_MARKER = "stage3_"


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_reference_with_pending_analysis(db, user: User, file_path: str, file_size: int) -> tuple[int, int]:
    """Creates one Asset + ReferenceVideo + pending VideoAnalysis (exactly Stage 2's own shape),
    and returns (reference_video_id, asset_id) as plain ints."""
    asset = Asset(
        user_id=user.id, original_filename="stage3_test.mp4", stored_filename="stage3_test_stored.mp4",
        file_path=file_path, file_type="video", mime_type="video/mp4", file_size=file_size,
    )
    db.add(asset)
    await db.flush()
    asset_id = asset.id

    rv = ReferenceVideo(user_id=user.id, asset_id=asset_id, source="upload")
    db.add(rv)
    await db.flush()
    rv_id = rv.id

    db.add(VideoAnalysis(reference_video_id=rv_id))
    await db.commit()
    return rv_id, asset_id


async def _cleanup(db, asset_id: int, reference_video_id: int | None):
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
# Fixtures — real, small, ffmpeg-generated clips with KNOWN exact properties, same technique
# conftest.py's own `clips`/`portrait_clip` fixtures already use.
# ---------------------------------------------------------------------------

def _run_ffmpeg(cmd: list[str]) -> None:
    import subprocess
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg fixture generation failed: {result.stderr[-1000:]}")


@pytest.fixture
def known_clip(tmp_path) -> tuple[str, int]:
    """A 2s, 320x240, 25fps clip with audio — exact known values asserted against below."""
    out = tmp_path / "stage3_known_clip.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2:r=25",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size


@pytest.fixture
def silent_clip(tmp_path) -> tuple[str, int]:
    """A video with no audio track at all — has_audio must be False, not an error."""
    out = tmp_path / "stage3_silent_clip.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "color=c=green:s=200x200:d=1:r=24",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size


@pytest.fixture
def corrupt_file(tmp_path) -> tuple[str, int]:
    out = tmp_path / "stage3_corrupt.mp4"
    out.write_bytes(b"this is not a video file, just garbage bytes 0123456789")
    return str(out), out.stat().st_size


# ---------------------------------------------------------------------------
# 1/2. Successful analysis — exact values, correct lifecycle.
# ---------------------------------------------------------------------------

async def test_analyze_populates_reference_video_technical_columns_and_details(known_clip):
    path, size = known_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            resp = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)

            assert resp.latest_analysis.status == "complete"
            assert resp.latest_analysis.started_at is not None
            assert resp.latest_analysis.completed_at is not None
            assert resp.latest_analysis.started_at <= resp.latest_analysis.completed_at
            assert resp.latest_analysis.error is None

            result = await db.execute(select(ReferenceVideo).where(ReferenceVideo.id == rv_id))
            rv = result.scalar_one()
            assert rv.duration is not None and 1.9 <= rv.duration <= 2.2
            assert rv.width == 320
            assert rv.height == 240
            assert rv.fps == 25.0
            assert rv.codec == "h264"
            assert rv.has_audio is True

            d = rv.technical_details
            assert d["schema_version"] == 1
            assert d["video"]["width"] == 320
            assert d["video"]["height"] == 240
            assert d["video"]["pixel_format"] == "yuv420p"
            assert d["audio"]["present"] is True
            assert d["audio"]["codec_name"] == "aac"
            assert d["audio"]["sample_rate_hz"] == 44100
            assert d["streams"]["video_count"] == 1
            assert d["streams"]["audio_count"] == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Certainty discipline — fields this mechanism can never determine stay None.
# ---------------------------------------------------------------------------

async def test_certainty_unknowns_stay_null_not_guessed(known_clip):
    path, size = known_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            resp = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            d = resp.technical_details
            # Never computed/guessed by this probe mechanism — see ffmpeg_svc's own docstrings
            # for why each of these specifically stays None.
            assert d["video"]["frame_count"] is None
            assert d["video"]["average_frame_rate"] is None
            assert d["video"]["coded_width"] is None
            assert d["video"]["coded_height"] is None
            assert d["video"]["codec_long_name"] is None
            assert d["container"]["format_long_name"] is None
            assert d["video"]["duration_seconds"] is None  # not double-counted from container
            assert d["audio"]["duration_seconds"] is None
            # No rotation metadata on this fixture — absence must stay None, never assumed 0.
            assert d["video"]["rotation_degrees"] is None
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_rotation_tag_is_parsed_when_present(known_clip, monkeypatch):
    """This exact bundled ffmpeg build could not be made to produce a genuinely rotation-tagged
    real file during this stage's implementation (verified empirically, documented in the
    report) — so this proves the PARSER correctly extracts a rotation value when ffmpeg's own
    text contains one, decoupled from whether this toolchain happens to produce that text for
    any file available in this environment. `_probe` (the one function that actually shells out)
    is monkeypatched to return real, unmodified ffmpeg output with one added metadata line."""
    path, size = known_clip

    real_probe = ffmpeg_svc._probe
    real_text = await real_probe(path)
    # Appended rather than inserted mid-line — the rotation regex searches the whole probe text,
    # not just the video stream's own line, exactly like ffmpeg's real output (the rotate tag
    # appears in a separate nested "Metadata:" block under the stream line, not on it).
    injected = real_text + "\n    Metadata:\n      rotate          : 90\n"

    async def fake_probe(p):
        return injected

    monkeypatch.setattr(ffmpeg_svc, "_probe", fake_probe)

    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            resp = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert resp.latest_analysis.status == "complete"
            assert resp.technical_details["video"]["rotation_degrees"] == 90
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Audio absence is a valid, observed fact — never an error.
# ---------------------------------------------------------------------------

async def test_audio_absent_is_valid_not_an_error(silent_clip):
    path, size = silent_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            resp = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert resp.latest_analysis.status == "complete"
            assert resp.latest_analysis.error is None
            result = await db.execute(select(ReferenceVideo).where(ReferenceVideo.id == rv_id))
            rv = result.scalar_one()
            assert rv.has_audio is False
            assert rv.width == 200 and rv.height == 200
            assert rv.technical_details["audio"]["present"] is False
            assert rv.technical_details["audio"]["codec_name"] is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Malformed input fails safely — no corruption, no partial writes.
# ---------------------------------------------------------------------------

async def test_malformed_video_fails_safely(corrupt_file):
    path, size = corrupt_file
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            resp = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert resp.latest_analysis.status == "failed"
            assert resp.latest_analysis.error  # a real, non-empty, truthful message
            assert resp.technical_details is None

            result = await db.execute(select(ReferenceVideo).where(ReferenceVideo.id == rv_id))
            rv = result.scalar_one()
            assert rv.duration is None and rv.width is None and rv.height is None
            assert rv.fps is None and rv.codec is None and rv.has_audio is None
            assert rv.technical_details is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# ReferenceVideo's identity fields are never mutated by analysis.
# ---------------------------------------------------------------------------

async def test_reference_video_identity_unchanged_by_analysis(known_clip):
    path, size = known_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            before = await db.get(ReferenceVideo, rv_id)
            before_snapshot = (before.asset_id, before.user_id, before.source, before.rights_status, before.created_at)

            await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)

            after = await db.get(ReferenceVideo, rv_id)
            after_snapshot = (after.asset_id, after.user_id, after.source, after.rights_status, after.created_at)
            assert before_snapshot == after_snapshot
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Zero Scene/Shot/etc. rows — Stage 3 is technical facts only.
# ---------------------------------------------------------------------------

async def test_no_analysis_entity_rows_created(known_clip):
    path, size = known_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            resp = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            analysis_id = resp.latest_analysis.id
            for model in (Scene, TextElement, VisualObject, AnalysisAnnotation, StrategicInsight):
                result = await db.execute(select(model).where(model.video_analysis_id == analysis_id))
                assert result.scalars().all() == [], f"{model.__tablename__} must stay empty at Stage 3"
            result = await db.execute(
                select(Shot).join(Scene, Shot.scene_id == Scene.id).where(Scene.video_analysis_id == analysis_id)
            )
            assert result.scalars().all() == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Retry after failure creates a NEW VideoAnalysis version; the failed one is untouched.
# ---------------------------------------------------------------------------

async def test_retry_after_failure_creates_new_video_analysis_row(corrupt_file):
    path, size = corrupt_file
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            first = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert first.latest_analysis.status == "failed"
            second = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert second.latest_analysis.status == "failed"
            assert second.latest_analysis.id != first.latest_analysis.id

            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            rows = result.scalars().all()
            assert len(rows) == 2
            assert all(r.status == "failed" for r in rows)
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Idempotent on an already-complete analysis.
# ---------------------------------------------------------------------------

async def test_analyze_is_idempotent_after_completion(known_clip):
    path, size = known_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            first = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            second = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert second.latest_analysis.id == first.latest_analysis.id
            assert second.latest_analysis.status == "complete"

            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            assert len(result.scalars().all()) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Duplicate-click / concurrency protection — two genuinely concurrent requests.
# ---------------------------------------------------------------------------

async def test_concurrent_analyze_calls_do_not_create_conflicting_runs(known_clip):
    path, size = known_clip
    async with _TestSessionLocal() as setup_db:
        user = await _existing_test_user(setup_db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(setup_db, user, path, size)
    user_id = user.id

    async def call():
        async with _TestSessionLocal() as db:
            u = await db.get(User, user_id)
            try:
                r = await analyze_reference_video(reference_video_id=rv_id, db=db, user=u)
                return ("ok", r.latest_analysis.status)
            except HTTPException as e:
                return ("conflict", e.status_code)

    results = await asyncio.gather(call(), call())
    outcomes = {r[0] for r in results}
    assert outcomes == {"ok", "conflict"}, f"expected exactly one success and one 409, got {results}"

    async with _TestSessionLocal() as db:
        result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
        rows = result.scalars().all()
        assert len(rows) == 1, "no duplicate/conflicting VideoAnalysis row was created"
        await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# A stale "running" row (simulating a crashed process) is treated as failed and retried.
# ---------------------------------------------------------------------------

async def test_stale_running_row_is_treated_as_failed_and_retried(known_clip):
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import update
    from app.routers.reference_videos import STALE_RUNNING_TIMEOUT_SECONDS

    path, size = known_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            va = result.scalar_one()
            long_ago = datetime.now(timezone.utc) - timedelta(seconds=STALE_RUNNING_TIMEOUT_SECONDS + 60)
            await db.execute(
                update(VideoAnalysis).where(VideoAnalysis.id == va.id).values(status="running", started_at=long_ago)
            )
            await db.commit()

            resp = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert resp.latest_analysis.status == "complete"
            assert resp.latest_analysis.id != va.id  # a fresh row was created for the retry

            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            rows = {r.id: r.status for r in result.scalars().all()}
            assert rows[va.id] == "failed"  # the stale row was marked failed, not silently dropped
            assert rows[resp.latest_analysis.id] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Not-found / ownership checks.
# ---------------------------------------------------------------------------

async def test_analyze_rejects_nonexistent_reference_video():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        with pytest.raises(HTTPException) as exc:
            await analyze_reference_video(reference_video_id=999_999_999, db=db, user=user)
        assert exc.value.status_code == 404


async def test_analyze_rejects_reference_video_owned_by_a_different_user(known_clip):
    path, size = known_clip
    async with _TestSessionLocal() as db:
        result = await db.execute(select(User).limit(2))
        users = result.scalars().all()
        assert len(users) >= 2, "expected at least 2 seeded users"
        owner, other = users[0], users[1]
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, owner, path, size)
        try:
            with pytest.raises(HTTPException) as exc:
                await analyze_reference_video(reference_video_id=rv_id, db=db, user=other)
            assert exc.value.status_code == 404
        finally:
            await _cleanup(db, asset_id, rv_id)
