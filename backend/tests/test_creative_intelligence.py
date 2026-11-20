"""Deconstructor creative intelligence: (1) hook / storytelling / mechanism identification, (2) scene and story-beat structure, (3) the reusable intelligence record and its flow Reference -> Anatomy -> Mechanisms ->
New Content -> Blueprint. Reference 5131's real shapes (its aggregate, Creative Read, reconciliation, hook elements, boundary attempts and mechanisms) are the fixtures. No AI call is made anywhere in this file."""
import copy
import json

import pytest

from app.services import mechanism_guidance as mg
from app.services.blueprint_reasoner import BlueprintReasoningError, build_context, finalize_blueprint, normalize_intent, validate_decision
from app.services.blueprint_reasoner.parsing import decision_from_payload
from app.services.blueprint_reasoner.provider_input import build_reasoner_input as blueprint_input
from app.services.blueprint_reasoner.providers.anthropic_provider import BLUEPRINT_PROMPT_VERSION, SYSTEM_PROMPT as BLUEPRINT_PROMPT
from app.services.content_anatomy_svc import build_content_anatomy
from app.services.creative_intelligence import blueprint_guidance, build_creative_intelligence, mechanism_entry
from app.services.hook_profile import hook_structure_for_blueprint, narrative_progression
from app.services.mechanism_reasoner.anatomy_input import build_reasoner_input as mechanism_input
from app.services.mechanism_reasoner.providers.anthropic_provider import SYSTEM_PROMPT as MECHANISM_PROMPT
from app.services.structure_integrity import analyze_structure
from tests.test_creative_integration import creative_5131, ref_5131

ELEMENTS = [
    {"element_type": "spoken_purity_claim", "evidence_references": {"supporting_speech_segment_ids": [721]}},
    {"element_type": "on_screen_product_labeling", "evidence_references": {"supporting_text_element_ids": [1435, 1447, 1467]}},
    {"element_type": "visual_product_subject", "evidence_references": {"supporting_visual_object_ids": [2616, 2617], "supporting_scene_ids": [900]}},
    {"element_type": "single_uninterrupted_opening_shot", "evidence_references": {"supporting_shot_ids": [3914]}},
]
# What the boundary reasoning actually produced for 5131: 7 candidates, none accepted; four "no", three undecided.
ATTEMPTS = {
    "scene": [{"id": 100 + i, "time": t, "decision": False, "confidence": "medium", "refs": {"supporting_shot_ids": [3914]}} for i, t in enumerate([0.1, 1.0, 1.94, 2.98, 3.96, 5.0, 6.08])],
    "beat": [{"id": 15930 + i, "time": t, "decision": d, "confidence": c, "refs": {"supporting_shot_ids": [3914], "supporting_speech_segment_ids": [721]}}
             for i, (t, d, c) in enumerate([(0.1, False, "medium"), (1.0, False, "medium"), (1.94, False, "medium"), (2.98, False, "low"), (3.96, None, "low"), (5.0, None, "low"), (6.08, None, "low")])],
}


def aggregate_5131(*, elements=True, attempts_beat=True):
    agg = ref_5131()
    agg["hook"]["classification"]["details"]["hook_elements"] = copy.deepcopy(ELEMENTS) if elements else []
    if attempts_beat:
        agg["structure"]["scenes"] = [{"id": 900, "order": 0, "start_time": 0.0, "end_time": 10.03, "narrative_role": None,
                                       "story_beats": [{"id": 15952, "start_time": 0.0, "end_time": 10.03, "boundary_status": "no_accepted_boundary", "unresolved_attempt_ids": [15935, 15936, 15937]}]}]
    return agg


def anatomy(creative=True, **kw):
    return build_content_anatomy(aggregate_5131(**kw), creative_5131() if creative else None, None, ATTEMPTS)


