"""What is enforced IN CODE about a Creative Read response (never only requested in the prompt). A response that breaks a rule is rejected whole and nothing is persisted.

1. Shape: the schema below, bounded sizes, known finding kinds, known mechanism types, categorical confidence.
2. Evidence: every finding cites at least one evidence item, and every cited id must be one the model was actually given (a frame it was shown, a speech segment, on-screen text, a shot).
3. Time: ranges lie inside the video and inside the shots named.
4. Confidence: a finding can never be MORE confident than its evidence. `high` needs at least two different kinds of evidence; citing speech or on-screen text whose own
   recognition confidence is low caps the finding at `low` (<0.4) or `medium` (<0.7).
5. Language: no performance / outcome / causal claims; intent must be hedged; the transferable principle must not point at this video's timestamps or reproduce its wording.
"""
from __future__ import annotations

import json
import re

from app.services.creative_reader.contract import (
    CreativeReadError, CreativeReadResult, EVIDENCE_TYPES, FINDING_KINDS, Finding, MECHANISM_VOCABULARY, ShotRead, VALID_CONFIDENCE, CREATIVE_READ_PROMPT_VERSION,
)
from app.services.mechanism_reasoner.contract import MechanismReasoningError
from app.services.mechanism_reasoner.language_guard import (
    PRINCIPLE_VERBATIM_LIMIT, OTHER_VERBATIM_LIMIT, build_source_index, reject_prohibited_language, reject_source_reproduction, reject_source_specific_references, reject_unhedged_intent,
)

MAX_FINDINGS = 14
MAX_SHOT_READS = 24
MAX_TEXT = 600
TIME_SLACK = 0.25


def parse_json_object(raw: str) -> dict:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    start = text.find("{")
    if start < 0:
        raise CreativeReadError("The AI response contained no JSON object.")
    try:
        data, _ = json.JSONDecoder().raw_decode(text[start:])
    except json.JSONDecodeError as exc:
        raise CreativeReadError(f"The AI response was not valid JSON ({exc.msg}).") from exc
    if not isinstance(data, dict):
        raise CreativeReadError("The AI response was not a JSON object.")
    return data


def _confidence_cap(refs: list[dict], conf_by_ref: dict[tuple[str, int], float | None]) -> str:
    known = [conf_by_ref[(r["type"], r["id"])] for r in refs if conf_by_ref.get((r["type"], r["id"])) is not None]
    low = min(known) if known else None
    if low is not None and low < 0.4:
        return "low"
    if low is not None and low < 0.7:
        return "medium"
    return "high"


def _order(c: str) -> int:
    return VALID_CONFIDENCE.index(c)


