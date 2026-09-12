"""
Stage 11.4 — Retention candidate generation, anti-transitive grouping, and bounded local evidence
assembly tests. Real-database convention (same as test_hook_evidence_assembly_svc.py's own
docstring). No LLM/Anthropic call anywhere in this file.
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.retention_candidate_assembly_svc import (
    RETENTION_CANDIDATE_GROUPING_WINDOW_SECONDS,
    RETENTION_LOCAL_EVIDENCE_PADDING_SECONDS,
    RetentionCandidateAssemblyError,
    assemble_candidate_evidence_bundle,
    generate_retention_candidates,
)
from app.services.story_beat_construction_svc import STORY_BEAT_CATEGORY

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_analysis(db, user, duration=30.0):
    asset = Asset(
        user_id=user.id, original_filename="stage11_4_candidate_test.mp4", stored_filename="stage11_4_candidate_test_stored.mp4",
        file_path="uploads/stage11_4_candidate_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()
    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
    db.add(va)
    await db.commit()
    return rv.id, asset.id, va.id


async def _cleanup(db, asset_id, rv_id):
    rv = await db.get(ReferenceVideo, rv_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


async def test_not_found_raises():
    async with _TestSessionLocal() as db:
        with pytest.raises(RetentionCandidateAssemblyError):
            await generate_retention_candidates(db, 999_999_999)


async def test_no_evidence_yields_zero_candidates():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            candidates = await generate_retention_candidates(db, va_id)
            assert candidates == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_shot_cuts_produce_one_candidate_per_interior_boundary():
    """N shots -> N-1 cut candidates (never one for the very first shot's own start or the very
    last shot's own end, which are not cuts at all)."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            for i, (start, end) in enumerate([(0.0, 5.0), (5.0, 10.0), (10.0, 15.0)]):
                db.add(Shot(video_analysis_id=va_id, scene_id=None, order=i, start_time=start, end_time=end,
                            certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            await db.commit()

            candidates = await generate_retention_candidates(db, va_id)
            assert len(candidates) == 2
            timestamps = sorted(c["candidate_center"] for c in candidates)
            assert timestamps == [5.0, 10.0]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_far_apart_nominations_never_merge():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=60.0)
        try:
            for i, (start, end) in enumerate([(0.0, 5.0), (5.0, 40.0), (40.0, 45.0)]):
                db.add(Shot(video_analysis_id=va_id, scene_id=None, order=i, start_time=start, end_time=end,
                            certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            await db.commit()

            candidates = await generate_retention_candidates(db, va_id)
            assert len(candidates) == 2
            centers = sorted(c["candidate_center"] for c in candidates)
            assert centers == [5.0, 40.0]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_near_simultaneous_signals_merge_into_one_candidate():
    """A shot cut + a Story Beat boundary landing within the grouping window of each other must
    merge into ONE candidate, not two separate ones -- this is the entire point of Section 4's
    grouping step."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=0, start_time=0.0, end_time=10.0,
                        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=1, start_time=10.0, end_time=20.0,
                        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            db.add(AnalysisAnnotation(
                video_analysis_id=va_id, shot_id=None, category=STORY_BEAT_CATEGORY,
                start_time=0.0, end_time=10.3, details={"boundary_status": "constructed"}, certainty="INFERRED",
                source="story_beat_construction",
            ))
            db.add(AnalysisAnnotation(
                video_analysis_id=va_id, shot_id=None, category=STORY_BEAT_CATEGORY,
                start_time=10.3, end_time=30.0, details={"boundary_status": "constructed"}, certainty="INFERRED",
                source="story_beat_construction",
            ))
            await db.commit()

            candidates = await generate_retention_candidates(db, va_id)
            assert len(candidates) == 1
            assert len(candidates[0]["source_nominations"]) == 2
            source_types = {n["source_type"] for n in candidates[0]["source_nominations"]}
            assert source_types == {"shot_cut", "story_beat_boundary"}
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_anti_transitive_chaining_does_not_lump_far_apart_events_through_a_shared_middle():
    """The Stage 10.3 lesson, reused: nomination A and B are close (merge), B and C are close, but
    A and C are NOT close enough to belong in the same candidate. A naive "compare only to the
    last member" grouping would wrongly chain A-B-C into one giant candidate; the correct grouping
    (compare to the cluster's FIRST member) must keep C separate."""
    window = RETENTION_CANDIDATE_GROUPING_WINDOW_SECONDS
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            # A=5.0, B=5.0+0.9*window, C=5.0+1.8*window -- consecutive gaps are each < window, but
            # A-to-C is 1.8*window > window.
            a, b, c = 5.0, 5.0 + 0.9 * window, 5.0 + 1.8 * window
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=0, start_time=0.0, end_time=a, certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=1, start_time=a, end_time=b, certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=2, start_time=b, end_time=c, certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=3, start_time=c, end_time=30.0, certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            await db.commit()

            candidates = await generate_retention_candidates(db, va_id)
            assert len(candidates) == 2
            first, second = candidates
            assert first["source_nominations"][0]["timestamp"] == pytest.approx(a)
            assert first["source_nominations"][-1]["timestamp"] == pytest.approx(b)
            assert second["source_nominations"][0]["timestamp"] == pytest.approx(c)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_bare_question_mark_alone_does_not_generate_a_question_candidate_without_structural_signal():
    """A speech segment containing a real '?' DOES generate a possible_question_speech nomination
    -- but text with no question mark at all must never be mistaken for one."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=20.0)
        try:
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=5.0, end_time=6.0,
                                  text="have you ever wondered why?", certainty="MEASURED", source="whisper"))
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=12.0, end_time=13.0,
                                  text="this is just a plain statement", certainty="MEASURED", source="whisper"))
            await db.commit()

            candidates = await generate_retention_candidates(db, va_id)
            assert len(candidates) == 1
            assert candidates[0]["source_nominations"][0]["source_type"] == "possible_question_speech"
            assert candidates[0]["candidate_center"] == pytest.approx(5.0)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_urdu_question_mark_is_detected():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=20.0)
        try:
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=3.0, end_time=4.0,
                                  text="کیا آپ نے کبھی سوچا ہے؟", certainty="MEASURED", source="whisper", language="ur"))
            await db.commit()

            candidates = await generate_retention_candidates(db, va_id)
            assert len(candidates) == 1
            assert candidates[0]["source_nominations"][0]["source_type"] == "possible_question_speech"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_text_appearance_generates_a_candidate():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=20.0)
        try:
            db.add(TextElement(video_analysis_id=va_id, shot_id=None, text="WAIT FOR IT",
                                x=0.1, y=0.1, width=0.5, height=0.2, start_time=8.0, end_time=10.0,
                                certainty="MEASURED", source="easyocr"))
            await db.commit()

            candidates = await generate_retention_candidates(db, va_id)
            assert len(candidates) == 1
            assert candidates[0]["source_nominations"][0]["source_type"] == "text_appearance"
            assert candidates[0]["candidate_center"] == pytest.approx(8.0)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_va5368_shape_many_story_beats_one_visual_cut_does_not_overproduce_candidates():
    """Regression against the already-established VA5368 structural fact: 14 Story Beats but only
    1 visual cut. Every Story Beat boundary is still a valid, independent candidate source (the
    brief's own Section 3 lists it explicitly) -- this is NOT a bug to suppress, but grouping must
    still correctly merge a Story Beat boundary landing at the same instant as the one real Shot
    cut into a single candidate rather than double-counting it."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=140.0)
        try:
            # One real Shot cut at 70.0.
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=0, start_time=0.0, end_time=70.0,
                        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            db.add(Shot(video_analysis_id=va_id, scene_id=None, order=1, start_time=70.0, end_time=140.0,
                        certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            # 14 Story Beats -> 13 interior boundaries, spaced 10s apart (none near the 70.0 cut
            # except the one exactly at 70.0).
            edges = [i * 10.0 for i in range(15)]  # 0..140 step 10 -> 15 edges -> 14 beats
            for i in range(14):
                db.add(AnalysisAnnotation(
                    video_analysis_id=va_id, shot_id=None, category=STORY_BEAT_CATEGORY,
                    start_time=edges[i], end_time=edges[i + 1], details={"boundary_status": "constructed"},
                    certainty="INFERRED", source="story_beat_construction",
                ))
            await db.commit()

            candidates = await generate_retention_candidates(db, va_id)
            # 13 interior Story Beat boundaries + 1 Shot cut, but the boundary at 70.0 coincides
            # exactly with the Shot cut -> merges into one candidate instead of two.
            assert len(candidates) == 13
            merged = next(c for c in candidates if c["candidate_center"] == pytest.approx(70.0))
            assert len(merged["source_nominations"]) == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Bounded local evidence bundle assembly.
# ---------------------------------------------------------------------------

async def test_evidence_bundle_excludes_evidence_far_outside_the_padded_window():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=60.0)
        try:
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=10.0, end_time=10.5,
                                  text="near the candidate", certainty="MEASURED", source="whisper"))
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=40.0, end_time=40.5,
                                  text="far away", certainty="MEASURED", source="whisper"))
            await db.commit()

            candidate = {"candidate_start": 10.0, "candidate_end": 10.0, "candidate_center": 10.0, "source_nominations": []}
            bundle = await assemble_candidate_evidence_bundle(db, va_id, candidate)
            texts = [s["text"] for s in bundle["speech_segments"]]
            assert "near the candidate" in texts
            assert "far away" not in texts
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_evidence_bundle_includes_evidence_just_inside_the_padding():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=60.0)
        try:
            just_inside = 10.0 + RETENTION_LOCAL_EVIDENCE_PADDING_SECONDS - 0.1
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=just_inside, end_time=just_inside + 0.2,
                                  text="just inside padding", certainty="MEASURED", source="whisper"))
            await db.commit()

            candidate = {"candidate_start": 10.0, "candidate_end": 10.0, "candidate_center": 10.0, "source_nominations": []}
            bundle = await assemble_candidate_evidence_bundle(db, va_id, candidate)
            texts = [s["text"] for s in bundle["speech_segments"]]
            assert "just inside padding" in texts
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_evidence_bundle_carries_source_nominations_and_window():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=30.0)
        try:
            candidate = {
                "candidate_start": 5.0, "candidate_end": 5.2, "candidate_center": 5.1,
                "source_nominations": [{"source_type": "shot_cut", "source_id": 42, "timestamp": 5.0}],
            }
            bundle = await assemble_candidate_evidence_bundle(db, va_id, candidate)
            assert bundle["source_nominations"] == candidate["source_nominations"]
            assert bundle["candidate_window"]["candidate_start"] == 5.0
            assert bundle["candidate_window"]["candidate_end"] == 5.2
            assert bundle["candidate_window"]["start_time"] == pytest.approx(5.0 - RETENTION_LOCAL_EVIDENCE_PADDING_SECONDS)
            assert bundle["candidate_window"]["end_time"] == pytest.approx(5.2 + RETENTION_LOCAL_EVIDENCE_PADDING_SECONDS)
        finally:
            await _cleanup(db, asset_id, rv_id)
