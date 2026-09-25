"""C3 — provider-independent, ANATOMY-AWARE validation of a MechanismDecision, plus deterministic
finalisation (ids, propagated gaps, limitations, provenance).

Called by router.derive_mechanisms() for EVERY provider, so the safeguards do not depend on any one
provider's prompt or parsing. Every check raises MechanismReasoningError -- a response that violates them is
rejected whole, never edited, never persisted (existing Stage 10/11 discipline).

EVIDENCE SAFEGUARDS
  * every cited section number exists in the anatomy;
  * every cited evidence id exists in the SAME pinned anatomy. A SECTION-scoped mechanism may cite ids only from its
    cited sections; a VIDEO-scoped mechanism may cite ids from anywhere in the anatomy (its `section_numbers` only
    name where it is most visible) -- existence in the anatomy is never relaxed;
  * every claimed anatomy feature is actually PRESENT: for a SECTION-scoped mechanism in its cited sections; for a
    VIDEO-scoped mechanism anywhere in the same video (listed sections only say where it is most visible); the
    video-level features must exist at video level;
  * type gates: a mechanism type whose structural precondition the anatomy does not show is rejected (e.g.
    text_attention with no on-screen text; pacing_rhythm with no cuts; hook_curiosity away from the hook);
  * interpretive-dependent types (emotional_progression, cta_next_step) cannot be `high` confidence while the
    anatomy's own interpretive field for it is null;
  * no two mechanisms of the same type may share scope AND features (same type is fine when structurally
    different).
TRANSFERABILITY SAFEGUARDS
  * a non-empty transferable principle AND at least one explicit non-transferable element (enforced by the
    contract), a principle that carries no source section numbers/timestamps, and no reproduction of source
    wording (short run limit for the principle, longer for other fields).
LANGUAGE SAFEGUARDS
  * no performance/outcome claim, no causal/certainty claim (language_guard). A statement may describe OBSERVED
    structure directly, but any asserted INTENT / PURPOSE / FUNCTION must be cautiously hedged ("appears designed
    to...", "may function as...").
"""
from app.services.mechanism_reasoner.anatomy_input import (
    section_features, section_map, source_texts, valid_evidence_ids, valid_section_numbers, video_features, anatomy_pin,
    validate_anatomy_input,
)
from app.services.mechanism_reasoner.contract import MechanismDecision, MechanismReasoningError, Mechanism, TAXONOMY_VERSION
from app.services.mechanism_reasoner.language_guard import (
    OTHER_VERBATIM_LIMIT, PRINCIPLE_VERBATIM_LIMIT, build_source_index, reject_prohibited_language,
    reject_source_reproduction, reject_source_specific_references, reject_unhedged_intent,
)

__all__ = ["MAX_MECHANISMS", "validate_decision", "finalize_mechanisms", "derive_overall_limitations"]

MAX_MECHANISMS = 12

_VIDEO_LEVEL_FEATURES = frozenset({"hook_classification", "structural_pattern", "progression", "pacing_profile"})
_CONTENT_FEATURES = frozenset({"transcript", "speech", "on_screen_text", "visual_objects"})
# type -> features of which at least one must be used (and, by the presence check, is actually in the anatomy)
_TYPE_REQUIRES_ANY = {
    "text_attention": {"on_screen_text"},
    "audio_attention": {"speech", "silence"},
    "visual_attention": {"visual_objects", "cuts", "transitions", "motion"},
    "pattern_interruption": {"cuts", "transitions", "motion", "accepted_retention_device"},
    "proof_credibility": _CONTENT_FEATURES, "demonstration": _CONTENT_FEATURES, "information_reveal": _CONTENT_FEATURES,
    "problem_tension": _CONTENT_FEATURES, "contrast": _CONTENT_FEATURES, "emotional_progression": _CONTENT_FEATURES,
    "cta_next_step": _CONTENT_FEATURES,
}
# relation types need a span of >= 2 sections: they describe how one part relates to another
_NEEDS_TWO_SECTIONS = frozenset({"payoff_resolution", "contrast"})
# type -> the C2 interpretive field it depends on; while that field is null the mechanism cannot be `high`
_INTERPRETIVE_DEPENDENT = {"emotional_progression": "emotional_function", "cta_next_step": "cta_role"}

