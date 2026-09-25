"""
C4 -- Reconstruction Blueprint reasoner tests: NewContentIntent, contract, deterministic validation (mechanism selection,
mandatory-point accounting, prohibited elements, source-copy / non-transferable / final-copy guards, CTA and duration rules),
provider parsing and request handling, router. PURE tests: anatomies come from C2's own pure builder, mechanisms are shaped like
a persisted C3 result, and the Anthropic client is always mocked -- NO real provider call is ever made.

The realistic fixture is a VA5368-style RELATIONSHIP reference (same subject, opposing outcomes, captions mirroring speech) whose
transferable structure is applied to a completely UNRELATED business (choosing tiles for a home renovation).
"""
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.services.blueprint_reasoner import (
    BLUEPRINT_VERSION, BlueprintInputError, BlueprintReasoningError, build_context, derive_blueprint, finalize_blueprint, intent_hash,
    normalize_intent, validate_decision,
)
from app.services.blueprint_reasoner import router as bp_router
from app.services.blueprint_reasoner.contract import MAX_FIELD_CHARS, MAX_SECTIONS
from app.services.blueprint_reasoner.claim_guard import find_claim
from app.services.blueprint_reasoner.contract import RATIONALE_MIN_CHARS, schema_requires_rationale
from app.services.blueprint_reasoner.guards import (
    META_STOPWORDS, blocked_source_terms, reject_final_copy, reject_prohibited_elements,
)
from app.services.blueprint_reasoner.intent import intent_gaps, intent_tokens, mandatory_point_ids
from app.services.blueprint_reasoner.parsing import decision_from_payload, parse_json_object
from app.services.blueprint_reasoner.provider_input import build_reasoner_input
from app.services.blueprint_reasoner.validation import quality_findings
from app.services.blueprint_reasoner.providers import anthropic_provider
from app.services.blueprint_reasoner.providers.anthropic_provider import (
    BLUEPRINT_EFFORT, BLUEPRINT_PROMPT_VERSION, MAX_RESPONSE_TOKENS, SYSTEM_PROMPT, AnthropicBlueprintReasoner, build_user_prompt,
    extract_text_or_raise, response_diagnostics,
)
from app.services.content_anatomy_svc import build_content_anatomy
from tests.test_content_anatomy_svc import aggregate, shot, speech, text

# ── fixtures: a relationship-content REFERENCE, a persisted-C3-shaped mechanism set, a tile-business INTENT ────────────────

BEATS = [(11, 0.0, 5.0), (12, 5.0, 10.0), (13, 10.0, 16.0), (14, 16.0, 22.0), (15, 22.0, 30.0), (16, 30.0, 38.0)]
SOURCE_LINES = [
    (1, 0.0, 2.4, "A broken woman can do anything"),
    (2, 2.7, 4.8, "and a woman who was hurt can destroy your world"),
    (3, 7.2, 8.8, "a woman in love gives more than your mother"),
    (4, 12.0, 14.4, "but that same woman if betrayed"),
    (5, 26.8, 29.4, "she quietly walks away and never turns around"),
    (6, 30.2, 32.5, "she will never turn around and look back"),
]


def rel_anatomy(**overrides):
    kw = dict(
        duration=38.0, beats=BEATS, speeches=[speech(i, s, e, t) for i, s, e, t in SOURCE_LINES],
        shots=[shot(1, 0, 0.0, 30.0, texts=[text(21, "Kuch Bhi Kar Sakti Hai", 1.0, 2.0), text(22, "@CREATORHANDLE", 0.0, 30.0)]), shot(2, 1, 30.0, 38.0)],
        hook_window={"start_time": 0.0, "end_time": 2.9, "certainty": "MEASURED", "details": {"derived_from": "story_beat", "source_id": 11}},
    )
    kw.update(overrides)
    a = build_content_anatomy(aggregate(**kw))
    for section in a["sections"]:
        for item in section["on_screen_text"]:
            if item["text"].startswith("@"):
                item["recurring_element_id"] = 9      # a persistent watermark / handle
    return a


def c3_mechanisms():
    """Shaped like the `mechanisms` of get_effective_mechanisms(); content modelled on the real VA5368 C3 result."""
    def m(mid, mtype, scope, sections, conf, principle, nts):
        return {"mechanism_id": mid, "mechanism_type": mtype, "scope": scope, "section_numbers": sections, "confidence": conf,
                "statement": "SOURCE-SPECIFIC STATEMENT (never sent to the provider)", "transferable_principle": principle,
                "non_transferable_elements": [{"kind": k, "description": d} for k, d in nts], "anatomy_features_used": ["speech"],
                "limitations": {"model_stated": ["The anatomy does not establish narrative intent."], "anatomy_gaps": []}, "certainty": "INFERRED"}
    return [
        m("M01", "hook_curiosity", "sections", [1], "medium",
          "Open with a bold, generalized dual-contrast claim before any explanation, prompting the audience to want resolution of the comparison.",
          [("wording", "Specific phrasing about a 'broken' versus other type of woman"), ("subject_matter", "Content centers on a specific gendered relationship narrative")]),
        m("M02", "contrast", "sections", [3, 4, 5], "medium",
          "Structure a narrative by alternating between two opposing behavioral outcomes tied to the same subject, reinforcing a before/after or type-A/type-B dichotomy.",
          [("wording", "Specific Urdu/Hindi phrases describing love, betrayal, and destruction"), ("subject_matter", "Relationship-specific content about betrayal and emotional withdrawal")]),
        m("M03", "text_attention", "sections", [2, 4, 6], "medium",
          "Pair spoken narration with synchronized on-screen text restating the same content to reinforce the message through a parallel visual channel.",
          [("wording", "Transliterated caption text matching specific spoken lines"), ("brand_or_name", "Recurring creator watermark text overlay")]),
        m("M04", "pacing_rhythm", "video", [5, 6], "medium",
          "Maintain an unbroken visual continuity through most of a piece, then mark closure with a single cut and pauses to signal an ending.",
          [("timing_specific", "Exact cut placement at ~39.7 seconds of a 43.9-second video")]),
    ]


def tile_intent_min():
    return {"product_service_or_topic": "choosing tiles for a home renovation", "target_audience": "homeowners planning a renovation",
            "objective": "help the audience understand how different tile choices affect the result"}


def tile_intent_full():
    return {**tile_intent_min(), "business_or_brand": "generic tile retailer", "desired_cta": "visit/showroom/contact for guidance",
            "tone_style_constraints": ["practical", "reassuring"],
            "duration_platform_constraints": {"platform": "Instagram Reels", "target_duration_seconds": 45},
            "mandatory_points": ["explain how finish and size change the look of a room", "mention that samples can be viewed in the showroom"],
            "prohibited_claims_or_elements": ["price comparisons", "guaranteed results"]}


