"""
C4 -- Reconstruction Blueprint orchestration + persistence + API tests. Real-database convention (real local Postgres, NullPool
engine), matching the C3 / Stage 11.x tests. The PROVIDER is mocked at its adapter boundary (the registered
AnthropicBlueprintReasoner.derive_blueprint), so the router's deterministic validation still runs for real -- and NO real Anthropic
call is ever made. The persisted C3 result is stubbed at the service's own read (`get_effective_mechanisms`), pinned to the REAL
anatomy fingerprint of the database analysis, so stale / never-run / pinned states are fully controllable.
"""
import copy
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.shot import Shot
from app.routers.reference_videos import (
    derive_reference_video_blueprint, get_reference_video_blueprint, get_reference_video_blueprint_attempts,
)
from app.schemas.reconstruction_blueprint import BlueprintAttemptsResponse, BlueprintRequest, BlueprintResponse
from app.services.blueprint_reasoner import BlueprintInputError, BlueprintReasoningError, intent_hash, normalize_intent
from app.services.blueprint_reasoner import router as bp_router
from app.services.blueprint_reasoner.contract import BLUEPRINT_VERSION
from app.services.blueprint_reasoner.parsing import decision_from_payload
from app.services.blueprint_reasoner.providers.anthropic_provider import BLUEPRINT_PROMPT_VERSION
from app.services.content_anatomy_svc import ContentAnatomyNotReady, get_content_anatomy
from app.services.deconstruction_orchestrator_svc import OrchestrationNotFound, _patch_pass_status
from app.services.reconstruction_blueprint_svc import (
    BLUEPRINT_ATTEMPT_CATEGORY, BLUEPRINT_CATEGORY, BlueprintStateConflict, derive_and_persist_blueprint, get_effective_blueprint,
    list_blueprint_attempts,
)
from tests.test_blueprint_reasoner import c3_mechanisms, tile_intent_full, tile_intent_min, tile_payload
from tests.test_deconstruction_orchestrator_svc import _existing_test_user, cleanup, make_reference

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


