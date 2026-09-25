"""Video Deconstructor — C2: CONTENT ANATOMY V1.

C1 answers "what evidence did we find?". Content Anatomy answers "how is this piece actually
constructed?": an ordered structural map of WHAT happens, WHEN, what EVIDENCE supports it, and how the
piece PROGRESSES. It deliberately does NOT answer "why would another creator copy this" -- that is C3
(Transferable Mechanism), which must consume THIS object instead of re-reading raw evidence.

DETERMINISTIC AND STATELESS. `build_content_anatomy` is a pure function of the C1 aggregate
(`deconstruction/full`): no database access, no LLM call, no clock, no randomness -- identical input gives
byte-identical output. Nothing is persisted in V1: the aggregate is itself a pure read of persisted
evidence, so recomputing is always current, whereas a stored anatomy would go stale whenever evidence
changes (and Stage 10/11 rows are delete-then-replace, so their ids move). `provenance.fingerprint` (a
sha256 over the anatomy content and every evidence id it cites) is how C3/C4 pin exactly which anatomy
they consumed, without needing a table. If a later stage genuinely needs a durable anatomy, it can store
the object plus its fingerprint; nothing here blocks that.

SECTION SKELETON (recorded in `section_source`, never silent). Preferred order:
  1. Story Beats -- only when there are >= 2. A single whole-video beat (`no_accepted_boundary`) carries
     no partition information, so it is reported as unusable rather than producing one giant "section".
  2. Evidence shots.
  3. Stage 11.1 pacing phases (story_beat partition preferred, then scene).
Missing Story Beats (AI reasoner not configured, Stage 10 skipped) is normal and never an error.

NOTHING INTERPRETIVE IS INVENTED. `narrative_role` is passed through only when every overlapping Scene
carries the same non-null role (upstream currently never populates it); `messaging_role`,
`emotional_function` and `cta_role` have no upstream source and are always null. Each absence is listed in
`gaps` with its reason. Retention devices in a section are ONLY accepted ones; rejected/legacy candidates
appear separately as references (`rejected_candidates`) and are never presented as mechanisms. Recurring
on-screen text (captions/watermarks) is flagged with a pointer to its Stage 6 recurring element -- C2 does
not decide whether such text is meaningful, and it never promotes text into a device.
"""
from __future__ import annotations

import hashlib
import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.deconstruction_aggregate_svc import build_full_deconstruction

ANATOMY_VERSION = "c2-v1"
TRANSCRIPT_EXCERPT_MAX_CHARS = 400
REASONING_EXCERPT_CHARS = 160
_DONE = {"complete", "already_complete"}
LEGACY_RETENTION_SCHEMA = "legacy_pre_acceptance_gate"
# A derived stage the orchestrator never recorded (`not_run`) whose results demonstrably exist -- e.g. a video
# processed manually before C1 -- is not a gap. Maps stage key -> the aggregate `availability` flag proving it.
_DATA_PRESENT_FLAG = {"scene_story_beats": "scenes", "editing_rhythm": "editing_rhythm", "hook_window": "hook_window",
                      "hook_classification": "hook_classification", "retention_devices": "retention_examined"}


class ContentAnatomyError(Exception):
    """Base class for Content Anatomy refusals."""


class ContentAnatomyNotReady(ContentAnatomyError):
    """The minimum evidence (technical probe + shot/cut detection) has not completed yet."""


class ContentAnatomyInputError(ContentAnatomyError):
    """The aggregate is not a usable input (not a dict, or no positive duration)."""


# ── tolerant normalizers: an incomplete/malformed aggregate degrades to gaps, never a crash ─────────────

def _d(x) -> dict:
    if x is None:
        return {}
    if hasattr(x, "model_dump"):
        return x.model_dump(mode="python")
    return x if isinstance(x, dict) else {}


def _l(x) -> list[dict]:
    if not isinstance(x, (list, tuple)):
        return []
    return [_d(i) for i in x if isinstance(_d(i), dict) and _d(i)]


def _num(x) -> float | None:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def _r(x: float | None, places: int = 6) -> float | None:
    return None if x is None else round(x, places)


