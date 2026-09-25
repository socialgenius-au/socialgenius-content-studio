"""
C3 -- Transferable Mechanism reasoner tests: contract, language/verbatim guards, anatomy-aware validation,
provider parsing, router. PURE tests: anatomies are built with C2's own pure builder from hand-made aggregates
(no database, no ffmpeg), and the Anthropic client is always mocked -- NO real provider call is ever made.
"""
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.services.content_anatomy_svc import build_content_anatomy
from app.services.mechanism_reasoner import (
    MECHANISM_TYPES, TAXONOMY_VERSION, Mechanism, MechanismDecision, MechanismInputError, MechanismReasoningError,
    NonTransferableElement, derive_mechanisms,
)
from app.services.mechanism_reasoner import router as mech_router
from app.services.mechanism_reasoner.anatomy_input import (
    build_reasoner_input, section_features, serialize_reasoner_input, valid_evidence_ids, valid_section_numbers, video_features,
)
from app.services.mechanism_reasoner.language_guard import (
    build_source_index, reject_prohibited_language, reject_source_reproduction, tokenize,
)
from app.services.mechanism_reasoner.parsing import decision_from_payload, parse_json_object
from app.services.mechanism_reasoner.providers import anthropic_provider
from app.services.mechanism_reasoner.providers.anthropic_provider import (
    MAX_RESPONSE_TOKENS, MECHANISM_EFFORT, MECHANISM_PROMPT_VERSION, SYSTEM_PROMPT, AnthropicMechanismReasoner, build_user_prompt,
    extract_text_or_raise, response_diagnostics,
)
from app.services.mechanism_reasoner.validation import (
    MAX_MECHANISMS, derive_overall_limitations, finalize_mechanisms, validate_decision,
)
from tests.test_content_anatomy_svc import THREE_BEATS, aggregate, device, shot, speech, text

# ── fixtures ──────────────────────────────────────────────────────────────────────────────────

OPENING_LINE = "Have you ever wondered why your videos never get traction"
SYSTEM_LINE = "Here is the three step system we use every single week for clients"


def rich_anatomy(**overrides):
    """3 Story-Beat sections. Section 1: opening/hook + speech + on-screen text + silence. Section 2: speech + a cut.
    Section 3: a cut. No accepted retention devices, no interpretive roles."""
    kw = dict(
        beats=THREE_BEATS,
        speeches=[speech(1, 0.0, 4.0, OPENING_LINE), speech(2, 12.0, 18.0, SYSTEM_LINE)],
        shots=[shot(1, 0, 0.0, 10.0, texts=[text(21, "Stop scrolling right now", 1.0, 2.0)]), shot(2, 1, 10.0, 20.0), shot(3, 2, 20.0, 30.0)],
        silences=[{"id": 41, "start_time": 8.0, "end_time": 9.5}],
        hook_window={"start_time": 0.0, "end_time": 3.0, "certainty": "MEASURED", "details": {"derived_from": "shot", "source_id": 1}},
    )
    kw.update(overrides)
    return build_content_anatomy(aggregate(**kw))


def mech(**over) -> Mechanism:
    base = dict(
        mechanism_type="hook_curiosity",
        statement="The opening appears designed to pose an unresolved question before any explanation is given.",
        scope="sections", section_numbers=[1],
        supporting_evidence_ids={"speech_segments": [1], "text_elements": [21]},
        anatomy_features_used=["speech", "hook_window"],
        transferable_principle="Open with an unresolved question, then hold the explanation back until a later part.",
        non_transferable_elements=[NonTransferableElement("wording", "The specific question about videos failing to gain traction and its phrasing")],
        confidence="medium", limitations=["The anatomy does not establish the narrative role of this opening."],
    )
    base.update(over)
    return Mechanism(**base)


def reveal(**over) -> Mechanism:
    base = dict(
        mechanism_type="information_reveal",
        statement="Section one introduces a problem that the later walkthrough appears designed to answer.",
        scope="sections", section_numbers=[1, 2],
        supporting_evidence_ids={"speech_segments": [1, 2]},
        anatomy_features_used=["speech", "progression"],
        transferable_principle="Pose the problem first, then deliver the structured answer in a later part.",
        non_transferable_elements=[NonTransferableElement("subject_matter", "The video-marketing subject and the particular step-by-step system")],
        confidence="medium",
    )
    base.update(over)
    return Mechanism(**base)


def rhythm(**over) -> Mechanism:
    base = dict(
        mechanism_type="pacing_rhythm",
        statement="The later sections place a cut at an even ten-second interval, creating a structural steady cadence.",
        scope="sections", section_numbers=[2, 3],
        supporting_evidence_ids={"shots": [2, 3]},
        anatomy_features_used=["cuts", "pacing"],
        transferable_principle="Keep a predictable cutting cadence so each new beat arrives at an even interval.",
        non_transferable_elements=[NonTransferableElement("timing_specific", "The exact ten-second spacing used in this source")],
        confidence="low",
    )
    base.update(over)
    return Mechanism(**base)


def decision(*mechanisms, limits=()):
    return MechanismDecision(mechanisms=list(mechanisms), overall_limitations=list(limits), reasoning_contract_version="v1")


def rejected_with(match: str, dec, anatomy=None):
    with pytest.raises(MechanismReasoningError, match=match):
        validate_decision(dec, anatomy or rich_anatomy())


# ── valid mechanism / multiple mechanisms ─────────────────────────────────────────────────────

def test_a_valid_mechanism_passes_validation_and_is_finalised_with_a_stable_id_and_provenance():
    a = rich_anatomy()
    d = decision(mech())
    validate_decision(d, a)
    [m] = finalize_mechanisms(d, a, {"provider": "anthropic", "model": "m", "prompt_version": "v1"})
    assert m["mechanism_id"] == "M01" and m["mechanism_type"] == "hook_curiosity"
    assert m["certainty"] == "INFERRED" and m["confidence"] == "medium"
    assert m["scope"] == "sections" and m["section_numbers"] == [1]
    assert m["supporting_evidence_ids"] == {"speech_segments": [1], "text_elements": [21]}
    assert m["anatomy_features_used"] == ["hook_window", "speech"]
    assert m["transferable_principle"] and m["non_transferable_elements"][0]["kind"] == "wording"


