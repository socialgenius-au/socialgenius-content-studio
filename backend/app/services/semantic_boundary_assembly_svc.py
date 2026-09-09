"""Video Deconstructor — Stage 10.2A: SEMANTIC BOUNDARY CANDIDATE + EVIDENCE ASSEMBLY.

Pure READ/ASSEMBLE layer over already-persisted Stage 1-9 evidence for ONE exact
`video_analysis_id`. Unlike every Stage 9 measurement service (visual_motion_svc.py,
local_motion_evidence_svc.py, transition_evidence_svc.py, transition_similarity_evidence_svc.py —
each a pure `video_path -> dict` function with NO database awareness), this module's own job is
inherently a database READ: assembling already-persisted rows into candidate timestamps and their
surrounding evidence. It therefore takes a real `AsyncSession`, but follows the exact same
discipline every other Stage 9 phase already established: no row is ever created, updated, or
deleted here — every query in this module is a `SELECT`, and the module never imports
`update`/`delete`/`insert` from sqlalchemy at all.

WHAT THIS MODULE ANSWERS (and does NOT answer) — see the Stage-10.0/10.0B/10.1/10.1B read-only
audits this module implements: "given already-measured Stage 1-9 evidence for one exact analysis
run, what timestamps deserve examination as CANDIDATE points where meaning MIGHT change, and what
existing evidence sits around each one?" It NEVER answers "does meaning actually change here" —
that is Stage 10.2B's own explicitly deferred job. This module produces ZERO semantic judgments:
no topic-change decision, no confidence-in-meaning score, no Scene row, no Story Beat, no
discourse-marker/keyword logic of any kind (English, Urdu, or otherwise). A SpeechSegment
boundary, a Shot boundary, a silence interval, and an OCR occurrence-group start are each
NOMINATIONS ONLY — evidence that a moment MIGHT be worth examining, never proof that it is.

LOCKED ARCHITECTURAL RULE (per Stage 10.1B's own real, evidence-validated findings — RV146's own
technical cut with no defensible semantic change, RV5127's own two real semantic boundaries with
NO technical cut anywhere near them): a technical Shot boundary and a semantic boundary are
INDEPENDENT. This module treats every candidate source identically — none is weighted as more
authoritative than another, and none is ever labelled "semantic" by this module itself.

EXACT `video_analysis_id` SCOPING (no fallback to "latest," ever): every single query in this
module filters by the exact `video_analysis_id` the caller supplies — there is no code path here
that queries `VideoAnalysis` itself, orders by `created_at`, or falls back to any other analysis
run. A `video_analysis_id` that does not exist, or that genuinely has zero evidence, both produce
the same honest empty/minimal result — never fabricated candidates, never another run's evidence.

CANDIDATE-SOURCE TYPES (see `_generate_raw_nominations`'s own docstring for the exact rule per
source):
  - `speech_gap`: the midpoint between two temporally adjacent SpeechSegments (an INTERNAL
    boundary only — never the very first segment's own start or the very last segment's own end,
    since those are the edges of the available speech range, not a boundary BETWEEN two sections).
  - `shot_boundary`: the shared cut instant between two adjacent Shots (`shot[i].end_time`) —
    reuses exactly the same "boundary between adjacent shots" concept B1/B2 already established,
    never the very first Shot's own start (t=0) or the very last Shot's own end (duration).
  - `silence_midpoint`: the midpoint of one persisted `audio_silence` AnalysisAnnotation interval
    — a deterministic, exact-value representative point for a genuinely variable-length interval,
    never claiming the pause's own edges are individually significant.
  - `ocr_occurrence_head`: the `start_time` of one OCR Occurrence Group's own canonical head row
    (`TextElement.occurrence_group_id IS NULL`) — every head nominates, regardless of its own
    `confidence_score`; that score travels into the evidence bundle for a later reasoning layer to
    weigh, never filtered out here (filtering by confidence would itself be a semantic-relevance
    judgment, which belongs to Stage 10.2B, not this assembly-only phase).

TEMPORAL DEDUPLICATION (see `_deduplicate_nominations`'s own docstring): purely a temporal
normalization, never a semantic one. Reuses `transition_evidence_svc.TRANSITION_BOUNDARY_MARGIN_
SECONDS` (0.5s) — an already-established Stage 9 constant, not a new number invented for this
phase — as the merge window: two raw nominations within that same margin of each other are judged
to represent the same real-world instant. Every original nomination (its own source type, source
row id, and original timestamp) is preserved inside the merged candidate's own `source_nominations`
list — nothing is discarded, only re-expressed as one shared candidate timestamp.

BOUNDED EVIDENCE BUNDLES: every candidate carries only the evidence immediately relevant to
judging it later — the one SpeechSegment/OCR-head immediately before and after, the Shot(s) it
falls inside or on the boundary of, and any AnalysisAnnotation row (silence/transition/transition-
similarity/recurring-text/persistent-visual-element) whose own time range overlaps the candidate
within the same 0.5s margin. This module never copies a video's entire evidence history into every
candidate — see `_assemble_candidate_bundle`'s own docstring for the exact bounded shape.

ORIGINAL-LANGUAGE-CANONICAL DISCIPLINE: `SpeechSegment.text`/`TextElement.text` are copied into
every bundle exactly as persisted — this module never translates, normalizes, re-cases, or
"repairs" a single character of either. Any interpretation of that text is explicitly Stage
10.2B's own future job, never this one's."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.text_element import TextElement
from app.models.visual_object import VisualObject
from app.services.transition_evidence_svc import TRANSITION_BOUNDARY_MARGIN_SECONDS

# The temporal-normalization merge window — reused verbatim from B1's own already-established
# Stage 9 constant (see this module's own docstring for why reusing it, rather than inventing a
# new number, is the correct choice here).
CANDIDATE_MERGE_WINDOW_SECONDS = TRANSITION_BOUNDARY_MARGIN_SECONDS

# The exact AnalysisAnnotation categories this module ever reads as candidate-adjacent context —
# an explicit, closed list (not "every category that happens to exist") so this module's own
# behavior never silently changes when an unrelated future category is added elsewhere.
_RELEVANT_ANNOTATION_CATEGORIES = [
    "audio_silence", "transition_evidence", "transition_similarity_evidence",
    "recurring_text_element", "persistent_visual_element",
]


def _speech_dict(seg: SpeechSegment) -> dict:
    return {"id": seg.id, "start_time": seg.start_time, "end_time": seg.end_time, "text": seg.text}


def _ocr_dict(head: TextElement) -> dict:
    return {"id": head.id, "start_time": head.start_time, "end_time": head.end_time, "text": head.text}


def _shot_dict(shot: Shot) -> dict:
    return {"id": shot.id, "order": shot.order, "start_time": shot.start_time, "end_time": shot.end_time}


def _annotation_dict(ann: AnalysisAnnotation) -> dict:
    return {"id": ann.id, "start_time": ann.start_time, "end_time": ann.end_time}


async def _fetch_evidence(db: AsyncSession, video_analysis_id: int) -> dict:
    """One exact-`video_analysis_id`-scoped read of every evidence type this module consults —
    every query below filters by this exact id, never by "latest" or any other analysis. Returns
    plain sorted lists of ORM rows; nothing here is mutated."""
    shots_result = await db.execute(
        select(Shot).where(Shot.video_analysis_id == video_analysis_id).order_by(Shot.order)
    )
    shots = list(shots_result.scalars().all())

    speech_result = await db.execute(
        select(SpeechSegment).where(SpeechSegment.video_analysis_id == video_analysis_id).order_by(SpeechSegment.start_time)
    )
    speech_segments = list(speech_result.scalars().all())

    ocr_result = await db.execute(
        select(TextElement).where(
            TextElement.video_analysis_id == video_analysis_id,
            TextElement.occurrence_group_id.is_(None),
        ).order_by(TextElement.start_time)
    )
    ocr_heads = list(ocr_result.scalars().all())

    ann_result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category.in_(_RELEVANT_ANNOTATION_CATEGORIES),
        ).order_by(AnalysisAnnotation.start_time)
    )
    annotations = list(ann_result.scalars().all())

    vo_result = await db.execute(
        select(VisualObject).where(VisualObject.video_analysis_id == video_analysis_id)
    )
    visual_objects = list(vo_result.scalars().all())

    return {
        "shots": shots, "speech_segments": speech_segments, "ocr_heads": ocr_heads,
        "annotations": annotations, "visual_objects": visual_objects,
    }


def _generate_raw_nominations(evidence: dict) -> list[dict]:
    """Every raw, unmerged, un-deduplicated candidate nomination — one dict per nomination,
    `{"source_type", "source_id", "timestamp"}`. See this module's own docstring for the exact
    rule per source type. Never classifies any nomination as semantic."""
    nominations: list[dict] = []

    shots = evidence["shots"]
    for i in range(len(shots) - 1):
        # The shared boundary between two ADJACENT shots -- shots are already gap-free/overlap-
        # free by Stage 4's own construction, so shots[i].end_time == shots[i+1].start_time.
        nominations.append({"source_type": "shot_boundary", "source_id": shots[i].id, "timestamp": shots[i].end_time})

    segments = evidence["speech_segments"]
    for i in range(len(segments) - 1):
        # INTERNAL boundary only -- the midpoint between one segment's own end and the next
        # segment's own start, never the very first start or very last end of the whole range.
        midpoint = (segments[i].end_time + segments[i + 1].start_time) / 2.0
        nominations.append({"source_type": "speech_gap", "source_id": segments[i].id, "timestamp": midpoint})

    for ann in evidence["annotations"]:
        if ann.category == "audio_silence":
            midpoint = (ann.start_time + ann.end_time) / 2.0
            nominations.append({"source_type": "silence_midpoint", "source_id": ann.id, "timestamp": midpoint})

    for head in evidence["ocr_heads"]:
        # Every head nominates regardless of its own confidence_score -- see this module's own
        # docstring for why filtering by confidence here would itself be a semantic judgment.
        nominations.append({"source_type": "ocr_occurrence_head", "source_id": head.id, "timestamp": head.start_time})

    return nominations


def _deduplicate_nominations(nominations: list[dict]) -> list[dict]:
    """Deterministic, bounded temporal clustering — PURELY a normalization of near-identical
    timestamps, never a semantic merge. Sorts every raw nomination by its own timestamp, then
    greedily starts a new cluster whenever the gap from the current cluster's own most recent
    member exceeds `CANDIDATE_MERGE_WINDOW_SECONDS`. A cluster's own representative
    `candidate_timestamp` is the mean of its member timestamps -- a simple, deterministic,
    order-independent choice. Every original nomination is preserved verbatim inside the
    cluster's own `source_nominations` list; nothing is discarded."""
    if not nominations:
        return []

    ordered = sorted(nominations, key=lambda n: n["timestamp"])
    clusters: list[list[dict]] = [[ordered[0]]]
    for nomination in ordered[1:]:
        if nomination["timestamp"] - clusters[-1][-1]["timestamp"] <= CANDIDATE_MERGE_WINDOW_SECONDS:
            clusters[-1].append(nomination)
        else:
            clusters.append([nomination])

    result = []
    for cluster in clusters:
        mean_timestamp = sum(n["timestamp"] for n in cluster) / len(cluster)
        result.append({"candidate_timestamp": mean_timestamp, "source_nominations": cluster})
    return result


