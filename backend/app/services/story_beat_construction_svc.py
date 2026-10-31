"""Video Deconstructor — Stage 10.3B7: STORY BEAT CONSTRUCTION V1.

The first stage that ever creates a final `AnalysisAnnotation(category="story_beat")` row. Converts
the durable Story Beat reasoning attempts (Stage 10.3B4/B5 store) into persisted, deterministically-
derived time-ranged Story Beats. A deliberate SIBLING of `scene_construction_svc.py` -- it mirrors
that module's shape (accepted-boundary policy, `0 -> boundaries -> duration` range construction,
delete-then-replace persistence, provider/version provenance) but is a SEPARATE module that never
imports, modifies, or shares mutable code with it. The two answer different questions (see
`app.services.story_beat_reasoner.contract`'s own docstring).

WHAT THIS MODULE DOES NOT DO (by design):
  - It never calls a Story Beat reasoner, Anthropic, or any external model/API. It consumes the
    already-persisted `story_beat_boundary_attempt` rows as plain data (never imports `anthropic`,
    `app.services.story_beat_reasoner.router`, or `reason_about_story_beat_boundary`).
  - It never reads or writes `Shot.scene_id`, and it never writes `shot_id` on the beat rows it
    creates -- a Story Beat has no single authoritative parent Shot; Beat<->Shot overlap is a
    read-time comparison of two independent time ranges.
  - It never introduces a beat-type / rhetorical-move / narrative-role taxonomy, a Scene foreign
    key, or any Tutorial/TeachingPoint field. Stage 10.3 establishes only WHERE a beat boundary is,
    never WHAT kind of move it is (deferred, exactly like `Scene.narrative_role`).
  - It never mutates any `semantic_boundary_attempt`, `semantic_boundary_decision`, `Scene`,
    `Shot`, `SpeechSegment`, `TextElement`, or `story_beat_boundary_attempt` row. Every write is a
    new `story_beat` `AnalysisAnnotation` row (plus this VideoAnalysis's own `pass_status` /
    `ai_provider_versions_used` JSON), all additive, all scoped to one VideoAnalysis.

ACCEPTED-BOUNDARY POLICY (Stage 10.3B7-P1 Verdict B): a durable latest-per-candidate reasoning
attempt becomes a construction boundary candidate only when
`details["is_story_beat_boundary"] is True` AND `details["confidence"] in ("medium", "high")`.
`False` -> no boundary. `None` (undecided) -> no boundary, NEVER converted to False. A low-
confidence True stays durable reasoning evidence but does not automatically become a final boundary.

SEMANTIC-DUPLICATE HANDLING (Stage 10.3B7-P1 Verdict B, revised Stage 10.3 Boundary Methodology
Review, isolated in `_dedup_transition_clusters`): the real B6 data contains several accepted
`True` boundaries at nearby timestamps that cite the SAME supporting speech segments and describe
the SAME rhetorical transition (the same move nominated at two adjacent candidate timestamps).
Construction v1 collapses such a cluster to one boundary.

CLUSTER-LEVEL (not pairwise-adjacent) COMPATIBILITY: a candidate may join an existing cluster only
when it is compatible with the CLUSTER AS A WHOLE, not merely with the most recently added member.
The Methodology Review found this distinction is load-bearing on real data: a naive "compare only
against the last member" version of this rule lets single-link chaining silently bridge two
genuinely different rhetorical events through a shared middle candidate (e.g. evidence sets
`{713,714}`, `{713,714}`, `{714,715}` -- the first two are a genuine duplicate nomination, but the
third describes a DIFFERENT pivot that only shares the boundary speech-segment id 714; a
last-member-only comparison would incorrectly chain all three into one surviving boundary via that
shared id). A candidate joins the current cluster only when BOTH:
  1. `candidate.start_time - cluster[0].start_time <= STORY_BEAT_TRANSITION_CLUSTER_WINDOW_SECONDS`
     -- measured from the cluster's FIRST member, not its last, so total cluster span (not just
     adjacent gaps) is bounded. Since candidates are processed in timestamp order this is
     equivalent to a hard cap on the cluster's total time span; AND
  2. the candidate's `supporting_speech_segment_ids` set is EVIDENCE-COMPATIBLE with EVERY existing
     member of the cluster (not just the last one): both sets non-empty, AND one is a subset of (or
     equal to) the other. A candidate that fails this test against even one existing member starts
     a new cluster instead of joining.
This is deliberately conservative: for Story Beat construction, false-merging two genuine
rhetorical moves is judged more damaging than leaving an occasional true duplicate unmerged (the
`10.042`/`12.083` case on VA5368 -- identical evidence, but a 2.04s gap exceeding the window --
is a known, intentional, documented V1 limitation left un-tuned rather than special-cased).
`STORY_BEAT_TRANSITION_CLUSTER_WINDOW_SECONDS = 1.5` is a **versioned construction heuristic
derived from the Stage 10.3B7-P1 real-data audit -- it is NOT a universal definition of a Story
Beat, and it is deliberately NOT `CANDIDATE_MERGE_WINDOW_SECONDS`** (that 0.5s constant is for
"same real-world instant" candidate/result matching and is both too small to catch these and
semantically the wrong tool). There is intentionally NO general minimum-Story-Beat-duration rule:
two close accepted boundaries with incompatible speech evidence stay separate, so proximity never
silently becomes a minimum-duration rule. No reasoning-text comparison and no AI call happen
inside construction.

Within a cluster the surviving boundary is chosen deterministically: (1) highest confidence
("high" > "medium"); (2) tie -> earliest candidate timestamp; (3) final tie -> lowest
reasoning-attempt annotation id. Every discarded attempt id is recorded on the affected beat(s) as
`co_nominated_attempt_ids` (and inside the surviving boundary object). The discarded durable
attempts themselves are never touched.

RANGE CONSTRUCTION: sorted surviving-boundary timestamps partition `[0, D]` into contiguous beats.
`D` is `ReferenceVideo.duration`, falling back to `max(Shot.end_time)` for this VideoAnalysis;
if NEITHER exists this module refuses to construct rather than guess. Boundaries are never snapped
to Scene or Shot edges. Zero/negative-duration intervals are refused (`StoryBeatConstructionError`),
never emitted.

NO-ACCEPTED-BOUNDARY CASE: if there are reasoning attempts but zero accepted boundaries (any mix of
`False`, `None`, and excluded `True/low`), construction creates exactly one beat `[0.0, D]` with
`boundary_start = None`, `boundary_end = None`, `boundary_status = "no_accepted_boundary"`, and the
ids of every unresolved (`None`) attempt under `unresolved_attempt_ids`. This status means only
"construction v1 found no accepted boundary" -- it does NOT assert that rhetorical continuity was
affirmatively established. With zero reasoning attempts at all, construction creates nothing.

IDEMPOTENCY / DELIBERATE RECONSTRUCTION: unlike `scene_construction_svc` (which short-circuits
permanently on its `pass_status` flag), this module ALWAYS rebuilds from the CURRENT durable
latest-per-candidate attempts via a delete-then-replace of this VideoAnalysis's `story_beat` rows.
Construction is deterministic, so a plain rerun with unchanged durable input produces byte-identical
rows and never duplicates; but a rerun AFTER a newer durable reasoning attempt was appended for
some candidate rebuilds to reflect it (deliberate reconstruction). `pass_status
["story_beat_construction"] = "complete"` is written purely as an observability record of the last
run, never as a short-circuit gate.

PROVIDER/VERSION PROVENANCE: `VideoAnalysis.ai_provider_versions_used["story_beat_construction_v1"]`
is set to the deduplicated, sorted list of the distinct `{provider, model}` pairs of the SELECTED
(surviving) boundary attempts -- one entry if they all shared a provider/model, several if a future
mixed set genuinely did not; cleared if a reconstruction ends up with zero selected boundaries.
Each internal boundary object additionally preserves its own `prompt_version` / `provider` /
`model`, so `final Beat -> exact reasoning_attempt_id -> candidate evidence -> original source` is
always traceable and a later prompt-version change cannot rewrite an existing beat.
"""
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.video_analysis import VideoAnalysis
from app.services.semantic_boundary_assembly_svc import CANDIDATE_MERGE_WINDOW_SECONDS
from app.services.story_beat_boundary_reasoning_store_svc import STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY

