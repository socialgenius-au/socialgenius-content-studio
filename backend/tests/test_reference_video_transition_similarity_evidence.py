"""
Video Deconstructor — Stage 9 (Motion / Camera / Transitions / Animation), Phase B2 router tests:
TRANSITION SIMILARITY EVIDENCE.

Same real-database, direct-router-call, no-HTTP-client convention as
test_reference_video_transition_evidence.py (see that file's own docstring).
`transition_similarity_evidence_svc.measure_boundary_transition_similarity` is mocked exactly the
same way — these tests never run a real ffmpeg subprocess; that happens separately in the
service's own unit tests and in real-video/controlled-corpus validation.

Covers: Stage-4-only prerequisite (B1 row NOT required), zero/one/multiple-boundary videos,
candidate-window clipping never crossing unrelated shots, shot_id=None + preceding/following shot
IDs, MEASURED certainty/confidence_score=None/source/produced_by_pass, idempotent rerun, genuine-
failure-then-retry safety, the explicit "previous successful B2 result survives a later
measurement failure" safety property, B1 row untouched on B2 success AND on forced B2 failure,
Shot.camera_movement/Stage-8 untouched, backward-compatible response, and no similarity-
transfer/classification/trust fields anywhere in the persisted row or response.
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
    TRANSITION_EVIDENCE_PASS_NAME, TRANSITION_EVIDENCE_SOURCE,
    TRANSITION_SIMILARITY_EVIDENCE_PASS_NAME, TRANSITION_SIMILARITY_EVIDENCE_SOURCE,
    analyze_reference_video_transition_evidence, analyze_reference_video_transition_similarity,
)
from app.services import transition_evidence_svc, transition_similarity_evidence_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, duration: float = 34.15, file_path: str = "uploads/stage9_b2_test.mp4") -> tuple[int, int, int]:
    """A ReferenceVideo whose VideoAnalysis already has scene_segmentation="complete" — Phase
    B2's sole prerequisite — deliberately with NO transition_evidence (B1) key at all, to prove
    B2's independence from B1's own row."""
    asset = Asset(
        user_id=user.id, original_filename="stage9_b2_test.mp4", stored_filename="stage9_b2_test_stored.mp4",
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


def _mocked_similarity_evidence(
    boundary_timestamp=30.1, window_start=29.6, window_end=30.6, sample_count=10, insufficient=False,
) -> dict:
    if insufficient:
        return {
            "insufficient_boundary_material": True, "sampling_fps": 10.0, "sample_count": sample_count,
            "boundary_timestamp": boundary_timestamp, "window_start": window_start, "window_end": window_end,
            "cross_boundary_similarity": None, "pre_window_edge_similarity": None,
            "post_window_edge_similarity": None, "pre_trigger_adjacent_similarity": None,
            "post_trigger_adjacent_similarity": None,
        }
    return {
        "insufficient_boundary_material": False, "sampling_fps": 10.0, "sample_count": sample_count,
        "boundary_timestamp": boundary_timestamp, "window_start": window_start, "window_end": window_end,
        "cross_boundary_similarity": 0.82, "pre_window_edge_similarity": 0.995,
        "post_window_edge_similarity": 0.993, "pre_trigger_adjacent_similarity": 0.994,
        "post_trigger_adjacent_similarity": 0.996,
    }


def _mocked_transition_evidence(sample_count=10, frame_pair_count=9) -> dict:
    """Minimal valid B1 evidence dict — used only to prove B1's own row survives B2's own
    success/failure untouched; the exact contents don't matter beyond being B1-shape-valid."""
    return {
        "insufficient_boundary_material": False, "sampling_fps": 10.0, "sample_count": sample_count,
        "frame_pair_count": frame_pair_count, "boundary_timestamp": 30.1, "window_start": 29.6, "window_end": 30.6,
        "sample_timestamps": [29.6 + i / 10.0 for i in range(sample_count)],
        "luminance": {"values": [100.0] * sample_count, "first_value": 100.0, "last_value": 100.0,
                      "min": 100.0, "max": 100.0, "signed_total_change": 0.0, "regression_slope": 0.0,
                      "positive_delta_count": 0, "negative_delta_count": 0, "zero_delta_count": sample_count - 1,
                      "sign_change_count": 0},
        "frame_difference": {"values": [0.01] * frame_pair_count, "median": 0.01, "max": 0.01, "argmax_index": 0},
        "black_frame_flags": [False] * sample_count,
        "affine_evidence": {"pairs": [], "successful_pair_count": 0, "failed_pair_count": 0, "failure_reason_counts": None},
        "phase_correlation_evidence": {"pairs": []},
    }


