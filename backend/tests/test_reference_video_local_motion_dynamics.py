"""
Video Deconstructor — Stage 9 (Motion / Camera / Transitions / Animation), Phase D2 router tests:
LOCAL MOTION DYNAMICS.

Same real-database, direct-router-call, no-HTTP-client convention as every other Stage 6-9 router
test file in this suite (see test_reference_video_local_motion.py's own docstring).
`local_motion_dynamics_svc.measure_shot_local_motion_dynamics` is mocked exactly the same way
every other pass's own underlying service call is mocked in this suite — these tests never run a
real ffmpeg subprocess or real cv2 estimation; that happens separately in the service's own unit
tests and in controlled-corpus/real-video validation.

Covers: Stage-4-only prerequisite (D1 row NOT required), AnalysisAnnotation category/certainty/
confidence/source/produced_by_pass, source/pass column-length regression guards, shot-scoped
persistence, idempotency, failure/retry safety, D1 row untouched on D2 success AND on forced D2
failure (the explicit failure-isolation requirement), response exposure, backwards compatibility
for an older analysis with no D2 dynamics, Shot.camera_movement untouched, Stage 8 records
untouched, and no duplicate annotation on rerun.
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
    LOCAL_MOTION_DYNAMICS_PASS_NAME, LOCAL_MOTION_DYNAMICS_SOURCE, LOCAL_MOTION_EVIDENCE_PASS_NAME,
    LOCAL_MOTION_EVIDENCE_SOURCE, analyze_reference_video_local_motion, analyze_reference_video_local_motion_dynamics,
)
from app.services import local_motion_dynamics_svc, local_motion_evidence_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, file_path: str = "uploads/stage9_d2_test.mp4") -> tuple[int, int, int]:
    """A ReferenceVideo whose VideoAnalysis already has scene_segmentation="complete" — Phase
    D2's sole prerequisite — deliberately with NO other Stage 5-9 keys at all (including
    local_motion_evidence), to prove D2's independence from D1's own row."""
    asset = Asset(
        user_id=user.id, original_filename="stage9_d2_test.mp4", stored_filename="stage9_d2_test_stored.mp4",
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


def _empty_signed(available=9, unavailable=0):
    return {
        "available_pair_count": available, "unavailable_pair_count": unavailable,
        "value_positive_count": 0, "value_negative_count": 0, "value_zero_count": available,
        "delta_positive_count": 0, "delta_negative_count": 0, "delta_zero_count": max(available - 1, 0),
        "delta_sign_change_count": 0, "range": 0.0 if available else None,
        "longest_contiguous_available_run": available,
    }


def _empty_magnitude(available=9, unavailable=0):
    return {
        "available_pair_count": available, "unavailable_pair_count": unavailable,
        "delta_positive_count": 0, "delta_negative_count": 0, "delta_zero_count": max(available - 1, 0),
        "delta_sign_change_count": 0, "range": 0.0 if available else None,
        "longest_contiguous_available_run": available,
    }


def _empty_feature_availability(available=9):
    return {
        "tracked_point_count_temporal_mean": 0.0 if available else None,
        "tracked_point_count_temporal_min": 0 if available else None,
        "tracked_point_count_temporal_max": 0 if available else None,
        "zero_feature_pair_count": available, "longest_available_run": 0,
    }


def _mocked_dynamics(frame_pair_count=9, insufficient=False) -> dict:
    if insufficient:
        return {
            "insufficient_temporal_samples": True, "sampling_fps": 5.0, "sample_count": 1,
            "frame_pair_count": 0, "affine_successful_pair_count": None, "affine_failed_pair_count": None,
            "residual_dynamics": None, "uncompensated_flow_dynamics": None, "compensated_flow_dynamics": None,
            "spatial_distribution": None,
        }
    residual_dynamics = []
    uncompensated_flow_dynamics = []
    compensated_flow_dynamics = []
    for row in range(3):
        for col in range(4):
            is_hot = row == 1 and col == 1
            residual_dynamics.append({
                "row": row, "col": col,
                "mean": _empty_magnitude(frame_pair_count) if not is_hot else {
                    **_empty_magnitude(frame_pair_count), "range": 0.07, "delta_sign_change_count": 2,
                },
                "p95": _empty_magnitude(frame_pair_count),
                "max": _empty_magnitude(frame_pair_count),
            })
            uncompensated_flow_dynamics.append({
                "row": row, "col": col,
                "median_dx": _empty_signed(frame_pair_count), "median_dy": _empty_signed(frame_pair_count),
                "median_magnitude": _empty_magnitude(frame_pair_count), "p95_magnitude": _empty_magnitude(frame_pair_count),
                "feature_availability": _empty_feature_availability(frame_pair_count),
            })
            compensated_flow_dynamics.append({
                "row": row, "col": col,
                "median_dx": _empty_signed(frame_pair_count), "median_dy": _empty_signed(frame_pair_count),
                "median_magnitude": _empty_magnitude(frame_pair_count), "p95_magnitude": _empty_magnitude(frame_pair_count),
                "feature_availability": _empty_feature_availability(frame_pair_count),
            })
    spatial_distribution = {}
    for stream in local_motion_dynamics_svc.SPATIAL_STREAMS:
        spatial_distribution[stream] = {
            "argmax": {
                "available_pair_count": frame_pair_count, "tie_count": 0,
                "unique_argmax_cell_count": 1, "argmax_cell_change_count": 0,
                "most_frequent_argmax_cell": [1, 1], "most_frequent_argmax_frequency_count": frame_pair_count,
            },
            "centroid": {
                "available_pair_count": frame_pair_count, "unavailable_pair_count": 0,
                "cx_min": 0.45, "cx_max": 0.55, "cx_range": 0.1,
                "cy_min": 0.45, "cy_max": 0.55, "cy_range": 0.1,
                "delta_cx_positive_count": 0, "delta_cx_negative_count": 0, "delta_cx_zero_count": frame_pair_count - 1,
                "delta_cx_sign_change_count": 0,
                "delta_cy_positive_count": 0, "delta_cy_negative_count": 0, "delta_cy_zero_count": frame_pair_count - 1,
                "delta_cy_sign_change_count": 0,
                "displacement_temporal_mean": 0.01, "displacement_temporal_max": 0.02,
            },
            "total_weight": {
                "total_weight_temporal_mean": 0.3, "total_weight_temporal_max": 0.5,
                "total_weight_range": 0.2, "available_cell_count_temporal_mean": 4.0,
            },
        }
    return {
        "insufficient_temporal_samples": False, "sampling_fps": 5.0, "sample_count": frame_pair_count + 1,
        "frame_pair_count": frame_pair_count, "affine_successful_pair_count": frame_pair_count,
        "affine_failed_pair_count": 0,
        "residual_dynamics": residual_dynamics,
        "uncompensated_flow_dynamics": uncompensated_flow_dynamics,
        "compensated_flow_dynamics": compensated_flow_dynamics,
        "spatial_distribution": spatial_distribution,
    }


def _mocked_evidence(sample_count=10, frame_pair_count=9) -> dict:
    """Minimal valid D1 evidence dict — used only to prove D1's own row survives D2's own
    success/failure untouched; the exact contents don't matter beyond being D1-shape-valid."""
    def _empty_flow_cell(row, col):
        return {
            "row": row, "col": col, "total_tracked_point_count": 0, "contributing_pair_count": 0,
            "median_dx": {"temporal_mean": None}, "median_dy": {"temporal_mean": None},
            "median_magnitude": {"temporal_mean": None, "temporal_max": None},
            "p95_magnitude": {"temporal_mean": None, "temporal_max": None},
        }
    residual_grid = [
        {"row": r, "col": c, "contributing_pair_count": frame_pair_count,
         "mean": {"temporal_mean": 0.001, "temporal_max": 0.002},
         "p95": {"temporal_mean": 0.001, "temporal_max": 0.003},
         "max": {"temporal_mean": 0.005, "temporal_max": 0.01}}
        for r in range(3) for c in range(4)
    ]
    flow_grid = [_empty_flow_cell(r, c) for r in range(3) for c in range(4)]
    return {
        "insufficient_temporal_samples": False, "sampling_fps": 5.0, "sample_count": sample_count,
        "frame_pair_count": frame_pair_count, "affine_successful_pair_count": frame_pair_count,
        "affine_failed_pair_count": 0, "affine_failure_reason_counts": None,
        "valid_overlap_fraction": {"temporal_mean": 0.99, "temporal_min": 0.95},
        "residual_grid": residual_grid, "uncompensated_flow_grid": flow_grid, "compensated_flow_grid": flow_grid,
    }