def tile_payload(*, cta=True, mps=True, anat_max=6):
    """A valid provider response for the tile intent: STRUCTURE from the reference, SUBJECT from the intent, instructions only."""
    def sec(n, purpose, role, dur, mechs, anat, instruction, info, visual, txt, speech_d, pacing, transition=None, cta_d=None, mp=(), conf="medium", lim=()):
        return {"section_number": n, "section_purpose": purpose, "structural_role": role, "target_duration_seconds": dur, "mechanisms_applied": list(mechs),
                "source_anatomy_relationship": {"relationship": "adapts_reference_structure" if anat else "independent_of_reference",
                                                "anatomy_section_numbers": sorted({min(a, anat_max) for a in anat})},
                "content_instruction": instruction, "required_information": list(info), "visual_direction": visual, "text_direction": txt,
                "speech_direction": speech_d, "pacing_direction": pacing, "transition_direction": transition,
                "cta_direction": cta_d if cta else None, "mandatory_points_assigned": list(mp) if mps else [], "confidence": conf, "limitations": list(lim)}
    p = {
        "structural_approach": "Open with a bold, general claim about a tile decision, contrast two outcomes of that one decision, reinforce the explanation with synchronized on-screen text, and close with an invitation to the showroom.",
        "mechanism_dispositions": [
            {"mechanism_id": "M01", "decision": "USED", "reason_category": None, "reason": None, "applied_in_sections": [1, 2],
             "application_rationale": "Sections 1-2 state the bold framing before any explanation and then set out the decision, applying the opening principle to the new subject."},
            {"mechanism_id": "M02", "decision": "USED", "reason_category": None, "reason": None, "applied_in_sections": [3],
             "application_rationale": "Section 3 holds the same room and layout constant while varying only the tile choice, so the two outcomes form a controlled contrast."},
            {"mechanism_id": "M03", "decision": "USED", "reason_category": None, "reason": None, "applied_in_sections": [4],
             "application_rationale": "Section 4 restates each key difference in synchronized on-screen text as it is spoken, reinforcing the message through a parallel channel."},
            {"mechanism_id": "M04", "decision": "NOT_USED", "reason_category": "unsuitable_for_platform",
             "reason": "A single uncut shot with one late cut does not suit a demonstration-led short-form format.", "applied_in_sections": [],
             "application_rationale": None},
        ],
        "sections": [
            sec(1, "Establish one bold framing of the tile decision before any explanation", "opening", 6, ["M01"], [1],
                "Open with a bold, general claim that a single tile choice can change the whole result of a renovation, stated before any explanation of the options.",
                ["The renovation situation the audience recognises"], "One clear, well-lit view of a finished room so the claim has an immediate visual anchor.",
                "Show a short on-screen statement that mirrors the spoken claim.", "Direct, confident delivery of the opening claim in plain language.",
                "Hold the opening steady with no cuts so the claim lands cleanly.", "Move to the setup once the claim is complete.",
                lim=["No brand name was supplied, so none is referenced."]),
            sec(2, "Set out the decision without judging either option", "setup", 8, ["M01"], [2],
                "Introduce the two tile options being compared and why the choice matters for the audience's renovation, keeping the tone neutral until the contrast.",
                ["The two tile options to be compared (to be supplied)"], "Show both tile samples side by side under the same lighting.",
                "Label each option with a short neutral name on screen.", "Explain the choice in plain, practical language.",
                "Moderate pace with one cut between the two samples."),
            sec(3, "Show two contrasting outcomes from the same purchasing decision", "contrast", 12, ["M02"], [3, 4],
                "Structure the middle around two contrasting outcomes from the same purchasing decision: the same room finished with each tile option, against an identical layout.",
                ["Two finished-room examples using the same layout (to be supplied)"], "Alternate between the two finished rooms, keeping camera position identical.",
                "Add a short on-screen tag naming the option shown in each shot.", "Describe what changes in the room between the two outcomes, focusing on finish and size.",
                "Steady alternation with a clear visual reset between the outcomes.", "Use a clean cut between outcomes.", mp=["MP01"]),
            sec(4, "Reinforce the explanation through matching on-screen text", "demonstration", 9, ["M03"], [5],
                "Demonstrate how finish and size alter the look of the room while synchronized on-screen text restates each key difference as it is explained.",
                ["The specific finish and size differences being shown (to be supplied)"], "Close-ups of each finish and a wide shot showing scale.",
                "Synchronized on-screen text that restates each difference in short phrases as it is spoken.", "Calm explanatory narration matched to the text.",
                "Let the pace settle so each difference is readable.", mp=["MP01"]),
            sec(5, "Close the explanation and point the audience to guidance", "call_to_action", 10, [], [6],
                "Summarise the decision criteria in one beat, then invite the audience to take the next step with the retailer.",
                ["Showroom access details (to be supplied)"], "A tidy final view of the finished room with the samples in frame.",
                "Show the next step as a plain on-screen prompt.", "Warm, reassuring close; avoid price comparisons.",
                "Ease the pace slightly to signal the close.", cta_d="Invite the audience to visit or contact the showroom for guidance, presented as a plain low-pressure invitation.",
                mp=["MP02"], conf="low", lim=["The showroom location and opening details were not supplied."]),
        ],
        "unassigned_mandatory_points": [], "limitations": ["Product details for the two tile options were not supplied."],
    }
    return p


def default_ctx(intent=None, anatomy=None, mechanisms=None):
    return build_context(anatomy or rel_anatomy(), mechanisms or c3_mechanisms(), normalize_intent(intent or tile_intent_full()))


def decide(payload):
    return decision_from_payload(copy.deepcopy(payload), reasoning_contract_version=BLUEPRINT_PROMPT_VERSION)


def validate(payload, ctx=None):
    validate_decision(decide(payload), ctx or default_ctx())


def rejects(payload, match, ctx=None):
    with pytest.raises(BlueprintReasoningError, match=match):
        validate(payload, ctx)


def edit(fn, **kw):
    p = tile_payload(**kw)
    fn(p)
    return p


# ── NewContentIntent ───────────────────────────────────────────────────────────────────────────

def test_the_minimum_required_intent_is_valid_and_optional_information_becomes_gaps_not_inventions():
    c = normalize_intent(tile_intent_min())
    assert c["business_or_brand"] is None and c["desired_cta"] is None and c["mandatory_points"] == [] and c["prohibited_claims_or_elements"] == []
    assert c["tone_style_constraints"] == [] and c["duration_platform_constraints"] is None
    fields = {g["field"] for g in intent_gaps(c)}
    assert fields == {"business_or_brand", "desired_cta", "tone_style_constraints", "duration_platform_constraints", "mandatory_points", "prohibited_claims_or_elements"}
    assert all(g["kind"] == "not_supplied" for g in intent_gaps(c))
    ctx = default_ctx(tile_intent_min())
    p = tile_payload(cta=False, mps=False)
    validate(p, ctx)
    bp = finalize_blueprint(decide(p), ctx, {"anatomy_fingerprint": "f"}, [])
    assert {g["field"] for g in bp["gaps"] if g["kind"] == "not_supplied"} == fields
    assert bp["intent"]["business_or_brand"] is None and all(s["cta_direction"] is None for s in bp["sections"])


def test_optional_intent_fields_are_normalised_and_hashing_is_stable_and_sensitive():
    messy = {**tile_intent_full(), "objective": "  help   the audience understand how different tile choices affect the result ",
             "mandatory_points": ["explain how finish and size change the look of a room", "EXPLAIN how finish and size change the look of a room",
                                  "mention that samples can be viewed in the showroom"], "tone_style_constraints": ["practical", "reassuring"]}
    c1, c2 = normalize_intent(messy), normalize_intent(tile_intent_full())
    assert c1 == c2 and intent_hash(c1) == intent_hash(c2) and len(intent_hash(c1)) == 64
    assert list(mandatory_point_ids(c1)) == ["MP01", "MP02"]
    for change in ({"objective": "help the audience compare tile options"}, {"desired_cta": "book a design consultation"},
                   {"mandatory_points": ["a different point"]}, {"prohibited_claims_or_elements": ["price comparisons"]},
                   {"duration_platform_constraints": {"platform": "TikTok", "target_duration_seconds": 45}}):
        assert intent_hash(normalize_intent({**tile_intent_full(), **change})) != intent_hash(c1), change
    assert normalize_intent({**tile_intent_min(), "duration_platform_constraints": {}})["duration_platform_constraints"] is None


@pytest.mark.parametrize("bad", [
    {k: v for k, v in tile_intent_min().items() if k != "product_service_or_topic"},
    {k: v for k, v in tile_intent_min().items() if k != "target_audience"},
    {k: v for k, v in tile_intent_min().items() if k != "objective"},
    {**tile_intent_min(), "objective": ""}, {**tile_intent_min(), "target_audience": "   "}, {**tile_intent_min(), "product_service_or_topic": "ab"},
    {**tile_intent_min(), "surprise_field": "x"},
    {**tile_intent_min(), "mandatory_points": ["ok", ""]},
    {**tile_intent_min(), "mandatory_points": ["price comparisons"], "prohibited_claims_or_elements": ["Price comparisons"]},
    {**tile_intent_min(), "duration_platform_constraints": {"target_duration_seconds": 1}},
    {**tile_intent_min(), "duration_platform_constraints": {"unknown": 1}},
    {**tile_intent_min(), "mandatory_points": [f"p{i} point" for i in range(25)]},
])
def test_a_missing_or_invalid_required_intent_is_rejected_with_a_named_field(bad):
    with pytest.raises(BlueprintInputError, match="Invalid NewContentIntent"):
        normalize_intent(bad)


# ── valid blueprint: structure, completeness, provenance ─────────────────────────────────────────

PINS = {"reference_video_id": 5127, "video_analysis_id": 5368, "anatomy_fingerprint": "fp" * 32, "anatomy_version": "c2-v1", "mechanism_attempt_id": 12731,
        "mechanism_provider": "anthropic", "mechanism_model": "claude-sonnet-5", "mechanism_prompt_version": "v2", "taxonomy_version": "v1",
        "intent_hash": "ih", "provider": "anthropic", "model": "claude-sonnet-5", "prompt_version": "v1"}