# Mechanisms shaped like the real stored ones (ids are 5131-fixture ids so they resolve inside the anatomy above).
def mechanisms():
    nt = lambda *items: [{"kind": k, "description": d} for k, d in items]                       # noqa: E731
    return [
        {"mechanism_id": "M01", "mechanism_type": "hook_curiosity", "statement": "The opening centres the product with a hand poised, establishing it before any demonstration.", "scope": "sections", "section_numbers": [1],
         "supporting_evidence_ids": {"creative_findings": [15929], "shots": [3914], "speech_segments": [721]}, "anatomy_features_used": ["creative_read", "hook_window"], "confidence": "medium",
         "transferable_principle": "Open on a clean shot of the subject itself with a small human gesture suggesting imminent use, rather than starting with action or narration.",
         "non_transferable_elements": nt(("brand_or_name", "Specific packaging text shown in the opening shot."), ("audio_specific", "Garbled, unverified spoken claim accompanying the opening.")),
         "limitations": {"model_stated": ["Hook classification partly rests on unverified speech."], "anatomy_gaps": [{"field": "narrative_role", "reason": "Scene.narrative_role is not populated by any upstream stage"}]}},
        {"mechanism_id": "M02", "mechanism_type": "demonstration", "statement": "A tight close-up of texture followed by use in cooking.", "scope": "sections", "section_numbers": [2, 3],
         "supporting_evidence_ids": {"creative_findings": [15931], "shots": [3915, 3916]}, "anatomy_features_used": ["creative_read", "pacing"], "confidence": "medium",
         "transferable_principle": "Sequence a close-up of the material followed by a shot of it in use, before introducing a spokesperson.",
         "non_transferable_elements": nt(("subject_matter", "The specific product category and cooking context.")), "limitations": {"model_stated": ["Based on a few frames, not continuous motion."], "anatomy_gaps": []}},
        {"mechanism_id": "M03", "mechanism_type": "emotional_progression", "statement": "The final shot shifts to a smiling presenter.", "scope": "sections", "section_numbers": [4],
         "supporting_evidence_ids": {"creative_findings": [15933], "shots": [3917]}, "anatomy_features_used": ["creative_read"], "confidence": "low",
         "transferable_principle": "Close a product-focused sequence with a warm human presence facing the camera.", "non_transferable_elements": nt(("visual_specific", "The presenter's appearance and setting.")),
         "limitations": {"model_stated": ["Emotional role is not established upstream."], "anatomy_gaps": []}},
    ]


MECH_RESP = lambda status="current": {"status": status, "mechanisms": mechanisms(), "overall_limitations": ["All spoken content is unverified machine transcription."], "provenance": {"reasoning_attempt_id": 15953}}   # noqa: E731


