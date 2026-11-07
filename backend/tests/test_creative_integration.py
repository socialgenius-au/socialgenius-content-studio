"""Creative Read -> Content Anatomy -> Mechanisms. Pure tests on a reference shaped like 5131 (4 shots; garbled mixed-script speech with no confidence; a legible product name next to high-confidence pseudo-text;
a detector that says "bottle / dining table / donut" where the AI that looked at the frames says "jar / pan"). No database, no AI call."""
import copy
import json

import pytest

from app.schemas.content_anatomy import ContentAnatomyResponse
from app.services.content_anatomy_svc import build_content_anatomy
from app.services.creative_reader.evidence import select_frames
from app.services.creative_reconcile import AUTHORITY_ORDER, scripts_in, speech_reliability
from app.services.mechanism_reasoner.anatomy_input import build_reasoner_input, source_texts, valid_evidence_ids, section_features, video_features, serialize_reasoner_input
from app.services.mechanism_reasoner.contract import MechanismDecision, MechanismReasoningError, NonTransferableElement, Mechanism
from app.services.mechanism_reasoner.providers.anthropic_provider import SYSTEM_PROMPT, MECHANISM_PROMPT_VERSION
from app.services.mechanism_reasoner.validation import validate_decision
from tests.test_content_anatomy_svc import aggregate, shot, speech, text


def obj(i, label, t=0.0):
    return {"id": i, "label": label, "category": "coco", "start_time": t, "end_time": t}


def ref_5131(hook_elements=True):
    shots = [
        shot(3914, 0, 0.0, 2.0, texts=[text(1435, "BARAKAH", 0.5, 0.5, 0.987), text(1447, "Ginger Garlic", 0.5, 0.5, 0.999), text(1467, "Waites", 0.5, 0.5, 0.9997), text(1469, "Realing", 0.5, 0.5, 0.885),
                                        text(1473, "Sloving", 0.5, 0.5, 0.62)],
                objects=[obj(2616, "bottle"), obj(2617, "dining table"), obj(2618, "person")]),
        shot(3915, 1, 2.0, 3.958333, objects=[obj(2630, "bowl", 2.5), obj(2631, "donut", 2.5), obj(2632, "spoon", 2.5)]),
        shot(3916, 2, 3.958333, 6.0, objects=[obj(2640, "bowl", 4.5), obj(2641, "spoon", 4.5)]),
        shot(3917, 3, 6.0, 10.03, texts=[text(1505, "0", 6.2, 6.2, 0.85)], objects=[obj(2650, "chair", 7.0), obj(2651, "person", 7.0)]),
    ]
    sp = [{**speech(721, 0.0, 4.0, "100% شود, bina-pani, bina-kemi-kul", "ur"), "confidence_score": None}, {**speech(722, 6.0, 10.0, "100% мowne-bana-ya-baraka-se-sa-jaya", "ur"), "confidence_score": None}]
    cls = {"description": "Hook Window [0.0, 2.0]: primary_type=bold_claim", "certainty": "INFERRED", "reasoning": "claims purity",
           "details": {"primary_type": "bold_claim", "secondary_types": ["demonstration"], "probable_intent": "provoke_attention",
                       "hook_elements": [{"element_type": "spoken_purity_claim", "evidence_references": {"supporting_speech_segment_ids": [721]}}] if hook_elements else []}}
    return aggregate(duration=10.03, shots=shots, speeches=sp, hook_window={"start_time": 0.0, "end_time": 2.0, "certainty": "MEASURED", "details": {}}, hook_class=cls)