def _nearest_before_after(items: list, timestamp: float, time_attr: str = "start_time") -> tuple:
    """Returns (immediately-before, immediately-after) from an already-sorted-by-`time_attr` list
    of ORM rows, relative to `timestamp` -- `None` for either side when nothing qualifies. "Before"
    is the item with the greatest `time_attr` value still <= timestamp; "after" is the item with
    the smallest `time_attr` value strictly > timestamp."""
    before = None
    after = None
    for item in items:
        value = getattr(item, time_attr)
        if value <= timestamp:
            before = item
        elif after is None:
            after = item
            break
    return before, after


def _shots_overlapping(shots: list[Shot], timestamp: float) -> list[Shot]:
    """Every Shot whose own [start_time, end_time] contains `timestamp` -- ordinarily exactly one
    Shot (timestamp falls inside it), or exactly two when `timestamp` sits precisely on a shared
    boundary (both the preceding and following Shot's own edge)."""
    return [s for s in shots if s.start_time <= timestamp <= s.end_time]


def _visual_object_labels_for_shot(visual_objects: list, shot_id: int | None) -> list[dict]:
    if shot_id is None:
        return []
    seen = set()
    labels = []
    for vo in visual_objects:
        if vo.shot_id == shot_id and (vo.category, vo.label) not in seen:
            seen.add((vo.category, vo.label))
            labels.append({"category": vo.category, "label": vo.label})
    return labels


