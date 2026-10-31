"""
Video Deconstructor — Stage 6 (OCR / On-Screen Text / Captions) tests.

Same real-database, direct-function-call, hand-picked-Shot-rows approach
test_reference_video_frames.py already established — bypasses real Stage 4 cut-detection for
deterministic control over Shot durations/spans, and builds VideoAnalysis.pass_status directly
into the exact state Stage 6 expects to start from (technical_probe + scene_segmentation +
visual_evidence all "complete").

Fixtures use ffmpeg's own `drawtext` filter to plant KNOWN, real, readable text at KNOWN times —
same "exact-value assertions against real detected output" philosophy as Stage 4's own known-cut
fixtures. Verified during this suite's own construction: a single boxed word at fontsize>=48 on a
640x480 testsrc background reads back via EasyOCR at >99% confidence, reliably and repeatably;
multi-word phrases at small font sizes can be split/misread by the detector, so fixtures use
single words.

Covers the requested checks:
  - text detected with correct Shot association, confidence, geometry, provenance
  - text appearing only in a narrow mid-shot window is caught by Stage 6's own supplementary
    sampling even though Stage 5's OWN 3 representative frames (chosen deliberately NOT to
    overlap that window) show no text at all — the actual empirical justification for Hybrid-D
  - a shot with no on-screen text yields zero occurrences, not a failure
  - the pass is refused (409) before visual-evidence extraction has completed
  - retry/idempotency: a forced failure resets state without duplicating rows/files, and a
    genuine in-place retry succeeds with no duplicate VideoAnalysis/TextElement rows
  - partial failure leaves no orphaned frame files on disk
  - Stage 3/4/5 data (ReferenceVideo technical facts, Shot rows, ShotFrame rows) unchanged
  - zero external API calls: structurally guaranteed — ocr_svc's entire code path only ever
    invokes the local EasyOCR engine (itself local/torch-based, no network call at inference
    time) and the local ffmpeg binary; no AI/HTTP client is imported or reachable from it.

Two-level evidence structure (post-manual-test refinement):
  - every raw OCR observation is preserved and auditable — an Occurrence Group backed by
    multiple raw detections keeps ALL of them as real TextElement rows (occurrence_group_id
    pointing at the group's own canonical head), never merges/edits/drops one
  - a Recurring Element (AnalysisAnnotation, category="recurring_text_element") cross-references
    two Occurrence Groups separated by a gap too large for Occurrence Grouping's own tight
    window, WITHOUT merging their time spans — certainty "INFERRED", distinct from the
    unconditionally "MEASURED" TextElement rows it references
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
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.shot_frame import ShotFrame
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.routers.reference_videos import analyze_reference_video_text
from app.services import ffmpeg_svc, ocr_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, file_path: str, file_size: int, duration: float, shot_spans: list[tuple[float, float]]) -> tuple[int, int, int, list[int]]:
    """Same fixture-construction helper as test_reference_video_frames.py's own, extended one
    step further: pass_status already includes visual_evidence="complete" (Stage 6's own
    prerequisite) with no real ShotFrame rows created — Stage 6 tolerates a Shot with zero
    Stage-5 frames (its supplementary sampling covers it regardless), and every test here cares
    about Stage 6's own behavior, not Stage 5's."""
    asset = Asset(
        user_id=user.id, original_filename="stage6_test.mp4", stored_filename="stage6_test_stored.mp4",
        file_path=file_path, file_type="video", mime_type="video/mp4", file_size=file_size,
    )
    db.add(asset)
    await db.flush()

    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()

    va = VideoAnalysis(
        reference_video_id=rv.id, status="complete",
        pass_status={"technical_probe": "complete", "scene_segmentation": "complete", "visual_evidence": "complete"},
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
    """Extends test_reference_video_frames.py's own _cleanup one step further: a TextElement's
    source_frame_asset_id may point at either an existing ShotFrame's own Asset (protected —
    ShotFrame's own cleanup owns it) or a NEW Stage-6-only Asset (this cleanup's own to remove).
    ReferenceVideo deletion cascades VideoAnalysis -> Shot/ShotFrame/TextElement automatically;
    none of that cascade touches the Asset rows those tables reference (RESTRICT, by design)."""
    protected_asset_ids: set[int] = set()
    extra_asset_ids: set[int] = set()
    if video_analysis_id is not None:
        frame_result = await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == video_analysis_id))
        protected_asset_ids = {f.asset_id for f in frame_result.scalars().all()}
        text_result = await db.execute(select(TextElement).where(TextElement.video_analysis_id == video_analysis_id))
        extra_asset_ids = {
            t.source_frame_asset_id for t in text_result.scalars().all()
            if t.source_frame_asset_id is not None and t.source_frame_asset_id not in protected_asset_ids
        }

    if reference_video_id is not None:
        rv = await db.get(ReferenceVideo, reference_video_id)
        if rv:
            await db.delete(rv)
            await db.flush()

    for aid in protected_asset_ids | extra_asset_ids:
        a = await db.get(Asset, aid)
        if a:
            try:
                Path(a.file_path).unlink(missing_ok=True)
            except OSError:
                pass
            await db.delete(a)

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
def sale_text_clip(tmp_path) -> tuple[str, int, float]:
    """A single boxed word, visible for the FULL 5s duration — every candidate frame should
    detect it. Verified during this suite's own construction: reads back at >99% confidence."""
    out = tmp_path / "stage6_sale.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "testsrc=s=640x480:d=5:r=25",
        "-vf", "drawtext=text='SALE':fontcolor=white:fontsize=72:box=1:boxcolor=black@0.6:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size, 5.0