def creative_5131():
    findings = [
        {"id": 15929, "start_time": 0.0, "end_time": 2.0, "kind": "hook_visual", "confidence": "medium", "statement": "The opening appears designed to establish the product and brand straight away.", "shot_orders": [0],
         "evidence": [{"type": "frame", "id": 1705}, {"type": "text", "id": 1435}, {"type": "text", "id": 1447}, {"type": "shot", "id": 0}], "mechanism_type": "hook_curiosity",
         "transferable_principle": "Open on the product itself, framed cleanly, with a small human action implying it is about to be opened.", "source_specific": "a hand on a gold lid"},
        {"id": 15931, "start_time": 2.0, "end_time": 3.96, "kind": "visual_pattern", "confidence": "medium", "statement": "The spoon close-up appears intended to show texture.", "shot_orders": [1],
         "evidence": [{"type": "frame", "id": 1708}], "mechanism_type": "demonstration", "transferable_principle": "Use a tight, shallow-focus close-up of the material being handled to convey texture.", "source_specific": None},
        {"id": 15933, "start_time": 6.0, "end_time": 10.03, "kind": "emotional_register", "confidence": "medium", "statement": "The final shot appears to bring in a warm, smiling presenter.", "shot_orders": [3],
         "evidence": [{"type": "frame", "id": 1713}, {"type": "speech", "id": 722}], "mechanism_type": "emotional_progression", "transferable_principle": "End a product sequence with a friendly human face.", "source_specific": None},
    ]
    shots = [{"shot_order": 0, "focal_subject": "A green-labelled jar with a hand on the gold lid", "framing": "Vertical medium close-up, jar centred, blurred kitchen shelf", "notes": None},
             {"shot_order": 1, "focal_subject": "A spoonful of textured paste lifted from the open jar", "framing": "Tight close-up, shallow depth", "notes": None},
             {"shot_order": 2, "focal_subject": "Paste going into a steel pan with oil", "framing": "Medium close-up, steam", "notes": None},
             {"shot_order": 3, "focal_subject": "A smiling woman in a green saree", "framing": "Medium shot, centred, facing camera", "notes": None}]
    return {"status": "current", "summary": "The video appears to be a product ad: jar, paste, cooking, then a presenter.", "shots": shots, "findings": findings,
            "limitations": ["The label text is partly garbled (e.g. 'Sloving', 'Realing'), which looks like AI-generation artefacts."],
            "provenance": {"model": "claude-sonnet-5-5", "prompt_version": "cr-v1", "frames_shown": [1705, 1706, 1707, 1708, 1709, 1710, 1711, 1713, 1714]}}


def anatomy(creative=True):
    return build_content_anatomy(ref_5131(), creative_5131() if creative else None)


def sec(a, n):
    return next(s for s in a["sections"] if s["number"] == n)


# ── no creative read: nothing changes ──
def test_without_a_creative_read_the_anatomy_is_exactly_what_it_always_was():
    base = build_content_anatomy(ref_5131())
    assert build_content_anatomy(ref_5131(), None) == base
    assert build_content_anatomy(ref_5131(), {"status": "not_run", "findings": [], "shots": []}) == base
    assert "creative" not in base["video"] and "reconciliation" not in base["video"] and all("creative" not in s for s in base["sections"])
    assert not any(g["field"] == "audience_effects" for g in base["gaps"])
    assert "creative_findings" not in sec(base, 1)["evidence_ids"]
    ri = build_reasoner_input(base)
    assert "creative_read" not in ri and "reconciliation" not in ri and all("creative" not in s for s in ri["sections"])