_FEATURE_GAP_FIELDS = {
    "transcript": {"stage:speech_analysis"}, "speech": {"stage:speech_analysis"}, "on_screen_text": {"stage:text_analysis"},
    "visual_objects": {"stage:visual_objects"}, "silence": {"stage:audio_structure"},
    "cuts": {"stage:scene_segmentation", "stage:editing_rhythm"}, "pacing": {"stage:scene_segmentation", "stage:editing_rhythm"},
    "pacing_profile": {"stage:scene_segmentation", "stage:editing_rhythm"},
    "transitions": {"stage:transition_evidence", "stage:transition_similarity_evidence"},
    "motion": {"stage:global_motion_evidence", "stage:local_motion_evidence", "stage:local_motion_dynamics"},
    "hook_window": {"stage:hook_window"}, "hook_classification": {"stage:hook_classification"},
    "accepted_retention_device": {"stage:retention_devices", "retention_devices"},
    "structural_pattern": {"story_beats", "stage:scene_story_beats"}, "progression": {"story_beats", "stage:scene_story_beats"},
}
_TYPE_GAP_FIELDS = {
    "hook_curiosity": {"narrative_role"}, "problem_tension": {"narrative_role", "emotional_function"},
    "information_reveal": {"narrative_role", "messaging_role"}, "progression": {"narrative_role"}, "contrast": {"narrative_role"},
    "proof_credibility": {"messaging_role"}, "demonstration": {"messaging_role"}, "emotional_progression": {"emotional_function"},
    "payoff_resolution": {"narrative_role"}, "cta_next_step": {"cta_role", "messaging_role"}, "other": {"narrative_role", "messaging_role"},
}


def _fail(label: str, message: str) -> None:
    raise MechanismReasoningError(f"{label}: {message}")


def _selected_sections(m: Mechanism, sections: dict[int, dict]) -> list[dict]:
    return [sections[n] for n in (m.section_numbers or sorted(sections))]


def _validate_evidence(label: str, m: Mechanism, anatomy: dict, sections: dict[int, dict]) -> None:
    unknown_sections = sorted(set(m.section_numbers) - set(sections))
    if unknown_sections:
        _fail(label, f"cites section number(s) {unknown_sections} that do not exist in the anatomy (valid: {valid_section_numbers(anatomy)}).")
    # SECTION scope: ids must belong to the cited sections. VIDEO scope: ids may come from anywhere in this same
    # anatomy (the listed sections only say where the mechanism is most visible); they must still exist in it.
    section_scoped = m.scope == "sections"
    allowed = valid_evidence_ids(anatomy, m.section_numbers if section_scoped else None)
    for key, ids in m.supporting_evidence_ids.items():
        outside = sorted(set(ids) - set(allowed.get(key, [])))
        if outside:
            where = "the cited sections" if section_scoped else "the anatomy"
            _fail(label, f"cites supporting_evidence_ids['{key}'] {outside} that are not in {where} "
                         f"(allowed: {allowed.get(key, [])}) -- rejecting rather than allowing invented provenance.")


def _validate_features(label: str, m: Mechanism, anatomy: dict, selected: list[dict]) -> set[str]:
    present_in_sections = set().union(*(section_features(s) for s in selected)) if selected else set()
    present_video = video_features(anatomy)
    used = set(m.anatomy_features_used)
    for feature in sorted(used):
        present = present_video if feature in _VIDEO_LEVEL_FEATURES else present_in_sections
        if feature not in present:
            scope = ("at video level" if feature in _VIDEO_LEVEL_FEATURES
                     else "in the cited sections" if m.scope == "sections" else "anywhere in the video")
            _fail(label, f"claims to use anatomy feature {feature!r}, but it is not present {scope}.")
    return used