# ── helpers ───────────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reasoner_on(monkeypatch):
    """Provider 'on' (mocked below) so the service path runs; the key is a dummy -- nothing reaches Anthropic."""
    monkeypatch.setattr(settings, "BLUEPRINT_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "BLUEPRINT_REASONER_MODEL", "test-model")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "dummy-not-used")


def _provider_mock(*items):
    """Patches the registered adapter's call. Each call returns / raises the next item (the last one repeats)."""
    provider = bp_router._REASONER_PROVIDERS["anthropic"]
    seq = list(items)

    async def _call(reasoner_input, *, model):
        d = seq.pop(0) if len(seq) > 1 else seq[0]
        if isinstance(d, Exception):
            raise d
        return d
    mock = AsyncMock(side_effect=_call)
    return patch.object(provider, "derive_blueprint", mock), mock


def _decision(payload=None):
    return decision_from_payload(copy.deepcopy(payload or tile_payload(anat_max=2)), reasoning_contract_version=BLUEPRINT_PROMPT_VERSION)


class C3State:
    """A controllable stand-in for the persisted C3 effective result, pinned to the real anatomy."""
    def __init__(self, fingerprint: str, *, status="current", attempt_id=777, mechanisms=None):
        self.fingerprint, self.status, self.attempt_id = fingerprint, status, attempt_id
        self.mechanisms = c3_mechanisms() if mechanisms is None else mechanisms
        self.stored_fingerprint = fingerprint

    async def __call__(self, db, user, rv_id, *, video_analysis_id=None):
        provenance = None if self.status == "not_run" else {"reasoning_attempt_id": self.attempt_id, "provider": "anthropic", "model": "claude-sonnet-5",
                                                            "prompt_version": "v2", "taxonomy_version": "v1"}
        return {"status": self.status, "input_pin": {"anatomy_fingerprint": self.stored_fingerprint, "current_anatomy_fingerprint": self.fingerprint},
                "mechanisms": [] if self.status == "not_run" else self.mechanisms, "mechanism_count": len(self.mechanisms),
                "overall_limitations": ["Zero retention devices were accepted, so no confirmed retention mechanism can be claimed."], "provenance": provenance}


def _c3_patch(state):
    async def _read(db, user, rv_id, *, video_analysis_id=None):
        return await state(db, user, rv_id, video_analysis_id=video_analysis_id)
    return patch("app.services.reconstruction_blueprint_svc.get_effective_mechanisms", _read)


async def _seed(db, *, boundaries=((0.0, 10.0), (10.0, 30.0))):
    user = await _existing_test_user(db)
    rv_id, asset_id, va_id = await make_reference(db, user, va_status="complete")
    await _patch_pass_status(db, va_id, {"technical_probe": "complete", "scene_segmentation": "complete"})
    for i, (s, e) in enumerate(boundaries):
        db.add(Shot(video_analysis_id=va_id, scene_id=None, order=i, start_time=s, end_time=e,
                    certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
    await db.commit()
    return user, rv_id, asset_id, va_id


async def _rows(db, va_id, *categories):
    return list((await db.execute(select(AnalysisAnnotation).where(
        AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category.in_(categories))
        .order_by(AnalysisAnnotation.id).execution_options(populate_existing=True))).scalars().all())


# ── persistence: attempt + effective blueprint ──────────────────────────────────────────────

async def test_a_derivation_persists_an_attempt_and_the_effective_blueprint_with_complete_provenance_and_reads_back():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            anatomy = await get_content_anatomy(db, user, rv_id)
            fp = anatomy["provenance"]["fingerprint"]
            state = C3State(fp)
            patcher, mock = _provider_mock(_decision())
            with patcher, _c3_patch(state):
                out = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                read = await get_effective_blueprint(db, user, rv_id)
                hist = await list_blueprint_attempts(db, user, rv_id)
            BlueprintResponse.model_validate(out)
            BlueprintAttemptsResponse.model_validate(hist)
            assert mock.await_count == 1 and out["status"] == "current" and out["reused"] is False
            ihash = intent_hash(normalize_intent(tile_intent_full()))
            assert out["input_pin"] == {"anatomy_fingerprint": fp, "current_anatomy_fingerprint": fp, "mechanism_attempt_id": 777,
                                        "current_mechanism_attempt_id": 777, "intent_hash": ihash}
            bp, prov = out["blueprint"], out["provenance"]
            assert prov["llm_calls"] == 1 and prov["certainty"] == "INFERRED" and prov["blueprint_version"] == BLUEPRINT_VERSION
            assert (prov["provider"], prov["model"], prov["prompt_version"], prov["taxonomy_version"]) == ("anthropic", "test-model", BLUEPRINT_PROMPT_VERSION, "v1")
            p = bp["provenance"]
            assert (p["anatomy_fingerprint"], p["mechanism_attempt_id"], p["mechanism_provider"], p["mechanism_model"], p["mechanism_prompt_version"],
                    p["taxonomy_version"], p["intent_hash"], p["provider"], p["model"], p["prompt_version"]) == (
                fp, 777, "anthropic", "claude-sonnet-5", "v2", "v1", ihash, "anthropic", "test-model", BLUEPRINT_PROMPT_VERSION)
            assert p["reasoning_attempt_id"] == prov["reasoning_attempt_id"] and p["video_analysis_id"] == va_id and p["reference_video_id"] == rv_id
            assert bp["blueprint_id"].startswith("bp-") and bp["mechanisms_used"] == ["M01", "M02", "M03"]
            assert any(g["kind"] == "reference_limitation" and "retention devices" in g["reason"] for g in bp["gaps"]), "zero accepted retention devices stays valid"

            attempts, effective = await _rows(db, va_id, BLUEPRINT_ATTEMPT_CATEGORY), await _rows(db, va_id, BLUEPRINT_CATEGORY)
            assert (len(attempts), len(effective)) == (1, 1) and {r.certainty for r in attempts + effective} == {"INFERRED"}
            assert effective[0].details["reasoning_attempt_id"] == attempts[0].id == prov["reasoning_attempt_id"]
            assert attempts[0].details["blueprint"]["provenance"]["reasoning_attempt_id"] == attempts[0].id
            # read-back through the normal read path: identical blueprint, no provider call
            assert read["status"] == "current" and read["blueprint"] == bp and read["provenance"]["llm_calls"] == 0
            assert hist["effective_attempt_id"] == attempts[0].id and hist["attempts"][0]["is_effective"] and hist["attempts"][0]["blueprint"] == bp
            assert hist["attempts"][0]["intent_hash"] == ihash and hist["attempts"][0]["mechanisms_used"] == ["M01", "M02", "M03"]
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_the_minimum_required_intent_derives_and_records_missing_optional_information_as_gaps():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            patcher, _ = _provider_mock(_decision(tile_payload(cta=False, mps=False, anat_max=2)))
            with patcher, _c3_patch(C3State(fp)):
                out = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_min())
            bp = out["blueprint"]
            assert {g["field"] for g in bp["gaps"] if g["kind"] == "not_supplied"} >= {"business_or_brand", "desired_cta", "mandatory_points", "prohibited_claims_or_elements"}
            assert bp["intent"]["business_or_brand"] is None and bp["mandatory_point_accounting"] == [] and all(s["cta_direction"] is None for s in bp["sections"])
        finally:
            await cleanup(db, asset_id, rv_id)


# ── reuse / idempotency / replacement / attempts ────────────────────────────────────────────

async def test_an_identical_request_reuses_the_blueprint_without_a_provider_call_unless_forced():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            patcher, mock = _provider_mock(_decision())
            with patcher, _c3_patch(C3State(fp)):
                first = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                again = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                assert mock.await_count == 1 and again["reused"] is True and again["provenance"]["llm_calls"] == 0
                assert again["blueprint"] == first["blueprint"] and again["provenance"]["reasoning_attempt_id"] == first["provenance"]["reasoning_attempt_id"]
                await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full(), force=True)
                assert mock.await_count == 2
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_changed_intent_or_changed_c3_attempt_or_changed_provider_invalidates_reuse(monkeypatch):
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            state = C3State(fp)
            patcher, mock = _provider_mock(_decision())
            with patcher, _c3_patch(state):
                await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                assert mock.await_count == 1
                changed_intent = {**tile_intent_full(), "objective": "help the audience compare two tile options for a bathroom"}
                r = await derive_and_persist_blueprint(db, user, rv_id, changed_intent)
                assert mock.await_count == 2 and r["reused"] is False
                await derive_and_persist_blueprint(db, user, rv_id, changed_intent)
                assert mock.await_count == 2                                      # the new intent is now the reusable one
                state.attempt_id = 888                                            # a re-derived C3 result
                await derive_and_persist_blueprint(db, user, rv_id, changed_intent)
                assert mock.await_count == 3
                monkeypatch.setattr(settings, "BLUEPRINT_REASONER_MODEL", "another-model")
                await derive_and_persist_blueprint(db, user, rv_id, changed_intent)
                assert mock.await_count == 4
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_new_effective_blueprint_replaces_the_old_one_and_every_attempt_is_preserved():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            second = tile_payload(anat_max=2)
            second["structural_approach"] = "Lead with one bold framing, contrast two outcomes of the same decision, and close with a clear next step to the showroom."
            patcher, mock = _provider_mock(_decision(), _decision(second))
            with patcher, _c3_patch(C3State(fp)):
                one = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                first = (await _rows(db, va_id, BLUEPRINT_ATTEMPT_CATEGORY))[0]
                snapshot = (first.id, dict(first.details), first.created_at)
                old_effective_id = (await _rows(db, va_id, BLUEPRINT_CATEGORY))[0].id
                two = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full(), force=True)
            attempts = await _rows(db, va_id, BLUEPRINT_ATTEMPT_CATEGORY)
            assert len(attempts) == 2 and (attempts[0].id, dict(attempts[0].details), attempts[0].created_at) == snapshot, "attempts are append-only"
            effective = await _rows(db, va_id, BLUEPRINT_CATEGORY)
            assert len(effective) == 1 and effective[0].id != old_effective_id, "the effective blueprint is replaced, never duplicated"
            assert two["blueprint"]["structural_approach"] == second["structural_approach"] != one["blueprint"]["structural_approach"]
            assert two["provenance"]["reasoning_attempt_id"] == attempts[1].id != one["provenance"]["reasoning_attempt_id"]
            hist = await list_blueprint_attempts(db, user, rv_id)
            assert [a["is_effective"] for a in hist["attempts"]] == [False, True]
            assert hist["attempts"][0]["blueprint"]["structural_approach"] == one["blueprint"]["structural_approach"]
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_failed_or_invalid_provider_response_persists_nothing_and_leaves_the_effective_blueprint_untouched():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            bad_copy = tile_payload(anat_max=2)
            bad_copy["sections"][1]["content_instruction"] = 'Say "this one choice changes everything for you" at the start.'
            bad_subject = tile_payload(anat_max=2)
            bad_subject["sections"][1]["content_instruction"] = "Introduce the options using a betrayal theme to frame the choice."
            dropped_point = tile_payload(anat_max=2)
            dropped_point["sections"][4]["mandatory_points_assigned"] = []
            patcher, _ = _provider_mock(_decision(), _decision(bad_copy), _decision(bad_subject), _decision(dropped_point),
                                        BlueprintReasoningError("provider exploded"))
            with patcher, _c3_patch(C3State(fp)):
                good = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                for expected in ("final copy", "NON-TRANSFERABLE", "neither assigned", "provider exploded"):
                    with pytest.raises(BlueprintReasoningError, match=expected):
                        await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full(), force=True)
            assert len(await _rows(db, va_id, BLUEPRINT_ATTEMPT_CATEGORY)) == 1
            still = await get_effective_blueprint(db, user, rv_id)
            assert still["provenance"]["reasoning_attempt_id"] == good["provenance"]["reasoning_attempt_id"] and still["blueprint"] == good["blueprint"]
        finally:
            await cleanup(db, asset_id, rv_id)


