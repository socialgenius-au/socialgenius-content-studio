"""Scene / story-beat STRUCTURE: an explicit, checked mapping between shots, scenes, story beats and timestamps, and an honest account of what the boundary reasoning did and did not establish.

Why this exists (reference 5131): the stored result was one whole-video scene and one whole-video story beat, and `Shot.scene_id` is never populated, so nothing recorded how scenes relate to shots, and nothing
said that three of the seven boundary candidates had come back UNDECIDED. A single whole-video beat reads like "this video has no structure"; the truthful reading is "the text-only reasoner, working from unverified speech,
could not establish an internal boundary". This module makes that distinction explicit and checks the mapping for consistency.

Pure and deterministic (no AI, no writes). `load_boundary_attempts` is a read-only loader for the stored reasoning attempts.
"""
from __future__ import annotations

TOLERANCE = 0.05          # seconds: timestamps closer than this are treated as the same instant
ACCEPT_CONFIDENCE = ("medium", "high")      # the construction policy: a boundary is only accepted at medium/high confidence


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def _num(x):
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def _ranges(items: list[dict]) -> list[dict]:
    out = []
    for it in items:
        s, e = _num(it.get("start_time")), _num(it.get("end_time"))
        if s is not None and e is not None and e >= s:
            out.append({**it, "_s": s, "_e": e})
    return sorted(out, key=lambda r: (r["_s"], r["_e"]))


def _partition_issues(kind: str, rows: list[dict], duration: float | None) -> list[dict]:
    issues = []
    prev = None
    for r in rows:
        if prev is not None:
            gap = r["_s"] - prev["_e"]
            if gap > TOLERANCE:
                issues.append({"code": f"{kind}_gap", "severity": "warning", "message": f"There is a {gap:.2f}s gap between {kind} {prev.get('id')} and {kind} {r.get('id')}.", "ids": [prev.get("id"), r.get("id")]})
            elif gap < -TOLERANCE:
                issues.append({"code": f"{kind}_overlap", "severity": "warning", "message": f"{kind.capitalize()} {prev.get('id')} and {kind} {r.get('id')} overlap by {-gap:.2f}s.", "ids": [prev.get("id"), r.get("id")]})
        prev = r
    if rows and duration:
        if rows[0]["_s"] > TOLERANCE:
            issues.append({"code": f"{kind}_starts_late", "severity": "warning", "message": f"The first {kind} starts at {rows[0]['_s']:.2f}s, not at the start of the video.", "ids": [rows[0].get("id")]})
        if rows[-1]["_e"] < duration - TOLERANCE:
            issues.append({"code": f"{kind}_ends_early", "severity": "warning", "message": f"The last {kind} ends at {rows[-1]['_e']:.2f}s, before the video ends ({duration:.2f}s).", "ids": [rows[-1].get("id")]})
        if rows[-1]["_e"] > duration + TOLERANCE:
            issues.append({"code": f"{kind}_outside_video", "severity": "error", "message": f"{kind.capitalize()} {rows[-1].get('id')} ends after the video does.", "ids": [rows[-1].get("id")]})
    return issues


def _reasoning_summary(attempts: list[dict]) -> dict:
    accepted = [a for a in attempts if a.get("decision") is True and a.get("confidence") in ACCEPT_CONFIDENCE]
    weak_true = [a for a in attempts if a.get("decision") is True and a.get("confidence") not in ACCEPT_CONFIDENCE]
    rejected = [a for a in attempts if a.get("decision") is False]
    undecided = [a for a in attempts if a.get("decision") is None]
    return {
        "examined": len(attempts), "accepted": len(accepted), "rejected": len(rejected), "undecided": len(undecided), "boundary_but_low_confidence": len(weak_true),
        "candidates": [{"id": a.get("id"), "time": a.get("time"), "decision": a.get("decision"), "confidence": a.get("confidence"),
                        "evidence": {k: len(v) for k, v in (a.get("refs") or {}).items() if isinstance(v, list) and v}} for a in attempts],
    }


