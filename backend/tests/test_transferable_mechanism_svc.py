"""
C3 -- Transferable Mechanism orchestration + persistence + API tests. Real-database convention (real local
Postgres, NullPool engine), matching the Stage 11.x tests. The PROVIDER is mocked at its adapter boundary
(the registered AnthropicMechanismReasoner.derive_mechanisms), so the router's provider-independent validation
still runs for real -- and NO real Anthropic call is ever made.
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.shot import Shot
from app.routers.reference_videos import (
    derive_reference_video_mechanisms, get_reference_video_mechanism_attempts, get_reference_video_mechanisms,
)
from app.schemas.transferable_mechanism import MechanismAttemptsResponse, MechanismSetResponse
from app.services.content_anatomy_svc import ContentAnatomyNotReady, get_content_anatomy
from app.services.deconstruction_orchestrator_svc import OrchestrationNotFound, _patch_pass_status
from app.services.mechanism_reasoner import (
    Mechanism, MechanismDecision, MechanismInputError, MechanismReasoningError, NonTransferableElement,
)
from app.services.mechanism_reasoner import router as mech_router
from app.services.mechanism_reasoner.providers.anthropic_provider import MECHANISM_PROMPT_VERSION
from app.services.transferable_mechanism_svc import (
    MECHANISM_ATTEMPT_CATEGORY, MECHANISM_CATEGORY, MECHANISM_SET_CATEGORY, MechanismAnatomyChanged,
    derive_and_persist_mechanisms, get_effective_mechanisms, list_mechanism_attempts,
)
from tests.test_deconstruction_orchestrator_svc import _existing_test_user, cleanup, make_reference

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


# ── helpers ───────────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reasoner_on(monkeypatch):
    """Provider 'on' (mocked below) so the service path runs; the key is a dummy -- nothing reaches Anthropic."""
    monkeypatch.setattr(settings, "MECHANISM_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "MECHANISM_REASONER_MODEL", "test-model")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "dummy-not-used")


def _provider_mock(*decisions):
    """Patches the registered adapter's call. Each call returns the next decision (last one repeats)."""
    provider = mech_router._REASONER_PROVIDERS["anthropic"]
    seq = list(decisions)

    async def _call(reasoner_input, *, model):
        d = seq.pop(0) if len(seq) > 1 else seq[0]
        if isinstance(d, Exception):
            raise d
        return d
    mock = AsyncMock(side_effect=_call)
    return patch.object(provider, "derive_mechanisms", mock), mock


def decision_for(anatomy, *, statement=None, extra=()):
    """A valid decision citing the REAL ids of this anatomy's second section (the one with a cut), shot-derived."""
    m = Mechanism(
        mechanism_type="pacing_rhythm",
        statement=statement or "The opening shot appears designed to hold a single framing before the first cut.",
        scope="sections", section_numbers=[anatomy["sections"][1]["number"]],
        supporting_evidence_ids={"shots": anatomy["sections"][1]["evidence_ids"]["shots"]},
        anatomy_features_used=["cuts", "pacing"],
        transferable_principle="Let one framing settle before the first cut arrives, then change it at a steady cadence.",
        non_transferable_elements=[NonTransferableElement("timing_specific", "The exact lengths of these two shots")],
        confidence="low",
    )
    return MechanismDecision(mechanisms=[m, *extra], overall_limitations=["Only two sections were available."], reasoning_contract_version=MECHANISM_PROMPT_VERSION)


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


# ── persistence: attempt + effective set ─────────────────────────────────────────────────────

