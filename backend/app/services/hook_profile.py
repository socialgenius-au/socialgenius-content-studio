"""How the OPENING works, as a structured, evidence-labelled profile; and the video's NARRATIVE PROGRESSION assembled from what the AI already read in the frames.

Built from stored evidence only (the hook reasoner's classification and elements, the measured hook window, the Creative Read, the reconciliation of unequal-authority readings). No new AI call.
Three kinds of statement are kept apart everywhere:
  observed           -- measured/stored facts: which channels exist in the window, their timing, which evidence rows they cite.
  ai_interpretation  -- what an AI concluded: hook type, intent, the NAME given to an element, the visual reading, a scene's role.
  unsupported        -- anything about audience behaviour: never established here, always listed as not known.
Where several hooks or channels coexist the profile explains how they relate instead of picking one. Where readings disagree it says so (it never silently picks the convenient one).
"""
from __future__ import annotations

_INTENT = {
    "create_curiosity": "make the viewer curious about what comes next", "establish_relevance": "show the viewer that the video is about something relevant to them",
    "surface_problem": "bring a problem to the surface", "promise_result": "promise a result", "establish_credibility": "establish credibility",
    "provoke_attention": "capture attention", "other": "achieve an effect the classifier could not name more precisely",
}
_TYPE = {
    "question": "an opening question", "bold_claim": "an absolute claim stated up front", "curiosity_gap": "a deliberate gap in what the viewer knows", "direct_address": "speaking directly to the viewer",
    "problem_statement": "naming a problem", "result_first": "showing the result first", "proof_first": "leading with proof", "pattern_interrupt": "a break from what the viewer expects",
    "relatable_statement": "a relatable statement", "demonstration": "demonstrating the subject", "offer_led": "leading with an offer", "other": "a construction that fits no named type", "unclear": "no clear construction",
}
UNSUPPORTED = [
    "Whether the opening captured or held anyone's attention.",
    "Whether viewers kept watching because of any element of the opening.",
    "How the opening compares with other videos' openings.",
]
EVIDENCE_CLASSES = {
    "observed": "Which channels are present in the opening and when, and which stored evidence each cites (measured from the stored analysis).",
    "ai_interpretation": "The hook type, the intent, the names given to elements and the visual reading: conclusions an AI drew, shown as inferred.",
    "unsupported": "Anything about audience behaviour: not measured and not claimed.",
}
_ROLE = {
    "hook_curiosity": ("opening_hook", "Opening / hook"), "demonstration": ("demonstration", "Demonstration"), "emotional_progression": ("emotional_shift", "Human or emotional shift"),
    "proof_credibility": ("proof", "Proof or credibility"), "contrast": ("contrast", "Contrast"), "problem_tension": ("problem", "Problem or tension"), "information_reveal": ("reveal", "Information reveal"),
    "progression": ("progression", "Progression"), "payoff_resolution": ("payoff", "Payoff or resolution"), "cta_next_step": ("call_to_action", "Call to action"),
    "pattern_interruption": ("interruption", "Pattern interruption"), "pacing_rhythm": ("rhythm", "Rhythm"), "visual_attention": ("visual_focus", "Visual focus"),
    "audio_attention": ("audio_focus", "Audio focus"), "text_attention": ("text_focus", "Text focus"),
}
_ROLE_BY_KIND = {"hook_visual": ("opening_hook", "Opening / hook"), "emotional_register": ("emotional_shift", "Human or emotional shift"), "visual_pattern": ("visual_build", "Visual build-up"),
                 "persuasion_device": ("persuasion", "Persuasion"), "attention_focus": ("visual_focus", "Visual focus"), "audio_visual_relation": ("audio_visual", "Sound and picture working together"),
                 "text_use": ("text_focus", "Text focus")}


def _num(x):
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def _channels_of(refs: dict) -> list[str]:
    out = []
    if refs.get("supporting_speech_segment_ids"):
        out.append("spoken")
    if refs.get("supporting_text_element_ids"):
        out.append("on_screen_text")
    if refs.get("supporting_visual_object_ids") or refs.get("supporting_scene_ids") or refs.get("supporting_story_beat_ids"):
        out.append("visual")
    if refs.get("supporting_shot_ids") or refs.get("supporting_annotation_ids"):
        out.append("editing_or_framing")
    return out


