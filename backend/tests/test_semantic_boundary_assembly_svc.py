"""
Video Deconstructor — Stage 10.2A: Semantic Boundary Candidate + Evidence Assembly MVP.

Covers (letters match this phase's own task-required list):
  A. Exact video_analysis_id scoping -- never "latest," never another analysis's rows.
  B. No fallback to latest -- a nonexistent id produces an honest empty result, never another
     analysis's data.
  C. speech_gap candidates generated correctly from internal SpeechSegment gaps only.
  D. shot_boundary candidates generated correctly from adjacent Shot pairs only.
  E. silence_midpoint candidates generated correctly from audio_silence annotations.
  F. ocr_occurrence_head candidates generated from every OCR head regardless of confidence.
  G. Deduplication merges near-identical timestamps from DIFFERENT sources while preserving every
     original nomination.
  H. Deduplication does NOT merge two nominations further apart than the merge window.
  I. Original multilingual text (Urdu, non-ASCII) is preserved byte-for-byte, never translated.
  J. Graceful degradation: zero transcript -> zero speech_gap candidates, other sources unaffected.
  K. Graceful degradation: zero OCR/zero silence/zero shots -- same, only that source contributes
     nothing, no crash, no fabricated data.
  L. Bounded bundle shape -- exact keys, nothing extra, no full-history dump.
  M. No Scene row is ever created by this module.
  N. No existing evidence row is ever mutated by this module.
  O. Shot.scene_id remains untouched (never read or written by this module).
  P. Live validation against real RV5127 (video_analysis_id=5368) -- candidates near 12.0, 25.64,
     and 39.866667 exist, with original Urdu text preserved, and with NO semantic label anywhere
     in the output.
  Q. Live validation against real RV146 (video_analysis_id=159) -- the technical cut (~30.1) is
     exposed as a shot_boundary candidate with NO claim of being semantic.
  R. The overall output never contains any semantic/topic/confidence-in-meaning field anywhere.

Uses the same real-database, direct create_async_engine/async_sessionmaker convention as every
other test file in this suite (see test_scene_details_model.py, test_reference_video_pinned_
analysis.py) -- synthetic fixtures for A-O, and read-only queries against the real, already-
persisted RV146/RV5127 evidence for P-R (no mutation of that data occurs anywhere in this file).
"""
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.semantic_boundary_assembly_svc import (
    CANDIDATE_MERGE_WINDOW_SECONDS,
    assemble_semantic_boundary_candidates,
)

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)

# Real, already-persisted ids confirmed live against the dev database (see Stage 10.1/10.1B).
RV146_VIDEO_ANALYSIS_ID = 159
RV5127_VIDEO_ANALYSIS_ID = 5368


async def _existing_test_user(db) -> User:
    result = await db.execute(select(User).limit(1))
    return result.scalar_one()


async def _make_bare_analysis(db, user: User) -> tuple[int, int, int]:
    """One ReferenceVideo + VideoAnalysis with NO child evidence at all -- the base fixture every
    test below builds on by adding only the specific rows it needs."""
    asset = Asset(
        user_id=user.id, original_filename="semantic_boundary_test.mp4", stored_filename="semantic_boundary_test_stored.mp4",
        file_path="uploads/semantic_boundary_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()

    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=60.0)
    db.add(rv)
    await db.flush()

    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
    db.add(va)
    await db.commit()
    return rv.id, asset.id, va.id


async def _add_shots(db, va_id: int, ranges: list[tuple[float, float]]) -> list[int]:
    ids = []
    for i, (start, end) in enumerate(ranges):
        shot = Shot(
            video_analysis_id=va_id, scene_id=None, order=i, start_time=start, end_time=end,
            certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1",
        )
        db.add(shot)
        await db.flush()
        ids.append(shot.id)
    await db.commit()
    return ids