# ---------------------------------------------------------------------------
# Provenance / column-length regression guards.
# ---------------------------------------------------------------------------

def test_source_value_fits_existing_column_length():
    assert len(LOCAL_MOTION_DYNAMICS_SOURCE) <= 32


def test_produced_by_pass_fits_existing_column_length():
    assert len(LOCAL_MOTION_DYNAMICS_PASS_NAME) <= 64


def test_category_fits_existing_column_length():
    assert len("local_motion_dynamics") <= 32


# ---------------------------------------------------------------------------
# Prerequisite gating: scene_segmentation required; D1 row NOT required.
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
                await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)
            assert exc_info.value.status_code == 409
        finally:
            await _cleanup(db, asset_id_, rv_id)


async def test_does_not_require_local_motion_evidence_or_any_other_pass():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            va = await db.get(VideoAnalysis, va_id)
            for key in ("visual_evidence", "text_analysis", "speech_analysis", "audio_structure",
                        "visual_objects", "visual_persistence", "visual_composition",
                        "global_motion_evidence", "transition_evidence", "local_motion_evidence"):
                assert key not in (va.pass_status or {})

            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(return_value=_mocked_dynamics())):
                response = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["local_motion_dynamics"] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Successful run: original source used, annotation semantics.
# ---------------------------------------------------------------------------

