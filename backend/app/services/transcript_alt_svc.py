"""Alternative transcripts: a second, better-tuned LOCAL speech-to-text reading of the same audio, stored beside the original and never in place of it.

Why: reference 5131's speech was transcribed by Whisper `base` as "100% шод, bina-pani, bina-kemi-kul" (mixed scripts, engine log-probability -0.68). The same audio read by Whisper `small` gives clean Devanagari
(log-probability -0.27). Both are machine output. Neither is a verified quotation. This module keeps BOTH, records which engine/model/settings produced each, and says plainly what is and is not established.

Rules (they are asserted in tests):
  * The original speech segments are never modified or deleted. A "corrected" transcript is a separate record that names the original segments it re-reads.
  * An alternative is always `machine_transcript_unverified` and `quotable: false`. Better engine confidence makes it more PROBABLE, not verified. Only a human can verify wording.
  * Agreement between two readings is reported only when they are written in the same script; across scripts a character comparison would be meaningless, so it is reported as not comparable.
  * No AI provider and no paid service is involved: this runs the existing local Whisper engine (free compute, a few minutes of CPU the first time a model is downloaded).
"""
from __future__ import annotations

import difflib
import unicodedata

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.user import User
from app.services import speech_analysis_svc
from app.services.creative_reconcile import scripts_in
from app.services.deconstruction_aggregate_svc import build_full_deconstruction

ALT_CATEGORY = "transcript_alt"
PASS_NAME = "transcript_alt"
DEFAULT_ALT_MODEL = "small"
ALLOWED_MODELS = ("base", "small", "medium")          # `medium` needs ~5 GB RAM; refused unless explicitly asked for
STATUS = "machine_transcript_unverified"
MIN_LOGPROB_GAIN = 0.15                               # an alternative is preferred only if its engine log-probability is at least this much higher
LOW_LOGPROB = -0.6                                    # an engine log-probability below this is "low recognition confidence"


class TranscriptAltError(Exception):
    pass


def _norm(text: str) -> str:
    """Letters, combining marks (Devanagari/Arabic vowel signs are marks, which a regex word class would drop) and digits only; no punctuation, symbols or spaces."""
    return "".join(ch for ch in (text or "").lower() if unicodedata.category(ch)[0] in "LMN")


def agreement(a: str, b: str) -> dict:
    """Character-level similarity of two readings. Only meaningful when both use the same script; otherwise `value` is None and the reason says why."""
    sa, sb = scripts_in(a), scripts_in(b)
    if not _norm(a) or not _norm(b):
        return {"value": None, "comparable": False, "reason": "one of the readings is empty"}
    if sa != sb:
        return {"value": None, "comparable": False, "reason": f"the readings use different scripts ({'/'.join(sorted(sa)) or 'none'} vs {'/'.join(sorted(sb)) or 'none'}), so a character comparison would be meaningless"}
    return {"value": round(difflib.SequenceMatcher(None, _norm(a), _norm(b)).ratio(), 3), "comparable": True, "reason": None}


def mean_logprob(segments: list[dict]) -> float | None:
    vals = [(s.get("analysis_details") or {}).get("avg_logprob") for s in segments]
    vals = [v for v in vals if isinstance(v, (int, float))]
    return round(sum(vals) / len(vals), 4) if vals else None


def describe_quality(segments: list[dict]) -> dict:
    text = " ".join(str(s.get("text") or "") for s in segments)
    sc = scripts_in(text)
    lp = mean_logprob(segments)
    reasons = []
    if lp is None:
        reasons.append("the engine recorded no log-probability")
    elif lp < LOW_LOGPROB:
        reasons.append(f"low engine log-probability ({lp:.2f})")
    if len(sc) >= 2:
        reasons.append("mixes " + " and ".join(sorted(sc)) + " characters")
    return {"mean_avg_logprob": lp, "scripts": sorted(sc), "reasons": reasons, "plausible": not reasons}


def choose_preferred(original: list[dict], alts: list[dict]) -> dict | None:
    """The alternative worth reading INSTEAD of the original for understanding the video (never for quoting), or None. An alternative must be at least as well-formed as the original and clearly more confident."""
    o = describe_quality(original)
    best = None
    for a in alts:
        q = a["quality"]
        if q["mean_avg_logprob"] is None:
            continue
        gain = q["mean_avg_logprob"] - (o["mean_avg_logprob"] if o["mean_avg_logprob"] is not None else -9.0)
        better_form = (not o["plausible"]) and q["plausible"]
        no_worse_form = q["plausible"] or not o["plausible"]          # never swap a well-formed reading for a malformed one
        if (gain >= MIN_LOGPROB_GAIN or better_form) and no_worse_form:
            if best is None or q["mean_avg_logprob"] > best["quality"]["mean_avg_logprob"]:
                best = a
    return best


def _row_view(row: AnalysisAnnotation) -> dict:
    d = row.details or {}
    return {"id": row.id, "start_time": row.start_time, "end_time": row.end_time, "text": row.reasoning or "", "model": d.get("model"), "language_hint": d.get("language_hint"),
            "detected_language": d.get("detected_language"), "analysis_details": d.get("analysis_details") or {}, "run_id": d.get("run_id"), "created_at": row.created_at}