# ---------------------------------------------------------------------------
# Provenance / column-length regression guards.
# ---------------------------------------------------------------------------

def test_source_value_fits_existing_column_length():
    assert len(TRANSITION_SIMILARITY_EVIDENCE_SOURCE) <= 32


def test_produced_by_pass_fits_existing_column_length():
    assert len(TRANSITION_SIMILARITY_EVIDENCE_PASS_NAME) <= 64


def test_category_fits_existing_column_length():
    assert len("transition_similarity_evidence") <= 32


# ---------------------------------------------------------------------------
# Prerequisite gating: scene_segmentation required; B1 row NOT required.
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
                await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)
            assert exc_info.value.status_code == 409
        finally:
            await _cleanup(db, asset_id_, rv_id)


async def test_does_not_require_transition_evidence_or_any_other_pass():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            va = await db.get(VideoAnalysis, va_id)
            for key in ("visual_evidence", "text_analysis", "speech_analysis", "audio_structure",
                        "global_motion_evidence", "local_motion_evidence", "local_motion_dynamics",
                        "transition_evidence"):
                assert key not in (va.pass_status or {})

            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence())):
                response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["transition_similarity_evidence"] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Zero/one/multiple boundaries; window clipping never crosses unrelated shots.
# ---------------------------------------------------------------------------

async def test_zero_shots_succeeds_with_zero_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["transition_similarity_evidence"] == "complete"
            assert response.latest_analysis.error is None
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_single_shot_zero_boundaries_succeeds_with_zero_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=34.15)
            response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["transition_similarity_evidence"] == "complete"
            assert response.transition_similarity_evidence == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_one_boundary_produces_one_annotation():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user, file_path="uploads/1/07608cbc574e4efbbb474d94e4c51953.mp4")
        try:
            shot_a = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            shot_b = await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            mock_measure = AsyncMock(return_value=_mocked_similarity_evidence())
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=mock_measure):
                response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            mock_measure.assert_awaited_once_with("uploads/1/07608cbc574e4efbbb474d94e4c51953.mp4", 30.1, 0.0, 34.15)
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().all()
            assert len(rows) == 1
            row = rows[0]
            assert row.shot_id is None
            assert row.details["preceding_shot_id"] == shot_a
            assert row.details["following_shot_id"] == shot_b
            assert row.details["boundary_timestamp"] == pytest.approx(30.1)
            assert row.details["cross_boundary_similarity"] == pytest.approx(0.82)
            assert len(response.transition_similarity_evidence) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_multiple_boundaries_never_cross_unrelated_shots():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user, duration=15.0)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=5.0)
            await _add_shot(db, va_id, order=1, start_time=5.0, end_time=10.0)
            await _add_shot(db, va_id, order=2, start_time=10.0, end_time=15.0)
            mock_measure = AsyncMock(return_value=_mocked_similarity_evidence())
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=mock_measure):
                await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert mock_measure.await_count == 2  # two boundaries: (0,1) and (1,2)
            call_args = [c.args for c in mock_measure.await_args_list]
            assert (call_args[0][1], call_args[0][2], call_args[0][3]) == (5.0, 0.0, 10.0)
            assert (call_args[1][1], call_args[1][2], call_args[1][3]) == (10.0, 5.0, 15.0)
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().all()
            assert len(rows) == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Annotation semantics.
