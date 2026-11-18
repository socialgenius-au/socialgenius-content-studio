"""Creative Read: frame selection, what the AI is shown, what is enforced about its answer, and what is stored. A FAKE client stands in for the AI: no key, no network, no spend.
The service tests use the local database only (their own `m6cr` rows)."""
import asyncio
import copy
import json
from types import SimpleNamespace

import anthropic
import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services import creative_read_svc as svc
from app.services import creative_reader as cr
from app.services.creative_reader import evidence as ev
from app.services.creative_reader import provider as prov
from app.services.creative_reader.contract import CreativeReadError, CreativeReadInputError, CreativeReadResult, Finding, ShotRead
from app.services.creative_reader.validation import parse_json_object, validate

# ── a 10 s, 4-shot reference shaped like reference 5128 (garbled OCR next to a legible product name; mixed-script speech) ──
def evidence_fixture() -> dict:
    def fr(i, t, w=720, h=1280):
        return {"id": i, "order": 0, "timestamp": t, "asset_file_path": f"uploads/1/f{i}.jpg", "width": w, "height": h}
    shots = [
        {"id": 1, "order": 1, "start_time": 0.0, "end_time": 2.0, "frames": [fr(101, 0.3), fr(102, 1.0), fr(103, 1.7)],
         "text_elements": [{"id": 201, "text": "BARAKAH FOODS", "confidence_score": 0.92}, {"id": 202, "text": "Realing Sloving Waites", "confidence_score": 0.21}]},
        {"id": 2, "order": 2, "start_time": 2.0, "end_time": 3.96, "frames": [fr(104, 2.5), fr(105, 3.4)], "text_elements": []},
        {"id": 3, "order": 3, "start_time": 3.96, "end_time": 6.0, "frames": [fr(106, 4.4), fr(107, 5.0), fr(108, 5.6)], "text_elements": []},
        {"id": 4, "order": 4, "start_time": 6.0, "end_time": 10.03, "frames": [fr(109, 6.5), fr(110, 8.0), fr(111, 9.5)], "text_elements": [{"id": 203, "text": "0", "confidence_score": 0.3}]},
    ]
    return {"technical_details": {"container": {"duration_seconds": 10.03}}, "shots": shots,
            "speech_segments": [{"id": 301, "start_time": 0.0, "end_time": 3.9, "text": "hundred percent pure, nothing added at all", "language": "ur", "confidence_score": 0.35},
                                {"id": 302, "start_time": 6.0, "end_time": 9.8, "text": "made with care and a family recipe", "language": "ur", "confidence_score": 0.8}]}


def good_response(**over) -> dict:
    d = {
        "summary": "The video appears to open on a close product shot and then moves to food preparation.",
        "shots": [{"shot_order": 1, "focal_subject": "a jar on a table", "framing": "close, centred", "notes": None}, {"shot_order": 2, "focal_subject": "a bowl", "framing": "overhead"}],
        "findings": [{
            "kind": "hook_visual", "statement": "The opening appears designed to show the product up close before anything else.",
            "start_time": 0.0, "end_time": 2.0, "shot_orders": [1],
            "evidence": [{"type": "frame", "id": 101}, {"type": "text", "id": 201}], "confidence": "high", "mechanism_type": "hook_curiosity",
            "transferable_principle": "Opening on the subject itself, framed tightly, may orient the viewer before any explanation.",
            "source_specific": "A jar with a green label."}],
        "limitations": ["The on-screen text next to the product name looks garbled and was not relied on."],
    }
    d.update(over)
    return d


def prepared_fixture(max_frames=12) -> dict:
    return ev.build_input(evidence_fixture(), max_frames=max_frames)


# ── frame selection ──
def test_every_shot_is_seen_and_the_hook_shot_gets_extra_frames_first():
    frames = [{"id": f["id"], "shot_order": s["order"], "timestamp": f["timestamp"]} for s in evidence_fixture()["shots"] for f in s["frames"]]
    sel = ev.select_frames(frames, 6)
    assert {f["shot_order"] for f in sel} == {1, 2, 3, 4}
    assert sum(f["shot_order"] == 1 for f in sel) >= 2 and len(sel) == 6
    assert [f["timestamp"] for f in sel] == sorted(f["timestamp"] for f in sel)
    assert ev.select_frames(frames, 6) == sel                                            # deterministic


