"""C4 -- RECONSTRUCTION BLUEPRINT V1: orchestration + durable persistence.

Wires, for one exact VideoAnalysis and one NewContentIntent, the pieces in the order they require -- adding no
reasoning of its own:
  1. `normalize_intent` -- the NewContentIntent is validated (required: product_service_or_topic, target_audience,
     objective) and canonicalised + hashed. Invalid -> BlueprintInputError (HTTP 422).
  2. `content_anatomy_svc.get_content_anatomy` -- the C2 anatomy. Zero sections -> 422. An optional
     `expected_anatomy_fingerprint` pins the anatomy the caller saw; a mismatch -> BlueprintStateConflict (409).
  3. `transferable_mechanism_svc.get_effective_mechanisms` -- the persisted C3 effective result, which must be `current`
     against that anatomy. never run / stale / unknown -> BlueprintStateConflict (409); an optional
     `expected_mechanism_attempt_id` pin that differs -> 409; zero mechanisms -> 422 (nothing transferable to plan from).
  4. COST CONTROL: if the effective blueprint was already produced from THIS anatomy fingerprint + C3 attempt + intent hash
     by the SAME provider/model/prompt version, it is returned as-is (`reused`, no provider call). `force=True` re-derives.
  5. `blueprint_reasoner.derive_blueprint` -- ONE provider call, then the provider-independent deterministic validation.
     A BlueprintReasoningError (unconfigured provider, malformed / truncated response, any safeguard violation) propagates
     unchanged and NOTHING is persisted, so the prior effective blueprint is untouched.
  6. DURABLE ATTEMPT -- appended (committed) for EVERY validated blueprint. Append-only; never deleted or overwritten.
  7. ATOMIC REPLACE of the EFFECTIVE blueprint (one row) in a single commit.

PERSISTENCE reuses the generic `AnalysisAnnotation` table exactly as C3 / Stage 11.x do (open `category`, a `details` JSON):
no new table, no migration. All rows are certainty="INFERRED".

STALENESS: the effective blueprint records the anatomy fingerprint and the C3 reasoning-attempt id it was derived from. A read
compares them with the CURRENT anatomy and the CURRENT effective C3 result and reports `current`, `stale` or `unknown`; a stale
blueprint is still returned (never hidden).
"""
import copy
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.reference_video import ReferenceVideo
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.blueprint_reasoner import (
    BlueprintInputError, build_context, derive_blueprint, finalize_blueprint, intent_hash, normalize_intent,
)
from app.services.blueprint_reasoner.contract import BLUEPRINT_VERSION
from app.services.blueprint_reasoner.providers.anthropic_provider import BLUEPRINT_PROMPT_VERSION
from app.services.content_anatomy_svc import ContentAnatomyError, get_content_anatomy
from app.services.deconstruction_orchestrator_svc import OrchestrationNotFound
from app.services.mechanism_reasoner import MechanismInputError
from app.services.mechanism_reasoner.anatomy_input import validate_anatomy_input
from app.services.transferable_mechanism_svc import get_effective_mechanisms

BLUEPRINT_ATTEMPT_CATEGORY = "blueprint_reasoning_attempt"
BLUEPRINT_CATEGORY = "reconstruction_blueprint"
BLUEPRINT_PASS_NAME = "blueprint_derivation_v1"


class BlueprintStateConflict(Exception):
    """The pinned / required upstream state is not usable: the C3 mechanisms were never derived, are stale against the current
    anatomy, or the caller's pinned anatomy fingerprint / mechanism attempt no longer matches. Mapped to HTTP 409; nothing is
    derived or persisted."""


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _reuse_key(anatomy_fp: str, mechanism_attempt_id: int, ihash: str, provider: str, model: str, prompt_version: str) -> dict:
    return {"anatomy_fingerprint": anatomy_fp, "mechanism_attempt_id": mechanism_attempt_id, "intent_hash": ihash,
            "provider": provider, "model": model, "prompt_version": prompt_version}


