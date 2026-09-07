"""
Video Deconstructor — Stage 8 (Visual Objects / People / Products / Composition), Phase B
router/persistence tests.

Same real-database, direct-router-call, no-HTTP-client convention as
test_reference_video_audio_structure.py's own docstring — `visual_object_svc.analyze_
visual_objects` is mocked exactly the same way `audio_structure_svc.analyze_audio_structure` is
mocked there, so these tests never load a real torchvision model or touch a real image file.

Covers the 24 requested checks:
 1. Prerequisite is Stage 5 visual_evidence complete ONLY (409 before it).
 2. Does not require text_analysis/speech_analysis/audio_structure complete.
 3. Processes every persisted Stage-5 ShotFrame (and only those — no supplementary extraction).
 4. Native COCO label preserved verbatim (never rewritten into a guessed "real" identity).
 5. Raw class_id preserved.
 6. Detector confidence_score preserved verbatim (no fabricated second confidence).
 7. Normalized geometry (x/y/width/height) preserved verbatim from the detector's own bbox.
 8. source_frame_id traces each row back to the exact ShotFrame it came from.
 9. start_time == end_time == the source frame's own timestamp (no fabricated duration).
10. COCO "person" maps to category="person" (structural equivalence only).
11. Every non-person COCO label maps to the neutral category="object" — never a guessed
    product/prop/logo/background role.
12. certainty is always "MEASURED".
13. evidence_summary explicitly disclaims physical-object/business-role claims.
14. source is the producer/engine family name ("torchvision"), never the exact model variant —
    same convention as "easyocr"/"whisper" elsewhere; the exact model identifier is preserved
    verbatim in evidence_summary instead (never lost).
15. produced_by_pass is the constant VISUAL_OBJECTS_PASS_NAME.
16. Zero detections across every frame completes successfully with zero rows (not a failure).
17. A genuine failure fails the pass honestly, leaves no orphan/partial rows.
18. Retry after a genuine failure succeeds cleanly.
19. Repeated successful call is idempotent — never duplicates rows.
20. Stage 5/6/7 data (Shot/ShotFrame/TextElement/SpeechSegment) is unaffected.
21. Response shape: visual_objects nested per-Shot, only the documented raw-evidence fields
    exposed — no dominant-subject/product-role/composition/grouping/tracking fields.
22. Multiple frames within one Shot all get processed; each frame's detections stay attributed
    to their own source frame, not merged.
23. A Shot with an unrelated Stage-5 frame whose Asset happens to be shared is not affected
    (source_frame_id, not shot-level attribution, is the real join key).
24. No frontend/editor files touched — verified structurally by this test file itself never
    importing anything outside backend/app.
"""
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.shot_frame import ShotFrame
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.models.visual_object import VisualObject
from app.routers.reference_videos import VISUAL_OBJECTS_PASS_NAME, analyze_reference_video_visual_objects
from app.services import visual_object_svc