def build_hook_profile(*, hook: dict, sections: list[dict], shots: list[dict], reconciliation: dict | None, creative_view: dict | None) -> dict | None:
    cls = hook.get("classification") or {}
    window = hook.get("window") or {}
    w0, w1 = _num(window.get("start_time")), _num(window.get("end_time"))
    if not cls and w0 is None:
        return None
    speech = {x["id"]: x for s in sections for x in (s.get("speech") or []) if x.get("id") is not None}
    texts = {x["id"]: x for s in sections for x in (s.get("on_screen_text") or []) if x.get("id") is not None}
    shot_t = {x.get("id"): (_num(x.get("start_time")), _num(x.get("end_time"))) for x in shots}
    rec = reconciliation or {}
    bad_speech = set(rec.get("unverified_speech_ids") or [])
    bad_text = set(rec.get("low_confidence_text_ids") or [])
    elements = []
    for el in cls.get("hook_elements") or []:
        refs = el.get("evidence_references") or {}
        chans = _channels_of(refs) or ["unspecified"]
        spans = [(speech[i]["start_time"], speech[i]["end_time"]) for i in refs.get("supporting_speech_segment_ids", []) if i in speech]
        spans += [(texts[i]["start_time"], texts[i]["end_time"]) for i in refs.get("supporting_text_element_ids", []) if i in texts]
        spans += [shot_t[i] for i in refs.get("supporting_shot_ids", []) if i in shot_t and None not in shot_t[i]]
        start = min((a for a, _ in spans), default=w0)
        end = max((b for _, b in spans), default=w1)
        why = []
        if "spoken" in chans and set(refs.get("supporting_speech_segment_ids", [])) & bad_speech:
            why.append("the speech is machine-transcribed and unverified")
        if "on_screen_text" in chans and set(refs.get("supporting_text_element_ids", [])) & bad_text:
            why.append("the on-screen text is low-confidence or possibly a rendering artefact")
        elements.append({
            "element_type": el.get("element_type"), "channels": chans, "start_time": start, "end_time": end,
            "evidence": {k: list(v) for k, v in refs.items() if isinstance(v, list) and v},
            "evidence_class": {"presence": "observed", "label": "ai_interpretation"},
            "reliability": "unverified" if why else "established", "reliability_note": "; ".join(why) or None,
        })
    channels = {}
    for ch in ("spoken", "on_screen_text", "visual", "editing_or_framing"):
        els = [e for e in elements if ch in e["channels"]]
        channels[ch] = {"present": bool(els), "element_count": len(els), "reliable": (all(e["reliability"] == "established" for e in els) if els else None),
                        "first_seen": min((e["start_time"] for e in els if e["start_time"] is not None), default=None)}

    visual_hooks = []
    for s in sections:
        for f in ((s.get("creative") or {}).get("findings") or []):
            if f.get("kind") == "hook_visual":
                visual_hooks.append({"finding_id": f.get("id"), "start_time": f.get("start"), "end_time": f.get("end"), "confidence": f.get("confidence"), "mechanism_hint": f.get("mechanism_hint"),
                                     "statement": f.get("statement"), "certainty": "INFERRED", "basis": "ai_vision", "contains_reference_content": True})

    primary, secondary, intent = cls.get("primary_type"), list(cls.get("secondary_types") or []), cls.get("probable_intent")
    mech = None
    if primary:
        mech = f"The classifier reads the opening as {_TYPE.get(primary, primary)}" + (f", apparently designed to {_INTENT.get(intent, intent)}" if intent else "") + ". This is an AI interpretation of apparent design, not an effect on viewers."

    present = [c for c, v in channels.items() if v["present"]]
    relationships = []
    if len(present) >= 2:
        names = ", ".join(c.replace("_", " ") for c in present)
        span = f"{w0:g}–{w1:g} s" if w0 is not None and w1 is not None else "the opening"
        relationships.append(f"{names.capitalize()} occur together in {span}; the hook is the combination, not one element.")
    if primary and secondary:
        relationships.append(f"{_TYPE.get(primary, primary).capitalize()} is the dominant construction and {', '.join(_TYPE.get(x, x) for x in secondary)} supports it. They are not alternatives: both were identified in the same opening.")
    two = next((i for i in (rec.get("items") or []) if i.get("topic") == "opening hook"), None)
    if two:
        relationships.append(two.get("note") or "The text-only classification and the visual reading of the opening are two views of the same moment.")
    elif visual_hooks and primary:
        relationships.append("The visual reading of the opening (what the frames show) and the classification of its construction are two separate readings of the same moment; neither replaces the other.")
    contradictions = []
    if channels["spoken"]["present"] and channels["spoken"]["reliable"] is False:
        contradictions.append({"topic": "spoken part of the hook", "status": "unverified", "note": "The classification of the spoken part rests on unverified machine transcription. The visual and on-screen-text channels are better established."})
    return {
        "schema": "hook-profile-v1", "window": {"start_time": w0, "end_time": w1, "derived_from": window.get("derived_from")},
        "classification": {"primary_type": primary, "secondary_types": secondary, "probable_intent": intent, "confidence": cls.get("confidence"), "certainty": "INFERRED", "model": cls.get("model")},
        "attention_mechanism": mech, "channels": channels, "elements": elements, "visual_reading": visual_hooks, "relationships": relationships, "contradictions": contradictions,
        "evidence_classes": EVIDENCE_CLASSES, "unsupported": list(UNSUPPORTED),
    }


