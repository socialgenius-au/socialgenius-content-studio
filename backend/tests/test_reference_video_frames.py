"""
Video Deconstructor — Stage 5 (Visual Evidence / Representative Frames) tests.

Same real-database, direct-function-call approach test_reference_video_structure.py already
established. Most tests bypass real cut-detection entirely and insert exact, hand-picked Shot
rows directly (setting VideoAnalysis.pass_status as if Stage 3/4 already completed) — this gives
deterministic control over shot DURATIONS (short/ordinary/long) without depending on where a real
detector happens to place cuts, which is not what Stage 5 itself is responsible for.

Covers the requested checks:
  - valid representative frames produced for each valid Shot, correct Shot association
  - exact/valid timestamps, chronological ordering
  - very short Shot handling (single midpoint frame)
  - long Shot handling (extra evenly-spaced frames, capped)
  - duplicate/near-duplicate handling (a flat/static clip collapses to one accepted frame)
  - malformed/not-yet-structurally-analysed input is rejected (409), no frames written
  - retry/idempotency: a forced failure resets status without duplicating rows/files, and a
    genuine in-place retry succeeds with no duplicate VideoAnalysis/ShotFrame rows
  - partial failure leaves no orphaned frame files on disk
  - Stage 3/4 data (ReferenceVideo technical facts, Shot rows) unchanged by Stage 5
  - zero external API calls: structurally guaranteed — this whole pass's code path
    (app.services.ffmpeg_svc.extract_representative_frames_for_shot and everything it calls) only
    ever invokes the local ffmpeg binary, Pillow, and numpy; no AI/HTTP client is imported or
    reachable from it.
"""
import subprocess
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest
from unittest.mock import AsyncMock, patch

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.shot_frame import ShotFrame
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.routers.reference_videos import analyze_reference_video_frames
from app.services import ffmpeg_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, file_path: str, file_size: int, duration: float, shot_spans: list[tuple[float, float]]) -> tuple[int, int, int, list[int]]:
    """Builds a ReferenceVideo whose VideoAnalysis is already at the exact state Stage 5 expects
    to start from (technical_probe + scene_segmentation both "complete"), with hand-picked Shot
    rows at exactly `shot_spans` — bypassing real Stage 3/4 detection so each test controls shot
    durations precisely. Returns (reference_video_id, asset_id, video_analysis_id, [shot_ids])."""
    asset = Asset(
        user_id=user.id, original_filename="stage5_test.mp4", stored_filename="stage5_test_stored.mp4",
        file_path=file_path, file_type="video", mime_type="video/mp4", file_size=file_size,
    )
    db.add(asset)
    await db.flush()

    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()

    va = VideoAnalysis(
        reference_video_id=rv.id, status="complete",
        pass_status={"technical_probe": "complete", "scene_segmentation": "complete"},
    )
    db.add(va)
    await db.flush()

    shot_ids = []
    for i, (start, end) in enumerate(shot_spans):
        shot = Shot(
            video_analysis_id=va.id, scene_id=None, order=i, start_time=start, end_time=end,
            certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1",
        )
        db.add(shot)
        await db.flush()
        shot_ids.append(shot.id)

    await db.commit()
    return rv.id, asset.id, va.id, shot_ids


async def _cleanup(db, asset_id: int, reference_video_id: int | None, video_analysis_id: int | None = None):
    """Extends test_reference_video_structure.py's own _cleanup: ReferenceVideo deletion cascades
    down through VideoAnalysis -> Shot -> ShotFrame automatically, but ShotFrame.asset_id is
    RESTRICT (deliberately, see shot_frame.py's own docstring) — the frame Assets themselves (and
    their real JPEG files) are NOT touched by that cascade and must be cleaned up explicitly."""
    frame_asset_ids: list[int] = []
    if video_analysis_id is not None:
        result = await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == video_analysis_id))
        frame_asset_ids = [f.asset_id for f in result.scalars().all()]

    if reference_video_id is not None:
        rv = await db.get(ReferenceVideo, reference_video_id)
        if rv:
            await db.delete(rv)
            await db.flush()

    for fa_id in frame_asset_ids:
        fa = await db.get(Asset, fa_id)
        if fa:
            try:
                Path(fa.file_path).unlink(missing_ok=True)
            except OSError:
                pass
            await db.delete(fa)

    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