async def test_a_derivation_persists_a_durable_attempt_and_the_effective_set_pinned_to_the_anatomy_fingerprint():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            anatomy = await get_content_anatomy(db, user, rv_id)
            patcher, mock = _provider_mock(decision_for(anatomy))
            with patcher:
                out = await derive_and_persist_mechanisms(db, user, rv_id)
            MechanismSetResponse.model_validate(out)
            assert mock.await_count == 1 and out["status"] == "current" and out["reused"] is False
            assert out["mechanism_count"] == 1 and out["provenance"]["llm_calls"] == 1 and out["provenance"]["certainty"] == "INFERRED"
            assert out["input_pin"]["anatomy_fingerprint"] == anatomy["provenance"]["fingerprint"] == out["input_pin"]["current_anatomy_fingerprint"]
            [m] = out["mechanisms"]
            assert m["provenance"]["anatomy_fingerprint"] == anatomy["provenance"]["fingerprint"]
            assert m["provenance"]["provider"] == "anthropic" and m["provenance"]["model"] == "test-model"
            assert m["provenance"]["prompt_version"] == MECHANISM_PROMPT_VERSION and m["certainty"] == "INFERRED"
            assert out["anatomy_gaps"] and any(g["field"] == "narrative_role" for g in out["anatomy_gaps"])
            assert any("No accepted retention devices" in x for x in out["overall_limitations"])

            attempts = await _rows(db, va_id, MECHANISM_ATTEMPT_CATEGORY)
            sets = await _rows(db, va_id, MECHANISM_SET_CATEGORY)
            mechs = await _rows(db, va_id, MECHANISM_CATEGORY)
            assert (len(attempts), len(sets), len(mechs)) == (1, 1, 1)
            assert sets[0].details["reasoning_attempt_id"] == attempts[0].id == out["provenance"]["reasoning_attempt_id"]
            assert mechs[0].details["reasoning_attempt_id"] == attempts[0].id
            assert {r.certainty for r in attempts + sets + mechs} == {"INFERRED"}
            assert attempts[0].details["mechanisms"][0]["mechanism_id"] == "M01"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_zero_mechanisms_is_a_persisted_successful_result_distinct_from_never_run():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            before = await get_effective_mechanisms(db, user, rv_id)
            assert before["status"] == "not_run" and before["mechanisms"] == [] and before["provenance"] is None

            patcher, _ = _provider_mock(MechanismDecision(mechanisms=[], overall_limitations=["Too little structure to support any mechanism."],
                                                          reasoning_contract_version="v1"))
            with patcher:
                out = await derive_and_persist_mechanisms(db, user, rv_id)
            assert out["mechanisms"] == [] and out["mechanism_count"] == 0 and out["status"] == "current"
            assert "Too little structure to support any mechanism." in out["overall_limitations"]
            assert any("No mechanism was supported" in x for x in out["overall_limitations"])
            assert len(await _rows(db, va_id, MECHANISM_ATTEMPT_CATEGORY)) == 1      # the empty result is still an audited attempt
            assert len(await _rows(db, va_id, MECHANISM_SET_CATEGORY)) == 1
            assert await _rows(db, va_id, MECHANISM_CATEGORY) == []
            after = await get_effective_mechanisms(db, user, rv_id)
            assert after["status"] == "current" and after["mechanism_count"] == 0
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_new_effective_result_replaces_the_old_one_but_every_reasoning_attempt_is_preserved():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            anatomy = await get_content_anatomy(db, user, rv_id)
            first_decision = decision_for(anatomy)
            second_decision = decision_for(anatomy, statement="The first cut places a change of framing after one long shot.")
            patcher, mock = _provider_mock(first_decision, second_decision)
            with patcher:
                one = await derive_and_persist_mechanisms(db, user, rv_id)
                first_attempt = (await _rows(db, va_id, MECHANISM_ATTEMPT_CATEGORY))[0]
                first_snapshot = (first_attempt.id, dict(first_attempt.details), first_attempt.created_at)
                old_mech_ids = [r.id for r in await _rows(db, va_id, MECHANISM_CATEGORY)]
                two = await derive_and_persist_mechanisms(db, user, rv_id, force=True)
            assert mock.await_count == 2

            attempts = await _rows(db, va_id, MECHANISM_ATTEMPT_CATEGORY)
            assert len(attempts) == 2, "reasoning attempts are append-only"
            assert (attempts[0].id, dict(attempts[0].details), attempts[0].created_at) == first_snapshot, "the first attempt is untouched"
            new_mechs = await _rows(db, va_id, MECHANISM_CATEGORY)
            assert len(new_mechs) == 1 and new_mechs[0].id not in old_mech_ids, "the effective mechanism rows were replaced"
            assert len(await _rows(db, va_id, MECHANISM_SET_CATEGORY)) == 1, "exactly one effective set at a time"
            assert two["mechanisms"][0]["statement"] == second_decision.mechanisms[0].statement
            assert one["provenance"]["reasoning_attempt_id"] != two["provenance"]["reasoning_attempt_id"] == attempts[1].id

            hist = await list_mechanism_attempts(db, user, rv_id)
            MechanismAttemptsResponse.model_validate(hist)
            assert [a["is_effective"] for a in hist["attempts"]] == [False, True] and hist["effective_attempt_id"] == attempts[1].id
            assert hist["attempts"][0]["mechanisms"][0]["statement"] == first_decision.mechanisms[0].statement
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_failed_or_invalid_provider_response_persists_nothing_and_leaves_the_effective_result_untouched():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            anatomy = await get_content_anatomy(db, user, rv_id)
            invalid = decision_for(anatomy, statement="The opening appears designed to be viral.")
            fabricated = decision_for(anatomy)
            fabricated.mechanisms[0].supporting_evidence_ids = {"shots": [987654]}
            patcher, _ = _provider_mock(decision_for(anatomy), invalid, fabricated, MechanismReasoningError("provider exploded"))
            with patcher:
                good = await derive_and_persist_mechanisms(db, user, rv_id)
                for expected in ("prohibited", "invented provenance", "provider exploded"):
                    with pytest.raises(MechanismReasoningError, match=expected):
                        await derive_and_persist_mechanisms(db, user, rv_id, force=True)
            assert len(await _rows(db, va_id, MECHANISM_ATTEMPT_CATEGORY)) == 1
            still = await get_effective_mechanisms(db, user, rv_id)
            assert still["provenance"]["reasoning_attempt_id"] == good["provenance"]["reasoning_attempt_id"] and still["mechanism_count"] == 1
        finally:
            await cleanup(db, asset_id, rv_id)