# ── stale / incompatible C3 state, pins, zero mechanisms ─────────────────────────────────────

async def test_a_stale_never_run_or_unknown_c3_result_is_a_409_and_never_reaches_the_provider():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            patcher, mock = _provider_mock(_decision())
            with patcher:
                stale = C3State(fp, status="stale")
                stale.stored_fingerprint = "0" * 64                       # mechanisms were derived from a different anatomy
                with _c3_patch(stale), pytest.raises(BlueprintStateConflict, match="'stale'.*Re-derive mechanisms"):
                    await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                with _c3_patch(C3State(fp, status="not_run")), pytest.raises(BlueprintStateConflict, match="have not been derived"):
                    await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                with _c3_patch(C3State(fp, status="unknown")), pytest.raises(BlueprintStateConflict, match="'unknown'"):
                    await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
            assert mock.await_count == 0 and await _rows(db, va_id, BLUEPRINT_ATTEMPT_CATEGORY, BLUEPRINT_CATEGORY) == []
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_pinned_anatomy_fingerprint_and_mechanism_attempt_must_match_or_the_request_is_a_409():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            patcher, mock = _provider_mock(_decision())
            with patcher, _c3_patch(C3State(fp, attempt_id=777)):
                with pytest.raises(BlueprintStateConflict, match="anatomy has changed"):
                    await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full(), expected_anatomy_fingerprint="f" * 64)
                with pytest.raises(BlueprintStateConflict, match="not the pinned attempt 5"):
                    await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full(), expected_mechanism_attempt_id=5)
                assert mock.await_count == 0
                ok = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full(), expected_anatomy_fingerprint=fp, expected_mechanism_attempt_id=777)
            assert ok["status"] == "current"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_zero_c3_mechanisms_is_a_422_because_there_is_no_transferable_principle_to_plan_from():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            patcher, mock = _provider_mock(_decision())
            with patcher, _c3_patch(C3State(fp, mechanisms=[])):
                with pytest.raises(BlueprintInputError, match="no transferable mechanisms"):
                    await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
            assert mock.await_count == 0
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_blueprint_becomes_stale_when_the_anatomy_or_the_c3_result_changes_and_is_still_returned():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            state = C3State(fp)
            patcher, mock = _provider_mock(_decision())
            with patcher, _c3_patch(state):
                first = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                assert (await get_effective_blueprint(db, user, rv_id))["status"] == "current"
                state.attempt_id = 999                                                   # C3 re-derived: a different attempt
                stale = await get_effective_blueprint(db, user, rv_id)
                assert stale["status"] == "stale" and stale["blueprint"] == first["blueprint"]
                assert stale["input_pin"]["mechanism_attempt_id"] == 777 and stale["input_pin"]["current_mechanism_attempt_id"] == 999
                state.attempt_id = 777
                assert (await get_effective_blueprint(db, user, rv_id))["status"] == "current"
                state.fingerprint = "9" * 64                                             # the anatomy changed
                anatomy_stale = await get_effective_blueprint(db, user, rv_id)
                assert anatomy_stale["status"] == "stale" and anatomy_stale["input_pin"]["current_anatomy_fingerprint"] == "9" * 64
                state.fingerprint = None                                                 # the anatomy cannot currently be built
                assert (await get_effective_blueprint(db, user, rv_id))["status"] == "unknown"
            assert mock.await_count == 1
        finally:
            await cleanup(db, asset_id, rv_id)