def test_a_valid_blueprint_passes_and_is_finalised_with_every_required_section_field_and_complete_provenance():
    ctx = default_ctx()
    validate(tile_payload(), ctx)
    bp = finalize_blueprint(decide(tile_payload()), ctx, PINS, ["Zero retention devices were accepted."])
    assert bp["blueprint_id"].startswith("bp-") and bp["blueprint_version"] == BLUEPRINT_VERSION == "c4-v1"
    assert bp["intent_summary"].startswith("Topic: choosing tiles") and "Instagram Reels" in bp["intent_summary"]
    assert bp["target"] == {"platform": "Instagram Reels", "target_duration_seconds": 45, "planned_total_seconds": 45}
    assert bp["mechanisms_used"] == ["M01", "M02", "M03"] and [m["mechanism_id"] for m in bp["mechanisms_not_used"]] == ["M04"]
    required = {"section_number", "section_purpose", "structural_role", "target_duration_seconds", "mechanisms_applied", "source_anatomy_relationship",
                "content_instruction", "required_information", "visual_direction", "text_direction", "speech_direction", "pacing_direction",
                "transition_direction", "cta_direction", "mandatory_points_assigned", "prohibited_elements", "evidence_refs", "confidence", "limitations"}
    assert all(required <= set(s) for s in bp["sections"])
    assert [s["section_number"] for s in bp["sections"]] == [1, 2, 3, 4, 5]
    assert all(s["prohibited_elements"] == ["price comparisons", "guaranteed results"] for s in bp["sections"])
    assert bp["sections"][2]["evidence_refs"] == {"anatomy_section_numbers": [3, 4], "mechanism_ids": ["M02"]}
    assert set(bp["provenance"]) >= set(PINS) | {"blueprint_version", "certainty"} and bp["provenance"]["certainty"] == "INFERRED"
    assert bp["constraints"]["prohibited_claims_or_elements"] == ["price comparisons", "guaranteed results"]
    assert bp["constraints"]["tone_style"] == ["practical", "reassuring"] and "no performance" in bp["constraints"]["performance_policy"]
    # every C3 non-transferable element (including pure timing) is carried as a do-not-reproduce constraint
    assert len(bp["constraints"]["do_not_reproduce"]) == sum(len(m["non_transferable_elements"]) for m in c3_mechanisms())
    assert any(g["kind"] == "reference_limitation" and "retention devices" in g["reason"] for g in bp["gaps"])
    assert any(g["kind"] == "reference_gap" for g in bp["gaps"]), "C2 gaps are propagated"
    # the transferable principle is the ONLY thing carried from a C3 mechanism into the dispositions
    assert {d["mechanism_id"]: d["transferable_principle"] for d in bp["mechanism_dispositions"]}["M02"].startswith("Structure a narrative")


def test_the_blueprint_id_is_stable_and_changes_with_any_pinned_input():
    a = finalize_blueprint(decide(tile_payload()), default_ctx(), PINS, [])["blueprint_id"]
    assert a == finalize_blueprint(decide(tile_payload()), default_ctx(), PINS, [])["blueprint_id"]
    for k in ("anatomy_fingerprint", "mechanism_attempt_id", "intent_hash", "provider", "model", "prompt_version"):
        assert finalize_blueprint(decide(tile_payload()), default_ctx(), {**PINS, k: "other" if k != "mechanism_attempt_id" else 1}, [])["blueprint_id"] != a, k


def test_sections_must_be_numbered_in_order_and_are_bounded():
    rejects(edit(lambda p: p["sections"][4].update(section_number=7)), "numbered 1..n in order")   # a gap
    with pytest.raises(BlueprintReasoningError, match="between 1 and"):
        decide({**tile_payload(), "sections": []})
    too_many = tile_payload()
    too_many["sections"] = [dict(copy.deepcopy(too_many["sections"][0]), section_number=i) for i in range(1, MAX_SECTIONS + 2)]
    with pytest.raises(BlueprintReasoningError, match="between 1 and"):
        decide(too_many)


def test_section_order_is_preserved_in_the_finalised_blueprint():
    bp = finalize_blueprint(decide(tile_payload()), default_ctx(), PINS, [])
    assert [s["structural_role"] for s in bp["sections"]] == ["opening", "setup", "contrast", "demonstration", "call_to_action"]


# ── mechanism selection ─────────────────────────────────────────────────────────────────────────

def test_a_mechanism_can_be_used_and_another_not_used_with_a_recorded_reason():
    bp = finalize_blueprint(decide(tile_payload()), default_ctx(), PINS, [])
    used = {d["mechanism_id"]: d for d in bp["mechanism_dispositions"]}
    assert used["M01"]["decision"] == "USED" and used["M01"]["applied_in_sections"] == [1, 2]
    assert used["M04"]["decision"] == "NOT_USED" and used["M04"]["reason_category"] == "unsuitable_for_platform" and "short-form" in used["M04"]["reason"]


def test_not_every_mechanism_has_to_be_used_and_using_all_is_also_valid_when_each_is_applied():
    def fewer(p):
        for d in p["mechanism_dispositions"]:
            if d["mechanism_id"] == "M03":
                d.update(decision="NOT_USED", reason_category="redundant_with_another_mechanism", reason="On-screen reinforcement is already covered by the contrast section.", applied_in_sections=[], application_rationale=None)
        p["sections"][3]["mechanisms_applied"] = []
    validate(edit(fewer))
    def all_used(p):
        for d in p["mechanism_dispositions"]:
            if d["mechanism_id"] == "M04":
                d.update(decision="USED", reason_category=None, reason=None, applied_in_sections=[5],
                         application_rationale="Section 5 eases the pace into a quieter close, applying the closure principle at the end of the plan.")
        p["sections"][4]["mechanisms_applied"] = ["M04"]
    validate(edit(all_used))


@pytest.mark.parametrize("mutation, match", [
    (lambda p: p["mechanism_dispositions"].append({"mechanism_id": "M99", "decision": "USED", "reason_category": None, "reason": None, "applied_in_sections": [1], "application_rationale": "Section 1 applies the invented mechanism to the opening of the plan."}), "unknown mechanism id"),
    (lambda p: p["mechanism_dispositions"].pop(), "omits C3 mechanism"),
    (lambda p: p["mechanism_dispositions"].append(dict(p["mechanism_dispositions"][0])), "more than once"),
    (lambda p: p["sections"][0].update(mechanisms_applied=["M77"]), "unknown mechanism"),
    (lambda p: p["sections"][0].update(mechanisms_applied=["M04"]), "NOT_USED"),
    (lambda p: p["sections"][4].update(mechanisms_applied=["M02"]), "does not include it"),
    (lambda p: p["sections"][2].update(mechanisms_applied=[]), "does not list it"),
    (lambda p: p["mechanism_dispositions"][0].update(applied_in_sections=[1, 2, 9]), "does not exist"),
])
def test_mechanism_ids_and_dispositions_are_validated_against_the_c3_result(mutation, match):
    rejects(edit(mutation), match)


def test_all_mechanisms_not_used_is_rejected_because_nothing_was_transferred():
    def none_used(p):
        for d in p["mechanism_dispositions"]:
            d.update(decision="NOT_USED", reason_category="unsuitable_for_objective", reason="This mechanism does not suit the stated objective.", applied_in_sections=[], application_rationale=None)
        for s in p["sections"]:
            s["mechanisms_applied"] = []
    rejects(edit(none_used), "transfers nothing")


@pytest.mark.parametrize("mutation, match", [
    (lambda d: d.update(reason=None), "concrete reason"),
    (lambda d: d.update(reason="short"), "concrete reason"),
    (lambda d: d.update(reason_category=None), "requires reason_category"),
    (lambda d: d.update(reason_category="because"), "requires reason_category"),
    (lambda d: d.update(applied_in_sections=[1]), "cannot be applied"),
])
def test_a_not_used_mechanism_needs_a_categorised_concrete_reason(mutation, match):
    p = tile_payload()
    mutation(p["mechanism_dispositions"][3])
    with pytest.raises(BlueprintReasoningError, match=match):
        decide(p)


# ── non-transferable elements, source wording, subject terms ─────────────────────────────────────

def test_the_blocked_terms_come_from_the_non_transferable_elements_and_recurring_source_text_minus_the_callers_own_words():
    c = default_ctx()
    blocked = set(c.guard.blocked_terms)
    assert {"broken", "woman", "urdu", "hindi", "love", "betrayal", "destruction", "gendered", "relationship", "emotional", "withdrawal", "creatorhandle"} <= blocked
    assert not blocked & META_STOPWORDS and "timing" not in blocked and "seconds" not in blocked and "43" not in blocked
    # the caller's own words are exempt: a relationship-coaching business may say "relationship"
    coaching = default_ctx({**tile_intent_min(), "product_service_or_topic": "relationship coaching for couples"})
    assert "relationship" not in coaching.guard.blocked_terms and "betrayal" in coaching.guard.blocked_terms


@pytest.mark.parametrize("word", ["woman", "betrayal", "relationship", "love", "broken", "destruction", "emotional", "withdrawal", "Urdu", "creatorhandle"])
def test_a_non_transferable_source_term_in_any_field_is_rejected(word):
    rejects(edit(lambda p: p["sections"][2].update(content_instruction=f"Show the same room twice, framing the contrast around {word} in the outcome.")), "NON-TRANSFERABLE")
    rejects(edit(lambda p: p["sections"][1].update(required_information=[f"A {word} example (to be supplied)"])), "NON-TRANSFERABLE")
    rejects(edit(lambda p: p.update(structural_approach=f"Contrast two outcomes using a {word} theme.")), "NON-TRANSFERABLE")


def test_a_not_used_reason_or_limitation_may_not_smuggle_source_subject_matter_either():
    def leaky_reason(p):
        p["mechanism_dispositions"][3]["reason"] = "The pacing suits a story about betrayal rather than a product explanation."
    rejects(edit(leaky_reason), "NON-TRANSFERABLE")
    rejects(edit(lambda p: p["sections"][0].update(limitations=["Avoid the woman archetype used by the reference."])), "NON-TRANSFERABLE")


