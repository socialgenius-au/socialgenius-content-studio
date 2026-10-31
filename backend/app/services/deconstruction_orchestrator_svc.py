"""Video Deconstructor — C1: ONE-CLICK DECONSTRUCTION ORCHESTRATOR.

Turns the existing manual, one-endpoint-per-pass Deconstructor (Stages 3-11.4) into ONE coordinated
operation. This module adds NO analysis logic and NO new AI call of its own: every stage below is a
call THROUGH to an already-built, already-tested unit --
  * Stages 3-9 (14 passes): the existing `POST /reference-videos/{id}/analyze-*` handler functions in
    app.routers.reference_videos, called directly as Python coroutines. Those passes have no service
    layer of their own (their logic lives inline in the handlers), so reusing the handlers is the only
    way to reuse the real implementation without rewriting it. Each already owns its own state machine:
    a prerequisite check (HTTP 409), idempotent early-return when already complete, and failure
    recorded in `VideoAnalysis.pass_status` rather than raised.
  * Stage 10: `stage10_deconstruction_svc.run_stage10_pipeline`.
  * Stages 11.1-11.4: `compute_and_persist_editing_rhythm`, `derive_and_persist_hook_window`,
    `classify_and_persist_hook`, `classify_and_persist_retention_devices`.

DEPENDENCIES (`StageSpec.depends_on` = HARD, `after` = ORDER-ONLY). A stage whose hard dependency did
not finish is `blocked` -- never run, never silently skipped past. An `after` stage only fixes the
order (e.g. Stage 10 runs after the evidence passes so its candidates can see that evidence); if an
`after` stage failed, the dependent still runs (the underlying services degrade gracefully on missing
evidence) but the gap is reported explicitly in the stage's `degraded_inputs`, never hidden. Stages on
independent branches keep running when a sibling fails (e.g. an OCR failure does not stop speech).

AI STAGES ARE NEVER FORCED ON. Stage 10, 11.3 and 11.4 call a reasoner only when the operator has
already opted in through the existing `*_REASONER_PROVIDER` settings (all default to ""). Unconfigured
means `skipped` (a normal, reported state -- not a failure) -- but only when the stage actually NEEDS to
run; a stage whose results already exist reports `already_complete` regardless of configuration.

RERUN SAFETY. Completed Stage 3-9 passes are skipped (`already_complete`, handler not even called);
failed passes are retried by the handler's own retry logic. Derived stages (10, 11.1, 11.2, 11.3, 11.4)
are skipped when their results already exist, because most of them are delete-then-replace: re-running
one changes its row ids, which would silently orphan the provenance links other results hold (e.g. a
Stage 11.3 hook classification references its `hook_window_id`). Stage 10 / 11.1 / 11.2 ("on_input_change")
re-run only when an upstream stage was freshly (re)computed in THIS run -- e.g. OCR newly completing, or
Stage 10 newly producing Scenes. Paid stages 11.3 / 11.4 ("only_if_missing") never re-run automatically,
whatever changed upstream; `force_ai=True` re-runs them. Existing results are detected from the data
itself (not only this orchestrator's own records), so a video processed manually, before C1 existed, is
recognised and left untouched. A claim (`c1_orchestration` in
`pass_status`, taken under a row lock) prevents two orchestrations of the same video overlapping; a
claim older than ORCHESTRATION_STALE_SECONDS is treated as a crashed run and may be reclaimed.

ZERO RETENTION DEVICES IS SUCCESS. Stage 11.4 examining N candidates and accepting none is a
`complete` stage with valid data.

PERSISTENCE. Orchestration state lives in the existing `VideoAnalysis.pass_status` JSON under
`c1_orchestration` (run status/timestamps) and `c1_stages` (per-stage outcome of the last run) -- no
new table, no migration.
"""
from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.reference_video import ReferenceVideo
from app.models.user import User
from app.models.video_analysis import VideoAnalysis