# ══ 2. scene and story-beat structure ══════════════════════════════════════════════════════════════════
class TestStructure:
    def shots(self):
        return [{"id": 3914, "start_time": 0.0, "end_time": 2.0}, {"id": 3915, "start_time": 2.0, "end_time": 3.96}, {"id": 3916, "start_time": 3.96, "end_time": 6.0}, {"id": 3917, "start_time": 6.0, "end_time": 10.03}]

    def whole(self):
        return [{"id": 1357, "start_time": 0.0, "end_time": 10.03, "story_beats": [{"id": 15952, "start_time": 0.0, "end_time": 10.03, "boundary_status": "no_accepted_boundary"}]}]

    def test_reference_5131_is_one_whole_video_scene_and_beat_with_every_shot_mapped_and_the_uncertainty_stated(self):
        r = analyze_structure(10.03, self.shots(), self.whole(), ATTEMPTS)
        assert r["partition"] == {"scenes": "single_whole_video", "beats": "single_whole_video", "shots": 4}
        assert r["scene_to_shots"] == [{"scene_id": 1357, "start": 0.0, "end": 10.03, "shot_ids": [3914, 3915, 3916, 3917]}]
        assert r["beat_to_shots"][0]["shot_ids"] == [3914, 3915, 3916, 3917] and r["beat_to_shots"][0]["boundary_status"] == "no_accepted_boundary"
        assert r["issues"] == [] and r["consistent"] is True
        b = r["reasoning"]["beat"]
        assert (b["examined"], b["accepted"], b["rejected"], b["undecided"]) == (7, 0, 4, 3)
        assert [c["decision"] for c in b["candidates"]][-3:] == [None, None, None]
        text = " ".join(r["uncertainty"])
        assert "3 left undecided" in text and "4 judged not to be a boundary" in text and "not evidence that the video has no internal story-beat structure" in text
        assert "single whole-video scene or story beat carries no partition information" in text

    def test_a_partitioned_video_maps_each_beat_to_the_shots_it_covers(self):
        scenes = [{"id": 1, "start_time": 0.0, "end_time": 6.0, "story_beats": [{"id": 11, "start_time": 0.0, "end_time": 3.96}, {"id": 12, "start_time": 3.96, "end_time": 6.0}]},
                  {"id": 2, "start_time": 6.0, "end_time": 10.03, "story_beats": [{"id": 13, "start_time": 6.0, "end_time": 10.03}]}]
        r = analyze_structure(10.03, self.shots(), scenes, {"beat": [{"id": 1, "time": 3.96, "decision": True, "confidence": "high", "refs": {}}]})
        assert r["partition"]["scenes"] == "partitioned" and r["partition"]["beats"] == "partitioned"
        assert {x["beat_id"]: x["shot_ids"] for x in r["beat_to_shots"]} == {11: [3914, 3915], 12: [3916], 13: [3917]}
        assert {x["scene_id"]: x["shot_ids"] for x in r["scene_to_shots"]} == {1: [3914, 3915, 3916], 2: [3917]}
        assert r["issues"] == [] and r["uncertainty"] == [] and r["reasoning"]["beat"]["accepted"] == 1

    @pytest.mark.parametrize("scenes,codes", [
        ([{"id": 1, "start_time": 0.0, "end_time": 4.0, "story_beats": []}, {"id": 2, "start_time": 5.0, "end_time": 10.03, "story_beats": []}], {"scene_gap"}),
        ([{"id": 1, "start_time": 0.0, "end_time": 6.0, "story_beats": []}, {"id": 2, "start_time": 5.0, "end_time": 10.03, "story_beats": []}], {"scene_overlap"}),
        ([{"id": 1, "start_time": 0.0, "end_time": 12.0, "story_beats": []}], {"scene_outside_video"}),
        ([{"id": 1, "start_time": 1.0, "end_time": 9.0, "story_beats": []}], {"scene_starts_late", "scene_ends_early"}),
        ([{"id": 1, "start_time": 0.0, "end_time": 5.0, "story_beats": [{"id": 9, "start_time": 0.0, "end_time": 7.0}]}], {"beat_outside_scene", "scene_ends_early", "shot_without_scene", "beat_ends_early"}),
    ])
    def test_inconsistent_mappings_are_reported_not_hidden(self, scenes, codes):
        found = {i["code"] for i in analyze_structure(10.03, self.shots(), scenes)["issues"]}
        assert codes <= found, (codes, found)

    def test_a_boundary_suggested_only_with_low_confidence_is_not_counted_as_accepted(self):
        r = analyze_structure(10.03, self.shots(), self.whole(), {"beat": [{"id": 1, "time": 3.0, "decision": True, "confidence": "low", "refs": {}}]})
        b = r["reasoning"]["beat"]
        assert (b["accepted"], b["boundary_but_low_confidence"]) == (0, 1)
        assert "suggested a boundary only with low confidence" in " ".join(r["uncertainty"])

    def test_no_reasoning_and_no_scenes_is_reported_as_nothing_not_as_a_structure(self):
        r = analyze_structure(10.03, self.shots(), [])
        assert r["partition"] == {"scenes": "none", "beats": "none", "shots": 4} and r["reasoning"]["beat"]["examined"] == 0 and r["scene_to_shots"] == []

    def test_the_anatomy_carries_the_structure_and_it_does_not_change_the_fingerprint(self):
        a, plain = anatomy(), build_content_anatomy(aggregate_5131(), creative_5131(), None, None)
        s = a["video"]["structure"]
        assert s["partition"]["beats"] == "single_whole_video" and s["reasoning"]["beat"]["undecided"] == 3 and s["scene_to_shots"][0]["shot_ids"] == [3914, 3915, 3916, 3917]
        assert a["provenance"]["fingerprint"] == plain["provenance"]["fingerprint"]               # derived views never make an existing mechanism set or blueprint look stale
        assert plain["video"]["structure"]["reasoning"]["beat"]["examined"] == 0


