"""
Video Deconstructor — Stage 8 (Visual Objects / People / Products / Composition), Phase C1
router/persistence tests: CONSERVATIVE SAME-SHOT NEAR-STATIC VISUAL PERSISTENCE.

Same real-database, direct-router-call, no-HTTP-client convention as
test_reference_video_visual_objects.py's own docstring. Phase C1's own derivation
(visual_persistence_svc.derive_persistent_visual_elements) is pure and in-memory — nothing is
mocked here; real VisualObject rows are inserted directly (matching this stage's own upstream
evidence shape) and the real algorithm runs against them, exactly as it will in production.

Covers the router-level checks from Phase C1's own 30-item test list not already covered at the
service-unit level (test_visual_persistence_svc.py covers 1/2/3/4/5/6/7/8/9/10/11/12/17/18/27):
prerequisite gating (visual_objects must be complete), zero-eligible-groups success (21), failure/
retry/idempotency (22/23/24), Phase B raw response remains intact (25), persistent output exposed
separately (26), certainty=INFERRED (19), no persistent-person annotation (20), raw VisualObject
rows remain unchanged (13), member/source-frame IDs preserved end-to-end through the response
(14/15), start/end derive from evidence timestamps (16), no composition/product-prop inference
(28/29), no frontend dependency (30).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from unittest.mock import patch
import pytest
from fastapi import HTTPException

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.shot_frame import ShotFrame
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.models.visual_object import VisualObject
from app.routers.reference_videos import VISUAL_PERSISTENCE_PASS_NAME, analyze_reference_video_visual_persistence
from app.services import visual_persistence_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, duration: float = 34.0) -> tuple[int, int, int]:
    """A ReferenceVideo whose VideoAnalysis already has visual_objects="complete" — Phase C1's
    sole prerequisite — with no VisualObject rows yet (each test adds its own)."""
    asset = Asset(
        user_id=user.id, original_filename="stage8_phase_c1_test.mp4", stored_filename="stage8_phase_c1_test_stored.mp4",
        file_path="uploads/stage8_phase_c1_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()

    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()

    va = VideoAnalysis(
        reference_video_id=rv.id, status="complete",
        pass_status={"technical_probe": "complete", "scene_segmentation": "complete", "visual_evidence": "complete", "visual_objects": "complete"},
    )
    db.add(va)
    await db.flush()

    await db.commit()
    return rv.id, asset.id, va.id


async def _add_shot_with_frames(db, va_id: int, order: int, timestamps: list[float], user_id: int) -> tuple[int, list[int]]:
    """Adds one Shot plus one ShotFrame (each backed by its own Asset) per timestamp — the real
    upstream shape VisualObject.source_frame_id requires (RESTRICT FK)."""
    shot = Shot(
        video_analysis_id=va_id, scene_id=None, order=order, start_time=float(order) * 5.0, end_time=float(order) * 5.0 + 5.0,
        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1",
    )
    db.add(shot)
    await db.flush()

    frame_ids = []
    for j, ts in enumerate(timestamps):
        frame_asset = Asset(
            user_id=user_id,
            original_filename=f"c1_frame_shot{order}_{j}.jpg", stored_filename=f"c1_frame_shot{order}_{j}_stored.jpg",
            file_path=f"uploads/c1_frame_shot{order}_{j}.jpg", file_type="reference_frame", mime_type="image/jpeg", file_size=2048,
        )
        db.add(frame_asset)
        await db.flush()
        frame = ShotFrame(
            shot_id=shot.id, video_analysis_id=va_id, asset_id=frame_asset.id, timestamp=ts, order=j,
            extraction_method="representative", width=1280, height=720,
            certainty="MEASURED", source="ffmpeg", produced_by_pass="frame_extraction_v1",
        )
        db.add(frame)
        await db.flush()
        frame_ids.append(frame.id)
    await db.commit()
    return shot.id, frame_ids


def _vo(video_analysis_id, shot_id, source_frame_id, label, category, confidence, x, y, w, h, ts) -> VisualObject:
    return VisualObject(
        video_analysis_id=video_analysis_id, shot_id=shot_id, source_frame_id=source_frame_id,
        label=label, category=category, class_id=1,
        x=x, y=y, width=w, height=h, start_time=ts, end_time=ts,
        certainty="MEASURED", confidence_score=confidence,
        source="torchvision", produced_by_pass="visual_objects_v1",
    )


async def _cleanup(db, asset_id: int, reference_video_id: int | None, video_analysis_id: int | None = None):
    frame_asset_ids: set[int] = set()
    if video_analysis_id is not None:
        frame_result = await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == video_analysis_id))
        frame_asset_ids = {f.asset_id for f in frame_result.scalars().all()}
    if reference_video_id is not None:
        rv = await db.get(ReferenceVideo, reference_video_id)
        if rv:
            await db.delete(rv)
            await db.flush()
    for aid in frame_asset_ids | {asset_id}:
        a = await db.get(Asset, aid)
        if a:
            await db.delete(a)
    await db.commit()


# ---------------------------------------------------------------------------
# Prerequisite gating: visual_objects must be complete first.
# ---------------------------------------------------------------------------

async def test_rejected_before_visual_objects_completes():
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
        va = VideoAnalysis(reference_video_id=rv.id, pass_status={"visual_evidence": "complete"})
        db.add(va)
        await db.commit()
        rv_id, asset_id_ = rv.id, asset.id
        try:
            with pytest.raises(HTTPException) as exc_info:
                await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            assert exc_info.value.status_code == 409
        finally:
            await _cleanup(db, asset_id_, rv_id)


# ---------------------------------------------------------------------------
# Successful derivation from the real Shot-141-shaped data (laptop/keyboard/tv link, person and
# same-frame tv duplicate excluded) — mirrors the real reference video exactly.
# ---------------------------------------------------------------------------

async def test_successful_derivation_matches_real_video_shape():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _add_shot_with_frames(db, va_id, order=0, timestamps=[0.15, 11.325, 22.5], user_id=user.id)
            f84, f85, f86 = frame_ids

            db.add_all([
                _vo(va_id, shot_id, f84, "laptop", "object", 0.979, 0.0, 0.039, 0.993, 0.755, 0.15),
                _vo(va_id, shot_id, f84, "keyboard", "object", 0.872, 0.012, 0.393, 0.948, 0.336, 0.15),
                _vo(va_id, shot_id, f84, "tv", "object", 0.623, 0.0, 0.138, 1.0, 0.444, 0.15),
                _vo(va_id, shot_id, f84, "tv", "object", 0.578, 0.0, 0.022, 1.0, 0.300, 0.15),  # same-frame duplicate
                _vo(va_id, shot_id, f84, "person", "person", 0.464, 0.202, 0.240, 0.290, 0.180, 0.15),
                _vo(va_id, shot_id, f85, "laptop", "object", 0.971, 0.0, 0.059, 0.986, 0.726, 11.325),
                _vo(va_id, shot_id, f85, "keyboard", "object", 0.823, 0.015, 0.403, 0.939, 0.317, 11.325),
                _vo(va_id, shot_id, f85, "person", "person", 0.788, 0.149, 0.223, 0.358, 0.197, 11.325),
                _vo(va_id, shot_id, f85, "tv", "object", 0.479, 0.0, 0.128, 0.997, 0.404, 11.325),
                _vo(va_id, shot_id, f86, "keyboard", "object", 0.945, 0.015, 0.391, 0.974, 0.341, 22.5),
                _vo(va_id, shot_id, f86, "laptop", "object", 0.941, 0.0, 0.060, 1.0, 0.722, 22.5),
                _vo(va_id, shot_id, f86, "person", "person", 0.827, 0.190, 0.202, 0.314, 0.210, 22.5),
                _vo(va_id, shot_id, f86, "tv", "object", 0.445, 0.012, 0.101, 0.988, 0.440, 22.5),
            ])
            await db.commit()

            response = await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["visual_persistence"] == "complete"
            assert response.latest_analysis.status == "complete"

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            by_label = {e.native_label: e for e in shot_summary.persistent_visual_elements}
            assert set(by_label.keys()) == {"laptop", "keyboard", "tv"}  # no person, no cross-label

            assert by_label["laptop"].observation_count == 3
            assert by_label["keyboard"].observation_count == 3
            assert by_label["tv"].observation_count == 3  # same-frame duplicate never inflates this to 4

            assert by_label["laptop"].start_time == 0.15 and by_label["laptop"].end_time == 22.5
            assert by_label["laptop"].certainty == "INFERRED"
            assert by_label["laptop"].linkage_confidence is None
            assert by_label["laptop"].produced_by_pass == VISUAL_PERSISTENCE_PASS_NAME

            # Raw evidence untouched.
            raw_rows = (await db.execute(select(VisualObject).where(VisualObject.video_analysis_id == va_id))).scalars().all()
            assert len(raw_rows) == 13
            assert all(r.certainty == "MEASURED" for r in raw_rows)  # never rewritten to INFERRED

            # Phase B's own raw response remains fully intact alongside the derived layer.
            assert len(shot_summary.visual_objects) == 13
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Zero eligible groups (a one-frame shot) succeeds with zero annotations.
# ---------------------------------------------------------------------------

async def test_one_frame_shot_produces_zero_persistence_annotations():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _add_shot_with_frames(db, va_id, order=1, timestamps=[30.25], user_id=user.id)
            f87 = frame_ids[0]
            db.add_all([
                _vo(va_id, shot_id, f87, "tv", "object", 0.852, 0.0, 0.152, 0.984, 0.473, 30.25),
                _vo(va_id, shot_id, f87, "laptop", "object", 0.546, 0.020, 0.149, 0.978, 0.543, 30.25),
                _vo(va_id, shot_id, f87, "person", "person", 0.464, 0.098, 0.187, 0.424, 0.238, 30.25),
            ])
            await db.commit()

            response = await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["visual_persistence"] == "complete"
            assert response.latest_analysis.error is None
            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.persistent_visual_elements == []

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "persistent_visual_element",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Failure/retry/idempotency.
# ---------------------------------------------------------------------------

async def test_genuine_failure_fails_pass_with_no_orphan_rows_then_retry_succeeds():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _add_shot_with_frames(db, va_id, order=0, timestamps=[0.0, 5.0], user_id=user.id)
            f0, f1 = frame_ids
            db.add_all([
                _vo(va_id, shot_id, f0, "keyboard", "object", 0.9, 0.0, 0.4, 0.9, 0.3, 0.0),
                _vo(va_id, shot_id, f1, "keyboard", "object", 0.9, 0.0, 0.4, 0.9, 0.3, 5.0),
            ])
            await db.commit()

            with patch.object(visual_persistence_svc, "derive_persistent_visual_elements", side_effect=RuntimeError("boom")):
                failed_response = await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["visual_persistence"] == "failed"
            assert failed_response.latest_analysis.status == "complete"
            assert "boom" in failed_response.latest_analysis.error

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "persistent_visual_element",
            ))).scalars().all()
            assert rows == []

            retried = await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            assert retried.latest_analysis.pass_status["visual_persistence"] == "complete"
            rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "persistent_visual_element",
            ))).scalars().all()
            assert len(rows_after) == 1
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


async def test_repeated_successful_call_does_not_duplicate_annotations():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _add_shot_with_frames(db, va_id, order=0, timestamps=[0.0, 5.0], user_id=user.id)
            f0, f1 = frame_ids
            db.add_all([
                _vo(va_id, shot_id, f0, "keyboard", "object", 0.9, 0.0, 0.4, 0.9, 0.3, 0.0),
                _vo(va_id, shot_id, f1, "keyboard", "object", 0.9, 0.0, 0.4, 0.9, 0.3, 5.0),
            ])
            await db.commit()

            first = await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            second = await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)

            first_ids = [e.id for s in first.shots for e in s.persistent_visual_elements]
            second_ids = [e.id for s in second.shots for e in s.persistent_visual_elements]
            assert first_ids == second_ids

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "persistent_visual_element",
            ))).scalars().all()
            assert len(rows) == 1
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# No persistent-person annotation is ever created, even when person geometry is highly stable.
# ---------------------------------------------------------------------------

async def test_no_persistent_person_annotation_even_with_stable_geometry():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _add_shot_with_frames(db, va_id, order=0, timestamps=[0.0, 5.0, 10.0], user_id=user.id)
            f0, f1, f2 = frame_ids
            db.add_all([
                _vo(va_id, shot_id, f0, "person", "person", 0.9, 0.1, 0.1, 0.3, 0.3, 0.0),
                _vo(va_id, shot_id, f1, "person", "person", 0.9, 0.1, 0.1, 0.3, 0.3, 5.0),  # identical geometry
                _vo(va_id, shot_id, f2, "person", "person", 0.9, 0.1, 0.1, 0.3, 0.3, 10.0),
            ])
            await db.commit()

            response = await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.persistent_visual_elements == []

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "persistent_visual_element",
            ))).scalars().all()
            assert rows == []
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# Cross-shot observations never link (two separate shots, same label).
# ---------------------------------------------------------------------------

async def test_cross_shot_observations_never_link():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot0_id, shot0_frames = await _add_shot_with_frames(db, va_id, order=0, timestamps=[0.0], user_id=user.id)
            shot1_id, shot1_frames = await _add_shot_with_frames(db, va_id, order=1, timestamps=[10.0], user_id=user.id)
            db.add_all([
                _vo(va_id, shot0_id, shot0_frames[0], "keyboard", "object", 0.9, 0.0, 0.4, 0.9, 0.3, 0.0),
                _vo(va_id, shot1_id, shot1_frames[0], "keyboard", "object", 0.9, 0.0, 0.4, 0.9, 0.3, 10.0),
            ])
            await db.commit()

            response = await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["visual_persistence"] == "complete"
            for s in response.shots:
                assert s.persistent_visual_elements == []  # each shot has only 1 frame of its own
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)
