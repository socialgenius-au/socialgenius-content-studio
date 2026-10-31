"""
C1 — aggregate deconstruction read-model tests. Real-database convention; no LLM/Anthropic call and no
ffmpeg anywhere in this file (evidence rows are inserted directly). The reader is exercised against
(a) an analysis with NOTHING run, (b) a fully populated one, and (c) historical pre-acceptance-gate
retention data, which must never crash it.
"""
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.strategic_insight import StrategicInsight
from app.models.video_analysis import VideoAnalysis
from app.schemas.deconstruction_full import DeconstructionFullResponse
from app.services.deconstruction_aggregate_svc import (
    CURRENT_RETENTION_SCHEMA, LEGACY_RETENTION_SCHEMA, build_full_deconstruction,
)
from app.services.deconstruction_orchestrator_svc import OrchestrationNotFound, STAGES, STAGES_KEY
from tests.test_deconstruction_orchestrator_svc import _existing_test_user, cleanup, make_reference

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


def _add_shots(db, va_id):
    for i, (start, end) in enumerate([(0.0, 10.0), (10.0, 30.0)]):
        db.add(Shot(video_analysis_id=va_id, scene_id=None, order=i, start_time=start, end_time=end,
                    certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))


def _annotation(va_id, category, start, end, details, reasoning=None, certainty="INFERRED"):
    return AnalysisAnnotation(video_analysis_id=va_id, shot_id=None, category=category, start_time=start,
                              end_time=end, details=details, certainty=certainty, reasoning=reasoning, source="test")


