"""The $1-per-reference and $20-phase limits across the WHOLE AI workflow, driven with the real system prompts and the real output caps of every reasoner (semantic, story beat, hook, retention x N,
mechanism, blueprint, creative read), with the WORST-CASE answer (every call uses its full output budget). A fake client stands in for the AI: no key, no network, no spend.
Local database only: private phase id, throwaway references."""
import asyncio
import secrets
from types import SimpleNamespace

import anthropic
import pytest
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.ai_call_ledger import AiCallLedger
from app.services import ai_metering as m
from app.services.blueprint_reasoner.providers import anthropic_provider as p_blueprint
from app.services.creative_reader import provider as p_creative
from app.services.hook_reasoner.providers import anthropic_provider as p_hook
from app.services.mechanism_reasoner.providers import anthropic_provider as p_mechanism
from app.services.retention_reasoner.providers import anthropic_provider as p_retention
from app.services.semantic_reasoner.providers import anthropic_provider as p_semantic
from app.services.story_beat_reasoner.providers import anthropic_provider as p_story

pytestmark = pytest.mark.skipif(
    not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")),
    reason="writes ledger rows: only runs against a database on this machine",
)

_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

SMALL, BIG = "claude-haiku-5-5", "claude-sonnet-5-5"


class WorstCaseAI:
    """Answers every request using its FULL output budget and half its estimated prompt: the most expensive honest answer."""
    def __init__(self):
        self.calls = 0
        self.messages = SimpleNamespace(create=self.create)

    async def create(self, **kw):
        self.calls += 1
        return anthropic.types.Message(id=f"m{self.calls}", type="message", role="assistant", model=kw["model"], stop_reason="end_turn", stop_sequence=None,
                                       content=[anthropic.types.TextBlock(type="text", text="{}")],
                                       usage=anthropic.types.Usage(input_tokens=m.estimate_input_tokens(kw) // 2, output_tokens=kw["max_tokens"]))


def request(stage, system, user_chars, max_tokens, model, tag="", images=0):
    content = [{"type": "text", "text": f"{stage}{tag} " + "x" * user_chars}] + [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "QUJD"}}] * images
    return dict(model=model, max_tokens=max_tokens, system=system, messages=[{"role": "user", "content": content}])


def workflow(retention_n, small=SMALL, big=BIG, tag=""):
    """The calls one reference makes, in order, with the real prompts and caps; evidence sizes are those measured for a 10-60 s reference."""
    yield "semantic", request("semantic", p_semantic.SYSTEM_PROMPT, 14_000, p_semantic.MAX_RESPONSE_TOKENS, small, tag)
    yield "story_beat", request("story", p_story.SYSTEM_PROMPT, 14_000, p_story.MAX_RESPONSE_TOKENS, small, tag)
    yield "hook", request("hook", p_hook.SYSTEM_PROMPT, 6_000, p_hook.MAX_RESPONSE_TOKENS, small, tag)
    for i in range(retention_n):
        yield "retention", request("retention", p_retention.SYSTEM_PROMPT, 7_000, p_retention.MAX_RESPONSE_TOKENS, small, f"{tag}#{i}")
    yield "mechanism", request("mechanism", p_mechanism.SYSTEM_PROMPT, 20_000, p_mechanism.MAX_RESPONSE_TOKENS, big, tag)
    yield "blueprint", request("blueprint", p_blueprint.SYSTEM_PROMPT, 30_000, p_blueprint.MAX_RESPONSE_TOKENS, big, tag)
    yield "creative_read", request("creative", p_creative.SYSTEM_PROMPT, 9_000, p_creative.MAX_RESPONSE_TOKENS, big, tag, images=12)


@pytest.fixture()
async def env(monkeypatch):
    async with _engine.begin() as conn:
        await conn.run_sync(AiCallLedger.__table__.create, checkfirst=True)
    phase = f"m6wf_{secrets.token_hex(4)}"
    monkeypatch.setattr(m, "session_factory", _Session)
    monkeypatch.setattr(m, "BACKOFF_SECONDS", (0.0, 0.0))
    for k, v in dict(AI_SPEND_ENABLED=True, AI_PHASE_ID=phase, AI_PER_REFERENCE_BUDGET_USD=1.0, AI_PHASE_BUDGET_USD=20.0).items():
        monkeypatch.setattr(settings, k, v)
    async with _Session() as s:
        uid = (await s.execute(text("SELECT id FROM users ORDER BY id LIMIT 1"))).scalar()
        if uid is None:
            uid = (await s.execute(text("INSERT INTO users (username, email, hashed_password, role, is_active) VALUES ('m6wf_u','m6wf_u@example.test','x','editor',true) RETURNING id"))).scalar()
        aid = (await s.execute(text("INSERT INTO assets (user_id, original_filename, stored_filename, file_path, file_type, mime_type, file_size) VALUES (:u,'m6wf.mp4','m6wf.mp4','uploads/x/m6wf.mp4','video','video/mp4',1) RETURNING id"), {"u": uid})).scalar()
        await s.commit()

    async def new_ref():
        async with _Session() as s:
            rid = (await s.execute(text("INSERT INTO reference_videos (user_id, asset_id, source, rights_status) VALUES (:u,:a,'upload','unknown_third_party') RETURNING id"), {"u": uid, "a": aid})).scalar()
            await s.commit()
        return rid

    yield SimpleNamespace(phase=phase, new_ref=new_ref, uid=uid)
    async with _Session() as s:
        await s.execute(delete(AiCallLedger).where(AiCallLedger.phase_id == phase))
        await s.execute(text("DELETE FROM reference_videos WHERE asset_id = :a"), {"a": aid})
        await s.execute(text("DELETE FROM assets WHERE id = :i"), {"i": aid})
        await s.execute(text("DELETE FROM users WHERE username = 'm6wf_u'"))
        await s.commit()