# ══ 1. hook, storytelling, mechanisms ══════════════════════════════════════════════════════════════════
class TestHookAndStory:
    def test_the_opening_is_a_combination_of_channels_each_with_timing_evidence_and_reliability(self):
        hp = anatomy()["video"]["hook_profile"]
        assert hp["window"]["start_time"] == 0.0 and hp["window"]["end_time"] == 2.0
        assert {k: v["present"] for k, v in hp["channels"].items()} == {"spoken": True, "on_screen_text": True, "visual": True, "editing_or_framing": True}
        by = {e["element_type"]: e for e in hp["elements"]}
        spoken = by["spoken_purity_claim"]
        assert spoken["channels"] == ["spoken"] and spoken["reliability"] == "unverified" and "unverified" in spoken["reliability_note"]
        assert (spoken["start_time"], spoken["end_time"]) == (0.0, 4.0) and spoken["evidence"] == {"supporting_speech_segment_ids": [721]}
        assert by["single_uninterrupted_opening_shot"]["channels"] == ["editing_or_framing"] and by["single_uninterrupted_opening_shot"]["end_time"] == 2.0
        assert by["visual_product_subject"]["channels"] == ["visual"]
        assert all(e["evidence_class"] == {"presence": "observed", "label": "ai_interpretation"} for e in hp["elements"])

    def test_coexisting_hook_types_and_channels_are_explained_not_forced_into_one_label(self):
        hp = anatomy()["video"]["hook_profile"]
        assert hp["classification"]["primary_type"] == "bold_claim" and hp["classification"]["secondary_types"] == ["demonstration"]
        text = " ".join(hp["relationships"])
        assert "occur together in 0–2 s" in text and "the hook is the combination" in text
        assert "dominant construction" in text and "not alternatives" in text
        assert "AI interpretation of apparent design, not an effect on viewers" in hp["attention_mechanism"]

    def test_the_visual_reading_and_the_text_only_classification_are_both_kept_and_their_relation_is_stated(self):
        a = anatomy()
        hp = a["video"]["hook_profile"]
        assert [v["finding_id"] for v in hp["visual_reading"]] == [15929] and hp["visual_reading"][0]["certainty"] == "INFERRED" and hp["visual_reading"][0]["contains_reference_content"] is True
        assert any("two views" in x.lower() or "two readings" in x.lower() or "unverified" in x.lower() for x in hp["relationships"])
        assert any(c["topic"] == "spoken part of the hook" and c["status"] == "unverified" for c in hp["contradictions"])

    def test_nothing_about_audience_behaviour_is_claimed(self):
        hp = anatomy()["video"]["hook_profile"]
        assert any("held anyone's attention" in u for u in hp["unsupported"])
        assert set(hp["evidence_classes"]) == {"observed", "ai_interpretation", "unsupported"}
        blob = json.dumps(hp, ensure_ascii=False).lower()
        for bad in ("retention", "engagement", "viral", "converted", "performed well"):
            assert bad not in blob.replace("not an effect on viewers", "")

    def test_the_planner_gets_the_openings_structure_but_none_of_the_references_wording_or_subject(self):
        view = hook_structure_for_blueprint(anatomy()["video"]["hook_profile"])
        assert view["window_seconds"] == [0.0, 2.0] and view["primary_type"] == "bold_claim" and view["channels_combined"] is True and view["element_count"] == 4
        assert view["channels"]["spoken"] == {"present": True, "reliable": False}
        blob = json.dumps(view, ensure_ascii=False)
        for leak in ("spoken_purity_claim", "product", "bina", "100%", "BARAKAH", "Ginger", "jar"):
            assert leak not in blob

    def test_without_hook_elements_the_profile_still_exists_and_says_less(self):
        hp = anatomy(elements=False)["video"]["hook_profile"]
        assert hp["elements"] == [] and not any(v["present"] for v in hp["channels"].values())
        assert hp["classification"]["primary_type"] == "bold_claim"

    def test_a_video_with_no_hook_has_no_profile(self):
        agg = aggregate_5131()
        agg["hook"] = {}
        assert build_content_anatomy(agg, None, None, None)["video"]["hook_profile"] is None

    def test_the_narrative_progression_comes_from_what_the_ai_read_in_the_frames_and_names_its_gaps(self):
        n = anatomy()["video"]["narrative"]
        assert n["status"] == "assembled_from_creative_read" and n["certainty"] == "INFERRED"
        assert [(s["section"], s["role_label"]) for s in n["sections"]] == [(1, "Opening / hook"), (2, "Demonstration"), (3, None), (4, "Human or emotional shift")]
        assert n["sections"][2]["basis"] == "not established" and n["sections"][0]["basis"] == "ai_vision (inferred)"
        assert n["arc_text"] == "Opening / hook (section 1) → Demonstration (section 2) → Human or emotional shift (section 4)"
        assert any("1 of 4 sections have no visual reading" in u for u in n["uncertainty"])
        assert any("whether it worked on an audience" in u for u in n["unsupported"])

    @pytest.mark.parametrize("order", [0, 1])
    def test_the_most_specific_role_leads_whatever_the_order_of_the_findings_and_the_others_are_kept(self, order):
        hook = {"id": 1, "kind": "hook_visual", "mechanism_hint": "hook_curiosity", "confidence": "medium"}
        text = {"id": 2, "kind": "text_use", "mechanism_hint": "text_attention", "confidence": "low"}
        findings = [hook, text] if order == 0 else [text, hook]
        n = narrative_progression([{"number": 1, "start_time": 0.0, "end_time": 2.0, "creative": {"findings": findings}}], None, None)
        s = n["sections"][0]
        assert (s["role"], s["role_label"], s["also"], s["confidence"]) == ("opening_hook", "Opening / hook", ["Text focus"], "low")
        assert n["arc_text"].startswith("Opening / hook (section 1)")

    def test_without_a_visual_reading_the_progression_is_not_established_and_says_how_to_establish_it(self):
        n = anatomy(creative=False)["video"]["narrative"]
        assert n["status"] == "not_established" and n["arc_text"] is None and all(s["role"] is None for s in n["sections"])
        assert any("Add the AI visual reading" in u for u in n["uncertainty"])

    def test_the_mechanism_reasoner_is_shown_the_profile_the_uncertainty_and_the_arc(self):
        ri = mechanism_input(anatomy())
        assert ri["hook_profile"]["channels"]["spoken"] == {"present": True, "reliable": False, "first_seen": 0.0} and len(ri["hook_profile"]["elements"]) == 4
        assert any("left undecided" in u for u in ri["structure_uncertainty"]) and ri["narrative_arc"].startswith("Opening / hook")
        assert "HOOK PROFILE AND STRUCTURE" in MECHANISM_PROMPT and "COMBINATION" in MECHANISM_PROMPT
        plain = mechanism_input(build_content_anatomy(ref_5131(), None))
        assert "narrative_arc" not in plain                                                       # nothing is claimed when nothing supports it