def test_selection_is_bounded_and_survives_more_shots_than_frames():
    frames = [{"id": i, "shot_order": i, "timestamp": float(i)} for i in range(1, 31)]
    sel = ev.select_frames(frames, 12)
    assert len(sel) == 12 and sel[0]["timestamp"] <= 3 and sel[-1]["timestamp"] >= 25      # an even spread across the whole video
    assert ev.select_frames(frames, 0) == [] and ev.select_frames([], 5) == []
    assert len(ev.select_frames(frames[:3], 12)) == 3


def test_the_input_carries_ids_confidences_and_a_stable_fingerprint():
    p = prepared_fixture(6)
    assert p["video"] == {"duration_seconds": 10.03, "shot_count": 4}
    assert {s["id"] for s in p["speech"]} == {301, 302} and {t["id"] for t in p["text"]} == {201, 202, 203}
    assert p["text"][1]["confidence"] == 0.21 and p["speech"][0]["confidence"] == 0.35
    assert len(p["frames"]) == 6 and p["dropped"]["frames"] == 5
    assert prepared_fixture(6)["fingerprint"] == p["fingerprint"]
    changed = evidence_fixture()
    changed["speech_segments"][0]["text"] = "something else entirely"
    assert ev.build_input(changed, max_frames=6)["fingerprint"] != p["fingerprint"]


# ── images ──
async def test_missing_frames_are_reported_not_invented(tmp_path):
    p = prepared_fixture(4)
    here = tmp_path / "ok.jpg"
    here.write_bytes(b"\xff\xd8jpeg")
    p["frames"][0]["path"] = str(here)
    calls = []

    async def runner(path, width):
        calls.append((path, width))
        return b"\xff\xd8small"

    images, notes = await ev.load_images(p, 480, runner)
    assert len(images) == 1 and images[0]["frame_id"] == p["frames"][0]["id"] and images[0]["media_type"] == "image/jpeg" and calls == [(str(here), 480)]
    assert len(notes) == len(p["frames"]) - 1 and all("no longer on the server" in n for n in notes)


async def test_an_unreadable_frame_is_skipped_and_noted(tmp_path):
    p = prepared_fixture(2)
    f = tmp_path / "bad.jpg"
    f.write_bytes(b"x")
    for fr in p["frames"]:
        fr["path"] = str(f)

    async def boom(path, width):
        raise RuntimeError("corrupt")

    images, notes = await ev.load_images(p, 480, boom)
    assert images == [] and len(notes) == 2 and "could not be read" in notes[0]


# ── what the AI is shown ──
def test_the_prompt_interleaves_labelled_images_with_the_evidence_and_never_leaks_paths():
    p = prepared_fixture(3)
    images = [{"frame_id": f["id"], "shot_order": f["shot_order"], "timestamp": f["timestamp"], "media_type": "image/jpeg", "data": "QUJD"} for f in p["frames"]]
    (msg,) = prov.build_messages(p, images)
    blocks = msg["content"]
    kinds = [b["type"] for b in blocks]
    assert kinds.count("image") == 3 and kinds[0] == "text" and kinds[-1] == "text"
    i = kinds.index("image")
    assert blocks[i - 1]["type"] == "text" and f"Frame id {images[0]['frame_id']}" in blocks[i - 1]["text"] and blocks[i]["source"] == {"type": "base64", "media_type": "image/jpeg", "data": "QUJD"}
    tail = blocks[-1]["text"]
    assert '"id":201' in tail and '"id":301' in tail and "BARAKAH FOODS" in tail
    assert "uploads/" not in json.dumps(blocks) and ".jpg" not in json.dumps(blocks)             # file paths never reach the AI
    assert "ONLY ids you were given" in prov.SYSTEM_PROMPT and "never claim results" in prov.SYSTEM_PROMPT


# ── what is enforced about the answer ──
def check_rejects(mutate, needle, prepared=None):
    data = good_response()
    mutate(data)
    with pytest.raises(CreativeReadError) as e:
        validate(data, prepared or prepared_fixture())
    assert needle in str(e.value), str(e.value)


def test_a_good_response_is_accepted_and_typed():
    r = validate(good_response(), prepared_fixture(), model="m", usage={"input_tokens": 1})
    assert isinstance(r, CreativeReadResult) and len(r.findings) == 1 and r.findings[0].confidence == "high" and r.findings[0].mechanism_type == "hook_curiosity"
    assert r.shots[0].focal_subject == "a jar on a table" and r.limitations and r.model == "m"


def test_fenced_json_parses_and_garbage_does_not():
    assert parse_json_object("```json\n{\"a\": 1}\n```") == {"a": 1}
    assert parse_json_object("Here you go: {\"a\": 1} thanks") == {"a": 1}
    for bad in ("", "no json here", "{not json", "[1,2]"):
        with pytest.raises(CreativeReadError):
            parse_json_object(bad)


