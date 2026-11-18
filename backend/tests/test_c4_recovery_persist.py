"""Persisting a RECOVERED blueprint: saved only if every check passes, with an audit trail, zero provider calls, and the spending ledger untouched. Real local Postgres, like the other C4 service tests."""
import copy
import json
import secrets
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.models.ai_call_ledger import AiCallLedger
from app.schemas.reconstruction_blueprint import BlueprintResponse
from app.services.blueprint_reasoner import BlueprintReasoningError
from app.services.blueprint_reasoner import router as bp_router
from app.services.content_anatomy_svc import get_content_anatomy
from app.services.reconstruction_blueprint_svc import BLUEPRINT_ATTEMPT_CATEGORY, BLUEPRINT_CATEGORY, derive_and_persist_blueprint, get_effective_blueprint
from tests.test_blueprint_reasoner import tile_intent_full, tile_payload
from tests.test_deconstruction_orchestrator_svc import cleanup
from tests.test_reconstruction_blueprint_svc import C3State, _TestSessionLocal, _c3_patch, _reasoner_on, _rows, _seed  # noqa: F401  (autouse fixture re-exported)


def bare_int_payload():
    p = copy.deepcopy(tile_payload(anat_max=2))
    for d in p["mechanism_dispositions"]:
        if d["mechanism_id"] == "M03":
            d["applied_in_sections"] = 4                              # the slip: a lone number instead of [4]
    return p


def reply(p):
    return {"raw_text": json.dumps(p), "ledger": {"id": 36, "status": "invalid_output", "request_hash": "h", "provider": "anthropic", "model": "claude-sonnet-5"}}


async def test_a_recovered_blueprint_is_saved_with_an_audit_trail_and_makes_no_provider_call():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            provider_call = AsyncMock()
            with patch.object(bp_router._REASONER_PROVIDERS["anthropic"], "derive_blueprint", provider_call), _c3_patch(C3State(fp)):
                out = await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full(), recovered_reply=reply(bare_int_payload()))
                read = await get_effective_blueprint(db, user, rv_id)
            BlueprintResponse.model_validate(out)
            assert provider_call.await_count == 0
            assert out["status"] == "current" and out["provenance"]["llm_calls"] == 0
            rec = out["provenance"]["recovery"]
            assert rec["ledger_id"] == 36 and rec["new_provider_calls"] == 0 and rec["ledger_modified"] is False
            assert rec["normalisations"][0]["original"] == 4 and rec["normalisations"][0]["normalised"] == [4]
            bp = out["blueprint"]
            assert bp["provenance"]["recovery"] == rec and len(bp["sections"]) == len(tile_payload(anat_max=2)["sections"]) and bp["mechanisms_used"] == ["M01", "M02", "M03"]
            assert read["blueprint"] == bp and read["provenance"]["recovery"] == rec                       # it reads back through the normal path, audit included
            assert (len(await _rows(db, va_id, BLUEPRINT_ATTEMPT_CATEGORY)), len(await _rows(db, va_id, BLUEPRINT_CATEGORY))) == (1, 1)
        finally:
            await cleanup(db, asset_id, rv_id)


@pytest.mark.parametrize("breakage", [
    lambda p: [d.update(applied_in_sections=9) for d in p["mechanism_dispositions"] if d["mechanism_id"] == "M03"],                       # out-of-range number
    lambda p: [d.update(applied_in_sections="4") for d in p["mechanism_dispositions"] if d["mechanism_id"] == "M03"],                     # a string
    lambda p: p["sections"][0].update(speech_direction="Talk about the guaranteed results every customer will get."),                       # a safety check
])
async def test_nothing_is_saved_unless_every_check_passes(breakage):
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            p = bare_int_payload()
            breakage(p)
            with _c3_patch(C3State(fp)):
                with pytest.raises(BlueprintReasoningError):
                    await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full(), recovered_reply=reply(p))
                assert (await get_effective_blueprint(db, user, rv_id))["status"] == "not_run"
            assert (await _rows(db, va_id, BLUEPRINT_ATTEMPT_CATEGORY, BLUEPRINT_CATEGORY)) == []
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_the_spending_ledger_row_is_unchanged_by_a_recovery():
    phase = f"rec_{secrets.token_hex(4)}"
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        try:
            raw = json.dumps({"content": [{"type": "text", "text": json.dumps(bare_int_payload())}]})
            row = AiCallLedger(phase_id=phase, user_id=user.id, reference_video_id=rv_id, video_analysis_id=va_id, reasoner="blueprint", model="claude-sonnet-5", request_hash="r" * 8,
                               attempt_no=1, status="invalid_output", cost_usd=0.0307, response_json=raw, error="rejected: BlueprintReasoningError: format")
            db.add(row)
            await db.commit()
            snapshot = {c.name: getattr(row, c.name) for c in AiCallLedger.__table__.columns}
            fp = (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"]
            with _c3_patch(C3State(fp)):
                await derive_and_persist_blueprint(db, user, rv_id, tile_intent_full(), recovered_reply=reply(bare_int_payload()))
            fresh = (await db.execute(select(AiCallLedger).where(AiCallLedger.phase_id == phase).execution_options(populate_existing=True))).scalars().all()
            assert len(fresh) == 1 and {c.name: getattr(fresh[0], c.name) for c in AiCallLedger.__table__.columns} == snapshot
        finally:
            from sqlalchemy import delete
            await db.execute(delete(AiCallLedger).where(AiCallLedger.phase_id == phase))
            await db.commit()
            await cleanup(db, asset_id, rv_id)
