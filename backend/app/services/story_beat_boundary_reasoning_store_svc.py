"""Video Deconstructor — Stage 10.3B4: DURABLE STORY BEAT REASONING RESULT STORE.

The exact same architectural lesson Stage 10.2B5 already learned for Semantic Scene reasoning,
applied to Story Beat: `StoryBeatResult` (Stage 10.3B1's own contract) is pure in-memory data, and
nothing previously made it durable. This module is that missing piece — it durably records each
Story Beat reasoning result the moment it's produced, so a process crash between reasoning calls
loses at most the one candidate in flight, never everything reasoned so far.

A deliberate SIBLING of app.services.semantic_boundary_reasoning_store_svc, never a modification or
a shared-code reuse of it — the two contracts (`StoryBeatDecision`/`StoryBeatResult` vs.
`ReasonerDecision`/`ReasonerResult`) are independent, and this module owns its own dataclass
(`StoryBeatReasoningRecord`) rather than importing `CandidateReasoningRecord` from
scene_construction_svc, which is a Scene-specific module this Stage never touches. The one thing
genuinely reused is `CANDIDATE_MERGE_WINDOW_SECONDS` from semantic_boundary_assembly_svc — the same
tiny, generic proximity constant Stage 10.2A's own candidate deduplication already defines and the
Story Beat provider/router already reuse unmodified (see Stage 10.3A's own audit).

Reuses `AnalysisAnnotation` — no new table, no schema migration — under a NEW category,
`"story_beat_boundary_attempt"` (27 characters, well inside `AnalysisAnnotation.category`'s real
`String(32)` limit — verified before writing any code, per this engagement's own established
`StringDataRightTruncationError` lesson). Deliberately distinct from Scene's own
`"semantic_boundary_attempt"` category — the two must never collide, and this module never reads or
writes Scene's rows or vice versa.

THREE FUNCTIONS, mirroring the proven Scene store's own shape:

  persist_story_beat_reasoning_result(db, video_analysis_id, record) — persists ONE Story Beat
    reasoning result immediately and independently, with its own commit. Append-only: a rerun of
    the same candidate adds a NEW row rather than replacing the old one, so mixed-provider/mixed-
    prompt-version history over time remains fully visible and auditable, never destroyed.

  load_latest_story_beat_reasoning_results(db, video_analysis_id) — reconstructs
    `list[StoryBeatReasoningRecord]` from durable storage: one entry per distinct candidate
    timestamp (grouped using the exact same `CANDIDATE_MERGE_WINDOW_SECONDS` proximity Stage
    10.2A's own deduplication already uses), always the LATEST attempt by `created_at` when several
    exist for the same candidate. Older attempts are never deleted by this function — they simply
    aren't the one selected. No "consumption" state exists or is tracked; calling this twice with
    no new writes in between returns the identical result.

  find_unreasoned_story_beat_candidates(db, video_analysis_id) — recomputes Stage 10.2A's own live
    candidate list (the SAME generic candidate assembly B2/B3/B3-P2 already use, unmodified — no
    separate Story-Beat-specific candidate-generation algorithm exists or is needed) and returns
    exactly the candidates that have no durable Story Beat reasoning result yet, using the same
    proximity tolerance. Computed fresh every call rather than cached, so it can never go stale if
    evidence changes later. A durable result with decision True, False, OR None all equally count
    as "this candidate has been reasoned about" — only the ABSENCE of any durable row at all makes
    a candidate "unreasoned"; a candidate is never re-offered here merely because its latest
    decision was negative or undecided.

Stage 10.3B4's own explicit scope limits (do not exceed without a separate, later phase):
  - No `AnalysisAnnotation(category="story_beat")` row is ever created here — that is a future,
    separate, CONSTRUCTED semantic object (mirroring how `scene_construction_svc`'s own
    `semantic_boundary_decision` snapshot category is entirely separate from this store's
    append-only `semantic_boundary_attempt` category). `story_beat_boundary_attempt` (this module)
    is reasoning EVIDENCE about a candidate; `story_beat` (not yet built) will be a constructed,
    time-ranged semantic object built FROM that evidence, exactly as Scene is built from
    `semantic_boundary_attempt` rows.
  - Stage 10.3B5 adds bounded historical-backfill provenance support (`StoryBeatBackfillProvenance`
    + the optional `backfill` parameter below), mirroring the Scene store's own `BackfillProvenance`
    (Stage 10.2B6-P3). Whether/how to actually backfill the eight already-made B3/B3-P2 pilot
    results is STILL an explicitly deferred, separate decision — Stage 10.3B5 only ships the
    structural ability, inserts nothing.
  - This module never imports `anthropic`, `app.services.story_beat_reasoner.router`, or
    `reason_about_story_beat_boundary` — it only ever persists or reads already-computed
    `StoryBeatReasoningRecord` objects, exactly mirroring the Scene store's own "cannot make a real
    API call by construction" discipline.
"""
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.services.semantic_boundary_assembly_svc import (
    CANDIDATE_MERGE_WINDOW_SECONDS,
    assemble_semantic_boundary_candidates,
)
from app.services.story_beat_reasoner.contract import StoryBeatDecision, StoryBeatResult

STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY = "story_beat_boundary_attempt"

# The pass name recorded on every durable Story Beat reasoning attempt row. Independently defined
# here (never imported from scene_construction_svc.BOUNDARY_DECISION_PASS_NAME) — Story Beat has no
# construction service yet, and this store must not create a dependency on one that doesn't exist.
STORY_BEAT_REASONING_PASS_NAME = "story_beat_reasoning_v1"


def _same_candidate(a: float, b: float) -> bool:
    """The exact same temporal-proximity rule Stage 10.2A's own deduplication (and the Scene
    store's own `_same_candidate`) already use to define "these two things represent the same
    real-world instant" — the CONSTANT is the genuinely shared, generic primitive; this one-line
    comparison is redefined locally rather than importing a private (leading-underscore) helper
    from another module's own internals."""
    return abs(a - b) <= CANDIDATE_MERGE_WINDOW_SECONDS


@dataclass
class StoryBeatReasoningRecord:
    """The in-memory shape one durable Story Beat reasoning attempt round-trips through — a
    genuinely independent sibling of `scene_construction_svc.CandidateReasoningRecord`, wrapping
    `StoryBeatResult` (never `ReasonerResult`) plus the same-shaped `source_nominations` list Stage
    10.2A's own candidate bundle already carries."""
    result: StoryBeatResult
    source_nominations: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class StoryBeatBackfillProvenance:
    """Explicit, BOUNDED provenance for a Story Beat reasoning result being durably recorded after
    the fact — e.g. one of the eight non-persistent B3/B3-P2 pilot results, only now (in some
    future, separately-authorized task) given a durable home in this store. A deliberate SIBLING of
    `semantic_boundary_reasoning_store_svc.BackfillProvenance` — same three fields, same narrow
    meanings — never a shared/imported class, and (unlike the Scene one) `frozen=True` so an
    instance is immutable once constructed.

    Deliberately NOT a generic/unrestricted metadata dict: exactly these three fields, each with
    one specific, narrow meaning. Passing an instance of this class to
    `persist_story_beat_reasoning_result` (rather than leaving its `backfill` parameter at the
    default None) is itself what marks the resulting row
    `details.backfilled_from_prior_reasoning = true` — there is no separate boolean to set
    inconsistently.

    original_reasoning_timestamp: when the ORIGINAL Story Beat reasoning call actually happened, if
        known — never fabricated; leave None (the default) if genuinely unknown. An ISO-8601
        string, not a live/current timestamp — this must never be confused with, or substituted
        for, `AnalysisAnnotation.created_at` (which always means "when this row was inserted").

    original_reasoning_timestamp_basis: HOW that timestamp was established (e.g.
        "session_transcript_message_timestamp") — so a reader can judge its own precision rather
        than mistaking it for an exact, API-returned event timestamp. Meaningful only when
        `original_reasoning_timestamp` is supplied; ignored (and omitted from `details`) otherwise.

    source_nominations_reconstructed: True when the candidate's own `source_nominations` were
        recomputed after the fact (via a fresh, deterministic Stage 10.2A recomputation from
        current evidence) rather than captured live at the moment the original reasoning call was
        made — the B3/B3-P2 pilots never durably captured their nominations at call time, so any
        eventual backfill of them WILL need this. Keeps reconstructed provenance explicitly
        distinguishable from nominations genuinely captured at reasoning time. Defaults to False;
        only ever written into `details` when True.
    """
    original_reasoning_timestamp: str | None = None
    original_reasoning_timestamp_basis: str | None = None
    source_nominations_reconstructed: bool = False