def _timed(rows: list[dict], kind: str, dropped: dict) -> list[dict]:
    """Keeps only rows with numeric start/end (start_time/end_time); counts the rest for a gap."""
    out = []
    for row in rows:
        s, e = _num(row.get("start_time")), _num(row.get("end_time"))
        if s is None or e is None:
            dropped[kind] = dropped.get(kind, 0) + 1
            continue
        out.append({**row, "start_time": s, "end_time": e})
    return out


def _overlap_seconds(a0: float, a1: float, s: float, e: float) -> float:
    return max(0.0, min(a1, e) - max(a0, s))


def _within(a0: float, a1: float, s: float, e: float, last: bool) -> bool:
    """Half-open [s, e) membership. Zero-length events (a text appearing, a candidate instant) belong to
    the section containing that instant; the very last section also owns the instant at its own end."""
    if a1 <= a0:
        return s <= a0 < e or (last and a0 == e)
    return a0 < e and a1 > s


# ── section skeleton ────────────────────────────────────────────────────────────────────────

def _unique_beats(structure: dict) -> list[dict]:
    seen, beats = set(), []
    for scene in _l(structure.get("scenes")):
        for beat in _l(scene.get("story_beats")):
            bid = beat.get("id")
            if bid in seen or _num(beat.get("start_time")) is None or _num(beat.get("end_time")) is None:
                continue
            seen.add(bid)
            beats.append(beat)
    return sorted(beats, key=lambda b: (b["start_time"], b.get("id") or 0))


def _story_beat_absence_reason(stage_status: dict, beats: list[dict]) -> str:
    if len(beats) == 1:
        return "only a single whole-video Story Beat exists (no accepted boundary), which carries no partition information"
    status = stage_status.get("scene_story_beats")
    if status == "skipped":
        return "Stage 10 was skipped: no AI reasoner is configured, so no Story Beats were built"
    if status in (None, "not_run"):
        return "Stage 10 (Scenes and Story Beats) has not been run for this analysis"
    if status in _DONE:
        return "Stage 10 ran but produced no Story Beats"
    return f"Stage 10 is {status}"


def _choose_skeleton(agg: dict, duration: float, stage_status: dict) -> tuple[list[dict], dict]:
    considered: list[dict] = []
    dropped_unused: dict = {}

    beats = _unique_beats(_d(agg.get("structure")))
    beats_usable = len(beats) >= 2
    considered.append({
        "source": "story_beats", "available": bool(beats), "usable": beats_usable, "count": len(beats),
        "note": None if beats_usable else _story_beat_absence_reason(stage_status, beats),
    })

    shots = sorted(_timed(_l(_d(agg.get("evidence")).get("shots")), "shots", dropped_unused),
                   key=lambda s: (s["start_time"], s.get("order") or 0))
    considered.append({
        "source": "shots", "available": bool(shots), "usable": bool(shots), "count": len(shots),
        "note": None if shots else "no shots in the evidence (shot/cut detection has not produced any)",
    })

    phases = _timed(_l(_d(agg.get("editing_rhythm")).get("pacing_phases")), "pacing_phases", dropped_unused)
    by_partition: dict[str, list[dict]] = {}
    for p in phases:
        by_partition.setdefault(str(_d(p.get("details")).get("partition_type")), []).append(p)
    chosen_partition = next((k for k in ("story_beat", "scene") if by_partition.get(k)), next(iter(by_partition), None))
    phase_rows = sorted(by_partition.get(chosen_partition, []), key=lambda p: (p["start_time"], p.get("id") or 0))
    considered.append({
        "source": "pacing_phases", "available": bool(phase_rows), "usable": bool(phase_rows), "count": len(phase_rows),
        "note": None if phase_rows else "no Stage 11.1 pacing phases exist", "partition_type": chosen_partition,
    })

    def rows(items, partition, ref):
        out = []
        for it in items:
            s, e = max(0.0, it["start_time"]), min(duration, it["end_time"])
            if e > s:
                out.append({"start_time": s, "end_time": e, "source_partition": partition, "source_ref": ref(it)})
        return out

    if beats_usable:
        selected, skeleton = "story_beats", rows(beats, "story_beat", lambda b: {"story_beat_id": b.get("id"), "boundary_status": b.get("boundary_status")})
    elif shots:
        selected, skeleton = "shots", rows(shots, "shot", lambda s: {"shot_id": s.get("id"), "order": s.get("order")})
    elif phase_rows:
        selected, skeleton = "pacing_phases", rows(phase_rows, "pacing_phase", lambda p: {"pacing_phase_id": p.get("id"), "partition_type": chosen_partition})
    else:
        selected, skeleton = None, []

    reason = {
        "story_beats": "Story Beats available (>= 2): used as the section skeleton",
        "shots": "Story Beats unusable (" + (considered[0]["note"] or "") + "); fell back to evidence shots",
        "pacing_phases": "Story Beats and shots unavailable; fell back to Stage 11.1 pacing phases",
        None: "no Story Beats, shots or pacing phases are available: no section skeleton could be built",
    }[selected]
    return skeleton, {"selected": selected, "reason": reason, "considered": considered}


