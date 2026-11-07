"""Joins the stored Creative Read (an AI looked at keyframes) onto the Content Anatomy and RECONCILES it with the other evidence, deterministically and without any AI call.

Why: the anatomy holds readings of unequal authority about the same moment. A detector said "bottle, dining table"; an AI that looked at the picture said "a jar held by a hand"; the speech-to-text said
"100% шود, bina-pani" (mixed scripts, no confidence); OCR returned "Waites / Realing / Sloving" next to a legible "BARAKAH". Presenting them as equally established would build mechanisms on noise.

Authority order used everywhere (highest first):
  1. MEASURED facts (shot timing, cuts, durations).
  2. OBSERVED by looking at the frames (the AI-vision reading of what is visible): an INFERRED reading, but of pixels.
  3. Recognised text with a recorded high confidence (OCR >= 0.9).
  4. Text-only AI conclusions (hook type, retention verdicts) and low-confidence recognition: they inherit the weakness of what they were built on.
  5. Speech-to-text with NO recorded confidence, mixed scripts or low confidence: UNVERIFIED. Never a quotation; it cannot support a high-confidence mechanism.
Audience effects are never established: there is no viewer data. Nothing here claims any.
"""
from __future__ import annotations

import re

AUTHORITY_ORDER = [
    "measured timing and structure",
    "what the frames visibly show (AI-vision reading, inferred)",
    "on-screen text recognised with confidence >= 0.9",
    "text-only AI conclusions and low-confidence recognition",
    "speech-to-text without a recorded confidence, with mixed scripts or low confidence (unverified)",
]
OCR_OK, OCR_LOW = 0.9, 0.7
SPEECH_LOW = 0.5
LOW_LOGPROB = -0.6

_SCRIPTS = {"arabic": (0x0600, 0x06FF), "devanagari": (0x0900, 0x097F), "cyrillic": (0x0400, 0x04FF), "cjk": (0x4E00, 0x9FFF)}
_LATIN = re.compile(r"[A-Za-z]")

# What a coarse object detector calls things vs. words a visual description would use for the same thing.
_SYNONYMS = {
    "bottle": {"bottle", "jar", "container", "tub", "pot", "packaging", "pack"},
    "cup": {"cup", "mug", "glass", "jar", "bowl"},
    "bowl": {"bowl", "pan", "kadai", "pot", "dish", "container", "plate"},
    "spoon": {"spoon", "ladle", "spatula", "utensil"},
    "donut": {"paste", "dollop", "blob", "mound", "spoonful", "scoop"},
    "person": {"person", "woman", "man", "presenter", "hand", "hands", "child", "face", "people"},
    "dining table": {"table", "counter", "countertop", "surface", "shelf", "kitchen"},
    "chair": {"chair", "seat", "stool", "kitchen", "room"},
    "knife": {"knife", "blade"}, "fork": {"fork"}, "bed": {"bed"}, "couch": {"sofa", "couch"},
}


def scripts_in(text: str) -> set[str]:
    found = set()
    for ch in text or "":
        o = ord(ch)
        for name, (lo, hi) in _SCRIPTS.items():
            if lo <= o <= hi:
                found.add(name)
    if _LATIN.search(text or ""):
        found.add("latin")
    return found


def speech_reliability(seg: dict) -> dict:
    reasons = []
    conf = seg.get("confidence_score")
    if not isinstance(conf, (int, float)):
        reasons.append("no recognition confidence was recorded")
    elif conf < SPEECH_LOW:
        reasons.append(f"recognition confidence is low ({conf:.2f})")
    lp = (seg.get("analysis_details") or {}).get("avg_logprob")
    if isinstance(lp, (int, float)) and lp < LOW_LOGPROB:
        reasons.append(f"the speech engine's own log-probability for this segment is low ({lp:.2f})")
    sc = scripts_in(str(seg.get("text") or ""))
    if len(sc) >= 2:
        reasons.append("the text mixes " + " and ".join(sorted(sc)) + " characters, typical of misrecognised or code-switched speech")
    return {"id": seg.get("id"), "reliable": not reasons, "reasons": reasons}


