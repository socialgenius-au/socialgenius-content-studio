"""M7 learning-driven creation: accepted lessons -> classified, ranked, selectable guidance -> a blueprint that applies each lesson or explains why not, with the lesson's source kept.
The AI provider is MOCKED at its adapter boundary: no network, no spend. Real local Postgres, like the other C4 service tests."""
import copy
import secrets
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, select

from app.models.learning_record import LearningRecord
from app.models.user import User
from app.models.video_studio_draft import VideoStudioDraft
from app.routers.learning import BriefIn, relevant_lessons
from app.services import learning_guidance as lg
from app.services.blueprint_reasoner import BlueprintInputError, BlueprintReasoningError
from app.services.blueprint_reasoner.providers.anthropic_provider import LESSON_ADDENDUM, SYSTEM_PROMPT, system_prompt_for
from app.services.reconstruction_blueprint_svc import BLUEPRINT_ATTEMPT_CATEGORY, BLUEPRINT_CATEGORY, derive_and_persist_blueprint
from app.schemas.reconstruction_blueprint import BlueprintResponse
from tests.test_blueprint_reasoner import tile_intent_full, tile_intent_min, tile_payload
from tests.test_deconstruction_orchestrator_svc import cleanup
from tests.test_reconstruction_blueprint_svc import C3State, _TestSessionLocal, _c3_patch, _decision, _provider_mock, _reasoner_on, _rows, _seed  # noqa: F401

LESSON_TEXT = "Give the text in scene 1 more time on screen, or shorten it."


def rec(key="reading-speed-s1", basis="evidence", status="accepted", text=LESSON_TEXT, caveat="A rule of thumb, not your audience's behaviour.", note=None, draft_id=None, **kw):
    return LearningRecord(user_id=kw.pop("user_id", 1), draft_id=draft_id, draft_name=kw.pop("draft_name", "Blueprint — SocialGenius (14 Nov)"), blueprint_id="bp-old", reference_video_id=5131, rec_key=key,
                          text=text, basis=basis, evidence=["7 words in 2 s (3.5 words/second; the rule of thumb is about 3)"], caveat=caveat, rule_version="learn-v1", status=status, note=note,
                          updated_at=datetime(2026, 11, 14, tzinfo=timezone.utc), **kw)


BRIEF = dict(product="A product walkthrough for small business owners", audience="small business owners", objective="get them to try the tool", platform="Instagram Reels", duration=12, cta=True, tone=["warm"], mandatory=[], prohibited=[])


# ── classification and confidence: kept distinct, never upgraded ──
def test_classification_keeps_the_kinds_apart_and_never_claims_a_verified_audience_result():
    a = lg.classify(rec())
    assert (a["classification"], a["qualifiers"]) == ("measured_production_observation", ["rule_of_thumb"])
    assert a["classification_label"] == "Measured production observation" and a["qualifier_labels"] == ["Rule of thumb"]
    b = lg.classify(rec(key="alt-cta", basis="hypothesis", caveat="No viewer data exists."))
    assert (b["classification"], b["qualifiers"]) == ("untested_hypothesis", [])
    for r in (rec(), rec(key="contrast-s2"), rec(key="shorter-cut", basis="hypothesis"), rec(key="text-size-mobile", basis="hypothesis")):
        assert lg.classify(r)["classification"] != "verified_audience_finding"
    assert "verified_audience_finding" in lg.CLASS_LABELS                      # the slot exists for a future measured import, and nothing fills it today


def test_confidence_is_the_documented_confidence_of_the_rule_and_says_so():
    c = lg.confidence_of(rec())
    assert c["level"] == "medium" and "not stored on the record" in c["source"]
    assert lg.confidence_of(rec(key="text-size-mobile", basis="hypothesis"))["level"] == "low"
    other = rec(); other.rule_version = "something-else"
    assert lg.confidence_of(other) == {"level": "unknown", "source": "not recorded"}
    odd = rec(key="brand-new-kind"); assert lg.confidence_of(odd)["level"] == "unknown"


# ── relevance and conflicts (pure) ──
def test_the_saved_lesson_is_relevant_to_a_new_short_video_with_text_and_says_why():
    origin = {"platform": "Instagram Reels", "topic": "SocialGenius Content Studio helps small businesses", "audience": "small-business owners", "objective": "try the tool"}
    r = lg.score_lesson(rec(), origin, BRIEF)
    assert r["relevant"] and r["score"] >= 0.5 and not r["conflicts"]
    assert any("on-screen text" in x for x in r["reasons"]) and any("same platform" in x for x in r["reasons"]) and any("Similar subject" in x for x in r["reasons"])
    assert any("measured in your earlier video" in x and "not an audience result" in x for x in r["reasons"])