async def test_analysis_with_nothing_run_returns_a_valid_honest_empty_structure():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            full = await build_full_deconstruction(db, user, rv_id)
            DeconstructionFullResponse.model_validate(full)  # the router's response schema accepts it as-is

            assert full["source"]["reference_video_id"] == rv_id
            assert full["video_analysis"]["id"] == va_id
            assert full["evidence"].shots == [] and full["evidence"].speech_segments == []
            assert full["evidence"].audio_structure is None
            assert full["structure"]["scenes"] == []
            assert full["editing_rhythm"] == {"profile": None, "pacing_phases": [], "cut_alignments": []}
            assert full["hook"] == {"window": None, "classification": None, "reasoning_attempts": []}
            assert full["retention"]["candidates"] == [] and full["retention"]["examined"] == []
            assert full["retention"]["accepted_devices"] == []
            assert full["strategic_insights"] == []
            assert [s["status"] for s in full["stages"]] == ["not_run"] * len(STAGES)
            assert full["orchestration"] is None
            # Nothing is fabricated: only the duration set by the fixture is "available".
            assert full["availability"]["technical"] is True
            assert [k for k, v in full["availability"].items() if v and k != "technical"] == []
            assert set(full["ai_configured"]) == {"semantic_scenes", "story_beats", "hook", "retention"}
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_populated_analysis_surfaces_every_section_with_its_reasoning_and_evidence():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            _add_shots(db, va_id)
            db.add(SpeechSegment(video_analysis_id=va_id, shot_id=None, start_time=1.0, end_time=3.0,
                                 text="hello there", certainty="MEASURED", source="whisper"))
            db.add(Scene(video_analysis_id=va_id, order=0, start_time=0.0, end_time=30.0, certainty="INFERRED", details={}))
            db.add(_annotation(va_id, "story_beat", 0.0, 30.0, {"boundary_status": "no_accepted_boundary"}))
            db.add(_annotation(va_id, "editing_rhythm_profile", 0.0, 30.0, {"shot_count": 2}, certainty="MEASURED"))
            db.add(_annotation(va_id, "editing_pacing_phase", 0.0, 10.0, {"partition_type": "scene"}, certainty="MEASURED"))
            db.add(_annotation(va_id, "hook_window", 0.0, 3.0, {"source_type": "shot", "start_time": 0.0, "end_time": 3.0}, certainty="MEASURED"))
            db.add(StrategicInsight(video_analysis_id=va_id, category="hook", description="Hook Window [0, 3]: primary_type=question",
                                    details={"primary_type": "question"}, certainty="INFERRED", reasoning="a spoken question"))
            db.add(_annotation(va_id, "hook_reasoning_attempt", 0.0, 3.0,
                               {"primary_type": "question", "probable_intent": "create_curiosity", "confidence": "high",
                                "provider": "anthropic", "model": "m", "prompt_version": "v1"}))
            await db.commit()

            full = await build_full_deconstruction(db, user, rv_id)
            DeconstructionFullResponse.model_validate(full)
            assert len(full["evidence"].shots) == 2 and full["evidence"].speech_segments[0].text == "hello there"
            assert len(full["structure"]["scenes"]) == 1
            assert full["editing_rhythm"]["profile"]["details"] == {"shot_count": 2}
            assert len(full["editing_rhythm"]["pacing_phases"]) == 1
            assert full["hook"]["window"]["start_time"] == 0.0
            assert full["hook"]["classification"]["details"]["primary_type"] == "question"
            assert full["hook"]["classification"]["reasoning"] == "a spoken question"
            assert full["hook"]["reasoning_attempts"][0]["probable_intent"] == "create_curiosity"
            assert [i["category"] for i in full["strategic_insights"]] == ["hook"]
            av = full["availability"]
            assert av["shots"] and av["speech"] and av["scenes"] and av["editing_rhythm"] and av["hook_window"] and av["hook_classification"]
            assert not av["retention_examined"] and not av["retention_accepted_devices"]
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_retention_separates_candidates_examined_and_accepted_and_zero_accepted_is_valid():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            _add_shots(db, va_id)  # 2 shots -> one deterministic shot-cut candidate at 10.0
            base = {"candidate_start": 10.0, "candidate_end": 10.0, "candidate_center": 10.0,
                    "source_nominations": [{"source_type": "shot_cut", "source_id": 1, "timestamp": 10.0}],
                    "device_type": "visual_change", "confidence": "medium", "evidence_references": {},
                    "provider": "anthropic", "model": "m", "prompt_version": "v3"}
            db.add(_annotation(va_id, "retention_reasoning_attempt", 10.0, 10.0,
                               {**base, "is_retention_device": False, "probable_attention_function": None},
                               reasoning="an ordinary cut"))
            await db.commit()

            retention = (await build_full_deconstruction(db, user, rv_id))["retention"]
            assert [c["source_types"] for c in retention["candidates"]] == [["shot_cut"]]
            assert len(retention["examined"]) == 1
            examined = retention["examined"][0]
            assert examined["is_retention_device"] is False and examined["probable_attention_function"] is None
            assert examined["device_type"] == "visual_change" and examined["schema"] == CURRENT_RETENTION_SCHEMA
            assert examined["reasoning"] == "an ordinary cut"
            assert retention["accepted_devices"] == []  # zero accepted devices: valid, complete data
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_accepted_devices_carry_their_function_and_link_to_the_producing_attempt():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            attempt = _annotation(va_id, "retention_reasoning_attempt", 10.0, 10.0, {
                "candidate_start": 10.0, "candidate_end": 10.0, "device_type": "text_reveal", "is_retention_device": True,
                "probable_attention_function": "renew_attention", "confidence": "medium", "prompt_version": "v3"}, reasoning="new headline")
            db.add(attempt)
            await db.flush()
            db.add(_annotation(va_id, "retention_device", 10.0, 10.0, {
                "device_type": "text_reveal", "probable_attention_function": "renew_attention",
                "reasoning_attempt_id": attempt.id, "confidence": "medium", "prompt_version": "v3"}, reasoning="new headline"))
            await db.commit()

            retention = (await build_full_deconstruction(db, user, rv_id))["retention"]
            device = retention["accepted_devices"][0]
            assert device["probable_attention_function"] == "renew_attention"
            assert device["reasoning_attempt_id"] == attempt.id and device["schema"] == CURRENT_RETENTION_SCHEMA
            assert retention["examined"][0]["is_retention_device"] is True
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_historical_pre_acceptance_gate_retention_data_does_not_crash_and_is_never_reinterpreted():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            # Exactly the pre-gate shape (prompt v1/v2): no is_retention_device, no probable_attention_function.
            legacy = {"candidate_start": 5.0, "candidate_end": 5.0, "device_type": "text_reveal", "confidence": "low",
                      "evidence_references": {}, "prompt_version": "v2", "source_nominations": []}
            db.add(_annotation(va_id, "retention_reasoning_attempt", 5.0, 5.0, legacy, reasoning="old reasoning"))
            db.add(_annotation(va_id, "retention_device", 5.0, 5.0,
                               {"device_type": "text_reveal", "confidence": "low", "reasoning_attempt_id": 1, "prompt_version": "v2"}))
            await db.commit()

            retention = (await build_full_deconstruction(db, user, rv_id))["retention"]
            examined = retention["examined"][0]
            assert examined["is_retention_device"] is None  # NOT False and NOT True: no decision was ever made
            assert examined["schema"] == LEGACY_RETENTION_SCHEMA
            assert retention["legacy_attempts"] == 1 and retention["attempts_total"] == 1
            assert retention["accepted_devices"][0]["schema"] == LEGACY_RETENTION_SCHEMA
            assert retention["accepted_devices"][0]["probable_attention_function"] is None
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_the_latest_attempt_per_candidate_wins_and_a_v3_rerun_supersedes_a_legacy_attempt():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            db.add(_annotation(va_id, "retention_reasoning_attempt", 5.0, 5.0,
                               {"candidate_start": 5.0, "candidate_end": 5.0, "device_type": "text_reveal", "prompt_version": "v2"}))
            await db.commit()
            db.add(_annotation(va_id, "retention_reasoning_attempt", 5.0, 5.0,
                               {"candidate_start": 5.0, "candidate_end": 5.0, "device_type": "text_reveal", "prompt_version": "v3",
                                "is_retention_device": False, "probable_attention_function": None}))
            await db.commit()
            retention = (await build_full_deconstruction(db, user, rv_id))["retention"]
            assert len(retention["examined"]) == 1 and retention["attempts_total"] == 2
            assert retention["examined"][0]["schema"] == CURRENT_RETENTION_SCHEMA
            assert retention["examined"][0]["is_retention_device"] is False
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_stage_status_reflects_passes_and_the_last_orchestration():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user, va_status="complete", pass_status={
            "technical_probe": "complete", "scene_segmentation": "complete", "text_analysis": "failed",
            "text_analysis_error": "ocr failed",
            "c1_orchestration": {"status": "partial", "started_at": "2026-01-01T00:00:00+00:00", "finished_at": "2026-01-01T00:05:00+00:00"},
            STAGES_KEY: {"visual_objects": {"status": "blocked", "reason": "dependency 'visual_evidence' is not_run"}},
        })
        try:
            full = await build_full_deconstruction(db, user, rv_id)
            by_key = {s["key"]: s for s in full["stages"]}
            assert by_key["scene_segmentation"]["status"] == "complete"
            assert by_key["text_analysis"]["status"] == "failed" and by_key["text_analysis"]["error"] == "ocr failed"
            assert by_key["visual_objects"]["status"] == "blocked"
            assert full["orchestration"]["status"] == "partial"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_pinned_video_analysis_id_selects_that_exact_version_and_a_foreign_id_is_not_found():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, first_va = await make_reference(db, user)
        other_rv, other_asset, other_va = await make_reference(db, user)
        try:
            second = VideoAnalysis(reference_video_id=rv_id, status="pending", pass_status={})
            db.add(second)
            await db.commit()
            assert (await build_full_deconstruction(db, user, rv_id))["video_analysis"]["id"] == second.id  # default: latest
            pinned = await build_full_deconstruction(db, user, rv_id, video_analysis_id=first_va)
            assert pinned["video_analysis"]["id"] == first_va
            with pytest.raises(OrchestrationNotFound):
                await build_full_deconstruction(db, user, rv_id, video_analysis_id=other_va)  # belongs to a DIFFERENT video
        finally:
            await cleanup(db, asset_id, rv_id)
            await cleanup(db, other_asset, other_rv)