# ══ 3. reusable creative intelligence ═════════════════════════════════════════════════════════════════
class TestIntelligenceRecord:
    def test_every_mechanism_has_purpose_typed_evidence_with_timestamps_conditions_adaptation_and_the_reuse_copy_split(self):
        rec = build_creative_intelligence(anatomy(), MECH_RESP())
        assert rec["status"] == "ready" and rec["schema"] == "creative-intelligence-v1" and rec["pins"]["mechanism_attempt_id"] == 15953
        assert [m["mechanism_id"] for m in rec["mechanisms"]] == ["M01", "M02", "M03"]
        m1 = rec["mechanisms"][0]
        assert "Appears designed" in m1["purpose"] and m1["position"] == "opening"
        finding = next(e for e in m1["evidence"]["visual"] if e["kind"] == "creative_findings")
        assert (finding["id"], finding["section"], finding["start_time"], finding["end_time"], finding["finding_kind"]) == (15929, 1, 0.0, 2.0, "hook_visual")
        shot = next(e for e in m1["evidence"]["visual"] if e["kind"] == "shots")
        assert shot["id"] == 3914 and shot["section"] == 1
        speech = m1["evidence"]["audio"][0]
        assert speech["id"] == 721 and speech["reliable"] is False and (speech["start_time"], speech["end_time"]) == (0.0, 4.0)
        assert m1["unreliable_channels"] == ["audio"] and m1["evidence_channels"] == {"visual": 2, "audio": 1, "text": 0, "editing": 0}
        assert m1["conditions"]["applies_when"] and m1["conditions"]["avoid_when"] and "not AI, not measured" in m1["conditions"]["source"]
        assert any("unverified" in x for x in m1["adaptation_guidance"]) and any("opening of the video" in x for x in m1["adaptation_guidance"])
        assert m1["reuse_vs_copy"]["reuse"] == m1["transferable_principle"] and [x["kind"] for x in m1["reuse_vs_copy"]["never_copy"]] == ["brand_or_name", "audio_specific"]
        assert m1["confidence"] == "medium" and "Hook classification partly rests on unverified speech." in m1["limitations"]
        assert m1["reference_description"]["contains_reference_content"] is True and m1["evidence_classes"]["unsupported"][0].startswith("Whether this mechanism affected any audience")

    def test_a_visual_only_mechanism_says_it_can_be_adapted_without_speech_or_text(self):
        m2 = build_creative_intelligence(anatomy(), MECH_RESP())["mechanisms"][1]
        assert m2["evidence_channels"]["audio"] == 0 and m2["unreliable_channels"] == [] and [(x["number"], round(x["start_time"], 2), round(x["end_time"], 2)) for x in m2["sections"]] == [(2, 2.0, 3.96), (3, 3.96, 6.0)]
        assert any("visuals only" in x for x in m2["adaptation_guidance"])
        assert next(e for e in m2["evidence"]["visual"] if e["id"] == 15931)["section"] == 2

    def test_contradictory_readings_are_listed_not_resolved_silently(self):
        rec = build_creative_intelligence(anatomy(), MECH_RESP())
        topics = {c["topic"] for c in rec["contradictions"]}
        assert {"spoken wording", "on-screen text", "spoken part of the hook"} <= topics
        assert any(c["topic"] == "object identity" and c["status"] == "partly_corroborated" for c in rec["contradictions"])
        assert rec["audience_effects"]["status"] == "not_established"

    def test_the_record_separates_reuse_from_copying(self):
        rec = build_creative_intelligence(anatomy(), MECH_RESP())
        assert rec["reuse_policy"]["reuse"].startswith("The mechanism") and "wording, brand" in rec["reuse_policy"]["never_copy"]
        assert set(rec["evidence_classes"]) == {"observed", "ai_interpretation", "unsupported"}

    def test_the_same_disagreement_across_several_sections_is_one_finding_listing_every_section_and_note(self):
        rec = build_creative_intelligence(anatomy(), MECH_RESP())
        keys = [(c["topic"], c["status"]) for c in rec["contradictions"]]
        assert len(keys) == len(set(keys))
        for c in rec["contradictions"]:
            assert c["sections"] == sorted(set(c["sections"])) and len(c["notes"]) == len(set(c["notes"]))
            assert c["note"] == (c["notes"][0] if c["notes"] else None)
        a = {"video": {"duration": 10.0, "reconciliation": {"items": [
            {"topic": "spoken wording", "status": "contradicted", "sections": [3], "note": "n-a", "authority": "x"},
            {"topic": "spoken wording", "status": "contradicted", "sections": [1, 2], "note": "n-b", "authority": "x"},
            {"topic": "spoken wording", "status": "contradicted", "sections": [2, 4], "note": "n-a", "authority": "x"},
            {"topic": "spoken wording", "status": "established", "sections": [1], "note": "ok", "authority": "x"}]}}, "sections": [], "provenance": {}}
        got = build_creative_intelligence(a, None)["contradictions"]
        assert len(got) == 1 and got[0]["sections"] == [1, 2, 3, 4] and got[0]["notes"] == ["n-a", "n-b"] and got[0]["note"] == "n-a"

    @pytest.mark.parametrize("status,expected,count", [("current", "ready", 3), ("stale", "mechanisms_stale", 3), ("not_run", "mechanisms_not_run", 0), ("unknown", "mechanisms_unknown", 0)])
    def test_it_reports_honestly_when_mechanisms_are_stale_or_missing(self, status, expected, count):
        rec = build_creative_intelligence(anatomy(), MECH_RESP(status) if status != "not_run" else {"status": "not_run", "mechanisms": []})
        assert (rec["status"], len(rec["mechanisms"])) == (expected, count)
        assert rec["hook"] is not None and rec["narrative"] is not None and rec["structure"] is not None         # the rest is still available

    def test_limitations_include_what_the_structure_reasoning_did_not_establish(self):
        rec = build_creative_intelligence(anatomy(), MECH_RESP())
        assert any("unverified machine transcription" in x for x in rec["limitations"]) and any("left undecided" in x for x in rec["limitations"])


