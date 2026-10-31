"""
C1 — deconstruction orchestrator tests. Real-database convention (same as
test_stage10_deconstruction_svc.py). The 19 stage runners are replaced with recording fakes, so NO
ffmpeg, OCR, Whisper or Anthropic call happens anywhere in this file; the fakes mimic what the real
handlers/services do to `pass_status` (complete / failed) so the orchestrator's own logic -- ordering,
blocking, skipping, rerun policy, claims -- is what is actually under test.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services import deconstruction_orchestrator_svc as orch
from app.services.deconstruction_orchestrator_svc import (
    ORCHESTRATION_KEY, STAGES, STAGE_BY_KEY, STAGES_KEY, OrchestrationConflict, OrchestrationNotFound,
    RunContext, claim_orchestration, compute_stage_statuses, default_runners, run_deconstruction,
)

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)

AI_SETTINGS = ("SEMANTIC_REASONER_PROVIDER", "STORY_BEAT_REASONER_PROVIDER", "HOOK_REASONER_PROVIDER", "RETENTION_REASONER_PROVIDER")
AI_STAGES = {"scene_story_beats", "hook_classification", "retention_devices"}


@pytest.fixture
def ai_on(monkeypatch):
    for name in AI_SETTINGS:
        monkeypatch.setattr(settings, name, "anthropic")


@pytest.fixture
def ai_off(monkeypatch):
    for name in AI_SETTINGS:
        monkeypatch.setattr(settings, name, "")


async def _existing_test_user(db) -> User:
    return (await db.execute(select(User).limit(1))).scalar_one()


async def make_reference(db, user, *, va_status="pending", pass_status=None, duration=30.0):
    asset = Asset(
        user_id=user.id, original_filename="c1_orchestrator_test.mp4", stored_filename="c1_orchestrator_test_stored.mp4",
        file_path="uploads/c1_orchestrator_test.mp4", file_type="video", mime_type="video/mp4", file_size=4096,
    )
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=duration)
    db.add(rv)
    await db.flush()
    va = VideoAnalysis(reference_video_id=rv.id, status=va_status, pass_status=pass_status or {})
    db.add(va)
    await db.commit()
    return rv.id, asset.id, va.id


async def cleanup(db, asset_id, rv_id):
    await db.rollback()
    rv = await db.get(ReferenceVideo, rv_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


async def latest_pass_status(db, rv_id) -> dict:
    va = (await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id)
                           .order_by(VideoAnalysis.id.desc()).limit(1).execution_options(populate_existing=True))).scalars().first()
    return dict(va.pass_status or {})


def fake_runners(calls, *, pass_fail=(), raise_in=(), summaries=None):
    """One recording fake per stage. Endpoint-kind fakes write pass_status[key] the way the real
    handlers do ("complete", or "failed" + "<key>_error"); service-kind fakes return a summary."""
    summaries = summaries or {}
    runners = {}
    for spec in STAGES:
        async def run(ctx: RunContext, spec=spec):
            calls.append(spec.key)
            if spec.key in raise_in:
                raise raise_in[spec.key] if isinstance(raise_in, dict) else RuntimeError("boom")
            if spec.kind == "endpoint":
                failed = spec.key in pass_fail
                patch = {spec.key: "failed" if failed else "complete"}
                if failed:
                    patch[f"{spec.key}_error"] = "simulated pass failure"
                    if spec.key == "technical_probe":
                        patch["error"] = "simulated pass failure"
                await orch._patch_pass_status(ctx.db, ctx.video_analysis_id, patch)
                return None
            return summaries.get(spec.key, {"ok": True})
        runners[spec.key] = run
    return runners


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

def test_registry_is_topological_complete_and_covers_every_existing_stage():
    assert len(STAGES) == 19
    seen = set()
    for spec in STAGES:
        for dep in spec.depends_on + spec.after:
            assert dep in seen, f"{spec.key} depends on {dep} which is not defined before it"
        seen.add(spec.key)
    assert {s.key for s in STAGES if s.ai_settings} == AI_STAGES
    # The default runners must cover EXACTLY the registry (no stage silently unwired, none invented).
    assert set(default_runners()) == set(STAGE_BY_KEY)


def test_hard_dependencies_match_the_prerequisites_the_real_handlers_enforce():
    """Mirrors the `pass_status.get(...) != "complete"` gates read out of reference_videos.py."""
    expected = {
        "scene_segmentation": ("technical_probe",), "visual_evidence": ("scene_segmentation",),
        "text_analysis": ("visual_evidence",), "speech_analysis": ("technical_probe",),
        "audio_structure": ("technical_probe",), "visual_objects": ("visual_evidence",),
        "visual_persistence": ("visual_objects",), "visual_composition": ("visual_persistence",),
        "global_motion_evidence": ("scene_segmentation",), "transition_evidence": ("scene_segmentation",),
        "local_motion_evidence": ("scene_segmentation",), "local_motion_dynamics": ("scene_segmentation",),
        "transition_similarity_evidence": ("scene_segmentation",),
    }
    for key, deps in expected.items():
        assert STAGE_BY_KEY[key].depends_on == deps
    assert STAGE_BY_KEY["technical_probe"].depends_on == ()


# ---------------------------------------------------------------------------
# Status (pure)
# ---------------------------------------------------------------------------

def test_status_of_an_untouched_analysis_is_all_not_run():
    statuses = compute_stage_statuses({})
    assert [s["key"] for s in statuses] == [s.key for s in STAGES]
    assert all(s["status"] == "not_run" for s in statuses)


def test_status_merges_the_passes_own_authoritative_state_with_orchestration_records():
    ps = {
        "technical_probe": "complete", "text_analysis": "failed", "text_analysis_error": "ocr exploded",
        STAGES_KEY: {"visual_objects": {"status": "blocked", "reason": "dependency 'visual_evidence' is failed"}},
    }
    by_key = {s["key"]: s for s in compute_stage_statuses(ps)}
    assert by_key["technical_probe"]["status"] == "complete"
    assert by_key["text_analysis"]["status"] == "failed" and by_key["text_analysis"]["error"] == "ocr exploded"
    assert by_key["visual_objects"]["status"] == "blocked" and "visual_evidence" in by_key["visual_objects"]["reason"]


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

async def test_successful_orchestration_runs_every_stage_once_in_dependency_order(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            calls = []
            report = await run_deconstruction(db, user, rv_id, runners=fake_runners(calls))
            assert report["overall_status"] == "complete"
            assert calls == [s.key for s in STAGES]  # each exactly once, in registry (topological) order
            position = {k: i for i, k in enumerate(calls)}
            for spec in STAGES:
                for dep in spec.depends_on + spec.after:
                    assert position[dep] < position[spec.key]
            assert {s["status"] for s in report["stages"]} == {"complete"}
            ps = await latest_pass_status(db, rv_id)
            assert ps[ORCHESTRATION_KEY]["status"] == "complete" and ps[ORCHESTRATION_KEY]["finished_at"]
            assert set(ps[STAGES_KEY]) == {s.key for s in STAGES}
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_dependency_failure_blocks_dependents_but_not_independent_branches(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            calls = []
            report = await run_deconstruction(db, user, rv_id, runners=fake_runners(calls, pass_fail={"visual_evidence"}))
            by_key = {s["key"]: s for s in report["stages"]}
            assert by_key["visual_evidence"]["status"] == "failed"
            for blocked in ("text_analysis", "visual_objects", "visual_persistence", "visual_composition"):
                assert by_key[blocked]["status"] == "blocked", blocked
                assert blocked not in calls  # never run, not silently skipped past
            for independent in ("speech_analysis", "audio_structure", "global_motion_evidence", "transition_evidence"):
                assert by_key[independent]["status"] == "complete", independent
            assert report["overall_status"] == "partial"
            # An ORDER-ONLY input that failed is reported, not hidden.
            assert any("visual_evidence" in d for d in by_key["retention_devices"]["degraded_inputs"])
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_technical_probe_failure_stops_everything_downstream(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            calls = []
            report = await run_deconstruction(db, user, rv_id, runners=fake_runners(calls, pass_fail={"technical_probe"}))
            assert report["overall_status"] == "failed"
            assert calls == ["technical_probe"]
            statuses = {s["key"]: s["status"] for s in report["stages"]}
            assert statuses["scene_segmentation"] == "blocked" and statuses["hook_window"] == "blocked"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_raising_stage_is_reported_and_the_run_continues(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            calls = []
            report = await run_deconstruction(
                db, user, rv_id, runners=fake_runners(calls, raise_in={"editing_rhythm": RuntimeError("rhythm exploded")}))
            by_key = {s["key"]: s for s in report["stages"]}
            assert by_key["editing_rhythm"]["status"] == "failed" and "rhythm exploded" in by_key["editing_rhythm"]["error"]
            assert by_key["hook_window"]["status"] == "complete"  # independent of editing_rhythm
            assert by_key["retention_devices"]["status"] == "complete"  # only ORDER-after editing_rhythm
            assert any("editing_rhythm" in d for d in by_key["retention_devices"]["degraded_inputs"])
            assert report["overall_status"] == "partial"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_stage_failure_rollback_does_not_break_later_stages_that_read_the_user(ai_on):
    """Regression: `rollback()` expires the session's loaded `User`, and the real handlers read
    `user.id`. Without re-loading it, every stage after a failure would crash with MissingGreenlet
    (in the real app `current_user` shares the request's session)."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)  # a real, session-attached instance
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            calls = []
            runners = fake_runners(calls, raise_in={"editing_rhythm": RuntimeError("rhythm exploded")})
            seen = {}

            async def reads_user(ctx: RunContext):
                calls.append("hook_window")
                seen["user_id"] = ctx.user.id  # would raise MissingGreenlet if `user` were left expired
                return {"ok": True}

            runners["hook_window"] = reads_user
            report = await run_deconstruction(db, user, rv_id, runners=runners)
            assert seen["user_id"] == user.id
            assert next(s for s in report["stages"] if s["key"] == "hook_window")["status"] == "complete"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_http_exception_from_a_handler_is_reported_with_its_status(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            calls = []
            report = await run_deconstruction(
                db, user, rv_id, runners=fake_runners(calls, raise_in={"speech_analysis": HTTPException(status_code=409, detail="in progress")}))
            speech = next(s for s in report["stages"] if s["key"] == "speech_analysis")
            assert speech["status"] == "failed" and speech["error"] == "HTTP 409: in progress"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_rerun_skips_complete_passes_retries_failed_ones_and_does_not_repeat_paid_stages(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            first = []
            await run_deconstruction(db, user, rv_id, runners=fake_runners(first, pass_fail={"text_analysis"}))
            assert first.count("text_analysis") == 1

            second = []
            report = await run_deconstruction(db, user, rv_id, runners=fake_runners(second))
            endpoint_keys = {s.key for s in STAGES if s.kind == "endpoint"}
            # Only the previously-failed pass is retried; every completed pass is left alone.
            assert [k for k in second if k in endpoint_keys] == ["text_analysis"]
            # Free deterministic/idempotent stages recompute; PAID stages 11.3/11.4 do not repeat.
            assert {"scene_story_beats", "editing_rhythm", "hook_window"} <= set(second)
            assert "hook_classification" not in second and "retention_devices" not in second
            by_key = {s["key"]: s for s in report["stages"]}
            assert by_key["hook_classification"]["status"] == "already_complete"
            assert by_key["technical_probe"]["status"] == "complete"  # own authoritative state
            assert report["overall_status"] == "complete"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_force_ai_reruns_the_paid_stages(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            await run_deconstruction(db, user, rv_id, runners=fake_runners([]))
            again = []
            await run_deconstruction(db, user, rv_id, runners=fake_runners(again), force_ai=True)
            assert "hook_classification" in again and "retention_devices" in again
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_unconfigured_ai_stages_are_skipped_not_failed_and_never_called(ai_off):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            calls = []
            report = await run_deconstruction(db, user, rv_id, runners=fake_runners(calls))
            by_key = {s["key"]: s for s in report["stages"]}
            for key in AI_STAGES:
                assert by_key[key]["status"] == "skipped" and "not configured" in by_key[key]["reason"]
                assert key not in calls  # no paid call is ever made for an unconfigured stage
            # Free deterministic stages still ran, and skipped-by-config counts as a successful run.
            assert by_key["editing_rhythm"]["status"] == "complete" and by_key["hook_window"]["status"] == "complete"
            assert report["overall_status"] == "complete"
            assert any("scene_story_beats (skipped)" in d for d in by_key["editing_rhythm"]["degraded_inputs"])
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_zero_retention_devices_is_a_successful_stage(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            runners = fake_runners([], summaries={"retention_devices": {"candidates_examined": 17, "accepted_devices": 0}})
            report = await run_deconstruction(db, user, rv_id, runners=runners)
            retention = next(s for s in report["stages"] if s["key"] == "retention_devices")
            assert retention["status"] == "complete"
            assert retention["summary"] == {"candidates_examined": 17, "accepted_devices": 0}
            assert report["overall_status"] == "complete"
        finally:
            await cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Derived-stage rerun policy: results-exist / inputs-changed (provenance-safe)
# ---------------------------------------------------------------------------

async def test_a_second_run_with_nothing_changed_does_no_processing_at_all(ai_on):
    """No duplicate/destructive processing: after a complete run, running again invokes NO runner."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            await run_deconstruction(db, user, rv_id, runners=fake_runners([]))
            again = []
            report = await run_deconstruction(db, user, rv_id, runners=fake_runners(again))
            assert again == []
            assert {s["status"] for s in report["stages"]} <= {"complete", "already_complete"}
            assert report["overall_status"] == "complete"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_derived_stages_rerun_only_when_an_upstream_stage_was_freshly_recomputed(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            await run_deconstruction(db, user, rv_id, runners=fake_runners([], pass_fail={"speech_analysis"}))
            second = []
            report = await run_deconstruction(db, user, rv_id, runners=fake_runners(second))
            # speech_analysis was freshly recomputed, so exactly the derived stages that read speech re-run...
            assert second == ["speech_analysis", "scene_story_beats", "editing_rhythm", "hook_window"]
            by_key = {s["key"]: s for s in report["stages"]}
            # ...while the paid stages stay put even though their upstream changed (never automatic).
            assert by_key["hook_classification"]["status"] == "already_complete"
            assert by_key["retention_devices"]["status"] == "already_complete"
            assert "paid AI stage" in by_key["retention_devices"]["reason"]
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_existing_results_are_left_untouched_even_with_no_orchestration_record(ai_on):
    """A video processed MANUALLY (before C1 existed) has complete passes and persisted derived rows but
    no c1 record. Re-running a delete-then-replace stage would change row ids other results reference
    (e.g. a hook classification's hook_window_id), so nothing must run."""
    from app.models.analysis_annotation import AnalysisAnnotation
    from app.models.scene import Scene
    from app.models.strategic_insight import StrategicInsight

    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        manual = {s.key: "complete" for s in STAGES if s.kind == "endpoint"}
        rv_id, asset_id, va_id = await make_reference(db, user, va_status="complete", pass_status=manual)
        try:
            db.add(Scene(video_analysis_id=va_id, order=0, start_time=0.0, end_time=30.0, certainty="INFERRED", details={}))
            for cat in ("editing_rhythm_profile", "hook_window"):
                db.add(AnalysisAnnotation(video_analysis_id=va_id, shot_id=None, category=cat, start_time=0.0, end_time=3.0,
                                          details={}, certainty="MEASURED", source="test"))
            db.add(StrategicInsight(video_analysis_id=va_id, category="hook", description="d", details={}, certainty="INFERRED"))
            # A LEGACY (pre-acceptance-gate) retention attempt still counts as existing: upgrading it is a
            # paid re-run that must be an explicit force_ai, never a silent side effect.
            db.add(AnalysisAnnotation(video_analysis_id=va_id, shot_id=None, category="retention_reasoning_attempt",
                                      start_time=5.0, end_time=5.0, details={"device_type": "text_reveal", "prompt_version": "v2"},
                                      certainty="INFERRED", source="test"))
            await db.commit()
            hook_window_id = (await db.execute(select(AnalysisAnnotation.id).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "hook_window"))).scalar_one()

            calls = []
            report = await run_deconstruction(db, user, rv_id, runners=fake_runners(calls))
            assert calls == []
            # Stage 3-9 passes report their own authoritative state ("complete"); every DERIVED stage
            # reports "already_complete" -- both mean "done, nothing was re-run".
            assert {s["status"] for s in report["stages"]} <= {"already_complete", "complete"}
            assert {s["status"] for s in report["stages"] if s["kind"] == "service"} == {"already_complete"}
            assert report["overall_status"] == "complete"
            still = (await db.execute(select(AnalysisAnnotation.id).where(
                AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == "hook_window"))).scalar_one()
            assert still == hook_window_id  # provenance target untouched
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_existing_results_report_already_complete_even_when_the_ai_reasoner_is_not_configured(ai_off):
    from app.models.analysis_annotation import AnalysisAnnotation

    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        manual = {s.key: "complete" for s in STAGES if s.kind == "endpoint"}
        rv_id, asset_id, va_id = await make_reference(db, user, va_status="complete", pass_status=manual)
        try:
            db.add(AnalysisAnnotation(video_analysis_id=va_id, shot_id=None, category="retention_reasoning_attempt",
                                      start_time=5.0, end_time=5.0, details={"prompt_version": "v3", "is_retention_device": False},
                                      certainty="INFERRED", source="test"))
            await db.commit()
            report = await run_deconstruction(db, user, rv_id, runners=fake_runners([]))
            by_key = {s["key"]: s for s in report["stages"]}
            assert by_key["retention_devices"]["status"] == "already_complete"  # data exists: not "skipped"
            assert by_key["hook_classification"]["status"] == "skipped"  # nothing exists and AI is off
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_has_existing_results_reads_each_derived_stage_from_the_data_itself():
    from app.models.analysis_annotation import AnalysisAnnotation
    from app.models.scene import Scene
    from app.models.strategic_insight import StrategicInsight

    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        keys = ("scene_story_beats", "editing_rhythm", "hook_window", "hook_classification", "retention_devices")
        try:
            assert [await orch._has_existing_results(db, k, va_id) for k in keys] == [False] * 5
            db.add(Scene(video_analysis_id=va_id, order=0, start_time=0.0, end_time=30.0, certainty="INFERRED", details={}))
            for cat in ("editing_rhythm_profile", "hook_window", "retention_device"):
                db.add(AnalysisAnnotation(video_analysis_id=va_id, shot_id=None, category=cat, start_time=0.0, end_time=1.0,
                                          details={}, certainty="INFERRED", source="test"))
            db.add(StrategicInsight(video_analysis_id=va_id, category="hook", description="d", details={}, certainty="INFERRED"))
            await db.commit()
            assert [await orch._has_existing_results(db, k, va_id) for k in keys] == [True] * 5
            assert await orch._has_existing_results(db, "technical_probe", va_id) is False  # endpoint stages: own pass_status
        finally:
            await cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Claims (no overlapping runs)
# ---------------------------------------------------------------------------

async def test_a_running_claim_blocks_a_second_run_and_a_stale_claim_can_be_reclaimed(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            await claim_orchestration(db, user, rv_id)
            with pytest.raises(OrchestrationConflict):
                await claim_orchestration(db, user, rv_id)
            calls = []
            with pytest.raises(OrchestrationConflict):
                await run_deconstruction(db, user, rv_id, runners=fake_runners(calls))
            assert calls == []  # the refused run did no work at all

            await orch._patch_pass_status(db, va_id, {ORCHESTRATION_KEY: {"status": "running", "started_at": "2020-01-01T00:00:00+00:00"}})
            reclaimed = await claim_orchestration(db, user, rv_id)
            assert reclaimed.id == va_id
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_the_claim_is_released_even_when_a_stage_blows_up_the_run(ai_on):
    """A failing stage never leaves the video stuck 'running'."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            await run_deconstruction(db, user, rv_id, runners=fake_runners([], raise_in={"hook_window": RuntimeError("x")}))
            ps = await latest_pass_status(db, rv_id)
            assert ps[ORCHESTRATION_KEY]["status"] == "partial"
            await claim_orchestration(db, user, rv_id)  # would raise OrchestrationConflict if still 'running'
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_unknown_or_other_users_reference_video_is_not_found(ai_on):
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        with pytest.raises(OrchestrationNotFound):
            await run_deconstruction(db, user, 999_999_999, runners=fake_runners([]))
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            stranger = SimpleNamespace(id=-424242)
            with pytest.raises(OrchestrationNotFound):
                await claim_orchestration(db, stranger, rv_id)
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_stage3_retry_that_mints_a_new_analysis_moves_the_run_onto_the_new_row(ai_on):
    """Stage 3's own rule: retrying after failure creates a NEW VideoAnalysis. Later stages and the
    recorded orchestration state must follow it, and the old row must not be left 'running'."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, old_va = await make_reference(
            db, user, va_status="failed", pass_status={"technical_probe": "failed", "error": "earlier failure"})
        try:
            calls = []
            runners = fake_runners(calls)

            async def probe_mints_new_row(ctx: RunContext):
                calls.append("technical_probe")
                new = VideoAnalysis(reference_video_id=ctx.reference_video_id, status="complete", pass_status={"technical_probe": "complete"})
                ctx.db.add(new)
                await ctx.db.commit()

            runners["technical_probe"] = probe_mints_new_row
            report = await run_deconstruction(db, user, rv_id, runners=runners)
            assert report["overall_status"] == "complete"
            rows = list((await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id)
                                          .order_by(VideoAnalysis.id).execution_options(populate_existing=True))).scalars().all())
            assert len(rows) == 2
            old, new = rows
            assert old.id == old_va
            assert (old.pass_status[ORCHESTRATION_KEY]["status"]) == "complete"  # released, not stuck running
            assert new.pass_status[ORCHESTRATION_KEY]["status"] == "complete"
            assert new.pass_status["scene_segmentation"] == "complete"  # later stages ran against the NEW row
            assert "scene_segmentation" not in old.pass_status
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_background_launcher_completes_a_claimed_run_in_its_own_session(monkeypatch, ai_on):
    import app.database as database
    monkeypatch.setattr(database, "AsyncSessionLocal", _TestSessionLocal)  # NullPool engine, like every test here
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)
        try:
            await claim_orchestration(db, user, rv_id)
            calls = []
            task = orch.start_background_deconstruction(user.id, rv_id, runners=fake_runners(calls))
            await task
            assert calls == [s.key for s in STAGES]
            ps = await latest_pass_status(db, rv_id)
            assert ps[ORCHESTRATION_KEY]["status"] == "complete"
        finally:
            await cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Default runners really are thin adapters over the existing handlers/services
# ---------------------------------------------------------------------------

async def test_default_endpoint_runners_call_the_real_handlers_with_db_and_user_keywords(monkeypatch):
    from app.routers import reference_videos as r
    structure, speech = AsyncMock(), AsyncMock()
    monkeypatch.setattr(r, "analyze_reference_video_structure", structure)
    monkeypatch.setattr(r, "analyze_reference_video_speech", speech)
    runners = default_runners()
    ctx = SimpleNamespace(db=object(), user=object(), reference_video_id=77, video_analysis_id=5)
    await runners["scene_segmentation"](ctx)
    await runners["speech_analysis"](ctx)
    structure.assert_awaited_once_with(77, db=ctx.db, user=ctx.user)
    speech.assert_awaited_once_with(77, db=ctx.db, user=ctx.user, language=None)


async def test_default_retention_runner_reports_zero_devices_as_a_normal_summary(monkeypatch):
    import app.services.retention_classification_svc as svc
    monkeypatch.setattr(svc, "classify_and_persist_retention_devices",
                        AsyncMock(return_value={"candidates_examined": 8, "devices": []}))
    ctx = SimpleNamespace(db=object(), user=object(), reference_video_id=1, video_analysis_id=2)
    assert await default_runners()["retention_devices"](ctx) == {"candidates_examined": 8, "accepted_devices": 0}