@pytest.mark.parametrize("key,basis,brief_patch,conflict_word", [
    ("reading-speed-s1", "evidence", {"prohibited": ["on-screen text"]}, "rules out on-screen text"),
    ("contrast-s2", "evidence", {"prohibited": ["captions"]}, "rules out on-screen text"),
    ("alt-cta", "hypothesis", {"cta": False}, "no call to action"),
    ("shorter-cut", "hypothesis", {"duration": 8}, "10 seconds or less"),
])
def test_a_lesson_that_cannot_apply_to_the_brief_is_flagged_as_a_conflict_with_the_reason(key, basis, brief_patch, conflict_word):
    r = lg.score_lesson(rec(key=key, basis=basis), {}, {**BRIEF, **brief_patch})
    assert r["conflicts"] and conflict_word.lower() in r["conflicts"][0].lower()
    assert r["relevant"] is False


def test_a_length_lesson_is_relevant_for_a_longer_target_and_weak_without_one():
    assert lg.score_lesson(rec(key="shorter-cut", basis="hypothesis"), {}, {**BRIEF, "duration": 30})["relevant"]
    assert not lg.score_lesson(rec(key="shorter-cut", basis="hypothesis"), {}, {**BRIEF, "duration": None})["relevant"]


def test_the_brief_is_read_from_the_canonical_intent():
    from app.services.blueprint_reasoner import normalize_intent
    b = lg.brief_from_intent(normalize_intent(tile_intent_full()))
    assert b["platform"] == "Instagram Reels" and b["duration"] == 45 and b["cta"] is True and b["prohibited"]


# ── database: ranking, selection and isolation ──
@pytest.fixture
async def world():
    async with _TestSessionLocal() as db:
        user, rv_id, asset_id, va_id = await _seed(db)
        other = User(username=f"m7_{secrets.token_hex(3)}", email=f"m7_{secrets.token_hex(3)}@example.test", hashed_password="x", role="editor", is_active=True)
        db.add(other); await db.commit(); await db.refresh(other)
        draft = VideoStudioDraft(user_id=user.id, name="Blueprint — SocialGenius (14 Nov)", project_json={
            "canvasFormat": {"ratio": "9:16", "label": "Instagram - Reel / Story"},
            "blueprintPlan": {"blueprintId": "bp-old", "referenceVideoId": 5131, "platform": "Instagram Reels",
                              "intentSummary": "Topic: SocialGenius Content Studio helps small businesses. Audience: small-business owners. Objective: try the tool. Business: SocialGenius. Format: Instagram Reels, 12s."}})
        db.add(draft); await db.commit(); await db.refresh(draft)
        mine = [rec(user_id=user.id, draft_id=draft.id), rec(key="alt-cta", basis="hypothesis", text="Test a second wording of the call to action.", user_id=user.id, draft_id=draft.id),
                rec(key="shorter-cut", basis="hypothesis", status="dismissed", text="Test a shorter cut.", user_id=user.id, draft_id=draft.id), rec(key="alt-opening-hook", basis="hypothesis", status="open", text="Compare openings.", user_id=user.id, draft_id=draft.id)]
        theirs = [rec(text="SOMEONE ELSE'S LESSON", user_id=other.id)]
        db.add_all(mine + theirs); await db.commit()
        for r in mine + theirs:
            await db.refresh(r)
    yield SimpleNamespace(user=user, other=other, rv_id=rv_id, va_id=va_id, mine=mine, theirs=theirs, draft=draft)
    async with _TestSessionLocal() as db:
        await db.execute(delete(LearningRecord).where(LearningRecord.user_id.in_([user.id, other.id])))
        await db.execute(delete(VideoStudioDraft).where(VideoStudioDraft.id == draft.id))
        await db.execute(delete(User).where(User.id == other.id))
        await db.commit()
        await cleanup(db, asset_id, rv_id)