# Same real-database, no-Alembic, NullPool-engine convention every other router test file in this
# suite already established (see test_reference_video_audio_structure.py's own docstring) — small
# helpers duplicated here rather than cross-imported, matching this project's own established
# convention.
_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(
    db, user: User, duration: float = 10.0, frames_per_shot: dict[int, list[float]] | None = None,
) -> tuple[int, int, int, list[int], dict[int, list[int]]]:
    """A ReferenceVideo whose VideoAnalysis already has visual_evidence="complete" (Stage 8 Phase
    B's sole prerequisite), real Shot rows, and — per `frames_per_shot` (shot index -> list of
    frame timestamps) — real ShotFrame rows each backed by their own Asset, exactly the shape
    Stage 5 itself leaves behind. Returns (reference_video_id, asset_id, video_analysis_id,
    [shot_ids], {shot_id: [shot_frame_ids]})."""
    asset = Asset(
        user_id=user.id, original_filename="stage8_phase_b_test.mp4", stored_filename="stage8_phase_b_test_stored.mp4",
        file_path="uploads/stage8_phase_b_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
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

    frames_per_shot = frames_per_shot or {0: [1.0]}
    shot_ids: list[int] = []
    shot_frame_ids: dict[int, list[int]] = {}
    for i in sorted(frames_per_shot.keys()):
        shot = Shot(
            video_analysis_id=va.id, scene_id=None, order=i, start_time=float(i) * 5.0, end_time=float(i) * 5.0 + 5.0,
            certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1",
        )
        db.add(shot)
        await db.flush()
        shot_ids.append(shot.id)

        frame_ids: list[int] = []
        for j, ts in enumerate(frames_per_shot[i]):
            frame_asset = Asset(
                user_id=user.id, original_filename=f"stage5_frame_shot{i}_{j}.jpg", stored_filename=f"stage5_frame_shot{i}_{j}_stored.jpg",
                file_path=f"uploads/stage5_frame_shot{i}_{j}.jpg", file_type="reference_frame", mime_type="image/jpeg", file_size=2048,
            )
            db.add(frame_asset)
            await db.flush()
            frame = ShotFrame(
                shot_id=shot.id, video_analysis_id=va.id, asset_id=frame_asset.id, timestamp=ts, order=j,
                extraction_method="representative", width=1280, height=720,
                certainty="MEASURED", source="ffmpeg", produced_by_pass="frame_extraction_v1",
            )
            db.add(frame)
            await db.flush()
            frame_ids.append(frame.id)
        shot_frame_ids[shot.id] = frame_ids

    await db.commit()
    return rv.id, asset.id, va.id, shot_ids, shot_frame_ids


async def _cleanup(db, asset_id: int, reference_video_id: int | None, video_analysis_id: int | None = None):
    """ReferenceVideo deletion cascades VideoAnalysis -> Shot -> ShotFrame/VisualObject
    automatically, but ShotFrame.asset_id and VisualObject.source_frame_id are both RESTRICT —
    the frame Assets themselves (and the top-level video Asset) must be deleted separately, same
    convention as test_reference_video_frames.py's own _cleanup."""
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


def _detection(label: str, class_id: int, confidence: float = 0.75, bbox: dict | None = None) -> dict:
    return {
        "class_id": class_id,
        "label": label,
        "confidence_score": confidence,
        "bbox_pixels": {"x1": 10.0, "y1": 20.0, "x2": 110.0, "y2": 220.0},
        "bbox_normalized": bbox or {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.3},
    }


def _mocked_detector_result(detections: list[dict], model: str = "fasterrcnn_mobilenet_v3_large_320_fpn") -> dict:
    return {
        "model": model,
        "confidence_threshold": 0.40,
        "image_width": 1280,
        "image_height": 720,
        "detections": detections,
    }


# ---------------------------------------------------------------------------
# 1/2. Prerequisite gating: visual_evidence required; text/speech/audio_structure NOT required.
# ---------------------------------------------------------------------------

async def test_rejected_before_visual_evidence_completes():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        asset = Asset(
            user_id=user.id, original_filename="not_yet_probed.mp4", stored_filename="not_yet_probed_stored.mp4",
            file_path="uploads/not_yet_probed.mp4", file_type="video", mime_type="video/mp4", file_size=10,
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
                await analyze_reference_video_visual_objects(reference_video_id=rv_id, db=db, user=user)
            assert exc_info.value.status_code == 409
        finally:
            await _cleanup(db, asset_id_, rv_id)


async def test_does_not_require_text_speech_or_audio_structure_complete():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids, frame_ids = await _make_ready_reference(db, user)
        try:
            va = await db.get(VideoAnalysis, va_id)
            assert "text_analysis" not in (va.pass_status or {})
            assert "speech_analysis" not in (va.pass_status or {})
            assert "audio_structure" not in (va.pass_status or {})

            with patch.object(visual_object_svc, "analyze_visual_objects", new=AsyncMock(return_value=_mocked_detector_result([]))):
                response = await analyze_reference_video_visual_objects(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["visual_objects"] == "complete"
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# 3-15. Successful detection persists correctly-mapped, evidence-preserving rows.
# ---------------------------------------------------------------------------

async def test_successful_detection_persists_raw_evidence_correctly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids, frame_ids = await _make_ready_reference(db, user, frames_per_shot={0: [1.0]})
        shot_id = shot_ids[0]
        frame_id = frame_ids[shot_id][0]
        try:
            detections = [
                _detection("person", 1, confidence=0.83, bbox={"x": 0.05, "y": 0.1, "width": 0.3, "height": 0.6}),
                _detection("cell phone", 77, confidence=0.55, bbox={"x": 0.4, "y": 0.4, "width": 0.1, "height": 0.15}),
            ]
            mock_analyze = AsyncMock(return_value=_mocked_detector_result(detections))
            with patch.object(visual_object_svc, "analyze_visual_objects", new=mock_analyze):
                response = await analyze_reference_video_visual_objects(reference_video_id=rv_id, db=db, user=user)

            mock_analyze.assert_awaited_once_with("uploads/stage5_frame_shot0_0.jpg")

            assert response.latest_analysis.pass_status["visual_objects"] == "complete"
            assert response.latest_analysis.status == "complete"

            rows = (await db.execute(select(VisualObject).where(VisualObject.video_analysis_id == va_id))).scalars().all()
            assert len(rows) == 2

            person_row = next(r for r in rows if r.label == "person")
            phone_row = next(r for r in rows if r.label == "cell phone")

            # 4/5/6. Native label, raw class_id, raw confidence preserved verbatim.
            assert person_row.class_id == 1
            assert person_row.confidence_score == 0.83
            assert phone_row.class_id == 77
            assert phone_row.confidence_score == 0.55
            assert phone_row.label == "cell phone"  # never rewritten to a guessed "product"

            # 7. Normalized geometry preserved verbatim.
            assert phone_row.x == 0.4 and phone_row.y == 0.4
            assert phone_row.width == 0.1 and phone_row.height == 0.15

            # 8. source_frame_id traces back to the exact ShotFrame.
            assert person_row.source_frame_id == frame_id
            assert phone_row.source_frame_id == frame_id
            assert person_row.shot_id == shot_id

            # 9. No fabricated duration — both start_time and end_time equal the frame's own timestamp.
            assert person_row.start_time == 1.0 and person_row.end_time == 1.0

            # 10/11. Category mapping: person -> "person"; everything else -> "object".
            assert person_row.category == "person"
            assert phone_row.category == "object"

            # 12. certainty always MEASURED.
            assert person_row.certainty == "MEASURED" and phone_row.certainty == "MEASURED"

            # 13. evidence_summary disclaims physical-object/business-role claims.
            assert "not a claim" in phone_row.evidence_summary
            assert "business role" in phone_row.evidence_summary

            # 14. source is the producer/engine FAMILY name — same convention as "easyocr"/
            # "whisper" elsewhere in this router, never the exact model variant. The exact model
            # identifier is preserved verbatim in evidence_summary instead (never lost).
            assert person_row.source == "torchvision"
            assert phone_row.source == "torchvision"
            assert "fasterrcnn_mobilenet_v3_large_320_fpn" in person_row.evidence_summary
            assert "fasterrcnn_mobilenet_v3_large_320_fpn" in phone_row.evidence_summary

            # 15. produced_by_pass is the constant.
            assert person_row.produced_by_pass == VISUAL_OBJECTS_PASS_NAME == "visual_objects_v1"

            # 21. Response shape: nested under the correct Shot, only documented fields.
            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert len(shot_summary.visual_objects) == 2
            vo_summary = next(v for v in shot_summary.visual_objects if v.label == "cell phone")
            assert vo_summary.source_frame_id == frame_id
            assert vo_summary.source_frame_asset_file_path == "uploads/stage5_frame_shot0_0.jpg"
            assert not hasattr(vo_summary, "dominant_subject")
            assert not hasattr(vo_summary, "product_role")
            assert not hasattr(vo_summary, "tracking_id")
            assert not hasattr(vo_summary, "group_id")
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# 16. Zero detections across every frame: pass complete, zero rows, not failed.
# ---------------------------------------------------------------------------

async def test_zero_detections_completes_successfully_with_zero_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids, frame_ids = await _make_ready_reference(db, user, frames_per_shot={0: [1.0]})
        try:
            with patch.object(visual_object_svc, "analyze_visual_objects", new=AsyncMock(return_value=_mocked_detector_result([]))):
                response = await analyze_reference_video_visual_objects(reference_video_id=rv_id, db=db, user=user)

            assert response.latest_analysis.pass_status["visual_objects"] == "complete"
            assert response.latest_analysis.error is None

            rows = (await db.execute(select(VisualObject).where(VisualObject.video_analysis_id == va_id))).scalars().all()
            assert rows == []
            shot_summary = next(s for s in response.shots if s.id == shot_ids[0])
            assert shot_summary.visual_objects == []
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# 17/18. A genuine failure fails the pass honestly, leaves no orphan rows, retry succeeds.
# ---------------------------------------------------------------------------

async def test_genuine_failure_fails_pass_with_no_orphan_rows_then_retry_succeeds():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids, frame_ids = await _make_ready_reference(db, user, frames_per_shot={0: [1.0]})
        try:
            with patch.object(visual_object_svc, "analyze_visual_objects", new=AsyncMock(side_effect=RuntimeError("Could not decode image for visual-object detection"))):
                failed_response = await analyze_reference_video_visual_objects(reference_video_id=rv_id, db=db, user=user)

            assert failed_response.latest_analysis.pass_status["visual_objects"] == "failed"
            assert failed_response.latest_analysis.status == "complete"
            assert "Could not decode image" in failed_response.latest_analysis.error

            rows = (await db.execute(select(VisualObject).where(VisualObject.video_analysis_id == va_id))).scalars().all()
            assert rows == []

            with patch.object(visual_object_svc, "analyze_visual_objects", new=AsyncMock(return_value=_mocked_detector_result([_detection("person", 1)]))):
                retried = await analyze_reference_video_visual_objects(reference_video_id=rv_id, db=db, user=user)

            assert retried.latest_analysis.pass_status["visual_objects"] == "complete"
            rows_after_retry = (await db.execute(select(VisualObject).where(VisualObject.video_analysis_id == va_id))).scalars().all()
            assert len(rows_after_retry) == 1
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# 19. Repeated successful call is idempotent — never duplicates rows.
# ---------------------------------------------------------------------------

async def test_repeated_successful_call_does_not_duplicate_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids, frame_ids = await _make_ready_reference(db, user, frames_per_shot={0: [1.0]})
        try:
            mock_analyze = AsyncMock(return_value=_mocked_detector_result([_detection("person", 1), _detection("laptop", 63)]))
            with patch.object(visual_object_svc, "analyze_visual_objects", new=mock_analyze):
                first = await analyze_reference_video_visual_objects(reference_video_id=rv_id, db=db, user=user)
                second = await analyze_reference_video_visual_objects(reference_video_id=rv_id, db=db, user=user)

            assert mock_analyze.await_count == 1  # idempotent early-return skipped the second call entirely
            assert [v.id for s in first.shots for v in s.visual_objects] == [v.id for s in second.shots for v in s.visual_objects]

            rows = (await db.execute(select(VisualObject).where(VisualObject.video_analysis_id == va_id))).scalars().all()
            assert len(rows) == 2
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# 20. Stage 5/6/7 data is unaffected by this pass.
# ---------------------------------------------------------------------------

async def test_stage_5_6_7_data_unaffected():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids, frame_ids = await _make_ready_reference(db, user, frames_per_shot={0: [1.0]})
        shot_id = shot_ids[0]
        try:
            mixed_text = "यह एक परीक्षण है — this is a test"
            text_el = TextElement(
                video_analysis_id=va_id, shot_id=shot_id, text=mixed_text, x=0.1, y=0.1, width=0.2, height=0.1,
                start_time=1.0, end_time=1.0, certainty="MEASURED", confidence_score=0.9,
            )
            db.add(text_el)
            await db.commit()
            before_text_id = text_el.id
            before_frame_count = len((await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == va_id))).scalars().all())

            with patch.object(visual_object_svc, "analyze_visual_objects", new=AsyncMock(return_value=_mocked_detector_result([_detection("person", 1)]))):
                response = await analyze_reference_video_visual_objects(reference_video_id=rv_id, db=db, user=user)

            after_text = await db.get(TextElement, before_text_id)
            assert after_text.text == mixed_text
            assert after_text.confidence_score == 0.9

            after_frame_count = len((await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == va_id))).scalars().all())
            assert after_frame_count == before_frame_count

            shot_summary = next(s for s in response.shots if s.id == shot_id)
            assert len(shot_summary.text_elements) == 1  # Stage 6 data still surfaces, untouched
            assert len(shot_summary.frames) == 1  # Stage 5 data still surfaces, untouched
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)