ORCHESTRATION_STALE_SECONDS = 1800
ORCHESTRATION_KEY = "c1_orchestration"
STAGES_KEY = "c1_stages"

# Stage outcome vocabulary.
COMPLETE = "complete"
ALREADY_COMPLETE = "already_complete"
FAILED = "failed"
BLOCKED = "blocked"
SKIPPED = "skipped"
NOT_RUN = "not_run"
_OK_FOR_DEPENDENTS = {COMPLETE, ALREADY_COMPLETE}
_OK_FOR_OVERALL = {COMPLETE, ALREADY_COMPLETE, SKIPPED}


class OrchestrationError(Exception):
    """Base class for orchestration-level refusals (never a stage failure -- those are reported)."""


class OrchestrationNotFound(OrchestrationError):
    """Reference video does not exist (or is not owned by this user), or has no analysis record."""


class OrchestrationConflict(OrchestrationError):
    """Another orchestration of this video is already running."""


@dataclass(frozen=True)
class StageSpec:
    key: str
    label: str
    kind: str                       # "endpoint" (Stage 3-9 handler) | "service" (Stage 10/11.x)
    depends_on: tuple[str, ...] = ()  # HARD: must be complete/already_complete or this stage is blocked
    after: tuple[str, ...] = ()       # ORDER-ONLY: failure is reported as degraded input, not a block
    ai_settings: tuple[str, ...] = ()  # settings names that must all be non-empty, else skipped
    rerun: str = "skip_if_complete"    # skip_if_complete (endpoint) | on_input_change | only_if_missing


_EVIDENCE_AFTER = ("visual_evidence", "text_analysis", "speech_analysis", "audio_structure", "transition_evidence")

STAGES: tuple[StageSpec, ...] = (
    StageSpec("technical_probe", "Technical probe", "endpoint"),
    StageSpec("scene_segmentation", "Shot / cut detection", "endpoint", depends_on=("technical_probe",)),
    StageSpec("visual_evidence", "Keyframes", "endpoint", depends_on=("scene_segmentation",)),
    StageSpec("speech_analysis", "Speech transcription", "endpoint", depends_on=("technical_probe",)),
    StageSpec("audio_structure", "Audio structure", "endpoint", depends_on=("technical_probe",)),
    StageSpec("text_analysis", "On-screen text (OCR)", "endpoint", depends_on=("visual_evidence",)),
    StageSpec("visual_objects", "Visual objects", "endpoint", depends_on=("visual_evidence",)),
    StageSpec("visual_persistence", "Visual persistence", "endpoint", depends_on=("visual_objects",)),
    StageSpec("visual_composition", "Visual composition", "endpoint", depends_on=("visual_persistence",)),
    StageSpec("global_motion_evidence", "Global motion", "endpoint", depends_on=("scene_segmentation",)),
    StageSpec("transition_evidence", "Transition evidence", "endpoint", depends_on=("scene_segmentation",)),
    StageSpec("local_motion_evidence", "Local motion", "endpoint", depends_on=("scene_segmentation",)),
    StageSpec("local_motion_dynamics", "Local motion dynamics", "endpoint", depends_on=("scene_segmentation",)),
    StageSpec("transition_similarity_evidence", "Transition similarity", "endpoint", depends_on=("scene_segmentation",)),
    StageSpec(
        "scene_story_beats", "Scenes and Story Beats (Stage 10)", "service",
        depends_on=("scene_segmentation",), after=_EVIDENCE_AFTER,
        ai_settings=("SEMANTIC_REASONER_PROVIDER", "STORY_BEAT_REASONER_PROVIDER"), rerun="on_input_change",
    ),
    StageSpec(
        "editing_rhythm", "Editing rhythm (Stage 11.1)", "service",
        depends_on=("scene_segmentation",), after=("scene_story_beats",) + _EVIDENCE_AFTER, rerun="on_input_change",
    ),
    StageSpec(
        "hook_window", "Hook window (Stage 11.2)", "service",
        depends_on=("technical_probe",), after=("scene_story_beats",), rerun="on_input_change",
    ),
    StageSpec(
        "hook_classification", "Hook classification (Stage 11.3)", "service",
        depends_on=("hook_window",), after=("editing_rhythm", "speech_analysis", "text_analysis"),
        ai_settings=("HOOK_REASONER_PROVIDER",), rerun="only_if_missing",
    ),
    StageSpec(
        "retention_devices", "Retention devices (Stage 11.4)", "service",
        depends_on=("scene_segmentation",), after=("editing_rhythm", "scene_story_beats") + _EVIDENCE_AFTER,
        ai_settings=("RETENTION_REASONER_PROVIDER",), rerun="only_if_missing",
    ),
)
STAGE_BY_KEY = {s.key: s for s in STAGES}