async def persist_story_beat_reasoning_result(
    db: AsyncSession, video_analysis_id: int, record: StoryBeatReasoningRecord,
    backfill: StoryBeatBackfillProvenance | None = None,
) -> AnalysisAnnotation:
    """Durably persists ONE Story Beat reasoning result immediately. Commits right away — this is
    what makes the design crash-safe: a crash while reasoning about the NEXT candidate leaves this
    one already durably saved. Append-only: never deletes or overwrites a prior row for the same
    candidate_timestamp; a rerun (a different provider, model, or prompt version) simply adds its
    own new row, and every earlier attempt remains queryable history, distinguishable by
    `created_at` plus this row's own `details.provider`/`details.model`/`details.prompt_version`.

    This row represents a REASONING ATTEMPT about a candidate timestamp — never a final, time-
    ranged Story Beat. `certainty` is always "INFERRED" (this is an AI interpretation of the
    underlying evidence, never itself measured/observed data — the Shot/Speech/OCR rows this
    reasoning cites remain the MEASURED layer, untouched by this module).

    `backfill`: leave at the default None for ordinary LIVE persistence (immediately after a real
    reasoning call) — the resulting row's `details` then contains NONE of the historical-backfill
    keys at all, never a meaningless `false`/`null` placeholder for them, and normal-live behavior
    is byte-for-byte identical to Stage 10.3B4. Pass a `StoryBeatBackfillProvenance` only when
    durably recording a result that was ALREADY obtained earlier (Stage 10.3B3/B3-P2) and is only
    now being given a durable home — `AnalysisAnnotation.created_at` still reflects the actual
    moment THIS row is inserted either way; it is never overridden to the historical time, which
    lives only in `details.original_reasoning_timestamp` alongside its stated
    `.original_reasoning_timestamp_basis`. A backfilled row still preserves the ORIGINAL decision,
    confidence, reasoning, evidence references, provider, model, and prompt version exactly as the
    original call produced them — a historical "v1" result is never silently upgraded to a later
    prompt version."""
    decision = record.result.decision
    details = {
        "is_story_beat_boundary": decision.is_story_beat_boundary,
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
        category=STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY,
        start_time=record.result.candidate_timestamp,
        end_time=record.result.candidate_timestamp,
        details=details,
        certainty="INFERRED",
        # StoryBeatDecision carries no numeric confidence_score field (a deliberate Stage 10.3B1
        # design difference from ReasonerDecision) -- this column stays None, never fabricated.
        confidence_score=None,
        reasoning=decision.reasoning,
        source="ai_reasoning",
        produced_by_pass=STORY_BEAT_REASONING_PASS_NAME,
    )
    db.add(annotation)
    await db.commit()
    await db.refresh(annotation)
    return annotation


def _record_from_annotation(row: AnalysisAnnotation) -> StoryBeatReasoningRecord:
    details = row.details or {}
    decision = StoryBeatDecision(
        is_story_beat_boundary=details.get("is_story_beat_boundary"),
        confidence=details.get("confidence"),
        reasoning=row.reasoning or "",
        evidence_references=details.get("evidence_references") or {},
        reasoning_contract_version=details.get("prompt_version"),
    )
    result = StoryBeatResult(
        decision=decision,
        provider=details.get("provider"),
        model=details.get("model"),
        candidate_timestamp=row.start_time,
        reasoning_contract_version=details.get("prompt_version"),
    )
    return StoryBeatReasoningRecord(result=result, source_nominations=details.get("source_nominations") or [])


async def load_latest_story_beat_reasoning_results(db: AsyncSession, video_analysis_id: int) -> list[StoryBeatReasoningRecord]:
    """Reconstructs one StoryBeatReasoningRecord per distinct candidate timestamp durably persisted
    for this VideoAnalysis -- always the LATEST attempt (by created_at) when several exist. Never
    deletes, never mutates, tracks no "consumed" state -- this is always a fresh, idempotent read
    of the current durable history's own latest view. A historical prompt version (e.g. a future
    "v1" once a "v2" exists) is read back exactly as stored -- this function never rewrites or
    upgrades an older row's own recorded version."""
    result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )
    rows = list(result.scalars().all())
    if not rows:
        return []

    # Greedy proximity clustering -- mirrors _deduplicate_nominations's (and the Scene store's own)
    # exact algorithm: compare each row against the LAST member of the current cluster, not the
    # cluster's own first member, so multiple reasoning attempts at genuinely the same candidate
    # group together even if their own exact float timestamps differ slightly.
    clusters: list[list[AnalysisAnnotation]] = [[rows[0]]]
    for row in rows[1:]:
        if _same_candidate(row.start_time, clusters[-1][-1].start_time):
            clusters[-1].append(row)
        else:
            clusters.append([row])

    return [_record_from_annotation(max(cluster, key=lambda r: r.created_at)) for cluster in clusters]


async def find_unreasoned_story_beat_candidates(db: AsyncSession, video_analysis_id: int) -> list[dict]:
    """Live Stage 10.2A candidates for this VideoAnalysis that have no durable Story Beat reasoning
    result yet -- the exact "still needs reasoning" work list. Recomputes candidates fresh every
    call (10.2A's own generation is deterministic given unchanged evidence) rather than caching a
    completeness flag that could go stale if evidence changes later. Never calls a Story Beat (or
    any other) reasoner or any external API -- this is a pure read/diff, exactly like Stage 10.2A
    itself.

    A durable attempt whose LATEST decision is False or None still counts as "reasoned about" --
    this function only checks whether a durable row exists at all for a candidate, never what that
    row's own decision was. A candidate is never re-offered here merely because its most recent
    Story Beat decision was negative or undecided."""
    live = await assemble_semantic_boundary_candidates(db, video_analysis_id)

    reasoned_result = await db.execute(
        select(AnalysisAnnotation.start_time).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY,
        )
    )
    reasoned_timestamps = list(reasoned_result.scalars().all())

    return [
        candidate for candidate in live["candidates"]
        if not any(_same_candidate(candidate["candidate_timestamp"], r) for r in reasoned_timestamps)
    ]