def _run_ffmpeg(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg fixture generation failed: {result.stderr[-1000:]}")


# ---------------------------------------------------------------------------
# Fixtures.
# ---------------------------------------------------------------------------

@pytest.fixture
def textured_clip(tmp_path) -> tuple[str, int, float]:
    """One 15s textured, continuously-varying source — long enough to host short/ordinary/long
    hand-picked Shot spans within a single real file."""
    out = tmp_path / "stage5_textured.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "testsrc=s=320x240:d=15:r=25",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size, 15.0


@pytest.fixture
def varied_long_clip(tmp_path) -> tuple[str, int, float]:
    """4 distinct textured 3s segments (12s total) — unlike `textured_clip`'s single continuous
    testsrc (whose smooth, gradually-varying content is realistic for one real shot but, at
    dHash's coarse 9x8 resolution, can dedup even widely-separated timestamps together — a real,
    legitimate property of the dedup logic itself, not something this fixture should fight), this
    one has genuinely large-scale structural differences at every sample point specifically so a
    test of "long shots plan multiple non-duplicate candidates" isn't confounded by content that
    is itself too visually gradual to need more than one representative frame."""
    out = tmp_path / "stage5_varied_long.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "testsrc=s=320x240:d=3:r=25",
        "-f", "lavfi", "-i", "smptebars=s=320x240:d=3:r=25",
        "-f", "lavfi", "-i", "testsrc2=s=320x240:d=3:r=25",
        "-f", "lavfi", "-i", "rgbtestsrc=s=320x240:d=3:r=25",
        "-filter_complex", "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[outv]",
        "-map", "[outv]", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size, 12.0


@pytest.fixture
def static_clip(tmp_path) -> tuple[str, int, float]:
    """A flat, unchanging solid color for the full 5s — every frame is pixel-identical, so any
    two (or three) candidate representative frames MUST collapse to exactly one accepted frame
    via dHash near-duplicate suppression."""
    out = tmp_path / "stage5_static.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=5:r=25",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size, 5.0


@pytest.fixture
def corrupt_file(tmp_path) -> tuple[str, int, float]:
    out = tmp_path / "stage5_corrupt.mp4"
    out.write_bytes(b"not a real video, just garbage bytes 0123456789")
    return str(out), out.stat().st_size, 1.0


# ---------------------------------------------------------------------------
# Valid frames, correct Shot association, timestamps, chronological ordering.
# ---------------------------------------------------------------------------

async def test_frames_are_produced_with_correct_shot_association_and_ordering(textured_clip):
    path, size, duration = textured_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 3.0), (3.0, 8.0)],
        )
        try:
            resp = await analyze_reference_video_frames(reference_video_id=rv_id, db=db, user=user)
            assert resp.latest_analysis.status == "complete"
            assert resp.latest_analysis.pass_status["visual_evidence"] == "complete"
            assert len(resp.shots) == 2

            for shot in resp.shots:
                assert len(shot.frames) >= 1
                # chronological ordering: both `order` and `timestamp` strictly ascending
                assert [f.order for f in shot.frames] == list(range(len(shot.frames)))
                for prev, cur in zip(shot.frames, shot.frames[1:]):
                    assert cur.timestamp > prev.timestamp
                # every frame's timestamp genuinely falls within its own Shot's span
                for f in shot.frames:
                    assert shot.start_time <= f.timestamp <= shot.end_time
                    assert f.certainty == "MEASURED"
                    assert f.produced_by_pass == ffmpeg_svc.FRAME_EXTRACTION_PASS_NAME
                    assert f.width > 0 and f.height > 0
                    assert "luminance_mean" in f.measurements

            # correct Shot association at the DB level too (not just the response grouping)
            frame_rows = (await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == va_id))).scalars().all()
            for fr in frame_rows:
                assert fr.shot_id in shot_ids

            # Shot.keyframe_asset_id (Stage 1's original single-frame column) is populated too
            shot_rows = (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()
            assert all(s.keyframe_asset_id is not None for s in shot_rows)
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Very short Shot -> exactly one (midpoint) frame.
# ---------------------------------------------------------------------------

async def test_very_short_shot_yields_a_single_midpoint_frame(textured_clip):
    path, size, duration = textured_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 0.4)],
        )
        try:
            resp = await analyze_reference_video_frames(reference_video_id=rv_id, db=db, user=user)
            frames = resp.shots[0].frames
            assert len(frames) == 1
            assert frames[0].extraction_method == "shot_midpoint"
            assert round(frames[0].timestamp, 3) == 0.2
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Long Shot -> extra evenly-spaced frames beyond the base 3, capped.
# ---------------------------------------------------------------------------

async def test_long_shot_yields_extra_frames_beyond_the_base_three(varied_long_clip):
    path, size, duration = varied_long_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        # 12s shot: base 3 (start/mid/end) + floor((12-6)/5)=1 extra = 4 planned candidates.
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 12.0)],
        )
        try:
            resp = await analyze_reference_video_frames(reference_video_id=rv_id, db=db, user=user)
            frames = resp.shots[0].frames
            methods = [f.extraction_method for f in frames]
            assert "shot_start" in methods and "shot_midpoint" in methods and "shot_end" in methods
            assert len(frames) <= ffmpeg_svc.FRAME_MAX_PER_SHOT
            assert len(frames) >= 3  # a real, animated 12s source should not dedup below the base 3
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Duplicate/near-duplicate handling: a static clip collapses to one accepted frame.
# ---------------------------------------------------------------------------

async def test_static_content_collapses_to_one_accepted_frame(static_clip):
    path, size, duration = static_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 5.0)],
        )
        try:
            resp = await analyze_reference_video_frames(reference_video_id=rv_id, db=db, user=user)
            frames = resp.shots[0].frames
            # 3 candidates were planned (5.0s is in the 1.0-6.0s bracket) but every one is
            # pixel-identical -> exactly one survives dHash near-duplicate suppression.
            assert len(frames) == 1
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Malformed/not-yet-structurally-analysed input is rejected; no frames written.
# ---------------------------------------------------------------------------