def _validate_registry() -> None:
    seen: set[str] = set()
    for spec in STAGES:
        assert spec.key not in seen, f"duplicate stage {spec.key}"
        for dep in spec.depends_on + spec.after:
            assert dep in seen, f"stage {spec.key} lists {dep} before it is defined (registry order must be topological)"
        seen.add(spec.key)


_validate_registry()


@dataclass
class RunContext:
    db: AsyncSession
    user: User
    reference_video_id: int
    video_analysis_id: int
    user_id: int = 0
    has_results: Callable[[str], Awaitable[bool]] | None = None


Runner = Callable[[RunContext], Awaitable[dict | None]]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── default runners (lazy imports: the router imports THIS module, so it cannot be imported at load) ──

def default_runners() -> dict[str, Runner]:
    from app.routers import reference_videos as r
    from app.services.editing_rhythm_svc import compute_and_persist_editing_rhythm
    from app.services.hook_classification_svc import classify_and_persist_hook
    from app.services.hook_window_svc import derive_and_persist_hook_window
    from app.services.retention_classification_svc import classify_and_persist_retention_devices
    from app.services.stage10_deconstruction_svc import run_stage10_pipeline

    def endpoint(handler, **extra) -> Runner:
        async def run(ctx: RunContext) -> None:
            # db/user passed explicitly: called outside FastAPI, so the Depends() defaults do not apply.
            await handler(ctx.reference_video_id, db=ctx.db, user=ctx.user, **extra)
        return run

    def scalars(result) -> dict:
        return {k: v for k, v in (result or {}).items() if isinstance(v, (int, float, str, bool)) or v is None}

    async def stage10(ctx: RunContext) -> dict:
        return asdict(await run_stage10_pipeline(ctx.db, ctx.video_analysis_id))

    async def editing_rhythm(ctx: RunContext) -> dict:
        return scalars(await compute_and_persist_editing_rhythm(ctx.db, ctx.video_analysis_id))

    async def hook_window(ctx: RunContext) -> dict:
        return scalars(await derive_and_persist_hook_window(ctx.db, ctx.video_analysis_id))

    async def hook_classification(ctx: RunContext) -> dict:
        return scalars(await classify_and_persist_hook(ctx.db, ctx.video_analysis_id))

    async def retention(ctx: RunContext) -> dict:
        res = await classify_and_persist_retention_devices(ctx.db, ctx.video_analysis_id)
        return {"candidates_examined": res["candidates_examined"], "accepted_devices": len(res["devices"])}

    return {
        "technical_probe": endpoint(r.analyze_reference_video),
        "scene_segmentation": endpoint(r.analyze_reference_video_structure),
        "visual_evidence": endpoint(r.analyze_reference_video_frames),
        "speech_analysis": endpoint(r.analyze_reference_video_speech, language=None),
        "audio_structure": endpoint(r.analyze_reference_video_audio_structure),
        "text_analysis": endpoint(r.analyze_reference_video_text),
        "visual_objects": endpoint(r.analyze_reference_video_visual_objects),
        "visual_persistence": endpoint(r.analyze_reference_video_visual_persistence),
        "visual_composition": endpoint(r.analyze_reference_video_visual_composition),
        "global_motion_evidence": endpoint(r.analyze_reference_video_global_motion),
        "transition_evidence": endpoint(r.analyze_reference_video_transition_evidence),
        "local_motion_evidence": endpoint(r.analyze_reference_video_local_motion),
        "local_motion_dynamics": endpoint(r.analyze_reference_video_local_motion_dynamics),
        "transition_similarity_evidence": endpoint(r.analyze_reference_video_transition_similarity),
        "scene_story_beats": stage10,
        "editing_rhythm": editing_rhythm,
        "hook_window": hook_window,
        "hook_classification": hook_classification,
        "retention_devices": retention,
    }