def _assemble_candidate_bundle(candidate: dict, evidence: dict) -> dict:
    """The bounded evidence bundle for ONE normalized candidate -- exactly the fields item 4 of
    this phase's own task specifies, nothing more. Never copies the video's entire evidence
    history: only the immediately-adjacent SpeechSegment/OCR-head, the overlapping Shot(s), and
    AnalysisAnnotation rows whose own range overlaps the candidate within the same merge window."""
    timestamp = candidate["candidate_timestamp"]

    speech_before, speech_after = _nearest_before_after(evidence["speech_segments"], timestamp, "start_time")
    ocr_before, ocr_after = _nearest_before_after(evidence["ocr_heads"], timestamp, "start_time")
    shots_overlapping = _shots_overlapping(evidence["shots"], timestamp)

    nearby_annotations: dict[str, list[dict]] = {cat: [] for cat in _RELEVANT_ANNOTATION_CATEGORIES}
    for ann in evidence["annotations"]:
        # "Nearby" -- the candidate falls inside the annotation's own range, or within one merge
        # window of either edge -- a bounded, deterministic overlap test, never a semantic one.
        if (ann.start_time - CANDIDATE_MERGE_WINDOW_SECONDS) <= timestamp <= (ann.end_time + CANDIDATE_MERGE_WINDOW_SECONDS):
            nearby_annotations[ann.category].append(_annotation_dict(ann))

    shot_before_id = shots_overlapping[0].id if shots_overlapping else None
    shot_after_id = shots_overlapping[-1].id if shots_overlapping else None

    return {
        "candidate_timestamp": timestamp,
        "source_nominations": candidate["source_nominations"],
        "speech_before": _speech_dict(speech_before) if speech_before else None,
        "speech_after": _speech_dict(speech_after) if speech_after else None,
        "ocr_before": _ocr_dict(ocr_before) if ocr_before else None,
        "ocr_after": _ocr_dict(ocr_after) if ocr_after else None,
        "shots_overlapping": [_shot_dict(s) for s in shots_overlapping],
        "nearby_annotations": nearby_annotations,
        "visual_objects_before": _visual_object_labels_for_shot(evidence["visual_objects"], shot_before_id),
        "visual_objects_after": _visual_object_labels_for_shot(evidence["visual_objects"], shot_after_id),
    }


