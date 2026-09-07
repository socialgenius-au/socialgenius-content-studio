"""
Video Deconstructor — Stage 9 (Motion / Camera / Transitions / Animation), Phase A router tests:
TEMPORAL / GLOBAL-MOTION EVIDENCE FOUNDATION.

Same real-database, direct-router-call, no-HTTP-client convention as every other Stage 6-8 router
test file in this suite (see test_reference_video_visual_composition.py's own docstring).
`visual_motion_svc.measure_shot_global_motion` is mocked exactly the same way every other pass's
own underlying service call is mocked in this suite's other router test files — these tests never
run a real ffmpeg subprocess or real cv2 estimation; that happens separately in the service's own
unit tests (synthetic images) and in the real-video validation performed once, manually, against
the already-approved real ReferenceVideo/VideoAnalysis.

Covers the router-level checks from Phase A's own 20-item router test list (21-40): Stage-4-only
prerequisite (21), no Stage-8 prerequisite (22), original source used (23), missing source fails
(24), AnalysisAnnotation category/certainty/confidence/source/produced_by_pass (25-29), one
annotation per eligible shot (30), no Shot.camera_movement write (31), idempotency (32), failure
atomicity (33), retry (34), zero/insufficient shot behavior (35), Stage-5 unchanged (39), Stage-8
unchanged (40). Hard-cut boundary isolation (38) is verified via the per-shot call arguments
(each shot's own start_time/end_time, never a merged/cross-shot window) — a real, dense
per-frame-pair check happens in the real-video validation.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from unittest.mock import AsyncMock, patch
import pytest
from fastapi import HTTPException

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.routers.reference_videos import (
    GLOBAL_MOTION_EVIDENCE_PASS_NAME, GLOBAL_MOTION_EVIDENCE_SOURCE, analyze_reference_video_global_motion,
)
from app.services import visual_motion_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, duration: float = 34.0, file_path: str = "uploads/stage9_motion_test.mp4") -> tuple[int, int, int]:
    """A ReferenceVideo whose VideoAnalysis already has scene_segmentation="complete" — Phase A's
    sole prerequisite — deliberately with NO visual_objects/visual_persistence/visual_composition
    keys at all, to prove independence from every Stage-8 pass."""
    asset = Asset(
        user_id=user.id, original_filename="stage9_motion_test.mp4", stored_filename="stage9_motion_test_stored.mp4",
        file_path=file_path, file_type="video", mime_type="video/mp4", file_size=4096,
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

    await db.commit()
    return rv.id, asset.id, va.id


async def _add_shot(db, va_id: int, order: int, start_time: float, end_time: float) -> int:
    shot = Shot(
        video_analysis_id=va_id, scene_id=None, order=order, start_time=start_time, end_time=end_time,
        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1",
    )
    db.add(shot)
    await db.commit()
    return shot.id


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


def _mocked_evidence(sampling_fps=5.0, sample_count=90, frame_pair_count=89, insufficient=False) -> dict:
    if insufficient:
        return {"sampling_fps": sampling_fps, "sample_count": sample_count, "frame_pair_count": 0,
                "insufficient_temporal_samples": True, "affine": None, "phase_correlation": None}
    return {
        "sampling_fps": sampling_fps, "sample_count": sample_count, "frame_pair_count": frame_pair_count,
        "insufficient_temporal_samples": False,
        "affine": {
            "successful_pair_count": frame_pair_count, "failed_pair_count": 0, "estimation_success_rate": 1.0,
            "median_translation_x": 0.02, "median_translation_y": -0.01, "median_translation_magnitude": 0.15,
            "p95_translation_magnitude": 0.43, "median_scale": 1.0, "max_abs_scale_deviation_from_1": 0.0001,
            "median_rotation_deg": 0.0, "max_abs_rotation_deg": 0.09,
            "median_candidate_match_count": 350.0, "median_ransac_inlier_count": 345.0, "median_ransac_inlier_ratio": 0.989,
            "failure_reason_counts": None,
        },
        "phase_correlation": {
            "median_dx": 0.001, "median_dy": 0.01, "median_translation_magnitude": 0.148,
            "p95_translation_magnitude": 0.433, "median_response": 0.9782, "minimum_response": 0.7898,
        },
    }


# ---------------------------------------------------------------------------
# 21/22. Prerequisite gating: scene_segmentation required; no Stage-8 requirement.
# ---------------------------------------------------------------------------

async def test_rejected_before_scene_segmentation_completes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        asset = Asset(
            user_id=user.id, original_filename="not_yet.mp4", stored_filename="not_yet_stored.mp4",
            file_path="uploads/not_yet.mp4", file_type="video", mime_type="video/mp4", file_size=10,
        )
        db.add(asset)
        await db.flush()
        rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload")
        db.add(rv)
        await db.flush()
        va = VideoAnalysis(reference_video_id=rv.id, pass_status={"technical_probe": "complete"})
        db.add(va)
        await db.commit()
        rv_id, asset_id_ = rv.id, asset.id
        try:
            with pytest.raises(HTTPException) as exc_info:
                await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)
            assert exc_info.value.status_code == 409
        finally:
            await _cleanup(db, asset_id_, rv_id)


async def test_does_not_require_any_stage_8_pass():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            va = await db.get(VideoAnalysis, va_id)
            assert "visual_objects" not in (va.pass_status or {})
            assert "visual_persistence" not in (va.pass_status or {})
            assert "visual_composition" not in (va.pass_status or {})

            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=_mocked_evidence())):
                response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["global_motion_evidence"] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 23/25-30. Successful run: original source used, annotation semantics, one per eligible shot.
# ---------------------------------------------------------------------------

async def test_successful_run_uses_original_source_and_persists_correct_annotation():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user, file_path="uploads/1/07608cbc574e4efbbb474d94e4c51953.mp4")
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            mock_measure = AsyncMock(return_value=_mocked_evidence())
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=mock_measure):
                response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            # 23: original source path passed through, never a Stage-5 still or derivative.
            mock_measure.assert_awaited_once_with("uploads/1/07608cbc574e4efbbb474d94e4c51953.mp4", 0.0, 22.5)

            assert response.latest_analysis.pass_status["global_motion_evidence"] == "complete"

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "global_motion_evidence",
            ))).scalars().all()
            assert len(rows) == 1  # 30: one per eligible shot
            row = rows[0]
            assert row.certainty == "MEASURED"  # 26
            assert row.confidence_score is None  # 27
            assert row.source == GLOBAL_MOTION_EVIDENCE_SOURCE == "opencv_phase_affine"  # 28
            assert row.produced_by_pass == GLOBAL_MOTION_EVIDENCE_PASS_NAME == "global_motion_evidence_v1"  # 29
            assert row.shot_id == shot_id
            assert row.details["sampling_fps"] == 5.0
            assert row.details["affine"]["median_scale"] == pytest.approx(1.0)
            assert row.details["extraction_parameters"]["orb_nfeatures"] == 500

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.global_motion_evidence is not None
            assert shot_summary.global_motion_evidence.certainty == "MEASURED"
            assert shot_summary.global_motion_evidence.affine.median_scale == pytest.approx(1.0)
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 24. Missing original source file fails honestly.
# ---------------------------------------------------------------------------

async def test_missing_source_file_fails_honestly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user, file_path="uploads/does_not_exist_anywhere.mp4")
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(side_effect=FileNotFoundError("Original reference video source not found"))):
                response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["global_motion_evidence"] == "failed"
            assert "not found" in response.latest_analysis.error

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "global_motion_evidence",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 31. Shot.camera_movement is never written.
# ---------------------------------------------------------------------------

async def test_shot_camera_movement_never_written():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=_mocked_evidence())):
                await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            shot = await db.get(Shot, shot_id)
            assert shot.camera_movement is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 32/33/34. Idempotency, failure atomicity, retry.
# ---------------------------------------------------------------------------

async def test_genuine_failure_fails_pass_with_no_orphan_rows_then_retry_succeeds():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(side_effect=RuntimeError("simulated failure"))):
                failed_response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["global_motion_evidence"] == "failed"
            assert "simulated failure" in failed_response.latest_analysis.error

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "global_motion_evidence",
            ))).scalars().all()
            assert rows == []

            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=_mocked_evidence())):
                retried = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            assert retried.latest_analysis.pass_status["global_motion_evidence"] == "complete"
            rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "global_motion_evidence",
            ))).scalars().all()
            assert len(rows_after) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_repeated_successful_call_does_not_duplicate_annotations():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            mock_measure = AsyncMock(return_value=_mocked_evidence())
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=mock_measure):
                first = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)
                second = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            assert mock_measure.await_count == 1  # idempotent early-return skipped the second call
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "global_motion_evidence",
            ))).scalars().all()
            assert len(rows) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 35. Insufficient-samples shot produces zero rows for that shot, pass still completes.
# ---------------------------------------------------------------------------

async def test_insufficient_samples_shot_produces_no_row_but_pass_completes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=1, start_time=30.100, end_time=30.150)
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=_mocked_evidence(insufficient=True))):
                response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["global_motion_evidence"] == "complete"
            assert response.latest_analysis.error is None
            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.global_motion_evidence is None

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "global_motion_evidence",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_zero_shots_succeeds_with_zero_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["global_motion_evidence"] == "complete"
            assert response.latest_analysis.error is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 38. Hard-cut boundary isolation: each shot is measured with its OWN start/end, never merged.
# ---------------------------------------------------------------------------

async def test_each_shot_measured_independently_never_a_merged_cross_shot_window():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot0_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.100)
            shot1_id = await _add_shot(db, va_id, order=1, start_time=30.100, end_time=34.15)

            mock_measure = AsyncMock(return_value=_mocked_evidence())
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=mock_measure):
                await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            assert mock_measure.await_count == 2
            call_windows = [(c.args[1], c.args[2]) for c in mock_measure.await_args_list]
            assert (0.0, 30.100) in call_windows
            assert (30.100, 34.15) in call_windows
            # Never a single call spanning across both shots (e.g. (0.0, 34.15)).
            assert (0.0, 34.15) not in call_windows
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 39/40. Stage 5 and Stage 8 data are unaffected by this pass.
# ---------------------------------------------------------------------------

async def test_stage_5_and_stage_8_data_unaffected():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            text_el = TextElement(
                video_analysis_id=va_id, shot_id=shot_id, text="pre-existing text", x=0.1, y=0.1, width=0.2, height=0.1,
                start_time=1.0, end_time=1.0, certainty="MEASURED", confidence_score=0.9,
            )
            db.add(text_el)
            await db.commit()
            before_text_id = text_el.id

            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=_mocked_evidence())):
                response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            after_text = await db.get(TextElement, before_text_id)
            assert after_text.text == "pre-existing text"
            assert after_text.confidence_score == 0.9

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert len(shot_summary.text_elements) == 1  # Stage 6 data still surfaces, untouched
            assert shot_summary.visual_objects == []  # Stage 8 unaffected/absent, as expected
        finally:
            await _cleanup(db, asset_id, rv_id)
