"""
Video Deconstructor — Stage 8 (Visual Objects / People / Products / Composition), Composition
MVP router tests.

Same real-database, direct-router-call, no-HTTP-client convention as
test_reference_video_visual_persistence.py's own docstring. Nothing is mocked — this test file
builds real VisualObject rows, runs the REAL, unmodified C1 endpoint
(analyze_reference_video_visual_persistence) to produce genuine persistent_visual_element
annotations, then runs the new Composition endpoint against that real C1 output, exactly the real
production dependency chain.

Covers response-shape checks (B: 14-19) and stability-inference checks (C: 20-33) from the
Composition MVP's own test list not already covered at the geometry/composition-service unit
level (test_visual_geometry_svc.py covers A: 1-13; test_visual_composition_svc.py covers the
drift-metric definitions).
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
from app.routers.reference_videos import (
    VISUAL_COMPOSITION_PASS_NAME, analyze_reference_video_visual_composition, analyze_reference_video_visual_persistence,
)
from app.services import visual_composition_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User, duration: float = 34.0) -> tuple[int, int, int]:
    """A ReferenceVideo whose VideoAnalysis already has visual_objects="complete" — same
    prerequisite as C1's own fixture helper, one step further back (Composition MVP consumes C1,
    not VisualObject directly, but we still need visual_objects=complete to satisfy C1's own
    prerequisite when we call the real C1 endpoint below)."""
    asset = Asset(
        user_id=user.id, original_filename="stage8_composition_test.mp4", stored_filename="stage8_composition_test_stored.mp4",
        file_path="uploads/stage8_composition_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
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
            original_filename=f"comp_frame_shot{order}_{j}.jpg", stored_filename=f"comp_frame_shot{order}_{j}_stored.jpg",
            file_path=f"uploads/comp_frame_shot{order}_{j}.jpg", file_type="reference_frame", mime_type="image/jpeg", file_size=2048,
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


REAL_SHOT_141_VOS = [
    # (id placeholder unused -- generated -- frame_index, label, category, confidence, x, y, w, h, ts)
    (0, "laptop", "object", 0.979, 0.0, 0.03943967819213867, 0.9934682846069336, 0.7553522851732042, 0.15),
    (0, "keyboard", "object", 0.872, 0.01184830665588379, 0.39252627337420426, 0.9475739955902099, 0.3355883139151114, 0.15),
    (0, "tv", "object", 0.623, 0.0, 0.13818754973234953, 1.0, 0.44413312276204425, 0.15),
    (0, "tv", "object", 0.578, 0.0, 0.02244065867529975, 1.0, 0.29974400997161865, 0.15),
    (0, "person", "person", 0.464, 0.20203018188476562, 0.24001677831013998, 0.2898001988728841, 0.17969560623168945, 0.15),
    (1, "laptop", "object", 0.971, 0.0, 0.05933819876776801, 0.9863601684570312, 0.7258580349109791, 11.325),
    (1, "keyboard", "object", 0.823, 0.015127849578857423, 0.4032317973949291, 0.9390894254048665, 0.31692935802318434, 11.325),
    (1, "person", "person", 0.788, 0.14939494132995607, 0.22272954163727937, 0.35828646024068195, 0.19709159709789134, 11.325),
    (1, "tv", "object", 0.479, 0.0, 0.12771561410692003, 0.9965375900268555, 0.40377185079786515, 11.325),
    (2, "keyboard", "object", 0.945, 0.014869880676269532, 0.3912644562897859, 0.9744167327880859, 0.34099260965983075, 22.5),
    (2, "laptop", "object", 0.941, 0.0, 0.05982491705152723, 1.0, 0.7223975481810393, 22.5),
    (2, "person", "person", 0.827, 0.19019295374552408, 0.20156772048385055, 0.31434316635131837, 0.20950010087754992, 22.5),
    (2, "tv", "object", 0.445, 0.011599254608154298, 0.10131601051047996, 0.9884007453918457, 0.44013837531760885, 22.5),
]


async def _build_real_shot_141(db, va_id: int, user_id: int) -> tuple[int, list[int]]:
    """Builds Shot 141's exact real geometry (3 frames), returns (shot_id, [frame_ids])."""
    shot_id, frame_ids = await _add_shot_with_frames(db, va_id, order=0, timestamps=[0.15, 11.325, 22.5], user_id=user_id)
    for frame_idx, label, category, conf, x, y, w, h, ts in REAL_SHOT_141_VOS:
        db.add(_vo(va_id, shot_id, frame_ids[frame_idx], label, category, conf, x, y, w, h, ts))
    await db.commit()
    return shot_id, frame_ids


