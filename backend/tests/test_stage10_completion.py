"""Stage 10 ("scenes and story beats") is only 'already complete' when no boundary candidate is still waiting for its reasoning, and the creative-intelligence endpoint works on a stored analysis.
Regression for reference 5131, whose story-beat reasoning failed for a candidate while its scene already existed: the stage was reported complete and never finished. Real local Postgres; no AI call."""
import pytest
from unittest.mock import patch

from app.config import settings
from app.models.scene import Scene
from app.routers.reference_videos import get_reference_video_creative_intelligence
from app.services import deconstruction_orchestrator_svc as orch
from tests.test_deconstruction_orchestrator_svc import cleanup, make_reference, _existing_test_user
from tests.test_reconstruction_blueprint_svc import _TestSessionLocal, _seed

SB = "app.services.story_beat_boundary_reasoning_store_svc.find_unreasoned_story_beat_candidates"
SC = "app.services.semantic_boundary_reasoning_store_svc.find_unreasoned_candidates"


async def with_scene(db):
    user = await _existing_test_user(db)
    rv_id, asset_id, va_id = await make_reference(db, user, va_status="complete")
    db.add(Scene(video_analysis_id=va_id, order=0, start_time=0.0, end_time=30.0, certainty="INFERRED"))
    await db.commit()
    return rv_id, asset_id, va_id


async def probe(db, va_id):
    return await orch._has_existing_results(db, "scene_story_beats", va_id)


async def test_no_scene_means_the_stage_has_not_run():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user, va_status="complete")
        try:
            assert await probe(db, va_id) is False
        finally:
            await cleanup(db, asset_id, rv_id)


@pytest.mark.parametrize("sb_provider,sc_provider,sb_waiting,sc_waiting,expected", [
    ("anthropic", "anthropic", [], [], True),                 # everything reasoned about -> complete
    ("anthropic", "anthropic", [{"t": 3.0}], [], False),      # THE 5131 BUG: a story-beat candidate has no stored reasoning -> NOT complete (it was reported complete)
    ("anthropic", "anthropic", [], [{"t": 3.0}], False),      # same for a scene candidate
    ("", "anthropic", [{"t": 3.0}], [], True),                # story-beat reasoner not configured: nothing to wait for
    ("anthropic", "", [], [{"t": 3.0}], True),                # scene reasoner not configured
    ("", "", [{"t": 1}], [{"t": 1}], True),                   # no AI configured at all: the stage is what it has always been
])
async def test_the_stage_is_complete_only_when_no_configured_reasoner_has_candidates_left(monkeypatch, sb_provider, sc_provider, sb_waiting, sc_waiting, expected):
    monkeypatch.setattr(settings, "STORY_BEAT_REASONER_PROVIDER", sb_provider)
    monkeypatch.setattr(settings, "SEMANTIC_REASONER_PROVIDER", sc_provider)

    async def sb(db, va):
        return sb_waiting

    async def sc(db, va):
        return sc_waiting
    async with _TestSessionLocal() as db:
        rv_id, asset_id, va_id = await with_scene(db)
        try:
            with patch(SB, sb), patch(SC, sc):
                assert await probe(db, va_id) is expected
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_other_stages_are_unaffected_by_the_change(monkeypatch):
    async with _TestSessionLocal() as db:
        rv_id, asset_id, va_id = await with_scene(db)
        try:
            assert await orch._has_existing_results(db, "hook_window", va_id) is False
            assert await orch._has_existing_results(db, "retention_devices", va_id) is False
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_the_creative_intelligence_endpoint_returns_the_record_for_a_stored_analysis_with_no_ai_call():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            async def not_run(db, user, rv, *, video_analysis_id=None):
                return {"status": "not_run", "mechanisms": []}
            with patch("app.services.transferable_mechanism_svc.get_effective_mechanisms", not_run):
                out = await get_reference_video_creative_intelligence(reference_video_id=rv_id, video_analysis_id=None, db=db, user=user)
            assert out["schema"] == "creative-intelligence-v1" and out["status"] == "mechanisms_not_run" and out["mechanisms"] == []
            assert out["structure"]["partition"]["shots"] == 2 and out["narrative"]["status"] == "not_established"
            assert out["audience_effects"]["status"] == "not_established" and out["reuse_policy"]["never_copy"]
            assert out["pins"]["anatomy_fingerprint"] and out["reference"]["reference_video_id"] == rv_id
        finally:
            await cleanup(db, asset_id, rv_id)