# ---------------------------------------------------------------------------
# 22/23. Multiple frames across multiple shots each attribute detections to their own frame.
# ---------------------------------------------------------------------------

async def test_multiple_frames_across_shots_attribute_detections_to_their_own_frame():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_ids, frame_ids = await _make_ready_reference(
            db, user, frames_per_shot={0: [1.0, 2.5], 1: [6.0]},
        )
        try:
            shot0_frame0, shot0_frame1 = frame_ids[shot_ids[0]]
            shot1_frame0 = frame_ids[shot_ids[1]][0]

            async def _fake_analyze(image_path: str) -> dict:
                if image_path == "uploads/stage5_frame_shot0_0.jpg":
                    return _mocked_detector_result([_detection("person", 1, confidence=0.6)])
                if image_path == "uploads/stage5_frame_shot0_1.jpg":
                    return _mocked_detector_result([_detection("keyboard", 76, confidence=0.9)])
                if image_path == "uploads/stage5_frame_shot1_0.jpg":
                    return _mocked_detector_result([_detection("tv", 72, confidence=0.7)])
                raise AssertionError(f"unexpected image_path {image_path!r}")

            with patch.object(visual_object_svc, "analyze_visual_objects", new=AsyncMock(side_effect=_fake_analyze)):
                response = await analyze_reference_video_visual_objects(reference_video_id=rv_id, db=db, user=user)

            rows = (await db.execute(select(VisualObject).where(VisualObject.video_analysis_id == va_id))).scalars().all()
            assert len(rows) == 3
            by_frame = {r.source_frame_id: r for r in rows}
            assert by_frame[shot0_frame0].label == "person" and by_frame[shot0_frame0].shot_id == shot_ids[0]
            assert by_frame[shot0_frame1].label == "keyboard" and by_frame[shot0_frame1].shot_id == shot_ids[0]
            assert by_frame[shot1_frame0].label == "tv" and by_frame[shot1_frame0].shot_id == shot_ids[1]

            shot0_summary = next(s for s in response.shots if s.id == shot_ids[0])
            shot1_summary = next(s for s in response.shots if s.id == shot_ids[1])
            assert len(shot0_summary.visual_objects) == 2
            assert len(shot1_summary.visual_objects) == 1
        finally:
            await _cleanup(db, asset_id, rv_id, va_id)