# ── persistence helpers ─────────────────────────────────────────────────────────────────────

async def _latest_analysis(db: AsyncSession, reference_video_id: int, *, lock: bool = False) -> VideoAnalysis | None:
    stmt = (
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == reference_video_id)
        .order_by(VideoAnalysis.created_at.desc(), VideoAnalysis.id.desc()).limit(1)
        .execution_options(populate_existing=True)
    )
    if lock:
        stmt = stmt.with_for_update()
    return (await db.execute(stmt)).scalars().first()


async def _patch_pass_status(db: AsyncSession, video_analysis_id: int, patch: dict) -> dict:
    """Read-modify-write of one VideoAnalysis's pass_status under a row lock, so it never clobbers a
    concurrent writer. Returns the merged dict."""
    row = (await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.id == video_analysis_id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalar_one()
    merged = {**(row.pass_status or {}), **patch}
    row.pass_status = merged
    await db.commit()
    return merged


def _is_stale(started_at_iso: str | None) -> bool:
    if not started_at_iso:
        return True
    try:
        started = datetime.fromisoformat(started_at_iso)
    except ValueError:
        return True
    return (datetime.now(timezone.utc) - started).total_seconds() > ORCHESTRATION_STALE_SECONDS


async def _unexpire_user(db: AsyncSession, user_id: int) -> None:
    """`Session.rollback()` expires EVERY loaded instance -- including the request's `User`, which in
    the real app is attached to this same session (`current_user` and the endpoint share one
    `get_db` session). Touching `user.id` afterwards would then trigger a synchronous lazy load and
    crash with MissingGreenlet inside every later handler. Re-loading it in place (populate_existing
    refreshes the identity-mapped instance the caller already holds) makes a rollback harmless."""
    await db.execute(select(User).where(User.id == user_id).execution_options(populate_existing=True))


async def _load_owned_reference_video(db: AsyncSession, user_id: int, reference_video_id: int) -> ReferenceVideo:
    rv = (await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user_id)
    )).scalar_one_or_none()
    if rv is None:
        raise OrchestrationNotFound("Reference video not found")
    return rv


async def claim_orchestration(db: AsyncSession, user: User, reference_video_id: int, *, force_ai: bool = False) -> VideoAnalysis:
    """Atomically marks this video's latest analysis as being orchestrated. Raises
    OrchestrationNotFound / OrchestrationConflict; never runs any stage."""
    user_id = user.id  # captured before any rollback can expire `user`
    await _load_owned_reference_video(db, user_id, reference_video_id)
    latest = await _latest_analysis(db, reference_video_id, lock=True)
    if latest is None:
        await db.rollback()
        await _unexpire_user(db, user_id)
        raise OrchestrationNotFound("No analysis record exists for this reference video")
    state = (latest.pass_status or {}).get(ORCHESTRATION_KEY) or {}
    if state.get("status") == "running" and not _is_stale(state.get("started_at")):
        await db.rollback()  # releases the row lock taken above
        await _unexpire_user(db, user_id)
        raise OrchestrationConflict("A deconstruction is already running for this reference video")
    latest.pass_status = {
        **(latest.pass_status or {}),
        ORCHESTRATION_KEY: {"status": "running", "started_at": _now_iso(), "finished_at": None, "force_ai": force_ai},
    }
    await db.commit()
    return latest