async def _load_effective(db: AsyncSession, va_id: int) -> AnalysisAnnotation | None:
    return (await db.execute(
        select(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == BLUEPRINT_CATEGORY)
        .order_by(AnalysisAnnotation.id.desc()).limit(1).execution_options(populate_existing=True))).scalars().first()


async def _load_attempts(db: AsyncSession, va_id: int) -> list[AnalysisAnnotation]:
    """The FULL append-only attempt history, oldest first. Never deletes or mutates."""
    return list((await db.execute(
        select(AnalysisAnnotation).where(AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == BLUEPRINT_ATTEMPT_CATEGORY)
        .order_by(AnalysisAnnotation.created_at, AnalysisAnnotation.id).execution_options(populate_existing=True))).scalars().all())


def _compose(row: AnalysisAnnotation | None, *, rv_id: int, va_id: int, current_fp: str | None, current_mech_attempt: int | None,
             reused: bool, llm_calls: int) -> dict:
    if row is None:
        return {"status": "not_run", "reused": False, "reference_video_id": rv_id, "video_analysis_id": va_id,
                "input_pin": {"anatomy_fingerprint": None, "current_anatomy_fingerprint": current_fp, "mechanism_attempt_id": None,
                              "current_mechanism_attempt_id": current_mech_attempt, "intent_hash": None},
                "blueprint": None, "provenance": None}
    d = row.details
    if current_fp is None:
        status = "unknown"
    elif d.get("anatomy_fingerprint") == current_fp and d.get("mechanism_attempt_id") == current_mech_attempt:
        status = "current"
    else:
        status = "stale"
    return {
        "status": status, "reused": reused, "reference_video_id": rv_id, "video_analysis_id": va_id,
        "input_pin": {"anatomy_fingerprint": d.get("anatomy_fingerprint"), "current_anatomy_fingerprint": current_fp,
                      "mechanism_attempt_id": d.get("mechanism_attempt_id"), "current_mechanism_attempt_id": current_mech_attempt,
                      "intent_hash": d.get("intent_hash")},
        "blueprint": d.get("blueprint"),
        "provenance": {
            "reasoning_attempt_id": d.get("reasoning_attempt_id"), "provider": d.get("provider"), "model": d.get("model"),
            "prompt_version": d.get("prompt_version"), "blueprint_version": d.get("blueprint_version"),
            "taxonomy_version": d.get("taxonomy_version"), "certainty": "INFERRED", "llm_calls": llm_calls, "persisted": True,
            "effective_since": _iso(row.created_at),
        },
    }


async def _resolve_video_analysis(db: AsyncSession, user_id: int, rv_id: int, va_id: int | None) -> VideoAnalysis:
    rv = (await db.execute(select(ReferenceVideo).where(ReferenceVideo.id == rv_id, ReferenceVideo.user_id == user_id))).scalar_one_or_none()
    if rv is None:
        raise OrchestrationNotFound("Reference video not found")
    if va_id is None:
        va = (await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id)
                               .order_by(VideoAnalysis.created_at.desc(), VideoAnalysis.id.desc()).limit(1))).scalars().first()
    else:
        va = (await db.execute(select(VideoAnalysis).where(VideoAnalysis.id == va_id, VideoAnalysis.reference_video_id == rv.id))).scalar_one_or_none()
    if va is None:
        raise OrchestrationNotFound("No matching analysis record exists for this reference video")
    return va


async def get_effective_blueprint(db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None) -> dict:
    """Pure read of the EFFECTIVE blueprint with a current/stale/unknown comparison against the current anatomy and current C3
    result. Never calls a provider. Raises OrchestrationNotFound for an unknown/foreign video or analysis."""
    user_id = user.id
    va = await _resolve_video_analysis(db, user_id, reference_video_id, video_analysis_id)
    va_id = va.id
    row = await _load_effective(db, va_id)
    mech = await get_effective_mechanisms(db, user, reference_video_id, video_analysis_id=va_id)
    return _compose(row, rv_id=reference_video_id, va_id=va_id, current_fp=(mech.get("input_pin") or {}).get("current_anatomy_fingerprint"),
                    current_mech_attempt=(mech.get("provenance") or {}).get("reasoning_attempt_id"), reused=False, llm_calls=0)