def build_alternatives_view(original: list[dict], rows: list[AnalysisAnnotation]) -> dict:
    """Pure: the stored alternatives grouped per run (model + language hint), with quality, agreement with the original and the preferred one."""
    runs: dict[str, list[dict]] = {}
    for r in rows:
        v = _row_view(r)
        runs.setdefault(v["run_id"] or f"{v['model']}|{v['language_hint']}", []).append(v)
    orig_text = " ".join(str(s.get("text") or "") for s in original)
    alts = []
    for run_id, segs in runs.items():
        segs.sort(key=lambda s: s["start_time"])
        text = " ".join(s["text"] for s in segs)
        alts.append({
            "run_id": run_id, "model": segs[0]["model"], "language_hint": segs[0]["language_hint"], "detected_language": segs[0]["detected_language"], "engine": "whisper (local)",
            "status": STATUS, "quotable": False, "basis": "speech_to_text", "text": text,
            "segments": [{"id": s["id"], "start_time": s["start_time"], "end_time": s["end_time"], "text": s["text"]} for s in segs],
            "corrects_segment_ids": [s.get("id") for s in original if any(min(s["end_time"], o["end_time"]) - max(s["start_time"], o["start_time"]) > 0 for o in segs)],
            "quality": describe_quality([{"text": s["text"], "analysis_details": s["analysis_details"]} for s in segs]),
            "agreement_with_original": agreement(orig_text, text), "created_at": segs[0]["created_at"],
        })
    alts.sort(key=lambda a: (a["model"] != DEFAULT_ALT_MODEL, a["run_id"]))
    pref = choose_preferred(original, alts)
    oq = describe_quality(original)
    return {
        "original": {"engine": "whisper (local)", "model": next((s.get("model") for s in original if s.get("model")), None) or "base", "segment_ids": [s.get("id") for s in original], "quality": oq, "status": STATUS, "quotable": False},
        "alternatives": alts,
        "preferred_run_id": pref["run_id"] if pref else None,
        "policy": ("Both readings are machine output. The original is never replaced. The preferred alternative is the better-formed reading to UNDERSTAND the speech with; it is not a verified quotation and must not be quoted "
                   "or presented as what the speaker said. Only a human listening to the audio can verify wording."),
    }


async def load_alternative_rows(db: AsyncSession, va_id: int) -> list[AnalysisAnnotation]:
    return list((await db.execute(select(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == ALT_CATEGORY)
                                  .order_by(AnalysisAnnotation.start_time, AnalysisAnnotation.id))).scalars().all())


async def get_transcript_alternatives(db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None) -> dict:
    agg = await build_full_deconstruction(db, user, reference_video_id, video_analysis_id=video_analysis_id)
    original = list((agg["evidence"].model_dump(mode="json") if hasattr(agg["evidence"], "model_dump") else agg["evidence"]).get("speech_segments") or [])
    return build_alternatives_view(original, await load_alternative_rows(db, agg["video_analysis"]["id"]))


async def run_transcript_alternative(db: AsyncSession, user: User, reference_video_id: int, *, model: str = DEFAULT_ALT_MODEL, language: str | None = None,
                                     video_analysis_id: int | None = None, force: bool = False) -> dict:
    """Runs the local Whisper `model` (optionally with a language hint) on the reference's audio and stores the result as an alternative. Free local compute; no AI provider is called.
    Same model and hint already stored -> returned as is, unless `force`. Raises TranscriptAltError for an unsupported model or an unreadable file; nothing is stored on failure."""
    if model not in ALLOWED_MODELS:
        raise TranscriptAltError(f"Unsupported speech model {model!r}; choose one of {', '.join(ALLOWED_MODELS)}.")
    agg = await build_full_deconstruction(db, user, reference_video_id, video_analysis_id=video_analysis_id)
    va_id = agg["video_analysis"]["id"]
    evidence = agg["evidence"].model_dump(mode="json") if hasattr(agg["evidence"], "model_dump") else agg["evidence"]
    original = list(evidence.get("speech_segments") or [])
    run_id = f"{model}|{language or 'auto'}"
    existing = [r for r in await load_alternative_rows(db, va_id) if (r.details or {}).get("run_id") == run_id]
    if existing and not force:
        return build_alternatives_view(original, await load_alternative_rows(db, va_id))

    rv = (await db.execute(select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id))).scalar_one()
    asset = await db.get(Asset, rv.asset_id)
    if asset is None or not asset.file_path:
        raise TranscriptAltError("The reference video's file is not available on the server, so it cannot be transcribed again.")
    try:
        result = await speech_analysis_svc.analyze_speech(asset.file_path, language=language, model_name=model)
    except Exception as exc:  # noqa: BLE001 - nothing is stored on failure
        raise TranscriptAltError(f"The {model} speech model could not read this file: {exc}"[:500]) from exc

    await db.execute(delete(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == ALT_CATEGORY,
                                                      AnalysisAnnotation.id.in_([r.id for r in existing] or [-1])))
    for seg in result.get("segments", []):
        db.add(AnalysisAnnotation(
            video_analysis_id=va_id, shot_id=None, category=ALT_CATEGORY, start_time=seg["start_time"], end_time=max(seg["end_time"], seg["start_time"]), certainty="INFERRED", confidence_score=None,
            reasoning=seg["text"], evidence_summary=f"Local Whisper ({model}) re-reading of the audio; unverified machine transcript.", source="whisper", produced_by_pass=PASS_NAME,
            details={"run_id": run_id, "model": model, "language_hint": language, "detected_language": result.get("detected_language"), "status": STATUS, "quotable": False,
                     "analysis_details": seg.get("analysis_details") or {}, "engine": "whisper", "created_for": "alternative_to_original_transcript"}))
    await db.commit()
    return build_alternatives_view(original, await load_alternative_rows(db, va_id))
