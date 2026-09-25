"""C3 — the LOCKED input contract, made executable.

C3 consumes ONLY the C2 Content Anatomy response (a dict shaped like app.schemas.content_anatomy.
ContentAnatomyResponse), pinned by (reference_video_id, video_analysis_id, provenance.fingerprint). This
module is the one place that reads that shape: it checks the input is usable, exposes what may legitimately
be cited (section numbers, evidence ids, features), and builds the bounded view a provider sees. Nothing here
touches the database or any raw Stage 3-11 evidence.
"""
from app.services.mechanism_reasoner.contract import ANATOMY_FEATURE_KEYS, EVIDENCE_ID_KEYS

__all__ = [
    "MechanismInputError", "validate_anatomy_input", "section_map", "valid_section_numbers", "valid_evidence_ids",
    "section_features", "video_features", "source_texts", "build_reasoner_input", "anatomy_pin",
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


def build_reasoner_input(anatomy: dict) -> dict:
    """The bounded view a provider receives: the pinned anatomy plus the explicit lists of what may be cited.
    Deterministic; carries nothing that is not already in the C2 response."""
    return {
        "anatomy_pin": anatomy_pin(anatomy),
        "video": anatomy.get("video"),
        "section_source": _d(anatomy.get("section_source")).get("selected"),
        "sections": anatomy.get("sections"),
        "gaps": anatomy.get("gaps"),
        "evidence_coverage": anatomy.get("evidence_coverage"),
        "valid_section_numbers": valid_section_numbers(anatomy),
        "valid_evidence_ids": valid_evidence_ids(anatomy),
        "valid_feature_keys": sorted(ANATOMY_FEATURE_KEYS),
    }