# ── the pure builder ────────────────────────────────────────────────────────────────────────

def build_content_anatomy(aggregate: dict) -> dict:
    """Pure: `deconstruction/full` dict (evidence may be the pydantic model) -> Content Anatomy dict."""
    if not isinstance(aggregate, dict):
        raise ContentAnatomyInputError("aggregate must be a dict (the deconstruction/full payload)")
    agg = aggregate

    availability = _d(agg.get("availability"))
    stages = []
    for st in _l(agg.get("stages")):
        flag = _DATA_PRESENT_FLAG.get(st.get("key"))
        if st.get("status") == "not_run" and flag and availability.get(flag):
            st = {**st, "status": "complete", "reason": "results exist (produced outside the orchestrator)"}
        stages.append(st)
    stage_status = {s.get("key"): s.get("status") for s in stages}
    if stage_status:
        tech_ok, seg_ok = stage_status.get("technical_probe") in _DONE, stage_status.get("scene_segmentation") in _DONE
    else:
        tech_ok, seg_ok = bool(availability.get("technical")), bool(availability.get("shots"))
    if not tech_ok:
        raise ContentAnatomyNotReady("Content Anatomy needs the technical probe to be complete first")
    if not seg_ok:
        raise ContentAnatomyNotReady("Content Anatomy needs shot/cut detection (scene_segmentation) to be complete first")

    duration = _num(_d(agg.get("technical")).get("duration"))
    if duration is None or duration <= 0:
        raise ContentAnatomyInputError("aggregate carries no positive duration")

    dropped: dict = {}
    evidence = _d(agg.get("evidence"))
    structure = _d(agg.get("structure"))
    editing = _d(agg.get("editing_rhythm"))
    hook = _d(agg.get("hook"))
    retention = _d(agg.get("retention"))
    ai_configured = _d(agg.get("ai_configured"))

    skeleton, section_source = _choose_skeleton(agg, duration, stage_status)

    # ---- normalized evidence pools --------------------------------------------------------------
    shots = sorted(_timed(_l(evidence.get("shots")), "shots", dropped), key=lambda s: (s["start_time"], s.get("order") or 0))
    speech = _timed(_l(evidence.get("speech_segments")), "speech_segments", dropped)
    audio = _d(evidence.get("audio_structure"))
    silences = _timed(_l(audio.get("silence_intervals")), "silence_intervals", dropped)
    transitions = [t for t in _l(evidence.get("transition_evidence")) if _num(t.get("boundary_timestamp")) is not None]
    scenes = _timed(_l(structure.get("scenes")), "scenes", dropped)
    beats = _unique_beats(structure)
    phases = _timed(_l(editing.get("pacing_phases")), "pacing_phases", dropped)
    all_device_rows = _timed(_l(retention.get("accepted_devices")), "accepted_devices", dropped)
    examined = _l(retention.get("examined"))
    # Rows written BEFORE the acceptance gate were persisted with no acceptance decision at all (every
    # examined candidate became a row). They must never be presented as accepted mechanisms: they are kept
    # only as references with status "no_acceptance_decision".
    legacy_devices = [d for d in all_device_rows if d.get("schema") == LEGACY_RETENTION_SCHEMA
                      or (d.get("schema") is None and not d.get("probable_attention_function"))]
    legacy_ids = {id(d) for d in legacy_devices}
    accepted = [d for d in all_device_rows if id(d) not in legacy_ids]
    known_attempts = {x.get("attempt_id") for x in examined}
    for d in legacy_devices:
        if d.get("reasoning_attempt_id") in known_attempts and d.get("reasoning_attempt_id") is not None:
            continue  # its producing attempt is already listed
        examined.append({"attempt_id": d.get("reasoning_attempt_id"), "candidate_start": d["start_time"], "candidate_end": d["end_time"],
                         "device_type": d.get("device_type"), "is_retention_device": None, "reasoning": None})

    texts, objects, seen_t, seen_o = [], [], set(), set()
    for shot in shots:
        for t in _timed(_l(shot.get("text_elements")), "text_elements", dropped):
            if t.get("id") not in seen_t:
                seen_t.add(t.get("id"))
                texts.append(t)
        for o in _timed(_l(shot.get("visual_objects")), "visual_objects", dropped):
            if o.get("id") not in seen_o:
                seen_o.add(o.get("id"))
                objects.append(o)
    recurring_of: dict = {}
    for rec in _l(evidence.get("recurring_elements")):
        for member in rec.get("member_text_element_ids") or []:
            recurring_of[member] = rec.get("id")

    cut_times = [s["end_time"] for s in shots[:-1]]
    hook_window = _d(hook.get("window"))
    hw0, hw1 = _num(hook_window.get("start_time")), _num(hook_window.get("end_time"))

    # ---- sections ---------------------------------------------------------------------------
    sections: list[dict] = []
    n = len(skeleton)
    for i, row in enumerate(skeleton):
        s, e, last = row["start_time"], row["end_time"], i == n - 1
        sec_shots = [x for x in shots if _within(x["start_time"], x["end_time"], s, e, False)]
        sec_speech = [x for x in speech if _within(x["start_time"], x["end_time"], s, e, False)]
        sec_text = [x for x in texts if _within(x["start_time"], x["end_time"], s, e, last)]
        sec_obj = [x for x in objects if _within(x["start_time"], x["end_time"], s, e, last)]
        sec_sil = [x for x in silences if _within(x["start_time"], x["end_time"], s, e, False)]
        sec_scenes = [x for x in scenes if _within(x["start_time"], x["end_time"], s, e, False)]
        sec_beats = [x for x in beats if _within(x["start_time"], x["end_time"], s, e, False)]
        sec_phases = [x for x in phases if _within(x["start_time"], x["end_time"], s, e, False)]
        sec_trans = [x for x in transitions if s <= _num(x["boundary_timestamp"]) < e or (last and _num(x["boundary_timestamp"]) == e)]
        sec_cuts = [t for t in cut_times if s <= t < e]
        sec_devices = [x for x in accepted if _within(x["start_time"], x["end_time"], s, e, last)]
        sec_examined = [x for x in examined if x.get("is_retention_device") is not True
                        and _num(x.get("candidate_start")) is not None and _num(x.get("candidate_end")) is not None
                        and _within(x["candidate_start"], x["candidate_end"], s, e, last)]
        exposures = [_overlap_seconds(x["start_time"], x["end_time"], s, e) for x in sec_shots]
        sec_dur = e - s

        excerpt = " ".join(str(x.get("text") or "").strip() for x in sec_speech).strip()
        truncated = len(excerpt) > TRANSCRIPT_EXCERPT_MAX_CHARS
        overlaps_hook = hw0 is not None and hw1 is not None and _overlap_seconds(hw0, hw1, s, e) > 0
        roles = {x.get("narrative_role") for x in sec_scenes if x.get("narrative_role")}
        narrative_role = next(iter(roles)) if len(roles) == 1 else None
        counts: dict = {}
        for o in sec_obj:
            key = (str(o.get("label")), str(o.get("category")))
            counts[key] = counts.get(key, 0) + 1

        features = [f for f, on in (
            ("hook_window", overlaps_hook), ("speech", bool(sec_speech)), ("on_screen_text", bool(sec_text)),
            ("silence", bool(sec_sil)), ("cut", bool(sec_cuts)), ("accepted_retention_device", bool(sec_devices)),
        ) if on]

        sections.append({
            "number": i + 1, "start_time": _r(s), "end_time": _r(e), "duration": _r(sec_dur),
            "source_partition": row["source_partition"], "source_ref": row["source_ref"],
            "is_opening": i == 0, "overlaps_hook_window": overlaps_hook,
            "transcript_excerpt": (excerpt[:TRANSCRIPT_EXCERPT_MAX_CHARS] if excerpt else None),
            "transcript_truncated": truncated,
            "speech": [{"id": x.get("id"), "start_time": x["start_time"], "end_time": x["end_time"], "text": str(x.get("text") or ""),
                        "language": x.get("language"), "overlap_seconds": _r(_overlap_seconds(x["start_time"], x["end_time"], s, e))}
                       for x in sec_speech],
            "on_screen_text": [{"id": x.get("id"), "text": str(x.get("text") or ""), "start_time": x["start_time"], "end_time": x["end_time"],
                                "confidence_score": _num(x.get("confidence_score")), "certainty": x.get("certainty"),
                                "recurring_element_id": recurring_of.get(x.get("id"))} for x in sec_text],
            "visual": {
                "objects": [{"label": k[0], "category": k[1], "count": v} for k, v in sorted(counts.items())],
                "persistent_visual_element_count": sum(len(_l(x.get("persistent_visual_elements"))) for x in sec_shots),
                "keyframe_ids": [f.get("id") for x in sec_shots for f in _l(x.get("frames"))
                                 if _num(f.get("timestamp")) is not None and s <= f["timestamp"] < e],
                "motion_evidence_shot_ids": [x.get("id") for x in sec_shots if x.get("global_motion_evidence") or x.get("local_motion_evidence")],
                "transition_evidence_ids": [x.get("id") for x in sec_trans],
            },
            "audio": {
                "audio_stream_present": audio.get("audio_stream_present") if isinstance(audio.get("audio_stream_present"), bool) else None,
                "silence_intervals": [{"id": x.get("id"), "start_time": x["start_time"], "end_time": x["end_time"],
                                       "overlap_seconds": _r(_overlap_seconds(x["start_time"], x["end_time"], s, e))} for x in sec_sil],
                "silence_seconds": _r(sum(_overlap_seconds(x["start_time"], x["end_time"], s, e) for x in sec_sil)),
            },
            "pacing": {
                "shot_count": len(sec_shots), "cut_count": len(sec_cuts),
                "average_shot_exposure_seconds": _r(sum(exposures) / len(exposures)) if exposures else None,
                "cuts_per_minute": _r(len(sec_cuts) / sec_dur * 60.0) if sec_dur > 0 else None,
                "pacing_phase_ids": [x.get("id") for x in sec_phases],
            },
            "scene_refs": [{"id": x.get("id"), "order": x.get("order"), "narrative_role": x.get("narrative_role")} for x in sec_scenes],
            "shot_refs": [x.get("id") for x in sec_shots],
            "story_beat_refs": [x.get("id") for x in sec_beats],
            "retention_devices": [{"id": x.get("id"), "start_time": x["start_time"], "end_time": x["end_time"],
                                   "device_type": x.get("device_type"), "probable_attention_function": x.get("probable_attention_function"),
                                   "confidence": x.get("confidence"), "reasoning_attempt_id": x.get("reasoning_attempt_id"),
                                   "certainty": "INFERRED"} for x in sec_devices],
            "rejected_candidates": [{
                "attempt_id": x.get("attempt_id"), "candidate_start": x["candidate_start"], "candidate_end": x["candidate_end"],
                "device_type": x.get("device_type"),
                "status": "rejected" if x.get("is_retention_device") is False else "no_acceptance_decision",
                "reasoning_excerpt": (str(x.get("reasoning"))[:REASONING_EXCERPT_CHARS] if x.get("reasoning") else None),
            } for x in sec_examined],
            "interpretive": {"narrative_role": narrative_role, "messaging_role": None, "emotional_function": None, "cta_role": None,
                             "status": "narrative_role_from_scene" if narrative_role else "unsupported_in_v1"},
            "features": features,
            "evidence_ids": {
                "story_beats": [x.get("id") for x in sec_beats], "scenes": [x.get("id") for x in sec_scenes],
                "shots": [x.get("id") for x in sec_shots], "speech_segments": [x.get("id") for x in sec_speech],
                "text_elements": [x.get("id") for x in sec_text], "visual_objects": [x.get("id") for x in sec_obj],
                "silence_intervals": [x.get("id") for x in sec_sil], "transition_evidence": [x.get("id") for x in sec_trans],
                "pacing_phases": [x.get("id") for x in sec_phases], "retention_devices": [x.get("id") for x in sec_devices],
                "retention_attempts": sorted({x.get("attempt_id") for x in sec_examined if x.get("attempt_id") is not None}
                                             | {x.get("reasoning_attempt_id") for x in sec_devices if x.get("reasoning_attempt_id") is not None}),
            },
            "certainty": "MEASURED",
        })

    # ---- video-level ------------------------------------------------------------------------
    durations = [x["end_time"] - x["start_time"] for x in shots]
    profile_row = _d(editing.get("profile"))
    pacing_profile = {
        "shot_count": len(shots), "cut_count": len(cut_times),
        "average_shot_duration_seconds": _r(sum(durations) / len(durations)) if durations else None,
        "shortest_shot_seconds": _r(min(durations)) if durations else None,
        "longest_shot_seconds": _r(max(durations)) if durations else None,
        "cuts_per_minute": _r(len(cut_times) / duration * 60.0),
        "stage_11_1_profile": _d(profile_row.get("details")) or None,
        "certainty": "MEASURED",
    }

    with_speech = sum(1 for x in sections if x["speech"])
    with_text = sum(1 for x in sections if x["on_screen_text"])
    with_silence = sum(1 for x in sections if x["audio"]["silence_seconds"] > 0)
    accepted_by_type: dict = {}
    for x in accepted:
        key = str(x.get("device_type"))
        accepted_by_type[key] = accepted_by_type.get(key, 0) + 1
    rejected_n = sum(1 for x in examined if x.get("is_retention_device") is False)
    undecided_n = sum(1 for x in examined if x.get("is_retention_device") is None)
    if accepted:
        retention_status = "accepted_present"
    elif not examined:
        retention_status = "not_run"
    elif undecided_n == len(examined):
        retention_status = "legacy_only_no_decision"
    else:
        retention_status = "examined_none_accepted"

    selected = section_source["selected"]
    summary = (
        "No section skeleton could be built."
        if not sections else
        f"{len(sections)} sections (skeleton: {selected}); {len(shots)} shots, {len(cut_times)} cuts; "
        f"speech in {with_speech} of {len(sections)} sections; on-screen text in {with_text}; silence in {with_silence}; "
        f"{len(accepted)} accepted retention device(s)."
    )

    hook_class = _d(hook.get("classification"))
    hook_details = _d(hook_class.get("details"))
    classification = None if not hook_class else {
        **{k: hook_details.get(k) for k in ("primary_type", "secondary_types", "probable_intent", "provider", "model", "prompt_version") if k in hook_details},
        "reasoning": hook_class.get("reasoning"), "certainty": hook_class.get("certainty") or "INFERRED",
    }
    video = {
        "duration": _r(duration), "section_count": len(sections),
        "opening_section_number": 1 if sections else None,
        "hook": {
            "window": None if hw0 is None or hw1 is None else {
                "start_time": hw0, "end_time": hw1, "certainty": hook_window.get("certainty"),
                **{k: _d(hook_window.get("details")).get(k) for k in ("derived_from", "source_id", "fallback_reason")}},
            "hook_section_numbers": [x["number"] for x in sections if x["overlaps_hook_window"]],
            "classification": classification,
        },
        "pacing_profile": pacing_profile,
        "structural_pattern": {
            "section_source": selected, "section_count": len(sections), "shot_count": len(shots), "cut_count": len(cut_times),
            "sections_with_speech": with_speech, "sections_with_on_screen_text": with_text, "sections_with_silence": with_silence,
            "accepted_retention_device_count": len(accepted), "summary": summary, "basis": "measured",
        },
        "progression": [{"section_number": x["number"], "start_time": x["start_time"], "end_time": x["end_time"], "features": x["features"]} for x in sections],
        "retention": {
            "analysis_status": retention_status, "accepted_count": len(accepted), "accepted_by_type": dict(sorted(accepted_by_type.items())),
            "examined_count": len(examined), "rejected_count": rejected_n, "no_decision_count": undecided_n,
            "ai_configured": bool(ai_configured.get("retention")),
        },
        "interpretive": {"narrative_role": None, "messaging_role": None, "emotional_function": None, "cta_role": None, "status": "unsupported_in_v1"},
    }

    # ---- gaps -------------------------------------------------------------------------------
    gaps: list[dict] = []

    def gap(field: str, kind: str, reason: str, section_number: int | None = None) -> None:
        gaps.append({"field": field, "kind": kind, "reason": reason, "section_number": section_number})

    if not any(x["interpretive"]["narrative_role"] for x in sections):
        gap("narrative_role", "not_established", "Scene.narrative_role is not populated by any upstream stage (that classification pass is deferred)")
    gap("messaging_role", "unsupported_in_v1", "no upstream analysis produces messaging roles")
    gap("emotional_function", "unsupported_in_v1", "no upstream analysis produces emotional or psychological function")
    gap("cta_role", "unsupported_in_v1", "no upstream analysis produces CTA roles (CTA analysis does not exist yet)")
    if legacy_devices:
        gap("retention_devices", "legacy_data",
            f"{len(legacy_devices)} retention_device row(s) predate the acceptance gate and carry no acceptance decision; "
            "they were NOT treated as accepted devices (re-run Stage 11.4 with force_ai to upgrade them)")
    if selected != "story_beats":
        gap("story_beats", "unusable_source", section_source["considered"][0]["note"] or "Story Beats unavailable")
    if not stages:
        gap("stages", "not_established", "the aggregate carried no per-stage status, so stage failures cannot be reported")
    for st in stages:
        status = st.get("status")
        if status in _DONE or status is None:
            continue
        kind = "ai_not_configured" if status == "skipped" else ("analysis_not_run" if status == "not_run" else f"stage_{status}")
        gap(f"stage:{st.get('key')}", kind, str(st.get("error") or st.get("reason") or f"{st.get('label') or st.get('key')} is {status}"))
    for kind_name, count in sorted(dropped.items()):
        gap(f"evidence:{kind_name}", "malformed_evidence", f"{count} row(s) without usable start/end times were ignored")

    coverage = {
        "available": {k: bool(v) for k, v in sorted(availability.items())},
        "counts": {
            "shots": len(shots), "speech_segments": len(speech), "text_elements": len(texts), "visual_objects": len(objects),
            "silence_intervals": len(silences), "scenes": len(scenes), "story_beats": len(beats), "pacing_phases": len(phases),
            "retention_examined": len(examined), "retention_accepted": len(accepted),
        },
        "stage_summary": {status: sum(1 for st in stages if st.get("status") == status) for status in sorted({st.get("status") for st in stages if st.get("status")})},
        "stages_not_done": [st.get("key") for st in stages if st.get("status") not in _DONE],
    }

    source = _d(agg.get("source"))
    va = _d(agg.get("video_analysis"))
    content = {"version": ANATOMY_VERSION, "video": video, "section_source": section_source, "sections": sections, "gaps": gaps,
               "ids": {"reference_video_id": source.get("reference_video_id"), "video_analysis_id": va.get("id")}}
    fingerprint = hashlib.sha256(json.dumps(content, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")).hexdigest()

    return {
        "video": video, "section_source": section_source, "sections": sections,
        "evidence_coverage": coverage, "gaps": gaps,
        "provenance": {
            "anatomy_version": ANATOMY_VERSION, "reference_video_id": source.get("reference_video_id"),
            "video_analysis_id": va.get("id"), "derived_from": "deconstruction/full",
            "orchestration_status": _d(agg.get("orchestration")).get("status"),
            "llm_calls": 0, "persisted": False, "fingerprint": fingerprint,
            "notes": [
                "Deterministic derivation from the C1 aggregate; no AI call, no clock, no persistence.",
                "Section facts are MEASURED (time-partition and overlap arithmetic over persisted evidence); "
                "accepted retention devices and the hook classification keep their own INFERRED certainty.",
                "Interpretive fields are null unless upstream evidence supplies them; see gaps.",
            ],
        },
    }


async def get_content_anatomy(db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None) -> dict:
    """Reads the C1 aggregate for one exact analysis and derives its anatomy. Raises
    OrchestrationNotFound (unknown/foreign video or analysis), ContentAnatomyNotReady, or
    ContentAnatomyInputError."""
    aggregate = await build_full_deconstruction(db, user, reference_video_id, video_analysis_id=video_analysis_id)
    return build_content_anatomy(aggregate)
