"""Video Deconstructor — Stage 6 (OCR / On-Screen Text / Captions), surfaced-confidence fix.

Manual-test finding (real Railway run, Shot 01/02): with no confidence gate anywhere in the
pipeline, an Occurrence Group head formed from a single low-confidence EasyOCR misread (2%-19%
confidence) surfaced as its own full-weight "occurrence" in the UI/API summary. See
MIN_SURFACED_OCR_CONFIDENCE's own docstring in reference_videos.py for the full fix rationale.

This is a PRESENTATION-LAYER filter only — applied in `_to_response` when deciding which
Occurrence Group heads populate `shot.text_elements`. It does not touch EasyOCR, frame sampling,
`select_frames_to_ocr`, `group_occurrences`, or `link_recurring_elements`, and it does not delete
or mutate a single TextElement row. These tests construct TextElement rows directly (with
controlled confidence_score values) rather than running real OCR — this is a response-shaping
test, not an OCR-accuracy test; the existing `test_reference_video_text.py` already covers real
end-to-end OCR behavior and is intentionally left untouched by this fix.

Same real-database, direct-function-call testing convention as every other Stage 6 test file
(see test_reference_video_text.py's own docstring for the shared rationale).
"""
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.routers.reference_videos import MIN_SURFACED_OCR_CONFIDENCE, get_reference_video
from app.services import ocr_svc

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_ready_reference(db, user: User) -> tuple[int, int, int, int]:
    """A ReferenceVideo with one completed VideoAnalysis and one Shot — Stage 6's own
    pass_status already marked complete, since these tests exercise `_to_response`'s own
    read-time filter, never the analyze-text write path itself."""
    asset = Asset(
        user_id=user.id, original_filename="surfaced_confidence_test.mp4",
        stored_filename="surfaced_confidence_test_stored.mp4",
        file_path="uploads/surfaced_confidence_test.mp4", file_type="video",
        mime_type="video/mp4", file_size=1024,
    )
    db.add(asset)
    await db.flush()

    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=10.0)
    db.add(rv)
    await db.flush()

    va = VideoAnalysis(
        reference_video_id=rv.id, status="complete",
        pass_status={
            "technical_probe": "complete", "scene_segmentation": "complete",
            "visual_evidence": "complete", "text_analysis": "complete",
        },
    )
    db.add(va)
    await db.flush()

    shot = Shot(
        video_analysis_id=va.id, scene_id=None, order=0, start_time=0.0, end_time=10.0,
        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1",
    )
    db.add(shot)
    await db.flush()

    await db.commit()
    return rv.id, asset.id, va.id, shot.id


async def _add_text_element(
    db, video_analysis_id: int, shot_id: int, source_frame_asset_id: int, *,
    text: str, confidence: float | None, occurrence_group_id: int | None = None,
    x: float = 0.1, y: float = 0.1, width: float = 0.2, height: float = 0.1,
    timestamp: float = 1.0,
) -> TextElement:
    row = TextElement(
        video_analysis_id=video_analysis_id, shot_id=shot_id,
        text=text, x=x, y=y, width=width, height=height,
        start_time=timestamp, end_time=timestamp,
        certainty="MEASURED", confidence_score=confidence, source="easyocr",
        source_frame_asset_id=source_frame_asset_id,
        produced_by_pass="ocr_text_detection_v1",
        occurrence_group_id=occurrence_group_id,
    )
    db.add(row)
    await db.flush()
    return row


