"""Recovery from a model reply that is paid for but unusable.
1. Deterministic JSON repair (free), tested on the REAL malformed reply saved from reference 5131 and on constructed cases.
2. Ledger behaviour (local database): a rejected reply is kept and counted but never served from the cache; at most ONE fresh retry; never a third try. A fake client stands in for the AI."""
import json
import secrets
import random
from pathlib import Path
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
from app.services.json_recovery import escape_inner_quotes, loads_lenient, strip_trailing_commas
from app.services.story_beat_reasoner.providers import anthropic_provider as sb

FIXTURE = Path(__file__).parent / "fixtures" / "story_beat_malformed_reply_5131.txt"


# ── 1. deterministic repair ──
def test_the_real_malformed_reply_from_5131_is_repaired_without_changing_a_word():
    raw = FIXTURE.read_text(encoding="utf8").strip()
    with pytest.raises(json.JSONDecodeError):
        json.loads(raw)                                                                   # it really is invalid as the model sent it
    data, notes = loads_lenient(raw)
    assert notes == ["escaped 2 unescaped quotation mark(s) inside text"]
    assert '("NET WT fLOZ (100g)")' in data["reasoning"]                                  # the quoted label is intact, quotes and all
    assert data["is_story_beat_boundary"] is False and data["confidence"] == "medium"
    assert data["evidence_references"]["supporting_speech_segment_ids"] == [721, 722]
    assert data["evidence_references"]["supporting_annotation_ids"] == [15873, 15874, 15875, 15876, 15877, 15878]
    # the provider's own parser and shape check accept it
    assert sb._parse_response_json(raw) == data
    sb._validate_response_shape(data)


def test_valid_json_is_never_touched():
    raw = '{"a": "he said \\"hi\\"", "b": [1, 2, {"c": "x, \\"y\\""}], "d": null}'
    obj, notes = loads_lenient(raw)
    assert obj == json.loads(raw) and notes == []
    assert escape_inner_quotes(raw) == (raw, 0)


@pytest.mark.parametrize("raw,expected,note", [
    ('{"t": "label ("A B") here", "n": 1}', {"t": 'label ("A B") here', "n": 1}, "escaped"),
    ('{"t": "he said "go", then left", "n": 1}', {"t": 'he said "go", then left', "n": 1}, "escaped"),
    ('{"a": [1, 2, 3,], "b": {"c": 1,},}', {"a": [1, 2, 3], "b": {"c": 1}}, "trailing"),
    ('Here is the JSON:\n```json\n{"a": 1}\n```\nThanks', {"a": 1}, "extracted"),
    ('{"list": ["one "quoted" word", "two"], "k": "v"}', {"list": ['one "quoted" word', "two"], "k": "v"}, "escaped"),
])
def test_common_defects_are_repaired_exactly(raw, expected, note):
    obj, notes = loads_lenient(raw)
    assert obj == expected and any(note in n for n in notes)


def test_repair_only_inserts_backslashes_it_never_rewrites_content():
    rnd = random.Random(7)
    words = ["alpha", "beta (gamma)", "NET WT", "100g", "x-y", "tile", "—"]
    for _ in range(200):
        value = " ".join(rnd.choice(words) for _ in range(rnd.randint(2, 7)))
        pos = rnd.randint(1, len(value) - 1)
        wrapped = value[:pos] + '"' + rnd.choice(words) + '"' + value[pos:]
        raw = '{"id": %d, "reasoning": "%s", "ok": true}' % (rnd.randint(1, 99), wrapped)
        obj, _ = loads_lenient(raw)
        assert obj["reasoning"] == wrapped and obj["ok"] is True


def test_unrepairable_replies_still_fail_with_the_original_error():
    for raw in ('{"a": "unterminated', '{"a": 1, "b": }', "no json at all", "", '{"a": [1, 2'):
        with pytest.raises(json.JSONDecodeError):
            loads_lenient(raw)