def test_source_wording_is_blocked_even_when_lightly_lifted():
    rejects(edit(lambda p: p["sections"][3].update(speech_direction="Narration should end with never turn around and look back.")), "reproduces")
    rejects(edit(lambda p: p["sections"][2].update(visual_direction="Alternate two rooms, never turns around and looks back again.")), "reproduces")   # inflections changed
    rejects(edit(lambda p: p["sections"][2].update(visual_direction="Alternate two rooms; Never TURN around, and look back!")), "reproduces|final copy")   # case / punctuation changed
    # a 4-word whole on-screen line of the source
    anatomy = rel_anatomy(shots=[shot(1, 0, 0.0, 30.0, texts=[text(21, "Kuch Bhi Kar Sakti Hai", 1.0, 2.0)]), shot(2, 1, 30.0, 38.0)])
    rejects(edit(lambda p: p["sections"][3].update(text_direction="Show kuch bhi kar sakti hai on screen.")), "reproduces", default_ctx(anatomy=anatomy))
    # the non-transferable DESCRIPTIONS themselves may not be copied out
    rejects(edit(lambda p: p["sections"][1].update(content_instruction="Introduce the choice, centers on a specific gendered approach to the options.")), "NON-TRANSFERABLE|reproduces")


def test_short_shared_phrases_that_are_not_source_wording_are_allowed():
    validate(edit(lambda p: p["sections"][0].update(pacing_direction="Hold steady and let it land with no cuts at all.")))


# ── performance / causal claims ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("claim", [
    "This structure will increase retention.", "This hook will perform better.", "This mechanism will drive engagement.",
    "The section makes viewers continue watching.", "It improves performance.", "This structure works because it is tight.", "This drives conversions.",
    "The opening is highly effective.", "It went viral because of the contrast.",
])
def test_performance_and_causal_claims_are_rejected_in_any_field(claim):
    rejects(edit(lambda p: p["sections"][1].update(content_instruction=f"Introduce the two options. {claim}")), "claim")
    rejects(edit(lambda p: p.update(structural_approach=claim)), "claim")
    rejects(edit(lambda p: p.update(limitations=[claim])), "claim")


def test_stating_which_mechanism_a_section_applies_is_not_a_performance_claim():
    validate(edit(lambda p: p["sections"][2].update(section_purpose="This section applies the contrast mechanism to organise the information.")))


# ── prohibited elements ─────────────────────────────────────────────────────────────────────────

def test_a_prohibited_element_may_only_appear_as_an_explicit_exclusion():
    validate(tile_payload())  # section 5 contains "avoid price comparisons"
    rejects(edit(lambda p: p["sections"][1].update(content_instruction="Introduce the two options with price comparisons between them.")), "PROHIBITED element")
    rejects(edit(lambda p: p["sections"][3].update(speech_direction="Promise guaranteed results for either finish.")), "PROHIBITED element|claim")   # un-negated: rejected
    # naming a prohibited element in order to EXCLUDE it is not itself a performance claim, even when the element is worded like one
    validate(edit(lambda p: p["sections"][4].update(speech_direction="Warm, reassuring close; avoid price comparisons and guaranteed results.")))
    # ...but the exclusion must be real: an instruction elsewhere in the same field is still caught
    rejects(edit(lambda p: p["sections"][4].update(speech_direction="Avoid price comparisons. Promise guaranteed results.")), "PROHIBITED element|claim")
    # explanatory text may simply name the element
    validate(edit(lambda p: p["sections"][4].update(limitations=["Claims about guaranteed results were excluded as the caller prohibited them."])))
    validate(edit(lambda p: p["sections"][3].update(speech_direction="Do not promise guaranteed results for either finish.")))
    validate(edit(lambda p: p["sections"][3].update(speech_direction="Never use price comparisons; keep the narration about finish and size.")))
    # inflections are matched too
    rejects(edit(lambda p: p["sections"][1].update(content_instruction="Show the price comparison for each option.")), "PROHIBITED element")


def test_prohibited_element_matching_unit():
    reject_prohibited_elements("f", "Avoid price comparisons entirely.", ["price comparisons"])
    reject_prohibited_elements("f", "Speak about tile finishes.", ["price comparisons"])
    with pytest.raises(BlueprintReasoningError):
        reject_prohibited_elements("f", "Add price comparisons at the end.", ["price comparisons"])
    with pytest.raises(BlueprintReasoningError):
        reject_prohibited_elements("f", "Do not hesitate; include price comparisons.", ["price comparisons"])   # the negation belongs to another clause


# ── mandatory points ────────────────────────────────────────────────────────────────────────────

def test_every_mandatory_point_is_assigned_and_the_accounting_is_recorded():
    bp = finalize_blueprint(decide(tile_payload()), default_ctx(), PINS, [])
    acc = {a["id"]: a for a in bp["mandatory_point_accounting"]}
    assert acc["MP01"]["status"] == "ASSIGNED" and acc["MP01"]["section_numbers"] == [3, 4] and acc["MP01"]["text"].startswith("explain how finish and size")
    assert acc["MP02"]["status"] == "ASSIGNED" and acc["MP02"]["section_numbers"] == [5]


def test_a_mandatory_point_cannot_silently_disappear():
    rejects(edit(lambda p: p["sections"][4].update(mandatory_points_assigned=[])), "neither assigned")
    rejects(edit(lambda p: [s.update(mandatory_points_assigned=[]) for s in p["sections"]]), "neither assigned")


def test_a_mandatory_point_may_be_reported_unassigned_with_a_reason_and_it_shows_up_in_the_accounting_and_gaps():
    def unassign(p):
        p["sections"][4]["mandatory_points_assigned"] = []
        p["unassigned_mandatory_points"] = [{"id": "MP02", "reason": "Showroom sample availability was not confirmed, so it cannot be stated."}]
    p = edit(unassign)
    ctx = default_ctx()
    validate(p, ctx)
    bp = finalize_blueprint(decide(p), ctx, PINS, [])
    acc = {a["id"]: a for a in bp["mandatory_point_accounting"]}
    assert acc["MP02"]["status"] == "UNASSIGNED" and "not confirmed" in acc["MP02"]["reason"] and acc["MP02"]["section_numbers"] == []
    assert any(g["kind"] == "unassigned_mandatory_point" and "MP02" in g["field"] for g in bp["gaps"])


@pytest.mark.parametrize("mutation, match", [
    (lambda p: p["sections"][0].update(mandatory_points_assigned=["MP77"]), "unknown mandatory point"),
    (lambda p: p.update(unassigned_mandatory_points=[{"id": "MP01", "reason": "Not enough room in the plan."}]), "both assigned"),
    (lambda p: p.update(unassigned_mandatory_points=[{"id": "MP09", "reason": "Not enough room in the plan."}]), "unknown mandatory point"),
    (lambda p: p["sections"][2].update(mandatory_points_assigned=["MP01", "MP01"]), "same mandatory point twice"),
])
def test_mandatory_point_ids_are_validated(mutation, match):
    rejects(edit(mutation), match)


def test_an_unassigned_point_needs_a_concrete_reason():
    p = edit(lambda p: p.update(unassigned_mandatory_points=[{"id": "MP02", "reason": "n/a"}]))
    with pytest.raises(BlueprintReasoningError, match="concrete reason"):
        decide(p)


# ── final creative copy ─────────────────────────────────────────────────────────────────────────

def test_a_construction_instruction_is_accepted_and_final_copy_is_rejected():
    reject_final_copy("f", "Open with a concise unresolved contrast relevant to the target customer's decision, before explaining the distinction.")
    with pytest.raises(BlueprintReasoningError):
        reject_final_copy("f", "Are you tired of wasting money on bad accountants?")
    validate(edit(lambda p: p["sections"][0].update(content_instruction="Open with a concise unresolved contrast relevant to the target customer's decision, before explaining the distinction.")))


@pytest.mark.parametrize("copy_text", [
    'Open with "Are you tired of choosing the wrong tile" over the room.',
    "Say “this one choice changes everything” as the opener.",
    "Open with: 'this one choice changes everything about your room'.",
    "Are you tired of wasting money on bad tiles?",
    "Why do so many renovations go wrong?",
    "Show the room and shout that it looks amazing!",
    "Headline: Choose the right tile today",
    "Script: welcome to our tile showroom",
    "Caption: pick your finish #tiles",
    "Add a celebratory \U0001F389 emoji over the reveal.",
])
def test_final_copy_is_rejected_in_instruction_fields(copy_text):
    for field in ("content_instruction", "text_direction", "speech_direction", "cta_direction"):
        rejects(edit(lambda p: p["sections"][4].update({field: copy_text})), "final copy|direct question|exclamation|copy label|hashtag or emoji")


def test_an_overlong_field_is_not_an_instruction_it_is_a_script():
    p = tile_payload()
    p["sections"][1]["content_instruction"] = "Introduce the options. " * 40
    with pytest.raises(BlueprintReasoningError, match=f"max {MAX_FIELD_CHARS}"):
        decide(p)


# ── CTA, duration, anatomy references ───────────────────────────────────────────────────────────

def test_a_supplied_cta_must_be_planned_and_an_unsupplied_cta_must_not_be_invented():
    rejects(edit(lambda p: [s.update(cta_direction=None) for s in p["sections"]]), "no section carries cta_direction")
    ctx_no_cta = default_ctx({k: v for k, v in tile_intent_full().items() if k != "desired_cta"})
    rejects(tile_payload(), "does not invent a CTA|no desired CTA", ctx_no_cta)
    validate(tile_payload(cta=False), ctx_no_cta)


