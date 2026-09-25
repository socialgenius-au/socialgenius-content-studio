"""C3 -- TRANSFERABLE MECHANISM V1: orchestration + durable persistence.

Wires, for one exact VideoAnalysis, the pieces in the order they require -- adding no reasoning of its own:
  1. `content_anatomy_svc.get_content_anatomy` -- the ONLY evidence input (the C2 response). C3 never reads raw
     Stage 3-11 evidence. Zero sections -> MechanismInputError (HTTP 422). An optional `expected_fingerprint`
     pins the call to the exact anatomy the caller saw; a mismatch -> MechanismAnatomyChanged (HTTP 409).
  2. COST CONTROL: if the effective result for this VideoAnalysis was already produced from THIS anatomy
     fingerprint by the SAME provider/model/prompt version, it is returned as-is (`reused`, no provider call).
     `force=True` re-derives.
  3. `mechanism_reasoner.derive_mechanisms` -- ONE provider call per anatomy, then the provider-independent
     validation. A MechanismReasoningError (unconfigured provider, malformed response, any safeguard violation)
     propagates unchanged and NOTHING is persisted, so the prior effective result is untouched (Stage 10/11
     convention).
  4. DURABLE ATTEMPT -- appended (committed) for EVERY successfully validated result, including
     `mechanisms == []`. Append-only: never deleted or overwritten; the full audit trail of what was derived,
     from which anatomy fingerprint, by which provider/model/prompt.
  5. ATOMIC REPLACE of the EFFECTIVE result: the previous effective set (one `mechanism_set` summary row + one
     `transferable_mechanism` row per mechanism) is deleted and the new one written in a single commit. The
     summary row exists even when there are zero mechanisms, so "ran and found none" is distinguishable from
     "never ran".

PERSISTENCE REUSES the generic `AnalysisAnnotation` table exactly as Stage 11.3/11.4 do (open `category`, a
`details` JSON, `certainty`, `reasoning`, `produced_by_pass`): no new table, no migration. All rows are
certainty="INFERRED".

STALENESS: the effective set records the anatomy fingerprint it was derived from. A read compares it with the
CURRENT anatomy's fingerprint and reports `current` or `stale`; a stale result is still returned (never
silently hidden), and C4 pins the fingerprint it consumed.
"""
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.reference_video import ReferenceVideo
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.content_anatomy_svc import ContentAnatomyError, get_content_anatomy
from app.services.deconstruction_orchestrator_svc import OrchestrationNotFound
from app.services.mechanism_reasoner import TAXONOMY_VERSION, derive_mechanisms
from app.services.mechanism_reasoner.anatomy_input import validate_anatomy_input
from app.services.mechanism_reasoner.providers.anthropic_provider import MECHANISM_PROMPT_VERSION
from app.services.mechanism_reasoner.validation import derive_overall_limitations, finalize_mechanisms

MECHANISM_ATTEMPT_CATEGORY = "mechanism_reasoning_attempt"
MECHANISM_SET_CATEGORY = "mechanism_set"
MECHANISM_CATEGORY = "transferable_mechanism"
MECHANISM_PASS_NAME = "mechanism_derivation_v1"


class MechanismAnatomyChanged(Exception):
    """The caller pinned an anatomy fingerprint, but the current anatomy differs (evidence changed since the
    caller read it). Mapped to HTTP 409; nothing is derived or persisted."""


def _rows_span(mechanism: dict, anatomy: dict) -> tuple[float, float]:
    """The time span a mechanism row covers: the union of its cited sections, or the whole video for a
    video-scoped mechanism with no cited sections."""
    sections = {s["number"]: s for s in anatomy.get("sections") or [] if isinstance(s, dict) and isinstance(s.get("number"), int)}
    cited = [sections[n] for n in mechanism["section_numbers"] if n in sections]
    if cited:
        return float(min(s["start_time"] for s in cited)), float(max(s["end_time"] for s in cited))
    return 0.0, float((anatomy.get("video") or {}).get("duration") or 0.0)


async def _load_effective_rows(db: AsyncSession, video_analysis_id: int) -> tuple[AnalysisAnnotation | None, list[AnalysisAnnotation]]:
    rows = (await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category.in_([MECHANISM_SET_CATEGORY, MECHANISM_CATEGORY]),
        ).order_by(AnalysisAnnotation.id).execution_options(populate_existing=True)
    )).scalars().all()
    set_row = next((r for r in rows if r.category == MECHANISM_SET_CATEGORY), None)
    return set_row, [r for r in rows if r.category == MECHANISM_CATEGORY]


