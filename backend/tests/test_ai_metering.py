"""AI cost controls: kill switch, price table, preflight caps, concurrency, duplicates, retries, failed attempts, settlement. A FAKE client stands in for Anthropic: no key, no network, no spend.
Local database only: it creates and deletes its own ledger rows (a private phase id) and throwaway reference videos."""
import asyncio
import secrets
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.ai_call_ledger import AiCallLedger
from app.services import ai_metering as m

pytestmark = pytest.mark.skipif(
    not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")),
    reason="writes ledger rows: only runs against a database on this machine",
)

_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


def usage(i=1000, o=500, cr=0, cw=0):
    return SimpleNamespace(input_tokens=i, output_tokens=o, cache_read_input_tokens=cr, cache_creation_input_tokens=cw)


def message(text_="ok", i=1000, o=500):
    return anthropic.types.Message(id="msg_1", type="message", role="assistant", model="claude-sonnet-5-5", stop_reason="end_turn", stop_sequence=None,
                                   content=[anthropic.types.TextBlock(type="text", text=text_)], usage=anthropic.types.Usage(input_tokens=i, output_tokens=o))


class FakeInner:
    def __init__(self, behaviours=None, delay=0.0):
        self.calls = 0
        self.behaviours = list(behaviours or [])
        self.delay = delay
        self.messages = SimpleNamespace(create=self.create)

    async def create(self, **kw):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        b = self.behaviours.pop(0) if self.behaviours else message()
        if isinstance(b, Exception):
            raise b
        return b


def status_error(code):
    req_ = httpx.Request("POST", "https://x.test")
    return anthropic.APIStatusError("boom", response=httpx.Response(code, request=req_), body=None)


def conn_error():
    return anthropic.APIConnectionError(request=httpx.Request("POST", "https://x.test"))


@pytest.fixture()
async def env(monkeypatch):
    async with _engine.begin() as conn:
        await conn.run_sync(AiCallLedger.__table__.create, checkfirst=True)
    phase = f"m6ai_{secrets.token_hex(4)}"
    monkeypatch.setattr(m, "session_factory", _Session)
    monkeypatch.setattr(m, "BACKOFF_SECONDS", (0.0, 0.0))
    for k, v in dict(AI_SPEND_ENABLED=True, AI_PHASE_ID=phase, AI_PER_REFERENCE_BUDGET_USD=1.0, AI_PHASE_BUDGET_USD=20.0, AI_RETRY_MAX=2).items():
        monkeypatch.setattr(settings, k, v)
    async with _Session() as s:
        uid = (await s.execute(text("SELECT id FROM users ORDER BY id LIMIT 1"))).scalar()
        if uid is None:
            uid = (await s.execute(text("INSERT INTO users (username, email, hashed_password, role, is_active) VALUES ('m6ai_u','m6ai_u@example.test','x','editor',true) RETURNING id"))).scalar()
        aid = (await s.execute(text("INSERT INTO assets (user_id, original_filename, stored_filename, file_path, file_type, mime_type, file_size) VALUES (:u,'m6ai.mp4','m6ai.mp4','uploads/x/m6ai.mp4','video','video/mp4',1) RETURNING id"), {"u": uid})).scalar()
        rid = (await s.execute(text("INSERT INTO reference_videos (user_id, asset_id, source, rights_status) VALUES (:u,:a,'upload','unknown_third_party') RETURNING id"), {"u": uid, "a": aid})).scalar()
        await s.commit()
    yield SimpleNamespace(phase=phase, ref=rid, uid=uid, asset=aid)
    async with _Session() as s:
        await s.execute(delete(AiCallLedger).where(AiCallLedger.phase_id == phase))
        await s.execute(text("DELETE FROM reference_videos WHERE asset_id = :a"), {"a": aid})
        await s.execute(text("DELETE FROM assets WHERE id = :i"), {"i": aid})
        await s.execute(text("DELETE FROM users WHERE username = 'm6ai_u'"))
        await s.commit()


async def rows(phase):
    async with _Session() as s:
        return (await s.execute(select(AiCallLedger).where(AiCallLedger.phase_id == phase).order_by(AiCallLedger.id))).scalars().all()


def req(text_="hello", model="claude-sonnet-5-5", max_tokens=1000, **extra):
    return dict(model=model, max_tokens=max_tokens, system="sys", messages=[{"role": "user", "content": text_}], **extra)


# ── pure ──
def test_default_is_off_and_caps_are_the_approved_ones():
    fresh = type(settings)(_env_file=None)
    assert fresh.AI_SPEND_ENABLED is False
    assert fresh.AI_PER_REFERENCE_BUDGET_USD == 1.0 and fresh.AI_PHASE_BUDGET_USD == 20.0


