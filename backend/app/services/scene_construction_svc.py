"""Video Deconstructor — Stage 10.2B3: SEMANTIC SCENE ORCHESTRATION & PERSISTENCE.

The FIRST stage in this whole engagement that ever creates a `Scene` row. Converts already-
computed Stage 10.2B semantic-reasoner decisions into persisted, deterministically-derived Scene
ranges. Locked by the Stage 10.2B3 architecture audit and its final-contract-lock supplement
(candidate-spacing / minimum-Scene-duration invariant) — this module implements that design
exactly, adding nothing beyond it.

WHAT THIS MODULE DOES NOT DO (by design, not by oversight):
  - It never calls a semantic reasoner, Anthropic, or any external model/API. It consumes
    already-computed `ReasonerResult` objects (paired with their own candidate's
    `source_nominations` — see `CandidateReasoningRecord` below) as plain data. Reasoning and
    persistence are deliberately separate: this module cannot cause a real API call under any
    input, by construction (it never imports `anthropic`, `app.services.semantic_reasoner.router`,
    or `reason_about_boundary`).
  - It never reads or writes `Shot.scene_id` — that column remains permanently unused/reserved
    (see app/models/scene.py's own docstring); Scene<->Shot overlap is always derived at read time
    by comparing two independent time ranges, never authored here.
  - It never fabricates a title, summary, topic, or `narrative_role` — Stage 10.2B's own reasoner
    decides ONLY whether/where a boundary exists, never what a Scene is "about"; semantic labeling
    is an explicitly deferred, later, separate pass. `Scene.narrative_role` stays reserved for
    Stage 15, exactly as already documented.
  - It never mutates any existing evidence row (SpeechSegment, Shot, TextElement, VisualObject, a
    pre-existing AnalysisAnnotation, ReferenceVideo, or a prior VideoAnalysis) — every write this
    module performs is either a new Scene row or a new AnalysisAnnotation row, both scoped to
    exactly one VideoAnalysis, both additive.

ACCEPTED-BOUNDARY POLICY (locked): a candidate becomes an accepted Scene boundary only when
`decision.is_semantic_boundary is True` AND `decision.confidence in ("medium", "high")`. A
low-confidence True, any False, and any None (undecided) NEVER create a Scene boundary — but
every one of them is still durably persisted (see PRESERVING EVERY DECISION below), so no
information is lost by not promoting it.

RANGE CONSTRUCTION: sorted accepted-boundary timestamps partition `[0, D]` into contiguous Scenes.
Zero accepted boundaries -> exactly one Scene spanning the whole video (RV146's own real case,
per the Stage 10.2B2 benchmark). D (the authoritative video duration) comes from
`ReferenceVideo.duration`, falling back to `max(Shot.end_time)` for the same VideoAnalysis if that
is unset; if NEITHER exists, this module refuses to construct anything rather than guess.

MINIMUM-SCENE-DURATION INVARIANT (locked by the B3 final-contract-lock audit): reuses
`semantic_boundary_assembly_svc.CANDIDATE_MERGE_WINDOW_SECONDS` (0.5s) as the minimum distance an
accepted boundary must keep from `0`, from `D`, and from any other accepted boundary. This is not
an invented threshold — it is the SAME constant Stage 10.2A's own deduplication already uses to
define "these two things represent the same real-world instant," extended here to "a Scene
shorter than this is not meaningfully distinguishable from having no boundary there at all." A
violation raises `SceneConstructionError` — this module NEVER silently clamps, shifts, merges, or
drops an accepted boundary to make it fit.

SCENE.DETAILS PROVENANCE (locked): `{"boundary_start": <ref-dict>|None, "boundary_end": <ref-
dict>|None}` — `boundary_start` is None for the first Scene (nothing opened it but the video's own
start), `boundary_end` is None for the last Scene (nothing closed it but the video's own end); an
internal accepted decision's own `evidence_references` appears as BOTH the preceding Scene's
`boundary_end` and the following Scene's `boundary_start` (it genuinely is their shared boundary).
This is boundary provenance ONLY — it never claims to describe a Scene's own interior content.
When a Scene has neither side populated (the zero-accepted-boundary, whole-video case),
`Scene.details` is left `None` entirely, matching the column's own "equally valid with
details=NULL" discipline.

PRESERVING EVERY DECISION: every supplied `CandidateReasoningRecord` — accepted or not, at any
confidence, including None (undecided) — is persisted as its own `AnalysisAnnotation` row
(`category="semantic_boundary_decision"`, a new category value on the existing, category-agnostic
table -- no new table, no schema change). This is the durable audit trail answering "why was this
boundary accepted/rejected" without ever copying full evidence bundles into a Scene row.

PROVENANCE: provider/model are recorded ONCE per run on `VideoAnalysis.ai_provider_versions_used`
(an already-existing JSON column built for exactly this purpose — "recorded once per run here, not
duplicated onto every individual claim row") under this pass's own name, never as a new column.

IDEMPOTENCY / TRANSACTION SAFETY: mirrors the EXACT pattern Stage 4's own structural-analysis
endpoint already established for Shot rows (see app/routers/reference_videos.py's
`analyze_reference_video_structure`) — an idempotent short-circuit via `VideoAnalysis.pass_status`
(a NEW, non-colliding key: `"semantic_scene_construction"` — never the pre-existing
`"scene_segmentation"` key Stage 4 already owns for Shot detection), a defensive delete-then-
replace of any pre-existing Scene/decision-annotation rows for this VideoAnalysis before writing
the fresh set, and exactly ONE final `db.commit()` after every row is added — SQLAlchemy's
AsyncSession keeps everything pending until that single commit, so a mid-construction exception
leaves nothing persisted. No endpoint exists for this pass in V1 (service-only, per the locked
audit's own smallest-testable-unit recommendation) — this module therefore does not need to
implement the atomic running-state "claim" Stage 4's own HTTP-concurrency handling adds; that
concern is deferred to whenever (if ever) an endpoint is built on top of this service.
"""
from dataclasses import dataclass, field

