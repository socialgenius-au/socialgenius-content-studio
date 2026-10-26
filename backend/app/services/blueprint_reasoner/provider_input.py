"""C4 -- the bounded view a provider receives.

DELIBERATELY EXCLUDES all source wording: no transcript, no speech text, no on-screen text, and no C3 mechanism
STATEMENTS (which describe the reference's subject matter). The provider gets only:
  * the NewContentIntent (with mandatory points given ids),
  * the reference's structural SKELETON (section numbers, timing, which kinds of evidence each section has, pacing, hook
    location),
  * each C3 mechanism's TRANSFERABLE principle, type, scope and confidence -- and its NON-TRANSFERABLE elements as an
    explicit "do not carry over" list,
  * the reference gaps, and the ids it may cite.
So a blueprint cannot lift the reference's wording or story from its input, and cannot reinterpret raw evidence.
"""
from app.services.blueprint_reasoner.validation import BlueprintContext
from app.services.mechanism_reasoner.anatomy_input import section_features, valid_section_numbers

__all__ = ["build_reasoner_input"]


def _t(x):
    return round(x, 2) if isinstance(x, (int, float)) and not isinstance(x, bool) else x


def build_reasoner_input(ctx: BlueprintContext) -> dict:
    anatomy = ctx.anatomy
    video = anatomy.get("video") or {}
    pacing = video.get("pacing_profile") or {}
    retention = video.get("retention") or {}
    sections = []
    for s in anatomy.get("sections") or []:
        item = {"n": s["number"], "start": _t(s.get("start_time")), "end": _t(s.get("end_time")), "duration": _t(s.get("duration")),
                "evidence_kinds": sorted(section_features(s)), "shots": (s.get("pacing") or {}).get("shot_count"),
                "cuts": (s.get("pacing") or {}).get("cut_count")}
        if s.get("is_opening"):
            item["opening"] = True
        if s.get("overlaps_hook_window"):
            item["hook"] = True
        sections.append(item)
    intent = dict(ctx.intent)
    intent["mandatory_points"] = [{"id": k, "text": v} for k, v in ctx.mandatory_points.items()]
    return {
        "new_content_intent": intent,
        "reference_skeleton": {
            "duration": _t(video.get("duration")), "section_count": video.get("section_count"), "sections": sections,
            "hook_sections": (video.get("hook") or {}).get("hook_section_numbers"),
            "pacing": {"shots": pacing.get("shot_count"), "cuts": pacing.get("cut_count")},
            "retention": {"accepted_devices": retention.get("accepted_count"), "status": retention.get("analysis_status")},
        },
        "mechanisms": [{
            "mechanism_id": m["mechanism_id"], "type": m.get("mechanism_type"), "scope": m.get("scope"),
            "reference_sections": m.get("section_numbers"), "confidence": m.get("confidence"),
            "transferable_principle": m.get("transferable_principle"),
            "known_limitations": (m.get("limitations") or {}).get("model_stated") or [],
            "do_not_carry_over": [{"kind": e.get("kind"), "description": e.get("description")} for e in (m.get("non_transferable_elements") or [])],
        } for m in ctx.mechanisms],
        "reference_gaps": [{"field": g.get("field"), "kind": g.get("kind")} for g in (anatomy.get("gaps") or [])],
        "blocked_source_terms": ctx.guard.blocked_terms,
        "valid": {
            "anatomy_section_numbers": valid_section_numbers(anatomy),
            "mechanism_ids": [m["mechanism_id"] for m in ctx.mechanisms],
            "mandatory_point_ids": list(ctx.mandatory_points),
        },
    }