async def _add_speech_segments(db, va_id: int, segments: list[tuple[float, float, str]]) -> list[int]:
    ids = []
    for start, end, text in segments:
        seg = SpeechSegment(
            video_analysis_id=va_id, start_time=start, end_time=end, text=text,
            certainty="MEASURED", source="whisper", produced_by_pass="speech_analysis_v1",
        )
        db.add(seg)
        await db.flush()
        ids.append(seg.id)
    await db.commit()
    return ids


async def _add_ocr_heads(db, va_id: int, heads: list[tuple[float, str]]) -> list[int]:
    ids = []
    for start, text in heads:
        el = TextElement(
            video_analysis_id=va_id, text=text, x=0.1, y=0.1, width=0.2, height=0.1,
            start_time=start, end_time=start, certainty="MEASURED", confidence_score=0.9,
            occurrence_group_id=None,
        )
        db.add(el)
        await db.flush()
        ids.append(el.id)
    await db.commit()
    return ids


async def _add_silence(db, va_id: int, intervals: list[tuple[float, float]]) -> list[int]:
    ids = []
    for start, end in intervals:
        ann = AnalysisAnnotation(
            video_analysis_id=va_id, category="audio_silence", start_time=start, end_time=end,
            details={}, certainty="MEASURED", source="rms_energy", produced_by_pass="audio_structure_v1",
        )
        db.add(ann)
        await db.flush()
        ids.append(ann.id)
    await db.commit()
    return ids