def test_multiple_mechanisms_are_allowed_and_get_sequential_ids():
    a = rich_anatomy()
    d = decision(mech(), reveal(), rhythm())
    validate_decision(d, a)
    assert [m["mechanism_id"] for m in finalize_mechanisms(d, a, {})] == ["M01", "M02", "M03"]


def test_two_mechanisms_of_the_same_type_are_allowed_only_when_structurally_different():
    a = rich_anatomy()
    other_reveal = reveal(section_numbers=[2, 3], supporting_evidence_ids={"speech_segments": [2]}, anatomy_features_used=["speech", "cuts"])
    validate_decision(decision(reveal(), other_reveal), a)
    rejected_with("duplicates another mechanism", decision(reveal(), reveal()), a)


def test_too_many_mechanisms_are_rejected():
    a = rich_anatomy()
    many = [reveal(other_label=None, section_numbers=[1, 2], anatomy_features_used=["speech", "progression"]) for _ in range(MAX_MECHANISMS + 1)]
    rejected_with("max 12", decision(*many), a)


# ── zero accepted retention devices / no mechanisms ───────────────────────────────────────────

def test_zero_accepted_retention_devices_is_valid_and_is_recorded_as_a_limitation_not_assumed():
    a = rich_anatomy()
    assert a["video"]["retention"]["accepted_count"] == 0
    d = decision(mech())
    validate_decision(d, a)
    limits = derive_overall_limitations(a, d)
    assert any("No accepted retention devices" in x and "none were assumed" in x for x in limits)


def test_a_mechanism_claiming_an_accepted_device_feature_is_rejected_when_the_anatomy_has_none():
    rejected_with("'accepted_retention_device'.*not present",
                  decision(mech(mechanism_type="pattern_interruption", statement="The moment appears designed to interrupt the pattern.",
                                anatomy_features_used=["accepted_retention_device"])))


def test_an_accepted_device_in_the_anatomy_can_be_used_but_a_rejected_candidate_cannot_be_cited_as_one():
    a = rich_anatomy(accepted=[device(60, 1.0, 2.0, dtype="text_reveal")])
    assert a["sections"][0]["retention_devices"], "fixture must carry an accepted device"
    m = mech(mechanism_type="pattern_interruption", statement="The text moment appears designed to interrupt the flow.",
             supporting_evidence_ids={"retention_devices": [60]}, anatomy_features_used=["accepted_retention_device"])
    validate_decision(decision(m), a)
    rejected_with("not in the cited sections", decision(mech(supporting_evidence_ids={"retention_devices": [999]})), a)


def test_no_supported_mechanism_is_a_valid_empty_result_with_a_recorded_limitation():
    a = rich_anatomy()
    d = decision()
    validate_decision(d, a)
    assert finalize_mechanisms(d, a, {}) == []
    assert any("No mechanism was supported" in x for x in derive_overall_limitations(a, d))


def test_provider_stated_overall_limitations_are_kept_and_language_checked():
    a = rich_anatomy()
    d = decision(limits=["The transcript is too short to support a mechanism."])
    assert "The transcript is too short to support a mechanism." in derive_overall_limitations(a, d)
    rejected_with("prohibited", decision(limits=["Nothing here is effective."]), a)


# ── taxonomy ─────────────────────────────────────────────────────────────────────────────────

def test_the_approved_v1_taxonomy_is_exactly_the_sixteen_types():
    assert TAXONOMY_VERSION == "v1"
    assert MECHANISM_TYPES == {
        "hook_curiosity", "problem_tension", "information_reveal", "progression", "contrast", "proof_credibility",
        "demonstration", "pattern_interruption", "pacing_rhythm", "emotional_progression", "payoff_resolution",
        "cta_next_step", "visual_attention", "audio_attention", "text_attention", "other",
    }


def test_an_unknown_mechanism_type_is_rejected_by_the_contract_and_by_parsing():
    with pytest.raises(ValueError, match="mechanism_type must be one of"):
        mech(mechanism_type="viral_formula")
    payload = {"mechanisms": [{**_payload_mech(), "mechanism_type": "viral_formula"}]}
    with pytest.raises(MechanismReasoningError, match="mechanism_type must be one of"):
        decision_from_payload(payload)


def test_the_taxonomy_is_not_forced_zero_or_one_mechanism_per_type_is_never_required():
    a = rich_anatomy()
    validate_decision(decision(rhythm()), a)  # a single mechanism of a single type is complete


# ── "other" ───────────────────────────────────────────────────────────────────────────────────

def test_other_requires_an_explicit_label_and_rationale():
    with pytest.raises(ValueError, match="requires an explicit"):
        mech(mechanism_type="other")
    with pytest.raises(ValueError, match="requires an explicit"):
        mech(mechanism_type="other", other_label="Direct address")
    ok = mech(mechanism_type="other", other_label="Direct address opener", other_rationale="Section one's speech addresses the viewer directly.",
              statement="The opening appears designed to address the viewer directly.", anatomy_features_used=["speech", "hook_window"])
    validate_decision(decision(ok), rich_anatomy())
    [m] = finalize_mechanisms(decision(ok), rich_anatomy(), {})
    assert m["other_label"] == "Direct address opener" and m["other_rationale"]


def test_other_cannot_rename_a_named_type_and_the_label_is_invalid_on_a_named_type():
    with pytest.raises(ValueError, match="duplicates a named taxonomy type"):
        mech(mechanism_type="other", other_label="Hook curiosity", other_rationale="x")
    with pytest.raises(ValueError, match="only valid when mechanism_type is 'other'"):
        mech(other_label="Something")


# ── evidence safeguards ───────────────────────────────────────────────────────────────────────

def test_an_invalid_evidence_id_is_rejected():
    rejected_with("invented provenance", decision(mech(supporting_evidence_ids={"speech_segments": [1, 4242]})))


def test_an_evidence_id_that_exists_but_outside_the_cited_sections_is_rejected():
    rejected_with("not in the cited sections", decision(mech(supporting_evidence_ids={"speech_segments": [2]})))  # speech 2 is in section 2


