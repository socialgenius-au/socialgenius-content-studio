"""A paid reply that parses but breaks a safeguard (reference 5131's blueprint used a source term) must be rejected INSIDE the metered attempt, so the ledger can mark it invalid and allow one fresh request.
Wiring test: the validator is reached from within the function handed to run_reasoner_call."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.config import settings
from app.services.blueprint_reasoner import router as bp_router
from app.services.mechanism_reasoner import router as mech_router


class Sentinel(Exception):
    pass


async def _drive(router, provider_method, validator_name, args):
    seen = {"inside": False}

    async def fake_run(fn, **kw):
        try:
            return await fn()
        except Sentinel:
            seen["inside"] = True
            raise

    prov = router._REASONER_PROVIDERS["anthropic"]
    with patch.object(router, "run_reasoner_call", fake_run), patch.object(prov, provider_method, AsyncMock(return_value=SimpleNamespace(reasoning_contract_version="x"))), \
            patch.object(prov, "is_configured", lambda: True), patch.object(router, validator_name, side_effect=Sentinel()), patch.object(router, "build_reasoner_input", lambda *_: {}):
        with pytest.raises(Sentinel):
            await args()
    return seen["inside"]


async def test_blueprint_validation_runs_inside_the_metered_attempt(monkeypatch):
    monkeypatch.setattr(settings, "BLUEPRINT_REASONER_PROVIDER", "anthropic")
    assert await _drive(bp_router, "derive_blueprint", "validate_decision", lambda: bp_router.derive_blueprint(SimpleNamespace()))


async def test_mechanism_validation_runs_inside_the_metered_attempt(monkeypatch):
    monkeypatch.setattr(settings, "MECHANISM_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(mech_router, "validate_anatomy_input", lambda a: None)
    assert await _drive(mech_router, "derive_mechanisms", "validate_decision", lambda: mech_router.derive_mechanisms({"sections": [1]}))