def test_invented_evidence_is_rejected():
    check_rejects(lambda d: d["findings"][0]["evidence"].append({"type": "frame", "id": 99999}), "not provided")
    check_rejects(lambda d: d["findings"][0]["evidence"].append({"type": "speech", "id": 201}), "not provided")          # an OCR id is not a speech id
    check_rejects(lambda d: d["findings"][0].update(evidence=[]), "cites no evidence")
    check_rejects(lambda d: d["findings"][0].update(shot_orders=[9]), "existing shots")
    check_rejects(lambda d: d["shots"].append({"shot_order": 9, "focal_subject": "x", "framing": "y"}), "does not exist")


def test_only_frames_the_ai_was_actually_shown_may_be_cited():
    p = prepared_fixture(12)
    shown = dict(p)
    shown["frames"] = [f for f in p["frames"] if f["id"] != 101]
    with pytest.raises(CreativeReadError) as e:
        validate(good_response(), shown)
    assert "not provided" in str(e.value)


def test_confidence_can_never_exceed_the_evidence():
    check_rejects(lambda d: d["findings"][0].update(evidence=[{"type": "frame", "id": 101}]), "single kind")                                    # high from one kind
    check_rejects(lambda d: d["findings"][0].update(evidence=[{"type": "frame", "id": 101}, {"type": "text", "id": 202}]), "only supports 'low'")   # garbled OCR (0.21)
    check_rejects(lambda d: d["findings"][0].update(evidence=[{"type": "frame", "id": 101}, {"type": "speech", "id": 301}], confidence="high"), "only supports 'low'")   # speech 0.35
    ok = good_response()
    ok["findings"][0].update(evidence=[{"type": "frame", "id": 101}, {"type": "speech", "id": 301}], confidence="low")
    assert validate(ok, prepared_fixture()).findings[0].confidence == "low"
    mid = good_response()
    mid["findings"][0].update(evidence=[{"type": "frame", "id": 101}, {"type": "text", "id": 203}], confidence="medium")
    with pytest.raises(CreativeReadError):
        validate(mid, prepared_fixture())                                                                                                     # OCR 0.3 only supports low


def test_time_ranges_must_fit_the_video_and_the_shots_named():
    check_rejects(lambda d: d["findings"][0].update(start_time=5.0, end_time=4.0), "invalid time range")
    check_rejects(lambda d: d["findings"][0].update(end_time=99.0), "invalid time range")
    check_rejects(lambda d: d["findings"][0].update(start_time=7.0, end_time=8.0), "outside the shots it names")


def test_performance_claims_and_unhedged_intent_are_rejected():
    check_rejects(lambda d: d["findings"][0].update(statement="This opening kept viewers watching until the end."), "prohibited")
    check_rejects(lambda d: d["findings"][0].update(statement="The close shot works because it holds attention."), "prohibited")
    check_rejects(lambda d: d.update(summary="This video is designed to hook viewers instantly."), "without qualification")
    check_rejects(lambda d: d["findings"][0].update(statement="The opening is designed to show the product first."), "without qualification")
    check_rejects(lambda d: d["findings"][0].update(transferable_principle="The cut at 0:02 is designed to reset attention."), "")


def test_the_transferable_principle_must_not_copy_the_source_or_point_at_it():
    check_rejects(lambda d: d["findings"][0].update(transferable_principle="Say hundred percent pure nothing added at all to the viewer."), "reproduces")
    check_rejects(lambda d: d["findings"][0].update(transferable_principle="The shot at 0:02 appears to reset attention."), "timestamps")


def test_shapes_kinds_vocabulary_and_size_are_enforced():
    check_rejects(lambda d: d["findings"][0].update(kind="viral_score"), "is not one of")
    check_rejects(lambda d: d["findings"][0].update(mechanism_type="magic"), "mechanism vocabulary")
    check_rejects(lambda d: d["findings"][0].update(confidence="certain"), "confidence")
    check_rejects(lambda d: d.pop("limitations"), "missing 'limitations'")
    check_rejects(lambda d: d.update(findings=[copy.deepcopy(d["findings"][0]) for _ in range(15)]), "at most 14")
    check_rejects(lambda d: d.update(summary=""), "summary")


