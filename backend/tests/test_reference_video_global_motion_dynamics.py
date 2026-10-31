"""
Video Deconstructor — Stage 9 Phase C1 router-level tests: MOTION DYNAMICS EVIDENCE persisted
through the EXISTING analyze-global-motion endpoint (no new endpoint — C1 is a purely additive
extension of Phase A's own `global_motion_evidence` pass/category).

Same real-database, direct-router-call, no-HTTP-client convention as
test_reference_video_global_motion.py (see that file's own docstring). Confirms: the new
dynamics/cross_stream fields persist and surface through the response; every existing Phase-A
guarantee (MEASURED certainty, confidence_score=None, source/produced_by_pass unchanged,
Shot.camera_movement never written, idempotency) still holds; and no camera-motion label of any
kind appears anywhere in the persisted row or the API response.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from unittest.mock import AsyncMock, patch
import pytest

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
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


async def _make_ready_reference(db, user: User, file_path: str = "uploads/stage9_c1_test.mp4") -> tuple[int, int, int]:
    asset = Asset(
        user_id=user.id, original_filename="stage9_c1_test.mp4", stored_filename="stage9_c1_test_stored.mp4",
        file_path=file_path, file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=22.5)
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


def _evidence_with_dynamics(sample_count=90, frame_pair_count=89) -> dict:
    """A full C1-shaped evidence dict, exactly as visual_motion_svc.measure_shot_global_motion
    would now return it."""
    return {
        "sampling_fps": 5.0, "sample_count": sample_count, "frame_pair_count": frame_pair_count,
        "insufficient_temporal_samples": False,
        "affine": {
            "successful_pair_count": frame_pair_count, "failed_pair_count": 0, "estimation_success_rate": 1.0,
            "median_translation_x": 0.02, "median_translation_y": -0.01, "median_translation_magnitude": 0.15,
            "p95_translation_magnitude": 0.43, "median_scale": 1.0, "max_abs_scale_deviation_from_1": 0.0001,
            "median_rotation_deg": 0.0, "max_abs_rotation_deg": 0.09,
            "median_candidate_match_count": 350.0, "median_ransac_inlier_count": 345.0, "median_ransac_inlier_ratio": 0.989,
            "failure_reason_counts": None,
            "dynamics": {
                "translation_x": {"positive_delta_count": 40, "negative_delta_count": 49, "zero_delta_count": 0,
                                   "sign_change_count": 12, "median": 0.02, "min": -0.5, "max": 0.5, "range": 1.0,
                                   "standard_deviation": 0.11},
                "translation_y": {"positive_delta_count": 45, "negative_delta_count": 44, "zero_delta_count": 0,
                                   "sign_change_count": 10, "median": -0.01, "min": -0.4, "max": 0.4, "range": 0.8,
                                   "standard_deviation": 0.09},
                "translation_magnitude": {"median": 0.15, "min": 0.01, "max": 0.6, "range": 0.59,
                                           "standard_deviation": 0.08, "p95": 0.43},
                "rotation_deg": {"positive_delta_count": 44, "negative_delta_count": 45, "zero_delta_count": 0,
                                  "sign_change_count": 20, "median": 0.0, "min": -0.2, "max": 0.2, "range": 0.4,
                                  "standard_deviation": 0.05},
                "scale": {"median": 1.0, "min": 0.998, "max": 1.002, "range": 0.004, "standard_deviation": 0.0006},
                "successful_run_count": 1, "longest_successful_run_pair_count": frame_pair_count,
            },
        },
        "phase_correlation": {
            "median_dx": 0.001, "median_dy": 0.01, "median_translation_magnitude": 0.148,
            "p95_translation_magnitude": 0.433, "median_response": 0.9782, "minimum_response": 0.7898,
        },
        "cross_stream": {
            "magnitude_absolute_difference": 0.002,
            "magnitude_ratio_affine_over_phase": 1.0135,
            "signed_dx_difference_affine_minus_phase": 0.019,
            "signed_dy_difference_affine_minus_phase": -0.02,
        },
    }


# ---------------------------------------------------------------------------
# Dynamics/cross_stream persist and surface through the response.
# ---------------------------------------------------------------------------

async def test_dynamics_and_cross_stream_persist_and_surface_in_response():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            evidence = _evidence_with_dynamics()
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=evidence)):
                response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "global_motion_evidence",
            ))).scalars().first()
            assert row.details["affine"]["dynamics"]["translation_x"]["sign_change_count"] == 12
            assert row.details["affine"]["dynamics"]["successful_run_count"] == 1
            assert row.details["cross_stream"]["signed_dx_difference_affine_minus_phase"] == pytest.approx(0.019)

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.global_motion_evidence.affine.dynamics.translation_x.sign_change_count == 12
            assert shot_summary.global_motion_evidence.cross_stream.signed_dx_difference_affine_minus_phase == pytest.approx(0.019)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_dynamics_none_when_zero_successful_affine_pairs():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            evidence = {
                "sampling_fps": 5.0, "sample_count": 5, "frame_pair_count": 4,
                "insufficient_temporal_samples": False,
                "affine": {
                    "successful_pair_count": 0, "failed_pair_count": 4, "estimation_success_rate": 0.0,
                    "median_translation_x": None, "median_translation_y": None, "median_translation_magnitude": None,
                    "p95_translation_magnitude": None, "median_scale": None, "max_abs_scale_deviation_from_1": None,
                    "median_rotation_deg": None, "max_abs_rotation_deg": None, "median_candidate_match_count": None,
                    "median_ransac_inlier_count": None, "median_ransac_inlier_ratio": None,
                    "failure_reason_counts": {"insufficient_keypoints": 4}, "dynamics": None,
                },
                "phase_correlation": {
                    "median_dx": 0.0, "median_dy": 0.0, "median_translation_magnitude": 0.0,
                    "p95_translation_magnitude": 0.0, "median_response": 0.0, "minimum_response": 0.0,
                },
                "cross_stream": None,
            }
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=evidence)):
                response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.global_motion_evidence.affine.dynamics is None
            assert shot_summary.global_motion_evidence.cross_stream is None
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_router_tolerates_pre_c1_shaped_evidence_missing_new_keys():
    """Backwards compatibility: a caller/mock returning the OLD (pre-C1) evidence shape, with no
    'cross_stream' key at all, must not raise -- the router reads it defensively."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            pre_c1_evidence = {
                "sampling_fps": 5.0, "sample_count": 90, "frame_pair_count": 89,
                "insufficient_temporal_samples": False,
                "affine": {
                    "successful_pair_count": 89, "failed_pair_count": 0, "estimation_success_rate": 1.0,
                    "median_translation_x": 0.02, "median_translation_y": -0.01, "median_translation_magnitude": 0.15,
                    "p95_translation_magnitude": 0.43, "median_scale": 1.0, "max_abs_scale_deviation_from_1": 0.0001,
                    "median_rotation_deg": 0.0, "max_abs_rotation_deg": 0.09,
                    "median_candidate_match_count": 350.0, "median_ransac_inlier_count": 345.0, "median_ransac_inlier_ratio": 0.989,
                    "failure_reason_counts": None,
                    # no "dynamics" key at all -- pre-C1 shape
                },
                "phase_correlation": {
                    "median_dx": 0.001, "median_dy": 0.01, "median_translation_magnitude": 0.148,
                    "p95_translation_magnitude": 0.433, "median_response": 0.9782, "minimum_response": 0.7898,
                },
                # no "cross_stream" key at all -- pre-C1 shape
            }
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=pre_c1_evidence)):
                response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["global_motion_evidence"] == "complete"
            assert response.shots[0].global_motion_evidence.affine.dynamics is None
            assert response.shots[0].global_motion_evidence.cross_stream is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Existing Phase-A guarantees still hold.