async def test_successful_run_uses_original_source_and_persists_correct_annotation():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user, file_path="uploads/1/07608cbc574e4efbbb474d94e4c51953.mp4")
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            mock_measure = AsyncMock(return_value=_mocked_dynamics())
            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=mock_measure):
                response = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            mock_measure.assert_awaited_once_with("uploads/1/07608cbc574e4efbbb474d94e4c51953.mp4", 0.0, 22.5)
            assert response.latest_analysis.pass_status["local_motion_dynamics"] == "complete"

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_dynamics",
            ))).scalars().all()
            assert len(rows) == 1
            row = rows[0]
            assert row.certainty == "MEASURED"
            assert row.confidence_score is None
            assert row.source == LOCAL_MOTION_DYNAMICS_SOURCE == "opencv_residual_sparse_flow"
            assert row.produced_by_pass == LOCAL_MOTION_DYNAMICS_PASS_NAME == "local_motion_dynamics_v1"
            assert row.shot_id == shot_id
            assert len(row.details["residual_dynamics"]) == 12
            assert set(row.details["spatial_distribution"].keys()) == set(local_motion_dynamics_svc.SPATIAL_STREAMS)
            assert row.details["extraction_parameters"]["grid_rows"] == 3
            assert row.details["extraction_parameters"]["grid_cols"] == 4

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.local_motion_dynamics is not None
            assert shot_summary.local_motion_dynamics.certainty == "MEASURED"
            assert len(shot_summary.local_motion_dynamics.residual_dynamics) == 12
            stream_summary = shot_summary.local_motion_dynamics.spatial_distribution["residual_mean"]
            assert stream_summary.argmax.most_frequent_argmax_cell == [1, 1]
            assert stream_summary.centroid.cx_range == pytest.approx(0.1)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_missing_source_file_fails_honestly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user, file_path="uploads/does_not_exist_anywhere.mp4")
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(side_effect=FileNotFoundError("Original reference video source not found"))):
                response = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["local_motion_dynamics"] == "failed"
            assert "not found" in response.latest_analysis.error
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_dynamics",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# D1 failure isolation — the explicit item-34 requirement.
# ---------------------------------------------------------------------------

