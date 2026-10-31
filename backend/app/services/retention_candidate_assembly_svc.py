"""Video Deconstructor — Stage 11.4: RETENTION DEVICE CANDIDATE ASSEMBLY.

Pure READ/ASSEMBLE layer, mirroring `semantic_boundary_assembly_svc`'s own discipline exactly:
every query here is a SELECT, this module never creates/updates/deletes a row, and it produces
ZERO semantic judgments of any kind. It answers only "which moments deserve closer examination as
possible retention-device candidates, and what local evidence surrounds each one?" — never "is
this actually a retention device."

CANDIDATE SOURCES (Section 3 of the Stage 11.4 brief): Story Beat boundaries, Scene boundaries,
Shot cuts, transition evidence, TextElement appearances, a MEASURED "possible question" signal
(the raw text structurally contains a question mark — "?" or the Arabic/Urdu "؟" — never a claim
that it IS a retention-functioning question; that conclusion is the reasoner's own, later,
INFERRED job), Stage 11.1 pacing-phase changes (adjacent phases of the SAME partition type whose
own average_shot_exposure_duration differs by more than a documented relative threshold), and
audio silence intervals that sit adjacent to one of the other candidate sources above.

Deliberately NOT its own separate "motion/camera change" candidate source: motion evidence
(global/local motion, transition evidence) is inherently SHOT-SCOPED in this schema — every Shot
already produces its own shot-cut candidate, and that Shot's own motion evidence is included in
the candidate's local evidence bundle for the reasoner to examine directly. Inventing a second,
numerically-thresholded "significant motion change" candidate source on top of that would require
tuning a threshold against the two real videos this stage has -- exactly the "do not tune purely
around VA5368" risk the brief explicitly warns against -- so this module leaves that judgment to
the reasoner's own read of the real numbers already present in the bundle.

ANTI-TRANSITIVE GROUPING (Section 4 — reusing Stage 10.3's own hard-won lesson): candidates are
grouped using the EXACT correction already proven in
story_beat_construction_svc._dedup_transition_clusters — a nomination joins the current cluster
only when it is within `RETENTION_CANDIDATE_GROUPING_WINDOW_SECONDS` of the cluster's FIRST
member, never merely its most-recently-added one. Comparing only against the last member is
precisely what let Stage 10.3's original V1 silently chain unrelated events A-B-C together through
a shared middle candidate B; the identical bug would reappear here with a different evidence shape
if not guarded against the same way.

BOUNDED LOCAL EVIDENCE (Section 5): each grouped candidate's own evidence bundle is scoped to
`[candidate_start - RETENTION_LOCAL_EVIDENCE_PADDING_SECONDS, candidate_end +
RETENTION_LOCAL_EVIDENCE_PADDING_SECONDS]` — never the whole video. Same overlap test and same
purely-factual field shapes hook_evidence_assembly_svc already established (raw text/labels/
timestamps/each row's own pre-existing evidence_summary) — a deliberate, convergent SIBLING
design, never shared code, since a Hook Window and a retention candidate window are genuinely
different concepts with different lifetimes.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.speech_segment import SpeechSegment
from app.models.text_element import TextElement
from app.models.video_analysis import VideoAnalysis
from app.models.visual_object import VisualObject
from app.services.editing_rhythm_svc import EDITING_PACING_PHASE_CATEGORY
from app.services.story_beat_construction_svc import STORY_BEAT_CATEGORY

_MOTION_CATEGORIES = ["global_motion_evidence", "local_motion_evidence", "local_motion_dynamics"]
_TRANSITION_CATEGORIES = ["transition_evidence", "transition_similarity_evidence"]
_AUDIO_SILENCE_CATEGORY = "audio_silence"
_QUESTION_MARKS = ("?", "؟")

# The ONE place both retention-candidate temporal tolerances live (per the same "do not scatter
# thresholds" discipline Stage 11.1 already established for its own cut-alignment tolerances).
# Neither is CANDIDATE_MERGE_WINDOW_SECONDS (0.5s, Stage 10's "same real-world instant" constant)
# nor STORY_BEAT_TRANSITION_CLUSTER_WINDOW_SECONDS (1.5s, a Story-Beat-specific, evidence-gated
# rule) -- this is a new, Stage-11.4-local, purely temporal grouping rule with no evidence-overlap
# component, answering a different question ("do these signals describe the same underlying
# retention moment") than either existing constant was built for.
RETENTION_CANDIDATE_GROUPING_WINDOW_SECONDS = 1.0
# How far beyond a candidate's own grouped span the local evidence bundle extends on each side --
# deliberately small and separate from the grouping window above (grouping decides WHICH signals
# describe the same moment; padding only gives the reasoner a little surrounding context once a
# moment is already decided).
RETENTION_LOCAL_EVIDENCE_PADDING_SECONDS = 1.5
# A deliberately loose, first, NOT-YET-VALIDATED-AGAINST-A-BENCHMARK relative-change threshold for
# "this Stage 11.1 pacing phase looks meaningfully different from the one before it" -- picked to
# be conservative (a big, unmistakable swing) rather than tuned against either real video this
# stage currently has, per the brief's own explicit warning.
RETENTION_PACING_CHANGE_RELATIVE_THRESHOLD = 0.5


class RetentionCandidateAssemblyError(Exception):
    """Raised only when the VideoAnalysis does not exist -- every missing-evidence case (no Shots,
    no Story Beats, no pacing phases, ...) degrades to zero candidates from that source, never an
    error."""


def _overlaps(row_start: float, row_end: float, window_start: float, window_end: float) -> bool:
    return row_start < window_end and row_end > window_start


def _contains_question_mark(text: str | None) -> bool:
    return bool(text) and any(mark in text for mark in _QUESTION_MARKS)


def _pacing_changed(a: dict, b: dict) -> bool:
    """A MEASURED, purely arithmetic comparison of two adjacent Stage 11.1 pacing phases (same
    partition_type) -- never a claim that the change is meaningful in any interpretive sense. Both
    average_shot_exposure_duration values must be real (non-None, > 0) for a comparison to be
    possible at all; missing data never silently becomes "no change."""
    a_dur, b_dur = a.get("average_shot_exposure_duration"), b.get("average_shot_exposure_duration")
    if not a_dur or not b_dur:
        return False
    larger = max(a_dur, b_dur)
    return abs(a_dur - b_dur) / larger > RETENTION_PACING_CHANGE_RELATIVE_THRESHOLD


