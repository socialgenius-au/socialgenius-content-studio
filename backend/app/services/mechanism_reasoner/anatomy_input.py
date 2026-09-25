"""C3 — the LOCKED input contract, made executable.

C3 consumes ONLY the C2 Content Anatomy response (a dict shaped like app.schemas.content_anatomy.
ContentAnatomyResponse), pinned by (reference_video_id, video_analysis_id, provenance.fingerprint). This
module is the one place that reads that shape: it checks the input is usable, exposes what may legitimately
be cited (section numbers, evidence ids, features), and builds the bounded view a provider sees. Nothing here
touches the database or any raw Stage 3-11 evidence.
"""
import json

from app.services.mechanism_reasoner.contract import EVIDENCE_ID_KEYS

__all__ = [
    "MechanismInputError", "validate_anatomy_input", "section_map", "valid_section_numbers", "valid_evidence_ids",
    "section_features", "video_features", "source_texts", "build_reasoner_input", "serialize_reasoner_input", "anatomy_pin",
]


class MechanismInputError(Exception):
    """The anatomy cannot be used as C3 input (not a usable C2 response, or it has zero sections). Mapped to
    HTTP 422 -- an input problem, distinct from a reasoning failure."""


def _d(x) -> dict:
    return x if isinstance(x, dict) else {}


def _l(x) -> list:
    return x if isinstance(x, list) else []


def validate_anatomy_input(anatomy) -> None:
    """Raises MechanismInputError unless `anatomy` is a pinned, non-empty C2 response."""
    if not isinstance(anatomy, dict):
        raise MechanismInputError("Content Anatomy input must be an object (the C2 /anatomy response).")
    prov = _d(anatomy.get("provenance"))
    fingerprint = prov.get("fingerprint")
    if not isinstance(fingerprint, str) or not fingerprint:
        raise MechanismInputError("Content Anatomy input has no provenance.fingerprint -- C3 pins its input by fingerprint.")
    if not isinstance(prov.get("reference_video_id"), int) or not isinstance(prov.get("video_analysis_id"), int):
        raise MechanismInputError("Content Anatomy input is not pinned to a reference_video_id and video_analysis_id.")
    sections = _l(anatomy.get("sections"))
    if not sections:
        raise MechanismInputError(
            "The Content Anatomy has zero sections (no usable Story Beats, shots or pacing phases), so there is nothing "
            "structural to derive mechanisms from. Complete shot detection (deconstruct-all) first."
        )
    if not all(isinstance(s, dict) and isinstance(s.get("number"), int) for s in sections):
        raise MechanismInputError("Content Anatomy sections are malformed (each needs an integer `number`).")


def anatomy_pin(anatomy: dict) -> dict:
    prov = _d(anatomy.get("provenance"))
    return {
        "reference_video_id": prov.get("reference_video_id"), "video_analysis_id": prov.get("video_analysis_id"),
        "anatomy_fingerprint": prov.get("fingerprint"), "anatomy_version": prov.get("anatomy_version"),
    }


def section_map(anatomy: dict) -> dict[int, dict]:
    return {s["number"]: s for s in _l(anatomy.get("sections")) if isinstance(s, dict) and isinstance(s.get("number"), int)}


def valid_section_numbers(anatomy: dict) -> list[int]:
    return sorted(section_map(anatomy))


def _section_evidence(section: dict) -> dict[str, list[int]]:
    ids = _d(section.get("evidence_ids"))
    return {k: [i for i in _l(ids.get(k)) if isinstance(i, int)] for k in EVIDENCE_ID_KEYS}


def valid_evidence_ids(anatomy: dict, section_numbers: list[int] | None = None) -> dict[str, list[int]]:
    """Every evidence id the anatomy itself exposes, by category -- across all sections, or only the given
    ones. The ONLY ids a mechanism may cite."""
    out: dict[str, set[int]] = {k: set() for k in EVIDENCE_ID_KEYS}
    for number, section in section_map(anatomy).items():
        if section_numbers is not None and number not in section_numbers:
            continue
        for key, ids in _section_evidence(section).items():
            out[key].update(ids)
    return {k: sorted(v) for k, v in out.items()}