class TestGuidanceTable:
    def test_every_mechanism_type_has_complete_guidance_that_makes_no_performance_claim(self):
        from app.services.mechanism_reasoner.contract import MECHANISM_TYPES
        for t in sorted(MECHANISM_TYPES):
            g = mg.guidance_for(t)
            assert g["purpose"] and g["applies_when"] and g["avoid_when"] and g["adaptation_guidance"] and "not AI, not measured" in g["source"], t
            blob = json.dumps(g).lower()
            for bad in ("increase", "improve engagement", "boost", "retention", "convert", "viral", "performs"):
                assert bad not in blob, (t, bad)
        assert mg.guidance_for("not_a_type")["purpose"] == mg.guidance_for("other")["purpose"]

    def test_evidence_awareness_and_position(self):
        assert mg.evidence_channels({"speech_segments": [1, 2], "text_elements": [3], "shots": [4], "transition_evidence": [5]}) == {"audio": 2, "text": 1, "visual": 1, "editing": 1}
        assert mg.position_label(0.0, 2.0, 10.0) == "opening" and mg.position_label(4.0, 6.0, 10.0) == "middle" and mg.position_label(8.0, 10.0, 10.0) == "closing" and mg.position_label(None, 1, 10) is None
        g = mg.guidance_for("text_attention", channels={"text": 2}, unreliable={"text"}, position="closing")
        assert any("rendering artefact" in n for n in g["evidence_notes"]) and any("closing" in n for n in g["evidence_notes"])