# ---------------------------------------------------------------------------
# B. Response shape checks
# ---------------------------------------------------------------------------

async def test_raw_visual_object_fields_preserved_and_layout_additive():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _build_real_shot_141(db, va_id, user.id)
            await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            response = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            laptop69 = next(v for v in shot_summary.visual_objects if v.label == "laptop" and v.start_time == 0.15)

            # 14: existing Phase-B fields still present, unmodified.
            assert laptop69.label == "laptop"
            assert laptop69.x == pytest.approx(0.0)
            assert laptop69.certainty == "MEASURED"

            # 15: deterministic layout fields additive.
            assert laptop69.layout.frame_occupancy == pytest.approx(0.7504, abs=0.001)
            assert laptop69.layout.centroid_x == pytest.approx(0.497, abs=0.001)
            assert laptop69.layout.centroid_y == pytest.approx(0.417, abs=0.001)
            assert laptop69.layout.horizontal_third == "center"
            assert laptop69.layout.vertical_third == "middle"

            # 17: largest_detected_region semantics -- laptop is the largest in frame 84.
            assert laptop69.is_largest_detected_region_in_source_frame is True
            keyboard70 = next(v for v in shot_summary.visual_objects if v.label == "keyboard" and v.start_time == 0.15)
            assert keyboard70.is_largest_detected_region_in_source_frame is False
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


async def test_person_gets_geometry_only_no_persistence_effect():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _build_real_shot_141(db, va_id, user.id)
            await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            response = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            person = next(v for v in shot_summary.visual_objects if v.category == "person" and v.start_time == 0.15)
            # 16: person gets the SAME geometry measurements as any other detection.
            assert person.layout.frame_occupancy > 0
            assert person.layout.horizontal_third in {"left", "center", "right"}
            # No persistent-person layout-stability annotation exists anywhere.
            assert not any(e.native_label == "person" for e in shot_summary.layout_stability)
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


async def test_same_frame_pairwise_only_never_cross_frame():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _build_real_shot_141(db, va_id, user.id)
            await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            response = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            # 18/19: every pair must share the SAME source_frame_id.
            vo_frame_by_id = {v.id: v.source_frame_id for v in shot_summary.visual_objects}
            assert len(shot_summary.same_frame_layout_pairs) > 0
            for pair in shot_summary.same_frame_layout_pairs:
                assert vo_frame_by_id[pair.visual_object_id_a] == pair.source_frame_id
                assert vo_frame_by_id[pair.visual_object_id_b] == pair.source_frame_id
                assert vo_frame_by_id[pair.visual_object_id_a] == vo_frame_by_id[pair.visual_object_id_b]
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# C. Stability inference
# ---------------------------------------------------------------------------

async def test_rejected_before_visual_persistence_completes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            with pytest.raises(HTTPException) as exc_info:
                await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)
            assert exc_info.value.status_code == 409
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


async def test_consumes_c1_annotations_and_preserves_member_and_frame_ids():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _build_real_shot_141(db, va_id, user.id)
            persistence_response = await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            shot_summary_before = next(s for s in persistence_response.shots if s.id == shot_id)
            c1_elements_by_label = {e.native_label: e for e in shot_summary_before.persistent_visual_elements}

            response = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["visual_composition"] == "complete"

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            by_label = {e.native_label: e for e in shot_summary.layout_stability}
            assert set(by_label.keys()) == {"laptop", "keyboard", "tv"}  # 28: no person

            for label in ("laptop", "keyboard", "tv"):
                stability = by_label[label]
                c1_element = c1_elements_by_label[label]
                # 22/23: member/source-frame IDs preserved verbatim from the C1 source.
                assert stability.member_visual_object_ids == c1_element.member_visual_object_ids
                assert stability.source_frame_ids == c1_element.source_frame_ids
                assert stability.source_persistent_visual_element_id == c1_element.id
                # 25/26: certainty INFERRED, no fabricated confidence.
                assert stability.certainty == "INFERRED"
                assert stability.confidence_score is None
                # 27: no new arbitrary near-static threshold -- no such field exists at all.
                assert not hasattr(stability, "near_static")
                assert not hasattr(stability, "is_near_static")
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


