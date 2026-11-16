"""CREATIVE INTELLIGENCE: the reusable record of how a reference video works creatively, assembled from what the Deconstructor has already established (anatomy, Creative Read, reconciliation, hook reasoning,
mechanisms). Deterministic and read-only: no AI call, nothing stored (it is recomputed from stored results, so it can never disagree with them).

What it adds to the bare mechanism:
  * its PURPOSE, and the typed evidence behind it (visual / audio / text / editing) with section and timestamp references and a reliability flag on each item,
  * the CONDITIONS under which its principle may or may not apply, and how to ADAPT it (rule table, labelled as such; see mechanism_guidance.py),
  * the line between REUSING the mechanism and COPYING the reference: the transferable principle versus the do-not-copy list,
  * confidence and limitations, and every contradiction between readings.
Three kinds of statement are kept apart: observed (stored evidence, timings), ai_interpretation (what an AI concluded) and unsupported (anything about audiences, never claimed).
The planner is given `blueprint_guidance` only: structure, conditions and reliability, never the reference's wording or description of its subject.
"""
from __future__ import annotations

from app.services.hook_profile import EVIDENCE_CLASSES, UNSUPPORTED, hook_structure_for_blueprint
from app.services.mechanism_guidance import evidence_channels, guidance_for, position_label

SCHEMA = "creative-intelligence-v1"
REUSE_POLICY = {
    "reuse": "The mechanism: the transferable principle, the conditions under which it applies, and how it is adapted to a different business, audience, product or objective.",
    "never_copy": "The reference's content: its wording, brand, people, products, setting, visuals, audio and story. Each mechanism lists what must not be carried over.",
}
_ID_TO_CHANNEL = {"speech_segments": "audio", "silence_intervals": "audio", "text_elements": "text", "shots": "visual", "visual_objects": "visual", "creative_findings": "visual", "scenes": "visual",
                  "story_beats": "visual", "transition_evidence": "editing", "pacing_phases": "editing"}


def _index(anatomy: dict) -> dict:
    """id -> {section, start, end, ...} for every evidence id the anatomy exposes, so each cited id can be placed in time."""
    where: dict[tuple[str, int], dict] = {}
    for s in anatomy.get("sections") or []:
        base = {"section": s["number"], "start_time": s.get("start_time"), "end_time": s.get("end_time")}
        for kind, ids in (s.get("evidence_ids") or {}).items():
            for i in ids or []:
                where.setdefault((kind, i), dict(base))
        for x in s.get("speech") or []:
            where[("speech_segments", x.get("id"))] = {**base, "start_time": x.get("start_time"), "end_time": x.get("end_time")}
        for x in s.get("on_screen_text") or []:
            where[("text_elements", x.get("id"))] = {**base, "start_time": x.get("start_time"), "end_time": x.get("end_time")}
        for f in (s.get("creative") or {}).get("findings") or []:
            where[("creative_findings", f.get("id"))] = {**base, "start_time": f.get("start"), "end_time": f.get("end"), "kind": f.get("kind"), "confidence": f.get("confidence")}
    return where


def mechanism_entry(m: dict, anatomy: dict) -> dict:
    video = anatomy.get("video") or {}
    rec = video.get("reconciliation") or {}
    bad_speech, bad_text = set(rec.get("unverified_speech_ids") or []), set(rec.get("low_confidence_text_ids") or [])
    where = _index(anatomy)
    sections = {s["number"]: s for s in anatomy.get("sections") or []}
    nums = m.get("section_numbers") or ([] if m.get("scope") != "video" else sorted(sections))
    span = [(sections[n]["start_time"], sections[n]["end_time"]) for n in nums if n in sections]
    evidence: dict[str, list[dict]] = {"visual": [], "audio": [], "text": [], "editing": []}
    for kind, ids in (m.get("supporting_evidence_ids") or {}).items():
        ch = _ID_TO_CHANNEL.get(kind)
        if not ch:
            continue
        for i in ids or []:
            loc = where.get((kind, i), {})
            reliable = None
            if kind == "speech_segments":
                reliable = i not in bad_speech
            elif kind == "text_elements":
                reliable = i not in bad_text
            evidence[ch].append({"kind": kind, "id": i, "section": loc.get("section"), "start_time": loc.get("start_time"), "end_time": loc.get("end_time"), "reliable": reliable,
                                 **({"finding_kind": loc.get("kind"), "finding_confidence": loc.get("confidence")} if kind == "creative_findings" else {})})
    channels = evidence_channels(m.get("supporting_evidence_ids"))
    unreliable = {ch for ch, items in evidence.items() if any(x["reliable"] is False for x in items)}
    pos = position_label(min((a for a, _ in span), default=None), max((b for _, b in span), default=None), video.get("duration"))
    g = guidance_for(m.get("mechanism_type") or "other", channels=channels, unreliable={"audio" if "audio" in unreliable else "", "text" if "text" in unreliable else ""} - {""}, position=pos)
    lim = m.get("limitations") or {}
    return {
        "mechanism_id": m.get("mechanism_id"), "type": m.get("mechanism_type"), "other_label": m.get("other_label"), "purpose": g["purpose"], "scope": m.get("scope"),
        "sections": [{"number": n, "start_time": sections[n]["start_time"], "end_time": sections[n]["end_time"]} for n in nums if n in sections], "position": pos,
        "evidence": evidence, "evidence_channels": channels, "unreliable_channels": sorted(unreliable),
        "evidence_classes": {
            "observed": [f"{ch}: {n} stored item(s)" for ch, n in channels.items() if n],
            "ai_interpretation": ["The mechanism itself (type and statement) and any visual findings it cites are AI interpretations of the evidence."],
            "unsupported": ["Whether this mechanism affected any audience: not measured, not claimed."],
        },
        "reference_description": {"text": m.get("statement"), "contains_reference_content": True, "certainty": "INFERRED", "note": "Describes the reference itself. Shown for review; never given to the planner."},
        "confidence": m.get("confidence"), "limitations": list(lim.get("model_stated") or []) + [g_["reason"] for g_ in (lim.get("anatomy_gaps") or []) if g_.get("reason")],
        "transferable_principle": m.get("transferable_principle"),
        "conditions": {"applies_when": g["applies_when"], "avoid_when": g["avoid_when"], "source": g["source"]},
        "adaptation_guidance": g["adaptation_guidance"] + g["evidence_notes"],
        "reuse_vs_copy": {"reuse": m.get("transferable_principle"), "never_copy": [{"kind": e.get("kind"), "description": e.get("description")} for e in (m.get("non_transferable_elements") or [])]},
    }


