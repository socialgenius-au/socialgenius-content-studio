"""C4 source-term validator: generic DESCRIPTIVE words are allowed, distinctive source content stays blocked.

Regression for reference 5131: two paid blueprint replies were refused for 'setting' and 'product' -- words the mechanism step used to DESCRIBE what must not be copied, not the thing itself.
The two refused replies, and the exact anatomy and mechanisms they were validated against, are saved under tests/fixtures/c4_5131/ (no AI call is made here)."""
import copy
import json
from pathlib import Path

import pytest

from app.schemas.reconstruction_blueprint import NewContentIntentIn
from app.services.blueprint_reasoner import build_context, normalize_intent
from app.services.blueprint_reasoner import guards as G
from app.services.blueprint_reasoner.contract import BlueprintReasoningError
from app.services.blueprint_reasoner.parsing import decision_from_payload, parse_json_object
from app.services.blueprint_reasoner.validation import validate_decision

FX = Path(__file__).parent / "fixtures" / "c4_5131"

INTENT = {
    "product_service_or_topic": "SocialGenius Content Studio, a tool that helps small businesses turn a reference video's structure into their own short, editable social video",
    "target_audience": "small-business owners who post on social media but have little time or video experience",
    "objective": "make the audience curious enough to try the tool for their next post",
    "business_or_brand": "SocialGenius", "desired_cta": "Try it for your next post",
    "tone_style_constraints": ["warm", "practical", "confident but not boastful"],
    "duration_platform_constraints": {"platform": "Instagram Reels", "target_duration_seconds": 12},
    "mandatory_points": ["show that the video stays editable after it is built"],
    "prohibited_claims_or_elements": ["performance or sales guarantees", "price claims", "claims about what viewers will do"],
}


def load(name):
    return json.loads((FX / name).read_text(encoding="utf8"))


def ctx(anatomy=None):
    return build_context(anatomy or load("anatomy.json"), load("mechanisms.json")["mechanisms"], normalize_intent(NewContentIntentIn(**INTENT)))


def decision(n):
    return decision_from_payload(parse_json_object((FX / f"rejected_reply_{n}.json").read_text(encoding="utf8")), reasoning_contract_version="test")


GENERIC = {"accompanying", "appearance", "branding", "category", "context", "shown", "signal", "imagery", "setting", "product", "presenter", "unverified", "garbled"}
DISTINCTIVE = {"ginger", "garlic", "paste", "steam", "cooking", "packaging", "dress", "waites", "realing", "sloving", "slaving"}


# ── the blocklist ──
def test_generic_descriptive_words_are_not_in_the_blocklist_but_distinctive_source_content_is():
    blocked = set(ctx().guard.blocked_terms)
    assert not (blocked & GENERIC), sorted(blocked & GENERIC)
    assert DISTINCTIVE <= blocked, sorted(DISTINCTIVE - blocked)


def test_the_generic_list_is_only_descriptive_words_never_a_subject_or_brand():
    for w in ("ginger", "garlic", "paste", "steam", "cooking", "packaging", "dress", "jar", "barakah", "waites"):
        assert G._stem(w) not in G._GENERIC_STEMS, w


def test_a_description_is_split_into_its_describing_words_and_its_subject():
    mech = [{"non_transferable_elements": [{"kind": "subject_matter", "description": "Specific product setting shown with a ginger paste and spoon in the opening presenter shot"}]}]
    assert G.blocked_source_terms(mech, {}, set()) == ["ginger", "paste", "spoon"]


# ── the two refused replies are regression fixtures ──
@pytest.mark.parametrize("n", [1, 2])
def test_each_previously_refused_reply_now_passes_every_guard(n):
    validate_decision(decision(n), ctx())


@pytest.mark.parametrize("n,word", [(1, "setting"), (2, "product")])
def test_the_fixtures_are_genuine_regressions_they_fail_when_the_old_blocklist_is_restored(monkeypatch, n, word):
    monkeypatch.setattr(G, "_GENERIC_STEMS", frozenset())                       # the behaviour before the correction
    with pytest.raises(BlueprintReasoningError) as e:
        validate_decision(decision(n), ctx())
    assert word in str(e.value)


# ── distinctive source content is still refused ──
@pytest.mark.parametrize("term", ["ginger", "garlic", "paste", "steam", "cooking", "packaging", "dress", "waites", "realing"])
def test_a_distinctive_source_term_in_any_direction_is_still_refused(term):
    dec = decision(1)
    dec.sections[0].speech_direction = f"A calm voice-over over the {term} close-up."
    with pytest.raises(BlueprintReasoningError, match="source-specific|reproduc"):
        validate_decision(dec, ctx())


def test_a_recurring_brand_or_handle_from_the_source_is_still_refused():
    a = copy.deepcopy(load("anatomy.json"))
    marked = 0
    for sec in a["sections"]:
        for t in sec.get("on_screen_text") or []:
            if "barakah" in (t.get("text") or "").lower():
                t["recurring_element_id"] = 1
                marked += 1
    assert marked, "the fixture must contain the brand text"
    c = ctx(a)
    assert "barakah" in c.guard.blocked_terms
    dec = decision(1)
    dec.sections[0].content_instruction = "Open on the Barakah jar."
    with pytest.raises(BlueprintReasoningError, match="source-specific"):
        validate_decision(dec, c)


def test_generic_words_are_allowed_even_in_directive_wording():
    # 'product' used to trip the 'directs reproduction of a source element' guard; as a generic word it is not a source element
    G.reject_directive_source_terms("x", "Use the product shown in a clean setting to signal quality", ctx().guard.blocked_terms)
    with pytest.raises(BlueprintReasoningError):
        G.reject_directive_source_terms("x", "Use the ginger paste to signal quality", ctx().guard.blocked_terms)