def test_planned_durations_must_be_within_15_percent_of_a_supplied_target():
    def scale(f):
        def go(p):
            for s in p["sections"]:
                s["target_duration_seconds"] = round(s["target_duration_seconds"] * f, 3)
        return go
    validate(edit(scale(1.10)))
    validate(edit(scale(0.90)))
    rejects(edit(scale(1.30)), "away from the supplied target")
    rejects(edit(scale(0.60)), "away from the supplied target")
    no_target = default_ctx({**tile_intent_full(), "duration_platform_constraints": {"platform": "YouTube"}})   # platform only: no duration to hold to
    validate(edit(scale(3.0)), no_target)


def test_anatomy_references_must_exist_and_a_related_section_must_name_one():
    rejects(edit(lambda p: p["sections"][0]["source_anatomy_relationship"].update(anatomy_section_numbers=[99])), "do not exist")
    rejects(edit(lambda p: p["sections"][0]["source_anatomy_relationship"].update(anatomy_section_numbers=[])), "names no anatomy section")
    validate(edit(lambda p: p["sections"][0]["source_anatomy_relationship"].update(relationship="independent_of_reference", anatomy_section_numbers=[])))


# ── unrelated-business fixture: STRUCTURE transferred, SUBJECT not ───────────────────────────────

def test_a_relationship_reference_becomes_a_tile_renovation_blueprint_that_transfers_structure_not_subject():
    ctx = default_ctx()
    p = tile_payload()
    validate(p, ctx)
    bp = finalize_blueprint(decide(p), ctx, PINS, [])
    plan_text = " ".join(str(s[k]) for s in bp["sections"] for k in ("section_purpose", "content_instruction", "visual_direction", "text_direction",
                                                                       "speech_direction", "pacing_direction", "cta_direction") if s.get(k))
    plan_text += " " + bp["structural_approach"] + " " + " ".join(m["reason"] or "" for m in bp["mechanisms_not_used"])
    lowered = plan_text.lower()
    # SUBJECT is the new business
    for word in ("tile", "finish", "size", "room", "renovation", "showroom"):
        assert word in lowered, word
    # nothing of the reference's subject crosses over
    for word in ("woman", "betrayal", "relationship", "love", "broken", "destroy", "mother", "hurt", "urdu", "watermark", "handle"):
        assert word not in lowered, word
    assert set(bp["constraints"]["prohibited_claims_or_elements"]) == {"price comparisons", "guaranteed results"}
    # the STRUCTURE is what transferred: bold opening -> same-subject contrast -> synchronized text reinforcement -> next-step close
    roles = [s["structural_role"] for s in bp["sections"]]
    assert roles[0] == "opening" and "contrast" in roles and roles.index("contrast") < roles.index("demonstration") and roles[-1] == "call_to_action"
    contrast = next(s for s in bp["sections"] if s["structural_role"] == "contrast")
    assert "same purchasing decision" in contrast["content_instruction"] and contrast["mechanisms_applied"] == ["M02"]
    # no 5-word run of the reference's transcript anywhere in the plan
    from app.services.mechanism_reasoner.language_guard import build_source_index, reject_source_reproduction
    from app.services.mechanism_reasoner.anatomy_input import source_texts
    reject_source_reproduction("plan", plan_text, build_source_index(source_texts(rel_anatomy()), 4))
    # every C3 non-transferable element is a do-not-reproduce constraint, and no final copy was generated
    assert {d["description"] for d in bp["constraints"]["do_not_reproduce"]} >= {"Recurring creator watermark text overlay", "Content centers on a specific gendered relationship narrative"}
    assert "?" not in plan_text and "!" not in plan_text and '"' not in plan_text


# ── weak anatomy, zero retention devices, C3 review items ────────────────────────────────────────

def test_a_weak_shot_only_anatomy_with_zero_accepted_retention_devices_is_handled_safely():
    weak = build_content_anatomy(aggregate(duration=20.0, shots=[shot(1, 0, 0.0, 12.0), shot(2, 1, 12.0, 20.0)]))
    assert weak["section_source"]["selected"] == "shots" and weak["video"]["retention"]["accepted_count"] == 0 and len(weak["sections"]) == 2
    ctx = build_context(weak, c3_mechanisms()[:2], normalize_intent(tile_intent_full()))
    p = tile_payload(anat_max=2)
    p["mechanism_dispositions"] = p["mechanism_dispositions"][:2]
    p["mechanism_dispositions"][1]["applied_in_sections"] = [3]
    p["sections"][3]["mechanisms_applied"] = []
    validate(p, ctx)
    bp = finalize_blueprint(decide(p), ctx, PINS, [])
    assert bp["sections"][2]["source_anatomy_relationship"]["anatomy_section_numbers"] == [2]
    assert any(g["field"].startswith("reference:") for g in bp["gaps"])


def test_c3_review_items_low_confidence_missing_roles_and_weak_mechanisms_do_not_break_c4():
    mechs = c3_mechanisms()
    mechs[3]["confidence"] = "low"                                   # a weak mechanism
    mechs[0]["limitations"] = {"model_stated": ["The hook framing is imprecise."], "anatomy_gaps": [{"field": "narrative_role", "kind": "not_established"}]}
    ctx = default_ctx(mechanisms=mechs)
    validate(tile_payload(), ctx)
    bp = finalize_blueprint(decide(tile_payload()), ctx, PINS, ["No narrative, messaging, emotional, or CTA roles are established by upstream analysis.",
                                                                 "Zero retention devices were accepted, so no confirmed retention mechanism can be claimed."])
    limitations = [g for g in bp["gaps"] if g["kind"] == "reference_limitation"]
    assert len(limitations) == 2 and any("CTA roles" in g["reason"] for g in limitations)
    assert bp["mechanisms_used"] == ["M01", "M02", "M03"]


# ── parsing / malformed provider payloads ────────────────────────────────────────────────────────

@pytest.mark.parametrize("mutation, match", [
    (lambda p: p.pop("sections"), "missing required field"),
    (lambda p: p.pop("structural_approach"), "missing required field"),
    (lambda p: p.update(extra=1), "unexpected top-level"),
    (lambda p: p.update(sections="nope"), "must be a list"),
    (lambda p: p.update(mechanism_dispositions="nope"), "must be a list"),
    (lambda p: p["sections"][0].pop("content_instruction"), "missing required field"),
    (lambda p: p["sections"][0].update(surprise=1), "unexpected field"),
    (lambda p: p["sections"][0].update(structural_role="climax"), "structural_role must be one of"),
    (lambda p: p["sections"][0].update(confidence="certain"), "confidence must be one of"),
    (lambda p: p["sections"][0].update(target_duration_seconds="six"), "target_duration_seconds"),
    (lambda p: p["sections"][0].update(target_duration_seconds=0), "target_duration_seconds"),
    (lambda p: p["sections"][0]["source_anatomy_relationship"].update(relationship="copies_reference"), "relationship must be one of"),
    (lambda p: p["sections"][0].update(source_anatomy_relationship="follows"), "must be an object"),
    (lambda p: p["sections"][0].update(mandatory_points_assigned="MP01"), "must be a list"),
    (lambda p: p["mechanism_dispositions"][0].update(decision="MAYBE"), "USED"),
    (lambda p: p["mechanism_dispositions"][0].update(applied_in_sections=[]), "at least one section"),
    (lambda p: p["mechanism_dispositions"][0].update(junk=1), "unexpected field"),
    (lambda p: p.update(unassigned_mandatory_points=[{"id": "MP01"}]), "must be"),
])
def test_malformed_provider_payloads_raise_instead_of_producing_a_decision(mutation, match):
    p = tile_payload()
    mutation(p)
    with pytest.raises(BlueprintReasoningError, match=match):
        decide(p)


def test_json_is_extracted_from_prose_or_fences_and_non_json_is_rejected():
    assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1} and parse_json_object('Here: {"a": 1} ok') == {"a": 1}
    for bad in ("no json", "{broken", "[1]", ""):
        with pytest.raises(BlueprintReasoningError):
            parse_json_object(bad)


# ── provider input: no source wording ever reaches the model ─────────────────────────────────────

def test_the_provider_input_carries_the_skeleton_and_principles_but_never_source_wording_or_c3_statements():
    ctx = default_ctx()
    ri = build_reasoner_input(ctx)
    blob = json.dumps(ri, ensure_ascii=False)
    for line in [t for _, _, _, t in SOURCE_LINES] + ["Kuch Bhi Kar Sakti Hai", "SOURCE-SPECIFIC STATEMENT"]:
        assert line not in blob, line
    assert '"transcript":' not in blob and '"speech":' not in blob and "on_screen_text" not in ri["reference_skeleton"]["sections"][0]   # kinds of evidence, never its content
    assert [m["mechanism_id"] for m in ri["mechanisms"]] == ["M01", "M02", "M03", "M04"]
    assert ri["mechanisms"][1]["transferable_principle"].startswith("Structure a narrative")
    assert {"kind": "wording", "description": "Specific phrasing about a 'broken' versus other type of woman"} in ri["mechanisms"][0]["do_not_carry_over"]
    assert ri["valid"] == {"anatomy_section_numbers": [1, 2, 3, 4, 5, 6], "mechanism_ids": ["M01", "M02", "M03", "M04"], "mandatory_point_ids": ["MP01", "MP02"]}
    assert ri["new_content_intent"]["mandatory_points"] == [{"id": "MP01", "text": "explain how finish and size change the look of a room"},
                                                            {"id": "MP02", "text": "mention that samples can be viewed in the showroom"}]
    assert "creatorhandle" in ri["blocked_source_terms"] and "betrayal" in ri["blocked_source_terms"]
    assert ri["reference_skeleton"]["sections"][0]["hook"] is True and ri["reference_skeleton"]["sections"][0]["opening"] is True