def test_a_video_scoped_mechanism_may_cite_any_anatomy_id_but_still_only_anatomy_ids():
    a = rich_anatomy()
    ok = mech(mechanism_type="pacing_rhythm", statement="Cuts place a steady cadence across the video.", scope="video", section_numbers=[],
              supporting_evidence_ids={"shots": [1, 2, 3]}, anatomy_features_used=["pacing_profile", "cuts"],
              transferable_principle="Keep a predictable cutting cadence across the whole piece.")
    validate_decision(decision(ok), a)
    invented = mech(mechanism_type="pacing_rhythm", statement="Cuts place a steady cadence across the video.", scope="video",
                    section_numbers=[], supporting_evidence_ids={"shots": [77]}, anatomy_features_used=["pacing_profile"])
    rejected_with("invented provenance", decision(invented), a)


def test_a_nonexistent_section_number_is_rejected():
    rejected_with("do not exist in the anatomy", decision(mech(section_numbers=[9])))


def test_a_mechanism_with_no_evidence_ids_cannot_be_constructed():
    with pytest.raises(ValueError, match="at least one supporting evidence id"):
        mech(supporting_evidence_ids={})
    with pytest.raises(ValueError, match="at least one supporting evidence id"):
        mech(supporting_evidence_ids={"speech_segments": []})


def test_unknown_evidence_categories_and_unknown_features_are_rejected_by_the_contract():
    with pytest.raises(ValueError, match="unsupported key"):
        mech(supporting_evidence_ids={"raw_frames": [1]})
    with pytest.raises(ValueError, match="unknown feature"):
        mech(anatomy_features_used=["vibes"])
    with pytest.raises(ValueError, match="non-empty list of feature names"):
        mech(anatomy_features_used=[])


def test_a_claimed_feature_that_is_not_present_in_the_cited_sections_is_rejected():
    rejected_with("'on_screen_text'.*not present in the cited sections",
                  decision(mech(section_numbers=[2], supporting_evidence_ids={"speech_segments": [2]}, anatomy_features_used=["speech", "on_screen_text"])))


def test_type_gates_reject_a_type_the_anatomy_does_not_support():
    a = rich_anatomy()
    # text_attention with no on-screen text in scope
    rejected_with("must rest on at least one of", decision(mech(mechanism_type="text_attention", statement="Text appears designed to draw the eye.",
                                                                section_numbers=[2], supporting_evidence_ids={"speech_segments": [2]}, anatomy_features_used=["speech"])), a)
    # pacing_rhythm where the anatomy shows no cuts (section 1)
    rejected_with("needs measured cuts", decision(mech(mechanism_type="pacing_rhythm", statement="The cut pattern places a rhythm.",
                                                       section_numbers=[1], supporting_evidence_ids={"shots": [1]}, anatomy_features_used=["pacing"])), a)
    # hook_curiosity away from the opening/hook
    rejected_with("anchored to the opening/hook", decision(mech(section_numbers=[3], supporting_evidence_ids={"shots": [3]}, anatomy_features_used=["cuts"])), a)
    # contrast with a single section
    rejected_with("at least two sections", decision(mech(mechanism_type="contrast", statement="A contrast appears designed between parts.",
                                                         section_numbers=[1], anatomy_features_used=["speech"])), a)


def test_a_zero_section_anatomy_and_malformed_anatomies_are_input_errors_before_any_provider_is_consulted():
    empty = rich_anatomy(shots=[], beats=None)
    assert empty["sections"] == []
    for bad in (empty, "not an anatomy", {}, {"sections": [{"number": 1}], "provenance": {}},
                {**rich_anatomy(), "provenance": {**rich_anatomy()["provenance"], "fingerprint": ""}}):
        with pytest.raises(MechanismInputError):
            validate_decision(decision(), bad)


# ── language safeguards ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("statement", [
    "The opening appears designed to be effective at hooking people.",
    "The cut pattern appears to have made the video successful.",
    "The reveal appears to drive high engagement.",
    "This structure appears designed to go viral.",
    "The placement keeps viewers watching until the end.",
    "This placement holds attention until the final section.",
    "The opening is a strong hook that places a question first.",
    "The sequence introduces a reveal with a score of eight out of ten.",
    "The structure appears designed to increase retention.",
    "The opening appears designed to boost watch time.",
])
def test_unsupported_performance_claims_are_rejected(statement):
    rejected_with("prohibited performance/outcome claim|prohibited causal", decision(mech(statement=statement)))


@pytest.mark.parametrize("statement", [
    "The question caused viewers to keep watching.",
    "This is why the video worked; it appears designed that way.",
    "Viewers will definitely respond to the reveal that the opening places first.",
    "The reveal appears designed to guarantee curiosity.",
    "Placing the payoff last led to a higher completion.",
    "The opening proves the structure works and places the question first.",
    "The cut introduces a beat because viewers scroll away otherwise.",
    "The opening ensures the viewer notices the question.",
])
def test_unsupported_causal_or_certainty_language_is_rejected(statement):
    rejected_with("prohibited", decision(mech(statement=statement)))


@pytest.mark.parametrize("statement", [
    "The opening places a question before the answer and appears designed to delay the explanation.",
    "A succession of short cuts creates a structural steady cadence.",
    "The accepted retention device introduces a text prompt at the pause.",
    "The opening appears designed to ensure the question is stated before the answer.",
])
def test_benign_structural_language_is_not_over_blocked(statement):
    reject_prohibited_language(statement)


def test_every_prose_field_is_language_guarded_not_just_the_statement():
    rejected_with("prohibited", decision(mech(transferable_principle="Open with a question that is highly engaging.")))
    rejected_with("prohibited", decision(mech(non_transferable_elements=[NonTransferableElement("wording", "A viral catchphrase")])))
    rejected_with("prohibited", decision(mech(limitations=["Effective only for this audience."])))


def test_a_statement_without_design_language_is_rejected():
    rejected_with("cautious design language", decision(mech(statement="Opening question about the topic.")))


# ── transferability safeguards ───────────────────────────────────────────────────────────────