async def _has_existing_results(db: AsyncSession, key: str, video_analysis_id: int) -> bool:
    """Whether a derived stage already has persisted results for this exact VideoAnalysis, read from the
    data itself. ANY retention attempt (pre- or post-acceptance-gate) counts: upgrading legacy attempts
    is a paid re-run and must be an explicit `force_ai`, never a silent side effect."""
    from sqlalchemy import func

    from app.models.analysis_annotation import AnalysisAnnotation
    from app.models.scene import Scene
    from app.models.strategic_insight import StrategicInsight

    async def annotations(category: str) -> bool:
        return (await db.execute(select(func.count()).select_from(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id, AnalysisAnnotation.category == category,
        ))).scalar_one() > 0

    if key == "scene_story_beats":
        return (await db.execute(select(func.count()).select_from(Scene).where(Scene.video_analysis_id == video_analysis_id))).scalar_one() > 0
    if key == "editing_rhythm":
        return await annotations("editing_rhythm_profile")
    if key == "hook_window":
        return await annotations("hook_window")
    if key == "hook_classification":
        return (await db.execute(select(func.count()).select_from(StrategicInsight).where(
            StrategicInsight.video_analysis_id == video_analysis_id, StrategicInsight.category == "hook",
        ))).scalar_one() > 0
    if key == "retention_devices":
        return await annotations("retention_reasoning_attempt") or await annotations("retention_device")
    return False


# ── status (pure, no I/O beyond the row) ─────────────────────────────────────────────────────

def compute_stage_statuses(pass_status: dict | None) -> list[dict]:
    """Merges each pass's OWN authoritative state (`pass_status[key]` for Stage 3-9) with what the
    last orchestration recorded (`c1_stages`), in registry order. Never invents a state: a stage
    nobody has touched is `not_run`."""
    ps = pass_status or {}
    recorded = ps.get(STAGES_KEY) or {}
    out = []
    for spec in STAGES:
        rec = recorded.get(spec.key) or {}
        status, error = rec.get("status", NOT_RUN), rec.get("error")
        if spec.kind == "endpoint":
            own = ps.get(spec.key)
            if own in (COMPLETE, FAILED, "running"):
                status = own
                if own == FAILED:
                    error = ps.get(f"{spec.key}_error") or (ps.get("error") if spec.key == "technical_probe" else None) or error
                elif own == COMPLETE:
                    error = None
        out.append({
            "key": spec.key, "label": spec.label, "kind": spec.kind, "depends_on": list(spec.depends_on),
            "status": status, "error": error, "reason": rec.get("reason"),
            "degraded_inputs": rec.get("degraded_inputs", []), "summary": rec.get("summary"),
            "requires_ai": bool(spec.ai_settings),
        })
    return out


async def get_orchestration_status(db: AsyncSession, user: User, reference_video_id: int, *, video_analysis_id: int | None = None) -> dict:
    await _load_owned_reference_video(db, user.id, reference_video_id)
    if video_analysis_id is None:
        va = await _latest_analysis(db, reference_video_id)
    else:
        va = (await db.execute(select(VideoAnalysis).where(
            VideoAnalysis.id == video_analysis_id, VideoAnalysis.reference_video_id == reference_video_id))).scalar_one_or_none()
    if va is None:
        raise OrchestrationNotFound("No analysis record exists for this reference video")
    ps = va.pass_status or {}
    return {
        "reference_video_id": reference_video_id, "video_analysis_id": va.id,
        "orchestration": ps.get(ORCHESTRATION_KEY), "stages": compute_stage_statuses(ps),
    }


# ── the run ─────────────────────────────────────────────────────────────────────────────────