def test_price_table_and_ceiling():
    assert m.price_for("claude-sonnet-5-5").in_ == 2 and m.price_for("claude-sonnet-5-5").out == 10
    assert m.price_for("claude-haiku-5-5").out == 0.5 and m.price_for("claude-haiku-5-5", 150_000).out == 2.5      # long-prompt tier
    assert m.price_for("claude-haiku-4-5-20251001").in_ == 1                                                         # dated id matches by prefix
    assert m.price_for("gpt-5") is None and m.price_for("") is None and m.price_for(None) is None
    assert m.estimate_input_tokens(req("x" * 3000)) >= 1000
    with_img = m.estimate_input_tokens({"messages": [{"role": "user", "content": [{"type": "image", "source": {"data": "A" * 10_000_000}}, {"type": "text", "text": "hi"}]}]})
    assert 1600 < with_img < 1700                                                                                      # image data never inflates the estimate; one image = the ceiling
    in_usd, ceil = m.ceiling_usd(m.price_for("claude-sonnet-5-5"), 10_000, 4_000)
    assert round(in_usd, 6) == 0.02 and round(ceil, 6) == 0.06


def test_settled_cost_uses_real_usage_including_cache():
    assert round(m.settled_cost_usd("claude-sonnet-5-5", usage(1_000_000, 100_000, 0, 0)), 4) == 3.0
    assert round(m.settled_cost_usd("claude-sonnet-5-5", usage(0, 0, 1_000_000, 0)), 4) == 0.2
    with pytest.raises(m.AiCostControlError):
        m.settled_cost_usd("mystery-model", usage())


def test_identical_requests_hash_the_same_and_any_change_differs():
    assert m.request_hash(req("a")) == m.request_hash(req("a")) != m.request_hash(req("b"))
    assert m.request_hash(req("a", max_tokens=10)) != m.request_hash(req("a", max_tokens=11))


def test_every_anthropic_call_site_uses_the_metered_client():
    import pathlib
    root = pathlib.Path(m.__file__).resolve().parent
    offenders = []
    for f in root.rglob("*.py"):
        t = f.read_text(encoding="utf8")
        if "AsyncAnthropic(" in t and f.name != "ai_metering.py":
            offenders.append(f.name)
        if ".messages.create(" in t and "get_client().messages.create(" not in t and f.name != "ai_metering.py":
            offenders.append(f.name)
    assert offenders == []                                                # nothing builds its own client or bypasses get_client()
    from app.services.claude import get_client
    assert isinstance(get_client(), m.MeteredClient)


# ── kill switch / model / cap behaviour ──
async def test_switch_off_sends_nothing_even_with_a_client(env, monkeypatch):
    monkeypatch.setattr(settings, "AI_SPEND_ENABLED", False)
    inner = FakeInner()
    with pytest.raises(m.AiCostControlError) as e:
        await m.MeteredClient(inner).messages.create(**req())
    assert e.value.code == "disabled" and inner.calls == 0
    assert isinstance(e.value, anthropic.AnthropicError)                  # the existing reasoner error handling catches it
    assert [r.status for r in await rows(env.phase)] == ["refused_disabled"]