async def test_unknown_or_other_users_reference_video_is_not_found():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        with pytest.raises(OrchestrationNotFound):
            await build_full_deconstruction(db, user, 999_999_999)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            with pytest.raises(OrchestrationNotFound):
                await build_full_deconstruction(db, SimpleNamespace(id=-424242), rv_id)
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_the_aggregate_read_is_strictly_read_only():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user, pass_status={"technical_probe": "complete"})
        try:
            _add_shots(db, va_id)
            db.add(_annotation(va_id, "hook_window", 0.0, 3.0, {"start_time": 0.0, "end_time": 3.0}))
            await db.commit()

            async def snapshot():
                ann = (await db.execute(select(func.count()).select_from(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == va_id))).scalar_one()
                ins = (await db.execute(select(func.count()).select_from(StrategicInsight).where(StrategicInsight.video_analysis_id == va_id))).scalar_one()
                shots = (await db.execute(select(func.count()).select_from(Shot).where(Shot.video_analysis_id == va_id))).scalar_one()
                ps = (await db.execute(select(VideoAnalysis.pass_status).where(VideoAnalysis.id == va_id).execution_options(populate_existing=True))).scalar_one()
                return ann, ins, shots, dict(ps)

            before = await snapshot()
            await build_full_deconstruction(db, user, rv_id)
            await build_full_deconstruction(db, user, rv_id)
            assert await snapshot() == before
        finally:
            await cleanup(db, asset_id, rv_id)