def section_features(section: dict) -> set[str]:
    """Section-level anatomy features actually PRESENT in this section (checked against the section's own
    content, not against the model's say-so)."""
    visual, audio, pacing = _d(section.get("visual")), _d(section.get("audio")), _d(section.get("pacing"))
    present = set()
    if _l(section.get("speech")):
        present |= {"speech", "transcript"}
    if section.get("transcript_excerpt"):
        present.add("transcript")
    if _l(section.get("on_screen_text")):
        present.add("on_screen_text")
    if _l(visual.get("objects")):
        present.add("visual_objects")
    if _l(audio.get("silence_intervals")):
        present.add("silence")
    if (pacing.get("cut_count") or 0) > 0:
        present.add("cuts")
    if (pacing.get("shot_count") or 0) > 0:
        present.add("pacing")
    if _l(visual.get("transition_evidence_ids")):
        present.add("transitions")
    if _l(visual.get("motion_evidence_shot_ids")):
        present.add("motion")
    if section.get("overlaps_hook_window"):
        present.add("hook_window")
    if _l(section.get("retention_devices")):
        present.add("accepted_retention_device")
    return present


def video_features(anatomy: dict) -> set[str]:
    video = _d(anatomy.get("video"))
    present = set()
    if _d(_d(video.get("hook")).get("classification")):
        present.add("hook_classification")
    if _d(video.get("structural_pattern")).get("summary"):
        present.add("structural_pattern")
    if _l(video.get("progression")):
        present.add("progression")
    if _d(video.get("pacing_profile")).get("shot_count"):
        present.add("pacing_profile")
    return present


def source_texts(anatomy: dict) -> list[str]:
    """Every piece of source wording the anatomy carries -- the corpus the verbatim-reproduction guard checks
    against."""
    texts: list[str] = []
    for section in _l(anatomy.get("sections")):
        section = _d(section)
        if section.get("transcript_excerpt"):
            texts.append(str(section["transcript_excerpt"]))
        texts += [str(s.get("text")) for s in _l(section.get("speech")) if _d(s).get("text")]
        texts += [str(t.get("text")) for t in _l(section.get("on_screen_text")) if _d(t).get("text")]
    return texts


def _t(x):
    """Times are rounded to 2 decimals in the provider view (sub-centisecond precision carries no meaning for
    structural reasoning)."""
    return round(x, 2) if isinstance(x, (int, float)) and not isinstance(x, bool) else x


def _compact_section(section: dict) -> dict:
    """The provider-facing form of ONE section. Drops only what is constant, derivable, or duplicated elsewhere in
    the same payload; keeps every fact and every citable id. ABSENT means empty / false / not established -- the
    system prompt says so, and `gaps` states what could not be established."""
    out: dict = {"n": section["number"], "start": _t(section.get("start_time")), "end": _t(section.get("end_time"))}
    if section.get("is_opening"):
        out["opening"] = True
    if section.get("overlaps_hook_window"):
        out["hook"] = True
    if section.get("transcript_excerpt"):
        out["transcript"] = section["transcript_excerpt"]
        if section.get("transcript_truncated"):
            out["transcript_truncated"] = True
    speech = [{"id": s.get("id"), "start": _t(s.get("start_time")), "end": _t(s.get("end_time")), "text": s.get("text"),
               **({"lang": s["language"]} if s.get("language") else {})} for s in _l(section.get("speech")) if isinstance(s, dict)]
    if speech:
        out["speech"] = speech
    text = [{"id": t.get("id"), "text": t.get("text"), "start": _t(t.get("start_time")), "end": _t(t.get("end_time")),
             **({"ocr_conf": round(t["confidence_score"], 2)} if isinstance(t.get("confidence_score"), (int, float)) else {}),
             **({"recurring": t["recurring_element_id"]} if t.get("recurring_element_id") is not None else {})}
            for t in _l(section.get("on_screen_text")) if isinstance(t, dict)]
    if text:
        out["on_screen_text"] = text
    visual, audio, pacing = _d(section.get("visual")), _d(section.get("audio")), _d(section.get("pacing"))
    objects = [{"label": o.get("label"), "n": o.get("count")} for o in _l(visual.get("objects")) if isinstance(o, dict)]
    if objects:
        out["objects"] = objects
    if visual.get("persistent_visual_element_count"):
        out["persistent_visual_elements"] = visual["persistent_visual_element_count"]
    if _l(visual.get("motion_evidence_shot_ids")):
        out["motion_evidence"] = True
    if _l(visual.get("transition_evidence_ids")):
        out["transition_evidence"] = True
    silences = [{"id": s.get("id"), "start": _t(s.get("start_time")), "end": _t(s.get("end_time"))}
                for s in _l(audio.get("silence_intervals")) if isinstance(s, dict)]
    if silences:
        out["silences"] = silences
    out["pacing"] = {"shots": pacing.get("shot_count"), "cuts": pacing.get("cut_count"),
                     "avg_shot_s": _t(pacing.get("average_shot_exposure_seconds"))}
    devices = [{"id": d.get("id"), "type": d.get("device_type"), "function": d.get("probable_attention_function"),
                "confidence": d.get("confidence"), "start": _t(d.get("start_time")), "end": _t(d.get("end_time"))}
               for d in _l(section.get("retention_devices")) if isinstance(d, dict)]
    if devices:
        out["accepted_retention_devices"] = devices
    rejected = [{"attempt": r.get("attempt_id"), "type": r.get("device_type"), "status": r.get("status")}
                for r in _l(section.get("rejected_candidates")) if isinstance(r, dict)]
    if rejected:
        out["rejected_retention_candidates"] = rejected  # references only -- never mechanisms
    interp = {k: v for k, v in _d(section.get("interpretive")).items() if k != "status" and v}
    if interp:
        out["interpretive"] = interp
    out["usable_features"] = sorted(section_features(section))  # exactly the vocabulary the validator checks
    out["evidence_ids"] = {k: v for k, v in _d(section.get("evidence_ids")).items() if v}
    return out