# ══ the one deterministic integration test: evidence flows Reference -> Anatomy -> Mechanisms -> New Content -> Blueprint ══
INTENT = {"product_service_or_topic": "A booking tool for independent dentists", "target_audience": "dental practice owners", "objective": "get them to book a demo",
          "desired_cta": "Book a demo", "duration_platform_constraints": {"platform": "Instagram Reels", "target_duration_seconds": 12}, "tone_style_constraints": ["calm", "professional"]}


def blueprint_payload():
    def sec(n, purpose, role, dur, mech, anat, instr, text, speech, pacing, cta=None):
        return {"section_number": n, "section_purpose": purpose, "structural_role": role, "target_duration_seconds": dur, "mechanisms_applied": mech,
                "source_anatomy_relationship": {"relationship": "adapts_reference_structure", "anatomy_section_numbers": anat}, "content_instruction": instr,
                "required_information": ["to be supplied: the practice's own visuals"], "visual_direction": "Clean, centred view of the booking screen.", "text_direction": text,
                "speech_direction": speech, "pacing_direction": pacing, "transition_direction": None, "cta_direction": cta, "mandatory_points_assigned": [], "confidence": "medium", "limitations": []}
    return {
        "structural_approach": "Open on the tool itself with a hint of imminent use, show a short before and after of a schedule, then close with a calm human invitation to book.",
        "mechanism_dispositions": [
            {"mechanism_id": "M01", "decision": "USED", "reason_category": None, "reason": None, "applied_in_sections": [1], "application_rationale": "Section 1 opens on the tool with a small gesture implying use, before any explanation."},
            {"mechanism_id": "M02", "decision": "USED", "reason_category": None, "reason": None, "applied_in_sections": [2, 3], "application_rationale": "Sections 2-3 show a crowded schedule and then the organised one in use."},
            {"mechanism_id": "M03", "decision": "NOT_USED", "reason_category": "unsuitable_for_platform", "reason": "The brief asks for a calm professional tone with no on-camera person, so the human close does not apply.", "applied_in_sections": [], "application_rationale": None}],
        "sections": [
            sec(1, "Establish the tool as the subject of the opening", "opening", 2, ["M01"], [1], "Open on the booking screen centred, with a cursor about to act.", "Minimal text.", "No voice-over.", "One steady shot."),
            sec(2, "Show the schedule before", "demonstration", 3, ["M02"], [2], "Show a crowded appointment schedule being used.", "A short neutral label.", "A short calm explanation.", "One steady shot."),
            sec(3, "Show the schedule after", "demonstration", 3, ["M02"], [3], "Show the organised schedule in the same view.", "A short neutral label.", "One calm line.", "One steady shot, slightly quicker."),
            sec(4, "Invite the viewer to book", "call_to_action", 4, [], [4], "Close on the booking screen with a clear next step.", "A short closing prompt.", "A calm invitation.", "Settle into a steady pace.", cta="Point to booking a demo as the next step.")],
        "unassigned_mandatory_points": [], "limitations": ["The practice's own screens were not supplied."]}