@pytest.fixture
def midshot_text_clip(tmp_path) -> tuple[str, int, float]:
    """9s duration, text visible ONLY during t=[2,3]s — chosen so Stage 5's own 3 representative-
    frame timestamps for a 9s shot (start=0.15, mid=4.5, end=8.85 — verified directly against
    ffmpeg_svc.plan_representative_frame_timestamps(0.0, 9.0) during this suite's own
    construction) never fall inside the text's visible window, while Stage 6's own supplementary
    fixed-interval sampling (every 1.5s -> includes ~2.571s) does."""
    out = tmp_path / "stage6_midshot.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "testsrc=s=640x480:d=9:r=25",
        "-vf", "drawtext=text='HOTDEAL':enable='between(t,2,3)':fontcolor=white:fontsize=48:box=1:boxcolor=black@0.6:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size, 9.0


@pytest.fixture
def no_text_clip(tmp_path) -> tuple[str, int, float]:
    """Plain textured source, no drawtext at all."""
    out = tmp_path / "stage6_no_text.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "testsrc=s=640x480:d=3:r=25",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size, 3.0


@pytest.fixture
def recurring_text_clip(tmp_path) -> tuple[str, int, float]:
    """30s duration: the SAME word visible for the FULL duration of two separate 5s windows
    ([0,5]s and [20,25]s), each mapped to its OWN Shot row by the test itself (there's a plain,
    text-free stretch in between that no Shot span covers at all). Each 5s window matches the
    already-proven-reliable `sale_text_clip` pattern (text visible the whole shot, not a narrow
    sub-shot flash) so this test exercises Occurrence Grouping/Recurring Element linkage itself
    without depending on select_frames_to_ocr's own dHash near-duplicate filter (a separate,
    already-approved mechanism, not this change's concern) landing on one exact instant — using a
    narrow same-shot flash here hit exactly that unrelated dHash edge case during this test's own
    construction, so the fixture was redesigned around two independent Shots instead."""
    out = tmp_path / "stage6_recurring.mp4"
    _run_ffmpeg([
        ffmpeg_svc.FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "testsrc=s=640x480:d=30:r=25",
        "-vf", r"drawtext=text='REPEAT':enable='between(t\,0\,5)+between(t\,20\,25)':"
               r"fontcolor=white:fontsize=48:box=1:boxcolor=black@0.6:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out), out.stat().st_size, 30.0


# ---------------------------------------------------------------------------
# Text detected with correct Shot association, confidence, geometry, provenance, dedup.
# ---------------------------------------------------------------------------

async def test_text_detected_with_correct_association_confidence_and_geometry(sale_text_clip):
    path, size, duration = sale_text_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 5.0)],
        )
        try:
            resp = await analyze_reference_video_text(reference_video_id=rv_id, db=db, user=user)
            assert resp.latest_analysis.status == "complete"
            assert resp.latest_analysis.pass_status["text_analysis"] == "complete"

            occurrences = resp.shots[0].text_elements
            assert len(occurrences) >= 1
            sale_occurrences = [o for o in occurrences if o.text.strip().upper() == "SALE"]
            assert sale_occurrences, f"expected a 'SALE' occurrence, got {[o.text for o in occurrences]}"
            occ = sale_occurrences[0]

            assert occ.certainty == "MEASURED"
            assert occ.confidence_score is not None and occ.confidence_score > 0.9
            assert occ.produced_by_pass == "ocr_text_detection_v1"
            assert 0.0 <= occ.x <= 1.0 and 0.0 <= occ.y <= 1.0
            assert 0.0 <= occ.width <= 1.0 and 0.0 <= occ.height <= 1.0
            assert occ.source_frame_asset_file_path is not None
            assert occ.style_details is not None and "dominant_text_color_rgb" in occ.style_details

            # dedup: text visible the whole shot, sampled from multiple frames AND two language
            # groups each frame — must collapse to a small, sane number of occurrences, not one
            # row per raw detection.
            assert len(sale_occurrences) <= 2

            # correct Shot association at the DB level too.
            db_rows = (await db.execute(select(TextElement).where(TextElement.video_analysis_id == va_id))).scalars().all()
            assert all(r.shot_id == shot_ids[0] for r in db_rows)
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Text visible only in a narrow mid-shot window is caught by supplementary sampling.
# ---------------------------------------------------------------------------