def build_reasoner_input(anatomy: dict) -> dict:
    """The COMPACT, provider-facing view of the C2 anatomy. The canonical anatomy is never modified and validation
    always runs against it, not against this view.

    Removed as redundant (nothing citable or factual is lost): per-section constants (`certainty`, `source_partition`
    -- recorded once as `section_source`), values derivable from others (`duration`), id lists duplicated inside
    `evidence_ids` (`source_ref`, `shot_refs`, `story_beat_refs`, `scene_refs`, `pacing_phase_ids`, keyframe /
    motion / transition id lists), all empty containers and false flags, the per-section all-null `interpretive`
    block, the per-candidate reasoning excerpt on rejected retention candidates (status and type remain), the
    video-level `progression` list (it is exactly the ordered `sections` with their `usable_features`) and
    sub-centisecond time precision. ADDED: `usable_features` per section (and at video level) -- the exact feature
    names the validator will accept -- so the model cannot cite a feature the anatomy does not show."""
    video = _d(anatomy.get("video"))
    hook = _d(video.get("hook"))
    retention = _d(video.get("retention"))
    profile = _d(video.get("pacing_profile"))
    pattern = _d(video.get("structural_pattern"))
    coverage = _d(anatomy.get("evidence_coverage"))
    return {
        "anatomy_pin": anatomy_pin(anatomy),
        "section_source": _d(anatomy.get("section_source")).get("selected"),
        "video": {
            "duration": _t(video.get("duration")), "section_count": video.get("section_count"),
            "hook": {"window": hook.get("window"), "hook_sections": hook.get("hook_section_numbers"),
                     "classification": hook.get("classification")},
            "pacing_profile": profile,
            "structural_pattern": {k: v for k, v in pattern.items() if k in ("summary", "section_source", "shot_count", "cut_count")},
            "retention": {k: v for k, v in retention.items() if k in ("analysis_status", "accepted_count", "accepted_by_type", "examined_count", "rejected_count")},
            "usable_features": sorted(video_features(anatomy)),
            "interpretive": {k: v for k, v in _d(video.get("interpretive")).items() if k != "status" and v} or None,
        },
        "sections": [_compact_section(s) for s in _l(anatomy.get("sections")) if isinstance(s, dict) and isinstance(s.get("number"), int)],
        "gaps": [{"field": g.get("field"), "kind": g.get("kind"), "reason": g.get("reason"),
                  **({"section": g["section_number"]} if g.get("section_number") is not None else {})}
                 for g in _l(anatomy.get("gaps")) if isinstance(g, dict)],
        "evidence_coverage": {"stages_not_done": coverage.get("stages_not_done"), "counts": coverage.get("counts")},
        "valid_section_numbers": valid_section_numbers(anatomy),
        "valid_evidence_ids": {k: v for k, v in valid_evidence_ids(anatomy).items() if v},
    }


def serialize_reasoner_input(reasoner_input: dict) -> str:
    """Compact JSON (no indentation, no spaces) -- the exact text sent to the provider."""
    return json.dumps(reasoner_input, ensure_ascii=False, separators=(",", ":"), default=str)