def test_a_transferable_principle_and_a_non_transferable_element_are_both_mandatory():
    with pytest.raises(ValueError, match="transferable_principle is required"):
        mech(transferable_principle="  ")
    with pytest.raises(ValueError, match="at least one non_transferable element"):
        mech(non_transferable_elements=[])
    with pytest.raises(ValueError, match="non-empty description"):
        NonTransferableElement("wording", " ")
    with pytest.raises(ValueError, match="kind must be one of"):
        NonTransferableElement("vibes", "x")


def test_a_principle_that_copies_source_wording_is_rejected_but_a_short_shared_phrase_is_not():
    rejected_with("reproduces 5 consecutive words",
                  decision(mech(transferable_principle="Ask have you ever wondered why your videos before explaining anything.")))
    validate_decision(decision(mech(transferable_principle="Ask a question the viewer wonders about, then explain why it matters.")), rich_anatomy())


def test_a_short_on_screen_line_of_four_words_cannot_be_reproduced_whole_in_the_principle():
    rejected_with("reproduces 4 consecutive words", decision(mech(transferable_principle="Flash 'Stop scrolling right now' over the first shot.")))


def test_non_transferable_descriptions_may_quote_a_few_words_but_never_a_passage():
    ok = mech(non_transferable_elements=[NonTransferableElement("wording", "The phrase 'never get traction' is specific to this source")])
    validate_decision(decision(ok), rich_anatomy())
    long_quote = mech(non_transferable_elements=[NonTransferableElement("wording", f"The line '{OPENING_LINE}' is source-specific")])
    rejected_with("reproduces 7 consecutive words", decision(long_quote))


def test_verbatim_matching_ignores_case_and_punctuation_and_handles_non_latin_text():
    idx = build_source_index([OPENING_LINE], 5)
    with pytest.raises(MechanismReasoningError):
        reject_source_reproduction("f", "HAVE you EVER wondered... why, your videos!", idx)
    idx_hi = build_source_index(["आपके वीडियो को व्यूज़ क्यों नहीं मिलते हैं"], 5)
    with pytest.raises(MechanismReasoningError):
        reject_source_reproduction("f", "आपके वीडियो को व्यूज़ क्यों", idx_hi)
    assert tokenize("Don't stop-scrolling!") == ["don", "t", "stop", "scrolling"]


def test_a_principle_may_not_point_at_this_sources_own_sections_or_timestamps():
    rejected_with("own section numbers or timestamps", decision(mech(transferable_principle="Open with a question, as section 1 does.")))
    rejected_with("own section numbers or timestamps", decision(mech(transferable_principle="Ask the question at 0:03 and delay the answer.")))


# ── gaps, confidence, certainty ──────────────────────────────────────────────────────────────

def test_the_anatomys_relevant_gaps_are_propagated_onto_each_mechanism():
    a = rich_anatomy()
    d = decision(mech(), reveal())
    [hook, rev] = finalize_mechanisms(d, a, {})
    hook_gap_fields = {g["field"] for g in hook["limitations"]["anatomy_gaps"]}
    assert "narrative_role" in hook_gap_fields
    assert {"narrative_role", "messaging_role"} <= {g["field"] for g in rev["limitations"]["anatomy_gaps"]}
    assert hook["limitations"]["model_stated"] == ["The anatomy does not establish the narrative role of this opening."]
    assert all(set(g) == {"field", "kind", "reason", "section_number"} for g in hook["limitations"]["anatomy_gaps"])


def test_a_gap_about_a_stage_that_did_not_run_is_attached_to_mechanisms_relying_on_that_evidence():
    a = rich_anatomy(stage_overrides={"speech_analysis": "not_run"})
    [m] = finalize_mechanisms(decision(mech()), a, {})
    assert any(g["field"] == "stage:speech_analysis" for g in m["limitations"]["anatomy_gaps"])


def test_interpretive_dependent_types_cannot_be_high_confidence_while_the_anatomy_field_is_null():
    a = rich_anatomy()
    base = dict(mechanism_type="emotional_progression", statement="The sequence appears designed to shift tone from question to answer.",
                section_numbers=[1, 2], supporting_evidence_ids={"speech_segments": [1, 2]}, anatomy_features_used=["speech"])
    rejected_with("confidence cannot be 'high'", decision(mech(**base, confidence="high")), a)
    validate_decision(decision(mech(**base, confidence="medium")), a)
    cta = dict(mechanism_type="cta_next_step", statement="The closing section appears designed to point to a next step.",
               section_numbers=[2], supporting_evidence_ids={"speech_segments": [2]}, anatomy_features_used=["speech"])
    rejected_with("confidence cannot be 'high'", decision(mech(**cta, confidence="high")), a)
    supplied = copy.deepcopy(a)
    supplied["sections"][0]["interpretive"]["emotional_function"] = "curiosity"  # upstream genuinely supplies it
    validate_decision(decision(mech(**{**base, "section_numbers": [1, 2]}, confidence="high")), supplied)


def test_confidence_is_categorical_and_certainty_is_always_inferred():
    for bad in ("certain", 0.9, "HIGH", None):
        with pytest.raises(ValueError, match="confidence must be one of"):
            mech(confidence=bad)
    with pytest.raises(ValueError, match="certainty must be 'INFERRED'"):
        mech(certainty="MEASURED")
    for level in ("low", "medium", "high"):
        assert mech(confidence=level, mechanism_type="hook_curiosity").confidence == level
    [m] = finalize_mechanisms(decision(mech()), rich_anatomy(), {})
    assert m["certainty"] == "INFERRED"


# ── provenance, determinism, immutability ────────────────────────────────────────────────────

def test_every_mechanism_is_pinned_to_the_anatomy_fingerprint_and_ids():
    a = rich_anatomy()
    [m] = finalize_mechanisms(decision(mech()), a, {"provider": "anthropic", "model": "claude-x", "prompt_version": "v1"})
    p = m["provenance"]
    assert p["anatomy_fingerprint"] == a["provenance"]["fingerprint"]
    assert p["reference_video_id"] == a["provenance"]["reference_video_id"] and p["video_analysis_id"] == a["provenance"]["video_analysis_id"]
    assert p["anatomy_version"] == a["provenance"]["anatomy_version"] and p["taxonomy_version"] == "v1"
    assert (p["provider"], p["model"], p["prompt_version"]) == ("anthropic", "claude-x", "v1")
    assert build_reasoner_input(a)["anatomy_pin"]["anatomy_fingerprint"] == a["provenance"]["fingerprint"]