def attach_transcript_alternatives(sections: list[dict], transcript: dict | None) -> dict | None:
    """Adds, per section, the PREFERRED alternative reading of the speech (if any) as `speech_reading` and returns the video-level `transcript` block. The original speech stays as it was.
    A `speech_reading` is machine output, unverified and not quotable; it has no evidence id, so nothing can cite it."""
    if not transcript or not transcript.get("alternatives"):
        return None
    pref = next((a for a in transcript["alternatives"] if a["run_id"] == transcript.get("preferred_run_id")), None)
    if pref:
        for sec in sections:
            segs = [s for s in pref["segments"] if _overlap(s["start_time"], s["end_time"], sec["start_time"], sec["end_time"]) > 0]
            if segs:
                sec["speech_reading"] = {"basis": "speech_to_text", "status": transcript["alternatives"][0]["status"], "quotable": False, "model": pref["model"], "language_hint": pref["language_hint"],
                                         "text": " ".join(s["text"] for s in segs), "reads_original_segments": [x.get("id") for x in sec.get("speech", [])]}
    return {
        "original": transcript["original"], "policy": transcript["policy"], "preferred_run_id": transcript.get("preferred_run_id"),
        "alternatives": [{k: v for k, v in a.items() if k != "segments"} for a in transcript["alternatives"]],
    }


def _overlap(a0, a1, b0, b1) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def _words(s: str) -> set[str]:
    return set(re.findall(r"[a-z]+", (s or "").lower()))


def _detector_vs_vision(labels: list[str], read: dict) -> tuple[list[str], list[str]]:
    """(corroborated labels, uncorroborated labels): a detector label is corroborated when the visual description of the same shot names it or a synonym."""
    described = _words(" ".join(str(read.get(k) or "") for k in ("focal_subject", "framing", "notes")))
    ok, missing = [], []
    for lab in labels:
        names = {lab.lower()} | set(_SYNONYMS.get(lab.lower(), set()))
        (ok if names & described else missing).append(lab)
    return ok, missing


