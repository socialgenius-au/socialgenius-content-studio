"""
Video Deconstructor — Stage 9 (Motion / Camera / Transitions / Animation), Phase D1 router tests:
LOCAL MOTION EVIDENCE.

Same real-database, direct-router-call, no-HTTP-client convention as every other Stage 6-9 router
test file in this suite (see test_reference_video_global_motion.py's own docstring).
`local_motion_evidence_svc.measure_shot_local_motion` is mocked exactly the same way every other
pass's own underlying service call is mocked in this suite — these tests never run a real ffmpeg
subprocess or real cv2 estimation; that happens separately in the service's own unit tests and in
controlled-corpus/real-video validation.

Covers: Stage-4-only prerequisite (no other Stage 5-9 pass required), AnalysisAnnotation category/
certainty/confidence/source/produced_by_pass, shot-scoped persistence, idempotency, failure/retry
safety, response exposure, backwards compatibility for an older analysis with no D1 evidence,
Shot.camera_movement untouched, Stage 8 records untouched, and no duplicate annotation on rerun.
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
    LOCAL_MOTION_EVIDENCE_PASS_NAME, LOCAL_MOTION_EVIDENCE_SOURCE, analyze_reference_video_local_motion,
)
from app.services import local_motion_evidence_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, file_path: str = "uploads/stage9_d1_test.mp4") -> tuple[int, int, int]:
    """A ReferenceVideo whose VideoAnalysis already has scene_segmentation="complete" — Phase
    D1's sole prerequisite — deliberately with NO other Stage 5-9 keys at all, to prove
    independence from every other pass."""
    asset = Asset(
        user_id=user.id, original_filename="stage9_d1_test.mp4", stored_filename="stage9_d1_test_stored.mp4",
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


def _empty_flow_cell(row, col):
    """Matches local_motion_evidence_svc._aggregate_flow_grid's own real output shape for a cell
    with zero tracked points across every pair: still a full dict (never a bare None), with
    every temporal-aggregate sub-field None."""
    return {
        "row": row, "col": col, "total_tracked_point_count": 0, "contributing_pair_count": 0,
        "median_dx": {"temporal_mean": None}, "median_dy": {"temporal_mean": None},
        "median_magnitude": {"temporal_mean": None, "temporal_max": None},
        "p95_magnitude": {"temporal_mean": None, "temporal_max": None},
    }


def _mocked_evidence(sample_count=10, frame_pair_count=9, insufficient=False) -> dict:
    if insufficient:
        return {
            "insufficient_temporal_samples": True, "sampling_fps": 5.0, "sample_count": sample_count,
            "frame_pair_count": 0, "affine_successful_pair_count": None, "affine_failed_pair_count": None,
            "affine_failure_reason_counts": None, "valid_overlap_fraction": None,
            "residual_grid": None, "uncompensated_flow_grid": None, "compensated_flow_grid": None,
        }
    residual_grid = []
    uncompensated_flow_grid = []
    compensated_flow_grid = []
    for row in range(3):
        for col in range(4):
            is_hot = row == 1 and col == 1
            residual_grid.append({
                "row": row, "col": col, "contributing_pair_count": frame_pair_count,
                "mean": {"temporal_mean": 0.08 if is_hot else 0.001, "temporal_max": 0.15 if is_hot else 0.002},
                "p95": {"temporal_mean": 0.12 if is_hot else 0.001, "temporal_max": 0.2 if is_hot else 0.003},
                "max": {"temporal_mean": 0.2 if is_hot else 0.005, "temporal_max": 0.3 if is_hot else 0.01},
            })
            uncompensated_flow_grid.append(_empty_flow_cell(row, col))
            if is_hot:
                compensated_flow_grid.append({
                    "row": row, "col": col, "total_tracked_point_count": 40, "contributing_pair_count": frame_pair_count,
                    "median_dx": {"temporal_mean": 1.2}, "median_dy": {"temporal_mean": -0.5},
                    "median_magnitude": {"temporal_mean": 1.3, "temporal_max": 2.0},
                    "p95_magnitude": {"temporal_mean": 1.8, "temporal_max": 2.5},
                })
            else:
                compensated_flow_grid.append(_empty_flow_cell(row, col))
    return {
        "insufficient_temporal_samples": False, "sampling_fps": 5.0, "sample_count": sample_count,
        "frame_pair_count": frame_pair_count, "affine_successful_pair_count": frame_pair_count,
        "affine_failed_pair_count": 0, "affine_failure_reason_counts": None,
        "valid_overlap_fraction": {"temporal_mean": 0.99, "temporal_min": 0.95},
        "residual_grid": residual_grid, "uncompensated_flow_grid": uncompensated_flow_grid,
        "compensated_flow_grid": compensated_flow_grid,
    }


# ---------------------------------------------------------------------------
# Prerequisite gating: scene_segmentation required; no other Stage 5-9 requirement.
# ---------------------------------------------------------------------------

def test_source_value_fits_existing_column_length():
    """Regression guard: AnalysisAnnotation.source is String(32) (unmodified) — the pass name's
    own source identifier must fit it exactly, never require a schema migration."""
    assert len(LOCAL_MOTION_EVIDENCE_SOURCE) <= 32


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
                await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)
            assert exc_info.value.status_code == 409
        finally:
            await _cleanup(db, asset_id_, rv_id)


async def test_does_not_require_any_other_stage_5_to_9_pass():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            va = await db.get(VideoAnalysis, va_id)
            for key in ("visual_evidence", "text_analysis", "speech_analysis", "audio_structure",
                        "visual_objects", "visual_persistence", "visual_composition",
                        "global_motion_evidence", "transition_evidence"):
                assert key not in (va.pass_status or {})

            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=AsyncMock(return_value=_mocked_evidence())):
                response = await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["local_motion_evidence"] == "complete"
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
            mock_measure = AsyncMock(return_value=_mocked_evidence())
            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=mock_measure):
                response = await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)

            mock_measure.assert_awaited_once_with("uploads/1/07608cbc574e4efbbb474d94e4c51953.mp4", 0.0, 22.5)
            assert response.latest_analysis.pass_status["local_motion_evidence"] == "complete"

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
            ))).scalars().all()
            assert len(rows) == 1
            row = rows[0]
            assert row.certainty == "MEASURED"
            assert row.confidence_score is None
            assert row.source == LOCAL_MOTION_EVIDENCE_SOURCE == "opencv_residual_sparse_flow"
            assert row.produced_by_pass == LOCAL_MOTION_EVIDENCE_PASS_NAME == "local_motion_evidence_v1"
            assert row.shot_id == shot_id
            assert len(row.details["residual_grid"]) == 12
            assert row.details["extraction_parameters"]["grid_rows"] == 3
            assert row.details["extraction_parameters"]["grid_cols"] == 4

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.local_motion_evidence is not None
            assert shot_summary.local_motion_evidence.certainty == "MEASURED"
            assert len(shot_summary.local_motion_evidence.residual_grid) == 12
            hot_cell = next(c for c in shot_summary.local_motion_evidence.residual_grid if c.row == 1 and c.col == 1)
            assert hot_cell.mean.temporal_mean == pytest.approx(0.08)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_missing_source_file_fails_honestly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user, file_path="uploads/does_not_exist_anywhere.mp4")
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=AsyncMock(side_effect=FileNotFoundError("Original reference video source not found"))):
                response = await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["local_motion_evidence"] == "failed"
            assert "not found" in response.latest_analysis.error
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Shot.camera_movement untouched; Stage 8 untouched.
# ---------------------------------------------------------------------------

async def test_shot_camera_movement_never_written():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=AsyncMock(return_value=_mocked_evidence())):
                await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)
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

            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=AsyncMock(return_value=_mocked_evidence())):
                response = await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)

            after_text = await db.get(TextElement, before_text_id)
            assert after_text.text == "pre-existing text"
            assert after_text.confidence_score == 0.9

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.visual_objects == []  # Stage 8 unaffected/absent, as expected
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
            mock_measure = AsyncMock(return_value=_mocked_evidence())
            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=mock_measure):
                await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)
                await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)

            assert mock_measure.await_count == 1  # idempotent early-return skipped the second call
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
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
            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=AsyncMock(side_effect=RuntimeError("simulated failure"))):
                failed_response = await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["local_motion_evidence"] == "failed"
            assert "simulated failure" in failed_response.latest_analysis.error

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
            ))).scalars().all()
            assert rows == []

            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=AsyncMock(return_value=_mocked_evidence())):
                retried = await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)

            assert retried.latest_analysis.pass_status["local_motion_evidence"] == "complete"
            rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
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
            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=AsyncMock(return_value=_mocked_evidence(insufficient=True))):
                response = await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["local_motion_evidence"] == "complete"
            assert response.latest_analysis.error is None
            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.local_motion_evidence is None
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_zero_shots_succeeds_with_zero_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            response = await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["local_motion_evidence"] == "complete"
            assert response.latest_analysis.error is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Backwards compatibility: an older analysis with no D1 evidence still serializes.
# ---------------------------------------------------------------------------

async def test_shot_without_local_motion_evidence_still_serializes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            # No local-motion pass run at all — response must still build successfully.
            from app.routers.reference_videos import _to_response
            rv = await db.get(ReferenceVideo, rv_id)
            asset = await db.get(Asset, asset_id)
            response = await _to_response(db, rv, asset)
            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.local_motion_evidence is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# No camera-motion/animation labels anywhere in the persisted row or response.
# ---------------------------------------------------------------------------

async def test_no_camera_motion_or_animation_label_in_persisted_row_or_response():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=22.5)
            with patch.object(local_motion_evidence_svc, "measure_shot_local_motion", new=AsyncMock(return_value=_mocked_evidence())):
                response = await analyze_reference_video_local_motion(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "local_motion_evidence",
            ))).scalars().first()
            dumped_row = str(row.details).lower()
            response_dump = response.shots[0].local_motion_evidence.model_dump()
            structural_response = {k: v for k, v in response_dump.items() if k not in ("reasoning", "evidence_summary")}
            for forbidden in ("static", "pan_left", "pan_right", "tilt_up", "tilt_down", "zoom_in", "zoom_out",
                              "handheld", "shake", "animation", "person", "screen"):
                assert forbidden not in dumped_row
                assert forbidden not in str(structural_response).lower()
        finally:
            await _cleanup(db, asset_id, rv_id)