# ── provider ──
class FakeClient:
    def __init__(self, reply=None, exc=None):
        self.kwargs = None
        self.reply, self.exc = reply, exc
        self.messages = SimpleNamespace(create=self.create)

    async def create(self, **kw):
        self.kwargs = kw
        if self.exc:
            raise self.exc
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(self.reply))], stop_reason="end_turn", usage=SimpleNamespace(input_tokens=1234, output_tokens=321))


def _imgs(p):
    return [{"frame_id": f["id"], "shot_order": f["shot_order"], "timestamp": f["timestamp"], "media_type": "image/jpeg", "data": "QUJD"} for f in p["frames"]]


async def test_provider_sends_images_with_a_bounded_budget_and_returns_a_validated_result(monkeypatch):
    fake = FakeClient(good_response())
    monkeypatch.setattr(prov, "get_client", lambda: fake)
    p = prepared_fixture(12)
    out = await prov.AnthropicCreativeReader().read(p, _imgs(p), model="claude-sonnet-5-5")
    assert fake.kwargs["model"] == "claude-sonnet-5-5" and fake.kwargs["max_tokens"] == prov.MAX_RESPONSE_TOKENS == 6000
    assert sum(b["type"] == "image" for b in fake.kwargs["messages"][0]["content"]) == len(p["frames"])
    assert out.usage == {"input_tokens": 1234, "output_tokens": 321} and out.findings[0].evidence[0] == {"type": "frame", "id": 101}


async def test_provider_maps_ai_errors_and_rejects_citing_an_unshown_frame(monkeypatch):
    p = prepared_fixture(12)
    monkeypatch.setattr(prov, "get_client", lambda: FakeClient(exc=anthropic.AnthropicError("boom")))
    with pytest.raises(CreativeReadError) as e:
        await prov.AnthropicCreativeReader().read(p, _imgs(p), model="m")
    assert "boom" in str(e.value)
    monkeypatch.setattr(prov, "get_client", lambda: FakeClient(good_response()))
    without_101 = [i for i in _imgs(p) if i["frame_id"] != 101]
    with pytest.raises(CreativeReadError) as e2:
        await prov.AnthropicCreativeReader().read(p, without_101, model="m")
    assert "not provided" in str(e2.value)


async def test_the_router_refuses_when_not_opted_in_or_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "CREATIVE_READ_REASONER_PROVIDER", "")
    with pytest.raises(CreativeReadError) as e:
        await cr.read_video(prepared_fixture(), [])
    assert "CREATIVE_READ_REASONER_PROVIDER is empty" in str(e.value)
    monkeypatch.setattr(settings, "CREATIVE_READ_REASONER_PROVIDER", "mystery")
    with pytest.raises(CreativeReadError):
        await cr.read_video(prepared_fixture(), [])
    monkeypatch.setattr(settings, "CREATIVE_READ_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    with pytest.raises(CreativeReadError) as e3:
        await cr.read_video(prepared_fixture(), [])
    assert "not configured" in str(e3.value)


def test_settings_default_to_off_and_the_approved_bounds():
    fresh = type(settings)(_env_file=None)
    assert fresh.CREATIVE_READ_REASONER_PROVIDER == "" and fresh.CREATIVE_READ_MAX_FRAMES == 12 and fresh.CREATIVE_READ_FRAME_WIDTH == 480


# ── service (local database) ──
pytestmark_db = pytest.mark.skipif(
    not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")),
    reason="writes rows: only runs against a database on this machine",
)

_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


@pytest.fixture()
async def world(monkeypatch, tmp_path):
    async with _Session() as db:
        user = (await db.execute(select(User).order_by(User.id).limit(1))).scalars().first()
        if user is None:
            await db.execute(text("INSERT INTO users (username, email, hashed_password, role, is_active) VALUES ('m6cr_u','m6cr_u@example.test','x','editor',true)"))
            await db.commit()
            user = (await db.execute(select(User).order_by(User.id).limit(1))).scalars().first()
        asset = Asset(user_id=user.id, original_filename="m6cr.mp4", stored_filename="m6cr.mp4", file_path="uploads/m6cr.mp4", file_type="video", mime_type="video/mp4", file_size=1)
        db.add(asset)
        await db.flush()
        rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=10.03)
        db.add(rv)
        await db.flush()
        va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
        db.add(va)
        await db.commit()
        ids = SimpleNamespace(user=user, rv=rv.id, va=va.id, asset=asset.id)
    state = SimpleNamespace(calls=0, evidence=evidence_fixture(), images_ok=True, reply=good_response())

    async def fake_build(db, u, ref, video_analysis_id=None):
        return {"video_analysis": {"id": ids.va}, "evidence": state.evidence}

    async def fake_load_images(prepared, width, runner=None):
        if not state.images_ok:
            return [], ["all frames missing"]
        return _imgs(prepared), ["one frame missing"]

    async def fake_read(prepared, images):
        state.calls += 1
        if isinstance(state.reply, Exception):
            raise state.reply
        return validate(state.reply, prepared, model="claude-sonnet-5-5", usage={"input_tokens": 10, "output_tokens": 5})

    monkeypatch.setattr(svc, "build_full_deconstruction", fake_build)
    monkeypatch.setattr(svc, "load_images", fake_load_images)
    monkeypatch.setattr(svc, "read_video", fake_read)
    monkeypatch.setattr(settings, "CREATIVE_READ_REASONER_PROVIDER", "anthropic")
    yield ids, state
    async with _Session() as db:
        await db.execute(delete(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == ids.va))
        rv = await db.get(ReferenceVideo, ids.rv)
        if rv:
            await db.delete(rv)
            await db.flush()
        a = await db.get(Asset, ids.asset)
        if a:
            await db.delete(a)
        await db.execute(text("DELETE FROM users WHERE username = 'm6cr_u'"))
        await db.commit()
    await _engine.dispose()