def attach_creative_layer(sections: list[dict], shots: list[dict], creative: dict, *, speech: list[dict], texts: list[dict], hook_classification: dict | None) -> dict:
    """Mutates `sections` (adds `creative`, `evidence_ids.creative_findings`, feature `creative_read`) and returns the video-level blocks {creative, reconciliation}. Pure and deterministic."""
    reads = {r["shot_order"]: r for r in creative.get("shots", []) if isinstance(r.get("shot_order"), int)}
    findings = creative.get("findings", [])
    shot_order_of = {id(s): s.get("order", i) for i, s in enumerate(shots)}

    # ── speech and OCR reliability ──
    sp_quality = [speech_reliability(s) for s in speech]
    unverified_speech = [q["id"] for q in sp_quality if not q["reliable"]]
    # OCR confidence says how faithfully the engine read what is drawn, NOT whether it is real text: on generated video it reads pseudo-text with high confidence (reference 5131: 'Waites' 1.00).
    # So a text item the AI-vision pass did NOT corroborate is also treated as unverified whenever that pass reported garbled or artefact text.
    cited_text = {e.get("id") for f in findings for e in (f.get("evidence") or []) if e.get("type") == "text"}
    garbled = any(re.search(r"garbl|artefact|artifact|unreadable|illegible", str(x), re.I) for x in creative.get("limitations", []))
    low_conf = [t.get("id") for t in texts if isinstance(t.get("confidence_score"), (int, float)) and t["confidence_score"] < OCR_LOW]
    uncorroborated = [t.get("id") for t in texts if garbled and t.get("id") not in cited_text and t.get("id") not in low_conf]
    low_text = low_conf + uncorroborated
    ok_text = [t.get("id") for t in texts if t.get("id") in cited_text and t.get("id") not in low_text]

    items: list[dict] = []

    def item(topic, status, sources, note, secs=None, authority=None):
        items.append({"id": f"rc-{len(items) + 1}", "topic": topic, "status": status, "sources": sources, "sections": secs or [], "authority": authority, "note": note})

    for sec in sections:
        s, e = sec["start_time"], sec["end_time"]
        sec_shots = [sh for sh in shots if _overlap(sh["start_time"], sh["end_time"], s, e) > 0]
        orders = {shot_order_of[id(sh)] for sh in sec_shots}
        sec_reads = [reads[o] for o in sorted(orders) if o in reads]
        sec_findings = [f for f in findings if (set(f.get("shot_orders") or []) & orders) or _overlap(f["start_time"], f["end_time"], s, e) > 0]
        # keep a finding in the section where most of it lies, so it is not repeated everywhere
        sec_findings = [f for f in sec_findings if _overlap(f["start_time"], f["end_time"], s, e) >= 0.5 * max(f["end_time"] - f["start_time"], 1e-6) or (set(f.get("shot_orders") or []) <= orders)]
        if sec_reads or sec_findings:
            sec["creative"] = {
                "basis": "ai_vision", "certainty": "INFERRED",
                "shot_reads": [{"shot_order": r["shot_order"], "focal_subject": r.get("focal_subject"), "framing": r.get("framing"), "notes": r.get("notes")} for r in sec_reads],
                "findings": [{"id": f["id"], "kind": f.get("kind"), "start": f["start_time"], "end": f["end_time"], "confidence": f.get("confidence"), "statement": f.get("statement"),
                              "mechanism_hint": f.get("mechanism_type"), "candidate_principle": f.get("transferable_principle"), "evidence": f.get("evidence")} for f in sec_findings],
            }
            sec["evidence_ids"]["creative_findings"] = [f["id"] for f in sec_findings]
            sec["features"].append("creative_read")
        # detector labels vs what the frames show
        labels = [o["label"] for o in (sec.get("visual") or {}).get("objects", []) if o.get("label")]
        for r in sec_reads:
            if labels:
                ok, missing = _detector_vs_vision(labels, r)
                if not missing:
                    item("object identity", "established", ["detector labels", "ai vision"], f"Shot {r['shot_order']}: the visual description corroborates the detector labels ({', '.join(labels)}).", [sec["number"]], "ai_vision")
                elif ok:
                    item("object identity", "partly_corroborated", ["detector labels", "ai vision"],
                         f"Shot {r['shot_order']}: the visual description corroborates {', '.join(ok)} but not {', '.join(missing)}; treat the uncorroborated detector labels as low authority and the visual description as the primary reading.", [sec["number"]], "ai_vision")
                else:
                    item("object identity", "disputed", ["detector labels", "ai vision"],
                         f"Shot {r['shot_order']}: the detector reported {', '.join(missing)}, none of which the visual description corroborates (it describes: {r.get('focal_subject')}). "
                         "Treat the visual description as the primary reading of what is on screen and the detector labels as low authority.", [sec["number"]], "ai_vision")
        sec_unverified = [x["id"] for x in sec.get("speech", []) if x.get("id") in unverified_speech]
        if sec_unverified:
            item("spoken wording", "unverified", ["speech-to-text"], "The transcript for this section is machine output that is unverified (" + "; ".join(sorted({r for q in sp_quality if q["id"] in sec_unverified for r in q["reasons"]})) +
                 "). Do not quote it, and do not rest a high-confidence mechanism on what it appears to say.", [sec["number"]], "none")
        sec_low = [x["id"] for x in sec.get("on_screen_text", []) if x.get("id") in low_text]
        if sec_low:
            item("on-screen text", "unverified", ["ocr", "ai vision"], f"{len(sec_low)} recognised text item(s) are unverified: low recognition confidence (< {OCR_LOW}), or not corroborated by the frames while the visual reading reported garbled text. "
                 "In AI-generated video these are often rendering artefacts rather than readable words; only text the visual reading itself cites is treated as legible.", [sec["number"]], "ocr (unverified)")

    hk = hook_classification or {}
    hook_speech = set()
    for el in (hk.get("details") or hk).get("hook_elements", []) if isinstance(hk, dict) else []:
        hook_speech |= set((el.get("evidence_references") or {}).get("supporting_speech_segment_ids") or [])
    if hk and hook_speech & set(unverified_speech):
        vis = next((f for f in findings if f.get("kind") == "hook_visual"), None)
        item("opening hook", "two_views", ["text-only hook classification", "ai vision"],
             "The text-only hook classification rests partly on speech that is unverified. " + (f"The visual reading of the opening is: {vis.get('statement')} " if vis else "") +
             "Treat the visual structure of the opening as observed and the spoken-claim part of the hook type as unverified.", [1], "ai_vision")

    quality = {
        "speech": {"segments": len(speech), "unverified_ids": unverified_speech, "reasons": sorted({r for q in sp_quality for r in q["reasons"]})},
        "ocr": {"items": len(texts), "legible_ids": ok_text, "low_confidence_ids": low_conf, "uncorroborated_ids": uncorroborated},
    }
    return {
        "creative": {
            "basis": "ai_vision", "certainty": "INFERRED", "summary": creative.get("summary"), "limitations": creative.get("limitations", []), "finding_count": len(findings),
            "model": (creative.get("provenance") or {}).get("model"), "prompt_version": (creative.get("provenance") or {}).get("prompt_version"),
            "frames_shown": len((creative.get("provenance") or {}).get("frames_shown", [])),
        },
        "reconciliation": {"authority_order": AUTHORITY_ORDER, "items": items, "evidence_quality": quality, "unverified_speech_ids": unverified_speech, "low_confidence_text_ids": low_text,
                           "audience_effects": "not established: there is no viewer data; every reading here describes apparent design only"},
    }