# ── with it: layered on, pinned, and honest about what is not known ──
def test_the_creative_layer_lands_in_the_right_sections_and_changes_the_pin():
    a, base = anatomy(), anatomy(False)
    assert a["provenance"]["fingerprint"] != base["provenance"]["fingerprint"]                   # mechanisms/blueprints pinned to the old anatomy become stale, as designed
    assert [s["number"] for s in a["sections"]] == [1, 2, 3, 4]
    s1, s2, s3, s4 = (sec(a, n) for n in (1, 2, 3, 4))
    assert [r["shot_order"] for r in s1["creative"]["shot_reads"]] == [0] and [f["id"] for f in s1["creative"]["findings"]] == [15929]
    assert [f["id"] for f in s2["creative"]["findings"]] == [15931] and [f["id"] for f in s4["creative"]["findings"]] == [15933]
    assert "creative" in s3 and s3["creative"]["findings"] == [] and s3["creative"]["shot_reads"][0]["shot_order"] == 2     # a shot read without a finding is still shown
    assert s1["evidence_ids"]["creative_findings"] == [15929] and "creative_read" in s1["features"]
    assert s1["creative"]["basis"] == "ai_vision" and s1["creative"]["certainty"] == "INFERRED"
    assert a["video"]["creative"]["finding_count"] == 3 and a["video"]["creative"]["frames_shown"] == 9
    assert any(g["field"] == "audience_effects" and g["kind"] == "not_measurable" for g in a["gaps"])
    assert sec(a, 1)["certainty"] == "MEASURED"                                                     # the measured partition is untouched


def test_the_api_response_model_keeps_the_creative_layer():
    out = ContentAnatomyResponse.model_validate(anatomy()).model_dump()
    assert out["video"]["reconciliation"]["items"] and out["sections"][0]["creative"]["findings"][0]["id"] == 15929
    assert ContentAnatomyResponse.model_validate(anatomy(False)).model_dump()["video"]["creative"] is None


# ── reconciliation: unequal readings are not presented as equal ──
def test_detector_labels_are_trusted_only_as_far_as_the_frames_corroborate_them():
    items = anatomy()["video"]["reconciliation"]["items"]
    ident = {(i["sections"][0]): i for i in items if i["topic"] == "object identity"}
    assert ident[1]["status"] == "established"                       # bottle ~ jar, dining table ~ kitchen/shelf, person ~ hand
    assert ident[2]["status"] == "partly_corroborated" and "not bowl" in ident[2]["note"]         # the detector called a jar a bowl; donut ~ paste and spoon are corroborated
    assert ident[3]["status"] == "partly_corroborated" and ident[4]["status"] == "partly_corroborated"
    for i in ident.values():
        assert i["authority"] == "ai_vision"
        if i["status"] != "established":
            assert "low authority" in i["note"]


def test_a_real_conflict_is_flagged():
    c = creative_5131()
    c["shots"][3]["focal_subject"] = "A steel pan on a hob"
    c["shots"][3]["framing"] = "Overhead"
    items = build_content_anatomy(ref_5131(), c)["video"]["reconciliation"]["items"]
    disputed = [i for i in items if i["status"] == "disputed"]
    assert len(disputed) == 1 and "chair" in disputed[0]["note"] and "person" in disputed[0]["note"]
    assert disputed[0]["sections"] == [4] and disputed[0]["authority"] == "ai_vision"


def test_speech_without_confidence_or_with_mixed_scripts_is_unverified_everywhere_it_matters():
    rec = anatomy()["video"]["reconciliation"]
    assert rec["unverified_speech_ids"] == [721, 722]
    assert any("mixes" in r for r in rec["evidence_quality"]["speech"]["reasons"]) and any("no recognition confidence" in r for r in rec["evidence_quality"]["speech"]["reasons"])
    spoken = [i for i in rec["items"] if i["topic"] == "spoken wording"]
    assert spoken and all(i["status"] == "unverified" and "Do not quote it" in i["note"] for i in spoken)
    assert speech_reliability({"id": 1, "text": "clear english words", "confidence_score": 0.92})["reliable"] is True
    assert speech_reliability({"id": 1, "text": "clear english words", "confidence_score": 0.3})["reliable"] is False
    assert scripts_in("100% شود bina") == {"arabic", "latin"}