async def list_blueprint_attempts(db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None) -> dict:
    """The full append-only attempt history (newest last), each with its blueprint and whether it is the effective one."""
    va = await _resolve_video_analysis(db, user.id, reference_video_id, video_analysis_id)
    row = await _load_effective(db, va.id)
    effective_id = row.details.get("reasoning_attempt_id") if row is not None else None
    return {
        "reference_video_id": reference_video_id, "video_analysis_id": va.id, "effective_attempt_id": effective_id,
        "attempts": [{
            "attempt_id": a.id, "created_at": _iso(a.created_at), "is_effective": a.id == effective_id,
            "anatomy_fingerprint": a.details.get("anatomy_fingerprint"), "mechanism_attempt_id": a.details.get("mechanism_attempt_id"),
            "intent_hash": a.details.get("intent_hash"), "provider": a.details.get("provider"), "model": a.details.get("model"),
            "prompt_version": a.details.get("prompt_version"), "section_count": a.details.get("section_count"),
            "mechanisms_used": a.details.get("mechanisms_used") or [], "blueprint": a.details.get("blueprint"),
        } for a in await _load_attempts(db, va.id)],
    }


async def derive_and_persist_blueprint(
    db: AsyncSession, user: User, reference_video_id: int, intent, *, video_analysis_id: int | None = None,
    expected_anatomy_fingerprint: str | None = None, expected_mechanism_attempt_id: int | None = None, force: bool = False,
) -> dict:
    """C4's single entry point. See the module docstring for the order of operations and the error contract.
    Raises BlueprintInputError (422), OrchestrationNotFound (404), ContentAnatomyError incl. NotReady (422), BlueprintStateConflict
    (409), BlueprintReasoningError (no/failed/invalid reasoner -- nothing persisted)."""
    canonical = normalize_intent(intent)
    ihash = intent_hash(canonical)

    anatomy = await get_content_anatomy(db, user, reference_video_id, video_analysis_id=video_analysis_id)
    try:
        validate_anatomy_input(anatomy)
    except MechanismInputError as exc:
        raise BlueprintInputError(str(exc)) from exc
    fingerprint = anatomy["provenance"]["fingerprint"]
    va_id = anatomy["provenance"]["video_analysis_id"]
    if expected_anatomy_fingerprint is not None and expected_anatomy_fingerprint != fingerprint:
        raise BlueprintStateConflict(
            f"The anatomy has changed since it was read (expected fingerprint {expected_anatomy_fingerprint[:12]}..., current "
            f"{fingerprint[:12]}...). Re-read /anatomy and retry.")

    mech = await get_effective_mechanisms(db, user, reference_video_id, video_analysis_id=va_id)
    if mech["status"] == "not_run":
        raise BlueprintStateConflict("Transferable mechanisms have not been derived for this analysis. Run POST /mechanisms first.")
    if mech["status"] != "current":
        raise BlueprintStateConflict(
            f"The effective C3 mechanism result is {mech['status']!r} against the current anatomy (it was derived from anatomy "
            f"{str((mech['input_pin'] or {}).get('anatomy_fingerprint'))[:12]}...). Re-derive mechanisms (POST /mechanisms) before building a blueprint.")
    mech_prov = mech["provenance"] or {}
    mech_attempt_id = mech_prov.get("reasoning_attempt_id")
    if expected_mechanism_attempt_id is not None and expected_mechanism_attempt_id != mech_attempt_id:
        raise BlueprintStateConflict(
            f"The effective C3 result is attempt {mech_attempt_id}, not the pinned attempt {expected_mechanism_attempt_id}.")
    mechanisms = mech["mechanisms"]
    if not mechanisms:
        raise BlueprintInputError(
            "The effective C3 result contains no transferable mechanisms, so there is no transferable principle to build a blueprint "
            "from. C4 does not invent structure; improve or re-derive the mechanisms first.")

    if not force:
        row = await _load_effective(db, va_id)
        if row is not None:
            d = row.details
            want = _reuse_key(fingerprint, mech_attempt_id, ihash, settings.BLUEPRINT_REASONER_PROVIDER, settings.BLUEPRINT_REASONER_MODEL,
                              BLUEPRINT_PROMPT_VERSION)
            if all(d.get(k) == v for k, v in want.items()):
                return _compose(row, rv_id=reference_video_id, va_id=va_id, current_fp=fingerprint, current_mech_attempt=mech_attempt_id,
                                reused=True, llm_calls=0)

    ctx = build_context(anatomy, mechanisms, canonical)
    result = await derive_blueprint(ctx)  # BlueprintReasoningError here persists nothing -- see module docstring
    pins = {
        "reference_video_id": reference_video_id, "video_analysis_id": va_id, "anatomy_fingerprint": fingerprint,
        "anatomy_version": anatomy["provenance"].get("anatomy_version"), "mechanism_attempt_id": mech_attempt_id,
        "mechanism_provider": mech_prov.get("provider"), "mechanism_model": mech_prov.get("model"),
        "mechanism_prompt_version": mech_prov.get("prompt_version"), "taxonomy_version": mech_prov.get("taxonomy_version"),
        "intent_hash": ihash, "provider": result.provider, "model": result.model, "prompt_version": result.reasoning_contract_version,
    }
    blueprint = finalize_blueprint(result.decision, ctx, pins, mech.get("overall_limitations") or [])
    duration = float((anatomy.get("video") or {}).get("duration") or 0.0)
    common = {
        "reference_video_id": reference_video_id, "anatomy_fingerprint": fingerprint, "anatomy_version": pins["anatomy_version"],
        "mechanism_attempt_id": mech_attempt_id, "taxonomy_version": pins["taxonomy_version"], "intent_hash": ihash,
        "provider": result.provider, "model": result.model, "prompt_version": result.reasoning_contract_version,
        "blueprint_version": BLUEPRINT_VERSION, "section_count": len(blueprint["sections"]), "mechanisms_used": blueprint["mechanisms_used"],
    }

    # Durable, append-only attempt FIRST (committed) -- before the effective blueprint is ever touched.
    attempt = AnalysisAnnotation(
        video_analysis_id=va_id, shot_id=None, category=BLUEPRINT_ATTEMPT_CATEGORY, start_time=0.0, end_time=duration,
        details={**common, "blueprint": copy.deepcopy(blueprint)}, certainty="INFERRED", confidence_score=None,   # its own copy: see below
        reasoning=f"blueprint {blueprint['blueprint_id']}: {len(blueprint['sections'])} section(s), mechanisms {blueprint['mechanisms_used']}",
        source="ai_reasoning", produced_by_pass=BLUEPRINT_PASS_NAME,
    )
    db.add(attempt)
    await db.flush()
    attempt_id = attempt.id
    blueprint["provenance"]["reasoning_attempt_id"] = attempt_id
    attempt.details = {**common, "blueprint": copy.deepcopy(blueprint)}   # a NEW value, so the change is detected and persisted
    await db.commit()

    # ATOMIC REPLACE of the effective blueprint in a single commit.
    await db.execute(delete(AnalysisAnnotation).where(
        AnalysisAnnotation.video_analysis_id == va_id, AnalysisAnnotation.category == BLUEPRINT_CATEGORY))
    db.add(AnalysisAnnotation(
        video_analysis_id=va_id, shot_id=None, category=BLUEPRINT_CATEGORY, start_time=0.0, end_time=duration,
        details={**common, "reasoning_attempt_id": attempt_id, "blueprint": copy.deepcopy(blueprint)}, certainty="INFERRED", confidence_score=None,
        reasoning=attempt.reasoning, source="ai_reasoning", produced_by_pass=BLUEPRINT_PASS_NAME,
    ))
    await db.commit()

    row = await _load_effective(db, va_id)
    return _compose(row, rv_id=reference_video_id, va_id=va_id, current_fp=fingerprint, current_mech_attempt=mech_attempt_id,
                    reused=False, llm_calls=1)