# ---------------------------------------------------------------------------

async def test_measured_certainty_confidence_source_produced_by_pass_unchanged():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=_evidence_with_dynamics())):
                await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "global_motion_evidence",
            ))).scalars().first()
            assert row.certainty == "MEASURED"
            assert row.confidence_score is None
            assert row.source == GLOBAL_MOTION_EVIDENCE_SOURCE == "opencv_phase_affine"
            assert row.produced_by_pass == GLOBAL_MOTION_EVIDENCE_PASS_NAME == "global_motion_evidence_v1"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_shot_camera_movement_still_never_written():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=_evidence_with_dynamics())):
                await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)
            shot = await db.get(Shot, shot_id)
            assert shot.camera_movement is None
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_idempotency_still_holds_with_dynamics_present():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            mock_measure = AsyncMock(return_value=_evidence_with_dynamics())
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=mock_measure):
                await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)
                await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)
            assert mock_measure.await_count == 1
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "global_motion_evidence",
            ))).scalars().all()
            assert len(rows) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# No camera-motion labels anywhere in the persisted row or response.
# ---------------------------------------------------------------------------

async def test_no_camera_motion_label_anywhere_in_persisted_row_or_response():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(visual_motion_svc, "measure_shot_global_motion", new=AsyncMock(return_value=_evidence_with_dynamics())):
                response = await analyze_reference_video_global_motion(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "global_motion_evidence",
            ))).scalars().first()
            # row.details itself never carries reasoning/evidence_summary (those are separate
            # AnalysisAnnotation columns) -- but the response's own reasoning/evidence_summary
            # prose legitimately DISCUSSES these labels to disclaim them ("does not classify the
            # shot as static, panning, ..."), so those two prose fields are excluded from the
            # structured-data scan, exactly as this project's own B1 tests already established.
            dumped_row = str(row.details).lower()
            response_dump = response.shots[0].global_motion_evidence.model_dump()
            structural_response = {k: v for k, v in response_dump.items() if k not in ("reasoning", "evidence_summary")}
            for forbidden in ("static", "pan_left", "pan_right", "tilt_up", "tilt_down", "zoom_in", "zoom_out",
                              "handheld", "shake", "mixed", "insufficient_evidence"):
                assert forbidden not in dumped_row
                assert forbidden not in str(structural_response).lower()
        finally:
            await _cleanup(db, asset_id, rv_id)