def test_every_reasoner_parser_uses_the_repair():
    from app.services.blueprint_reasoner import parsing as bp
    from app.services.hook_reasoner.providers import anthropic_provider as hk
    from app.services.mechanism_reasoner import parsing as mp
    from app.services.retention_reasoner.providers import anthropic_provider as rt
    from app.services.semantic_reasoner.providers import anthropic_provider as sm
    raw = 'prefix {"reasoning": "quoted ("word") inside", "x": 1} suffix'
    for fn in (sb._parse_response_json, hk._parse_response_json, rt._parse_response_json, sm._parse_response_json, mp.parse_json_object, bp.parse_json_object):
        assert fn(raw)["reasoning"] == 'quoted ("word") inside', fn


# ── 2. ledger behaviour for a rejected reply ──
pytestmark_db = pytest.mark.skipif(not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")), reason="writes ledger rows: local database only")
_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


class Rejected(Exception):
    """Stands in for a reasoner's own 'the reply was unusable' error."""


def msg(text_, i=1000, o=500):
    return anthropic.types.Message(id="m", type="message", role="assistant", model="claude-haiku-5-5", stop_reason="end_turn", stop_sequence=None,
                                   content=[anthropic.types.TextBlock(type="text", text=text_)], usage=anthropic.types.Usage(input_tokens=i, output_tokens=o))


class Fake:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), 0
        self.messages = SimpleNamespace(create=self.create)

    async def create(self, **kw):
        self.calls += 1
        r = self.replies.pop(0) if self.replies else msg('{"ok": true}')
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture()
async def env(monkeypatch):
    async with _engine.begin() as conn:
        await conn.run_sync(AiCallLedger.__table__.create, checkfirst=True)
    phase = f"m6rc_{secrets.token_hex(4)}"
    monkeypatch.setattr(m, "session_factory", _Session)
    monkeypatch.setattr(m, "BACKOFF_SECONDS", (0.0, 0.0))
    for k, v in dict(AI_SPEND_ENABLED=True, AI_PHASE_ID=phase, AI_PER_REFERENCE_BUDGET_USD=1.0, AI_PHASE_BUDGET_USD=20.0, AI_RETRY_MAX=2).items():
        monkeypatch.setattr(settings, k, v)
    async with _Session() as s:
        uid = (await s.execute(text("SELECT id FROM users ORDER BY id LIMIT 1"))).scalar()
        if uid is None:
            uid = (await s.execute(text("INSERT INTO users (username, email, hashed_password, role, is_active) VALUES ('m6rc_u','m6rc_u@example.test','x','editor',true) RETURNING id"))).scalar()
        aid = (await s.execute(text("INSERT INTO assets (user_id, original_filename, stored_filename, file_path, file_type, mime_type, file_size) VALUES (:u,'m6rc.mp4','m6rc.mp4','uploads/x/m6rc.mp4','video','video/mp4',1) RETURNING id"), {"u": uid})).scalar()
        rid = (await s.execute(text("INSERT INTO reference_videos (user_id, asset_id, source, rights_status) VALUES (:u,:a,'upload','unknown_third_party') RETURNING id"), {"u": uid, "a": aid})).scalar()
        await s.commit()
    yield SimpleNamespace(phase=phase, ref=rid)
    async with _Session() as s:
        await s.execute(delete(AiCallLedger).where(AiCallLedger.phase_id == phase))
        await s.execute(text("DELETE FROM reference_videos WHERE asset_id = :a"), {"a": aid})
        await s.execute(text("DELETE FROM assets WHERE id = :i"), {"i": aid})
        await s.execute(text("DELETE FROM users WHERE username = 'm6rc_u'"))
        await s.commit()


async def rows(phase):
    async with _Session() as s:
        return (await s.execute(select(AiCallLedger).where(AiCallLedger.phase_id == phase).order_by(AiCallLedger.id))).scalars().all()