def test_evidence_flows_from_the_reference_through_the_mechanisms_and_new_content_into_the_blueprint():
    # Reference -> Anatomy: the stored evidence of reference 5131 becomes a pinned anatomy with the creative layer, the hook profile, the structure check and the narrative.
    a = anatomy()
    assert a["provenance"]["fingerprint"] and a["video"]["hook_profile"] and a["video"]["structure"] and a["video"]["narrative"]["arc_text"]

    # Anatomy -> Mechanisms: the mechanism reasoner is shown the creative findings, the hook profile and what is uncertain; its output cites ids that resolve inside the anatomy.
    mi = mechanism_input(a)
    assert any(f["id"] == 15929 for s in mi["sections"] for f in (s.get("creative") or {}).get("findings", [])) and mi["hook_profile"]["primary_type"] == "bold_claim"
    resolved = {(k, i) for s in a["sections"] for k, ids in s["evidence_ids"].items() for i in ids}
    for m in mechanisms():
        for kind, ids in m["supporting_evidence_ids"].items():
            for i in ids:
                assert (kind, i) in resolved, (m["mechanism_id"], kind, i)

    # Mechanisms -> New Content: the record the person sees before writing the brief. Each mechanism is traceable to sections, timestamps and reliability.
    record = build_creative_intelligence(a, MECH_RESP())
    m1 = record["mechanisms"][0]
    assert [(s["number"], s["start_time"], s["end_time"]) for s in m1["sections"]] == [(1, 0.0, 2.0)]
    assert any(e["id"] == 15929 and e["start_time"] == 0.0 and e["end_time"] == 2.0 for e in m1["evidence"]["visual"]) and m1["unreliable_channels"] == ["audio"]
    assert record["hook"]["window"]["end_time"] == 2.0 and record["narrative"]["arc_text"].startswith("Opening / hook")
    assert {c["topic"] for c in record["contradictions"]} >= {"spoken wording", "spoken part of the hook"}

    # New Content -> Blueprint: the planner receives conditions, adaptation guidance, evidence strength and the opening's STRUCTURE for a different business, and none of the reference's wording or subject.
    canon = normalize_intent(INTENT)
    ctx = build_context(a, mechanisms(), canon)
    sent = blueprint_input(ctx)
    g1 = next(m for m in sent["mechanisms"] if m["mechanism_id"] == "M01")["reuse_guidance"]
    assert g1["applies_when"] and g1["avoid_when"] and g1["evidence_channels"] == {"visual": 2, "audio": 1, "text": 0, "editing": 0} and g1["unreliable_channels"] == ["audio"] and g1["position_in_reference"] == "opening"
    assert any("unverified" in x for x in g1["adaptation_guidance"])
    assert sent["reference_hook"]["window_seconds"] == [0.0, 2.0] and sent["reference_hook"]["channels"]["spoken"] == {"present": True, "reliable": False} and sent["reference_hook"]["channels_combined"] is True
    blob = json.dumps({"hook": sent["reference_hook"], "guidance": [m["reuse_guidance"] for m in sent["mechanisms"]]}, ensure_ascii=False)
    for token in ("BARAKAH", "Ginger", "Garlic", "100%", "bina", "jar", "purity", "spoken_purity_claim"):
        assert token not in blob, token
    assert BLUEPRINT_PROMPT_VERSION == "v5" and "REUSE GUIDANCE" in BLUEPRINT_PROMPT and "avoid_when" in BLUEPRINT_PROMPT and "NOT_USED" in BLUEPRINT_PROMPT

    # Blueprint: the planner's decision passes every existing safeguard, applies M01/M02 to new sections, explains why M03 does not apply, and every use traces back to reference sections.
    decision = decision_from_payload(blueprint_payload(), reasoning_contract_version=BLUEPRINT_PROMPT_VERSION)
    validate_decision(decision, ctx)
    bp = finalize_blueprint(decision, ctx, {"anatomy_fingerprint": a["provenance"]["fingerprint"], "mechanism_attempt_id": 15953, "intent_hash": "h", "provider": "anthropic", "model": "m", "prompt_version": "v5"}, [])
    assert bp["mechanisms_used"] == ["M01", "M02"] and [m["mechanism_id"] for m in bp["mechanisms_not_used"]] == ["M03"] and "no on-camera person" in bp["mechanisms_not_used"][0]["reason"]
    s1, s2 = bp["sections"][0], bp["sections"][1]
    assert s1["mechanisms_applied"] == ["M01"] and s1["evidence_refs"] == {"anatomy_section_numbers": [1], "mechanism_ids": ["M01"]}
    assert s2["evidence_refs"]["anatomy_section_numbers"] == [2]
    d1 = next(d for d in bp["mechanism_dispositions"] if d["mechanism_id"] == "M01")
    assert d1["transferable_principle"] == m1["transferable_principle"]                                         # the principle crosses unchanged...
    assert not any(t in json.dumps(bp["sections"]) for t in ("Ginger", "jar", "BARAKAH"))                         # ...the reference's content does not
    assert {x["description"] for x in bp["constraints"]["do_not_reproduce"]} >= {x["description"] for x in m1["reuse_vs_copy"]["never_copy"]}   # and the do-not-copy list travels with it

    # And the guard still bites: a plan that carries the reference's subject is refused.
    bad = blueprint_payload()
    bad["sections"][0]["content_instruction"] = "Open on the packaging while the cooking is in progress."
    with pytest.raises(BlueprintReasoningError):
        validate_decision(decision_from_payload(bad, reasoning_contract_version=BLUEPRINT_PROMPT_VERSION), ctx)


def test_blueprint_guidance_is_empty_of_wording_for_a_reference_with_no_opening_profile():
    plain = build_content_anatomy(ref_5131(hook_elements=False), None)
    g = blueprint_guidance(mechanisms(), plain)
    assert set(g["mechanisms"]) == {"M01", "M02", "M03"} and g["reference_hook"] is not None
    assert g["reference_hook"]["element_count"] == 0 and g["reference_hook"]["visual_reading_present"] is False