def _validate_type_gate(label: str, m: Mechanism, anatomy: dict, selected: list[dict], sections: dict[int, dict], used: set[str]) -> None:
    t = m.mechanism_type
    required_any = _TYPE_REQUIRES_ANY.get(t)
    if required_any and not (used & required_any):
        _fail(label, f"a {t!r} mechanism must rest on at least one of {sorted(required_any)} (none of them is among the features used).")
    if t == "hook_curiosity":
        on_hook = bool(m.section_numbers) and any(s.get("is_opening") or s.get("overlaps_hook_window") for s in selected)
        if not (on_hook or used & {"hook_window", "hook_classification"}):
            _fail(label, "a 'hook_curiosity' mechanism must be anchored to the opening/hook (an opening or hook-window section, or the hook window/classification).")
    if t == "pacing_rhythm":
        cuts = (sum(int(_d(s.get("pacing")).get("cut_count") or 0) for s in selected) if m.scope == "sections"
                else int(_d(_d(anatomy.get("video")).get("pacing_profile")).get("cut_count") or 0))
        if cuts < 1:
            _fail(label, "a 'pacing_rhythm' mechanism needs measured cuts in its scope; the anatomy shows none there.")
    if t in _NEEDS_TWO_SECTIONS and len(m.section_numbers) < 2:
        _fail(label, f"a {t!r} mechanism describes how one part relates to another, so it must cite at least two sections.")
    if t == "progression" and len(m.section_numbers) < 2 and not (m.scope == "video" and len(sections) >= 2 and "progression" in used):
        _fail(label, "a 'progression' mechanism must cite at least two sections, or be video-scoped over an anatomy with 2+ sections using the 'progression' feature.")
    field = _INTERPRETIVE_DEPENDENT.get(t)
    if field and m.confidence == "high":
        supplied = any(_d(s.get("interpretive")).get(field) for s in selected) or _d(_d(anatomy.get("video")).get("interpretive")).get(field)
        if not supplied:
            _fail(label, f"a {t!r} mechanism depends on the anatomy's {field!r}, which is null (unknown) -- confidence cannot be 'high'.")


def _d(x) -> dict:
    return x if isinstance(x, dict) else {}


def _validate_text(label: str, m: Mechanism, principle_index: dict, other_index: dict) -> None:
    named = [("statement", m.statement), ("transferable_principle", m.transferable_principle), ("other_label", m.other_label),
             ("other_rationale", m.other_rationale)]
    named += [(f"non_transferable_elements[{i}]", e.description) for i, e in enumerate(m.non_transferable_elements)]
    named += [(f"limitations[{i}]", x) for i, x in enumerate(m.limitations)]
    for name, text in named:
        reject_prohibited_language(text)
    reject_unhedged_intent(f"{label}: statement", m.statement)
    reject_source_reproduction(f"{label}: transferable_principle", m.transferable_principle, principle_index)
    reject_source_specific_references(f"{label}: transferable_principle", m.transferable_principle)
    for name, text in named:
        if name != "transferable_principle":
            reject_source_reproduction(f"{label}: {name}", text, other_index)


def validate_decision(decision: MechanismDecision, anatomy: dict) -> None:
    """Raises MechanismInputError (unusable anatomy) or MechanismReasoningError (any violation). Returns None
    when the decision is safe to persist. `mechanisms == []` is valid."""
    validate_anatomy_input(anatomy)
    if len(decision.mechanisms) > MAX_MECHANISMS:
        raise MechanismReasoningError(f"{len(decision.mechanisms)} mechanisms returned (max {MAX_MECHANISMS}) -- a mechanism is created only when supported, not to enumerate every structure.")
    sections = section_map(anatomy)
    corpus = source_texts(anatomy)
    principle_index = build_source_index(corpus, PRINCIPLE_VERBATIM_LIMIT)
    other_index = build_source_index(corpus, OTHER_VERBATIM_LIMIT)
    for text in decision.overall_limitations:
        reject_prohibited_language(text)
        reject_source_reproduction("overall_limitations", text, other_index)

    seen: set[tuple] = set()
    for n, m in enumerate(decision.mechanisms, 1):
        label = f"mechanism {n} ({m.mechanism_type})"
        _validate_evidence(label, m, anatomy, sections)
        selected = _selected_sections(m, sections)
        # SECTION scope: features must be present in the cited sections. VIDEO scope: anywhere in the same video.
        used = _validate_features(label, m, anatomy, selected if m.scope == "sections" else list(sections.values()))
        _validate_type_gate(label, m, anatomy, selected, sections, used)
        _validate_text(label, m, principle_index, other_index)
        key = (m.mechanism_type, (m.other_label or "").strip().lower(), tuple(sorted(m.section_numbers)), tuple(sorted(used)))
        if key in seen:
            _fail(label, "duplicates another mechanism of the same type with the same scope and features -- multiple mechanisms of one type are allowed only when structurally different.")
        seen.add(key)


