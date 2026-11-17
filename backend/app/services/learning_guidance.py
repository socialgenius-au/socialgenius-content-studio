"""Learning-driven creation: turns the person's ACCEPTED lessons (learning_records) into ranked, labelled guidance for a NEW brief, and into the exact guidance a blueprint request carries.

What a lesson is, and is not:
  * It is something the person decided to keep from an earlier video. It is NOT a verified performance improvement: no audience data exists, so `verified_audience_finding` is never produced (the class exists so a future
    measured import has somewhere to go).
  * Its CLASSIFICATION is derived from what was recorded (basis + rule), never upgraded: a measured production observation stays one; an untested hypothesis stays one.
  * Its CONFIDENCE is not stored on the record; it is the documented confidence of the rule that produced it (RULE_CONFIDENCE) and is labelled as such.
Everything is deterministic, per user, and read-only here: nothing in this module writes to the database or calls an AI.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning_record import LearningRecord
from app.models.user import User
from app.models.video_studio_draft import VideoStudioDraft

CLASS_LABELS = {
    "measured_production_observation": "Measured production observation",
    "rule_of_thumb": "Rule of thumb",
    "ai_inferred_suggestion": "AI-inferred creative suggestion",
    "untested_hypothesis": "Untested hypothesis",
    "verified_audience_finding": "Verified audience-performance finding",
}
LESSONS_POLICY = ("Lessons are the person's own decisions about earlier videos. They are guidance, not verified performance improvements: nothing here says any change increased reach, engagement, "
                  "conversions or retention.")
MAX_LESSONS = 8
RELEVANT_AT = 0.3

# Documented confidence of the rule that produced each kind of lesson (see learn/assessment.ts: reading speed and contrast are measured values judged against a rule of thumb; the others are ideas).
FAMILIES = ("reading-speed", "contrast", "text-size", "footage-variety", "shorter-cut", "alt-opening-hook", "alt-cta")
RULE_CONFIDENCE = {"reading-speed": "medium", "contrast": "medium", "text-size": "low", "footage-variety": "low", "shorter-cut": "low", "alt-opening-hook": "low", "alt-cta": "low"}

_STOP = frozenset("""that with this from into about which where when what while they them their there these those have has been being were will would could should than then also only over under after
before during between within through each every both same very just even still more most less such some many much other your you our for and the are not but can get make made using use new video content""".split())
_WORD = re.compile(r"[a-z]{4,}")
_MOBILE = re.compile(r"reel|tiktok|short|story|stories|vertical|mobile|instagram|social|9:16", re.I)
_TEXT_WORDS = re.compile(r"on-screen text|onscreen text|captions?|subtitles?|text overlay|\btext\b", re.I)


def family(rec_key: str) -> str | None:
    return next((f for f in FAMILIES if rec_key.startswith(f)), None)


def classify(rec: LearningRecord) -> dict:
    fam = family(rec.rec_key)
    if rec.basis == "evidence":
        quals = ["rule_of_thumb"] if (fam in ("reading-speed", "text-size") or "rule of thumb" in (rec.caveat or "").lower()) else []
        primary = "measured_production_observation"
    else:
        primary, quals = "untested_hypothesis", []
    return {"classification": primary, "classification_label": CLASS_LABELS[primary], "qualifiers": quals, "qualifier_labels": [CLASS_LABELS[q] for q in quals]}


def confidence_of(rec: LearningRecord) -> dict:
    fam = family(rec.rec_key)
    if fam is None or not (rec.rule_version or "").startswith("learn-v"):
        return {"level": "unknown", "source": "not recorded"}
    return {"level": RULE_CONFIDENCE[fam], "source": f"documented confidence of the {rec.rule_version} rule (not stored on the record)"}


def _tokens(*parts: str | None) -> set[str]:
    return {w for p in parts if p for w in _WORD.findall(p.lower()) if w not in _STOP}


_SUMMARY = re.compile(r"(Topic|Audience|Objective|Business|Format):\s*(.*?)(?=\.\s+(?:Topic|Audience|Objective|Business|Format):|\.?$)")


def origin_of(draft: VideoStudioDraft | None, rec: LearningRecord) -> dict:
    """Where a lesson came from: read from the OWNER'S draft when it still exists, else from the snapshot on the record."""
    out = {"draft_id": rec.draft_id, "draft_name": rec.draft_name, "blueprint_id": rec.blueprint_id, "reference_video_id": rec.reference_video_id, "platform": None, "ratio": None, "topic": None, "audience": None, "objective": None}
    pj = draft.project_json if draft is not None and isinstance(draft.project_json, dict) else {}
    cf = pj.get("canvasFormat") if isinstance(pj.get("canvasFormat"), dict) else {}
    out["ratio"] = cf.get("ratio") if isinstance(cf.get("ratio"), str) else None
    plan = pj.get("blueprintPlan") if isinstance(pj.get("blueprintPlan"), dict) else {}
    parts = {k: v.strip() for k, v in _SUMMARY.findall(str(plan.get("intentSummary") or ""))}
    out["topic"], out["audience"], out["objective"] = parts.get("Topic"), parts.get("Audience"), parts.get("Objective")
    fmt = parts.get("Format") or plan.get("platform")
    out["platform"] = (fmt.split(",")[0].strip() if isinstance(fmt, str) and fmt else None) or (cf.get("label") if isinstance(cf.get("label"), str) else None)
    return out


