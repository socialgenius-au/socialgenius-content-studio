"""Video Deconstructor — Stage 10.2B5: DURABLE SEMANTIC-BOUNDARY REASONING RESULT STORE.

Closes the gap the Stage 10.2B4 real-video validation exposed: `ReasonerResult` (Stage 10.2B1's
own contract) is pure in-memory data, and nothing previously made it durable independently of a
full Scene-construction run. This module is that missing piece — it durably records each
reasoning result the moment it's produced, so a process crash between reasoning and Scene
construction loses at most the one candidate in flight, never everything reasoned so far.

Reuses `AnalysisAnnotation` — no new table, no schema migration — under a NEW category,
`"semantic_boundary_attempt"`, deliberately distinct from
`scene_construction_svc.BOUNDARY_DECISION_CATEGORY` ("semantic_boundary_decision"). The two serve
different purposes and must never collide:
  - `semantic_boundary_attempt` (this module): an APPEND-ONLY, ever-growing history of
    every reasoning attempt ever made for a candidate — never deleted, never overwritten. This is
    the durable B2 output.
  - `semantic_boundary_decision` (scene_construction_svc, unchanged by this module): a SNAPSHOT,
    delete-and-replaced each time Scene construction runs, representing "the decisions THIS
    particular Scene-construction run actually used."

This module never imports `anthropic`, `app.services.semantic_reasoner.router`, or
`reason_about_boundary` — it only ever persists or reads already-computed `CandidateReasoningRecord`
objects, exactly mirroring `scene_construction_svc`'s own "cannot make a real API call by
construction" discipline.

THREE FUNCTIONS, LOCKED BY THE STAGE 10.2B5 ARCHITECTURE AUDIT AND ITS FINAL-PROVENANCE-CONTRACT
FOLLOW-UP:

  persist_reasoning_result(db, video_analysis_id, record) — persists ONE reasoning result
    immediately and independently, with its own commit. Append-only: a rerun of the same
    candidate adds a NEW row rather than replacing the old one, so mixed-provider/mixed-prompt-
    version history over time remains fully visible and auditable, never destroyed.

  load_latest_reasoning_results(db, video_analysis_id) — reconstructs
    `list[CandidateReasoningRecord]` from durable storage: one entry per distinct candidate
    timestamp (grouped using the exact same `CANDIDATE_MERGE_WINDOW_SECONDS` proximity Stage
    10.2A's own deduplication already uses), always the LATEST attempt by `created_at` when
    several exist for the same candidate. Older attempts are never deleted by this function —
    they simply aren't the one selected. No "consumption" state exists or is tracked; calling this
    twice with no new writes in between returns the identical result. Ready to hand directly to
    `scene_construction_svc.construct_and_persist_scenes()`, unmodified.

  find_unreasoned_candidates(db, video_analysis_id) — recomputes Stage 10.2A's own live candidate
    list (free, local, deterministic given unchanged evidence) and returns exactly the candidates
    that have no durable reasoning result yet, using the same proximity tolerance. Computed fresh
    every call rather than cached, so it can never go stale if evidence changes later.
"""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.services.scene_construction_svc import BOUNDARY_DECISION_PASS_NAME, CandidateReasoningRecord
from app.services.semantic_boundary_assembly_svc import (
    CANDIDATE_MERGE_WINDOW_SECONDS,
    assemble_semantic_boundary_candidates,
)
from app.services.semantic_reasoner.contract import ReasonerDecision, ReasonerResult

REASONING_RESULT_CATEGORY = "semantic_boundary_attempt"


def _same_candidate(a: float, b: float) -> bool:
    """The exact same temporal-proximity rule Stage 10.2A's own deduplication already uses to
    define "these two things represent the same real-world instant" — reused here, not
    reinvented, for matching a live-recomputed candidate against an already-persisted reasoning
    result, since candidates themselves are never persisted anywhere."""
    return abs(a - b) <= CANDIDATE_MERGE_WINDOW_SECONDS


@dataclass
class BackfillProvenance:
    """Explicit, BOUNDED provenance for a reasoning result being durably recorded after the fact
    (Stage 10.2B6) -- e.g. a real result already obtained in an earlier session, only now given a
    durable home in this store. Deliberately NOT a generic/unrestricted metadata dict: exactly
    these two fields, each with one specific, narrow meaning. Passing an instance of this class to
    `persist_reasoning_result` (rather than leaving its `backfill` parameter at the default None)
    is itself what marks the resulting row `details.backfilled_from_prior_reasoning = true` --
    there is no separate boolean to set inconsistently.

    original_reasoning_timestamp: when the ORIGINAL reasoning call actually happened, if known --
        never fabricated; leave None (the default) if genuinely unknown. An ISO-8601 string, not a
        live/current timestamp -- this must never be confused with, or substituted for,
        `AnalysisAnnotation.created_at` (which always means "when this row was inserted").

    original_reasoning_timestamp_basis: HOW that timestamp was established (e.g.
        "scratchpad_file_mtime_approximate") -- so a reader can judge its own precision rather
        than mistaking it for an exact, API-returned event timestamp. Required whenever
        `original_reasoning_timestamp` is supplied (a timestamp with no stated basis is not
        trustworthy provenance); ignored if `original_reasoning_timestamp` is None.

    source_nominations_reconstructed: True when the candidate's own `source_nominations` were
        recomputed after the fact (e.g. via a fresh, deterministic Stage 10.2A recomputation)
        rather than captured live at the moment the original reasoning call was made -- keeps
        reconstructed provenance explicitly distinguishable from nominations genuinely captured
        at reasoning time. Defaults to False; only ever written into `details` when True.
    """
    original_reasoning_timestamp: str | None = None
    original_reasoning_timestamp_basis: str | None = None
    source_nominations_reconstructed: bool = False