async def test_ranking_returns_only_this_users_accepted_lessons_most_relevant_first_with_their_source(world):
    async with _TestSessionLocal() as db:
        out = await relevant_lessons(BriefIn(product="A product walkthrough", audience="small business owners", objective="try the tool", platform="Instagram Reels", duration_seconds=12, cta=True), db, world.user)
    lessons = out["lessons"]
    assert [l["text"] for l in lessons] == [LESSON_TEXT, "Test a second wording of the call to action."]       # accepted only; the dismissed and open ones and the other user's are absent
    assert "SOMEONE ELSE'S LESSON" not in str(out)
    top = lessons[0]
    assert top["relevance"]["relevant"] and top["classification"] == "measured_production_observation" and top["qualifier_labels"] == ["Rule of thumb"] and top["confidence"]["level"] == "medium"
    assert top["source"]["draft_name"] == "Blueprint — SocialGenius (14 Nov)" and top["source"]["platform"] == "Instagram Reels" and top["source"]["blueprint_id"] == "bp-old"
    assert top["evidence"] and top["user_note"] is None and "not verified performance improvements" in out["notice"]
    assert lessons[0]["relevance"]["score"] >= lessons[1]["relevance"]["score"]


async def test_ranking_for_a_brief_with_no_cta_flags_the_cta_lesson_as_a_conflict(world):
    async with _TestSessionLocal() as db:
        out = await relevant_lessons(BriefIn(product="x product", audience="y people", objective="z goal", cta=False), db, world.user)
    cta = next(l for l in out["lessons"] if "call to action" in l["text"])
    assert cta["relevance"]["conflicts"] and not cta["relevance"]["relevant"]


async def test_selecting_a_lesson_that_is_not_yours_or_not_accepted_is_refused_without_revealing_which(world):
    from app.services.blueprint_reasoner import normalize_intent
    canon = normalize_intent(tile_intent_full())
    async with _TestSessionLocal() as db:
        ok = await lg.load_selected(db, world.user, [world.mine[0].id], canon)
        assert [l["lesson_id"] for l in ok] == [world.mine[0].id]
        messages = set()
        for bad in ([world.theirs[0].id], [world.mine[2].id], [world.mine[3].id], [999999999], [world.mine[0].id, world.theirs[0].id]):
            with pytest.raises(lg.LessonUnavailable) as e:
                await lg.load_selected(db, world.user, bad, canon)
            messages.add(str(e.value))
        assert len(messages) == 1                                                    # same message whether it is someone else's, dismissed, open or nonexistent
        with pytest.raises(lg.LessonUnavailable):
            await lg.load_selected(db, world.user, list(range(1, 12)), canon)
        assert await lg.load_selected(db, world.user, [], canon) == []


# ── the blueprint: applies the lesson or explains why not, and keeps the source ──
def with_lessons(lesson_id, *, decision="APPLIED", sections=(1,), text="Section 1 keeps the opening text short enough to read in its time on screen."):
    p = copy.deepcopy(tile_payload(anat_max=2))
    p["lesson_dispositions"] = [{"lesson_id": lesson_id, "decision": decision, "applied_in_sections": list(sections) if decision == "APPLIED" else [], "how_or_why": text}]
    return p


async def build(db, world, lesson_ids, payload, intent=None, fp=None, expect_calls=1):
    fp = fp or (await __import__("app.services.content_anatomy_svc", fromlist=["x"]).get_content_anatomy(db, world.user, world.rv_id))["provenance"]["fingerprint"]
    patcher, mock = _provider_mock(_decision(payload))
    with patcher, _c3_patch(C3State(fp)):
        out = await derive_and_persist_blueprint(db, world.user, world.rv_id, intent or tile_intent_full(), lesson_ids=lesson_ids)
    assert mock.await_count == expect_calls
    return out, mock


async def test_the_saved_lesson_is_applied_and_the_blueprint_keeps_its_source_classification_and_confidence(world):
    lid = world.mine[0].id
    async with _TestSessionLocal() as db:
        out, mock = await build(db, world, [lid], with_lessons(lid))
        BlueprintResponse.model_validate(out)
        bp = out["blueprint"]
        (l,) = bp["lessons"]
        assert (l["lesson_id"], l["text"], l["decision"], l["applied_in_sections"]) == (lid, LESSON_TEXT, "APPLIED", [1])
        assert l["classification"] == "measured_production_observation" and l["qualifiers"] == ["Rule of thumb"] and l["confidence"]["level"] == "medium"
        assert l["source"]["draft_name"] == "Blueprint — SocialGenius (14 Nov)" and l["source"]["blueprint_id"] == "bp-old" and l["evidence"] and "not verified performance improvements" in l["notice"]
        assert l["relevance"]["relevant"] and l["how_or_why"].startswith("Section 1")
        assert [s["lessons_applied"] for s in bp["sections"]][:2] == [[lid], []]
        sent = mock.await_args.args[0]
        assert [g["lesson_id"] for g in sent["learning_guidance"]] == [lid] and sent["learning_guidance"][0]["kind"] == "Measured production observation"
        assert sent["learning_guidance"][0]["confidence"] == "medium" and "Blueprint — SocialGenius" not in str(sent)       # the earlier video is not named to the AI
        assert sent["valid"]["lesson_ids"] == [lid]
        assert system_prompt_for(sent).endswith(LESSON_ADDENDUM) and "NOT verified performance improvements" in system_prompt_for(sent)
        assert out["provenance"]["llm_calls"] == 1