STORY_BEAT_CATEGORY = "story_beat"
STORY_BEAT_CONSTRUCTION_PASS_NAME = "story_beat_construction_v1"
STORY_BEAT_CONSTRUCTION_PASS_STATUS_KEY = "story_beat_construction"

ACCEPTED_CONFIDENCE_LEVELS = ("medium", "high")

# Stage 10.3B7-P1-derived VERSIONED construction heuristic -- NOT a universal Story Beat definition,
# and deliberately NOT CANDIDATE_MERGE_WINDOW_SECONDS (0.5s, "same real-world instant" matching).
# The B6 real data showed the same rhetorical transition nominated as accepted True at candidate
# timestamps up to ~0.95s apart (e.g. 6.133 & 7.08, both citing speech [706, 707]); 1.5s gives that
# a comfortable margin while still leaving genuinely distinct ~2s beats untouched. Revisit as
# `_v2` if later validation data contradicts it.
STORY_BEAT_TRANSITION_CLUSTER_WINDOW_SECONDS = 1.5

_CONFIDENCE_RANK = {"high": 2, "medium": 1, "low": 0}


class StoryBeatConstructionError(Exception):
    """Raised for every condition this module refuses to silently paper over: no authoritative
    duration available, a selected boundary outside [0, D], or a zero/negative-duration interval.
    Never raised for a merely-rejected (False / None / low-confidence) reasoning attempt -- those
    are normal, expected outcomes, not errors."""