from sqlalchemy import delete, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.video_analysis import VideoAnalysis
from app.services.semantic_boundary_assembly_svc import CANDIDATE_MERGE_WINDOW_SECONDS
from app.services.semantic_reasoner.contract import ReasonerResult

SCENE_CONSTRUCTION_PASS_NAME = "semantic_scene_construction_v1"
SCENE_CONSTRUCTION_PASS_STATUS_KEY = "semantic_scene_construction"  # deliberately NOT "scene_segmentation" -- Stage 4 already owns that key for Shot detection
BOUNDARY_DECISION_PASS_NAME = "semantic_boundary_reasoning_v1"
BOUNDARY_DECISION_CATEGORY = "semantic_boundary_decision"


class SceneConstructionError(Exception):
    """Raised for every condition this module refuses to silently paper over: no authoritative
    duration available, an accepted boundary outside [0, D], or an accepted boundary (against 0,
    D, or another accepted boundary) violating the CANDIDATE_MERGE_WINDOW_SECONDS minimum-distance
    invariant. Never raised for a merely-rejected (False/None/low-confidence) decision -- those are
    normal, expected outcomes, not errors."""


@dataclass
class CandidateReasoningRecord:
    """One already-reasoned candidate, exactly as this module needs it. `ReasonerResult` itself
    (Stage 10.2B1's own contract) does not carry `source_nominations` -- that field lives on the
    Stage 10.2A candidate bundle the reasoner was originally given, not on its own output -- so
    this small, local wrapper pairs the two together for full audit-trail provenance (per the
    locked B3 architecture audit's own input-contract section). `source_nominations` defaults to
    empty (never fabricated) when a caller genuinely doesn't have it."""
    result: ReasonerResult
    source_nominations: list[dict] = field(default_factory=list)


def _is_accepted_boundary(record: CandidateReasoningRecord) -> bool:
    decision = record.result.decision
    return decision.is_semantic_boundary is True and decision.confidence in ("medium", "high")