async def test_no_key_and_no_client_sends_nothing(env, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    with pytest.raises(m.AiCostControlError) as e:
        await m.MeteredClient().messages.create(**req())
    assert e.value.code == "not_configured"
    assert [r.status for r in await rows(env.phase)] == ["refused_not_configured"]          # refused AND recorded


async def test_the_kill_switch_is_checked_before_the_key(env, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(settings, "AI_SPEND_ENABLED", False)
    with pytest.raises(m.AiCostControlError) as e:
        await m.MeteredClient().messages.create(**req())
    assert e.value.code == "disabled"


async def test_unknown_model_is_refused_before_anything_is_sent(env):
    inner = FakeInner()
    with pytest.raises(m.AiCostControlError) as e:
        await m.MeteredClient(inner).messages.create(**req(model="mystery-9"))
    assert e.value.code == "unknown_model" and inner.calls == 0


async def test_a_successful_call_is_reserved_then_settled_with_real_usage(env):
    inner = FakeInner([message("hi", 1000, 500)])
    with m.ai_scope(reference_video_id=env.ref, reasoner="hook", user_id=env.uid):
        out = await m.MeteredClient(inner).messages.create(**req())
    assert out.content[0].text == "hi" and inner.calls == 1
    (r,) = await rows(env.phase)
    assert r.status == "succeeded" and r.reserved_usd > r.cost_usd > 0 and round(r.cost_usd, 6) == round((1000 * 2 + 500 * 10) / 1e6, 6)
    assert (r.input_tokens, r.output_tokens, r.reasoner, r.reference_video_id) == (1000, 500, "hook", env.ref)
    assert r.response_json and "msg_1" in r.response_json                 # the response is kept for duplicate reuse; the prompt ('sys', 'hello') is never stored
    assert "hello" not in r.response_json


async def test_per_reference_cap_refuses_at_the_boundary_and_sends_nothing(env, monkeypatch):
    monkeypatch.setattr(settings, "AI_PER_REFERENCE_BUDGET_USD", 0.05)
    inner = FakeInner([message("a", 100, 100)] * 5)
    c = m.MeteredClient(inner)
    with m.ai_scope(reference_video_id=env.ref):
        for n in range(1, 5):
            await c.messages.create(**req(f"call {n}", max_tokens=1000))      # each reserves ~0.01 and settles ~0.0012
        with pytest.raises(m.AiCostControlError) as e:
            await c.messages.create(**req("big", max_tokens=4800))            # ceiling ~0.048 + ~0.005 spent > 0.05
    assert e.value.code == "refused_budget" and inner.calls == 4
    assert "Nothing was sent" in str(e.value)


async def test_phase_cap_applies_across_references_and_unscoped_calls(env, monkeypatch):
    monkeypatch.setattr(settings, "AI_PHASE_BUDGET_USD", 0.02)
    inner = FakeInner()
    c = m.MeteredClient(inner)
    await c.messages.create(**req("unscoped", max_tokens=1000))               # ceiling ~0.01, settles ~0.007
    with pytest.raises(m.AiCostControlError) as e:
        with m.ai_scope(reference_video_id=env.ref):
            await c.messages.create(**req("other", max_tokens=1500))          # 0.015 + ~0.007 spent > 0.02
    assert e.value.code == "refused_budget" and "phase" in str(e.value) and inner.calls == 1


async def test_two_concurrent_calls_cannot_both_squeeze_under_the_cap(env, monkeypatch):
    monkeypatch.setattr(settings, "AI_PER_REFERENCE_BUDGET_USD", 0.03)
    inner = FakeInner(delay=0.4)
    c = m.MeteredClient(inner)

    async def go(label):
        with m.ai_scope(reference_video_id=env.ref):
            return await c.messages.create(**req(label, max_tokens=2000))     # ceiling ~0.02 each: only one fits under 0.03 while the other is in flight

    res = await asyncio.gather(go("a"), go("b"), return_exceptions=True)
    ok = [r for r in res if not isinstance(r, Exception)]
    bad = [r for r in res if isinstance(r, m.AiCostControlError)]
    assert len(ok) == 1 and len(bad) == 1 and bad[0].code == "refused_budget" and inner.calls == 1


# ── duplicates ──
async def test_identical_call_after_success_is_served_from_the_ledger_for_free(env):
    inner = FakeInner([message("first", 1000, 500)])
    c = m.MeteredClient(inner)
    with m.ai_scope(reference_video_id=env.ref):
        a = await c.messages.create(**req("same"))
        b = await c.messages.create(**req("same"))
    assert inner.calls == 1 and b.content[0].text == "first" == a.content[0].text
    rs = await rows(env.phase)
    assert [r.status for r in rs] == ["succeeded", "cache_hit"] and rs[1].cost_usd == 0


async def test_force_sends_it_again_and_is_recorded_and_counted(env):
    inner = FakeInner([message("one"), message("two")])
    c = m.MeteredClient(inner)
    with m.ai_scope(reference_video_id=env.ref):
        await c.messages.create(**req("same"))
    with m.ai_scope(reference_video_id=env.ref, force=True):
        out = await c.messages.create(**req("same"))
    assert inner.calls == 2 and out.content[0].text == "two"
    rs = await rows(env.phase)
    assert [r.status for r in rs] == ["succeeded", "succeeded"] and rs[1].forced is True


async def test_the_same_request_for_another_reference_is_not_treated_as_a_duplicate(env):
    async with _Session() as s:
        rid2 = (await s.execute(text("INSERT INTO reference_videos (user_id, asset_id, source, rights_status) VALUES (:u,:a,'upload','unknown_third_party') RETURNING id"), {"u": env.uid, "a": env.asset})).scalar()
        await s.commit()
    inner = FakeInner()
    c = m.MeteredClient(inner)
    with m.ai_scope(reference_video_id=env.ref):
        await c.messages.create(**req("same"))
    with m.ai_scope(reference_video_id=rid2):
        await c.messages.create(**req("same"))
    assert inner.calls == 2


async def test_a_concurrent_identical_call_is_refused_while_the_first_is_in_flight(env):
    inner = FakeInner(delay=0.4)
    c = m.MeteredClient(inner)

    async def go():
        with m.ai_scope(reference_video_id=env.ref):
            return await c.messages.create(**req("double click"))

    res = await asyncio.gather(go(), go(), return_exceptions=True)
    assert sum(not isinstance(r, Exception) for r in res) == 1
    err = next(r for r in res if isinstance(r, Exception))
    assert isinstance(err, m.AiCostControlError) and err.code == "duplicate_in_flight" and inner.calls == 1


# ── retries and failed attempts ──
async def test_transient_errors_retry_at_most_twice_and_every_attempt_is_accounted(env):
    inner = FakeInner([status_error(529), status_error(500), message("finally", 100, 100)])
    with m.ai_scope(reference_video_id=env.ref):
        out = await m.MeteredClient(inner).messages.create(**req())
    assert out.content[0].text == "finally" and inner.calls == 3
    rs = await rows(env.phase)
    assert [(r.attempt_no, r.status) for r in rs] == [(1, "failed"), (2, "failed"), (3, "succeeded")]
    assert rs[0].cost_usd == 0 and rs[1].cost_usd == 0                    # an error status from the provider is not billed


async def test_retries_stop_after_the_limit(env):
    inner = FakeInner([status_error(529)] * 5)
    with pytest.raises(anthropic.APIStatusError):
        with m.ai_scope(reference_video_id=env.ref):
            await m.MeteredClient(inner).messages.create(**req())
    assert inner.calls == 3                                               # 1 + AI_RETRY_MAX
    assert len(await rows(env.phase)) == 3


async def test_a_client_error_is_never_retried(env):
    inner = FakeInner([status_error(400)])
    with pytest.raises(anthropic.APIStatusError):
        await m.MeteredClient(inner).messages.create(**req())
    assert inner.calls == 1


async def test_a_lost_connection_is_charged_its_prompt_cost_because_billing_is_unknown(env):
    inner = FakeInner([conn_error(), message("ok", 10, 10)])
    with m.ai_scope(reference_video_id=env.ref):
        await m.MeteredClient(inner).messages.create(**req("x" * 3000))
    first = (await rows(env.phase))[0]
    assert first.status == "failed" and first.cost_usd == pytest.approx(first.est_input_usd) and first.cost_usd > 0


async def test_retries_cannot_run_past_the_cap(env, monkeypatch):
    monkeypatch.setattr(settings, "AI_PER_REFERENCE_BUDGET_USD", 0.025)
    inner = FakeInner([conn_error()] * 4)
    with pytest.raises((m.AiCostControlError, anthropic.APIConnectionError)):
        with m.ai_scope(reference_video_id=env.ref):
            await m.MeteredClient(inner).messages.create(**req("y" * 9000, max_tokens=1500))   # prompt ~0.006 charged per unknown-billing failure; ceiling ~0.021, so a second reservation (0.027) exceeds 0.025
    assert inner.calls == 1                                               # the second attempt's reservation would exceed the cap, so it is never sent


async def test_a_stale_reservation_from_a_crashed_process_only_costs_its_prompt(env, monkeypatch):
    monkeypatch.setattr(settings, "AI_PER_REFERENCE_BUDGET_USD", 0.05)
    async with _Session() as s:
        await s.execute(text("INSERT INTO ai_call_ledger (phase_id, reference_video_id, reasoner, provider, model, request_hash, attempt_no, status, forced, est_input_tokens, max_output_tokens, est_input_usd, reserved_usd, cost_usd, created_at) "
                             "VALUES (:p, :r, 'x', 'anthropic', 'claude-sonnet-5-5', 'h', 1, 'reserved', false, 0, 0, 0.001, 0.5, 0, now() - interval '2 hours')"), {"p": env.phase, "r": env.ref})
        await s.commit()
    inner = FakeInner()
    with m.ai_scope(reference_video_id=env.ref):
        await m.MeteredClient(inner).messages.create(**req())             # a live 0.5 reservation would exceed the 0.05 cap; the dead one counts only 0.001
    assert inner.calls == 1


async def test_the_ledger_failing_blocks_the_request(env, monkeypatch):
    def broken():
        raise RuntimeError("db down")
    monkeypatch.setattr(m, "session_factory", broken)
    inner = FakeInner()
    with pytest.raises(m.AiCostControlError) as e:
        await m.MeteredClient(inner).messages.create(**req())
    assert e.value.code == "ledger_unavailable" and inner.calls == 0


async def test_admin_summary_has_totals_and_never_a_key_or_prompt(env, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test-secret-value")
    inner = FakeInner()
    with m.ai_scope(reference_video_id=env.ref, reasoner="hook"):
        await m.MeteredClient(inner).messages.create(**req("a very secret prompt"))
    summary = await m.usage_summary()
    blob = repr(summary)
    assert summary["enabled"] is True and summary["key_configured"] is True and summary["phase"]["calls"] == 1
    assert summary["caps"] == {"per_reference_usd": 1.0, "phase_usd": 20.0}
    assert "sk-ant" not in blob and "secret prompt" not in blob and "response_json" not in blob
    assert summary["by_reference"][0]["reference_video_id"] == env.ref and summary["recent"][0]["reasoner"] == "hook"