async def _fetch_evidence(db: AsyncSession, video_analysis_id: int) -> dict:
    shots = list((await db.execute(
        select(Shot).where(Shot.video_analysis_id == video_analysis_id).order_by(Shot.order)
    )).scalars().all())
    story_beats = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all())
    scenes = list((await db.execute(
        select(Scene).where(Scene.video_analysis_id == video_analysis_id).order_by(Scene.order)
    )).scalars().all())
    speech_segments = list((await db.execute(
        select(SpeechSegment).where(SpeechSegment.video_analysis_id == video_analysis_id).order_by(SpeechSegment.start_time)
    )).scalars().all())
    text_elements = list((await db.execute(
        select(TextElement).where(
            TextElement.video_analysis_id == video_analysis_id,
            TextElement.occurrence_group_id.is_(None),
        ).order_by(TextElement.start_time)
    )).scalars().all())
    visual_objects = list((await db.execute(
        select(VisualObject).where(VisualObject.video_analysis_id == video_analysis_id)
    )).scalars().all())
    motion_rows = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category.in_(_MOTION_CATEGORIES),
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all())
    transition_rows = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category.in_(_TRANSITION_CATEGORIES),
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all())
    silence_rows = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == _AUDIO_SILENCE_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all())
    pacing_phase_rows = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == EDITING_PACING_PHASE_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all())

    return {
        "shots": shots, "story_beats": story_beats, "scenes": scenes,
        "speech_segments": speech_segments, "text_elements": text_elements,
        "visual_objects": visual_objects, "motion_rows": motion_rows,
        "transition_rows": transition_rows, "silence_rows": silence_rows,
        "pacing_phase_rows": pacing_phase_rows,
    }