async def _resolve_duration(db: AsyncSession, video_analysis_id: int) -> float:
    """The authoritative video duration for this VideoAnalysis -- ReferenceVideo.duration first,
    falling back to max(Shot.end_time) for this same VideoAnalysis, never derived from a candidate
    timestamp. Raises SceneConstructionError, never guesses, if neither source exists."""
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise SceneConstructionError(f"VideoAnalysis {video_analysis_id} does not exist.")

    reference_video = await db.get(ReferenceVideo, video_analysis.reference_video_id)
    if reference_video is not None and reference_video.duration is not None:
        return reference_video.duration

    result = await db.execute(select(func.max(Shot.end_time)).where(Shot.video_analysis_id == video_analysis_id))
    max_shot_end = result.scalar_one_or_none()
    if max_shot_end is not None:
        return max_shot_end

    raise SceneConstructionError(
        f"No authoritative duration available for video_analysis_id={video_analysis_id}: "
        "ReferenceVideo.duration is unset and no Shot rows exist to fall back on."
    )


def _validate_accepted_boundaries(sorted_timestamps: list[float], duration: float) -> None:
    """Enforces the locked minimum-Scene-duration invariant -- an accepted boundary must sit at
    least CANDIDATE_MERGE_WINDOW_SECONDS away from 0, from D, and from any other accepted
    boundary. Raises SceneConstructionError on any violation; never clamps, shifts, merges, or
    drops a boundary to make it fit."""
    for timestamp in sorted_timestamps:
        if not (0.0 <= timestamp <= duration):
            raise SceneConstructionError(
                f"Accepted boundary {timestamp} lies outside this video's own duration [0, {duration}]."
            )
        if timestamp - 0.0 < CANDIDATE_MERGE_WINDOW_SECONDS:
            raise SceneConstructionError(
                f"Accepted boundary {timestamp} is closer than CANDIDATE_MERGE_WINDOW_SECONDS "
                f"({CANDIDATE_MERGE_WINDOW_SECONDS}s) to the video's own start (0) -- refusing to "
                "construct a degenerate first Scene rather than silently reinterpreting it."
            )
        if duration - timestamp < CANDIDATE_MERGE_WINDOW_SECONDS:
            raise SceneConstructionError(
                f"Accepted boundary {timestamp} is closer than CANDIDATE_MERGE_WINDOW_SECONDS "
                f"({CANDIDATE_MERGE_WINDOW_SECONDS}s) to the video's own end ({duration}) -- "
                "refusing to construct a degenerate last Scene rather than silently reinterpreting it."
            )

    for earlier, later in zip(sorted_timestamps, sorted_timestamps[1:]):
        if later - earlier < CANDIDATE_MERGE_WINDOW_SECONDS:
            raise SceneConstructionError(
                f"Accepted boundaries {earlier} and {later} are closer than "
                f"CANDIDATE_MERGE_WINDOW_SECONDS ({CANDIDATE_MERGE_WINDOW_SECONDS}s) apart -- "
                "refusing to construct two degenerate adjacent Scenes rather than silently "
                "merging or dropping one. (Candidates genuinely produced by Stage 10.2A's own "
                "deduplication are always more than this far apart from each other -- this "
                "defends only against a caller supplying non-conformant input.)"
            )


def _scene_details(boundary_start: dict | None, boundary_end: dict | None) -> dict | None:
    if boundary_start is None and boundary_end is None:
        return None
    return {"boundary_start": boundary_start, "boundary_end": boundary_end}