def test_contract_handling_is_deterministic_and_never_mutates_the_anatomy():
    a = rich_anatomy()
    before = copy.deepcopy(a)
    d = decision(mech(), reveal(), rhythm())
    validate_decision(d, a)
    first = finalize_mechanisms(d, a, {"provider": "p"})
    assert finalize_mechanisms(d, a, {"provider": "p"}) == first
    assert build_reasoner_input(a) == build_reasoner_input(a)
    assert a == before, "C3 must treat the anatomy as read-only"
    assert derive_overall_limitations(a, d) == derive_overall_limitations(a, d)


def test_the_reasoner_input_exposes_exactly_what_may_be_cited():
    a = rich_anatomy()
    ri = build_reasoner_input(a)
    assert ri["valid_section_numbers"] == valid_section_numbers(a) == [1, 2, 3]
    assert ri["valid_evidence_ids"] == {k: v for k, v in valid_evidence_ids(a).items() if v}
    assert ri["valid_evidence_ids"]["speech_segments"] == [1, 2] and ri["valid_evidence_ids"]["text_elements"] == [21]
    assert [g["field"] for g in ri["gaps"]] == [g["field"] for g in a["gaps"]]
    assert "raw_frames" not in json.dumps(ri)  # nothing beyond the anatomy


# ── compact provider input (live-response correction) ────────────────────────────────────────

def rich_with_devices_and_noise():
    """A richer anatomy: an accepted device, a rejected candidate with a reasoning excerpt, and a recurring caption."""
    from tests.test_content_anatomy_svc import examined
    a = rich_anatomy(accepted=[device(60, 1.0, 2.0, dtype="text_reveal")],
                     examined=[examined(500, 1.0, 1.0, False, reasoning="routine caption progression"), examined(501, 12.0, 12.0, False)])
    a["sections"][0]["on_screen_text"][0]["recurring_element_id"] = 9
    return a


def test_the_compact_provider_input_keeps_every_citable_id_fact_and_gap():
    a = rich_with_devices_and_noise()
    before = copy.deepcopy(a)
    ri = build_reasoner_input(a)
    assert a == before, "the canonical anatomy must stay unchanged"
    assert [s["n"] for s in ri["sections"]] == [s["number"] for s in a["sections"]]
    for full, comp in zip(a["sections"], ri["sections"]):
        # evidence ids: every non-empty category preserved exactly
        assert comp["evidence_ids"] == {k: v for k, v in full["evidence_ids"].items() if v}
        # facts preserved
        assert [x["id"] for x in comp.get("speech", [])] == [x["id"] for x in full["speech"]]
        assert [x["text"] for x in comp.get("speech", [])] == [x["text"] for x in full["speech"]]
        assert [(x["id"], x["text"]) for x in comp.get("on_screen_text", [])] == [(x["id"], x["text"]) for x in full["on_screen_text"]]
        assert comp["pacing"]["cuts"] == full["pacing"]["cut_count"] and comp["pacing"]["shots"] == full["pacing"]["shot_count"]
        assert bool(comp.get("hook")) == full["overlaps_hook_window"] and bool(comp.get("opening")) == full["is_opening"]
        assert comp.get("transcript") == full.get("transcript_excerpt")
        assert [d["id"] for d in comp.get("accepted_retention_devices", [])] == [d["id"] for d in full["retention_devices"]]
        assert [r["attempt"] for r in comp.get("rejected_retention_candidates", [])] == [r["attempt_id"] for r in full["rejected_candidates"]]
        # the exact feature vocabulary the validator checks is handed to the model
        assert comp["usable_features"] == sorted(section_features(full))
    assert ri["video"]["usable_features"] == sorted(video_features(a))
    assert ri["anatomy_pin"] == {"reference_video_id": a["provenance"]["reference_video_id"], "video_analysis_id": a["provenance"]["video_analysis_id"],
                                 "anatomy_fingerprint": a["provenance"]["fingerprint"], "anatomy_version": a["provenance"]["anatomy_version"]}
    assert [(g["field"], g["kind"], g["reason"]) for g in ri["gaps"]] == [(g["field"], g["kind"], g["reason"]) for g in a["gaps"]]
    assert ri["video"]["hook"]["window"] == a["video"]["hook"]["window"] and ri["video"]["retention"]["accepted_count"] == 1
    assert ri["video"]["retention"]["analysis_status"] == a["video"]["retention"]["analysis_status"]
    assert ri["video"]["pacing_profile"] == a["video"]["pacing_profile"]


def test_the_compact_view_flags_recurring_text_and_rejected_candidates_remain_references_only():
    ri = build_reasoner_input(rich_with_devices_and_noise())
    assert ri["sections"][0]["on_screen_text"][0]["recurring"] == 9
    rejected = ri["sections"][0]["rejected_retention_candidates"]
    assert rejected and all(set(r) == {"attempt", "type", "status"} for r in rejected)
    assert "routine caption progression" not in serialize_reasoner_input(ri), "the per-candidate reasoning excerpt is dropped"


def test_the_compact_view_drops_only_redundant_fields():
    ri = build_reasoner_input(rich_anatomy())
    sections_text = json.dumps(ri["sections"])
    for dropped in ("shot_refs", "story_beat_refs", "scene_refs", "source_ref", "keyframe_ids", "pacing_phase_ids",
                    "cuts_per_minute", "certainty", "transcript_truncated", "source_partition", "duration"):
        assert dropped not in sections_text, dropped
    assert "progression" not in ri["video"], "the video-level progression list is exactly the ordered sections"
    section = ri["sections"][2]  # a bare section: no speech/text/objects/silence -> those keys are absent, not empty
    assert not {"speech", "on_screen_text", "objects", "silences", "accepted_retention_devices", "interpretive"} & set(section)