# ---------------------------------------------------------------------------

async def test_annotation_semantics_shot_id_none_certainty_source_produced_by_pass():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence())):
                await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().first()
            assert row.shot_id is None
            assert row.certainty == "MEASURED"
            assert row.confidence_score is None
            assert row.source == TRANSITION_SIMILARITY_EVIDENCE_SOURCE == "temporal_visual_similarity"
            assert row.produced_by_pass == TRANSITION_SIMILARITY_EVIDENCE_PASS_NAME == "transition_similarity_evidence_v1"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_missing_source_file_fails_honestly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user, file_path="uploads/does_not_exist_anywhere.mp4")
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(side_effect=FileNotFoundError("Original reference video source not found"))):
                response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["transition_similarity_evidence"] == "failed"
            assert "not found" in response.latest_analysis.error
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_insufficient_boundary_material_produces_no_row_but_pass_completes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=30.12)  # too short
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence(insufficient=True))):
                response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["transition_similarity_evidence"] == "complete"
            assert response.latest_analysis.error is None
            assert response.transition_similarity_evidence == []
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().all()
            assert rows == []
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
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            mock_measure = AsyncMock(return_value=_mocked_similarity_evidence())
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=mock_measure):
                await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)
                await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert mock_measure.await_count == 1  # idempotent early-return skipped the second call
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().all()
            assert len(rows) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_genuine_failure_fails_pass_with_no_orphan_rows_then_retry_succeeds():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(side_effect=RuntimeError("simulated failure"))):
                failed_response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["transition_similarity_evidence"] == "failed"
            assert "simulated failure" in failed_response.latest_analysis.error

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().all()
            assert rows == []

            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence())):
                retried = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert retried.latest_analysis.pass_status["transition_similarity_evidence"] == "complete"
            rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().all()
            assert len(rows_after) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_previous_successful_result_survives_a_later_measurement_failure():
    """The explicit item-18/26 safety property: if a genuinely successful B2 annotation already
    exists (from an earlier cycle) but pass_status is (for whatever reason -- e.g. a crash between
    the DB write and the final pass_status update) still stuck at a stale 'running' state, a
    SUBSEQUENT retry whose own measurement fails must NEVER delete that prior successful row —
    the delete-then-insert step is only ever reached AFTER a NEW measurement has already
    succeeded in-memory, so a failed retry's own except-branch never executes it."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)

            # First cycle succeeds normally.
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence())):
                await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)
            rows_before = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().all()
            assert len(rows_before) == 1
            prior_row_id = rows_before[0].id
            prior_details = rows_before[0].details

            # Simulate the edge case: pass_status regresses to a STALE "running" state even
            # though the successful row above genuinely still exists (e.g. a crash between the
            # DB commit above and a hypothetical later pass_status write in some other code path).
            from datetime import datetime, timedelta, timezone
            from sqlalchemy import update
            from app.models.video_analysis import VideoAnalysis
            stale_started_at = datetime.now(timezone.utc) - timedelta(seconds=10_000)
            await db.execute(
                update(VideoAnalysis).where(VideoAnalysis.id == va_id).values(
                    status="running", started_at=stale_started_at,
                    pass_status={"technical_probe": "complete", "scene_segmentation": "complete"},
                )
            )
            await db.commit()

            # Retry now proceeds (stale-run reclaim) and this time measurement genuinely fails.
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(side_effect=RuntimeError("simulated later failure"))):
                failed_response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["transition_similarity_evidence"] == "failed"

            rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().all()
            assert len(rows_after) == 1
            assert rows_after[0].id == prior_row_id
            assert rows_after[0].details == prior_details
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# B1 failure isolation.
# ---------------------------------------------------------------------------

async def test_b1_row_untouched_when_b2_runs_successfully():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=_mocked_transition_evidence())):
                await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)
            b1_rows_before = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().all()
            assert len(b1_rows_before) == 1
            b1_row_id = b1_rows_before[0].id

            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence())):
                await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            b1_rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().all()
            assert len(b1_rows_after) == 1
            assert b1_rows_after[0].id == b1_row_id
            assert b1_rows_after[0].details == b1_rows_before[0].details
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_b1_row_untouched_when_b2_fails():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=_mocked_transition_evidence())):
                await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)
            b1_rows_before = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().all()
            assert len(b1_rows_before) == 1

            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(side_effect=RuntimeError("simulated B2 failure"))):
                failed_response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["transition_similarity_evidence"] == "failed"

            b1_rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().all()
            assert len(b1_rows_after) == 1
            assert b1_rows_after[0].details == b1_rows_before[0].details

            b2_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().all()
            assert b2_rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_b2_can_run_when_b1_was_never_run():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            b1_rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().all()
            assert b1_rows == []  # B1 genuinely never ran

            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence())):
                response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["transition_similarity_evidence"] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Stage-4 / Shot.camera_movement / Stage 8 untouched.
# ---------------------------------------------------------------------------

async def test_shot_times_and_camera_movement_never_written():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_a = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            shot_b = await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence())):
                await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)
            shot_a_row = await db.get(Shot, shot_a)
            shot_b_row = await db.get(Shot, shot_b)
            assert shot_a_row.camera_movement is None
            assert shot_a_row.start_time == pytest.approx(0.0) and shot_a_row.end_time == pytest.approx(30.1)
            assert shot_b_row.camera_movement is None
            assert shot_b_row.start_time == pytest.approx(30.1) and shot_b_row.end_time == pytest.approx(34.15)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_stage_8_and_stage_6_data_unaffected():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            text_el = TextElement(
                video_analysis_id=va_id, shot_id=shot_id, text="pre-existing text", x=0.1, y=0.1, width=0.2, height=0.1,
                start_time=1.0, end_time=1.0, certainty="MEASURED", confidence_score=0.9,
            )
            db.add(text_el)
            await db.commit()
            before_text_id = text_el.id

            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence())):
                response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            after_text = await db.get(TextElement, before_text_id)
            assert after_text.text == "pre-existing text"
            assert after_text.confidence_score == 0.9

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.visual_objects == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Backward compatibility; no similarity-transfer/classification/trust fields.
# ---------------------------------------------------------------------------

async def test_response_backward_compatible_when_b2_absent():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=34.15)
            from app.routers.reference_videos import _to_response
            rv = await db.get(ReferenceVideo, rv_id)
            asset = await db.get(Asset, asset_id)
            response = await _to_response(db, rv, asset)
            assert response.transition_similarity_evidence == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_response_exposes_transition_similarity_evidence_video_level_not_nested_under_shot():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence())):
                response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            assert len(response.transition_similarity_evidence) == 1
            for shot in response.shots:
                assert not hasattr(shot, "transition_similarity_evidence")
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_no_semantic_or_trust_labels_in_persisted_row_or_response():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_similarity_evidence_svc, "measure_boundary_transition_similarity", new=AsyncMock(return_value=_mocked_similarity_evidence())):
                response = await analyze_reference_video_transition_similarity(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_similarity_evidence",
            ))).scalars().first()
            dumped_row = str(row.details).lower()
            response_dump = response.transition_similarity_evidence[0].model_dump()
            structural_response = {k: v for k, v in response_dump.items() if k not in ("reasoning", "evidence_summary")}
            for forbidden in ("hard_cut", "fade", "dissolve", "wipe", "crossover", "gradual", "instantaneous",
                              "trust", "confidence_score_derived", "reference_confidence", "similarity_quality",
                              "ratio", "gap", "sweep", "matrix"):
                assert forbidden not in dumped_row
                assert forbidden not in str(structural_response).lower()
        finally:
            await _cleanup(db, asset_id, rv_id)