# ── provider (Anthropic adapter; client always mocked) ───────────────────────────────────────────

def _message(blocks, stop_reason="end_turn", input_tokens=6000, output_tokens=3500):
    return SimpleNamespace(content=blocks, stop_reason=stop_reason, usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens))


def _text(t):
    return SimpleNamespace(type="text", text=t)


def _client(message):
    client = MagicMock()
    client.messages.create = AsyncMock(return_value=message)
    return client


async def _adapter_call(monkeypatch, message):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    client = _client(message)
    with patch.object(anthropic_provider, "get_client", return_value=client):
        return await AnthropicBlueprintReasoner().derive_blueprint(build_reasoner_input(default_ctx()), model="test-model"), client


async def test_the_adapter_sends_the_documented_request_and_parses_a_valid_response(monkeypatch):
    out, client = await _adapter_call(monkeypatch, _message([_text(json.dumps(tile_payload()))]))
    kwargs = client.messages.create.await_args.kwargs
    assert set(kwargs) == {"model", "max_tokens", "system", "output_config", "messages"} and "thinking" not in kwargs
    assert kwargs["max_tokens"] == MAX_RESPONSE_TOKENS and kwargs["output_config"] == {"effort": BLUEPRINT_EFFORT} and BLUEPRINT_EFFORT == "low"
    prompt = kwargs["messages"][0]["content"]
    assert prompt.startswith("Blueprint input (compact JSON):\n") and "\n  " not in prompt
    assert all(t not in prompt for _, _, _, t in SOURCE_LINES)
    assert out.reasoning_contract_version == BLUEPRINT_PROMPT_VERSION == "v3" and len(out.sections) == 5


async def test_truncated_empty_and_abnormal_responses_are_rejected_with_diagnostics(monkeypatch):
    with pytest.raises(BlueprintReasoningError, match="truncated at max_tokens") as e:
        await _adapter_call(monkeypatch, _message([_text(json.dumps(tile_payload()))], stop_reason="max_tokens", output_tokens=MAX_RESPONSE_TOKENS))
    assert e.value.diagnostics["stop_reason"] == "max_tokens" and e.value.diagnostics["output_tokens"] == MAX_RESPONSE_TOKENS
    thinking = SimpleNamespace(type="thinking", thinking="...", signature="s")
    for blocks in ([], [thinking], [_text("")], [_text("  \n ")]):
        with pytest.raises(BlueprintReasoningError, match="contained no text") as e:
            await _adapter_call(monkeypatch, _message(blocks))
        assert e.value.diagnostics["text_chars"] <= 5
    with pytest.raises(BlueprintReasoningError, match="unexpected stop_reason 'refusal'"):
        await _adapter_call(monkeypatch, _message([_text("{}")], stop_reason="refusal"))
    with pytest.raises(BlueprintReasoningError, match="not valid JSON") as e:
        await _adapter_call(monkeypatch, _message([_text("Sure! " + "blah " * 200)]))
    assert len(str(e.value)) < 1500


def test_diagnostics_are_metadata_only():
    d = response_diagnostics(_message([_text("private plan words " * 5)], stop_reason="max_tokens"))
    assert set(d) == {"stop_reason", "block_types", "has_text_block", "text_chars", "input_tokens", "output_tokens", "max_tokens"}
    with pytest.raises(BlueprintReasoningError) as e:
        extract_text_or_raise(_message([_text("private plan words " * 5)], stop_reason="max_tokens"))
    assert "private plan" not in str(e.value)


def test_the_system_prompt_states_the_non_negotiables():
    for phrase in ("STRUCTURE, never SUBJECT", "INSTRUCTIONS, NOT COPY", "Are you tired of wasting money on bad accountants?", "NOT_USED", "MANDATORY POINTS",
                   "PROHIBITED", "desired_cta", "15%", "blocked_source_terms", "do_not_carry_over", "NO PERFORMANCE CLAIMS", "begin with"):
        assert phrase in SYSTEM_PROMPT, phrase
    assert "even to say you are avoiding it" in SYSTEM_PROMPT
    assert "<<" not in SYSTEM_PROMPT and BLUEPRINT_PROMPT_VERSION == "v3"