def _generate_raw_nominations(evidence: dict) -> list[dict]:
    """Every raw, unmerged candidate nomination — `{"source_type", "source_id", "timestamp"}`.
    Never classifies any nomination as a genuine retention device; see this module's own
    docstring for the exact rule per source."""
    nominations: list[dict] = []

    shots = evidence["shots"]
    for i in range(len(shots) - 1):
        nominations.append({"source_type": "shot_cut", "source_id": shots[i].id, "timestamp": shots[i].end_time})

    story_beats = evidence["story_beats"]
    for i in range(len(story_beats) - 1):
        nominations.append({"source_type": "story_beat_boundary", "source_id": story_beats[i].id, "timestamp": story_beats[i].end_time})

    scenes = evidence["scenes"]
    for i in range(len(scenes) - 1):
        nominations.append({"source_type": "scene_boundary", "source_id": scenes[i].id, "timestamp": scenes[i].end_time})

    for row in evidence["transition_rows"]:
        nominations.append({"source_type": "transition_evidence", "source_id": row.id, "timestamp": row.start_time})

    for t in evidence["text_elements"]:
        nominations.append({"source_type": "text_appearance", "source_id": t.id, "timestamp": t.start_time})

    for seg in evidence["speech_segments"]:
        if _contains_question_mark(seg.text):
            nominations.append({"source_type": "possible_question_speech", "source_id": seg.id, "timestamp": seg.start_time})

    for t in evidence["text_elements"]:
        if _contains_question_mark(t.text):
            nominations.append({"source_type": "possible_question_text", "source_id": t.id, "timestamp": t.start_time})

    # Pacing changes: adjacent phases of the SAME partition_type only -- Scene-based and
    # Story-Beat-based phases are independent segmentations (Stage 11.1's own established rule)
    # and are never compared against each other here.
    by_partition: dict[str, list[dict]] = {}
    for row in evidence["pacing_phase_rows"]:
        details = row.details or {}
        by_partition.setdefault(details.get("partition_type"), []).append({
            "id": row.id, "start_time": row.start_time, "end_time": row.end_time,
            "average_shot_exposure_duration": details.get("average_shot_exposure_duration"),
        })
    for phases in by_partition.values():
        phases.sort(key=lambda p: p["start_time"])
        for i in range(len(phases) - 1):
            if _pacing_changed(phases[i], phases[i + 1]):
                nominations.append({"source_type": "pacing_change", "source_id": phases[i + 1]["id"], "timestamp": phases[i + 1]["start_time"]})

    # Silence adjacent to an already-nominated structural change (computed from everything above).
    structural_timestamps = [n["timestamp"] for n in nominations]
    for row in evidence["silence_rows"]:
        near_structural_change = any(
            abs(row.start_time - t) <= RETENTION_CANDIDATE_GROUPING_WINDOW_SECONDS
            or abs(row.end_time - t) <= RETENTION_CANDIDATE_GROUPING_WINDOW_SECONDS
            for t in structural_timestamps
        )
        if near_structural_change:
            midpoint = (row.start_time + row.end_time) / 2.0
            nominations.append({"source_type": "silence_adjacent_to_change", "source_id": row.id, "timestamp": midpoint})

    return nominations


def _group_candidates(nominations: list[dict]) -> list[dict]:
    """Anti-transitive, span-bounded grouping — see this module's own docstring for why this
    compares against the CLUSTER'S FIRST member, never merely its last. Returns one dict per
    cluster: `{"candidate_start", "candidate_end", "candidate_center", "source_nominations"}`,
    sorted by candidate_start."""
    if not nominations:
        return []
    ordered = sorted(nominations, key=lambda n: n["timestamp"])
    clusters: list[list[dict]] = [[ordered[0]]]
    for nomination in ordered[1:]:
        cluster = clusters[-1]
        if nomination["timestamp"] - cluster[0]["timestamp"] <= RETENTION_CANDIDATE_GROUPING_WINDOW_SECONDS:
            cluster.append(nomination)
        else:
            clusters.append([nomination])

    result = []
    for cluster in clusters:
        timestamps = [n["timestamp"] for n in cluster]
        result.append({
            "candidate_start": min(timestamps),
            "candidate_end": max(timestamps),
            "candidate_center": sum(timestamps) / len(timestamps),
            "source_nominations": sorted(cluster, key=lambda n: n["timestamp"]),
        })
    result.sort(key=lambda c: c["candidate_start"])
    return result