async def test_a_lesson_can_be_not_applied_with_a_reason_and_is_still_shown_with_its_source(world):
    lid = world.mine[1].id                       # the CTA lesson
    async with _TestSessionLocal() as db:
        out, _ = await build(db, world, [lid], with_lessons(lid, decision="NOT_APPLIED", text="The plan already tests one call to action; a second wording would need a separate version."))
    (l,) = out["blueprint"]["lessons"]
    assert l["decision"] == "NOT_APPLIED" and l["applied_in_sections"] == [] and "separate version" in l["how_or_why"] and l["source"]["draft_name"]
    assert all(s["lessons_applied"] == [] for s in out["blueprint"]["sections"])


async def test_without_lessons_the_request_and_the_blueprint_are_exactly_what_they_always_were(world):
    async with _TestSessionLocal() as db:
        out, mock = await build(db, world, [], tile_payload(anat_max=2))
    sent = mock.await_args.args[0]
    assert "learning_guidance" not in sent and "lesson_ids" not in sent["valid"] and system_prompt_for(sent) == SYSTEM_PROMPT
    assert out["blueprint"]["lessons"] == [] and all(s["lessons_applied"] == [] for s in out["blueprint"]["sections"])
    assert "lessons_digest" not in out["blueprint"]["provenance"]


async def test_a_different_selection_is_a_different_blueprint_and_an_identical_one_is_reused(world):
    a, b = world.mine[0].id, world.mine[1].id
    async with _TestSessionLocal() as db:
        first, _ = await build(db, world, [a], with_lessons(a))
        again, m2 = await build(db, world, [a], with_lessons(a), expect_calls=0)                 # identical selection: reused, no provider call
        assert again["reused"] is True and again["blueprint"]["blueprint_id"] == first["blueprint"]["blueprint_id"]
        p = with_lessons(a); p["lesson_dispositions"].append({"lesson_id": b, "decision": "NOT_APPLIED", "applied_in_sections": [], "how_or_why": "Not needed for this version of the brief."})
        other, _ = await build(db, world, [a, b], p)
        assert other["blueprint"]["blueprint_id"] != first["blueprint"]["blueprint_id"] and len(other["blueprint"]["lessons"]) == 2
        none, _ = await build(db, world, [], tile_payload(anat_max=2))
        assert none["blueprint"]["blueprint_id"] not in (first["blueprint"]["blueprint_id"], other["blueprint"]["blueprint_id"])
        attempts = await _rows(db, world.va_id, BLUEPRINT_ATTEMPT_CATEGORY)
        assert len(attempts) == 3                                                                # every earlier attempt is preserved, none rewritten


async def test_unavailable_lessons_stop_the_request_before_any_provider_call_and_persist_nothing(world):
    async with _TestSessionLocal() as db:
        fp = (await __import__("app.services.content_anatomy_svc", fromlist=["x"]).get_content_anatomy(db, world.user, world.rv_id))["provenance"]["fingerprint"]
        patcher, mock = _provider_mock(_decision(tile_payload(anat_max=2)))
        with patcher, _c3_patch(C3State(fp)):
            with pytest.raises(BlueprintInputError):
                await derive_and_persist_blueprint(db, world.user, world.rv_id, tile_intent_full(), lesson_ids=[world.theirs[0].id])
        assert mock.await_count == 0
        assert await _rows(db, world.va_id, BLUEPRINT_ATTEMPT_CATEGORY, BLUEPRINT_CATEGORY) == []