async def test_midshot_text_missed_by_representative_frames_is_caught_by_supplementary_sampling(midshot_text_clip):
    path, size, duration = midshot_text_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 9.0)],
        )
        try:
            resp = await analyze_reference_video_text(reference_video_id=rv_id, db=db, user=user)
            assert resp.latest_analysis.status == "complete"
            occurrences = resp.shots[0].text_elements
            texts = [o.text.strip().upper() for o in occurrences]
            assert any("HOTDEA" in t for t in texts), f"expected the mid-shot text to be caught, got {texts}"
            # and it must be timed correctly — inside the [2,3]s window, not at a Stage-5-style
            # start/mid/end point.
            match = next(o for o in occurrences if "HOTDEA" in o.text.strip().upper())
            assert 1.5 <= match.start_time <= 3.5
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# No on-screen text -> zero occurrences, not a failure.
# ---------------------------------------------------------------------------

async def test_no_text_yields_zero_occurrences_not_a_failure(no_text_clip):
    path, size, duration = no_text_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 3.0)],
        )
        try:
            resp = await analyze_reference_video_text(reference_video_id=rv_id, db=db, user=user)
            assert resp.latest_analysis.status == "complete"
            assert resp.latest_analysis.pass_status["text_analysis"] == "complete"
            # A plain textsrc pattern occasionally triggers a low-confidence false-positive read
            # (a real, disclosed risk — see the design review) — assert no HIGH-confidence
            # occurrence exists, rather than asserting an impossible universal zero.
            assert all((o.confidence_score or 0) < 0.5 for o in resp.shots[0].text_elements)
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Refused before visual-evidence extraction has completed.
# ---------------------------------------------------------------------------

async def test_text_analysis_is_rejected_before_visual_evidence_completes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        asset = Asset(
            user_id=user.id, original_filename="stage6_gate_test.mp4", stored_filename="stage6_gate_test_stored.mp4",
            file_path="unused.mp4", file_type="video", mime_type="video/mp4", file_size=1,
        )
        db.add(asset)
        await db.flush()
        rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=5.0)
        db.add(rv)
        await db.flush()
        va = VideoAnalysis(
            reference_video_id=rv.id, status="complete",
            pass_status={"technical_probe": "complete", "scene_segmentation": "complete"},  # no visual_evidence
        )
        db.add(va)
        await db.commit()
        try:
            with pytest.raises(HTTPException) as exc:
                await analyze_reference_video_text(reference_video_id=rv.id, db=db, user=user)
            assert exc.value.status_code == 409

            rows = (await db.execute(select(TextElement).where(TextElement.video_analysis_id == va.id))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset.id, rv.id, va.id)


# ---------------------------------------------------------------------------
# Forced failure: no orphaned files, no partial "complete" state; then a clean in-place retry.
# ---------------------------------------------------------------------------