def test_ocr_confidence_alone_cannot_tell_real_text_from_generated_pseudo_text():
    rec = anatomy()["video"]["reconciliation"]
    q = rec["evidence_quality"]["ocr"]
    assert q["legible_ids"] == [1435, 1447]                                                       # only text the visual reading itself cites is treated as legible
    assert 1467 in rec["low_confidence_text_ids"] and 1469 in rec["low_confidence_text_ids"]      # 'Waites' at 0.9997 confidence is still uncorroborated pseudo-text
    assert 1473 in q["low_confidence_ids"]                                                         # and a genuinely low-confidence item says why
    clean = creative_5131()
    clean["limitations"] = []                                                                      # if the visual reading found nothing wrong, high-confidence OCR is not second-guessed
    assert build_content_anatomy(ref_5131(), clean)["video"]["reconciliation"]["low_confidence_text_ids"] == [1473]


def test_the_text_only_hook_label_is_shown_as_two_views_when_it_rests_on_unverified_speech():
    items = anatomy()["video"]["reconciliation"]["items"]
    hook = [i for i in items if i["topic"] == "opening hook"]
    assert hook and hook[0]["status"] == "two_views" and "unverified" in hook[0]["note"] and "establish the product" in hook[0]["note"]
    assert not [i for i in build_content_anatomy(ref_5131(hook_elements=False), creative_5131())["video"]["reconciliation"]["items"] if i["topic"] == "opening hook"]


def test_authority_order_and_audience_effects_are_stated():
    rec = anatomy()["video"]["reconciliation"]
    assert rec["authority_order"] == AUTHORITY_ORDER and AUTHORITY_ORDER[0].startswith("measured") and "unverified" in AUTHORITY_ORDER[-1]
    assert "no viewer data" in rec["audience_effects"]


# ── what the mechanism reasoner is given ──
def test_the_mechanism_input_carries_the_visual_reading_the_reconciliation_and_citable_ids():
    a = anatomy()
    ri = build_reasoner_input(a)
    s1 = ri["sections"][0]
    assert s1["creative"]["findings"][0]["id"] == 15929 and s1["creative"]["shots"][0]["shot_order"] == 0 and "creative_read" in s1["usable_features"]
    assert s1["evidence_ids"]["creative_findings"] == [15929] and ri["valid_evidence_ids"]["creative_findings"] == [15929, 15931, 15933]
    assert ri["creative_read"]["frames_shown"] == 9 and ri["reconciliation"]["unverified_speech_ids"] == [721, 722] and ri["reconciliation"]["items"]
    assert "creative_read" in section_features(sec(a, 1)) and "creative_read" in video_features(a) | {"creative_read"}
    blob = serialize_reasoner_input(ri)
    assert "uploads/" not in blob and ".jpg" not in blob
    assert any("jar" in t.lower() for t in source_texts(a))                                       # the verbatim guard also covers what the AI said it saw


def test_the_prompt_is_versioned_and_tells_the_model_to_follow_the_reconciliation():
    assert MECHANISM_PROMPT_VERSION == "v3"
    for needle in ("creative_findings", "reconciliation", "unverified_speech_ids", "cannot support a `high` confidence", "audience_effects", "principle_hint", "never to copy"):
        assert needle in SYSTEM_PROMPT, needle


# ── what is enforced about the answer ──
def mk(**over):
    base = dict(mechanism_type="demonstration", statement="The second section appears designed to show the material being handled up close.", scope="sections", section_numbers=[2],
                supporting_evidence_ids={"creative_findings": [15931]}, anatomy_features_used=["creative_read"],
                transferable_principle="Show the material being handled in a tight, shallow-focus view so its consistency is visible before it is used.",
                non_transferable_elements=[NonTransferableElement("subject_matter", "The specific food product shown")], confidence="medium", limitations=["Inferred from a few frames only."])
    base.update(over)
    return Mechanism(**base)


def decide(*ms):
    return MechanismDecision(mechanisms=list(ms), overall_limitations=["No viewer data exists."], reasoning_contract_version=MECHANISM_PROMPT_VERSION)


def test_a_mechanism_may_rest_on_a_visual_finding_alone():
    validate_decision(decide(mk()), anatomy())
    validate_decision(decide(mk(mechanism_type="visual_attention", statement="The shot sequence appears designed to move the eye from the whole object to its texture.", scope="video", section_numbers=[1, 2],
                                supporting_evidence_ids={"creative_findings": [15929, 15931]}, anatomy_features_used=["creative_read"])), anatomy())