def brief_from_intent(canonical: dict) -> dict:
    dpc = canonical.get("duration_platform_constraints") or {}
    return {"product": canonical.get("product_service_or_topic"), "audience": canonical.get("target_audience"), "objective": canonical.get("objective"), "platform": dpc.get("platform"),
            "duration": dpc.get("target_duration_seconds"), "cta": bool(canonical.get("desired_cta")), "tone": list(canonical.get("tone_style_constraints") or []),
            "mandatory": list(canonical.get("mandatory_points") or []), "prohibited": list(canonical.get("prohibited_claims_or_elements") or [])}


def score_lesson(rec: LearningRecord, origin: dict, brief: dict) -> dict:
    """{score, relevant, reasons[], conflicts[]}. Pure and deterministic. A conflict is a HARD one: the lesson cannot be applied to this brief as written."""
    fam = family(rec.rec_key)
    reasons: list[str] = []
    conflicts: list[str] = []
    score = 0.0
    platform = " ".join(str(x) for x in (brief.get("platform"), brief.get("product")) if x)
    dur = brief.get("duration")
    prohibited = " ".join(brief.get("prohibited") or [])

    if fam in ("reading-speed", "text-size", "contrast"):
        if _TEXT_WORDS.search(prohibited):      # the brief's PROHIBITED list names text/captions/subtitles: they are never to be used
            conflicts.append("Your brief rules out on-screen text, so a lesson about text cannot be applied as written.")
        base = {"reading-speed": 0.35, "contrast": 0.25, "text-size": 0.25}[fam]
        if fam == "text-size" and not _MOBILE.search(platform):
            base = 0.1
        score += base
        reasons.append("Concerns on-screen text, which most short videos use." if fam != "text-size" else "Concerns text size on a phone screen.")
    elif fam == "shorter-cut":
        if dur is None:
            score += 0.1; reasons.append("Concerns video length, but your brief sets no target duration.")
        elif dur <= 10:
            conflicts.append("Your target duration is already 10 seconds or less.")
        else:
            score += 0.35; reasons.append(f"Concerns video length; your target is {dur:g} seconds.")
    elif fam == "alt-cta":
        if not brief.get("cta"):
            conflicts.append("Your brief has no call to action, so a lesson about calls to action does not apply.")
        else:
            score += 0.3; reasons.append("Concerns the call to action, and your brief has one.")
    elif fam == "alt-opening-hook":
        score += 0.2; reasons.append("Concerns the opening of the video, which every video has.")
    elif fam == "footage-variety":
        score += 0.15; reasons.append("Concerns footage variety.")
    else:
        score += 0.1; reasons.append("A general lesson.")

    if rec.basis == "evidence":
        score += 0.1; reasons.append("Based on something measured in your earlier video (not an audience result).")
    if origin.get("platform") and brief.get("platform") and origin["platform"].lower().split()[0] in str(brief["platform"]).lower():
        score += 0.2; reasons.append(f"Your earlier video was made for the same platform ({origin['platform']}).")
    shared = sorted(_tokens(origin.get("topic"), origin.get("audience"), origin.get("objective")) & _tokens(brief.get("product"), brief.get("audience"), brief.get("objective")))
    if shared:
        score += min(0.25, 0.08 * len(shared)); reasons.append("Similar subject matter to your earlier video: " + ", ".join(shared[:5]) + ".")
    score = round(min(score, 1.0), 2)
    return {"score": score, "relevant": score >= RELEVANT_AT and not conflicts, "reasons": reasons, "conflicts": conflicts}