async def _cleanup(db, asset_id: int, reference_video_id: int):
    rv = await db.get(ReferenceVideo, reference_video_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


# ---------------------------------------------------------------------------
# A. Exact video_analysis_id scoping.
# ---------------------------------------------------------------------------

async def test_exact_video_analysis_id_scoping_ignores_other_analyses():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv1_id, asset1_id, va1_id = await _make_bare_analysis(db, user)
        rv2_id, asset2_id, va2_id = await _make_bare_analysis(db, user)
        try:
            await _add_shots(db, va1_id, [(0.0, 10.0), (10.0, 20.0)])
            await _add_shots(db, va2_id, [(0.0, 5.0), (5.0, 9.0), (9.0, 15.0)])

            result1 = await assemble_semantic_boundary_candidates(db, va1_id)
            result2 = await assemble_semantic_boundary_candidates(db, va2_id)

            assert result1["evidence_inventory"]["shot_count"] == 2
            assert result2["evidence_inventory"]["shot_count"] == 3
            assert len(result1["candidates"]) == 1  # one boundary between two shots
            assert len(result2["candidates"]) == 2  # two boundaries between three shots
        finally:
            await _cleanup(db, asset1_id, rv1_id)
            await _cleanup(db, asset2_id, rv2_id)


# ---------------------------------------------------------------------------
# B. No fallback to latest -- nonexistent id -> honest empty result.
# ---------------------------------------------------------------------------

async def test_nonexistent_video_analysis_id_returns_empty_not_fallback():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_shots(db, va_id, [(0.0, 10.0), (10.0, 20.0)])

            nonexistent_id = va_id + 999999
            result = await assemble_semantic_boundary_candidates(db, nonexistent_id)

            assert result["video_analysis_id"] == nonexistent_id
            assert result["evidence_inventory"] == {
                "shot_count": 0, "speech_segment_count": 0,
                "ocr_occurrence_group_count": 0, "silence_count": 0,
            }
            assert result["candidates"] == []
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# C. speech_gap candidates from internal SpeechSegment gaps only.
# ---------------------------------------------------------------------------

async def test_speech_gap_candidates_are_internal_midpoints_only():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_speech_segments(db, va_id, [
                (0.0, 5.0, "first"), (6.0, 10.0, "second"), (11.0, 15.0, "third"),
            ])
            result = await assemble_semantic_boundary_candidates(db, va_id)

            timestamps = sorted(c["candidate_timestamp"] for c in result["candidates"])
            # Two INTERNAL gaps for three segments: midpoint(5.0,6.0)=5.5, midpoint(10.0,11.0)=10.5.
            # Never the very first start (0.0) or the very last end (15.0).
            assert timestamps == [5.5, 10.5]
            assert 0.0 not in timestamps
            assert 15.0 not in timestamps
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# D. shot_boundary candidates from adjacent Shot pairs only.
# ---------------------------------------------------------------------------

async def test_shot_boundary_candidates_exclude_outer_edges():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_shots(db, va_id, [(0.0, 10.0), (10.0, 25.0), (25.0, 40.0)])
            result = await assemble_semantic_boundary_candidates(db, va_id)

            timestamps = sorted(c["candidate_timestamp"] for c in result["candidates"])
            assert timestamps == [10.0, 25.0]
            assert 0.0 not in timestamps
            assert 40.0 not in timestamps
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# E. silence_midpoint candidates from audio_silence annotations.
# ---------------------------------------------------------------------------

async def test_silence_midpoint_candidates():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_silence(db, va_id, [(20.0, 22.0), (40.0, 40.6)])
            result = await assemble_semantic_boundary_candidates(db, va_id)

            timestamps = sorted(c["candidate_timestamp"] for c in result["candidates"])
            assert timestamps == [21.0, 40.3]
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# F. ocr_occurrence_head candidates regardless of confidence_score.
# ---------------------------------------------------------------------------

async def test_ocr_occurrence_head_candidates_include_low_confidence():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            heads = await _add_ocr_heads(db, va_id, [(3.0, "high conf head"), (50.0, "low conf head")])
            # Force one head's own confidence_score below the presentation-layer threshold
            # (0.50) used elsewhere in this codebase -- this module must NOT apply that filter.
            low_conf_head = await db.get(TextElement, heads[1])
            low_conf_head.confidence_score = 0.05
            await db.commit()

            result = await assemble_semantic_boundary_candidates(db, va_id)
            timestamps = sorted(c["candidate_timestamp"] for c in result["candidates"])
            assert timestamps == [3.0, 50.0]
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# G. Deduplication merges near-identical timestamps from different sources.
# ---------------------------------------------------------------------------

async def test_deduplication_merges_near_identical_cross_source_timestamps():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            # A shot boundary at 30.0 and an OCR head at 30.2 -- within the 0.5s merge window,
            # from two DIFFERENT source types.
            await _add_shots(db, va_id, [(0.0, 30.0), (30.0, 60.0)])
            await _add_ocr_heads(db, va_id, [(30.2, "caption near cut")])

            result = await assemble_semantic_boundary_candidates(db, va_id)
            assert len(result["candidates"]) == 1
            candidate = result["candidates"][0]
            source_types = {n["source_type"] for n in candidate["source_nominations"]}
            assert source_types == {"shot_boundary", "ocr_occurrence_head"}
            assert len(candidate["source_nominations"]) == 2
            # Representative timestamp is the mean of the two raw nominations.
            assert candidate["candidate_timestamp"] == (30.0 + 30.2) / 2.0
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# H. Deduplication does NOT merge timestamps further apart than the merge window.
# ---------------------------------------------------------------------------

async def test_deduplication_does_not_merge_distant_timestamps():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            gap = CANDIDATE_MERGE_WINDOW_SECONDS + 1.0
            await _add_shots(db, va_id, [(0.0, 30.0), (30.0, 60.0)])
            await _add_ocr_heads(db, va_id, [(30.0 + gap, "far caption")])

            result = await assemble_semantic_boundary_candidates(db, va_id)
            assert len(result["candidates"]) == 2
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# I. Original multilingual text preserved byte-for-byte.
# ---------------------------------------------------------------------------

async def test_original_urdu_text_preserved_verbatim():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            urdu_text = "لیکن وہی اورت اگر"
            await _add_speech_segments(db, va_id, [(0.0, 5.0, urdu_text), (6.0, 10.0, "second segment")])

            result = await assemble_semantic_boundary_candidates(db, va_id)
            candidate = result["candidates"][0]
            assert candidate["speech_before"]["text"] == urdu_text
            assert candidate["speech_after"]["text"] == "second segment"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# J. Graceful degradation: zero transcript.
# ---------------------------------------------------------------------------

async def test_zero_speech_segments_contributes_no_speech_gap_candidates():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_shots(db, va_id, [(0.0, 10.0), (10.0, 20.0)])
            result = await assemble_semantic_boundary_candidates(db, va_id)

            assert result["evidence_inventory"]["speech_segment_count"] == 0
            assert len(result["candidates"]) == 1  # only the one shot boundary
            assert result["candidates"][0]["speech_before"] is None
            assert result["candidates"][0]["speech_after"] is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# K. Graceful degradation: totally empty analysis (zero of everything).
# ---------------------------------------------------------------------------

async def test_totally_empty_analysis_produces_empty_honest_result():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            result = await assemble_semantic_boundary_candidates(db, va_id)
            assert result["candidates"] == []
            assert result["evidence_inventory"] == {
                "shot_count": 0, "speech_segment_count": 0,
                "ocr_occurrence_group_count": 0, "silence_count": 0,
            }
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# L. Bounded bundle shape -- exact keys, nothing extra.
# ---------------------------------------------------------------------------

async def test_bundle_shape_is_exactly_bounded():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            await _add_shots(db, va_id, [(0.0, 30.0), (30.0, 60.0)])
            result = await assemble_semantic_boundary_candidates(db, va_id)
            candidate = result["candidates"][0]

            expected_keys = {
                "candidate_timestamp", "source_nominations", "speech_before", "speech_after",
                "ocr_before", "ocr_after", "shots_overlapping", "nearby_annotations",
                "visual_objects_before", "visual_objects_after",
            }
            assert set(candidate.keys()) == expected_keys
            expected_annotation_categories = {
                "audio_silence", "transition_evidence", "transition_similarity_evidence",
                "recurring_text_element", "persistent_visual_element",
            }
            assert set(candidate["nearby_annotations"].keys()) == expected_annotation_categories
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# M / N / O. No Scene row created; no existing evidence mutated; Shot.scene_id untouched.
# ---------------------------------------------------------------------------

async def test_no_scene_created_no_evidence_mutated_no_scene_id_touched():
    from app.models.scene import Scene

    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await _make_bare_analysis(db, user)
        try:
            shot_ids = await _add_shots(db, va_id, [(0.0, 30.0), (30.0, 60.0)])
            speech_ids = await _add_speech_segments(db, va_id, [(0.0, 12.0, "before"), (13.0, 30.0, "after")])

            shot_before = await db.get(Shot, shot_ids[0])
            shot_snapshot = (shot_before.start_time, shot_before.end_time, shot_before.scene_id, shot_before.certainty)
            speech_before = await db.get(SpeechSegment, speech_ids[0])
            speech_snapshot = (speech_before.start_time, speech_before.end_time, speech_before.text)

            scenes_before = (await db.execute(select(Scene).where(Scene.video_analysis_id == va_id))).scalars().all()
            assert scenes_before == []

            await assemble_semantic_boundary_candidates(db, va_id)

            scenes_after = (await db.execute(select(Scene).where(Scene.video_analysis_id == va_id))).scalars().all()
            assert scenes_after == []  # no Scene row created

            shot_after = await db.get(Shot, shot_ids[0])
            assert (shot_after.start_time, shot_after.end_time, shot_after.scene_id, shot_after.certainty) == shot_snapshot
            assert shot_after.scene_id is None

            speech_after = await db.get(SpeechSegment, speech_ids[0])
            assert (speech_after.start_time, speech_after.end_time, speech_after.text) == speech_snapshot
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# P. Live validation against real RV5127 (video_analysis_id=5368).
# ---------------------------------------------------------------------------

async def test_real_rv5127_candidates_near_confirmed_semantic_boundaries():
    async with _TestSessionLocal() as db:
        result = await assemble_semantic_boundary_candidates(db, RV5127_VIDEO_ANALYSIS_ID)

        assert result["video_analysis_id"] == RV5127_VIDEO_ANALYSIS_ID
        assert result["evidence_inventory"]["speech_segment_count"] == 15
        assert len(result["candidates"]) > 0

        timestamps = [c["candidate_timestamp"] for c in result["candidates"]]

        def _has_candidate_near(target: float, tolerance: float = 1.5) -> bool:
            return any(abs(t - target) <= tolerance for t in timestamps)

        # The two real, human-confirmed semantic boundaries from Stage 10.1B (contrastive marker
        # at ~12.0, rhetorical echo at ~25.64) -- both entirely inside the technical Shot
        # [0.0, 39.866667], so only speech_gap/OCR sources could nominate them.
        assert _has_candidate_near(12.0)
        assert _has_candidate_near(25.64)
        # The real technical cut at ~39.866667 must ALSO be exposed as a plain candidate.
        assert _has_candidate_near(39.866667)

        # No semantic label anywhere in the output -- this module makes no meaning judgment.
        serialized = json.dumps(result, ensure_ascii=False, default=str)
        for forbidden in ("semantic", "topic", "is_boundary", "boundary_type", "meaning"):
            assert forbidden not in serialized.lower()

        # Original Urdu transcript text preserved verbatim somewhere in the bundles.
        found_original_urdu = any(
            (c["speech_before"] and "توٹی ہوئی اورت" in c["speech_before"]["text"])
            or (c["speech_after"] and "توٹی ہوئی اورت" in c["speech_after"]["text"])
            for c in result["candidates"]
        )
        assert found_original_urdu


# ---------------------------------------------------------------------------
# Q. Live validation against real RV146 (video_analysis_id=159).
# ---------------------------------------------------------------------------

async def test_real_rv146_technical_cut_exposed_without_semantic_claim():
    async with _TestSessionLocal() as db:
        result = await assemble_semantic_boundary_candidates(db, RV146_VIDEO_ANALYSIS_ID)

        assert result["video_analysis_id"] == RV146_VIDEO_ANALYSIS_ID
        assert result["evidence_inventory"]["shot_count"] == 2
        # RV146 has zero SpeechSegments anywhere (confirmed Stage 10.1) -- must degrade cleanly.
        assert result["evidence_inventory"]["speech_segment_count"] == 0

        timestamps = [c["candidate_timestamp"] for c in result["candidates"]]
        assert any(abs(t - 30.1) <= 1.0 for t in timestamps)

        matching = [c for c in result["candidates"] if abs(c["candidate_timestamp"] - 30.1) <= 1.0][0]
        assert matching["speech_before"] is None and matching["speech_after"] is None
        source_types = {n["source_type"] for n in matching["source_nominations"]}
        assert "shot_boundary" in source_types

        serialized = json.dumps(result, ensure_ascii=False, default=str)
        for forbidden in ("semantic", "topic", "is_boundary", "boundary_type", "meaning"):
            assert forbidden not in serialized.lower()


# ---------------------------------------------------------------------------
# R. No semantic/confidence-in-meaning field anywhere, across both real analyses.
# ---------------------------------------------------------------------------

async def test_no_semantic_or_llm_field_anywhere_in_real_outputs():
    async with _TestSessionLocal() as db:
        for va_id in (RV146_VIDEO_ANALYSIS_ID, RV5127_VIDEO_ANALYSIS_ID):
            result = await assemble_semantic_boundary_candidates(db, va_id)
            serialized = json.dumps(result, ensure_ascii=False, default=str).lower()
            for forbidden in (
                "confidence_in_meaning", "llm", "embedding", "discourse_marker",
                "topic_change", "narrative", "story_beat",
            ):
                assert forbidden not in serialized