async def construct_and_persist_scenes(
    db: AsyncSession,
    video_analysis_id: int,
    reasoner_results: list[CandidateReasoningRecord],
) -> list[Scene]:
    """Stage 10.2B3's own single entry point. Consumes already-computed reasoning results for one
    exact VideoAnalysis and persists the resulting Scene rows plus a durable AnalysisAnnotation
    audit trail of every decision (accepted or not). Never calls a semantic reasoner, Anthropic, or
    any external API -- `reasoner_results` is plain data, not something this function computes.

    Idempotent: if this exact pass has already completed for this VideoAnalysis (tracked via
    VideoAnalysis.pass_status[SCENE_CONSTRUCTION_PASS_STATUS_KEY]), returns the existing Scene rows
    without re-running or creating duplicates. Otherwise, constructs and validates the complete
    Scene set in memory first, then persists everything (a defensive delete of any pre-existing
    rows for this VideoAnalysis, the fresh Scene rows, the fresh decision-annotation rows, and the
    pass_status/provider-provenance update) in one transaction ending in a single commit.

    Raises SceneConstructionError before any write if duration is unavailable or an accepted
    boundary violates the minimum-Scene-duration invariant -- never silently reinterprets either.
    """
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise SceneConstructionError(f"VideoAnalysis {video_analysis_id} does not exist.")

    pass_status = dict(video_analysis.pass_status or {})
    if pass_status.get(SCENE_CONSTRUCTION_PASS_STATUS_KEY) == "complete":
        # Idempotent -- already done. Return the existing rows as-is; do not re-run, do not create
        # duplicate Scenes (mirrors Stage 4's own "already done" short-circuit for Shot detection).
        result = await db.execute(
            select(Scene).where(Scene.video_analysis_id == video_analysis_id).order_by(Scene.order)
        )
        return list(result.scalars().all())

    duration = await _resolve_duration(db, video_analysis_id)

    accepted_records = [r for r in reasoner_results if _is_accepted_boundary(r)]
    accepted_records.sort(key=lambda r: r.result.candidate_timestamp)
    accepted_timestamps = [r.result.candidate_timestamp for r in accepted_records]

    _validate_accepted_boundaries(accepted_timestamps, duration)

    edges = [0.0, *accepted_timestamps, duration]
    scenes: list[Scene] = []
    for i in range(len(edges) - 1):
        boundary_start = accepted_records[i - 1].result.decision.evidence_references if i > 0 else None
        boundary_end = accepted_records[i].result.decision.evidence_references if i < len(accepted_records) else None
        scenes.append(Scene(
            video_analysis_id=video_analysis_id,
            order=i,
            start_time=edges[i],
            end_time=edges[i + 1],
            certainty="INFERRED",
            source="ai_reasoning",
            produced_by_pass=SCENE_CONSTRUCTION_PASS_NAME,
            details=_scene_details(boundary_start, boundary_end),
        ))

    decision_annotations: list[AnalysisAnnotation] = []
    provider_used: str | None = None
    model_used: str | None = None
    for record in reasoner_results:
        decision = record.result.decision
        decision_annotations.append(AnalysisAnnotation(
            video_analysis_id=video_analysis_id,
            shot_id=None,
            category=BOUNDARY_DECISION_CATEGORY,
            start_time=record.result.candidate_timestamp,
            end_time=record.result.candidate_timestamp,
            details={
                "is_semantic_boundary": decision.is_semantic_boundary,
                "confidence": decision.confidence,
                "evidence_references": decision.evidence_references,
                "source_nominations": record.source_nominations,
            },
            certainty="INFERRED",
            confidence_score=decision.confidence_score,
            reasoning=decision.reasoning,
            source="ai_reasoning",
            produced_by_pass=BOUNDARY_DECISION_PASS_NAME,
        ))
        # Recorded once per run, not per decision -- every real run uses one provider/model for
        # all its candidates; the last one seen is as good as any (they are expected to agree).
        provider_used, model_used = record.result.provider, record.result.model

    # Defensive idempotency, on top of (not instead of) the pass_status short-circuit above --
    # guarantees a retry can never leave duplicate/stale rows behind, exactly mirroring Stage 4's
    # own "clear any pre-existing Shots before writing the fresh set" precedent.
    await db.execute(delete(Scene).where(Scene.video_analysis_id == video_analysis_id))
    await db.execute(delete(AnalysisAnnotation).where(
        AnalysisAnnotation.video_analysis_id == video_analysis_id,
        AnalysisAnnotation.category == BOUNDARY_DECISION_CATEGORY,
    ))

    for scene in scenes:
        db.add(scene)
    for annotation in decision_annotations:
        db.add(annotation)

    provider_versions = dict(video_analysis.ai_provider_versions_used or {})
    if provider_used is not None:
        provider_versions[SCENE_CONSTRUCTION_PASS_NAME] = {"provider": provider_used, "model": model_used}
    video_analysis.pass_status = {**pass_status, SCENE_CONSTRUCTION_PASS_STATUS_KEY: "complete"}
    video_analysis.ai_provider_versions_used = provider_versions

    await db.commit()
    for scene in scenes:
        await db.refresh(scene)
    return scenes