async def test_does_not_independently_regroup_visual_objects():
    """21: if C1 produces zero groups (e.g. only person detections), Composition must also
    produce zero -- it must never derive its own grouping from raw VisualObjects."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _add_shot_with_frames(db, va_id, order=0, timestamps=[0.0, 5.0, 10.0], user_id=user.id)
            for i, fid in enumerate(frame_ids):
                db.add(_vo(va_id, shot_id, fid, "person", "person", 0.9, 0.1, 0.1, 0.3, 0.3, float(i * 5)))
            await db.commit()

            await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            response = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)
            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.layout_stability == []
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


async def test_actual_drift_measurements_match_real_values():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _build_real_shot_141(db, va_id, user.id)
            await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            response = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            by_label = {e.native_label: e for e in shot_summary.layout_stability}

            laptop = by_label["laptop"]
            assert laptop.centroid_max_pairwise_displacement == pytest.approx(0.0069, abs=0.001)
            assert laptop.width_min == pytest.approx(0.9864, abs=0.001)
            assert laptop.width_max == pytest.approx(1.0, abs=0.001)
            assert laptop.occupancy_min == pytest.approx(0.7160, abs=0.001)
            assert laptop.occupancy_max == pytest.approx(0.7504, abs=0.001)

            keyboard = by_label["keyboard"]
            assert keyboard.height_min == pytest.approx(0.3169, abs=0.001)
            assert keyboard.height_max == pytest.approx(0.3410, abs=0.001)
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


async def test_one_frame_shot_no_c1_group_produces_no_stability():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _add_shot_with_frames(db, va_id, order=1, timestamps=[30.25], user_id=user.id)
            db.add(_vo(va_id, shot_id, frame_ids[0], "tv", "object", 0.85, 0.0, 0.15, 0.98, 0.47, 30.25))
            await db.commit()

            await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            response = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)
            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert shot_summary.layout_stability == []
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


async def test_genuine_failure_fails_pass_with_no_orphan_rows_then_retry_succeeds():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _build_real_shot_141(db, va_id, user.id)
            await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)

            with patch.object(visual_composition_svc, "compute_layout_drift", side_effect=RuntimeError("boom")):
                failed_response = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["visual_composition"] == "failed"
            assert "boom" in failed_response.latest_analysis.error

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "persistent_layout_stability",
            ))).scalars().all()
            assert rows == []

            retried = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)
            assert retried.latest_analysis.pass_status["visual_composition"] == "complete"
            rows_after = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "persistent_layout_stability",
            ))).scalars().all()
            assert len(rows_after) == 3  # laptop, keyboard, tv
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


async def test_repeated_successful_call_does_not_duplicate_annotations():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _build_real_shot_141(db, va_id, user.id)
            await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)

            first = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)
            second = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)

            first_ids = sorted(e.id for s in first.shots for e in s.layout_stability)
            second_ids = sorted(e.id for s in second.shots for e in s.layout_stability)
            assert first_ids == second_ids

            rows = (await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "persistent_layout_stability",
            ))).scalars().all()
            assert len(rows) == 3
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


async def test_zero_eligible_c1_groups_succeeds():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            # No shots/VisualObjects at all -- C1 produces zero persistence rows.
            await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            response = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)
            assert response.latest_analysis.pass_status["visual_composition"] == "complete"
            assert response.latest_analysis.error is None
            assert all(s.layout_stability == [] for s in response.shots)
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# D. Regression: C1's own output is untouched by this pass.
# ---------------------------------------------------------------------------

async def test_c1_persistence_output_unchanged_by_composition_pass():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_ready_reference(db, user)
        try:
            shot_id, frame_ids = await _build_real_shot_141(db, va_id, user.id)
            before = await analyze_reference_video_visual_persistence(reference_video_id=rv_id, db=db, user=user)
            before_shot = next(s for s in before.shots if s.id == shot_id)
            before_elements = sorted((e.id, e.native_label, tuple(e.member_visual_object_ids)) for e in before_shot.persistent_visual_elements)

            after = await analyze_reference_video_visual_composition(reference_video_id=rv_id, db=db, user=user)
            after_shot = next(s for s in after.shots if s.id == shot_id)
            after_elements = sorted((e.id, e.native_label, tuple(e.member_visual_object_ids)) for e in after_shot.persistent_visual_elements)

            assert before_elements == after_elements
            assert len(after_shot.visual_objects) == len(before_shot.visual_objects)
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)