async def test_frames_extraction_is_rejected_before_structural_analysis_completes(corrupt_file):
    path, size, duration = corrupt_file
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        asset = Asset(
            user_id=user.id, original_filename="stage5_corrupt.mp4", stored_filename="stage5_corrupt_stored.mp4",
            file_path=path, file_type="video", mime_type="video/mp4", file_size=size,
        )
        db.add(asset)
        await db.flush()
        rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload")
        db.add(rv)
        await db.flush()
        va = VideoAnalysis(reference_video_id=rv.id, status="failed", pass_status={"technical_probe": "failed"})
        db.add(va)
        await db.commit()
        try:
            with pytest.raises(HTTPException) as exc:
                await analyze_reference_video_frames(reference_video_id=rv.id, db=db, user=user)
            assert exc.value.status_code == 409

            frames = (await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == va.id))).scalars().all()
            assert frames == []
        finally:
            await _cleanup(db, asset.id, rv.id, va.id)


# ---------------------------------------------------------------------------
# Forced failure: no orphaned files, no partial "complete" state; then a clean in-place retry.
# ---------------------------------------------------------------------------

async def test_forced_failure_leaves_no_orphaned_files_then_retries_cleanly(textured_clip):
    path, size, duration = textured_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 3.0), (3.0, 8.0)],
        )
        upload_dir = Path(settings.UPLOAD_DIR) / str(user.id)
        before_files = set(upload_dir.glob("*")) if upload_dir.exists() else set()
        try:
            real_extract = ffmpeg_svc.extract_representative_frames_for_shot
            call_count = {"n": 0}

            async def _fail_on_second_shot(*args, **kwargs):
                call_count["n"] += 1
                if call_count["n"] == 2:
                    raise RuntimeError("forced failure for test")
                return await real_extract(*args, **kwargs)

            with patch.object(ffmpeg_svc, "extract_representative_frames_for_shot", new=AsyncMock(side_effect=_fail_on_second_shot)):
                failed = await analyze_reference_video_frames(reference_video_id=rv_id, db=db, user=user)
            assert failed.latest_analysis.status == "complete"  # last good checkpoint (Stage 4) intact
            assert failed.latest_analysis.pass_status["visual_evidence"] == "failed"
            assert failed.latest_analysis.error == "Unexpected error: forced failure for test"
            assert all(s.frames == [] for s in failed.shots)

            # No ShotFrame rows and no new files leaked from the first (successful) shot's own
            # extraction before the second shot's forced failure aborted the whole pass.
            frame_rows = (await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == va_id))).scalars().all()
            assert frame_rows == []
            after_files = set(upload_dir.glob("*")) if upload_dir.exists() else set()
            assert after_files == before_files, f"orphaned files left behind: {after_files - before_files}"

            # Retry, no monkeypatch this time — must succeed IN PLACE (same VideoAnalysis id).
            retried = await analyze_reference_video_frames(reference_video_id=rv_id, db=db, user=user)
            assert retried.latest_analysis.status == "complete"
            assert retried.latest_analysis.id == va_id
            assert all(len(s.frames) >= 1 for s in retried.shots)

            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            assert len(result.scalars().all()) == 1  # retry never created a second VideoAnalysis version

            # Idempotent re-call after success — no duplicate ShotFrame rows.
            again = await analyze_reference_video_frames(reference_video_id=rv_id, db=db, user=user)
            again_ids = sorted(f.id for s in again.shots for f in s.frames)
            retried_ids = sorted(f.id for s in retried.shots for f in s.frames)
            assert again_ids == retried_ids
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Stage 3/4 data (ReferenceVideo technical facts, Shot rows) unchanged by Stage 5.
# ---------------------------------------------------------------------------

async def test_stage3_and_stage4_data_unchanged_by_stage5(textured_clip):
    path, size, duration = textured_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 3.0), (3.0, 8.0)],
        )
        try:
            before_rv = await db.get(ReferenceVideo, rv_id)
            before_snapshot = (before_rv.duration, before_rv.width, before_rv.height, before_rv.technical_details)
            before_shots = (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()
            before_shot_spans = [(s.id, s.start_time, s.end_time, s.certainty) for s in before_shots]

            await analyze_reference_video_frames(reference_video_id=rv_id, db=db, user=user)

            after_rv = await db.get(ReferenceVideo, rv_id)
            after_snapshot = (after_rv.duration, after_rv.width, after_rv.height, after_rv.technical_details)
            assert before_snapshot == after_snapshot

            after_shots = (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()
            after_shot_spans = [(s.id, s.start_time, s.end_time, s.certainty) for s in after_shots]
            assert before_shot_spans == after_shot_spans  # Stage 5 only ADDS keyframe_asset_id + ShotFrame rows

            va = await db.get(VideoAnalysis, va_id)
            assert va.pass_status["technical_probe"] == "complete"
            assert va.pass_status["scene_segmentation"] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)
