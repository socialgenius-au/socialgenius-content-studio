"""
Video Deconstructor — Stage 9 (Motion / Camera / Transitions / Animation), Phase B1 router tests:
BOUNDARY-TRIGGERED TRANSITION EVIDENCE MVP.

Same real-database, direct-router-call, no-HTTP-client convention as
test_reference_video_global_motion.py (see that file's own docstring).
`transition_evidence_svc.measure_boundary_transition_evidence` is mocked exactly the same way —
these tests never run a real ffmpeg subprocess or real cv2 estimation; that happens separately in
the service's own unit tests (synthetic images) and in real-video/controlled-corpus validation.

Covers: Stage-4-only prerequisite (no Stage-5/6/7/8/9-Phase-A requirement), zero-boundary video,
one-boundary video, multiple boundaries, candidate-window clipping (via the service call
arguments), no unrelated-boundary crossing, 10fps sampling metadata, neutral luminance/frame-
difference fields, existing black-frame definition, exact black-frame+response-0 diagnostic, no
general phase "usable" field, explicit affine failure semantics, shot_id=None for the annotation,
preceding/following shot IDs in details, MEASURED certainty, confidence_score=None, source/
produced_by_pass, idempotent rerun, failure safety, zero-frame persistence (nothing but the
service's own aggregate dict is ever written), no similarity-transfer fields, no transition-
classification fields, and response exposure.
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
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.routers.reference_videos import (
    TRANSITION_EVIDENCE_PASS_NAME, TRANSITION_EVIDENCE_SOURCE, analyze_reference_video_transition_evidence,
)
from app.services import transition_evidence_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, duration: float = 34.15, file_path: str = "uploads/stage9_transition_test.mp4") -> tuple[int, int, int]:
    """A ReferenceVideo whose VideoAnalysis already has scene_segmentation="complete" — Phase
    B1's sole prerequisite — deliberately with NO visual_evidence/text_analysis/speech_analysis/
    audio_structure/visual_objects/visual_persistence/visual_composition/global_motion_evidence
    keys at all, to prove independence from every other Stage 5-9-Phase-A pass."""
    asset = Asset(
        user_id=user.id, original_filename="stage9_transition_test.mp4", stored_filename="stage9_transition_test_stored.mp4",
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


def _mocked_evidence(
    boundary_timestamp=30.1, window_start=29.6, window_end=30.6, sample_count=10, frame_pair_count=9,
    insufficient=False, black_flags=None, phase_quality=None,
) -> dict:
    if insufficient:
        return {
            "insufficient_boundary_material": True, "sampling_fps": 10.0, "sample_count": sample_count,
            "frame_pair_count": 0, "boundary_timestamp": boundary_timestamp, "window_start": window_start,
            "window_end": window_end, "sample_timestamps": [], "luminance": None, "frame_difference": None,
            "black_frame_flags": [], "affine_evidence": None, "phase_correlation_evidence": None,
        }
    timestamps = [window_start + i * 0.1 for i in range(sample_count)]
    black_flags = black_flags or [False] * sample_count
    return {
        "insufficient_boundary_material": False, "sampling_fps": 10.0, "sample_count": sample_count,
        "frame_pair_count": frame_pair_count, "boundary_timestamp": boundary_timestamp,
        "window_start": window_start, "window_end": window_end, "sample_timestamps": timestamps,
        "luminance": {
            "values": [100.0] * sample_count, "first_value": 100.0, "last_value": 100.0, "min": 100.0, "max": 100.0,
            "signed_total_change": 0.0, "regression_slope": 0.0, "positive_delta_count": 0, "negative_delta_count": 0,
            "zero_delta_count": frame_pair_count, "sign_change_count": 0,
        },
        "frame_difference": {"values": [0.01] * frame_pair_count, "median": 0.01, "max": 0.01, "argmax_index": 0},
        "black_frame_flags": black_flags,
        "affine_evidence": {
            "pairs": [
                {"estimation_success": True, "translation_x": 0.01, "translation_y": 0.0, "translation_magnitude": 0.01,
                 "scale": 1.0, "rotation_deg": 0.0, "candidate_match_count": 300, "ransac_inlier_count": 295, "ransac_inlier_ratio": 0.98}
                for _ in range(frame_pair_count)
            ],
            "successful_pair_count": frame_pair_count, "failed_pair_count": 0, "failure_reason_counts": None,
        },
        "phase_correlation_evidence": {
            "pairs": [
                {"dx": 0.0, "dy": 0.0, "magnitude": 0.0, "response": 0.95,
                 "phase_quality_issue": (phase_quality[i] if phase_quality else None)}
                for i in range(frame_pair_count)
            ],
        },
    }


# ---------------------------------------------------------------------------
# Prerequisite gating: scene_segmentation required; no other Stage 5-9-Phase-A requirement.
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
                await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)
            assert exc_info.value.status_code == 409
        finally:
            await _cleanup(db, asset_id_, rv_id)


async def test_does_not_require_any_other_stage_5_to_9a_pass():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            va = await db.get(VideoAnalysis, va_id)
            for key in ("visual_evidence", "text_analysis", "speech_analysis", "audio_structure",
                        "visual_objects", "visual_persistence", "visual_composition", "global_motion_evidence"):
                assert key not in (va.pass_status or {})

            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=_mocked_evidence())):
                response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["transition_evidence"] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Zero-boundary / one-boundary / multiple-boundary videos.
# ---------------------------------------------------------------------------

async def test_zero_shots_succeeds_with_zero_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["transition_evidence"] == "complete"
            assert response.latest_analysis.error is None
            assert response.transition_evidence == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_single_shot_zero_boundaries_succeeds_with_zero_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=34.15)
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock()) as mock_measure:
                response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)
            mock_measure.assert_not_awaited()  # a single shot has no boundary to measure
            assert response.latest_analysis.pass_status["transition_evidence"] == "complete"
            assert response.transition_evidence == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_one_boundary_produces_one_annotation():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user, file_path="uploads/1/07608cbc574e4efbbb474d94e4c51953.mp4")
        try:
            shot_a = await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            shot_b = await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            mock_measure = AsyncMock(return_value=_mocked_evidence())
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=mock_measure):
                response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            mock_measure.assert_awaited_once_with("uploads/1/07608cbc574e4efbbb474d94e4c51953.mp4", 30.1, 0.0, 34.15)
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().all()
            assert len(rows) == 1
            row = rows[0]
            assert row.shot_id is None
            assert row.details["preceding_shot_id"] == shot_a
            assert row.details["following_shot_id"] == shot_b
            assert row.details["boundary_timestamp"] == pytest.approx(30.1)
            assert len(response.transition_evidence) == 1
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
            mock_measure = AsyncMock(return_value=_mocked_evidence())
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=mock_measure):
                await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            assert mock_measure.await_count == 2  # two boundaries: (0,1) and (1,2)
            call_args = [c.args for c in mock_measure.await_args_list]
            # Each call's own (preceding_shot_start, following_shot_end) bounds never reach a
            # THIRD shot's own territory.
            assert (call_args[0][1], call_args[0][2], call_args[0][3]) == (5.0, 0.0, 10.0)
            assert (call_args[1][1], call_args[1][2], call_args[1][3]) == (10.0, 5.0, 15.0)
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().all()
            assert len(rows) == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Sampling metadata, neutral fields, black-frame reuse, phase diagnostic, affine failure.
# ---------------------------------------------------------------------------

async def test_annotation_carries_10fps_sampling_metadata_and_neutral_fields():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=_mocked_evidence())):
                response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().first()
            assert row.details["sampling_fps"] == 10.0
            assert row.details["luminance"]["first_value"] == 100.0
            assert row.details["frame_difference"]["median"] == 0.01
            for forbidden in ("monotonic_direction", "trajectory_shape", "elevated_pair_count", "hard_cut", "fade", "dissolve", "dip_to_black"):
                assert forbidden not in row.details["luminance"]
                assert forbidden not in row.details["frame_difference"]
                assert forbidden not in row.details

            summary = response.transition_evidence[0]
            assert summary.sampling_fps == 10.0
            assert summary.luminance.first_value == 100.0
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_black_frame_flags_and_exact_phase_diagnostic_exposed():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            evidence = _mocked_evidence(
                black_flags=[False, False, True, True, False, False, False, False, False, False],
                phase_quality=["black_frame_zero_response"] + [None] * 8,
            )
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=evidence)):
                response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().first()
            assert row.details["black_frame_flags"][2] is True
            assert row.details["phase_correlation"]["pairs"][0]["phase_quality_issue"] == "black_frame_zero_response"
            assert row.details["phase_correlation"]["pairs"][1]["phase_quality_issue"] is None
            # No general "usable" boolean anywhere in the phase-correlation evidence.
            for pair in row.details["phase_correlation"]["pairs"]:
                assert "usable" not in pair

            summary = response.transition_evidence[0]
            assert summary.phase_correlation.pairs[0].phase_quality_issue == "black_frame_zero_response"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_affine_failure_evidence_preserved_never_zeroed():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            evidence = _mocked_evidence()
            evidence["affine_evidence"] = {
                "pairs": [{"estimation_success": False, "reason": "insufficient_keypoints"}] + evidence["affine_evidence"]["pairs"][1:],
                "successful_pair_count": 8, "failed_pair_count": 1,
                "failure_reason_counts": {"insufficient_keypoints": 1},
            }
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=evidence)):
                response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().first()
            first_pair = row.details["affine"]["pairs"][0]
            assert first_pair["estimation_success"] is False
            assert first_pair["reason"] == "insufficient_keypoints"
            assert "translation_x" not in first_pair  # never a fabricated zero
            assert row.details["affine"]["failure_reason_counts"] == {"insufficient_keypoints": 1}

            summary = response.transition_evidence[0]
            assert summary.affine.pairs[0].estimation_success is False
            assert summary.affine.pairs[0].reason == "insufficient_keypoints"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# AnalysisAnnotation semantics: shot_id=None, certainty, confidence, source, produced_by_pass.
# ---------------------------------------------------------------------------

async def test_annotation_semantics_shot_id_none_certainty_source_produced_by_pass():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=_mocked_evidence())):
                await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            row = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().first()
            assert row.shot_id is None
            assert row.certainty == "MEASURED"
            assert row.confidence_score is None
            assert row.source == TRANSITION_EVIDENCE_SOURCE == "temporal_visual_measurements"
            assert row.produced_by_pass == TRANSITION_EVIDENCE_PASS_NAME == "transition_evidence_v1"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Idempotency / failure safety.
# ---------------------------------------------------------------------------

async def test_repeated_successful_call_does_not_duplicate_annotations():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            mock_measure = AsyncMock(return_value=_mocked_evidence())
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=mock_measure):
                await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)
                await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            assert mock_measure.await_count == 1  # idempotent early-return skipped the second call
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
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
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(side_effect=RuntimeError("simulated failure"))):
                failed_response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["transition_evidence"] == "failed"
            assert "simulated failure" in failed_response.latest_analysis.error

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().all()
            assert rows == []

            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=_mocked_evidence())):
                retried = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            assert retried.latest_analysis.pass_status["transition_evidence"] == "complete"
            rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().all()
            assert len(rows_after) == 1
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_missing_source_file_fails_honestly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user, file_path="uploads/does_not_exist_anywhere.mp4")
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(side_effect=FileNotFoundError("Original reference video source not found"))):
                response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["transition_evidence"] == "failed"
            assert "not found" in response.latest_analysis.error
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
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
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=30.12)  # too short for both-sides material
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=_mocked_evidence(insufficient=True))):
                response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["transition_evidence"] == "complete"
            assert response.latest_analysis.error is None
            assert response.transition_evidence == []
            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "transition_evidence",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Zero frame persistence — nothing but the service's own returned aggregate dict is ever written.
# ---------------------------------------------------------------------------

async def test_no_frame_or_asset_persisted_by_this_pass():
    from sqlalchemy import func
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            before_count = (await db.execute(select(func.count()).select_from(Asset))).scalar_one()
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=_mocked_evidence())):
                await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)
            after_count = (await db.execute(select(func.count()).select_from(Asset))).scalar_one()
            assert after_count == before_count  # no new Asset row created by this pass
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# No similarity-transfer / transition-classification fields; response exposure.
# ---------------------------------------------------------------------------

async def test_no_similarity_transfer_or_classification_fields_in_response():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=_mocked_evidence())):
                response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            summary = response.transition_evidence[0]
            dumped = summary.model_dump()
            # Free-text reasoning/evidence_summary legitimately DISCUSS (in prose, to disclaim
            # them) the very labels this pass must never store as DATA -- exclude those two prose
            # fields and check every remaining structured field/value instead.
            structural = {k: v for k, v in dumped.items() if k not in ("reasoning", "evidence_summary")}
            for forbidden in ("similarity_to_a", "similarity_to_b", "difference_curve", "crossover",
                              "hard_cut", "fade", "dissolve", "dip_to_black", "trajectory_shape"):
                assert forbidden not in str(structural).lower()
            # Field NAMES on the reasoning/evidence_summary prose fields themselves are still
            # exactly what this schema declares -- just their free-text CONTENT is exempt above.
            assert set(dumped.keys()) >= {"reasoning", "evidence_summary"}
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_response_exposes_transition_evidence_video_level_not_nested_under_shot():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            await _add_shot(db, va_id, order=0, start_time=0.0, end_time=30.1)
            await _add_shot(db, va_id, order=1, start_time=30.1, end_time=34.15)
            with patch.object(transition_evidence_svc, "measure_boundary_transition_evidence", new=AsyncMock(return_value=_mocked_evidence())):
                response = await analyze_reference_video_transition_evidence(reference_video_id=rv_id, db=db, user=user)

            assert len(response.transition_evidence) == 1
            for shot_summary in response.shots:
                assert not hasattr(shot_summary, "transition_evidence")
        finally:
            await _cleanup(db, asset_id, rv_id)