def test_a_visual_citation_must_be_real_and_present_in_the_cited_section():
    with pytest.raises(MechanismReasoningError, match="creative_findings"):
        validate_decision(decide(mk(supporting_evidence_ids={"creative_findings": [99999]})), anatomy())
    with pytest.raises(MechanismReasoningError, match="creative_findings"):
        validate_decision(decide(mk(section_numbers=[1])), anatomy())                              # finding 15931 belongs to section 2
    with pytest.raises(MechanismReasoningError):
        validate_decision(decide(mk()), anatomy(False))                                            # no creative layer -> nothing visual can be cited


def test_unverified_speech_cannot_support_a_confident_mechanism():
    a = anatomy()
    speechy = dict(mechanism_type="audio_attention", statement="The opening speech appears designed to carry a short claim over the product shot.", scope="sections", section_numbers=[1],
                   supporting_evidence_ids={"speech_segments": [721]}, anatomy_features_used=["speech"], transferable_principle="Pair a short spoken claim with a close view of the subject so both arrive together.",
                   non_transferable_elements=[NonTransferableElement("wording", "The specific claim that is made")], limitations=["The transcript is unverified."])
    with pytest.raises(MechanismReasoningError, match="cannot be 'high'"):
        validate_decision(decide(mk(**{**speechy, "confidence": "high"})), a)
    with pytest.raises(MechanismReasoningError, match="must be 'low'"):
        validate_decision(decide(mk(**{**speechy, "confidence": "medium"})), a)
    validate_decision(decide(mk(**{**speechy, "confidence": "low"})), a)
    validate_decision(decide(mk(**{**speechy, "confidence": "medium", "supporting_evidence_ids": {"speech_segments": [721], "creative_findings": [15929]}, "anatomy_features_used": ["speech", "creative_read"]})), a)
    with pytest.raises(MechanismReasoningError, match="cannot be 'high'"):
        validate_decision(decide(mk(**{**speechy, "confidence": "high", "supporting_evidence_ids": {"speech_segments": [721], "creative_findings": [15929]}, "anatomy_features_used": ["speech", "creative_read"]})), a)


def test_a_principle_may_not_repeat_what_the_ai_said_it_saw():
    with pytest.raises(MechanismReasoningError, match="reproduces"):
        validate_decision(decide(mk(transferable_principle="Lift a spoonful of textured paste lifted from the open jar into a close view.")), anatomy())


def test_emotional_mechanisms_from_a_visual_read_stay_capped_below_high():
    with pytest.raises(MechanismReasoningError, match="cannot be 'high'"):
        validate_decision(decide(mk(mechanism_type="emotional_progression", statement="The final section appears to add a warmer human tone after the product shots.", section_numbers=[4],
                                    supporting_evidence_ids={"creative_findings": [15933]}, confidence="high")), anatomy())
    validate_decision(decide(mk(mechanism_type="emotional_progression", statement="The final section appears to add a warmer human tone after the product shots.", section_numbers=[4],
                                supporting_evidence_ids={"creative_findings": [15933]}, confidence="medium")), anatomy())


# ── keyframe selection ──
def test_all_available_frames_are_used_up_to_the_limit():
    frames = [{"id": 1700 + i, "shot_order": o, "timestamp": float(i)} for i, o in enumerate([0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3])]       # 5131: 11 frames over 4 shots
    sel = select_frames(frames, 12)
    assert len(sel) == 11 and {f["shot_order"] for f in sel} == {0, 1, 2, 3}                                                           # was 9: now every frame fits
    assert len(select_frames(frames, 9)) == 9 and len(select_frames(frames, 4)) == 4 and {f["shot_order"] for f in select_frames(frames, 4)} == {0, 1, 2, 3}