async def _resolve_duration(db: AsyncSession, video_analysis_id: int) -> float:
    """Authoritative video duration -- `ReferenceVideo.duration` first, else `max(Shot.end_time)`
    for this same VideoAnalysis, never derived from a candidate timestamp. Independently defined
    here (not imported from `scene_construction_svc`) so this module has no coupling to Scene
    construction. Raises `StoryBeatConstructionError`, never guesses, if neither source exists."""
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise StoryBeatConstructionError(f"VideoAnalysis {video_analysis_id} does not exist.")

    reference_video = await db.get(ReferenceVideo, video_analysis.reference_video_id)
    if reference_video is not None and reference_video.duration is not None:
        return reference_video.duration

    max_shot_end = (await db.execute(
        select(func.max(Shot.end_time)).where(Shot.video_analysis_id == video_analysis_id)
    )).scalar_one_or_none()
    if max_shot_end is not None:
        return max_shot_end

    raise StoryBeatConstructionError(
        f"No authoritative duration available for video_analysis_id={video_analysis_id}: "
        "ReferenceVideo.duration is unset and no Shot rows exist to fall back on."
    )


async def _latest_attempt_rows_per_candidate(db: AsyncSession, video_analysis_id: int) -> list[AnalysisAnnotation]:
    """The latest durable `story_beat_boundary_attempt` ROW per distinct candidate timestamp for
    this VideoAnalysis, ordered by candidate timestamp.

    Deliberately mirrors `story_beat_boundary_reasoning_store_svc.load_latest_story_beat_reasoning_
    results`'s own selection exactly -- same greedy proximity clustering (each row compared against
    the LAST member of the current cluster, using the shared, generic `CANDIDATE_MERGE_WINDOW_
    SECONDS` "same real-world instant" constant) and same "latest attempt by created_at wins per
    cluster" rule. It returns the ORM rows themselves (which that store function's record-shaped
    return intentionally omits) because construction needs each surviving attempt's own `id` for
    boundary provenance."""
    rows = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == STORY_BEAT_BOUNDARY_ATTEMPT_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all())
    if not rows:
        return []

    clusters: list[list[AnalysisAnnotation]] = [[rows[0]]]
    for row in rows[1:]:
        if abs(row.start_time - clusters[-1][-1].start_time) <= CANDIDATE_MERGE_WINDOW_SECONDS:
            clusters[-1].append(row)
        else:
            clusters.append([row])
    latest = [max(cluster, key=lambda r: r.created_at) for cluster in clusters]
    latest.sort(key=lambda r: r.start_time)
    return latest