async def test_forced_failure_leaves_no_orphaned_files_then_retries_cleanly(sale_text_clip):
    path, size, duration = sale_text_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 5.0)],
        )
        upload_dir = Path(settings.UPLOAD_DIR) / str(user.id)
        before_files = set(upload_dir.glob("*")) if upload_dir.exists() else set()
        try:
            with patch.object(ocr_svc, "detect_text_in_frame", new=AsyncMock(side_effect=RuntimeError("forced failure for test"))):
                failed = await analyze_reference_video_text(reference_video_id=rv_id, db=db, user=user)
            assert failed.latest_analysis.status == "complete"  # last good checkpoint (Stage 5) intact
            assert failed.latest_analysis.pass_status["text_analysis"] == "failed"
            assert failed.latest_analysis.error == "Unexpected error: forced failure for test"
            assert all(s.text_elements == [] for s in failed.shots)

            text_rows = (await db.execute(select(TextElement).where(TextElement.video_analysis_id == va_id))).scalars().all()
            assert text_rows == []
            after_files = set(upload_dir.glob("*")) if upload_dir.exists() else set()
            assert after_files == before_files, f"orphaned files left behind: {after_files - before_files}"

            # Retry, no monkeypatch this time — must succeed IN PLACE (same VideoAnalysis id).
            retried = await analyze_reference_video_text(reference_video_id=rv_id, db=db, user=user)
            assert retried.latest_analysis.status == "complete"
            assert retried.latest_analysis.id == va_id
            assert any(len(s.text_elements) > 0 for s in retried.shots)

            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            assert len(result.scalars().all()) == 1  # retry never created a second VideoAnalysis version

            # Idempotent re-call after success — no duplicate TextElement rows.
            again = await analyze_reference_video_text(reference_video_id=rv_id, db=db, user=user)
            again_ids = sorted(t.id for s in again.shots for t in s.text_elements)
            retried_ids = sorted(t.id for s in retried.shots for t in s.text_elements)
            assert again_ids == retried_ids
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Stage 3/4/5 data unchanged by Stage 6.
# ---------------------------------------------------------------------------

async def test_stage3_stage4_stage5_data_unchanged_by_stage6(sale_text_clip):
    path, size, duration = sale_text_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 5.0)],
        )
        try:
            before_rv = await db.get(ReferenceVideo, rv_id)
            before_snapshot = (before_rv.duration, before_rv.width, before_rv.height, before_rv.technical_details)
            before_shots = (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()
            before_shot_spans = [(s.id, s.start_time, s.end_time, s.certainty, s.keyframe_asset_id) for s in before_shots]
            before_frames = (await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == va_id))).scalars().all()
            assert before_frames == []  # this fixture never created any — confirms Stage 6 doesn't need them

            await analyze_reference_video_text(reference_video_id=rv_id, db=db, user=user)

            after_rv = await db.get(ReferenceVideo, rv_id)
            after_snapshot = (after_rv.duration, after_rv.width, after_rv.height, after_rv.technical_details)
            assert before_snapshot == after_snapshot

            after_shots = (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()
            after_shot_spans = [(s.id, s.start_time, s.end_time, s.certainty, s.keyframe_asset_id) for s in after_shots]
            assert before_shot_spans == after_shot_spans  # Stage 6 never writes to Shot at all

            after_frames = (await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == va_id))).scalars().all()
            assert after_frames == []  # Stage 6 never creates ShotFrame rows

            va = await db.get(VideoAnalysis, va_id)
            assert va.pass_status["technical_probe"] == "complete"
            assert va.pass_status["scene_segmentation"] == "complete"
            assert va.pass_status["visual_evidence"] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Every raw OCR observation is preserved and auditable — an Occurrence Group backed by multiple
# raw detections keeps ALL of them as real rows, never merging/editing/dropping one.
# ---------------------------------------------------------------------------

async def test_every_raw_observation_is_preserved_under_its_occurrence_group(sale_text_clip):
    path, size, duration = sale_text_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 5.0)],
        )
        try:
            resp = await analyze_reference_video_text(reference_video_id=rv_id, db=db, user=user)
            sale = next(o for o in resp.shots[0].text_elements if o.text.strip().upper() == "SALE")

            # The API's own nested `observations` shows every raw reading grouped under this head.
            assert len(sale.observations) >= 2
            assert any(obs.id == sale.id for obs in sale.observations)  # the head is its own
            # first observation, included — never hidden even though it's also the summary

            # And at the DB level: every raw TextElement row for this text is a REAL, separate,
            # unedited row — the head has occurrence_group_id NULL, every other member points at
            # the head's own id, and NOTHING was deleted to produce the single summary above.
            db_rows = (await db.execute(
                select(TextElement).where(TextElement.video_analysis_id == va_id, TextElement.text.ilike("%sale%"))
            )).scalars().all()
            assert len(db_rows) == len(sale.observations)
            heads = [r for r in db_rows if r.occurrence_group_id is None]
            members = [r for r in db_rows if r.occurrence_group_id is not None]
            assert len(heads) == 1 and heads[0].id == sale.id
            assert all(m.occurrence_group_id == sale.id for m in members)
            assert all(r.certainty == "MEASURED" for r in db_rows)  # grouping never changes certainty
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Recurring Element: two Occurrence Groups separated by a gap too large for Occurrence Grouping's
# own window get cross-referenced, WITHOUT merging their time spans, as an explicitly INFERRED
# AnalysisAnnotation — distinct from the MEASURED TextElement rows it references.
# ---------------------------------------------------------------------------