async def run_workflow(client, ref, uid, retention_n, **kw):
    """Returns (succeeded, refusals). A refusal stops that call only, as it would in the app (the stage fails with the message)."""
    ok, refused = 0, []
    for stage, req in workflow(retention_n, **kw):
        try:
            with m.ai_scope(reference_video_id=ref, user_id=uid, reasoner=stage):
                await client.messages.create(**req)
            ok += 1
        except m.AiCostControlError as e:
            refused.append((stage, e.code, str(e)))
    return ok, refused


async def spent(phase, ref=None):
    async with _Session() as s:
        q = "SELECT COALESCE(SUM(cost_usd),0) FROM ai_call_ledger WHERE phase_id = :p AND status IN ('succeeded','failed')" + (" AND reference_video_id = :r" if ref else "")
        params = {"p": phase, "r": ref} if ref else {"p": phase}
        return float((await s.execute(text(q), params)).scalar())


async def test_one_full_workflow_for_a_short_reference_fits_comfortably_under_the_cap(env):
    ai = WorstCaseAI()
    c = m.MeteredClient(ai)
    ref = await env.new_ref()
    ok, refused = await run_workflow(c, ref, env.uid, retention_n=5)
    total = await spent(env.phase, ref)
    assert refused == [] and ok == ai.calls == 3 + 5 + 3
    assert 0 < total < 0.6, total                                                  # worst-case output on every call, 10 s of evidence: still far below $1
    print(f"\n      full workflow, worst-case answers, 10 s reference: ${total:.3f} over {ok} calls")


async def test_the_per_reference_cap_stops_a_long_expensive_workflow_and_re_runs_cannot_exceed_it(env):
    ai = WorstCaseAI()
    c = m.MeteredClient(ai)
    ref = await env.new_ref()
    ok, refused = await run_workflow(c, ref, env.uid, retention_n=70, small=BIG)       # a very long video (70 retention candidates), the dearer model everywhere
    assert refused and all(code == "refused_budget" and "this reference" in msg for _stage, code, msg in refused)
    assert ai.calls == ok                                                              # every refusal happened BEFORE a request was sent
    total = await spent(env.phase, ref)
    assert total <= 1.0, total
    for _ in range(3):                                                                 # forced re-runs keep trying; none can push the reference past its cap
        with m.ai_scope(reference_video_id=ref, user_id=env.uid, force=True):
            for _stage, req in workflow(70, small=BIG):
                try:
                    await c.messages.create(**req)
                except m.AiCostControlError:
                    pass
    final = await spent(env.phase, ref)
    assert final <= 1.0
    print(f"\n      expensive very long workflow: spent ${final:.3f} of $1.00; {len(refused)} calls refused before sending")


async def test_a_reference_that_hits_its_cap_does_not_stop_a_new_reference(env):
    ai = WorstCaseAI()
    c = m.MeteredClient(ai)
    big_ref, fresh_ref = await env.new_ref(), await env.new_ref()
    await run_workflow(c, big_ref, env.uid, retention_n=70, small=BIG)
    ok, refused = await run_workflow(c, fresh_ref, env.uid, retention_n=5)
    assert refused == [] and await spent(env.phase, fresh_ref) < 0.6


async def test_the_phase_cap_stops_everything_even_when_each_reference_is_under_its_own_cap(env, monkeypatch):
    monkeypatch.setattr(settings, "AI_PHASE_BUDGET_USD", 2.0)
    ai = WorstCaseAI()
    c = m.MeteredClient(ai)
    refs = [await env.new_ref() for _ in range(8)]
    outcomes = []
    for r in refs:
        outcomes.append(await run_workflow(c, r, env.uid, retention_n=5, small=BIG))
    total = await spent(env.phase)
    assert total <= 2.0, total
    for r in refs:
        assert await spent(env.phase, r) <= 1.0
    phase_refusals = [msg for _ok, refused in outcomes for _s, _c, msg in refused if "this phase" in msg]
    assert phase_refusals, "the phase cap never engaged"
    late_ok, late_refused = outcomes[-1]
    assert late_ok == 0 and late_refused                                               # once the phase budget is gone the last reference gets nothing
    print(f"\n      phase cap $2.00: spent ${total:.3f} across {len(refs)} references; {len(phase_refusals)} calls refused for the phase")


async def test_running_the_same_workflow_again_is_free(env):
    ai = WorstCaseAI()
    c = m.MeteredClient(ai)
    ref = await env.new_ref()
    await run_workflow(c, ref, env.uid, retention_n=5)
    sent, cost = ai.calls, await spent(env.phase, ref)
    ok, refused = await run_workflow(c, ref, env.uid, retention_n=5)
    assert refused == [] and ai.calls == sent and await spent(env.phase, ref) == pytest.approx(cost)      # every call answered from the ledger at $0


async def test_two_workers_running_the_same_reference_cannot_double_spend(env):
    class SlowAI(WorstCaseAI):
        async def create(self, **kw):
            await asyncio.sleep(0.2)
            return await super().create(**kw)

    ai = SlowAI()
    c = m.MeteredClient(ai)
    ref = await env.new_ref()
    await asyncio.gather(run_workflow(c, ref, env.uid, retention_n=3), run_workflow(c, ref, env.uid, retention_n=3))
    distinct = len({m.request_hash(r) for _s, r in workflow(3)})
    assert ai.calls <= distinct, (ai.calls, distinct)                                  # each distinct request is paid at most once
    assert await spent(env.phase, ref) <= 1.0