def _relevant_gaps(m: Mechanism, anatomy: dict) -> list[dict]:
    fields = set(_TYPE_GAP_FIELDS.get(m.mechanism_type, ()))
    for feature in m.anatomy_features_used:
        fields |= _FEATURE_GAP_FIELDS.get(feature, set())
    out = []
    for g in anatomy.get("gaps") or []:
        g = _d(g)
        if g.get("field") in fields or (g.get("section_number") is not None and g.get("section_number") in m.section_numbers):
            out.append({"field": g.get("field"), "kind": g.get("kind"), "reason": g.get("reason"), "section_number": g.get("section_number")})
    return out


def derive_overall_limitations(anatomy: dict, decision: MechanismDecision) -> list[str]:
    """Deterministic, evidence-derived limitations that always accompany a result, plus the provider's own."""
    out: list[str] = []
    video = _d(anatomy.get("video"))
    status = _d(video.get("retention")).get("analysis_status")
    if status != "accepted_present":
        out.append(f"No accepted retention devices are present in the anatomy (retention analysis status: {status or 'unknown'}); none were assumed.")
    selected = _d(anatomy.get("section_source")).get("selected")
    if selected != "story_beats":
        out.append(f"Sections were built from {selected or 'no usable source'}, not Story Beats, so section boundaries are structural rather than semantic.")
    if not any(_d(s.get("interpretive")).get(f) for s in (anatomy.get("sections") or []) for f in ("narrative_role", "messaging_role", "emotional_function", "cta_role")):
        out.append("The anatomy carries no narrative, messaging, emotional or CTA roles (unknown, not absent); mechanisms resting on them are lower-confidence inferences.")
    if not decision.mechanisms:
        out.append("No mechanism was supported by the anatomy evidence; none were created.")
    out += [x for x in decision.overall_limitations if x not in out]
    return out


def finalize_mechanisms(decision: MechanismDecision, anatomy: dict, provenance: dict) -> list[dict]:
    """Deterministic, storable form of each validated mechanism: stable ids (M01..), sorted references, the
    anatomy's own relevant gaps attached beside the model's limitations, and provenance pinned to the anatomy.
    Call only AFTER validate_decision."""
    pin = anatomy_pin(anatomy)
    out = []
    for n, m in enumerate(decision.mechanisms, 1):
        out.append({
            "mechanism_id": f"M{n:02d}",
            "mechanism_type": m.mechanism_type,
            "other_label": m.other_label, "other_rationale": m.other_rationale,
            "statement": m.statement,
            "scope": m.scope,
            "section_numbers": sorted(m.section_numbers),
            "supporting_evidence_ids": {k: sorted(set(v)) for k, v in sorted(m.supporting_evidence_ids.items()) if v},
            "anatomy_features_used": sorted(set(m.anatomy_features_used)),
            "transferable_principle": m.transferable_principle,
            "non_transferable_elements": [{"kind": e.kind, "description": e.description} for e in m.non_transferable_elements],
            "confidence": m.confidence,
            "certainty": m.certainty,
            "limitations": {"model_stated": list(m.limitations), "anatomy_gaps": _relevant_gaps(m, anatomy)},
            "provenance": {**pin, "taxonomy_version": TAXONOMY_VERSION, **provenance},
        })
    return out