def validate(data: dict, prepared: dict, *, model: str = "", usage: dict | None = None) -> CreativeReadResult:
    valid_ids = {
        "frame": {f["id"] for f in prepared["frames"]},
        "speech": {s["id"] for s in prepared["speech"]},
        "text": {t["id"] for t in prepared["text"]},
        "shot": {s["order"] for s in prepared["shots"]},
    }
    conf_by_ref: dict[tuple[str, int], float | None] = {("speech", s["id"]): s.get("confidence") for s in prepared["speech"]} | {("text", t["id"]): t.get("confidence") for t in prepared["text"]}
    shots_by_order = {s["order"]: s for s in prepared["shots"]}
    duration = (prepared["video"].get("duration_seconds") or max((s["end"] for s in prepared["shots"]), default=0)) + TIME_SLACK
    source_texts = [s["text"] for s in prepared["speech"]] + [t["text"] for t in prepared["text"]]
    idx_principle = build_source_index(source_texts, PRINCIPLE_VERBATIM_LIMIT)
    idx_other = build_source_index(source_texts, OTHER_VERBATIM_LIMIT)

    for key in ("summary", "shots", "findings", "limitations"):
        if key not in data:
            raise CreativeReadError(f"The AI response is missing '{key}'.")
    if not isinstance(data["summary"], str) or not data["summary"].strip():
        raise CreativeReadError("'summary' must be a non-empty string.")
    if not isinstance(data["shots"], list) or len(data["shots"]) > MAX_SHOT_READS:
        raise CreativeReadError("'shots' must be a list of per-shot reads.")
    if not isinstance(data["findings"], list) or len(data["findings"]) > MAX_FINDINGS:
        raise CreativeReadError(f"'findings' must be a list of at most {MAX_FINDINGS} items.")
    if not isinstance(data["limitations"], list) or not all(isinstance(x, str) for x in data["limitations"]):
        raise CreativeReadError("'limitations' must be a list of strings.")

    try:
        reject_prohibited_language(data["summary"], *data["limitations"])
        reject_unhedged_intent("summary", data["summary"])
        reject_source_reproduction("summary", data["summary"], idx_other)
    except MechanismReasoningError as exc:
        raise CreativeReadError(str(exc)) from exc

    shots: list[ShotRead] = []
    for s in data["shots"]:
        if not isinstance(s, dict) or s.get("shot_order") not in valid_ids["shot"]:
            raise CreativeReadError(f"A per-shot read names a shot that does not exist: {s!r}.")
        for k in ("focal_subject", "framing"):
            if not isinstance(s.get(k), str) or not s[k].strip() or len(s[k]) > MAX_TEXT:
                raise CreativeReadError(f"Per-shot read for shot {s['shot_order']} needs a short '{k}'.")
        try:
            reject_prohibited_language(s["focal_subject"], s["framing"], s.get("notes"))
        except MechanismReasoningError as exc:
            raise CreativeReadError(str(exc)) from exc
        shots.append(ShotRead(shot_order=s["shot_order"], focal_subject=s["focal_subject"].strip(), framing=s["framing"].strip(), notes=(s.get("notes") or None)))

    findings: list[Finding] = []
    for i, f in enumerate(data["findings"]):
        where = f"findings[{i}]"
        if not isinstance(f, dict):
            raise CreativeReadError(f"{where} is not an object.")
        if f.get("kind") not in FINDING_KINDS:
            raise CreativeReadError(f"{where}.kind {f.get('kind')!r} is not one of {FINDING_KINDS}.")
        if f.get("mechanism_type") not in MECHANISM_VOCABULARY:
            raise CreativeReadError(f"{where}.mechanism_type {f.get('mechanism_type')!r} is not in the mechanism vocabulary.")
        if f.get("confidence") not in VALID_CONFIDENCE:
            raise CreativeReadError(f"{where}.confidence must be one of {VALID_CONFIDENCE}.")
        st = f.get("statement")
        if not isinstance(st, str) or not st.strip() or len(st) > MAX_TEXT:
            raise CreativeReadError(f"{where}.statement must be a short non-empty string.")
        refs = f.get("evidence")
        if not isinstance(refs, list) or not refs:
            raise CreativeReadError(f"{where} cites no evidence. Every finding must cite what it rests on.")
        for r in refs:
            if not isinstance(r, dict) or r.get("type") not in EVIDENCE_TYPES or r.get("id") not in valid_ids.get(r.get("type"), set()):
                raise CreativeReadError(f"{where} cites evidence that was not provided: {r!r}.")
        shot_orders = f.get("shot_orders")
        if not isinstance(shot_orders, list) or not shot_orders or any(o not in valid_ids["shot"] for o in shot_orders):
            raise CreativeReadError(f"{where}.shot_orders must name existing shots.")
        t0, t1 = f.get("start_time"), f.get("end_time")
        if not all(isinstance(t, (int, float)) for t in (t0, t1)) or t0 < 0 or t1 < t0 or t1 > duration:
            raise CreativeReadError(f"{where} has an invalid time range ({t0!r}-{t1!r}); the video is {duration - TIME_SLACK:.1f}s long.")
        lo = min(shots_by_order[o]["start"] for o in shot_orders) - TIME_SLACK
        hi = max(shots_by_order[o]["end"] for o in shot_orders) + TIME_SLACK
        if t0 < lo or t1 > hi:
            raise CreativeReadError(f"{where}'s time range {t0}-{t1} lies outside the shots it names ({lo + TIME_SLACK:.1f}-{hi - TIME_SLACK:.1f}).")
        kinds = {r["type"] for r in refs}
        conf = f["confidence"]
        if conf == "high" and len(kinds) < 2:
            raise CreativeReadError(f"{where} claims high confidence from a single kind of evidence ({sorted(kinds)}); high needs at least two different kinds.")
        cap = _confidence_cap(refs, conf_by_ref)
        if _order(conf) > _order(cap):
            raise CreativeReadError(f"{where} claims '{conf}' confidence but cites speech/text whose own recognition confidence only supports '{cap}'.")
        principle, specific = f.get("transferable_principle"), f.get("source_specific")
        try:
            reject_prohibited_language(st, principle, specific)
            reject_unhedged_intent(f"{where}.statement", st)
            if principle:
                reject_unhedged_intent(f"{where}.transferable_principle", principle)
                reject_source_specific_references(f"{where}.transferable_principle", principle)
                reject_source_reproduction(f"{where}.transferable_principle", principle, idx_principle)
            reject_source_reproduction(f"{where}.statement", st, idx_other)
        except MechanismReasoningError as exc:
            raise CreativeReadError(str(exc)) from exc
        findings.append(Finding(kind=f["kind"], statement=st.strip(), start_time=float(t0), end_time=float(t1), shot_orders=list(shot_orders), evidence=[{"type": r["type"], "id": r["id"]} for r in refs],
                                confidence=conf, mechanism_type=f["mechanism_type"], transferable_principle=(principle.strip() if isinstance(principle, str) and principle.strip() else None),
                                source_specific=(specific.strip() if isinstance(specific, str) and specific.strip() else None)))
    return CreativeReadResult(summary=data["summary"].strip(), shots=shots, findings=findings, limitations=[x.strip() for x in data["limitations"] if x.strip()],
                              model=model, prompt_version=CREATIVE_READ_PROMPT_VERSION, usage=usage or {})