def hook_structure_for_blueprint(profile: dict | None) -> dict | None:
    """The opening's STRUCTURE only: types, channels, timing and reliability. No wording, no description of the reference's subject: safe to hand to the planner."""
    if not profile:
        return None
    c = profile["classification"]
    return {
        "window_seconds": [profile["window"]["start_time"], profile["window"]["end_time"]], "primary_type": c.get("primary_type"), "secondary_types": c.get("secondary_types"), "probable_intent": c.get("probable_intent"),
        "channels": {k: {"present": v["present"], "reliable": v["reliable"]} for k, v in profile["channels"].items()}, "element_count": len(profile["elements"]),
        "channels_combined": sum(1 for v in profile["channels"].values() if v["present"]) >= 2, "visual_reading_present": bool(profile["visual_reading"]),
        "caution": "Apparent design only; nothing is known about audience response. Reuse the construction, never the reference's subject or wording.",
    }


def narrative_progression(sections: list[dict], hook_profile: dict | None, structure: dict | None) -> dict:
    """How the video progresses, assembled from what the AI read in each section's frames (Creative Read) and the mechanism it named; never from wording. Sections with no reading stay unknown."""
    out = []
    for s in sections:
        cre = s.get("creative") or {}
        findings = cre.get("findings") or []
        role = None
        for f in findings:                                   # the mechanism the AI named is the richer label; the finding kind is the fallback
            role = _ROLE.get(f.get("mechanism_hint")) or role
        if role is None:
            for f in findings:
                role = _ROLE_BY_KIND.get(f.get("kind")) or role
        confs = [f.get("confidence") for f in findings if f.get("confidence")]
        out.append({
            "section": s["number"], "start_time": s["start_time"], "end_time": s["end_time"], "role": role[0] if role else None, "role_label": role[1] if role else None,
            "basis": "ai_vision (inferred)" if role else "not established", "finding_ids": [f.get("id") for f in findings], "confidence": min(confs, key=["low", "medium", "high"].index) if confs else None,
            "channels": {"visual": bool(cre.get("shot_reads") or findings), "spoken": bool(s.get("speech")), "on_screen_text": bool(s.get("on_screen_text"))},
            "is_opening": bool(s.get("is_opening")), "overlaps_hook_window": bool(s.get("overlaps_hook_window")),
        })
    known = [x for x in out if x["role"]]
    arc = []
    for x in known:
        if not arc or arc[-1]["label"] != x["role_label"]:
            arc.append({"label": x["role_label"], "sections": [x["section"]]})
        else:
            arc[-1]["sections"].append(x["section"])
    unc = list((structure or {}).get("uncertainty") or [])
    if not known:
        unc.append("No section has an AI visual reading, and the story beats carry no partition, so the narrative progression is not established. Add the AI visual reading (Creative Read) to establish it.")
    elif len(known) < len(out):
        unc.append(f"{len(out) - len(known)} of {len(out)} sections have no visual reading, so their role in the progression is unknown.")
    return {
        "schema": "narrative-progression-v1", "status": "assembled_from_creative_read" if known else "not_established", "certainty": "INFERRED",
        "sections": out, "arc": arc, "arc_text": " → ".join(f"{a['label']} (section{'s' if len(a['sections']) > 1 else ''} {a['sections'][0]}{'–' + str(a['sections'][-1]) if len(a['sections']) > 1 else ''})" for a in arc) or None,
        "uncertainty": unc, "unsupported": ["Why the order was chosen, or whether it worked on an audience, is not known."],
    }