async def assemble_semantic_boundary_candidates(db: AsyncSession, video_analysis_id: int) -> dict:
    """Stage 10.2A's own single entry point. Reads every relevant Stage 1-9 evidence row scoped
    EXACTLY to `video_analysis_id` (never "latest," never any other analysis), generates raw
    candidate nominations from every available source, deduplicates near-identical timestamps
    into normalized candidates, and assembles a bounded evidence bundle around each. Never
    creates, updates, or deletes any row. Never classifies any candidate as a genuine semantic
    boundary -- that decision is explicitly deferred to Stage 10.2B.

    Degrades gracefully: any missing evidence type (no transcript, no OCR, no silence, no
    annotations) simply contributes zero nominations of that type -- candidates still generate
    normally from whatever IS available, and a video with no evidence at all produces a valid,
    honest, empty candidate list, never a fabricated one.

    Returns:
        {
          "video_analysis_id": int,
          "evidence_inventory": {"shot_count", "speech_segment_count",
                                  "ocr_occurrence_group_count", "silence_count"},
          "candidates": [ <bounded evidence bundle>, ... ],  # sorted by candidate_timestamp
        }
    """
    evidence = await _fetch_evidence(db, video_analysis_id)
    raw_nominations = _generate_raw_nominations(evidence)
    normalized_candidates = _deduplicate_nominations(raw_nominations)
    normalized_candidates.sort(key=lambda c: c["candidate_timestamp"])

    bundles = [_assemble_candidate_bundle(c, evidence) for c in normalized_candidates]

    silence_count = sum(1 for a in evidence["annotations"] if a.category == "audio_silence")

    return {
        "video_analysis_id": video_analysis_id,
        "evidence_inventory": {
            "shot_count": len(evidence["shots"]),
            "speech_segment_count": len(evidence["speech_segments"]),
            "ocr_occurrence_group_count": len(evidence["ocr_heads"]),
            "silence_count": silence_count,
        },
        "candidates": bundles,
    }