def test_the_provider_input_is_compact_json_and_much_smaller_than_the_previous_indented_form():
    a = rich_with_devices_and_noise()
    ri = build_reasoner_input(a)
    compact = serialize_reasoner_input(ri)
    assert "\n" not in compact and '": ' not in compact and '", "' not in compact
    assert json.loads(compact) == json.loads(json.dumps(ri, default=str))
    previous = json.dumps({"anatomy_pin": ri["anatomy_pin"], "video": a["video"], "section_source": "story_beats", "sections": a["sections"],
                           "gaps": a["gaps"], "evidence_coverage": a["evidence_coverage"], "valid_section_numbers": [1, 2, 3],
                           "valid_evidence_ids": valid_evidence_ids(a), "valid_feature_keys": []}, ensure_ascii=False, indent=1, default=str)
    assert len(compact) < 0.6 * len(previous), (len(compact), len(previous))
    assert build_reasoner_input(a) == build_reasoner_input(a) and serialize_reasoner_input(ri) == serialize_reasoner_input(ri)


def test_the_user_prompt_carries_the_compact_anatomy_and_never_the_canonical_pretty_form():
    a = rich_anatomy()
    prompt = build_user_prompt(build_reasoner_input(a))
    assert prompt.startswith("Content Anatomy (compact JSON):\n") and "\n  " not in prompt
    assert OPENING_LINE in prompt and a["provenance"]["fingerprint"] in prompt


# ── parsing / malformed provider responses ───────────────────────────────────────────────────

def _payload_mech(**over):
    base = {
        "mechanism_type": "hook_curiosity",
        "statement": "The opening appears designed to pose an unresolved question before any explanation is given.",
        "scope": "sections", "section_numbers": [1], "supporting_evidence_ids": {"speech_segments": [1]},
        "anatomy_features_used": ["speech", "hook_window"],
        "transferable_principle": "Open with an unresolved question, then hold the explanation back.",
        "non_transferable_elements": [{"kind": "wording", "description": "The exact question asked"}],
        "confidence": "medium", "limitations": [],
    }
    base.update(over)
    return base


def test_json_is_extracted_from_prose_or_fences_and_non_json_is_rejected():
    assert parse_json_object('```json\n{"mechanisms": []}\n```') == {"mechanisms": []}
    assert parse_json_object('Here you go: {"mechanisms": []} thanks') == {"mechanisms": []}
    for bad in ("no json here", "{broken", "[1, 2]", ""):
        with pytest.raises(MechanismReasoningError):
            parse_json_object(bad)


@pytest.mark.parametrize("payload, match", [
    ({}, "must contain a `mechanisms` list"),
    ({"mechanisms": "nope"}, "must contain a `mechanisms` list"),
    ({"mechanisms": [], "extra": 1}, "unexpected top-level"),
    ({"mechanisms": [], "overall_limitations": "x"}, "overall_limitations"),
    ({"mechanisms": ["x"]}, r"mechanisms\[1\] must be an object"),
    ({"mechanisms": [{"statement": "x"}]}, "missing required field"),
    ({"mechanisms": [{**_payload_mech(), "surprise": 1}]}, "unexpected field"),
    ({"mechanisms": [{**_payload_mech(), "non_transferable_elements": ["x"]}]}, "non_transferable_elements must be a list"),
    ({"mechanisms": [{**_payload_mech(), "non_transferable_elements": []}]}, "failed contract validation"),
    ({"mechanisms": [{**_payload_mech(), "confidence": "certain"}]}, "failed contract validation"),
    ({"mechanisms": [{**_payload_mech(), "supporting_evidence_ids": {"speech_segments": ["1"]}}]}, "failed contract validation"),
    ({"mechanisms": [{**_payload_mech(), "certainty": "MEASURED"}]}, "failed contract validation"),
])
def test_malformed_provider_payloads_raise_instead_of_producing_a_decision(payload, match):
    with pytest.raises(MechanismReasoningError, match=match):
        decision_from_payload(payload)


def test_an_empty_mechanisms_payload_is_a_valid_decision():
    d = decision_from_payload({"mechanisms": []}, reasoning_contract_version="v1")
    assert d.mechanisms == [] and d.overall_limitations == []


# ── provider (Anthropic adapter, client always mocked) ───────────────────────────────────────

def _message(blocks, stop_reason="end_turn", input_tokens=11000, output_tokens=900):
    return SimpleNamespace(content=blocks, stop_reason=stop_reason, usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens))


def _text(t):
    return SimpleNamespace(type="text", text=t)


def _client_returning(text_out: str, **kw):
    client = MagicMock()
    client.messages.create = AsyncMock(return_value=_message([_text(text_out)], **kw))
    return client


def _client_with(message):
    client = MagicMock()
    client.messages.create = AsyncMock(return_value=message)
    return client


