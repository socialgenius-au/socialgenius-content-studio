"""
Video Deconstructor — Stage 4 (Deterministic Shot/Cut Boundary Detection) tests.

Same real-database, direct-function-call approach test_reference_video_analysis.py /
test_reference_video_ingestion.py already established — this project has no HTTP test client
anywhere. Fixtures use TEXTURED synthetic content (testsrc/smptebars/testsrc2), never flat solid
colors — a real, documented finding from this stage's own design review is that ffmpeg's
scene-difference score can be exactly 0.0 for a hard cut between two flat colors (see
ffmpeg_svc.py's own module docstring), so a flat-color fixture would not reliably test anything.

Covers the 12 requested checks:
  A. synthetic video with known hard cuts (exact-value assertions against real detected output)
  B. continuous video with no cuts (exactly one segment spanning the whole duration)
  C. rapid-cut fixture (many short segments)
  D. malformed/corrupt video failure
  E. retry/idempotency (a genuine Stage-4-only failure via a monkeypatched detector, then an
     in-place retry that succeeds — this codebase's own real toolchain could not be made to
     produce a file that passes Stage 3's header probe but fails Stage 4's decode, so the
     failure itself is injected at its real boundary function, same technique this project's own
     Stage-3 tests already use for its rotation-tag case)
  F. no duplicate Shot rows (idempotent re-call, and retry-after-failure)
  G. full-duration coverage (first segment starts at 0.0, last ends at the real duration)
  H. no overlaps (each segment's start == the previous one's end)
  I. chronological ordering (order column strictly ascending, matching start_time order)
  J. Stage-3 technical facts remain unchanged by Stage 4
  K. ReferenceVideo identity fields remain unchanged by Stage 4
  L. existing Video Studio draft/timeline untouched — verified separately at the DB level in the
     implementation report (this suite creates and cleans up only its own throwaway rows; it
     never touches video_studio_drafts at all, by construction — no import, no query, no write)
"""
import asyncio
import subprocess

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest
from unittest.mock import AsyncMock, patch

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.routers.reference_videos import analyze_reference_video, analyze_reference_video_structure
from app.services import ffmpeg_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_reference_with_pending_analysis(db, user: User, file_path: str, file_size: int) -> tuple[int, int]:
    asset = Asset(
        user_id=user.id, original_filename="stage4_test.mp4", stored_filename="stage4_test_stored.mp4",
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


async def _run_stage3_then_stage4(db, user, rv_id):
    """Every Stage-4 test needs a Stage-3-complete row first — this is the real dependency
    Stage 4 itself enforces, not a test convenience shortcut."""
    stage3 = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
    assert stage3.latest_analysis.status == "complete", "fixture precondition: Stage 3 must succeed"
    return await analyze_reference_video_structure(reference_video_id=rv_id, db=db, user=user)


def _run_ffmpeg(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg fixture generation failed: {result.stderr[-1000:]}")


# ---------------------------------------------------------------------------
# Fixtures — textured content with known, deliberately-placed cuts.
# ---------------------------------------------------------------------------

@pytest.fixture
def known_cuts_clip(tmp_path) -> tuple[str, int]:
    """3 distinct textured 2s segments -> hard cuts at exactly 2.0s and 4.0s, 6.0s total."""
    out = tmp_path / "stage4_known_cuts.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "testsrc=s=320x240:d=2:r=25",
        "-f", "lavfi", "-i", "smptebars=s=320x240:d=2:r=25",
        "-f", "lavfi", "-i", "testsrc2=s=320x240:d=2:r=25",
        "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[outv]",
        "-map", "[outv]", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size


@pytest.fixture
def continuous_clip(tmp_path) -> tuple[str, int]:
    """One single, unbroken textured source — no concat, no cuts."""
    out = tmp_path / "stage4_continuous.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "testsrc=s=320x240:d=4:r=25",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size


@pytest.fixture
def rapid_cuts_clip(tmp_path) -> tuple[str, int]:
    """6 alternating textured 0.5s segments -> 5 hard cuts, 3.0s total, every segment short."""
    out = tmp_path / "stage4_rapid_cuts.mp4"
    sources = ["testsrc", "smptebars", "testsrc2", "testsrc", "smptebars", "testsrc2"]
    inputs = []
    for src in sources:
        inputs += ["-f", "lavfi", "-i", f"{src}=s=320x240:d=0.5:r=25"]
    filter_inputs = "".join(f"[{i}:v]" for i in range(len(sources)))
    cmd = [ffmpeg_svc.FFMPEG_BIN, "-y", *inputs,
           "-filter_complex", f"{filter_inputs}concat=n={len(sources)}:v=1:a=0[outv]",
           "-map", "[outv]", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)]
    _run_ffmpeg(cmd)
    return str(out), out.stat().st_size


@pytest.fixture
def corrupt_file(tmp_path) -> tuple[str, int]:
    out = tmp_path / "stage4_corrupt.mp4"
    out.write_bytes(b"not a real video, just garbage bytes 0123456789")
    return str(out), out.stat().st_size


# ---------------------------------------------------------------------------
# A/G/H/I. Known cuts: exact detection, full coverage, no overlaps, chronological order.
# ---------------------------------------------------------------------------

async def test_known_hard_cuts_are_detected_with_correct_coverage_and_order(known_cuts_clip):
    path, size = known_cuts_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            resp = await _run_stage3_then_stage4(db, user, rv_id)
            assert resp.latest_analysis.status == "complete"
            assert resp.latest_analysis.pass_status == {"technical_probe": "complete", "scene_segmentation": "complete"}

            shots = resp.shots
            assert len(shots) == 3
            # A: exact known cut points
            assert [round(s.start_time, 1) for s in shots] == [0.0, 2.0, 4.0]
            assert [round(s.end_time, 1) for s in shots] == [2.0, 4.0, 6.0]
            # G: full-duration coverage — first starts at 0, last ends at the real duration
            assert shots[0].start_time == 0.0
            assert round(shots[-1].end_time, 2) == 6.0
            # H: no gaps or overlaps — each start == previous end, exactly
            for prev, cur in zip(shots, shots[1:]):
                assert cur.start_time == prev.end_time
            # I: strictly ascending chronological order
            assert [s.order for s in shots] == [0, 1, 2]
            assert all(shots[i].start_time < shots[i + 1].start_time for i in range(len(shots) - 1))
            # certainty/evidence/provenance
            assert all(s.certainty == "MEASURED" for s in shots)
            assert shots[0].evidence_summary and "no preceding" in shots[0].evidence_summary.lower()
            assert "threshold=0.30" in shots[1].evidence_summary
            assert all(s.produced_by_pass == "scene_cut_detection_v1" for s in shots)
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# B. Continuous video, no cuts -> exactly one segment spanning the whole duration.
# ---------------------------------------------------------------------------

async def test_continuous_video_with_no_cuts_yields_one_segment(continuous_clip):
    path, size = continuous_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            resp = await _run_stage3_then_stage4(db, user, rv_id)
            assert resp.latest_analysis.status == "complete"
            assert len(resp.shots) == 1
            assert resp.shots[0].start_time == 0.0
            assert round(resp.shots[0].end_time, 1) == 4.0
            assert resp.shots[0].certainty == "MEASURED"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# C. Rapid cuts -> many short segments, still gap-free and ordered.
# ---------------------------------------------------------------------------

async def test_rapid_cuts_produce_multiple_short_ordered_segments(rapid_cuts_clip):
    path, size = rapid_cuts_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            resp = await _run_stage3_then_stage4(db, user, rv_id)
            assert resp.latest_analysis.status == "complete"
            shots = resp.shots
            assert len(shots) >= 2  # at least some of the 5 planted cuts were detected
            assert shots[0].start_time == 0.0
            assert round(shots[-1].end_time, 1) == round(resp.technical_details["container"]["duration_seconds"], 1)
            for prev, cur in zip(shots, shots[1:]):
                assert cur.start_time == prev.end_time  # H: no gaps/overlaps even under rapid cuts
            assert [s.order for s in shots] == list(range(len(shots)))  # I
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# D. Malformed input fails safely — no fake segments, technical facts untouched.
# ---------------------------------------------------------------------------

async def test_malformed_video_is_rejected_before_structural_analysis_can_run(corrupt_file):
    path, size = corrupt_file
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            stage3 = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert stage3.latest_analysis.status == "failed"

            with pytest.raises(HTTPException) as exc:
                await analyze_reference_video_structure(reference_video_id=rv_id, db=db, user=user)
            assert exc.value.status_code == 409

            result = await db.execute(select(Shot).where(Shot.video_analysis_id == stage3.latest_analysis.id))
            assert result.scalars().all() == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# E/F. Stage-4-specific failure + in-place retry, no duplicate Shot rows.
# ---------------------------------------------------------------------------

async def test_stage4_failure_is_retried_in_place_without_duplicating_shots(known_cuts_clip):
    """This real toolchain could not be made to produce a file that passes Stage 3's header
    probe but fails Stage 4's decode — so the failure is injected at the exact real function
    Stage 4 calls (detect_shot_boundary_candidates), same technique already used for the
    rotation-tag case in this project's own Stage-3 tests."""
    path, size = known_cuts_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            stage3 = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert stage3.latest_analysis.status == "complete"

            with patch.object(
                ffmpeg_svc, "detect_shot_boundary_candidates",
                new=AsyncMock(side_effect=ffmpeg_svc.TechnicalProbeError("forced failure for test")),
            ):
                failed = await analyze_reference_video_structure(reference_video_id=rv_id, db=db, user=user)
            assert failed.latest_analysis.status == "complete"  # top-level status: last good checkpoint intact
            assert failed.latest_analysis.pass_status["scene_segmentation"] == "failed"
            assert failed.latest_analysis.error == "forced failure for test"
            assert failed.shots == []

            # Stage-3 facts must be completely untouched by the Stage-4 failure.
            rv_after_failure = await db.get(ReferenceVideo, rv_id)
            assert rv_after_failure.duration == stage3.technical_details["container"]["duration_seconds"]

            # Retry, no monkeypatch this time — must succeed IN PLACE (same VideoAnalysis id).
            retried = await analyze_reference_video_structure(reference_video_id=rv_id, db=db, user=user)
            assert retried.latest_analysis.status == "complete"
            assert retried.latest_analysis.id == stage3.latest_analysis.id  # same row, not a new version
            assert len(retried.shots) == 3

            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            assert len(result.scalars().all()) == 1  # F: retry never created a second VideoAnalysis

            # Idempotent re-call after success — no duplicate Shot rows.
            again = await analyze_reference_video_structure(reference_video_id=rv_id, db=db, user=user)
            assert [s.id for s in again.shots] == [s.id for s in retried.shots]
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Concurrency: two genuinely simultaneous requests never produce conflicting runs.
# ---------------------------------------------------------------------------

async def test_concurrent_structure_analysis_calls_do_not_create_conflicting_runs(known_cuts_clip):
    path, size = known_cuts_clip
    async with _TestSessionLocal() as setup_db:
        user = await _existing_test_user(setup_db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(setup_db, user, path, size)
        await analyze_reference_video(reference_video_id=rv_id, db=setup_db, user=user)
    user_id = user.id

    async def call():
        async with _TestSessionLocal() as db:
            u = await db.get(User, user_id)
            try:
                r = await analyze_reference_video_structure(reference_video_id=rv_id, db=db, user=u)
                return ("ok", r.latest_analysis.status)
            except HTTPException as e:
                return ("conflict", e.status_code)

    results = await asyncio.gather(call(), call())
    outcomes = {r[0] for r in results}
    assert outcomes == {"ok", "conflict"}, f"expected exactly one success and one 409, got {results}"

    async with _TestSessionLocal() as db:
        result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
        rows = result.scalars().all()
        assert len(rows) == 1
        shots = (await db.execute(select(Shot).where(Shot.video_analysis_id == rows[0].id))).scalars().all()
        assert len(shots) == 3  # no duplicate/conflicting shot set was written
        await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# J/K. Stage-3 facts and ReferenceVideo identity are unchanged by Stage 4.
# ---------------------------------------------------------------------------

async def test_stage3_facts_and_reference_video_identity_unchanged_by_stage4(known_cuts_clip):
    path, size = known_cuts_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            stage3 = await analyze_reference_video(reference_video_id=rv_id, db=db, user=user)
            before = await db.get(ReferenceVideo, rv_id)
            before_snapshot = (
                before.asset_id, before.user_id, before.source, before.rights_status, before.created_at,
                before.duration, before.width, before.height, before.fps, before.codec, before.has_audio,
                before.technical_details,
            )

            await analyze_reference_video_structure(reference_video_id=rv_id, db=db, user=user)

            after = await db.get(ReferenceVideo, rv_id)
            after_snapshot = (
                after.asset_id, after.user_id, after.source, after.rights_status, after.created_at,
                after.duration, after.width, after.height, after.fps, after.codec, after.has_audio,
                after.technical_details,
            )
            assert before_snapshot == after_snapshot

            # Stage-3's own VideoAnalysis pass entry must survive Stage 4 untouched.
            va = await db.get(VideoAnalysis, stage3.latest_analysis.id)
            assert va.pass_status["technical_probe"] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# No Scene row is ever created by Stage 4.
# ---------------------------------------------------------------------------

async def test_no_scene_rows_created_by_stage4(known_cuts_clip):
    path, size = known_cuts_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id = await _make_reference_with_pending_analysis(db, user, path, size)
        try:
            resp = await _run_stage3_then_stage4(db, user, rv_id)
            result = await db.execute(select(Scene).where(Scene.video_analysis_id == resp.latest_analysis.id))
            assert result.scalars().all() == []
            assert all(s.scene_id is None for s in
                       (await db.execute(select(Shot).where(Shot.video_analysis_id == resp.latest_analysis.id))).scalars().all())
        finally:
            await _cleanup(db, asset_id, rv_id)