async def persist_reasoning_result(
    db: AsyncSession, video_analysis_id: int, record: CandidateReasoningRecord,
    backfill: BackfillProvenance | None = None,
) -> AnalysisAnnotation:
    """Durably persists ONE reasoning result immediately, independent of Scene construction.
    Commits right away — this is what makes the design crash-safe: a crash while reasoning about
    the NEXT candidate leaves this one already durably saved. Append-only: never deletes or
    overwrites a prior row for the same candidate_timestamp; a rerun (a different provider, model,
    or prompt version) simply adds its own new row, and every earlier attempt remains queryable
    history, distinguishable by `created_at` plus this row's own `details.provider`/`details.
    model`/`details.prompt_version`.

    `backfill`: leave at the default None for ordinary LIVE persistence (immediately after a real
    reasoning call) -- the resulting row's `details` then contains NONE of the historical-backfill
    keys at all, never a meaningless `false`/`null` placeholder for them. Pass a `BackfillProvenance`
    only when durably recording a result that was ALREADY obtained earlier and is only now being
    given a durable home (Stage 10.2B6) -- `AnalysisAnnotation.created_at` still reflects the
    actual moment THIS row is inserted either way; it is never overridden to the historical time."""
    decision = record.result.decision
    details = {
        "is_semantic_boundary": decision.is_semantic_boundary,
        "confidence": decision.confidence,
        "evidence_references": decision.evidence_references,
        "source_nominations": record.source_nominations,
        "provider": record.result.provider,
        "model": record.result.model,
        "prompt_version": record.result.reasoning_contract_version,
    }
    if backfill is not None:
        details["backfilled_from_prior_reasoning"] = True
        if backfill.original_reasoning_timestamp is not None:
            details["original_reasoning_timestamp"] = backfill.original_reasoning_timestamp
            details["original_reasoning_timestamp_basis"] = backfill.original_reasoning_timestamp_basis
        if backfill.source_nominations_reconstructed:
            details["source_nominations_reconstructed"] = True

    annotation = AnalysisAnnotation(
        video_analysis_id=video_analysis_id,
        shot_id=None,
        category=REASONING_RESULT_CATEGORY,
        start_time=record.result.candidate_timestamp,
        end_time=record.result.candidate_timestamp,
        details=details,
        certainty="INFERRED",
        confidence_score=decision.confidence_score,
        reasoning=decision.reasoning,
        source="ai_reasoning",
        produced_by_pass=BOUNDARY_DECISION_PASS_NAME,
    )
    db.add(annotation)
    await db.commit()
    await db.refresh(annotation)
    return annotation


def _record_from_annotation(row: AnalysisAnnotation) -> CandidateReasoningRecord:
    details = row.details or {}
    decision = ReasonerDecision(
        is_semantic_boundary=details.get("is_semantic_boundary"),
        confidence=details.get("confidence"),
        confidence_score=row.confidence_score,
        reasoning=row.reasoning or "",
        evidence_references=details.get("evidence_references") or {},
        reasoning_contract_version=details.get("prompt_version"),
    )
    result = ReasonerResult(
        decision=decision,
        provider=details.get("provider"),
        model=details.get("model"),
        candidate_timestamp=row.start_time,
        reasoning_contract_version=details.get("prompt_version"),
    )
    return CandidateReasoningRecord(result=result, source_nominations=details.get("source_nominations") or [])


async def load_latest_reasoning_results(db: AsyncSession, video_analysis_id: int) -> list[CandidateReasoningRecord]:
    """Reconstructs one CandidateReasoningRecord per distinct candidate timestamp durably
    persisted for this VideoAnalysis -- always the LATEST attempt (by created_at) when several
    exist. Never deletes, never mutates, tracks no "consumed" state -- this is always a fresh,
    idempotent read of the current durable history's own latest view."""
    result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == REASONING_RESULT_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )
    rows = list(result.scalars().all())
    if not rows:
        return []

    # Greedy proximity clustering -- mirrors _deduplicate_nominations's own exact algorithm
    # (compare each row against the LAST member of the current cluster, not the cluster's own
    # first member), so multiple reasoning attempts at genuinely the same candidate group
    # together even if their own exact float timestamps differ slightly.
    clusters: list[list[AnalysisAnnotation]] = [[rows[0]]]
    for row in rows[1:]:
        if _same_candidate(row.start_time, clusters[-1][-1].start_time):
            clusters[-1].append(row)
        else:
            clusters.append([row])

    return [_record_from_annotation(max(cluster, key=lambda r: r.created_at)) for cluster in clusters]


async def find_unreasoned_candidates(db: AsyncSession, video_analysis_id: int) -> list[dict]:
    """Live Stage 10.2A candidates for this VideoAnalysis that have no durable reasoning result
    yet -- the exact "still needs reasoning" work list. Recomputes candidates fresh every call
    (10.2A's own generation is deterministic given unchanged evidence) rather than caching a
    completeness flag that could go stale if evidence changes later. Never calls a semantic
    reasoner or any external API -- this is a pure read/diff, exactly like Stage 10.2A itself."""
    live = await assemble_semantic_boundary_candidates(db, video_analysis_id)

    reasoned_result = await db.execute(
        select(AnalysisAnnotation.start_time).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == REASONING_RESULT_CATEGORY,
        )
    )
    reasoned_timestamps = list(reasoned_result.scalars().all())

    return [
        candidate for candidate in live["candidates"]
        if not any(_same_candidate(candidate["candidate_timestamp"], r) for r in reasoned_timestamps)
    ]