def lesson_view(rec: LearningRecord, origin: dict, relevance: dict | None = None) -> dict:
    c = classify(rec)
    return {
        "lesson_id": rec.id, "text": rec.text, "basis": rec.basis, **c, "confidence": confidence_of(rec), "evidence": list(rec.evidence or []), "caveat": rec.caveat, "user_note": rec.note,
        "rule_version": rec.rule_version, "rec_key": rec.rec_key,
        "source": {"draft_id": rec.draft_id, "draft_name": rec.draft_name, "blueprint_id": rec.blueprint_id, "reference_video_id": rec.reference_video_id, "platform": origin.get("platform"),
                   "accepted_at": rec.updated_at.isoformat() if rec.updated_at else None},
        "relevance": relevance, "notice": LESSONS_POLICY,
    }


class LessonUnavailable(Exception):
    """A selected lesson is not an accepted lesson belonging to this user."""


async def _accepted(db: AsyncSession, user: User, ids: list[int] | None = None) -> list[tuple[LearningRecord, dict]]:
    q = select(LearningRecord).where(LearningRecord.user_id == user.id, LearningRecord.status == "accepted")
    if ids is not None:
        q = q.where(LearningRecord.id.in_(ids or [-1]))
    recs = list((await db.execute(q.order_by(LearningRecord.id))).scalars().all())
    draft_ids = {r.draft_id for r in recs if r.draft_id is not None}
    drafts = {d.id: d for d in (await db.execute(select(VideoStudioDraft).where(VideoStudioDraft.user_id == user.id, VideoStudioDraft.id.in_(draft_ids or [-1])))).scalars().all()}
    return [(r, origin_of(drafts.get(r.draft_id), r)) for r in recs]


async def rank_lessons(db: AsyncSession, user: User, brief: dict) -> list[dict]:
    """All of the person's accepted lessons, most relevant first, each with why. Never another user's."""
    out = []
    for rec, origin in await _accepted(db, user):
        out.append(lesson_view(rec, origin, score_lesson(rec, origin, brief)))
    return sorted(out, key=lambda v: (-v["relevance"]["score"], -v["lesson_id"]))


async def load_selected(db: AsyncSession, user: User, ids: list[int], canonical_intent: dict) -> list[dict]:
    """The lessons the person chose for a blueprint, in id order. Raises LessonUnavailable unless EVERY id is an accepted lesson of this user (the message never reveals whether an id exists for someone else)."""
    ids = sorted(set(ids))
    if not ids:
        return []
    if len(ids) > MAX_LESSONS:
        raise LessonUnavailable(f"Choose at most {MAX_LESSONS} lessons.")
    found = await _accepted(db, user, ids)
    if {r.id for r, _ in found} != set(ids):
        raise LessonUnavailable("One or more selected lessons are not available. Reload the lessons and choose again.")
    brief = brief_from_intent(canonical_intent)
    return [lesson_view(rec, origin, score_lesson(rec, origin, brief)) for rec, origin in found]


def lessons_digest(lessons: list[dict]) -> str | None:
    """Identity of a selection (ids + wording): a different selection is a different blueprint."""
    if not lessons:
        return None
    key = [{"id": l["lesson_id"], "text": l["text"], "conflicts": l["relevance"]["conflicts"] if l.get("relevance") else []} for l in lessons]
    return hashlib.sha256(json.dumps(key, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def provider_guidance(lessons: list[dict]) -> list[dict]:
    """What the AI is shown for each selected lesson: the guidance, how sure we are, and any conflict. No names of earlier videos, no audience claims."""
    return [{"lesson_id": l["lesson_id"], "guidance": l["text"], "kind": l["classification_label"], "qualifiers": l["qualifier_labels"], "confidence": l["confidence"]["level"],
             "measured_basis": l["evidence"][:3], "caveat": l["caveat"], "person_note": l["user_note"], "conflicts_with_this_brief": (l.get("relevance") or {}).get("conflicts", [])} for l in lessons]