def build_creative_intelligence(anatomy: dict, mechanisms: dict | None) -> dict:
    video = anatomy.get("video") or {}
    mech = mechanisms or {}
    status = mech.get("status") or "not_run"
    entries = [mechanism_entry(m, anatomy) for m in (mech.get("mechanisms") or [])] if status in ("current", "stale") else []
    rec = video.get("reconciliation") or {}
    contradictions_by_key = {}
    sources = [{"topic": i.get("topic"), "status": i.get("status"), "sections": i.get("sections"), "note": i.get("note"), "authority": i.get("authority")} for i in rec.get("items") or [] if i.get("status") != "established"]
    hp = video.get("hook_profile")
    sources += [{"topic": c["topic"], "status": c["status"], "sections": [1], "note": c["note"], "authority": "hook profile"} for c in (hp or {}).get("contradictions") or []]
    for item in sources:
        key = (item.get("topic"), item.get("status"), item.get("note"), item.get("authority"))
        if key not in contradictions_by_key:
            contradictions_by_key[key] = {**item, "sections": list(item.get("sections") or [])}
        else:
            existing = contradictions_by_key[key]["sections"]
            for section in item.get("sections") or []:
                if section not in existing:
                    existing.append(section)
    contradictions = list(contradictions_by_key.values())
    limitations = list(mech.get("overall_limitations") or []) + list((video.get("structure") or {}).get("uncertainty") or [])
    prov = anatomy.get("provenance") or {}
    return {
        "schema": SCHEMA, "status": {"current": "ready", "stale": "mechanisms_stale", "not_run": "mechanisms_not_run"}.get(status, "mechanisms_unknown"),
        "reference": {"reference_video_id": prov.get("reference_video_id"), "video_analysis_id": prov.get("video_analysis_id"), "duration": video.get("duration")},
        "pins": {"anatomy_fingerprint": prov.get("fingerprint"), "mechanism_attempt_id": (mech.get("provenance") or {}).get("reasoning_attempt_id"), "mechanisms_status": status},
        "hook": hp, "narrative": video.get("narrative"), "structure": video.get("structure"), "mechanisms": entries, "contradictions": contradictions,
        "audience_effects": {"status": "not_established", "statement": rec.get("audience_effects") or "No viewer data exists; every reading describes apparent design only, never what an audience did or will do."},
        "evidence_classes": EVIDENCE_CLASSES, "unsupported": list(UNSUPPORTED), "reuse_policy": REUSE_POLICY, "limitations": limitations,
        "certainty": "INFERRED",
    }


def blueprint_guidance(mechanisms: list[dict], anatomy: dict) -> dict:
    """What the PLANNER receives beyond the bare principle: per-mechanism conditions/adaptation/strength and the opening's structure. Structure only, no reference wording or subject description."""
    out = {}
    for m in mechanisms:
        e = mechanism_entry(m, anatomy)
        out[m["mechanism_id"]] = {"purpose": e["purpose"], "applies_when": e["conditions"]["applies_when"], "avoid_when": e["conditions"]["avoid_when"], "adaptation_guidance": e["adaptation_guidance"],
                                  "evidence_channels": e["evidence_channels"], "unreliable_channels": e["unreliable_channels"], "position_in_reference": e["position"]}
    return {"mechanisms": out, "reference_hook": hook_structure_for_blueprint((anatomy.get("video") or {}).get("hook_profile"))}


async def get_creative_intelligence(db, user, reference_video_id: int, *, video_analysis_id: int | None = None) -> dict:
    from app.services.content_anatomy_svc import get_content_anatomy
    from app.services.transferable_mechanism_svc import get_effective_mechanisms
    anatomy = await get_content_anatomy(db, user, reference_video_id, video_analysis_id=video_analysis_id)
    mech = await get_effective_mechanisms(db, user, reference_video_id, video_analysis_id=anatomy["provenance"]["video_analysis_id"])
    return build_creative_intelligence(anatomy, mech)
