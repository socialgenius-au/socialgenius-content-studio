"""
Video Deconstructor — Stage 11.1: Editing Logic Deterministic Measurements V1 tests.

Same real-database, direct-service-call convention as test_story_beat_construction_svc.py's own
docstring. Pure-function unit tests (no DB) for the arithmetic/classification primitives, plus
full end-to-end DB tests for persistence, idempotency, provenance, and every edge case the Stage
11.1 brief names explicitly. No LLM/Anthropic call exists anywhere in this module or its tests.
"""
import math
from types import SimpleNamespace

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
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.editing_rhythm_svc import (
    CUT_NEAR_SILENCE_TOLERANCE_SECONDS, CUT_NEAR_SPEECH_BOUNDARY_TOLERANCE_SECONDS,
    EDITING_CUT_ALIGNMENT_CATEGORY, EDITING_PACING_PHASE_CATEGORY, EDITING_RHYTHM_PROFILE_CATEGORY,
    EditingRhythmError, _classify_cut, _cuts_per_minute, _shot_duration_stats,
    compute_and_persist_editing_rhythm,
)
from app.services.story_beat_construction_svc import STORY_BEAT_CATEGORY

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


# ---------------------------------------------------------------------------
# Pure-function unit tests (no DB) — arithmetic and classification primitives.
# ---------------------------------------------------------------------------

def _shot(id_, start, end):
    return SimpleNamespace(id=id_, start_time=start, end_time=end)


def test_shot_duration_stats_manual_fixture():
    # durations [2, 3, 1, 4] — every value hand-calculated in the docstring above the assertion.
    shots = [_shot(1, 0, 2), _shot(2, 2, 5), _shot(3, 5, 6), _shot(4, 6, 10)]
    stats = _shot_duration_stats(shots)
    assert stats["shot_count"] == 4
    assert stats["average_shot_duration"] == pytest.approx(2.5)
    assert stats["median_shot_duration"] == pytest.approx(2.5)  # sorted [1,2,3,4] -> mean(2,3)
    assert stats["minimum_shot_duration"] == 1
    assert stats["maximum_shot_duration"] == 4
    # population stdev: sqrt(((2-2.5)^2+(3-2.5)^2+(1-2.5)^2+(4-2.5)^2)/4) = sqrt(5/4)
    assert stats["shot_duration_stddev"] == pytest.approx(math.sqrt(1.25))


def test_shot_duration_stats_empty_is_all_none_never_zero():
    stats = _shot_duration_stats([])
    assert stats == {
        "shot_count": 0, "average_shot_duration": None, "median_shot_duration": None,
        "minimum_shot_duration": None, "maximum_shot_duration": None, "shot_duration_stddev": None,
    }


def test_shot_duration_stats_single_shot_stddev_is_zero_not_undefined():
    stats = _shot_duration_stats([_shot(1, 0, 3)])
    assert stats["shot_count"] == 1
    assert stats["shot_duration_stddev"] == 0.0


def test_cuts_per_minute_manual_fixture():
    # 4 shots -> 3 cuts, 10s duration -> 3 / (10/60) = 18.0
    assert _cuts_per_minute(4, 10.0) == pytest.approx(18.0)


def test_cuts_per_minute_zero_shots_is_zero_cuts():
    assert _cuts_per_minute(0, 10.0) == 0.0


def test_cuts_per_minute_none_duration_returns_none():
    assert _cuts_per_minute(4, None) is None


def test_cuts_per_minute_zero_duration_returns_none_not_divide_by_zero():
    assert _cuts_per_minute(4, 0.0) is None


def _speech(id_, start, end):
    return SimpleNamespace(id=id_, start_time=start, end_time=end)


def _silence(id_, start, end):
    return SimpleNamespace(id=id_, start_time=start, end_time=end)


def test_classify_cut_no_evidence_at_all():
    result = _classify_cut(5.0, [], [])
    assert result["classification"] == "no_speech_evidence"


def test_classify_cut_near_speech_boundary_start():
    seg = _speech(1, 5.1, 8.0)
    result = _classify_cut(5.0, [seg], [])  # |5.0-5.1|=0.1 <= tolerance
    assert result["classification"] == "near_speech_boundary"
    assert result["evidence_id"] == 1
    assert result["evidence_type"] == "speech_segment"


def test_classify_cut_near_speech_boundary_end():
    seg = _speech(1, 1.0, 4.9)
    result = _classify_cut(5.0, [seg], [])  # |5.0-4.9|=0.1 <= tolerance
    assert result["classification"] == "near_speech_boundary"