def _overall_status(results: dict[str, dict]) -> str:
    if results.get("technical_probe", {}).get("status") not in _OK_FOR_DEPENDENTS:
        return "failed"
    if all(r["status"] in _OK_FOR_OVERALL for r in results.values()):
        return "complete"
    return "partial"


async def _read_endpoint_outcome(db: AsyncSession, reference_video_id: int, spec: StageSpec) -> tuple[str, str | None, int]:
    latest = await _latest_analysis(db, reference_video_id)
    ps = latest.pass_status or {}
    own = ps.get(spec.key)
    if own == COMPLETE:
        return COMPLETE, None, latest.id
    if own == FAILED:
        err = ps.get(f"{spec.key}_error") or (ps.get("error") if spec.key == "technical_probe" else None)
        return FAILED, err or "pass reported failure", latest.id
    return FAILED, f"pass ended in unexpected state {own!r}", latest.id


async def run_deconstruction(
    db: AsyncSession, user: User, reference_video_id: int, *,
    force_ai: bool = False, runners: dict[str, Runner] | None = None, claimed: bool = False,
    results_probe: Callable[[AsyncSession, str, int], Awaitable[bool]] | None = None,
) -> dict:
    """Runs every stage in dependency order and returns
    `{"overall_status", "orchestration", "stages": [...]}`. Never raises for a stage failure (those are
    reported); raises OrchestrationNotFound / OrchestrationConflict only for refusals."""
    runners = runners if runners is not None else default_runners()
    missing = [s.key for s in STAGES if s.key not in runners]
    if missing:
        raise OrchestrationError(f"No runner supplied for stage(s): {missing}")

    user_id = user.id  # primitives are captured here: ORM instances may be expired by a later rollback
    claimed_va = await claim_orchestration(db, user, reference_video_id, force_ai=force_ai) if not claimed else await _latest_analysis(db, reference_video_id)
    claimed_va_id = claimed_va.id
    probe = results_probe or _has_existing_results
    ctx = RunContext(db=db, user=user, reference_video_id=reference_video_id, video_analysis_id=claimed_va_id, user_id=user_id)
    ctx.has_results = lambda key: probe(ctx.db, key, ctx.video_analysis_id)
    prior = dict((claimed_va.pass_status or {}).get(STAGES_KEY) or {})
    started_at = ((claimed_va.pass_status or {}).get(ORCHESTRATION_KEY) or {}).get("started_at") or _now_iso()

    results: dict[str, dict] = {}
    finished_normally = False
    try:
        for spec in STAGES:
            results[spec.key] = await _run_stage(spec, ctx, results, prior, runners, force_ai)
            if spec.key == "technical_probe" and ctx.video_analysis_id != claimed_va_id:
                # Stage 3 retry minted a NEW VideoAnalysis (its own "every re-run is a new row" rule):
                # carry the claim over so later stages/readers see this run on the row they will read.
                await _patch_pass_status(db, ctx.video_analysis_id, {
                    ORCHESTRATION_KEY: {"status": "running", "started_at": started_at, "finished_at": None, "force_ai": force_ai}})
            await _patch_pass_status(db, ctx.video_analysis_id, {STAGES_KEY: dict(results)})
        finished_normally = True
    finally:
        overall = _overall_status(results) if finished_normally else "interrupted"
        final = {"status": overall, "started_at": started_at, "finished_at": _now_iso(), "force_ai": force_ai}
        try:
            for va_id in {claimed_va_id, ctx.video_analysis_id}:
                await _patch_pass_status(db, va_id, {ORCHESTRATION_KEY: final})
        except Exception:  # noqa: BLE001 -- releasing the claim must never mask the real outcome/exception
            await db.rollback()
            await _unexpire_user(db, user_id)

    return {"overall_status": overall, "orchestration": final,
            "stages": compute_stage_statuses({**(await _current_own_status(db, reference_video_id)), STAGES_KEY: results})}


async def _current_own_status(db: AsyncSession, reference_video_id: int) -> dict:
    latest = await _latest_analysis(db, reference_video_id)
    return dict(latest.pass_status or {}) if latest else {}