async def _cleanup(db, asset_id: int, reference_video_id: int):
    rv = await db.get(ReferenceVideo, reference_video_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


def _find(elements, text: str):
    return next((e for e in elements if e.text == text), None)


# ---------------------------------------------------------------------------
# A/B/C/D — the threshold boundary itself.
# ---------------------------------------------------------------------------

async def test_low_confidence_heads_below_threshold_are_not_surfaced():
    """A: 0.19 confidence head is excluded. B: 0.02 confidence head is excluded."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_ready_reference(db, user)
        try:
            await _add_text_element(db, va_id, shot_id, asset_id, text="u Jo", confidence=0.19)
            await _add_text_element(db, va_id, shot_id, asset_id, text="Ztam", confidence=0.02)
            await db.commit()

            response = await get_reference_video(reference_video_id=rv_id, db=db, user=user)
            surfaced = response.shots[0].text_elements

            assert _find(surfaced, "u Jo") is None
            assert _find(surfaced, "Ztam") is None
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_confidence_at_and_above_threshold_is_surfaced():
    """C: exactly 0.50 (the threshold itself) IS returned — the filter is a strict `<`, so the
    boundary value is inclusive. D: 0.92 IS returned."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_ready_reference(db, user)
        try:
            assert MIN_SURFACED_OCR_CONFIDENCE == 0.50  # pin the exact value this test assumes
            await _add_text_element(db, va_id, shot_id, asset_id, text="Sale", confidence=0.50)
            await _add_text_element(db, va_id, shot_id, asset_id, text="Visit our showroom", confidence=0.92)
            await db.commit()

            response = await get_reference_video(reference_video_id=rv_id, db=db, user=user)
            surfaced = response.shots[0].text_elements

            assert _find(surfaced, "Sale") is not None
            assert _find(surfaced, "Visit our showroom") is not None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# E — group size must never be the filter signal.
# ---------------------------------------------------------------------------

async def test_high_confidence_singleton_is_surfaced():
    """A genuine, rare, single-observation detection at high confidence must still be surfaced
    — filtering is confidence-only, per the explicit requirement that group size never gates
    this."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_ready_reference(db, user)
        try:
            await _add_text_element(db, va_id, shot_id, asset_id, text="Limited Time Offer", confidence=0.88)
            await db.commit()

            response = await get_reference_video(reference_video_id=rv_id, db=db, user=user)
            surfaced = response.shots[0].text_elements

            assert len(surfaced) == 1
            assert surfaced[0].text == "Limited Time Offer"
            assert len(surfaced[0].observations) == 1  # a real singleton, not artificially merged
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# F/G — evidence preservation: nothing is deleted, mutated, or hidden from the raw record.
# ---------------------------------------------------------------------------

async def test_filtered_low_confidence_rows_still_exist_untouched_in_the_db():
    """F: a head excluded from the summary is NOT removed from the database — its row, and
    every field on it, remain exactly as written."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_ready_reference(db, user)
        try:
            written = await _add_text_element(db, va_id, shot_id, asset_id, text="Au", confidence=0.02)
            written_id = written.id
            await db.commit()

            response = await get_reference_video(reference_video_id=rv_id, db=db, user=user)
            assert _find(response.shots[0].text_elements, "Au") is None  # excluded from the summary

            result = await db.execute(select(TextElement).where(TextElement.id == written_id))
            row = result.scalar_one()  # still exists — not deleted
            assert row.text == "Au"
            assert row.confidence_score == 0.02
            assert row.certainty == "MEASURED"  # untouched — filtering never reclassifies certainty
            assert row.occurrence_group_id is None  # untouched — still its own group's canonical head
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_surfaced_group_still_shows_every_raw_member_including_low_confidence_ones():
    """G: raw observation preservation is unchanged — a SURFACED head's own `observations` list
    (the pre-existing "every raw detection nested under its head" contract) still includes every
    member exactly as before, even a low-confidence one, since this fix only ever filters which
    HEADS are counted as occurrences — it never touches what a surfaced head's own observations
    list contains."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id, shot_id = await _make_ready_reference(db, user)
        try:
            head = await _add_text_element(db, va_id, shot_id, asset_id, text="GBABLU.SHARE", confidence=0.91, timestamp=1.0)
            await _add_text_element(
                db, va_id, shot_id, asset_id, text="GBABLU.SHAR", confidence=0.14,
                occurrence_group_id=head.id, timestamp=1.2,
            )
            await db.commit()

            response = await get_reference_video(reference_video_id=rv_id, db=db, user=user)
            surfaced = response.shots[0].text_elements

            assert len(surfaced) == 1
            group = surfaced[0]
            assert group.text == "GBABLU.SHARE"  # the head (highest-confidence member) is canonical
            assert len(group.observations) == 2  # BOTH raw observations preserved, low-confidence included
            observed_texts = {o.text for o in group.observations}
            assert observed_texts == {"GBABLU.SHARE", "GBABLU.SHAR"}
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# H — grouping/linking logic itself is untouched by this fix.
# ---------------------------------------------------------------------------

def test_group_occurrences_behaviour_is_unaffected_by_confidence():
    """H (grouping): ocr_svc.group_occurrences is a pure function this fix never modified —
    confirms it still groups purely on geometry/text/time, with confidence playing no role in
    whether two detections are unioned (only in which member becomes the canonical head)."""
    low = {"text": "Sale", "confidence": 0.05, "bbox_norm": (0.1, 0.1, 0.3, 0.2), "timestamp": 1.0, "file_path": "frame_a.jpg"}
    high = {"text": "Sale", "confidence": 0.95, "bbox_norm": (0.1, 0.1, 0.3, 0.2), "timestamp": 1.0, "file_path": "frame_a.jpg"}

    groups = ocr_svc.group_occurrences([low, high])

    assert len(groups) == 1  # still one group — same-frame identity rule, confidence irrelevant to grouping
    assert groups[0][0]["confidence"] == 0.95  # highest-confidence member still sorted first (canonical head)
    assert groups[0][1]["confidence"] == 0.05  # the low-confidence member is still preserved as a member


def test_link_recurring_elements_behaviour_is_unaffected_by_confidence():
    """H (recurring-link): ocr_svc.link_recurring_elements is untouched by this fix — a
    low-confidence head is linked/not-linked purely on its own existing text-similarity/geometry
    rules, exactly as before."""
    heads = [
        {"id": 1, "text": "Visit our showroom", "bbox_norm": (0.6, 0.05, 0.95, 0.15), "timestamp": 2.0},
        {"id": 2, "text": "Visit our showroom", "bbox_norm": (0.6, 0.05, 0.95, 0.15), "timestamp": 9.0},
    ]

    clusters = ocr_svc.link_recurring_elements(heads)

    assert len(clusters) == 1
    assert set(clusters[0]["member_ids"]) == {1, 2}