def test_classify_cut_exactly_at_tolerance_edge_counts_as_near():
    seg = _speech(1, 5.0 + CUT_NEAR_SPEECH_BOUNDARY_TOLERANCE_SECONDS, 8.0)
    result = _classify_cut(5.0, [seg], [])
    assert result["classification"] == "near_speech_boundary"


def test_classify_cut_during_speech_segment():
    seg = _speech(1, 4.0, 5.5)  # 4.0 < 5.0 < 5.5, and not near either edge (both > 0.3 away)
    result = _classify_cut(5.0, [seg], [])
    assert result["classification"] == "during_speech_segment"
    assert result["evidence_id"] == 1


def test_classify_cut_near_boundary_takes_priority_over_during_on_a_different_segment():
    far_during = _speech(1, 0.0, 20.0)  # 5.0 is technically "during" this one
    near_edge = _speech(2, 5.1, 30.0)   # but genuinely near THIS one's own start
    result = _classify_cut(5.0, [far_during, near_edge], [])
    assert result["classification"] == "near_speech_boundary"
    assert result["evidence_id"] == 2


def test_classify_cut_near_silence():
    sil = _silence(9, 5.8, 6.2)
    result = _classify_cut(6.0, [], [sil])  # 6.0 inside [5.8,6.2]
    assert result["classification"] == "near_silence"
    assert result["evidence_id"] == 9
    assert result["evidence_type"] == "audio_silence"


def test_classify_cut_within_silence_tolerance_of_the_edge():
    sil = _silence(9, 6.0 + CUT_NEAR_SILENCE_TOLERANCE_SECONDS, 8.0)
    result = _classify_cut(6.0, [], [sil])
    assert result["classification"] == "near_silence"


def test_classify_cut_unclassified_when_evidence_exists_but_not_nearby():
    seg = _speech(1, 100.0, 101.0)  # real evidence exists in the video, just nowhere near this cut
    result = _classify_cut(5.0, [seg], [])
    assert result["classification"] == "unclassified"
    assert result["evidence_id"] is None


# ---------------------------------------------------------------------------
# Full end-to-end DB tests.
# ---------------------------------------------------------------------------