def _max_blueprint_payload(scale: float) -> dict:
    sentence = ("Show the same room with the first option and then with the second option keeping the camera position and lighting identical so the "
                "contrast between the two outcomes is easy to read and the audience can follow the explanation of finish and size ").split()
    words = lambda n: " ".join((sentence * (int(n * scale) // len(sentence) + 1))[:int(n * scale)])
    sec = lambda i: {"section_number": i, "section_purpose": words(18), "structural_role": "development", "target_duration_seconds": 5, "mechanisms_applied": ["M01"],
                     "source_anatomy_relationship": {"relationship": "adapts_reference_structure", "anatomy_section_numbers": [1, 2]},
                     "content_instruction": words(45), "required_information": [words(12)] * 3, "visual_direction": words(30), "text_direction": words(30),
                     "speech_direction": words(30), "pacing_direction": words(20), "transition_direction": words(12), "cta_direction": words(20),
                     "mandatory_points_assigned": ["MP01"], "confidence": "medium", "limitations": [words(15)] * 2}
    return {"structural_approach": words(40),
            "mechanism_dispositions": [{"mechanism_id": "M01", "decision": "USED", "reason_category": None, "reason": None, "applied_in_sections": list(range(1, 13)), "application_rationale": words(50)}]
            + [{"mechanism_id": f"M{i:02d}", "decision": "NOT_USED", "reason_category": "other", "reason": words(25), "applied_in_sections": []} for i in range(2, 9)],
            "sections": [sec(i) for i in range(1, MAX_SECTIONS + 1)], "unassigned_mandatory_points": [], "limitations": [words(15)] * 4}


def test_output_budget_covers_the_largest_valid_blueprint():
    """Measured with the real tokenizer (count_tokens, claude-sonnet-5) on exactly this payload shape: the largest response that follows the
    prompt's concision limits is ~7.5k tokens (26.5k chars, 3.55 chars/token) and the same shape at 1.5x is ~10.1k tokens (36.9k chars, 3.67
    chars/token). Here a conservative 3.0 chars/token bound is used so the test needs no API."""
    compliant = json.dumps(_max_blueprint_payload(1.0), separators=(",", ":"))
    generous = json.dumps(_max_blueprint_payload(1.5), separators=(",", ":"))
    assert len(compliant) / 3.0 < MAX_RESPONSE_TOKENS * 0.7, "the prompt-compliant maximum must fit with >=30% headroom"
    assert len(generous) / 3.0 < MAX_RESPONSE_TOKENS * 0.95, "even a 1.5x-verbose maximum must fit"
    assert len(decide(_max_blueprint_payload(1.0)).sections) == MAX_SECTIONS
    assert MAX_RESPONSE_TOKENS == 14000


# ── router: provider disabled / provider-independent validation ──────────────────────────────────

async def test_with_no_provider_configured_nothing_is_called_and_a_descriptive_error_is_raised(monkeypatch):
    monkeypatch.setattr(settings, "BLUEPRINT_REASONER_PROVIDER", "")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    spy = MagicMock()
    with patch.object(anthropic_provider, "get_client", spy), patch.object(bp_router._REASONER_PROVIDERS["anthropic"], "derive_blueprint", AsyncMock()) as call:
        with pytest.raises(BlueprintReasoningError, match="BLUEPRINT_REASONER_PROVIDER is empty"):
            await derive_blueprint(default_ctx())
    spy.assert_not_called()
    call.assert_not_awaited()
    from app.config import Settings
    assert Settings.model_fields["BLUEPRINT_REASONER_PROVIDER"].default == ""


async def test_an_unknown_or_unconfigured_provider_is_refused(monkeypatch):
    monkeypatch.setattr(settings, "BLUEPRINT_REASONER_PROVIDER", "nonesuch")
    with pytest.raises(BlueprintReasoningError, match="not a recognized"):
        await derive_blueprint(default_ctx())
    monkeypatch.setattr(settings, "BLUEPRINT_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    with pytest.raises(BlueprintReasoningError, match="not configured"):
        await derive_blueprint(default_ctx())


async def _through_router(monkeypatch, payload, ctx=None):
    monkeypatch.setattr(settings, "BLUEPRINT_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    client = _client(_message([_text(json.dumps(payload))]))
    with patch.object(anthropic_provider, "get_client", return_value=client):
        return await derive_blueprint(ctx or default_ctx()), client


async def test_a_valid_provider_response_flows_through_the_real_router_validation(monkeypatch):
    res, client = await _through_router(monkeypatch, tile_payload())
    assert client.messages.create.await_count == 1 and res.provider == "anthropic" and len(res.decision.sections) == 5


@pytest.mark.parametrize("mutation, match", [
    (lambda p: p["mechanism_dispositions"].append({"mechanism_id": "M99", "decision": "USED", "reason_category": None, "reason": None, "applied_in_sections": [1], "application_rationale": "Section 1 applies the invented mechanism to the opening of the plan."}), "unknown mechanism id"),
    (lambda p: p["sections"][4].update(mandatory_points_assigned=[]), "neither assigned"),
    (lambda p: p["sections"][1].update(content_instruction="Introduce the options; the woman archetype frames the choice."), "NON-TRANSFERABLE"),
    (lambda p: p["sections"][1].update(content_instruction='Say "this one choice changes everything for you" here.'), "final copy"),
    (lambda p: p["sections"][1].update(content_instruction="Introduce the options with price comparisons."), "PROHIBITED element"),
    (lambda p: p["sections"][1].update(content_instruction="Introduce the options. This structure increases retention."), "claim"),
    (lambda p: p["sections"][1].update(speech_direction="Say never turn around and look back at the end."), "reproduces"),
])
async def test_safeguards_apply_to_real_provider_output_through_the_router(monkeypatch, mutation, match):
    p = tile_payload()
    mutation(p)
    with pytest.raises(BlueprintReasoningError, match=match):
        await _through_router(monkeypatch, p)


# ── the caller's PROHIBITED words never exempt source-subject terms (found in the pre-run dry run on the real intent) ──

REAL_LIKE_INTENT = {
    **tile_intent_min(), "business_or_brand": "generic tile retailer", "desired_cta": "visit the showroom or contact the business for guidance",
    "mandatory_points": ["different tile choices can create different finished outcomes", "customers can seek guidance before choosing"],
    "prohibited_claims_or_elements": ["guaranteed results", "unsupported performance claims", "copying the reference creator's relationship/gender narrative",
                                      "source-specific names, wording, watermark or identity"],
}


def test_words_the_caller_prohibits_do_not_count_as_the_callers_own_vocabulary():
    canonical = normalize_intent(REAL_LIKE_INTENT)
    used = intent_tokens(canonical)
    assert not {"relationship", "gender", "watermark", "identity", "guaranteed"} & used, "words that appear only in the prohibited list are not the caller's vocabulary"
    assert {"tile", "showroom", "guidance"} <= used
    blocked = set(default_ctx(REAL_LIKE_INTENT).guard.blocked_terms)
    assert {"relationship", "gendered", "watermark", "woman", "betrayal"} <= blocked


@pytest.mark.parametrize("word", ["relationship", "gender", "gendered", "genders", "watermark", "woman", "betrayal"])
def test_the_source_subject_and_the_named_exclusions_cannot_slip_into_a_blueprint_for_the_real_style_intent(word):
    ctx = default_ctx(REAL_LIKE_INTENT)
    p = tile_payload(cta=True)
    p["sections"][2]["content_instruction"] += f" Frame the contrast around {word}."
    with pytest.raises(BlueprintReasoningError, match="NON-TRANSFERABLE|PROHIBITED|prohibited"):
        validate(p, ctx)


def test_a_business_whose_own_topic_is_relationships_may_still_use_the_word():
    ctx = default_ctx({**REAL_LIKE_INTENT, "product_service_or_topic": "relationship coaching for couples"})
    assert "relationship" not in ctx.guard.blocked_terms and "betrayal" in ctx.guard.blocked_terms


def test_the_light_stemmer_catches_inflected_lifts_and_still_recognises_the_prohibited_phrases():
    from app.services.blueprint_reasoner.guards import _stem
    assert _stem("gendered") == "gender" == _stem("genders") and _stem("turned") == _stem("turning") == _stem("turns") == "turn"
    assert _stem("guaranteed") == "guarante" and _stem("results") == "result" and _stem("class") == "class"
    rejects(edit(lambda p: p["sections"][3].update(speech_direction="Promise guaranteed results for either finish.")), "PROHIBITED element|claim")
    validate(edit(lambda p: p["sections"][4].update(speech_direction="Warm, reassuring close; avoid price comparisons and guaranteed results.")))


# ══ OFFLINE CORRECTION (after the first real response): null unknown keys, domain-aware claim guard, prompt v3, application_rationale ══

# ── unknown keys: null is ignored, anything with content is rejected ─────────────────────────────

def test_an_unknown_key_with_a_null_value_is_ignored_at_every_level_and_recorded():
    p = tile_payload()
    p["structural_role_note"] = None                                        # top level
    p["sections"][2]["structural_role_note"] = None                         # the exact shape seen in the first real response
    p["sections"][0]["source_anatomy_relationship"]["extra_note"] = None
    p["mechanism_dispositions"][0]["helper"] = None
    p["unassigned_mandatory_points"] = [{"id": "MP01", "reason": "Placed in the closing summary instead.", "note": None}]
    p["sections"][0]["mandatory_points_assigned"] = []
    p["sections"][2]["mandatory_points_assigned"] = []
    p["sections"][3]["mandatory_points_assigned"] = []
    d = decide(p)
    assert sorted(d.ignored_null_fields) == sorted([
        "Blueprint response.structural_role_note", "sections[3].structural_role_note", "sections[1].source_anatomy_relationship.extra_note",
        "mechanism_dispositions[1].helper", "unassigned_mandatory_points[1].note"])
    validate(p)
    bp = finalize_blueprint(d, default_ctx(), PINS, [])
    assert bp["provenance"]["ignored_null_fields"] == d.ignored_null_fields


@pytest.mark.parametrize("where", ["top", "section", "relationship", "disposition", "unassigned"])
def test_an_unknown_key_with_a_non_null_value_is_still_rejected(where):
    p = tile_payload()
    if where == "top":
        p["structural_role_note"] = "important explanation"
    elif where == "section":
        p["sections"][2]["structural_role_note"] = "important explanation"
    elif where == "relationship":
        p["sections"][0]["source_anatomy_relationship"]["note"] = "x"
    elif where == "disposition":
        p["mechanism_dispositions"][0]["helper"] = "x"
    else:
        p["unassigned_mandatory_points"] = [{"id": "MP01", "reason": "Placed elsewhere in the plan.", "note": "x"}]
    with pytest.raises(BlueprintReasoningError, match="unexpected"):
        decide(p)


@pytest.mark.parametrize("falsy", ["", 0, False, [], {}])
def test_only_null_is_ignored_other_empty_values_are_still_unknown_fields(falsy):
    p = tile_payload()
    p["sections"][2]["structural_role_note"] = falsy
    with pytest.raises(BlueprintReasoningError, match="unexpected field"):
        decide(p)


def test_a_null_value_never_rescues_a_missing_required_field():
    p = tile_payload()
    del p["sections"][1]["content_instruction"]
    p["sections"][1]["structural_role_note"] = None
    with pytest.raises(BlueprintReasoningError, match="missing required field"):
        decide(p)


# ── domain-aware claim guard: description vs content performance vs unsupported causation ────────

@pytest.mark.parametrize("text", [
    "Show a successful tile and room pairing.", "Compare two renovation outcomes.", "Show the resulting room appearance.",
    "Explain the result of choosing the wrong material.", "Compare the performance of two materials in a wet room.",
    "Explain what causes grout to discolour over time.", "That is why suitability depends on the room.", "Show the finished result of each option.",
    "Explain how one choice can lead to a very different finished look.", "Show why a successful renovation starts with the right material.",
    "Describe an unsuccessful pairing and what went wrong in the room.", "Highlight how each finish affects the room's appearance.",
    "Explain how this section leads into the next comparison.", "The results of the two options are compared on screen.",
    "Keep the outcome comparison neutral and factual.", "A well-matched tile and room deliver a durable result.",
])
def test_ordinary_domain_wording_about_success_outcomes_and_results_is_allowed(text):
    assert find_claim(text) is None, find_claim(text)
    validate(edit(lambda p: p["sections"][3].update(content_instruction=text)))


@pytest.mark.parametrize("claim", [
    "This hook increases retention.", "This structure performs better.", "This mechanism drives engagement.", "This video will convert viewers.",
    "Using this approach guarantees results.", "Informed choice leads to better results.", "The opening is highly effective.",
    "This section improves results.", "The approach works because it is tight.", "This makes viewers continue watching.", "It went viral.",
    "This will boost sales.", "The structure produces better results.", "Viewers will definitely trust the brand.", "This format keeps viewers watching.",
    "The sequence results in higher engagement.", "This hook is a strong hook.", "This content will succeed.", "It increases conversions.",
])
def test_content_performance_and_unsupported_causal_claims_are_rejected(claim):
    assert find_claim(claim) is not None
    rejects(edit(lambda p: p["sections"][3].update(content_instruction=f"Show the two options. {claim}")), "claim")


def test_hedging_does_not_launder_a_content_performance_or_causal_claim():
    for claim in ("This hook may increase retention.", "This structure could perform better.", "Informed choice tends to lead to better results.",
                  "The approach appears to work because it is tight."):
        assert find_claim(claim) is not None, claim


def test_guarantee_is_a_claim_unless_it_is_explicitly_negated():
    assert find_claim("Do not promise guaranteed results.") is None and find_claim("Avoid any guarantee of an outcome.") is None
    assert find_claim("Promise guaranteed results.") is not None and find_claim("Do not hesitate; guarantee the outcome.") is not None


def test_the_first_real_response_wording_is_classified_correctly():
    """The three fields that tripped the reused C3 guard on the first real response."""
    assert find_claim("State practical reasoning for this pairing's success.") is None                 # domain: the tile pairing
    assert find_claim("Clean, well-lit shot conveying a successful outcome.") is None                  # domain: the room outcome
    assert find_claim("Summarize the core takeaway that informed choice leads to better results") is not None   # unsupported causal claim


# ── prompt v3 ───────────────────────────────────────────────────────────────────────────────────

def test_prompt_v3_states_the_corrections_without_hard_coding_any_business_domain():
    for phrase in ("Return ONLY the fields defined by this schema", "do not add null fields outside the schema", "DISTINCT SECTIONS", "distinct structural job",
                   "could be combined without losing structural meaning", "EXAMPLE of progression, not a template", "DO NOT try to use every mechanism",
                   "materially improve this NEW", "PRESERVE THE EXACT PRINCIPLE", "DEFINING RELATIONSHIP", "same situation with choice A versus the same situation with choice B",
                   "application_rationale", "at most 400 characters", "NOT satisfied by contrast between two DIFFERENT subjects"):
        assert phrase in SYSTEM_PROMPT, phrase
    lowered = SYSTEM_PROMPT.lower()
    for domain_word in ("tile", "renovation", "showroom", "bathroom"):
        assert domain_word not in lowered, f"the prompt must not hard-code a business domain ({domain_word!r})"
    assert BLUEPRINT_PROMPT_VERSION == "v3"


# ── application_rationale ───────────────────────────────────────────────────────────────────────

def test_application_rationale_is_required_for_every_used_mechanism_from_prompt_v3():
    assert schema_requires_rationale("v3") and schema_requires_rationale("v10") and not schema_requires_rationale("v2") and not schema_requires_rationale("v1")
    assert not schema_requires_rationale(None) and not schema_requires_rationale("draft")
    p = tile_payload()
    del p["mechanism_dispositions"][1]["application_rationale"]
    with pytest.raises(BlueprintReasoningError, match="USED but has no application_rationale"):
        decision_from_payload(p, reasoning_contract_version="v3")
    p["mechanism_dispositions"][1]["application_rationale"] = "   "
    with pytest.raises(BlueprintReasoningError, match="no application_rationale"):
        decision_from_payload(p, reasoning_contract_version="v3")


def test_a_pre_v3_response_without_rationales_still_parses_for_replay_and_the_gap_is_a_quality_note_not_a_rejection():
    p = tile_payload()
    for d in p["mechanism_dispositions"]:
        d.pop("application_rationale", None)
    d2 = decision_from_payload(p, reasoning_contract_version="v2")
    validate_decision(d2, default_ctx())
    notes = quality_findings(d2, default_ctx())
    assert any("M01 is USED without an application_rationale" in n for n in notes)
    bp = finalize_blueprint(d2, default_ctx(), PINS, [])
    assert any(g["kind"] == "quality_note" and "application_rationale" in g["reason"] for g in bp["gaps"])


@pytest.mark.parametrize("value, match", [
    ("too short", "40-600 characters"), ("x" * 601, "40-600 characters"), (12345, "application_rationale"),
])
def test_an_application_rationale_must_be_a_real_explanation(value, match):
    p = tile_payload()
    p["mechanism_dispositions"][0]["application_rationale"] = value
    with pytest.raises(BlueprintReasoningError, match=match):
        decide(p)


def test_a_not_used_mechanism_must_not_carry_an_application_rationale():
    p = tile_payload()
    p["mechanism_dispositions"][3]["application_rationale"] = "Section 5 would apply the pacing principle to the close of the plan."
    with pytest.raises(BlueprintReasoningError, match="only valid for USED"):
        decide(p)


def test_the_rationale_must_say_where_the_principle_is_instantiated():
    def rewrite(text):
        def go(p):
            p["mechanism_dispositions"][1]["application_rationale"] = text
        return go
    rejects(edit(rewrite("The contrast principle is applied faithfully to the new subject and preserved in the plan overall.")), "does not name any section")
    rejects(edit(rewrite("Section 5 holds the room constant while contrasting two tile choices in the plan overall.")), "does not name any section")   # M02 is in section 3
    validate(edit(rewrite("Section 3 holds the room and layout constant while contrasting two tile choices and their consequences.")))
    validate(edit(rewrite("Sections 2\u20133 hold the room constant while contrasting two tile choices and their consequences.")))   # a range that includes 3
    validate(edit(rewrite("Across sections 3, and 4 the same room is held constant while only the tile choice changes in the plan.")))


def test_the_rationale_passes_the_same_text_guards_as_every_other_field():
    def rewrite(text):
        def go(p):
            p["mechanism_dispositions"][1]["application_rationale"] = text
        return go
    rejects(edit(rewrite("Section 3 contrasts a betrayal story with the tile choice to show two outcomes in the plan.")), "NON-TRANSFERABLE")
    rejects(edit(rewrite("Section 3 holds the room constant, and this contrast increases retention for the plan overall.")), "claim")
    rejects(edit(rewrite('Section 3 holds the room constant and says "this one choice changes everything for you" here.')), "final copy")


def test_the_rationale_is_carried_into_the_finalised_blueprint_and_the_response_schema():
    from app.schemas.reconstruction_blueprint import Blueprint
    bp = finalize_blueprint(decide(tile_payload()), default_ctx(), PINS, [])
    disp = {d["mechanism_id"]: d for d in bp["mechanism_dispositions"]}
    assert disp["M02"]["application_rationale"].startswith("Section 3 holds the same room") and disp["M04"]["application_rationale"] is None
    assert Blueprint.model_validate(bp).mechanism_dispositions[1].application_rationale == disp["M02"]["application_rationale"]


# ── non-blocking quality findings (repetition, mechanical use) ───────────────────────────────────

def test_repetitive_sections_and_all_mechanisms_used_are_reported_as_quality_notes_not_rejections():
    def repeat(p):
        p["sections"][2]["section_purpose"] = p["sections"][1]["section_purpose"]
        p["sections"][2]["content_instruction"] = p["sections"][1]["content_instruction"]
    p = edit(repeat)
    validate(p)                                                            # still valid: quality is a note, not a rule
    notes = quality_findings(decide(p), default_ctx())
    assert any(n.startswith("sections 2 and 3 have very similar instructions") and "100%" in n for n in notes)
    bp = finalize_blueprint(decide(p), default_ctx(), PINS, [])
    assert any(g["kind"] == "quality_note" and "sections 2 and 3" in g["reason"] for g in bp["gaps"])
    assert not any("all 4 mechanisms" in n for n in notes)                 # M04 is NOT_USED in the fixture

    def all_used(p):
        p["mechanism_dispositions"][3].update(decision="USED", reason_category=None, reason=None, applied_in_sections=[5],
                                              application_rationale="Section 5 eases the pace into a quieter close, applying the closure principle in the plan.")
        p["sections"][4]["mechanisms_applied"] = ["M04"]
    assert any("all 4 mechanisms were marked USED" in n for n in quality_findings(decide(edit(all_used)), default_ctx()))


def test_distinct_sections_produce_no_repetition_note():
    assert not any("very similar" in n for n in quality_findings(decide(tile_payload()), default_ctx()))


# ── replaying the SHAPE of the first real response (the real one is replayed by the offline harness) ──

def test_the_first_real_response_shape_now_passes_the_contract_and_fails_only_on_the_unsupported_causal_claim():
    p = tile_payload()
    for d in p["mechanism_dispositions"]:
        d.pop("application_rationale", None)                               # a v2 response had no rationale field
    p["sections"][3]["structural_role_note"] = None                        # the null extra key
    p["sections"][2]["speech_direction"] = "State practical reasoning for this pairing's success."
    p["sections"][3]["visual_direction"] = "Clean, well-lit shot conveying a successful outcome."
    p["sections"][3]["section_purpose"] = "Summarize the core takeaway that informed choice leads to better results"
    d = decision_from_payload(p, reasoning_contract_version="v2")           # A. contract: passes
    assert d.ignored_null_fields == ["sections[4].structural_role_note"]
    with pytest.raises(BlueprintReasoningError, match=r"section 4\.section_purpose makes a causal-outcome claim \('leads to better'\)"):   # B. safety: only the causal claim
        validate_decision(d, default_ctx())
    p["sections"][3]["section_purpose"] = "Summarize the core takeaway that matching the tile to the room matters"
    validate_decision(decision_from_payload(p, reasoning_contract_version="v2"), default_ctx())