async def test_d1_row_untouched_when_d2_runs_successfully():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=AsyncMock(return_value=_mocked_evidence())):
                await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)
            d1_rows_before = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
            ))).scalars().all()
            assert len(d1_rows_before) == 1
            d1_row_id = d1_rows_before[0].id

            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(return_value=_mocked_dynamics())):
                await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            d1_rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
            ))).scalars().all()
            assert len(d1_rows_after) == 1
            assert d1_rows_after[0].id == d1_row_id
            assert d1_rows_after[0].details == d1_rows_before[0].details
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_d1_row_untouched_when_d2_fails():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=AsyncMock(return_value=_mocked_evidence())):
                await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)
            d1_rows_before = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
            ))).scalars().all()
            assert len(d1_rows_before) == 1

            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(side_effect=RuntimeError("simulated D2 failure"))):
                failed_response = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["local_motion_dynamics"] == "failed"

            d1_rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
            ))).scalars().all()
            assert len(d1_rows_after) == 1
            assert d1_rows_after[0].details == d1_rows_before[0].details

            d2_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_dynamics",
            ))).scalars().all()
            assert d2_rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_d2_can_run_when_d1_was_never_run():
    """The explicit D2.2/D2 architecture decision: D2 does not read or require D1's own row."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            d1_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
            ))).scalars().all()
            assert d1_rows == []  # D1 genuinely never ran

            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(return_value=_mocked_dynamics())):
                response = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["local_motion_dynamics"] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Shot.camera_movement untouched; Stage 8/6 untouched.
# ---------------------------------------------------------------------------

async def test_shot_camera_movement_never_written():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(return_value=_mocked_dynamics())):
                await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)
            shot = await db.get(Shot, shot_id)
            assert shot.camera_movement is None
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_stage_8_and_stage_6_data_unaffected():
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

            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(return_value=_mocked_dynamics())):
                response = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            after_text = await db.get(TextElement, before_text_id)
            assert after_text.text == "pre-existing text"
            assert after_text.confidence_score == 0.9

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.visual_objects == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Idempotency, failure atomicity, retry.
# ---------------------------------------------------------------------------

async def test_repeated_successful_call_does_not_duplicate_annotations():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            mock_measure = AsyncMock(return_value=_mocked_dynamics())
            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=mock_measure):
                await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)
                await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            assert mock_measure.await_count == 1
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_dynamics",
            ))).scalars().all()
            assert len(rows) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_genuine_failure_fails_pass_with_no_orphan_rows_then_retry_succeeds():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(side_effect=RuntimeError("simulated failure"))):
                failed_response = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["local_motion_dynamics"] == "failed"
            assert "simulated failure" in failed_response.latest_analysis.error

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_dynamics",
            ))).scalars().all()
            assert rows == []

            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(return_value=_mocked_dynamics())):
                retried = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            assert retried.latest_analysis.pass_status["local_motion_dynamics"] == "complete"
            rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_dynamics",
            ))).scalars().all()
            assert len(rows_after) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Insufficient-samples / zero-shots behavior.
# ---------------------------------------------------------------------------

async def test_insufficient_samples_shot_produces_no_row_but_pass_completes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=30.100, end_time=30.150)
            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(return_value=_mocked_dynamics(insufficient=True))):
                response = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["local_motion_dynamics"] == "complete"
            assert response.latest_analysis.error is None
            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.local_motion_dynamics is None
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_dynamics",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_zero_shots_succeeds_with_zero_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            response = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["local_motion_dynamics"] == "complete"
            assert response.latest_analysis.error is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Backwards compatibility: an older analysis with no D2 dynamics still serializes.
# ---------------------------------------------------------------------------

async def test_shot_without_local_motion_dynamics_still_serializes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            from app.routers.reference_videos import _to_response
            rv = await db.get(ReferenceVideo, rv_id)
            asset = await db.get(Asset, asset_id)
            response = await _to_response(db, rv, asset)
            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.local_motion_dynamics is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# No camera-motion/animation/trajectory labels anywhere in the persisted row or response.
# ---------------------------------------------------------------------------

async def test_no_semantic_labels_in_persisted_row_or_response():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_dynamics_svc, "measure_shot_local_motion_dynamics", new=AsyncMock(return_value=_mocked_dynamics())):
                response = await analyze_reference_video_local_motion_dynamics(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_dynamics",
            ))).scalars().first()
            dumped_row = str(row.details).lower()
            response_dump = response.shots[0].local_motion_dynamics.model_dump()
            structural_response = {k: v for k, v in response_dump.items() if k not in ("reasoning", "evidence_summary")}
            for forbidden in ("static", "pan_left", "pan_right", "tilt_up", "tilt_down", "zoom_in", "zoom_out",
                              "handheld", "shake", "animation", "person", "screen", "object trajectory",
                              "object path", "tracked object", "ease-in", "ease-out", "oscillation",
                              "motion confidence", "reliability score"):
                assert forbidden not in dumped_row
                assert forbidden not in str(structural_response).lower()
        finally:
            await _cleanup(db, asset_id, rv_id)