async def test_the_anthropic_adapter_sends_only_the_anatomy_view_and_parses_the_response(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    a = rich_anatomy()
    client = _client_returning(json.dumps({"mechanisms": [_payload_mech()], "overall_limitations": ["x"]}))
    with patch.object(anthropic_provider, "get_client", return_value=client):
        d = await AnthropicMechanismReasoner().derive_mechanisms(build_reasoner_input(a), model="test-model")
    assert client.messages.create.await_count == 1
    kwargs = client.messages.create.await_args.kwargs
    assert kwargs["model"] == "test-model" and kwargs["system"] == SYSTEM_PROMPT
    prompt = kwargs["messages"][0]["content"]
    assert a["provenance"]["fingerprint"] in prompt and OPENING_LINE in prompt and "valid_evidence_ids" in prompt
    assert d.reasoning_contract_version == MECHANISM_PROMPT_VERSION and len(d.mechanisms) == 1
    assert d.mechanisms[0].mechanism_type == "hook_curiosity"


async def test_the_anthropic_adapter_raises_on_a_garbage_response_and_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    with patch.object(anthropic_provider, "get_client", return_value=_client_returning("I could not do that.")):
        with pytest.raises(MechanismReasoningError, match="not valid JSON"):
            await AnthropicMechanismReasoner().derive_mechanisms({}, model="m")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    with pytest.raises(MechanismReasoningError, match="ANTHROPIC_API_KEY"):
        await AnthropicMechanismReasoner().derive_mechanisms({}, model="m")


def test_the_system_prompt_states_the_non_negotiables():
    for phrase in ("NULL MEANS UNKNOWN", "TRANSFERABLE PRINCIPLE", "NON-TRANSFERABLE", "\"mechanisms\": []", "INFERRED", "No effectiveness scores"):
        assert phrase in SYSTEM_PROMPT
    for t in ("hook_curiosity", "cta_next_step", "audio_attention"):
        assert t in SYSTEM_PROMPT
    assert MECHANISM_PROMPT_VERSION == "v2"


# ── router: provider disabled / provider-independent validation ──────────────────────────────

async def test_with_no_provider_configured_nothing_is_called_and_a_descriptive_error_is_raised(monkeypatch):
    monkeypatch.setattr(settings, "MECHANISM_REASONER_PROVIDER", "")
    spy = AsyncMock()
    with patch.object(mech_router._REASONER_PROVIDERS["anthropic"], "derive_mechanisms", spy):
        with pytest.raises(MechanismReasoningError, match="MECHANISM_REASONER_PROVIDER is empty"):
            await derive_mechanisms(rich_anatomy())
    spy.assert_not_awaited()


async def test_an_unknown_or_unconfigured_provider_is_refused(monkeypatch):
    monkeypatch.setattr(settings, "MECHANISM_REASONER_PROVIDER", "nonesuch")
    with pytest.raises(MechanismReasoningError, match="not a recognized"):
        await derive_mechanisms(rich_anatomy())
    monkeypatch.setattr(settings, "MECHANISM_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    with pytest.raises(MechanismReasoningError, match="not configured"):
        await derive_mechanisms(rich_anatomy())


async def test_the_default_setting_is_off():
    from app.config import Settings
    assert Settings.model_fields["MECHANISM_REASONER_PROVIDER"].default == ""


async def test_zero_sections_is_refused_before_the_provider_is_even_consulted(monkeypatch):
    monkeypatch.setattr(settings, "MECHANISM_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "k")
    spy = AsyncMock()
    with patch.object(mech_router._REASONER_PROVIDERS["anthropic"], "derive_mechanisms", spy):
        with pytest.raises(MechanismInputError, match="zero sections"):
            await derive_mechanisms(rich_anatomy(shots=[], beats=None))
    spy.assert_not_awaited()


async def test_the_router_applies_validation_to_any_provider_so_a_bad_response_cannot_slip_through(monkeypatch):
    monkeypatch.setattr(settings, "MECHANISM_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "k")
    a = rich_anatomy()
    provider = mech_router._REASONER_PROVIDERS["anthropic"]
    with patch.object(provider, "derive_mechanisms", AsyncMock(return_value=decision(mech(supporting_evidence_ids={"speech_segments": [4242]})))):
        with pytest.raises(MechanismReasoningError, match="invented provenance"):
            await derive_mechanisms(a)
    with patch.object(provider, "derive_mechanisms", AsyncMock(return_value=decision(mech(statement="This appears designed to be viral.")))):
        with pytest.raises(MechanismReasoningError, match="prohibited"):
            await derive_mechanisms(a)
    with patch.object(provider, "derive_mechanisms", AsyncMock(return_value=decision(mech(), reveal()))):
        result = await derive_mechanisms(a)
    assert result.provider == "anthropic" and len(result.decision.mechanisms) == 2
    assert result.model == settings.MECHANISM_REASONER_MODEL


# ── live-response handling (first real call: max_tokens, no text) ────────────────────────────

async def _derive_with(monkeypatch, message):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    client = _client_with(message)
    with patch.object(anthropic_provider, "get_client", return_value=client):
        return await AnthropicMechanismReasoner().derive_mechanisms(build_reasoner_input(rich_anatomy()), model="test-model"), client


async def test_the_request_uses_the_documented_output_budget_low_effort_and_no_unsupported_parameters(monkeypatch):
    decision_out, client = await _derive_with(monkeypatch, _message([_text(json.dumps({"mechanisms": []}))]))
    kwargs = client.messages.create.await_args.kwargs
    assert kwargs["max_tokens"] == MAX_RESPONSE_TOKENS == 10000
    assert kwargs["output_config"] == {"effort": MECHANISM_EFFORT} and MECHANISM_EFFORT == "low"
    assert "thinking" not in kwargs, "no undocumented thinking parameter is sent"
    assert set(kwargs) == {"model", "max_tokens", "system", "output_config", "messages"}
    assert decision_out.mechanisms == []


def test_output_budget_covers_the_largest_valid_response():
    """12 maximally verbose mechanisms must fit with headroom and parse as a valid decision. Measured with the real
    tokenizer (count_tokens, claude-sonnet-5) on this same shape of text: 6,631 tokens for 20,564 chars (3.1 chars per
    token), i.e. ~6.6k of the 10,000 budget; here a 3.0 chars/token bound is used so the test needs no API."""
    sentence = ("The opening arrangement places a spoken question beside a caption that restates a later idea so the audience meets an "
                "unresolved tension before any explanation arrives and the following part delays its resolution through a change of framing ").split()
    words = lambda n: " ".join((sentence * (n // len(sentence) + 1))[:n])
    one = {"mechanism_type": "information_reveal", "other_label": None, "other_rationale": None, "statement": "Places " + words(45),
           "scope": "sections", "section_numbers": [1, 2, 3, 4],
           "supporting_evidence_ids": {"speech_segments": [700, 701, 702, 703], "text_elements": [1250, 1251, 1252, 1253], "shots": [3900, 3901]},
           "anatomy_features_used": ["speech", "on_screen_text", "transcript", "pacing"], "transferable_principle": words(35),
           "non_transferable_elements": [{"kind": "wording", "description": words(20)}] * 3, "confidence": "medium", "limitations": [words(20)] * 2}
    payload = {"mechanisms": [dict(one, mechanism_type="progression") if i % 2 else one for i in range(12)], "overall_limitations": [words(20)] * 4}
    text = json.dumps(payload, separators=(",", ":"))
    assert len(text) / 3.0 < MAX_RESPONSE_TOKENS * 0.85, "the largest valid response must fit with >=15% headroom"
    assert len(decision_from_payload(payload).mechanisms) == 12 == MAX_MECHANISMS


async def test_a_response_truncated_at_max_tokens_is_rejected_with_diagnostics_even_if_text_is_present(monkeypatch):
    valid_looking = json.dumps({"mechanisms": []})
    with pytest.raises(MechanismReasoningError, match="truncated at max_tokens") as e:
        await _derive_with(monkeypatch, _message([_text(valid_looking)], stop_reason="max_tokens", output_tokens=10000))
    d = e.value.diagnostics
    assert d["stop_reason"] == "max_tokens" and d["output_tokens"] == 10000 and d["input_tokens"] == 11000
    assert d["block_types"] == ["text"] and d["has_text_block"] is True and d["text_chars"] == len(valid_looking)


async def test_the_first_real_calls_failure_shape_no_text_block_at_max_tokens_is_diagnosed(monkeypatch):
    """Exactly what the first real call looked like: 4,096 output tokens, stop_reason max_tokens, no text block."""
    thinking = SimpleNamespace(type="thinking", thinking="...", signature="s")
    with pytest.raises(MechanismReasoningError, match="truncated") as e:
        await _derive_with(monkeypatch, _message([thinking], stop_reason="max_tokens", input_tokens=28062, output_tokens=4096))
    d = e.value.diagnostics
    assert d["block_types"] == ["thinking"] and d["has_text_block"] is False and d["text_chars"] == 0
    assert (d["input_tokens"], d["output_tokens"]) == (28062, 4096)


@pytest.mark.parametrize("blocks", [[], [SimpleNamespace(type="thinking", thinking="x", signature="s")],
                                    [SimpleNamespace(type="redacted_thinking", data="x")], [_text("")], [_text("   \n ")]])
async def test_an_empty_or_non_text_response_raises_a_clear_error_instead_of_mechanisms(monkeypatch, blocks):
    with pytest.raises(MechanismReasoningError, match="contained no text") as e:
        await _derive_with(monkeypatch, _message(blocks))
    assert e.value.diagnostics["has_text_block"] in (True, False) and e.value.diagnostics["text_chars"] <= 5
    assert "block types" in str(e.value)


async def test_an_abnormal_stop_reason_is_rejected(monkeypatch):
    with pytest.raises(MechanismReasoningError, match="unexpected stop_reason 'refusal'"):
        await _derive_with(monkeypatch, _message([_text('{"mechanisms": []}')], stop_reason="refusal"))


async def test_malformed_json_from_a_complete_response_is_rejected_with_metadata_and_a_bounded_excerpt(monkeypatch):
    with pytest.raises(MechanismReasoningError, match="not valid JSON") as e:
        await _derive_with(monkeypatch, _message([_text("Sure! " + "blah " * 200)]))
    assert e.value.diagnostics["stop_reason"] == "end_turn" and len(str(e.value)) < 1500
    with pytest.raises(MechanismReasoningError):
        await _derive_with(monkeypatch, _message([_text('{"mechanisms": [{"mechanism_type": "hook_curiosity"}]}')]))


async def test_a_normal_valid_response_yields_a_decision_and_multiple_text_blocks_are_joined(monkeypatch):
    payload = json.dumps({"mechanisms": [_payload_mech()], "overall_limitations": []})
    half = len(payload) // 2
    out, _ = await _derive_with(monkeypatch, _message([SimpleNamespace(type="thinking", thinking="t", signature="s"), _text(payload[:half]), _text(payload[half:])]))
    assert len(out.mechanisms) == 1 and out.reasoning_contract_version == "v2"


def test_diagnostics_are_metadata_only_no_payload_no_secrets(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key-SECRET")
    msg = _message([_text("private transcript words " * 5)], stop_reason="max_tokens")
    d = response_diagnostics(msg)
    assert set(d) == {"stop_reason", "block_types", "has_text_block", "text_chars", "input_tokens", "output_tokens", "max_tokens"}
    assert "SECRET" not in json.dumps(d) and "private transcript" not in json.dumps(d)
    with pytest.raises(MechanismReasoningError) as e:
        extract_text_or_raise(msg)
    assert "SECRET" not in str(e.value) and "private transcript" not in str(e.value)


# ── validation and guards still apply to real-provider output (provider -> router -> validation, client mocked) ──

async def _router_with_client(monkeypatch, text_out, a=None):
    monkeypatch.setattr(settings, "MECHANISM_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    client = _client_returning(text_out)
    with patch.object(anthropic_provider, "get_client", return_value=client):
        return await derive_mechanisms(a or rich_anatomy()), client


async def test_a_valid_provider_response_flows_through_the_real_router_validation(monkeypatch):
    res, client = await _router_with_client(monkeypatch, json.dumps({"mechanisms": [_payload_mech()], "overall_limitations": []}))
    assert client.messages.create.await_count == 1 and len(res.decision.mechanisms) == 1 and res.reasoning_contract_version == "v2"


@pytest.mark.parametrize("override, match", [
    ({"supporting_evidence_ids": {"speech_segments": [4242]}}, "invented provenance"),
    ({"statement": "The opening appears designed to be effective and drive engagement."}, "prohibited"),
    ({"statement": "The opening appears designed to guarantee curiosity; it led to more views."}, "prohibited"),
    ({"transferable_principle": "Ask have you ever wondered why your videos before explaining."}, "reproduces"),
    ({"anatomy_features_used": ["accepted_retention_device"]}, "not present"),
    ({"non_transferable_elements": []}, "failed contract validation"),
])
async def test_validation_and_guards_are_not_weakened_for_real_provider_output(monkeypatch, override, match):
    with pytest.raises(MechanismReasoningError, match=match):
        await _router_with_client(monkeypatch, json.dumps({"mechanisms": [_payload_mech(**override)], "overall_limitations": []}))


async def test_provider_disabled_makes_zero_client_calls(monkeypatch):
    monkeypatch.setattr(settings, "MECHANISM_REASONER_PROVIDER", "")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    get_client_spy = MagicMock()
    with patch.object(anthropic_provider, "get_client", get_client_spy):
        with pytest.raises(MechanismReasoningError, match="MECHANISM_REASONER_PROVIDER is empty"):
            await derive_mechanisms(rich_anatomy())
    get_client_spy.assert_not_called()