def _is_accepted(row: AnalysisAnnotation) -> bool:
    details = row.details or {}
    return details.get("is_story_beat_boundary") is True and details.get("confidence") in ACCEPTED_CONFIDENCE_LEVELS


def _evidence_ids(row: AnalysisAnnotation, key: str) -> list[int]:
    return list((row.details or {}).get("evidence_references", {}).get(key) or [])


def _speech_ids(row: AnalysisAnnotation) -> set[int]:
    return set(_evidence_ids(row, "supporting_speech_segment_ids"))


def _evidence_compatible(a: set[int], b: set[int]) -> bool:
    """Two speech-evidence sets are compatible only when both are non-empty AND one is a subset of
    (or equal to) the other -- deliberately stricter than mere intersection. A shared endpoint id
    between two otherwise-different sets (e.g. `{713,714}` vs `{714,715}`) is NOT compatible: that
    shape is exactly what a genuinely sequential pair of rhetorical moves produces (one transition's
    "after" segment is the next transition's "before" segment), not a duplicate nomination of one
    event. Symmetric by construction (`a <= b or b <= a`)."""
    return bool(a) and bool(b) and (a <= b or b <= a)


def _dedup_transition_clusters(
    accepted_rows: list[AnalysisAnnotation],
) -> tuple[list[AnalysisAnnotation], dict[int, list[int]]]:
    """Story Beat construction v1's conservative deterministic transition-clustering policy --
    isolated here so it can evolve to `_v2` without touching reasoning or persistence.

    `accepted_rows` must already be sorted by candidate timestamp. A candidate joins the CURRENT
    cluster only when BOTH hold at the CLUSTER level (not merely against the last-added member --
    see the module docstring's "Methodology Review" note on why last-member-only comparison permits
    transitive chaining through a shared middle candidate):
      1. `candidate.start_time - cluster[0].start_time <= STORY_BEAT_TRANSITION_CLUSTER_WINDOW_
         SECONDS` (bounds the cluster's total span, not just adjacent gaps); AND
      2. the candidate's `supporting_speech_segment_ids` set is `_evidence_compatible` with EVERY
         existing member of the cluster.
    Failing either test against even one existing member starts a new cluster -- so two close
    boundaries with incompatible or empty speech evidence stay separate (proximity alone never
    merges), and a candidate can never bridge into a cluster by matching only its most recent
    member.

    Returns `(survivors, co_nominated)` where `survivors` is one row per cluster (sorted by
    timestamp) chosen by: highest confidence -> earliest timestamp -> lowest id; and
    `co_nominated[survivor_id]` lists the discarded attempt ids for that cluster (sorted)."""
    if not accepted_rows:
        return [], {}

    clusters: list[list[AnalysisAnnotation]] = [[accepted_rows[0]]]
    for row in accepted_rows[1:]:
        cluster = clusters[-1]
        within_span = (row.start_time - cluster[0].start_time) <= STORY_BEAT_TRANSITION_CLUSTER_WINDOW_SECONDS
        this_speech = _speech_ids(row)
        compatible_with_cluster = within_span and all(
            _evidence_compatible(this_speech, _speech_ids(member)) for member in cluster
        )
        if compatible_with_cluster:
            cluster.append(row)
        else:
            clusters.append([row])

    survivors: list[AnalysisAnnotation] = []
    co_nominated: dict[int, list[int]] = {}
    for cluster in clusters:
        winner = min(
            cluster,
            key=lambda r: (-_CONFIDENCE_RANK.get((r.details or {}).get("confidence"), -1), r.start_time, r.id),
        )
        survivors.append(winner)
        discarded = sorted(r.id for r in cluster if r.id != winner.id)
        if discarded:
            co_nominated[winner.id] = discarded

    survivors.sort(key=lambda r: r.start_time)
    return survivors, co_nominated