async def _load_attempts(db: AsyncSession, video_analysis_id: int) -> list[AnalysisAnnotation]:
    """Every durable mechanism reasoning attempt for this VideoAnalysis, oldest first -- the FULL history, never
    filtered to 'latest only'. Never deletes or mutates."""
    return list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == MECHANISM_ATTEMPT_CATEGORY,
        ).order_by(AnalysisAnnotation.created_at, AnalysisAnnotation.id).execution_options(populate_existing=True)
    )).scalars().all())


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _compose(set_row: AnalysisAnnotation | None, rows: list[AnalysisAnnotation], attempt: AnalysisAnnotation | None, *,
             reference_video_id: int, video_analysis_id: int, current_fingerprint: str | None, reused: bool, llm_calls: int) -> dict:
    if set_row is None:
        return {
            "status": "not_run", "reused": False, "reference_video_id": reference_video_id, "video_analysis_id": video_analysis_id,
            "input_pin": {"anatomy_fingerprint": None, "current_anatomy_fingerprint": current_fingerprint, "anatomy_version": None},
            "mechanism_count": 0, "mechanisms": [], "overall_limitations": [], "anatomy_gaps": [], "provenance": None,
        }
    d = set_row.details
    if current_fingerprint is None:
        status = "unknown"
    else:
        status = "current" if d.get("anatomy_fingerprint") == current_fingerprint else "stale"
    mechanisms = [r.details["mechanism"] for r in rows]
    return {
        "status": status, "reused": reused, "reference_video_id": reference_video_id, "video_analysis_id": video_analysis_id,
        "input_pin": {"anatomy_fingerprint": d.get("anatomy_fingerprint"), "current_anatomy_fingerprint": current_fingerprint,
                      "anatomy_version": d.get("anatomy_version")},
        "mechanism_count": len(mechanisms), "mechanisms": mechanisms,
        "overall_limitations": d.get("overall_limitations") or [],
        "anatomy_gaps": (attempt.details.get("anatomy_gaps") if attempt is not None else None) or [],
        "provenance": {
            "reasoning_attempt_id": d.get("reasoning_attempt_id"), "provider": d.get("provider"), "model": d.get("model"),
            "prompt_version": d.get("prompt_version"), "taxonomy_version": d.get("taxonomy_version"),
            "certainty": "INFERRED", "llm_calls": llm_calls, "persisted": True, "effective_since": _iso(set_row.created_at),
        },
    }


async def _resolve_video_analysis(db: AsyncSession, user_id: int, reference_video_id: int, video_analysis_id: int | None) -> VideoAnalysis:
    rv = (await db.execute(select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user_id))).scalar_one_or_none()
    if rv is None:
        raise OrchestrationNotFound("Reference video not found")
    if video_analysis_id is None:
        va = (await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id)
                               .order_by(VideoAnalysis.created_at.desc(), VideoAnalysis.id.desc()).limit(1))).scalars().first()
    else:
        va = (await db.execute(select(VideoAnalysis).where(VideoAnalysis.id == video_analysis_id,
                                                           VideoAnalysis.reference_video_id == rv.id))).scalar_one_or_none()
    if va is None:
        raise OrchestrationNotFound("No matching analysis record exists for this reference video")
    return va


async def get_effective_mechanisms(db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None) -> dict:
    """Pure read of the EFFECTIVE mechanism result, with a current/stale/unknown comparison against the current
    anatomy. Never calls a provider. Raises OrchestrationNotFound for an unknown/foreign video or analysis."""
    user_id = user.id
    va = await _resolve_video_analysis(db, user_id, reference_video_id, video_analysis_id)
    va_id = va.id
    set_row, rows = await _load_effective_rows(db, va_id)
    attempt = None
    if set_row is not None:
        attempt_id = set_row.details.get("reasoning_attempt_id")
        attempt = next((a for a in await _load_attempts(db, va_id) if a.id == attempt_id), None)
    try:
        current = (await get_content_anatomy(db, user, reference_video_id, video_analysis_id=va_id))["provenance"]["fingerprint"]
    except ContentAnatomyError:
        current = None
    return _compose(set_row, rows, attempt, reference_video_id=reference_video_id, video_analysis_id=va_id,
                    current_fingerprint=current, reused=False, llm_calls=0)


async def list_mechanism_attempts(db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None) -> dict:
    """The full, append-only attempt history (newest last), each with the mechanisms it produced and whether it
    is the currently effective one."""
    va = await _resolve_video_analysis(db, user.id, reference_video_id, video_analysis_id)
    set_row, _ = await _load_effective_rows(db, va.id)
    effective_id = set_row.details.get("reasoning_attempt_id") if set_row is not None else None
    attempts = await _load_attempts(db, va.id)
    return {
        "reference_video_id": reference_video_id, "video_analysis_id": va.id, "effective_attempt_id": effective_id,
        "attempts": [{
            "attempt_id": a.id, "created_at": _iso(a.created_at), "is_effective": a.id == effective_id,
            "anatomy_fingerprint": a.details.get("anatomy_fingerprint"), "provider": a.details.get("provider"),
            "model": a.details.get("model"), "prompt_version": a.details.get("prompt_version"),
            "mechanism_count": a.details.get("mechanism_count"), "mechanisms": a.details.get("mechanisms") or [],
            "overall_limitations": a.details.get("overall_limitations") or [],
        } for a in attempts],
    }