@pytest.mark.parametrize("name,mutate,match", [
    ("missing", lambda p, lid: p.pop("lesson_dispositions"), "exactly one lesson_dispositions"),
    ("unknown id", lambda p, lid: p["lesson_dispositions"][0].update(lesson_id=lid + 12345), "exactly one lesson_dispositions"),
    ("duplicate", lambda p, lid: p["lesson_dispositions"].append(dict(p["lesson_dispositions"][0])), "exactly one lesson_dispositions"),
    ("section that does not exist", lambda p, lid: p["lesson_dispositions"][0].update(applied_in_sections=[99]), "does not have"),
    ("performance claim", lambda p, lid: p["lesson_dispositions"][0].update(how_or_why="This change will increase viewer retention and engagement."), "perform|retention|engagement|claim|causal"),
])
async def test_a_blueprint_that_does_not_account_for_the_lesson_properly_is_refused_and_nothing_is_saved(world, name, mutate, match):
    lid = world.mine[0].id
    p = with_lessons(lid)
    mutate(p, lid)
    async with _TestSessionLocal() as db:
        fp = (await __import__("app.services.content_anatomy_svc", fromlist=["x"]).get_content_anatomy(db, world.user, world.rv_id))["provenance"]["fingerprint"]
        patcher, _ = _provider_mock(_decision(p))
        with patcher, _c3_patch(C3State(fp)):
            with pytest.raises(BlueprintReasoningError, match=match):
                await derive_and_persist_blueprint(db, world.user, world.rv_id, tile_intent_full(), lesson_ids=[lid])
        assert await _rows(db, world.va_id, BLUEPRINT_ATTEMPT_CATEGORY, BLUEPRINT_CATEGORY) == []


async def test_a_lesson_that_conflicts_with_the_brief_cannot_be_applied_only_explained(world):
    cta_lesson = world.mine[1].id
    no_cta = {**tile_intent_full(), "desired_cta": None}      # the same brief with no call to action
    async with _TestSessionLocal() as db:
        fp = (await __import__("app.services.content_anatomy_svc", fromlist=["x"]).get_content_anatomy(db, world.user, world.rv_id))["provenance"]["fingerprint"]
        applied = with_lessons(cta_lesson)
        for s in applied["sections"]:
            s["cta_direction"] = None
        patcher, _ = _provider_mock(_decision(applied))
        with patcher, _c3_patch(C3State(fp)):
            with pytest.raises(BlueprintReasoningError, match="conflicts with this brief"):
                await derive_and_persist_blueprint(db, world.user, world.rv_id, no_cta, lesson_ids=[cta_lesson])
        explained = with_lessons(cta_lesson, decision="NOT_APPLIED", text="This brief has no call to action, so a lesson about call-to-action wording does not apply.")
        for s in explained["sections"]:
            s["cta_direction"] = None
        out, _ = await build(db, world, [cta_lesson], explained, intent=no_cta, fp=fp)
        (l,) = out["blueprint"]["lessons"]
        assert l["decision"] == "NOT_APPLIED" and l["relevance"]["conflicts"] and "no call to action" in l["how_or_why"]


@pytest.mark.parametrize("bad,match", [
    ({"decision": "APPLIED", "applied_in_sections": [], "how_or_why": "Shapes the opening text timing."}, "must name the sections"),
    ({"decision": "NOT_APPLIED", "applied_in_sections": [2], "how_or_why": "Does not suit this brief at all."}, "cannot name sections"),
    ({"decision": "MAYBE", "applied_in_sections": [], "how_or_why": "Not sure about this one."}, "APPLIED' or 'NOT_APPLIED"),
    ({"decision": "NOT_APPLIED", "applied_in_sections": [], "how_or_why": "no"}, "8-400 characters"),
    ({"decision": "APPLIED", "applied_in_sections": ["1"], "how_or_why": "Shapes the opening text timing."}, "list of integers"),
])
def test_the_parser_refuses_a_malformed_lesson_disposition(bad, match):
    from app.services.blueprint_reasoner.parsing import decision_from_payload
    p = tile_payload(anat_max=2)
    p["lesson_dispositions"] = [{"lesson_id": 5, **bad}]
    with pytest.raises(BlueprintReasoningError, match=match):
        decision_from_payload(p, reasoning_contract_version="v4")


def test_a_lone_section_number_is_read_as_a_list_here_too_and_unknown_fields_are_refused():
    from app.services.blueprint_reasoner.parsing import decision_from_payload
    p = tile_payload(anat_max=2)
    p["lesson_dispositions"] = [{"lesson_id": 5, "decision": "APPLIED", "applied_in_sections": 2, "how_or_why": "Shapes the opening text timing."}]
    assert decision_from_payload(p, reasoning_contract_version="v4").lesson_choices[0].applied_in_sections == [2]
    p["lesson_dispositions"][0]["verdict"] = "great"
    with pytest.raises(BlueprintReasoningError, match="unexpected"):
        decision_from_payload(p, reasoning_contract_version="v4")