def _boundary_object(row: AnalysisAnnotation, co_nominated_ids: list[int]) -> dict:
    """The internal-boundary provenance dict -- built ENTIRELY from the selected durable reasoning
    attempt. IDs only; no transcript / OCR / frame text is ever copied."""
    details = row.details or {}
    obj = {
        "reasoning_attempt_id": row.id,
        "candidate_timestamp": row.start_time,
        "provider": details.get("provider"),
        "model": details.get("model"),
        "prompt_version": details.get("prompt_version"),
        "confidence": details.get("confidence"),
        "supporting_shot_ids": _evidence_ids(row, "supporting_shot_ids"),
        "supporting_frame_ids": _evidence_ids(row, "supporting_frame_ids"),
        "supporting_speech_segment_ids": _evidence_ids(row, "supporting_speech_segment_ids"),
        "supporting_text_element_ids": _evidence_ids(row, "supporting_text_element_ids"),
        "supporting_annotation_ids": _evidence_ids(row, "supporting_annotation_ids"),
    }
    if co_nominated_ids:
        obj["co_nominated_attempt_ids"] = list(co_nominated_ids)
    return obj


async def construct_and_persist_story_beats(
    db: AsyncSession,
    video_analysis_id: int,
) -> list[AnalysisAnnotation]:
    """Stage 10.3B7's single entry point. Reads the durable latest-per-candidate Story Beat
    reasoning attempts for one exact VideoAnalysis and persists the resulting `story_beat` rows.
    Never calls a reasoner or any external API. Always rebuilds deterministically (delete-then-
    replace) so it is safe to rerun and safe to reconstruct after a newer durable attempt appears.

    Raises `StoryBeatConstructionError` before any write if duration is unavailable, a selected
    boundary lies outside `[0, D]`, or two selected boundaries would produce a zero/negative-
    duration interval -- never silently reinterprets any of these.
    """
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise StoryBeatConstructionError(f"VideoAnalysis {video_analysis_id} does not exist.")

    latest_rows = await _latest_attempt_rows_per_candidate(db, video_analysis_id)

    # Zero reasoning attempts at all -> nothing to construct from. (Distinct from "attempts exist
    # but none accepted", which DOES produce the whole-video no_accepted_boundary beat below.)
    if not latest_rows:
        await db.execute(delete(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
        ))
        pass_status = dict(video_analysis.pass_status or {})
        provider_versions = dict(video_analysis.ai_provider_versions_used or {})
        provider_versions.pop(STORY_BEAT_CONSTRUCTION_PASS_NAME, None)
        video_analysis.pass_status = {**pass_status, STORY_BEAT_CONSTRUCTION_PASS_STATUS_KEY: "complete"}
        video_analysis.ai_provider_versions_used = provider_versions
        await db.commit()
        return []

    duration = await _resolve_duration(db, video_analysis_id)

    accepted_rows = [r for r in latest_rows if _is_accepted(r)]
    survivors, co_nominated = _dedup_transition_clusters(accepted_rows)
    boundary_ts = [r.start_time for r in survivors]

    for ts in boundary_ts:
        if not (0.0 <= ts <= duration):
            raise StoryBeatConstructionError(
                f"Selected Story Beat boundary {ts} lies outside this video's own duration [0, {duration}]."
            )

    edges = [0.0, *boundary_ts, duration]
    for earlier, later in zip(edges, edges[1:]):
        if later <= earlier:
            raise StoryBeatConstructionError(
                f"Story Beat construction would create a zero/negative-duration interval "
                f"[{earlier}, {later}] -- refusing to emit it (two selected boundaries, or a "
                "boundary coincident with a source edge, collapsed to a point). No minimum-duration "
                "rule is applied; only strictly-positive intervals are required."
            )

    none_rows = [r for r in latest_rows if (r.details or {}).get("is_story_beat_boundary") is None]
    none_ids_sorted = sorted(r.id for r in none_rows)

    beat_rows: list[AnalysisAnnotation] = []

    if not survivors:
        # There ARE reasoning attempts but none was an accepted boundary.
        beat_rows.append(AnalysisAnnotation(
            video_analysis_id=video_analysis_id,
            shot_id=None,
            category=STORY_BEAT_CATEGORY,
            start_time=0.0,
            end_time=duration,
            details={
                "boundary_start": None,
                "boundary_end": None,
                "boundary_status": "no_accepted_boundary",
                "reasoning_attempt_ids": [],
                "unresolved_attempt_ids": none_ids_sorted,
            },
            certainty="INFERRED",
            confidence_score=None,
            reasoning=None,
            source="story_beat_construction",
            produced_by_pass=STORY_BEAT_CONSTRUCTION_PASS_NAME,
        ))
    else:
        for i in range(len(edges) - 1):
            start_row = survivors[i - 1] if i > 0 else None
            end_row = survivors[i] if i < len(survivors) else None

            start_co = co_nominated.get(start_row.id, []) if start_row is not None else []
            end_co = co_nominated.get(end_row.id, []) if end_row is not None else []

            boundary_start = _boundary_object(start_row, start_co) if start_row is not None else None
            boundary_end = _boundary_object(end_row, end_co) if end_row is not None else None

            details: dict = {
                "boundary_start": boundary_start,
                "boundary_end": boundary_end,
                "boundary_status": "constructed",
                "reasoning_attempt_ids": [r.id for r in (start_row, end_row) if r is not None],
            }
            beat_co_nominated = sorted(set(start_co) | set(end_co))
            if beat_co_nominated:
                details["co_nominated_attempt_ids"] = beat_co_nominated
            examined = sorted(r.id for r in none_rows if edges[i] < r.start_time < edges[i + 1])
            if examined:
                details["examined_unresolved_attempt_ids"] = examined

            beat_rows.append(AnalysisAnnotation(
                video_analysis_id=video_analysis_id,
                shot_id=None,
                category=STORY_BEAT_CATEGORY,
                start_time=edges[i],
                end_time=edges[i + 1],
                details=details,
                certainty="INFERRED",
                confidence_score=None,
                reasoning=None,
                source="story_beat_construction",
                produced_by_pass=STORY_BEAT_CONSTRUCTION_PASS_NAME,
            ))

    # Always rebuild -- delete this VideoAnalysis's prior story_beat rows, then write the fresh set.
    await db.execute(delete(AnalysisAnnotation).where(
        AnalysisAnnotation.video_analysis_id == video_analysis_id,
        AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
    ))
    for beat in beat_rows:
        db.add(beat)

    pass_status = dict(video_analysis.pass_status or {})
    provider_versions = dict(video_analysis.ai_provider_versions_used or {})
    distinct_provider_models = sorted(
        {((r.details or {}).get("provider"), (r.details or {}).get("model")) for r in survivors}
    )
    if distinct_provider_models:
        provider_versions[STORY_BEAT_CONSTRUCTION_PASS_NAME] = [
            {"provider": provider, "model": model} for provider, model in distinct_provider_models
        ]
    else:
        provider_versions.pop(STORY_BEAT_CONSTRUCTION_PASS_NAME, None)
    video_analysis.pass_status = {**pass_status, STORY_BEAT_CONSTRUCTION_PASS_STATUS_KEY: "complete"}
    video_analysis.ai_provider_versions_used = provider_versions

    await db.commit()
    for beat in beat_rows:
        await db.refresh(beat)
    return beat_rows