# ── cost control / pinning / staleness ───────────────────────────────────────────────────────

async def test_an_unchanged_anatomy_reuses_the_effective_result_without_a_provider_call_unless_forced():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            anatomy = await get_content_anatomy(db, user, rv_id)
            patcher, mock = _provider_mock(decision_for(anatomy))
            with patcher:
                first = await derive_and_persist_mechanisms(db, user, rv_id)
                again = await derive_and_persist_mechanisms(db, user, rv_id)
                assert mock.await_count == 1
                assert again["reused"] is True and again["provenance"]["llm_calls"] == 0
                assert again["provenance"]["reasoning_attempt_id"] == first["provenance"]["reasoning_attempt_id"]
                await derive_and_persist_mechanisms(db, user, rv_id, force=True)
                assert mock.await_count == 2
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_pinned_fingerprint_that_no_longer_matches_is_refused_before_any_provider_call():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            anatomy = await get_content_anatomy(db, user, rv_id)
            patcher, mock = _provider_mock(decision_for(anatomy))
            with patcher:
                with pytest.raises(MechanismAnatomyChanged, match="anatomy has changed"):
                    await derive_and_persist_mechanisms(db, user, rv_id, expected_fingerprint="0" * 64)
                assert mock.await_count == 0 and await _rows(db, va_id, MECHANISM_ATTEMPT_CATEGORY) == []
                ok = await derive_and_persist_mechanisms(db, user, rv_id, expected_fingerprint=anatomy["provenance"]["fingerprint"])
            assert ok["status"] == "current"
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_a_result_becomes_stale_when_the_anatomy_changes_and_is_still_returned_never_hidden():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            anatomy = await get_content_anatomy(db, user, rv_id)
            patcher, mock = _provider_mock(decision_for(anatomy))
            with patcher:
                await derive_and_persist_mechanisms(db, user, rv_id)
                db.add(Shot(video_analysis_id=va_id, scene_id=None, order=2, start_time=30.0, end_time=40.0,
                            certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
                await db.commit()
                stale = await get_effective_mechanisms(db, user, rv_id)
                assert stale["status"] == "stale" and stale["mechanism_count"] == 1
                assert stale["input_pin"]["anatomy_fingerprint"] != stale["input_pin"]["current_anatomy_fingerprint"]
                # a changed anatomy is never 'reused': it triggers a fresh derivation
                await derive_and_persist_mechanisms(db, user, rv_id)
                assert mock.await_count == 2
                assert (await get_effective_mechanisms(db, user, rv_id))["status"] == "current"
        finally:
            await cleanup(db, asset_id, rv_id)


# ── input contract / disabled provider ───────────────────────────────────────────────────────

async def test_zero_section_and_not_ready_anatomies_are_input_errors_and_never_reach_the_provider():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)  # nothing has run
        try:
            patcher, mock = _provider_mock(MechanismDecision(mechanisms=[]))
            with patcher:
                with pytest.raises(ContentAnatomyNotReady):
                    await derive_and_persist_mechanisms(db, user, rv_id)
                await _patch_pass_status(db, va_id, {"technical_probe": "complete", "scene_segmentation": "complete"})
                # shot detection 'complete' but produced no shots, no beats, no phases -> zero sections
                with pytest.raises(MechanismInputError, match="zero sections"):
                    await derive_and_persist_mechanisms(db, user, rv_id)
                with pytest.raises(OrchestrationNotFound):
                    await derive_and_persist_mechanisms(db, user, 999_999_999)
            assert mock.await_count == 0 and await _rows(db, va_id, MECHANISM_ATTEMPT_CATEGORY) == []
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_with_the_provider_disabled_nothing_is_called_and_nothing_is_persisted(monkeypatch):
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            monkeypatch.setattr(settings, "MECHANISM_REASONER_PROVIDER", "")
            patcher, mock = _provider_mock(MechanismDecision(mechanisms=[]))
            with patcher:
                with pytest.raises(MechanismReasoningError, match="MECHANISM_REASONER_PROVIDER is empty"):
                    await derive_and_persist_mechanisms(db, user, rv_id)
            assert mock.await_count == 0
            assert await _rows(db, va_id, MECHANISM_ATTEMPT_CATEGORY, MECHANISM_SET_CATEGORY, MECHANISM_CATEGORY) == []
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_c3_reads_only_the_anatomy_never_raw_evidence():
    """The only evidence source is get_content_anatomy: patching it changes what C3 sees, with no DB evidence at all."""
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            from tests.test_mechanism_reasoner import mech, rich_anatomy
            anatomy = rich_anatomy()
            anatomy["provenance"]["reference_video_id"], anatomy["provenance"]["video_analysis_id"] = rv_id, va_id
            patcher, _ = _provider_mock(MechanismDecision(mechanisms=[mech()], reasoning_contract_version="v1"))
            with patcher, patch("app.services.transferable_mechanism_svc.get_content_anatomy", AsyncMock(return_value=anatomy)):
                out = await derive_and_persist_mechanisms(db, user, rv_id)
            assert out["input_pin"]["anatomy_fingerprint"] == anatomy["provenance"]["fingerprint"]
            assert out["mechanisms"][0]["section_numbers"] == [1]
        finally:
            await cleanup(db, asset_id, rv_id)


# ── API ──────────────────────────────────────────────────────────────────────────────────────

async def test_the_endpoints_map_errors_and_return_schema_valid_bodies():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        with pytest.raises(HTTPException) as unknown:
            await derive_reference_video_mechanisms(reference_video_id=999_999_999, db=db, user=user)
        assert unknown.value.status_code == 404
        for endpoint in (get_reference_video_mechanisms, get_reference_video_mechanism_attempts):
            with pytest.raises(HTTPException) as e:
                await endpoint(reference_video_id=999_999_999, db=db, user=user)
            assert e.value.status_code == 404

        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            with pytest.raises(HTTPException) as not_ready:
                await derive_reference_video_mechanisms(reference_video_id=rv_id, db=db, user=user)
            assert not_ready.value.status_code == 422

            await _patch_pass_status(db, va_id, {"technical_probe": "complete", "scene_segmentation": "complete"})
            with pytest.raises(HTTPException) as zero:
                await derive_reference_video_mechanisms(reference_video_id=rv_id, db=db, user=user)
            assert zero.value.status_code == 422 and "zero sections" in zero.value.detail

            for i, (s, e) in enumerate([(0.0, 10.0), (10.0, 30.0)]):
                db.add(Shot(video_analysis_id=va_id, scene_id=None, order=i, start_time=s, end_time=e, certainty="MEASURED",
                            source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
            await db.commit()
            anatomy = await get_content_anatomy(db, user, rv_id)

            with pytest.raises(HTTPException) as changed:
                await derive_reference_video_mechanisms(reference_video_id=rv_id, anatomy_fingerprint="f" * 64, db=db, user=user)
            assert changed.value.status_code == 409

            with patch.object(settings, "MECHANISM_REASONER_PROVIDER", ""):
                with pytest.raises(HTTPException) as off:
                    await derive_reference_video_mechanisms(reference_video_id=rv_id, db=db, user=user)
            assert off.value.status_code == 502 and "MECHANISM_REASONER_PROVIDER" in off.value.detail

            not_run = await get_reference_video_mechanisms(reference_video_id=rv_id, db=db, user=user)
            MechanismSetResponse.model_validate(not_run)
            assert not_run["status"] == "not_run"

            patcher, _ = _provider_mock(decision_for(anatomy))
            with patcher:
                body = await derive_reference_video_mechanisms(
                    reference_video_id=rv_id, anatomy_fingerprint=anatomy["provenance"]["fingerprint"], db=db, user=user)
            MechanismSetResponse.model_validate(body)
            assert body["mechanism_count"] == 1 and body["status"] == "current"
            read = await get_reference_video_mechanisms(reference_video_id=rv_id, db=db, user=user)
            assert read["provenance"]["llm_calls"] == 0 and read["mechanisms"] == body["mechanisms"]
            hist = await get_reference_video_mechanism_attempts(reference_video_id=rv_id, db=db, user=user)
            MechanismAttemptsResponse.model_validate(hist)
            assert len(hist["attempts"]) == 1 and hist["attempts"][0]["is_effective"] is True

            with pytest.raises(HTTPException) as wrong_pin:
                await get_reference_video_mechanisms(reference_video_id=rv_id, video_analysis_id=999_999_999, db=db, user=user)
            assert wrong_pin.value.status_code == 404
        finally:
            await cleanup(db, asset_id, rv_id)