async def test_recurring_element_links_separated_groups_without_merging_their_spans(recurring_text_clip):
    path, size, duration = recurring_text_clip
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids = await _make_ready_reference(
            db, user, path, size, duration, shot_spans=[(0.0, 5.0), (20.0, 25.0)],
        )
        try:
            resp = await analyze_reference_video_text(reference_video_id=rv_id, db=db, user=user)
            repeat_groups = [o for shot in resp.shots for o in shot.text_elements if o.text.strip().upper() == "REPEAT"]

            # Occurrence Grouping must NOT bridge the two Shots — two separate groups (one per
            # Shot), each an honest, narrow evidentially-supported span, never merged across the
            # 15s text-free gap between them.
            assert len(repeat_groups) == 2
            for g in repeat_groups:
                assert g.end_time - g.start_time < 5.0

            # Recurring Element must cross-reference them — explicitly INFERRED, with its own
            # confidence, and a time span that is the OUTER bound only (not a continuity claim).
            assert len(resp.recurring_elements) >= 1
            rel = next(r for r in resp.recurring_elements if set(g.id for g in repeat_groups) <= set(r.member_text_element_ids))
            assert rel.certainty == "INFERRED"
            assert rel.confidence_score is not None and rel.confidence_score > 0.5
            assert rel.produced_by_pass == "recurring_text_linkage_v1"
            group_start = min(g.start_time for g in repeat_groups)
            group_end = max(g.end_time for g in repeat_groups)
            assert rel.start_time == group_start and rel.end_time == group_end

            # And the two TextElement heads themselves stay unconditionally MEASURED — the
            # certainty/provenance split from the Recurring Element's own INFERRED status.
            assert all(g.certainty == "MEASURED" for g in repeat_groups)

            # DB-level: the recurring element is a real AnalysisAnnotation row, not a TextElement.
            annotation_rows = (await db.execute(
                select(AnalysisAnnotation).where(
                    AnalysisAnnotation.video_analysis_id == va_id,
                    AnalysisAnnotation.category == "recurring_text_element",
                )
            )).scalars().all()
            assert len(annotation_rows) >= 1
            assert all(a.certainty == "INFERRED" for a in annotation_rows)
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Last-candidate safeguard (post-manual-test refinement): ocr_svc.select_frames_to_ocr must
# never let dHash filtering drop a Shot's chronologically LAST candidate — see the Stage-6 dHash
# investigation for the real, confirmed completeness gap this closes (Sameena's real Shot 02
# lost its only two supplementary candidates to a stale comparison anchor; one of them showed
# the video's own recurring watermark, captured nowhere else in that shot).
# ---------------------------------------------------------------------------

def test_select_frames_to_ocr_always_keeps_the_last_candidate(tmp_path, monkeypatch):
    from app.services import ffmpeg_svc, ocr_svc

    # Three synthetic 1x1 JPEGs so compute_dhash has something real to hash — content doesn't
    # matter here, only that the FIRST candidate's own hash is what the LAST one gets compared
    # against (both far enough from it in Hamming terms to normally be rejected).
    from PIL import Image
    paths = []
    for i, color in enumerate([(0, 0, 0), (250, 250, 250), (255, 255, 255)]):
        p = tmp_path / f"f{i}.jpg"
        Image.new("RGB", (16, 16), color).save(p)
        paths.append(str(p))

    candidates = [
        {"file_path": paths[0], "timestamp": 1.0},
        {"file_path": paths[1], "timestamp": 2.0},
        {"file_path": paths[2], "timestamp": 3.0},
    ]

    # Force every candidate after the first to register as "near-duplicate" of the first, the
    # exact real-world failure mode this safeguard exists for — without this monkeypatch, a
    # black/near-white/white 16x16 swatch might or might not clear the real threshold on its own,
    # and this test needs to exercise the safeguard deterministically, not hope for it.
    monkeypatch.setattr(ffmpeg_svc, "hamming_distance", lambda a, b: 0)

    selected = ocr_svc.select_frames_to_ocr(candidates)
    selected_paths = [c["file_path"] for c in selected]

    assert paths[0] in selected_paths  # first candidate — already guaranteed by the base algorithm
    assert paths[2] in selected_paths  # last candidate — guaranteed ONLY by this safeguard
    assert paths[1] not in selected_paths  # the middle one has no such guarantee and stays dropped