def analyze_structure(duration: float | None, shots: list[dict], scenes: list[dict], attempts: dict | None = None) -> dict:
    """`scenes` are the aggregate's scenes (each with its `story_beats`); `attempts` = {"scene": [...], "beat": [...]} from `load_boundary_attempts`."""
    attempts = attempts or {}
    shot_rows = _ranges(shots)
    scene_rows = _ranges(scenes)
    beats = _ranges([dict(b, _scene=sc.get("id")) for sc in scenes for b in (sc.get("story_beats") or [])])
    issues: list[dict] = []
    issues += _partition_issues("scene", scene_rows, duration)
    issues += _partition_issues("beat", beats, duration)

    scene_to_shots = []
    for sc in scene_rows:
        ids = [s.get("id") for s in shot_rows if _overlap(s["_s"], s["_e"], sc["_s"], sc["_e"]) > TOLERANCE]
        scene_to_shots.append({"scene_id": sc.get("id"), "start": round(sc["_s"], 3), "end": round(sc["_e"], 3), "shot_ids": ids})
        if not ids:
            issues.append({"code": "scene_without_shots", "severity": "warning", "message": f"Scene {sc.get('id')} overlaps no shot.", "ids": [sc.get("id")]})
    if scene_rows:
        for s in shot_rows:
            if not any(_overlap(s["_s"], s["_e"], sc["_s"], sc["_e"]) > TOLERANCE for sc in scene_rows):
                issues.append({"code": "shot_without_scene", "severity": "warning", "message": f"Shot {s.get('id')} ({s['_s']:.2f}-{s['_e']:.2f}s) lies in no scene.", "ids": [s.get("id")]})
    beat_to_shots = []
    for b in beats:
        ids = [s.get("id") for s in shot_rows if _overlap(s["_s"], s["_e"], b["_s"], b["_e"]) > TOLERANCE]
        beat_to_shots.append({"beat_id": b.get("id"), "scene_id": b.get("_scene"), "start": round(b["_s"], 3), "end": round(b["_e"], 3), "shot_ids": ids, "boundary_status": b.get("boundary_status")})
        parent = next((sc for sc in scene_rows if sc.get("id") == b.get("_scene")), None)
        if parent is not None and (b["_s"] < parent["_s"] - TOLERANCE or b["_e"] > parent["_e"] + TOLERANCE):
            issues.append({"code": "beat_outside_scene", "severity": "warning", "message": f"Story beat {b.get('id')} extends beyond its scene {parent.get('id')}.", "ids": [b.get("id"), parent.get("id")]})

    whole = lambda rows: bool(rows) and len(rows) == 1 and duration and rows[0]["_s"] <= TOLERANCE and rows[0]["_e"] >= duration - TOLERANCE      # noqa: E731
    partition = {"scenes": "none" if not scene_rows else ("single_whole_video" if whole(scene_rows) else "partitioned"),
                 "beats": "none" if not beats else ("single_whole_video" if whole(beats) else "partitioned"), "shots": len(shot_rows)}
    reasoning = {"scene": _reasoning_summary(attempts.get("scene") or []), "beat": _reasoning_summary(attempts.get("beat") or [])}

    uncertainty: list[str] = []
    for label, key in (("scene", "scene"), ("story-beat", "beat")):
        r = reasoning[key]
        if r["examined"] and r["accepted"] == 0:
            parts = [f"{r['rejected']} judged not to be a boundary"] if r["rejected"] else []
            if r["undecided"]:
                parts.append(f"{r['undecided']} left undecided")
            if r["boundary_but_low_confidence"]:
                parts.append(f"{r['boundary_but_low_confidence']} suggested a boundary only with low confidence")
            uncertainty.append(f"None of the {r['examined']} {label} boundary candidates was accepted ({'; '.join(parts)}). This is the judgement of a text-only reasoner working from the speech and text evidence; "
                               f"it is not evidence that the video has no internal {label} structure.")
        elif r["undecided"]:
            uncertainty.append(f"{r['undecided']} of {r['examined']} {label} boundary candidates were left undecided, so {label} boundaries may be missing.")
    if partition["beats"] == "single_whole_video" or partition["scenes"] == "single_whole_video":
        uncertainty.append("A single whole-video scene or story beat carries no partition information, so the section structure is built from the measured shots instead.")
    return {"scene_count": len(scene_rows), "beat_count": len(beats), "shot_count": len(shot_rows), "partition": partition, "scene_to_shots": scene_to_shots, "beat_to_shots": beat_to_shots,
            "reasoning": reasoning, "issues": issues, "consistent": not any(i["severity"] == "error" for i in issues) and not issues, "uncertainty": uncertainty}


async def load_boundary_attempts(db, video_analysis_id: int) -> dict:
    """The stored (read-only) scene and story-beat boundary reasoning attempts, latest per candidate."""
    from sqlalchemy import select
    from app.models.analysis_annotation import AnalysisAnnotation
    out = {"scene": [], "beat": []}
    for kind, category, flag in (("scene", "semantic_boundary_attempt", "is_scene_boundary"), ("beat", "story_beat_boundary_attempt", "is_story_beat_boundary")):
        rows = (await db.execute(select(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == video_analysis_id, AnalysisAnnotation.category == category)
                                 .order_by(AnalysisAnnotation.start_time, AnalysisAnnotation.id))).scalars().all()
        latest: dict[float, AnalysisAnnotation] = {}
        for r in rows:
            latest[round(float(r.start_time), 2)] = r
        for t, r in sorted(latest.items()):
            d = r.details or {}
            out[kind].append({"id": r.id, "time": t, "decision": d.get(flag), "confidence": d.get("confidence"), "refs": d.get("evidence_references") or {}})
    return out