async def _run_stage(spec: StageSpec, ctx: RunContext, results: dict[str, dict], prior: dict,
                     runners: dict[str, Runner], force_ai: bool) -> dict:
    def outcome(status: str, **extra) -> dict:
        return {"status": status, "at": _now_iso(), "error": None, "reason": None,
                "degraded_inputs": [], "summary": None, **extra}

    blocked_by = [d for d in spec.depends_on if results[d]["status"] not in _OK_FOR_DEPENDENTS]
    if blocked_by:
        return outcome(BLOCKED, reason="; ".join(f"dependency '{d}' is {results[d]['status']}" for d in blocked_by))

    degraded = [f"{d} ({results[d]['status']})" for d in spec.after if results[d]["status"] not in _OK_FOR_DEPENDENTS]

    if spec.kind == "endpoint":
        latest = await _latest_analysis(ctx.db, ctx.reference_video_id)
        if (latest.pass_status or {}).get(spec.key) == COMPLETE:
            return outcome(ALREADY_COMPLETE)
    else:
        prior_ok = (prior.get(spec.key) or {}).get("status") in _OK_FOR_DEPENDENTS
        existing = prior_ok or await ctx.has_results(spec.key)
        if existing:
            upstream_changed = any(results[d]["status"] == COMPLETE for d in spec.depends_on + spec.after)
            if spec.rerun == "only_if_missing" and not force_ai:
                return outcome(ALREADY_COMPLETE, summary=(prior.get(spec.key) or {}).get("summary"),
                               reason="results already exist; a paid AI stage is never re-run automatically (pass force_ai=true)")
            if spec.rerun == "on_input_change" and not upstream_changed:
                return outcome(ALREADY_COMPLETE, summary=(prior.get(spec.key) or {}).get("summary"),
                               reason="results already exist and no upstream stage changed in this run")

    unconfigured = [name for name in spec.ai_settings if not getattr(settings, name, "")]
    if unconfigured:
        return outcome(SKIPPED, reason=f"AI reasoner not configured ({', '.join(unconfigured)} is empty)")

    try:
        summary = await runners[spec.key](ctx)
    except Exception as exc:  # noqa: BLE001 -- a stage failure is reported, never allowed to abort the run
        await ctx.db.rollback()
        await _unexpire_user(ctx.db, ctx.user_id)  # the next stage's handler reads ctx.user.id
        if isinstance(exc, HTTPException):
            msg = f"HTTP {exc.status_code}: {exc.detail}"
        else:
            msg = f"{type(exc).__name__}: {exc}"
        return outcome(FAILED, error=msg[:500], degraded_inputs=degraded)

    if spec.kind == "endpoint":
        status, error, va_id = await _read_endpoint_outcome(ctx.db, ctx.reference_video_id, spec)
        ctx.video_analysis_id = va_id
        return outcome(status, error=error, degraded_inputs=degraded)
    return outcome(COMPLETE, summary=summary, degraded_inputs=degraded)


# ── background execution ────────────────────────────────────────────────────────────────────

_BACKGROUND_TASKS: set[asyncio.Task] = set()


def start_background_deconstruction(user_id: int, reference_video_id: int, *, force_ai: bool = False,
                                    runners: dict[str, Runner] | None = None) -> asyncio.Task:
    """Runs an ALREADY-CLAIMED orchestration in its own session so the HTTP request can return
    immediately (a full run - OCR, Whisper, motion analysis - can outlast a request timeout). Progress
    is read through get_orchestration_status. If the process dies mid-run, the claim goes stale and the
    next run resumes: completed passes are skipped."""
    async def _job() -> None:
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            user = await session.get(User, user_id)
            if user is None:
                return
            await run_deconstruction(session, user, reference_video_id, force_ai=force_ai, runners=runners, claimed=True)

    task = asyncio.create_task(_job())
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return task