# ── input contract / disabled provider ──────────────────────────────────────────────────────

async def test_an_invalid_or_incomplete_intent_is_a_422_before_any_upstream_read_or_provider_call():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            patcher, mock = _provider_mock(_decision())
            with patcher, patch("app.services.reconstruction_blueprint_svc.get_content_anatomy", AsyncMock()) as anat:
                for bad in ({}, {**tile_intent_min(), "objective": ""}, {"product_service_or_topic": "x"}, {**tile_intent_min(), "nope": 1}):
                    with pytest.raises(BlueprintInputError, match="Invalid NewContentIntent"):
                        await derive_and_persist_blueprint(db, user, rv_id, bad)
                anat.assert_not_awaited()
            assert mock.await_count == 0
            with pytest.raises(ValidationError):
                BlueprintRequest.model_validate({"intent": {"target_audience": "x y z", "objective": "x y z"}})
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_weak_zero_section_anatomy_and_a_not_ready_analysis_are_refused_safely():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)          # nothing has run
        try:
            patcher, mock = _provider_mock(_decision())
            with patcher, _c3_patch(C3State("f" * 64)):
                with pytest.raises(ContentAnatomyNotReady):
                    await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                await _patch_pass_status(db, va_id, {"technical_probe": "complete", "scene_segmentation": "complete"})
                with pytest.raises(BlueprintInputError, match="zero sections"):          # shot detection 'complete' but nothing usable
                    await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
                with pytest.raises(OrchestrationNotFound):
                    await derive_and_persist_blueprint(db, user, 999_999_999, tile_intent_full())
            assert mock.await_count == 0 and await _rows(db, va_id, BLUEPRINT_ATTEMPT_CATEGORY, BLUEPRINT_CATEGORY) == []
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_with_the_provider_disabled_nothing_is_called_and_nothing_is_persisted(monkeypatch):
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            monkeypatch.setattr(settings, "BLUEPRINT_REASONER_PROVIDER", "")
            patcher, mock = _provider_mock(_decision())
            with patcher, _c3_patch(C3State(fp)):
                with pytest.raises(BlueprintReasoningError, match="BLUEPRINT_REASONER_PROVIDER is empty"):
                    await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
            assert mock.await_count == 0 and await _rows(db, va_id, BLUEPRINT_ATTEMPT_CATEGORY, BLUEPRINT_CATEGORY) == []
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_c4_consumes_the_c2_anatomy_and_the_c3_read_only_never_raw_evidence():
    """The only upstream reads are get_content_anatomy and get_effective_mechanisms: patching them changes what C4 sees."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)          # NO evidence rows at all
        try:
            from tests.test_blueprint_reasoner import rel_anatomy
            anatomy = rel_anatomy()
            anatomy["provenance"]["reference_video_id"], anatomy["provenance"]["video_analysis_id"] = rv_id, va_id
            patcher, _ = _provider_mock(_decision(tile_payload()))
            with patcher, patch("app.services.reconstruction_blueprint_svc.get_content_anatomy", AsyncMock(return_value=anatomy)), \
                    _c3_patch(C3State(anatomy["provenance"]["fingerprint"])):
                out = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full())
            assert out["input_pin"]["anatomy_fingerprint"] == anatomy["provenance"]["fingerprint"] and len(out["blueprint"]["sections"]) == 5
        finally:
            await cleanup(db, asset_id, rv_id)


# ── API ─────────────────────────────────────────────────────────────────────────────────────

async def test_the_endpoints_map_errors_and_return_schema_valid_bodies():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        request = BlueprintRequest(intent=tile_intent_full())
        with pytest.raises(HTTPException) as unknown:
            await derive_reference_video_blueprint(reference_video_id=999_999_999, request=request, db=db, user=user)
        assert unknown.value.status_code == 404
        for endpoint in (get_reference_video_blueprint, get_reference_video_blueprint_attempts):
            with pytest.raises(HTTPException) as e:
                await endpoint(reference_video_id=999_999_999, db=db, user=user)
            assert e.value.status_code == 404

        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            with pytest.raises(HTTPException) as not_ready:
                await derive_reference_video_blueprint(reference_video_id=rv_id, request=request, db=db, user=user)
            assert not_ready.value.status_code == 422

            await _patch_pass_status(db, va_id, {"technical_probe": "complete", "scene_segmentation": "complete"})
            with pytest.raises(HTTPException) as zero:
                await derive_reference_video_blueprint(reference_video_id=rv_id, request=request, db=db, user=user)
            assert zero.value.status_code == 422 and "zero sections" in zero.value.detail

            for i, (s, e) in enumerate([(0.0, 10.0), (10.0, 30.0)]):
                db.add(Shot(video_analysis_id=va_id, scene_id=None, order=i, start_time=s, end_time=e, certainty="MEASURED",
                            source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            await db.commit()
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]

            with _c3_patch(C3State(fp, status="not_run")):
                with pytest.raises(HTTPException) as conflict:
                    await derive_reference_video_blueprint(reference_video_id=rv_id, request=request, db=db, user=user)
                assert conflict.value.status_code == 409
                not_run = await get_reference_video_blueprint(reference_video_id=rv_id, db=db, user=user)
                BlueprintResponse.model_validate(not_run)
                assert not_run["status"] == "not_run" and not_run["blueprint"] is None

            with _c3_patch(C3State(fp)):
                with pytest.raises(HTTPException) as changed:
                    await derive_reference_video_blueprint(reference_video_id=rv_id, request=BlueprintRequest(intent=tile_intent_full(), anatomy_fingerprint="f" * 64), db=db, user=user)
                assert changed.value.status_code == 409
                with patch.object(settings, "BLUEPRINT_REASONER_PROVIDER", ""):
                    with pytest.raises(HTTPException) as off:
                        await derive_reference_video_blueprint(reference_video_id=rv_id, request=request, db=db, user=user)
                assert off.value.status_code == 502 and "BLUEPRINT_REASONER_PROVIDER" in off.value.detail

                patcher, _ = _provider_mock(_decision())
                with patcher:
                    body = await derive_reference_video_blueprint(
                        reference_video_id=rv_id, request=BlueprintRequest(intent=tile_intent_full(), anatomy_fingerprint=fp, mechanism_attempt_id=777), db=db, user=user)
                BlueprintResponse.model_validate(body)
                assert body["status"] == "current" and len(body["blueprint"]["sections"]) == 5
                read = await get_reference_video_blueprint(reference_video_id=rv_id, db=db, user=user)
                assert read["blueprint"] == body["blueprint"] and read["provenance"]["llm_calls"] == 0
                hist = await get_reference_video_blueprint_attempts(reference_video_id=rv_id, db=db, user=user)
                BlueprintAttemptsResponse.model_validate(hist)
                assert len(hist["attempts"]) == 1 and hist["attempts"][0]["is_effective"] is True
                with pytest.raises(HTTPException) as wrong_pin:
                    await get_reference_video_blueprint(reference_video_id=rv_id, video_analysis_id=999_999_999, db=db, user=user)
                assert wrong_pin.value.status_code == 404
                with pytest.raises(HTTPException) as bad_intent:
                    await derive_reference_video_blueprint(reference_video_id=rv_id, request=BlueprintRequest.model_construct(intent=tile_intent_min() | {"objective": ""}, video_analysis_id=None,
                                                                                                                              anatomy_fingerprint=None, mechanism_attempt_id=None, force=False), db=db, user=user)
                assert bad_intent.value.status_code == 422
        finally:
            await cleanup(db, asset_id, rv_id)