async def derive_and_persist_mechanisms(
    db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None,
    expected_fingerprint: str | None = None, force: bool = False,
) -> dict:
    """C3's single entry point. See the module docstring for the order of operations and error contract.
    Raises OrchestrationNotFound (404), ContentAnatomyError incl. ContentAnatomyNotReady (422), MechanismInputError
    (422, e.g. zero sections), MechanismAnatomyChanged (409), MechanismReasoningError (no/failed/invalid reasoner
    -- nothing persisted)."""
    anatomy = await get_content_anatomy(db, user, reference_video_id, video_analysis_id=video_analysis_id)
    validate_anatomy_input(anatomy)
    fingerprint = anatomy["provenance"]["fingerprint"]
    va_id = anatomy["provenance"]["video_analysis_id"]
    if expected_fingerprint is not None and expected_fingerprint != fingerprint:
        raise MechanismAnatomyChanged(
            f"The anatomy has changed since it was read (expected fingerprint {expected_fingerprint[:12]}..., current "
            f"{fingerprint[:12]}...). Re-read /anatomy and retry."
        )

    if not force:
        set_row, rows = await _load_effective_rows(db, va_id)
        if set_row is not None:
            d = set_row.details
            if (d.get("anatomy_fingerprint") == fingerprint and d.get("prompt_version") == MECHANISM_PROMPT_VERSION
                    and d.get("provider") == settings.MECHANISM_REASONER_PROVIDER and d.get("model") == settings.MECHANISM_REASONER_MODEL):
                attempt = next((a for a in await _load_attempts(db, va_id) if a.id == d.get("reasoning_attempt_id")), None)
                return _compose(set_row, rows, attempt, reference_video_id=reference_video_id, video_analysis_id=va_id,
                                current_fingerprint=fingerprint, reused=True, llm_calls=0)

    result = await derive_mechanisms(anatomy)  # MechanismReasoningError here persists nothing -- see module docstring
    provenance = {"provider": result.provider, "model": result.model, "prompt_version": result.reasoning_contract_version}
    mechanisms = finalize_mechanisms(result.decision, anatomy, provenance)
    overall = derive_overall_limitations(anatomy, result.decision)
    duration = float((anatomy.get("video") or {}).get("duration") or 0.0)
    gaps = [{"field": g.get("field"), "kind": g.get("kind"), "reason": g.get("reason"), "section_number": g.get("section_number")}
            for g in anatomy.get("gaps") or []]
    common = {
        "anatomy_fingerprint": fingerprint, "anatomy_version": anatomy["provenance"].get("anatomy_version"),
        "taxonomy_version": TAXONOMY_VERSION, "provider": result.provider, "model": result.model,
        "prompt_version": result.reasoning_contract_version,
    }

    # Durable, append-only attempt FIRST (committed) -- before the effective set is ever touched, and for EVERY
    # validated result, including an empty one.
    attempt = AnalysisAnnotation(
        video_analysis_id=va_id, shot_id=None, category=MECHANISM_ATTEMPT_CATEGORY, start_time=0.0, end_time=duration,
        details={**common, "reference_video_id": reference_video_id, "mechanism_count": len(mechanisms), "mechanisms": mechanisms,
                 "overall_limitations": overall, "anatomy_gaps": gaps},
        certainty="INFERRED", confidence_score=None,
        reasoning=f"{len(mechanisms)} mechanism(s) derived from anatomy {fingerprint[:12]}",
        source="ai_reasoning", produced_by_pass=MECHANISM_PASS_NAME,
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)
    attempt_id = attempt.id

    # ATOMIC REPLACE of the effective set (summary row + one row per mechanism) in a single commit.
    await db.execute(delete(AnalysisAnnotation).where(
        AnalysisAnnotation.video_analysis_id == va_id,
        AnalysisAnnotation.category.in_([MECHANISM_SET_CATEGORY, MECHANISM_CATEGORY]),
    ))
    db.add(AnalysisAnnotation(
        video_analysis_id=va_id, shot_id=None, category=MECHANISM_SET_CATEGORY, start_time=0.0, end_time=duration,
        details={**common, "reasoning_attempt_id": attempt_id, "mechanism_count": len(mechanisms), "overall_limitations": overall},
        certainty="INFERRED", confidence_score=None, reasoning=attempt.reasoning, source="ai_reasoning", produced_by_pass=MECHANISM_PASS_NAME,
    ))
    for mechanism in mechanisms:
        start, end = _rows_span(mechanism, anatomy)
        db.add(AnalysisAnnotation(
            video_analysis_id=va_id, shot_id=None, category=MECHANISM_CATEGORY, start_time=start, end_time=end,
            details={"mechanism": mechanism, "reasoning_attempt_id": attempt_id, "anatomy_fingerprint": fingerprint},
            certainty="INFERRED", confidence_score=None, reasoning=mechanism["statement"], source="ai_reasoning",
            produced_by_pass=MECHANISM_PASS_NAME,
        ))
    await db.commit()

    set_row, rows = await _load_effective_rows(db, va_id)
    return _compose(set_row, rows, attempt, reference_video_id=reference_video_id, video_analysis_id=va_id,
                    current_fingerprint=fingerprint, reused=False, llm_calls=1)