@pytestmark_db
async def test_a_run_is_stored_as_inferred_ai_vision_annotations_and_reused_without_a_second_call(world):
    ids, state = world
    async with _Session() as db:
        first = await svc.run_creative_read(db, ids.user, ids.rv)
    assert state.calls == 1 and first["status"] == "current" and first["reused"] is False and len(first["findings"]) == 1
    f = first["findings"][0]
    assert f["certainty"] == "INFERRED" and f["confidence"] == "high" and f["basis"] == "ai_vision" and f["mechanism_type"] == "hook_curiosity" and f["evidence"][0] == {"type": "frame", "id": 101}
    assert first["provenance"]["basis"] == "ai_vision" and first["provenance"]["frames_shown"] and "one frame missing" in first["limitations"]
    async with _Session() as db:
        rows = (await db.execute(select(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == ids.va))).scalars().all()
    assert sorted(r.category for r in rows) == ["creative_finding", "creative_read"] and all(r.source == "ai_vision" and r.certainty == "INFERRED" for r in rows)
    async with _Session() as db:
        again = await svc.run_creative_read(db, ids.user, ids.rv)
    assert state.calls == 1 and again["reused"] is True and again["findings"] == first["findings"]            # no second paid call
    async with _Session() as db:
        await svc.run_creative_read(db, ids.user, ids.rv, force=True)
    assert state.calls == 2                                                                                    # an explicit re-run does call, and replaces (not duplicates) the rows
    async with _Session() as db:
        n = (await db.execute(select(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == ids.va))).scalars().all()
    assert len(n) == 2


@pytest.mark.skipif(not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")), reason="local database only")
async def test_changed_evidence_makes_a_new_read_and_a_failure_keeps_the_old_one(world):
    ids, state = world
    async with _Session() as db:
        await svc.run_creative_read(db, ids.user, ids.rv)
    state.evidence["speech_segments"][0]["text"] = "completely different words"
    state.reply = CreativeReadError("the AI answered badly")
    async with _Session() as db:
        with pytest.raises(CreativeReadError):
            await svc.run_creative_read(db, ids.user, ids.rv)
    async with _Session() as db:
        kept = await svc.get_creative_read(db, ids.user, ids.rv)
    assert kept["status"] == "current" and len(kept["findings"]) == 1                                         # nothing was deleted by the failed re-run
    state.reply = good_response()
    async with _Session() as db:
        fresh = await svc.run_creative_read(db, ids.user, ids.rv)
    assert fresh["reused"] is False and state.calls == 3


@pytest.mark.skipif(not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")), reason="local database only")
async def test_nothing_is_sent_when_there_is_nothing_to_look_at(world):
    ids, state = world
    state.images_ok = False
    async with _Session() as db:
        with pytest.raises(CreativeReadInputError) as e:
            await svc.run_creative_read(db, ids.user, ids.rv)
    assert state.calls == 0 and "Nothing was sent to the AI" in str(e.value)
    state.images_ok = True
    state.evidence["shots"] = []
    async with _Session() as db:
        with pytest.raises(CreativeReadInputError):
            await svc.run_creative_read(db, ids.user, ids.rv)
    assert state.calls == 0
    async with _Session() as db:
        assert (await svc.get_creative_read(db, ids.user, ids.rv))["status"] == "not_run"