async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def _make_analysis(db, user, duration=10.0):
    asset = Asset(
        user_id=user.id, original_filename="stage11_1_test.mp4", stored_filename="stage11_1_test_stored.mp4",
        file_path="uploads/stage11_1_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
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


async def _add_shots(db, va_id, ranges):
    for i, (s, e) in enumerate(ranges):
        db.add(Shot(video_analysis_id=va_id, scene_id=None, order=i, start_time=s, end_time=e,
                    certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
    await db.commit()


async def _add_scenes(db, va_id, ranges):
    for i, (s, e) in enumerate(ranges):
        db.add(Scene(video_analysis_id=va_id, order=i, start_time=s, end_time=e,
                     certainty="INFERRED", source="ai_reasoning", produced_by_pass="semantic_scene_construction_v1"))
    await db.commit()


async def _add_story_beats(db, va_id, ranges):
    for s, e in ranges:
        db.add(AnalysisAnnotation(video_analysis_id=va_id, shot_id=None, category=STORY_BEAT_CATEGORY,
                                   start_time=s, end_time=e, details={"boundary_status": "constructed"},
                                   certainty="INFERRED", source="story_beat_construction", produced_by_pass="story_beat_construction_v1"))
    await db.commit()


async def _cleanup(db, asset_id, rv_id):
    rv = await db.get(ReferenceVideo, rv_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


async def test_full_fixture_video_level_and_two_independent_phase_segmentations():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            await _add_shots(db, va_id, [(0, 2), (2, 5), (5, 6), (6, 10)])
            await _add_scenes(db, va_id, [(0, 5), (5, 10)])
            await _add_story_beats(db, va_id, [(0, 4), (4, 10)])

            result = await compute_and_persist_editing_rhythm(db, va_id)

            vl = result["video_level"]
            assert vl["shot_count"] == 4
            assert vl["average_shot_duration"] == pytest.approx(2.5)
            assert vl["cuts_per_minute"] == pytest.approx(18.0)
            assert vl["contributing_shot_ids"] is not None and len(vl["contributing_shot_ids"]) == 4

            scene_phases = result["scene_phases"]
            assert len(scene_phases) == 2
            assert scene_phases[0]["shot_count"] == 2
            assert scene_phases[0]["cuts_per_minute"] == pytest.approx(12.0)  # 1 cut / (5s/60)
            assert scene_phases[1]["shot_count"] == 2

            beat_phases = result["story_beat_phases"]
            assert len(beat_phases) == 2
            assert beat_phases[0]["cuts_per_minute"] == pytest.approx(15.0)  # 1 cut / (4s/60)
            assert beat_phases[1]["cuts_per_minute"] == pytest.approx(10.0)  # 1 cut / (6s/60)

            # Scene boundary (5.0) and Story Beat boundary (4.0) are genuinely different --
            # confirms the two segmentations are independent, never merged.
            assert scene_phases[0]["end_time"] != beat_phases[0]["end_time"]
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_cut_alignment_classifications_persisted_correctly():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            await _add_shots(db, va_id, [(0, 2), (2, 5), (5, 6), (6, 10)])
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=2.1, end_time=3.5,
                                  text="near the first cut", certainty="MEASURED", source="whisper"))
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=4.0, end_time=5.5,
                                  text="spans the second cut", certainty="MEASURED", source="whisper"))
            silence = AnalysisAnnotation(video_analysis_id=va_id, shot_id=None, category="audio_silence",
                                          start_time=5.8, end_time=6.2, details={}, certainty="MEASURED", source="ffmpeg")
            db.add(silence)
            await db.commit()

            result = await compute_and_persist_editing_rhythm(db, va_id)
            cuts = result["cut_alignments"]
            assert len(cuts) == 3
            assert cuts[0]["cut_timestamp"] == 2.0 and cuts[0]["classification"] == "near_speech_boundary"
            assert cuts[1]["cut_timestamp"] == 5.0 and cuts[1]["classification"] == "during_speech_segment"
            assert cuts[2]["cut_timestamp"] == 6.0 and cuts[2]["classification"] == "near_silence"
            assert cuts[2]["evidence_id"] == silence.id

            persisted = list((await db.execute(select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == va_id,
                AnalysisAnnotation.category == EDITING_CUT_ALIGNMENT_CATEGORY,
            ))).scalars().all())
            assert len(persisted) == 3
            assert all(row.certainty == "MEASURED" for row in persisted)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_provenance_contributing_shot_ids_and_partition_ids():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            await _add_shots(db, va_id, [(0, 5), (5, 10)])
            db.add(Scene(video_analysis_id=va_id, order=0, start_time=0.0, end_time=10.0,
                         certainty="INFERRED", source="ai_reasoning", produced_by_pass="semantic_scene_construction_v1"))
            await db.commit()
            scene_row = (await db.execute(select(Scene).where(Scene.video_analysis_id == va_id))).scalar_one()

            result = await compute_and_persist_editing_rhythm(db, va_id)
            phase = result["scene_phases"][0]
            assert phase["partition_id"] == scene_row.id
            assert phase["partition_type"] == "scene"
            assert set(phase["contributing_shot_ids"]) == {
                s.id for s in (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()
            }
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_idempotent_rerun_produces_no_duplicate_rows():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            await _add_shots(db, va_id, [(0, 2), (2, 5), (5, 6), (6, 10)])
            await _add_scenes(db, va_id, [(0, 5), (5, 10)])

            first = await compute_and_persist_editing_rhythm(db, va_id)
            second = await compute_and_persist_editing_rhythm(db, va_id)

            assert first == second  # deterministic -- byte-identical recomputation

            for category in (EDITING_RHYTHM_PROFILE_CATEGORY, EDITING_PACING_PHASE_CATEGORY, EDITING_CUT_ALIGNMENT_CATEGORY):
                rows = list((await db.execute(select(AnalysisAnnotation).where(
                    AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == category,
                ))).scalars().all())
                expected = 1 if category == EDITING_RHYTHM_PROFILE_CATEGORY else (2 if category == EDITING_PACING_PHASE_CATEGORY else 3)
                assert len(rows) == expected, f"{category} accumulated duplicates on rerun"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_no_mutation_of_source_evidence():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            await _add_shots(db, va_id, [(0, 5), (5, 10)])
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=1.0, end_time=2.0,
                                  text="untouched", certainty="MEASURED", source="whisper"))
            await db.commit()

            shots_before = [(s.id, s.start_time, s.end_time) for s in
                             (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()]
            speech_before = [(s.id, s.text) for s in
                              (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().all()]

            await compute_and_persist_editing_rhythm(db, va_id)

            shots_after = [(s.id, s.start_time, s.end_time) for s in
                            (await db.execute(select(Shot).where(Shot.video_analysis_id == va_id))).scalars().all()]
            speech_after = [(s.id, s.text) for s in
                             (await db.execute(select(SpeechSegment).where(SpeechSegment.video_analysis_id == va_id))).scalars().all()]
            assert shots_before == shots_after
            assert speech_before == speech_after
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_not_found_raises():
    async with _TestSessionLocal() as db:
        with pytest.raises(EditingRhythmError):
            await compute_and_persist_editing_rhythm(db, 999_999_999)


# ---------------------------------------------------------------------------
# Explicit edge cases named in the Stage 11.1 brief.
# ---------------------------------------------------------------------------

async def test_edge_case_no_shots():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            result = await compute_and_persist_editing_rhythm(db, va_id)
            assert result["video_level"]["shot_count"] == 0
            assert result["video_level"]["average_shot_duration"] is None
            assert result["video_level"]["cuts_per_minute"] == 0.0  # zero cuts is a real, honest zero
            assert result["cut_alignments"] == []
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_edge_case_one_shot():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            await _add_shots(db, va_id, [(0, 10)])
            result = await compute_and_persist_editing_rhythm(db, va_id)
            assert result["video_level"]["shot_count"] == 1
            assert result["video_level"]["shot_duration_stddev"] == 0.0
            assert result["video_level"]["cuts_per_minute"] == 0.0
            assert result["cut_alignments"] == []  # no boundary exists between one shot and itself
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_edge_case_very_short_video():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=0.6)
        try:
            await _add_shots(db, va_id, [(0.0, 0.3), (0.3, 0.6)])
            result = await compute_and_persist_editing_rhythm(db, va_id)
            assert result["video_level"]["shot_count"] == 2
            assert result["video_level"]["cuts_per_minute"] == pytest.approx(1 / (0.6 / 60))
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_edge_case_missing_transcript_and_silence_gives_honest_no_evidence():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            await _add_shots(db, va_id, [(0, 5), (5, 10)])
            result = await compute_and_persist_editing_rhythm(db, va_id)
            assert all(c["classification"] == "no_speech_evidence" for c in result["cut_alignments"])
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_edge_case_missing_transition_evidence_reports_zero_coverage():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            await _add_shots(db, va_id, [(0, 5), (5, 10)])
            result = await compute_and_persist_editing_rhythm(db, va_id)
            coverage = result["video_level"]["transition_evidence"]
            assert coverage["total_shot_boundaries"] == 1
            assert coverage["boundaries_with_transition_evidence"] == 0
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_edge_case_scene_but_no_accepted_story_beat_boundary():
    """Mirrors the real VA159 shape: Stage 10 ran, produced one whole-video Scene and one
    no_accepted_boundary Story Beat row (never zero rows) -- degrades to one honest phase each."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            await _add_shots(db, va_id, [(0, 5), (5, 10)])
            await _add_scenes(db, va_id, [(0, 10)])
            await _add_story_beats(db, va_id, [(0, 10)])  # the single no_accepted_boundary beat

            result = await compute_and_persist_editing_rhythm(db, va_id)
            assert len(result["scene_phases"]) == 1
            assert len(result["story_beat_phases"]) == 1
            assert result["story_beat_phases"][0]["shot_count"] == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_edge_case_story_beat_crossing_a_scene_boundary():
    """The real, observed VA5368 shape: a Story Beat's own range straddles a Scene cut. Both
    segmentations must still compute correctly and independently -- neither is forced to align."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_analysis(db, user, duration=10.0)
        try:
            await _add_shots(db, va_id, [(0, 3), (3, 6), (6, 10)])
            await _add_scenes(db, va_id, [(0, 5), (5, 10)])          # Scene cut at 5.0
            await _add_story_beats(db, va_id, [(0, 4), (4, 7), (7, 10)])  # Beat [4,7] straddles 5.0

            result = await compute_and_persist_editing_rhythm(db, va_id)
            assert len(result["scene_phases"]) == 2
            assert len(result["story_beat_phases"]) == 3
            straddling_beat = result["story_beat_phases"][1]
            assert (straddling_beat["start_time"], straddling_beat["end_time"]) == (4.0, 7.0)
            # Shot [3,6] starts inside the straddling beat's own range -- confirms it's assigned
            # there under the story_beat segmentation regardless of what the (different) Scene
            # segmentation does with the same shot.
            assert straddling_beat["shot_count"] == 1
        finally:
            await _cleanup(db, asset_id, rv_id)