async def generate_retention_candidates(db: AsyncSession, video_analysis_id: int) -> list[dict]:
    """Stage 11.4's own candidate-generation entry point. Returns the grouped candidate list only
    (no evidence bundle yet — see `assemble_candidate_evidence_bundle` for that, called once per
    candidate by the orchestration layer). Never creates, updates, or deletes any row."""
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise RetentionCandidateAssemblyError(f"VideoAnalysis {video_analysis_id} does not exist.")

    evidence = await _fetch_evidence(db, video_analysis_id)
    raw = _generate_raw_nominations(evidence)
    return _group_candidates(raw)


async def assemble_candidate_evidence_bundle(db: AsyncSession, video_analysis_id: int, candidate: dict) -> dict:
    """The bounded local evidence bundle for ONE already-grouped candidate — scoped to
    `[candidate_start - PADDING, candidate_end + PADDING]`, never the whole video. Purely factual
    fields only, exactly mirroring hook_evidence_assembly_svc's own field shapes."""
    window_start = candidate["candidate_start"] - RETENTION_LOCAL_EVIDENCE_PADDING_SECONDS
    window_end = candidate["candidate_end"] + RETENTION_LOCAL_EVIDENCE_PADDING_SECONDS

    evidence = await _fetch_evidence(db, video_analysis_id)

    def q(rows):
        return [r for r in rows if _overlaps(r.start_time, r.end_time, window_start, window_end)]

    shots = q(evidence["shots"])
    story_beats = q(evidence["story_beats"])
    scenes = q(evidence["scenes"])
    speech_segments = q(evidence["speech_segments"])
    text_elements = q(evidence["text_elements"])
    visual_objects = q(evidence["visual_objects"])
    motion_rows = q(evidence["motion_rows"])
    transition_rows = q(evidence["transition_rows"])
    silence_rows = q(evidence["silence_rows"])
    pacing_phase_rows = q(evidence["pacing_phase_rows"])

    return {
        "candidate_window": {"start_time": window_start, "end_time": window_end,
                              "candidate_start": candidate["candidate_start"], "candidate_end": candidate["candidate_end"]},
        "source_nominations": candidate["source_nominations"],
        "shots": [{"id": s.id, "order": s.order, "start_time": s.start_time, "end_time": s.end_time} for s in shots],
        "story_beats": [{"id": b.id, "start_time": b.start_time, "end_time": b.end_time,
                          "boundary_status": (b.details or {}).get("boundary_status")} for b in story_beats],
        "scenes": [{"id": sc.id, "order": sc.order, "start_time": sc.start_time, "end_time": sc.end_time} for sc in scenes],
        "speech_segments": [{"id": s.id, "start_time": s.start_time, "end_time": s.end_time, "text": s.text, "language": s.language} for s in speech_segments],
        "text_elements": [{"id": t.id, "start_time": t.start_time, "end_time": t.end_time, "text": t.text} for t in text_elements],
        "visual_objects": [{"id": v.id, "label": v.label, "category": v.category, "start_time": v.start_time, "end_time": v.end_time} for v in visual_objects],
        "motion_evidence": [{"id": a.id, "category": a.category, "start_time": a.start_time, "end_time": a.end_time, "fact": a.evidence_summary} for a in motion_rows],
        "transition_evidence": [{"id": a.id, "category": a.category, "start_time": a.start_time, "end_time": a.end_time, "fact": a.evidence_summary} for a in transition_rows],
        "audio_silence": [{"id": a.id, "start_time": a.start_time, "end_time": a.end_time, "fact": a.evidence_summary} for a in silence_rows],
        "editing_pacing_phases": [
            {
                "id": p.id, "partition_type": (p.details or {}).get("partition_type"),
                "start_time": p.start_time, "end_time": p.end_time,
                "overlapping_shot_count": (p.details or {}).get("overlapping_shot_count"),
                "cuts_in_phase": (p.details or {}).get("cuts_in_phase"),
                "average_shot_exposure_duration": (p.details or {}).get("average_shot_exposure_duration"),
            }
            for p in pacing_phase_rows
        ],
    }