def reasoner(client):
    """A tiny reasoner: asks the AI, then validates the reply the way the real ones do (raises its own error when the JSON is unusable)."""
    async def call():
        reply = await client.messages.create(model="claude-haiku-5-5", max_tokens=1000, messages=[{"role": "user", "content": "same question"}])
        text_ = reply.content[0].text
        try:
            return json.loads(text_)
        except json.JSONDecodeError as exc:
            raise Rejected(f"could not be parsed: {exc.msg}") from exc
    return call


@pytestmark_db
async def test_a_rejected_reply_is_kept_and_counted_then_one_fresh_request_succeeds(env):
    ai = Fake([msg('{"truncated": "oops'), msg('{"ok": true}')])
    c = m.MeteredClient(ai)
    with m.ai_scope(reference_video_id=env.ref, reasoner="scene_story_beats"):
        out = await m.run_reasoner_call(reasoner(c))
    assert out == {"ok": True} and ai.calls == 2
    rs = await rows(env.phase)
    assert [r.status for r in rs] == ["invalid_output", "succeeded"] and rs[1].forced is True
    assert "rejected: Rejected" in rs[0].error and rs[0].response_json and rs[0].cost_usd > 0          # the paid reply is kept, with its cost
    u = await m.usage_summary()
    assert u["phase"]["invalid_replies"] == 1 and u["phase"]["spent_usd"] == pytest.approx(rs[0].cost_usd + rs[1].cost_usd)


@pytestmark_db
async def test_the_bad_reply_is_never_served_from_the_cache_afterwards(env):
    ai = Fake([msg("not json at all"), msg('{"ok": true}')])
    c = m.MeteredClient(ai)
    with m.ai_scope(reference_video_id=env.ref):
        with pytest.raises(Rejected):
            await m.run_reasoner_call(reasoner(c), retry_once=False)                         # rejected, no retry: the bad reply must now be inert
        out = await m.run_reasoner_call(reasoner(c), retry_once=False)                        # the SAME request again, not forced
    assert out == {"ok": True} and ai.calls == 2                                              # it was sent again, not answered with the bad reply
    assert [r.status for r in await rows(env.phase)] == ["invalid_output", "succeeded"]


@pytestmark_db
async def test_two_rejections_stop_at_two_requests_and_both_stay_in_the_ledger(env):
    ai = Fake([msg("{bad"), msg("{still bad")])
    c = m.MeteredClient(ai)
    with m.ai_scope(reference_video_id=env.ref):
        with pytest.raises(Rejected):
            await m.run_reasoner_call(reasoner(c))
    assert ai.calls == 2                                                                      # never a third try
    rs = await rows(env.phase)
    assert [r.status for r in rs] == ["invalid_output", "invalid_output"] and all(r.response_json for r in rs)
    assert "rejected again" in rs[1].error


@pytestmark_db
async def test_failures_that_are_not_a_rejected_reply_are_never_retried_here(env):
    ai = Fake([anthropic.APIStatusError("bad", response=httpx.Response(400, request=httpx.Request("POST", "https://x.test")), body=None)])
    c = m.MeteredClient(ai)
    with m.ai_scope(reference_video_id=env.ref):
        with pytest.raises(anthropic.APIStatusError):
            await m.run_reasoner_call(reasoner(c))
    assert ai.calls == 1
    m_off = None
    settings.AI_SPEND_ENABLED = False
    with pytest.raises(m.AiCostControlError):
        await m.run_reasoner_call(reasoner(m.MeteredClient(Fake([]))))                      # a kill switch is raised as is: no second try, nothing marked
    settings.AI_SPEND_ENABLED = True


@pytestmark_db
async def test_a_valid_reply_is_untouched_and_a_note_can_be_recorded(env):
    ai = Fake([msg('{"ok": true}')])
    c = m.MeteredClient(ai)
    with m.ai_scope(reference_video_id=env.ref):
        out = await m.run_reasoner_call(reasoner(c))
        await m.note_last_success("repaired: escaped 2 quotation mark(s)")
    assert out == {"ok": True}
    (r,) = await rows(env.phase)
    assert r.status == "succeeded" and r.error == "repaired: escaped 2 quotation mark(s)" and ai.calls == 1
