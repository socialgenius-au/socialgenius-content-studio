"""Video Deconstructor — Stage 2 (Ingestion), Stage 3 (Technical Analysis), Stage 4 (Deterministic
Shot/Cut Boundary Detection), Stage 5 (Visual Evidence / Representative Frames).

STAGE 2 — Ingestion, not analysis: wraps an already-uploaded Asset (via the existing, untouched
POST /upload/ endpoint — this router never receives or writes a file itself) into one immutable
ReferenceVideo row plus its initial VideoAnalysis row (status="pending").

STAGE 3 — POST /{id}/analyze runs ONE deterministic pass ("technical_probe": a header-only
ffmpeg read, no decode, no AI) against the existing pending VideoAnalysis and writes its results
into ReferenceVideo's six technical columns plus the controlled `technical_details` JSON column.

STAGE 4 — POST /{id}/analyze-structure runs a SECOND deterministic pass ("scene_segmentation": a
full decode via ffmpeg's own scene-difference filter, still no AI) against the SAME VideoAnalysis
row Stage 3 already completed, and writes its results as new Shot rows (see
app.services.ffmpeg_svc.detect_shot_boundary_candidates/build_shot_segments for the mechanism).
No Scene row is ever created here — semantic scene grouping is a later, interpretive stage (see
shot.py's own module docstring); every Stage-4 Shot has `scene_id=NULL` and a direct
`video_analysis_id`. No TextElement, VisualObject, AnalysisAnnotation, or StrategicInsight row is
ever created here either.

Both stages' pass-completion writes are each done in one transaction — if anything raises before
that transaction's commit, nothing persists.

Duplicates (Stage 2): if a ReferenceVideo already exists for this exact asset_id, that existing
ReferenceVideo is returned rather than creating a second one.

Concurrency: a VideoAnalysis's top-level `status` column is the ONE concurrency guard for
WHICHEVER pass is currently being attempted (Stage 3: "pending"->"running"; Stage 4:
"complete"->"running", since Stage 4 always starts from a Stage-3-completed row) — always via one
atomic, guarded UPDATE ("... WHERE status = X" in the same statement that flips it to "running").
A second near-simultaneous request against the same row necessarily updates zero rows and is told
"already in progress" (409) rather than starting a second, conflicting run — proven under real
concurrent requests in both stages' own test suites.

Per-pass state (Stage 4 addition): `pass_status` (a dict already on VideoAnalysis since Stage 1,
newly exposed on the API response) tracks each named pass's own state independently —
{"technical_probe": "complete", "scene_segmentation": "running"} — so the frontend can keep
showing Stage 3's already-trustworthy results while Stage 4 runs, and so a Stage-4 failure never
overwrites or hides Stage 3's success. Because of this, a Stage-4 failure resets the row's
top-level `status` back to "complete" (not "failed") — the row's last genuinely successful
checkpoint is still intact and safely retriable; only `pass_status.scene_segmentation` records
the failure. This differs, deliberately, from Stage 3's own failure handling (which sets
top-level status to "failed", since nothing at all had succeeded yet on a fresh row) — Stage 4 is
an additional pass layered onto an already-valid row, not the row's first and only pass.

Retry: unlike Stage 3 (whose retry creates a brand-new VideoAnalysis version, since a failed
technical_probe means nothing on that row was ever trustworthy), a failed Stage-4 pass retries
IN PLACE on the very same VideoAnalysis row — its other pass (technical_probe) is already valid
and must not be discarded or duplicated by starting a fresh row.

Restoration (post-Stage-3 defect fix): GET / lists the caller's own ReferenceVideos, newest
first — the read-side counterpart POST / always should have had, so a frontend that only ever
held its result in local component state has a way to fetch it back after a reload/remount
without re-uploading or creating anything new.

STAGE 5 — POST /{id}/analyze-frames runs a THIRD deterministic pass ("visual_evidence": ffmpeg
single-frame extraction + Pillow/numpy pixel measurements, still no AI, no OCR, no object/person/
text detection) against the SAME VideoAnalysis row Stage 4 already completed, for EVERY Shot on
that row — see app.services.ffmpeg_svc.plan_representative_frame_timestamps/
extract_representative_frames_for_shot for the extraction mechanism. Writes one new Asset (the
extracted JPEG, same storage convention as any other file in this app) and one new ShotFrame row
per accepted frame (near-duplicate candidates are silently skipped, never persisted — see
ffmpeg_svc.compute_dhash). Each Shot's own `keyframe_asset_id` is also set to its midpoint frame's
asset, so a caller wanting exactly one cheap thumbnail per shot never has to query ShotFrame at
all. Follows Stage 4's exact concurrency/retry/pass-status conventions (same VideoAnalysis row,
same atomic complete->running claim, same "failure resets status back to complete, only
pass_status.visual_evidence records the failure" behaviour) for the same reason: this is a THIRD
pass layered onto an already-valid row, not the row's first and only pass. Extraction happens entirely before any DB write; a mid-run failure unlinks every file already
extracted this attempt (nothing was ever committed, so nothing is orphaned) and leaves any prior
successful ShotFrame/Asset rows alone. Only once every Shot's extraction has fully succeeded does
it (defensively, same reasoning as Stage 4's own Shot cleanup) clear this pass's own prior rows
and write the fresh set, all in one transaction — no orphaned files, no partial "complete" state
ever presented.
"""
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.shot_frame import ShotFrame
from app.models.speech_segment import SpeechSegment
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.models.visual_object import VisualObject
from app.schemas.reference_video import (
    AffineMotionEvidenceSummary, AudioSilenceIntervalSummary, AudioStructureSummary, GlobalMotionEvidenceSummary,
    PersistentLayoutStabilitySummary, PersistentVisualElementSummary, PhaseCorrelationMotionEvidenceSummary,
    RecurringElementSummary, ReferenceVideoIngestRequest, ReferenceVideoResponse, SameFrameLayoutPairSummary,
    ShotFrameSummary, ShotSummary, SpeechSegmentSummary, TextElementSummary, TextObservationSummary,
    TransitionAffineEvidenceSummary, TransitionAffinePairSummary, TransitionEvidenceSummary,
    TransitionFrameDifferenceSummary, TransitionLuminanceSummary, TransitionPhaseCorrelationEvidenceSummary,
    TransitionPhaseCorrelationPairSummary, VideoAnalysisSummary, VisualObjectLayoutSummary, VisualObjectSummary,
)
from app.services import (
    audio_structure_svc, ffmpeg_svc, ocr_svc, speech_analysis_svc, transition_evidence_svc, visual_composition_svc,
    visual_geometry_svc, visual_motion_svc, visual_object_svc, visual_persistence_svc,
)

router = APIRouter()

# Probing is a header-only read (sub-second in practice, verified against a real ~6.5MB/34s
# file during Stage 3's own implementation) — a "running" row still stuck past this is almost
# certainly a crashed/killed process, not a slow probe. Generous on purpose.
STALE_RUNNING_TIMEOUT_SECONDS = 300

# Stage 6 manual-test finding (real Railway run, Shot 01/02): with no confidence gate anywhere
# in the pipeline, an Occurrence Group head formed from a single low-confidence EasyOCR misread
# (e.g. "Au", "Ztam", "72" at 2%-19% confidence) surfaces as its own full-weight "occurrence" in
# the UI/API summary, identical in presentation to a legitimate high-confidence detection.
#
# This is a PRESENTATION-LAYER eligibility gate ONLY, applied in _to_response below — it decides
# which Occurrence Group heads are counted/returned in `shot.text_elements`, nothing else.
# Deliberately does NOT touch: EasyOCR itself, frame sampling, select_frames_to_ocr,
# group_occurrences, link_recurring_elements, or any TextElement row ever written — every raw
# observation this pass produces is stored exactly as before and remains fully queryable; a
# filtered-out head's own row (and every member still grouped under it) is untouched in the DB.
# Because this filter runs at read time, it also applies retroactively to every already-analyzed
# ReferenceVideo with no re-run of Stage 6 required.
#
# Applies to CONFIDENCE ONLY, never group size — a genuine, rare, single-observation detection at
# or above this bar must still be surfaced; the earlier design review confirmed group-of-one is
# not itself evidence of unreliability (see group_occurrences' own "ambiguous cases stay separate
# by construction" guarantee).
#
# 0.50 is a first, conservative cut informed directly by this manual test's own real values (the
# reported noise sat at 2%-19%; 0.50 rejects all of it with wide margin while not yet touching
# the harder mid-confidence cases) — not a universal constant. Named so a future recalibration
# is a one-line, documented change, same convention as ocr_svc.py's own threshold constants.
MIN_SURFACED_OCR_CONFIDENCE = 0.50


async def _to_response(db: AsyncSession, rv: ReferenceVideo, asset: Asset) -> ReferenceVideoResponse:
    result = await db.execute(
        select(VideoAnalysis)
        .where(VideoAnalysis.reference_video_id == rv.id)
        .order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    pass_status = dict(latest.pass_status or {})
    analysis_summary = VideoAnalysisSummary(
        id=latest.id,
        analysis_tier=latest.analysis_tier,
        status=latest.status,
        created_at=latest.created_at,
        started_at=latest.started_at,
        completed_at=latest.completed_at,
        error=(pass_status.get("error") if latest.status == "failed" else None)
        or pass_status.get("scene_segmentation_error")
        or pass_status.get("visual_evidence_error")
        or pass_status.get("text_analysis_error")
        or pass_status.get("speech_analysis_error")
        or pass_status.get("audio_structure_error")
        or pass_status.get("visual_objects_error")
        or pass_status.get("visual_persistence_error")
        or pass_status.get("visual_composition_error")
        or pass_status.get("global_motion_evidence_error")
        or pass_status.get("transition_evidence_error"),
        pass_status=pass_status,
    )

    shots_result = await db.execute(
        select(Shot).where(Shot.video_analysis_id == latest.id).order_by(Shot.order)
    )
    shot_rows = shots_result.scalars().all()

    # Stage 5/6: each Shot's representative-frame AND text-occurrence evidence sets, fetched in
    # batched queries (never once-per-shot/once-per-frame) — ShotFrame/TextElement have no
    # relationship() to Asset in this codebase's own explicit-query style (see this module's own
    # docstring precedent). One shared `assets_by_id` lookup covers both, since a Stage-6
    # TextElement may reuse an existing Stage-5 ShotFrame's own Asset.
    frames_result = await db.execute(
        select(ShotFrame).where(ShotFrame.video_analysis_id == latest.id).order_by(ShotFrame.shot_id, ShotFrame.order)
    )
    frame_rows = frames_result.scalars().all()

    text_result = await db.execute(
        select(TextElement).where(TextElement.video_analysis_id == latest.id).order_by(TextElement.shot_id, TextElement.start_time)
    )
    text_rows = text_result.scalars().all()

    needed_asset_ids = {f.asset_id for f in frame_rows} | {t.source_frame_asset_id for t in text_rows if t.source_frame_asset_id is not None}
    assets_by_id: dict[int, Asset] = {}
    if needed_asset_ids:
        assets_result = await db.execute(select(Asset).where(Asset.id.in_(needed_asset_ids)))
        assets_by_id = {a.id: a for a in assets_result.scalars().all()}

    frames_by_shot: dict[int, list[ShotFrameSummary]] = {}
    for f in frame_rows:
        frame_asset = assets_by_id.get(f.asset_id)
        if frame_asset is None:
            continue  # unreachable via RESTRICT FK — skip defensively rather than 500 a read
        frames_by_shot.setdefault(f.shot_id, []).append(ShotFrameSummary(
            id=f.id, order=f.order, timestamp=f.timestamp, extraction_method=f.extraction_method,
            width=f.width, height=f.height, measurements=f.measurements or {},
            certainty=f.certainty, evidence_summary=f.evidence_summary, produced_by_pass=f.produced_by_pass,
            asset_file_path=frame_asset.file_path,
        ))

    def _observation_summary(t: TextElement) -> TextObservationSummary:
        source_asset = assets_by_id.get(t.source_frame_asset_id) if t.source_frame_asset_id is not None else None
        return TextObservationSummary(
            id=t.id, text=t.text, timestamp=t.start_time,  # a raw observation is a single
            # instant — start_time == end_time on every row this pass ever writes
            x=t.x, y=t.y, width=t.width, height=t.height,
            confidence_score=t.confidence_score, evidence_summary=t.evidence_summary,
            source_frame_asset_file_path=source_asset.file_path if source_asset else None,
        )

    # Two-level grouping: every TextElement row is a raw observation; occurrence_group_id NULL
    # marks a row as its own group's canonical head (see text_element.py's own docstring). Build
    # each head's own summary with EVERY member (head included) nested under `observations` —
    # never hidden, only grouped — and a derived (never stored) start/end span across them.
    heads_by_id: dict[int, TextElement] = {t.id: t for t in text_rows if t.occurrence_group_id is None}
    members_by_head: dict[int, list[TextElement]] = {}
    for t in text_rows:
        if t.occurrence_group_id is not None:
            members_by_head.setdefault(t.occurrence_group_id, []).append(t)

    text_by_shot: dict[int, list[TextElementSummary]] = {}
    for head in heads_by_id.values():
        if head.shot_id is None:
            continue  # Stage 6 always populates shot_id today; defensive, not expected
        # Stage-6 manual-test fix (see MIN_SURFACED_OCR_CONFIDENCE's own docstring above): an
        # unreliable head is simply not counted as an "occurrence" here — its own row, and
        # every member still grouped under it, remain fully intact and queryable in the DB.
        # Confidence only, never group size — a genuine high-confidence group-of-one still
        # reaches this point and is still surfaced below.
        if head.confidence_score is not None and head.confidence_score < MIN_SURFACED_OCR_CONFIDENCE:
            continue
        members = members_by_head.get(head.id, [])
        group_rows = [head, *members]
        source_asset = assets_by_id.get(head.source_frame_asset_id) if head.source_frame_asset_id is not None else None
        text_by_shot.setdefault(head.shot_id, []).append(TextElementSummary(
            id=head.id, text=head.text,
            start_time=min(r.start_time for r in group_rows), end_time=max(r.end_time for r in group_rows),
            x=head.x, y=head.y, width=head.width, height=head.height,
            certainty=head.certainty, confidence_score=head.confidence_score, category=head.category,
            style_details=head.style_details, evidence_summary=head.evidence_summary,
            produced_by_pass=head.produced_by_pass,
            source_frame_asset_file_path=source_asset.file_path if source_asset else None,
            observations=[_observation_summary(r) for r in sorted(group_rows, key=lambda r: r.start_time)],
        ))
    for shot_id in text_by_shot:
        text_by_shot[shot_id].sort(key=lambda s: s.start_time)

    # Stage 8 Phase B — raw visual-object detections, shot-scoped like frames/text_elements
    # above (see ShotSummary's own docstring for why, unlike Stage 7's timeline-wide evidence).
    # Every source_frame_id points at a ShotFrame already covered by frame_rows/assets_by_id
    # above, so no additional Asset query is needed here — just the frame_id -> asset_id lookup.
    frame_id_to_asset_id = {f.id: f.asset_id for f in frame_rows}
    visual_objects_result = await db.execute(
        select(VisualObject).where(VisualObject.video_analysis_id == latest.id).order_by(VisualObject.shot_id, VisualObject.start_time)
    )
    visual_object_rows = visual_objects_result.scalars().all()

    # Composition MVP Part A — largest_by_area is computed PER SOURCE FRAME, never across
    # frames: every VisualObject sharing one source_frame_id genuinely coexists in one image;
    # different frames never do — see visual_geometry_svc.py's own docstring.
    boxes_by_source_frame: dict[int, dict[int, visual_geometry_svc.Box]] = {}
    for vo in visual_object_rows:
        if vo.source_frame_id is None:
            continue
        boxes_by_source_frame.setdefault(vo.source_frame_id, {})[vo.id] = visual_geometry_svc.Box(vo.x, vo.y, vo.width, vo.height)
    largest_ids_by_source_frame = {
        fid: set(visual_geometry_svc.largest_by_area(boxes)) for fid, boxes in boxes_by_source_frame.items()
    }

    visual_objects_by_shot: dict[int, list[VisualObjectSummary]] = {}
    for vo in visual_object_rows:
        if vo.shot_id is None:
            continue  # Stage 8 Phase B always populates shot_id today; defensive, not expected
        source_asset = None
        if vo.source_frame_id is not None:
            source_asset = assets_by_id.get(frame_id_to_asset_id.get(vo.source_frame_id))
        # Composition MVP Part A — deterministic, on-demand layout derivative of this same row's
        # own x/y/width/height (see VisualObjectLayoutSummary's own docstring); never persisted.
        box = visual_geometry_svc.Box(vo.x, vo.y, vo.width, vo.height)
        edges = visual_geometry_svc.edge_distances(box)
        centroid_x, centroid_y = visual_geometry_svc.centroid(box)
        layout = VisualObjectLayoutSummary(
            frame_occupancy=visual_geometry_svc.area(box),
            centroid_x=centroid_x, centroid_y=centroid_y,
            distance_from_frame_center=visual_geometry_svc.distance_from_frame_center(box),
            edge_distance_left=edges["left"], edge_distance_right=edges["right"],
            edge_distance_top=edges["top"], edge_distance_bottom=edges["bottom"],
            nearest_edge_distance=visual_geometry_svc.nearest_edge_distance(box),
            horizontal_third=visual_geometry_svc.horizontal_third(box),
            vertical_third=visual_geometry_svc.vertical_third(box),
        )
        is_largest = vo.id in largest_ids_by_source_frame.get(vo.source_frame_id, set())
        visual_objects_by_shot.setdefault(vo.shot_id, []).append(VisualObjectSummary(
            id=vo.id, label=vo.label, category=vo.category, class_id=vo.class_id,
            x=vo.x, y=vo.y, width=vo.width, height=vo.height,
            start_time=vo.start_time, end_time=vo.end_time,
            certainty=vo.certainty, confidence_score=vo.confidence_score,
            evidence_summary=vo.evidence_summary, source=vo.source, produced_by_pass=vo.produced_by_pass,
            source_frame_id=vo.source_frame_id,
            source_frame_asset_file_path=source_asset.file_path if source_asset else None,
            layout=layout,
            is_largest_detected_region_in_source_frame=is_largest,
        ))

    # Composition MVP Part A — same-frame pairwise layout evidence, shot-scoped, NEVER computed
    # across two different source frames (see SameFrameLayoutPairSummary's own docstring).
    same_frame_pairs_by_shot: dict[int, list[SameFrameLayoutPairSummary]] = {}
    vo_by_shot_and_frame: dict[tuple[int, int], list[VisualObject]] = {}
    for vo in visual_object_rows:
        if vo.shot_id is None or vo.source_frame_id is None:
            continue
        vo_by_shot_and_frame.setdefault((vo.shot_id, vo.source_frame_id), []).append(vo)
    for (pair_shot_id, pair_frame_id), frame_vos in vo_by_shot_and_frame.items():
        frame_vos_sorted = sorted(frame_vos, key=lambda v: v.id)
        for i in range(len(frame_vos_sorted)):
            for j in range(i + 1, len(frame_vos_sorted)):
                vo_a, vo_b = frame_vos_sorted[i], frame_vos_sorted[j]
                box_a = visual_geometry_svc.Box(vo_a.x, vo_a.y, vo_a.width, vo_a.height)
                box_b = visual_geometry_svc.Box(vo_b.x, vo_b.y, vo_b.width, vo_b.height)
                containment = visual_geometry_svc.containment_ratios(box_a, box_b)
                rel = visual_geometry_svc.centroid_relative_position(box_a, box_b)
                same_frame_pairs_by_shot.setdefault(pair_shot_id, []).append(SameFrameLayoutPairSummary(
                    source_frame_id=pair_frame_id, visual_object_id_a=vo_a.id, visual_object_id_b=vo_b.id,
                    iou=visual_geometry_svc.iou(box_a, box_b),
                    intersection_over_a=containment["intersection_over_a"],
                    intersection_over_b=containment["intersection_over_b"],
                    area_ratio=visual_geometry_svc.area_ratio(box_a, box_b),
                    centroid_displacement=visual_geometry_svc.centroid_displacement(box_a, box_b),
                    a_centroid_above_b=rel["a_centroid_above_b"], a_centroid_below_b=rel["a_centroid_below_b"],
                    a_centroid_left_of_b=rel["a_centroid_left_of_b"], a_centroid_right_of_b=rel["a_centroid_right_of_b"],
                ))

    # Stage 8 Phase C1 — derived same-shot persistence claims, reusing AnalysisAnnotation
    # (category="persistent_visual_element") exactly as Stage 6's own recurring_elements reuses
    # it — see visual_persistence_svc.py's own docstring for the full derivation this surfaces.
    persistence_result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "persistent_visual_element",
        ).order_by(AnalysisAnnotation.shot_id, AnalysisAnnotation.start_time)
    )
    persistent_by_shot: dict[int, list[PersistentVisualElementSummary]] = {}
    for ann in persistence_result.scalars().all():
        if ann.shot_id is None:
            continue  # Phase C1 always populates shot_id (same-shot-only rule) — defensive
        details = ann.details or {}
        persistent_by_shot.setdefault(ann.shot_id, []).append(PersistentVisualElementSummary(
            id=ann.id,
            native_label=details.get("native_label"),
            member_visual_object_ids=details.get("member_visual_object_ids", []),
            source_frame_ids=details.get("source_frame_ids", []),
            observation_count=details.get("observation_count", 0),
            start_time=ann.start_time, end_time=ann.end_time,
            representative_visual_object_id=details.get("representative_visual_object_id"),
            representative_bbox=details.get("representative_bbox"),
            detector_confidences=details.get("detector_confidences", []),
            geometry_evidence=details.get("geometry_evidence", []),
            certainty=ann.certainty,
            linkage_confidence=ann.confidence_score,
            reasoning=ann.reasoning,
            evidence_summary=ann.evidence_summary,
            source=ann.source,
            produced_by_pass=ann.produced_by_pass,
        ))

    # Composition MVP Part B — shot-level layout-drift evidence over C1's own persistent
    # elements, reusing AnalysisAnnotation (category="persistent_layout_stability") — see
    # visual_composition_svc.py's own docstring for the exact metric definitions.
    stability_result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "persistent_layout_stability",
        ).order_by(AnalysisAnnotation.shot_id, AnalysisAnnotation.start_time)
    )
    layout_stability_by_shot: dict[int, list[PersistentLayoutStabilitySummary]] = {}
    for ann in stability_result.scalars().all():
        if ann.shot_id is None:
            continue  # this pass always populates shot_id (inherited from its own C1 source) — defensive
        details = ann.details or {}
        layout_stability_by_shot.setdefault(ann.shot_id, []).append(PersistentLayoutStabilitySummary(
            id=ann.id,
            source_persistent_visual_element_id=details.get("source_persistent_visual_element_id"),
            native_label=details.get("native_label"),
            member_visual_object_ids=details.get("member_visual_object_ids", []),
            source_frame_ids=details.get("source_frame_ids", []),
            centroid_max_pairwise_displacement=details.get("centroid_max_pairwise_displacement"),
            width_min=details.get("width_min"), width_max=details.get("width_max"), width_range=details.get("width_range"),
            height_min=details.get("height_min"), height_max=details.get("height_max"), height_range=details.get("height_range"),
            occupancy_min=details.get("occupancy_min"), occupancy_max=details.get("occupancy_max"),
            occupancy_range=details.get("occupancy_range"),
            certainty=ann.certainty,
            confidence_score=ann.confidence_score,
            reasoning=ann.reasoning,
            evidence_summary=ann.evidence_summary,
            source=ann.source,
            produced_by_pass=ann.produced_by_pass,
        ))

    # Stage 9 Phase A — MEASURED global-motion evidence per Shot, reusing AnalysisAnnotation
    # (category="global_motion_evidence") — see visual_motion_svc.py's own docstring. Absent for
    # any Shot too short to have produced evidence (see that endpoint's own docstring); never a
    # fabricated zero-motion row.
    global_motion_result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "global_motion_evidence",
        )
    )
    global_motion_by_shot: dict[int, GlobalMotionEvidenceSummary] = {}
    for ann in global_motion_result.scalars().all():
        if ann.shot_id is None:
            continue  # this pass always populates shot_id — defensive
        details = ann.details or {}
        global_motion_by_shot[ann.shot_id] = GlobalMotionEvidenceSummary(
            id=ann.id,
            sampling_fps=details.get("sampling_fps"),
            sample_count=details.get("sample_count"),
            frame_pair_count=details.get("frame_pair_count"),
            affine=AffineMotionEvidenceSummary(**details.get("affine", {})),
            phase_correlation=PhaseCorrelationMotionEvidenceSummary(**details.get("phase_correlation", {})),
            cross_stream=details.get("cross_stream"),  # Phase C1 — additive; None on older rows
            extraction_parameters=details.get("extraction_parameters", {}),
            certainty=ann.certainty,
            confidence_score=ann.confidence_score,
            reasoning=ann.reasoning,
            evidence_summary=ann.evidence_summary,
            source=ann.source,
            produced_by_pass=ann.produced_by_pass,
        )

    shots = [
        ShotSummary(
            id=s.id, order=s.order, start_time=s.start_time, end_time=s.end_time,
            certainty=s.certainty, evidence_summary=s.evidence_summary, produced_by_pass=s.produced_by_pass,
            frames=frames_by_shot.get(s.id, []),
            text_elements=text_by_shot.get(s.id, []),
            visual_objects=visual_objects_by_shot.get(s.id, []),
            persistent_visual_elements=persistent_by_shot.get(s.id, []),
            same_frame_layout_pairs=same_frame_pairs_by_shot.get(s.id, []),
            layout_stability=layout_stability_by_shot.get(s.id, []),
            global_motion_evidence=global_motion_by_shot.get(s.id),
        )
        for s in shot_rows
    ]

    # Recurring Element cross-references — video-level (see ReferenceVideoResponse's own
    # docstring for why: a recurring element may span multiple Shots), explicitly INFERRED,
    # never confused with the MEASURED groups/observations above.
    recurring_result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "recurring_text_element",
        ).order_by(AnalysisAnnotation.start_time)
    )
    recurring_elements = [
        RecurringElementSummary(
            id=r.id,
            member_text_element_ids=(r.details or {}).get("member_occurrence_group_head_ids", []),
            start_time=r.start_time, end_time=r.end_time,
            certainty=r.certainty, confidence_score=r.confidence_score,
            reasoning=r.reasoning, evidence_summary=r.evidence_summary, produced_by_pass=r.produced_by_pass,
        )
        for r in recurring_result.scalars().all()
    ]

    # Stage 7 — speech-recognition evidence, video-level (never nested under a Shot; see
    # speech_segment.py's own docstring for why speech is not forced into visual cut boundaries).
    # Chronological order, same convention as every other evidence list in this response.
    speech_result = await db.execute(
        select(SpeechSegment).where(SpeechSegment.video_analysis_id == latest.id).order_by(SpeechSegment.start_time)
    )
    speech_segments = [
        SpeechSegmentSummary.model_validate(seg) for seg in speech_result.scalars().all()
    ]

    # Stage 7 Phase D — audio-structure evidence (observed silence only), reusing
    # AnalysisAnnotation (category="audio_silence") — see audio_structure_svc.py's own docstring
    # for the full design. None until that pass has completed at least once; a completed pass
    # with zero rows means "audio present, no silence detected", NOT "not yet analyzed".
    audio_structure: AudioStructureSummary | None = None
    if pass_status.get("audio_structure") == "complete":
        silence_result = await db.execute(
            select(AnalysisAnnotation).where(
                AnalysisAnnotation.video_analysis_id == latest.id,
                AnalysisAnnotation.category == "audio_silence",
            ).order_by(AnalysisAnnotation.start_time)
        )
        silence_rows = silence_result.scalars().all()
        audio_structure = AudioStructureSummary(
            audio_stream_present=bool(pass_status.get("audio_structure_audio_present", True)),
            silence_count=len(silence_rows),
            silence_intervals=[AudioSilenceIntervalSummary.model_validate(r) for r in silence_rows],
        )

    # Stage 9 Phase B1 — boundary-triggered transition evidence, video-level (never nested under a
    # Shot; a transition genuinely spans TWO Shots — see TransitionEvidenceSummary's own
    # docstring), reusing AnalysisAnnotation (category="transition_evidence"). Chronological order
    # by window_start, same convention as every other evidence list in this response.
    transition_result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "transition_evidence",
        ).order_by(AnalysisAnnotation.start_time)
    )
    transition_evidence = []
    for ann in transition_result.scalars().all():
        details = ann.details or {}
        transition_evidence.append(TransitionEvidenceSummary(
            id=ann.id,
            boundary_timestamp=details.get("boundary_timestamp"),
            window_start=details.get("window_start"),
            window_end=details.get("window_end"),
            preceding_shot_id=details.get("preceding_shot_id"),
            following_shot_id=details.get("following_shot_id"),
            sampling_fps=details.get("sampling_fps"),
            sample_count=details.get("sample_count"),
            frame_pair_count=details.get("frame_pair_count"),
            sample_timestamps=details.get("sample_timestamps", []),
            luminance=TransitionLuminanceSummary(**details.get("luminance", {})),
            frame_difference=TransitionFrameDifferenceSummary(**details.get("frame_difference", {})),
            black_frame_flags=details.get("black_frame_flags", []),
            affine=TransitionAffineEvidenceSummary(
                pairs=[TransitionAffinePairSummary(**p) for p in details.get("affine", {}).get("pairs", [])],
                successful_pair_count=details.get("affine", {}).get("successful_pair_count", 0),
                failed_pair_count=details.get("affine", {}).get("failed_pair_count", 0),
                failure_reason_counts=details.get("affine", {}).get("failure_reason_counts"),
            ),
            phase_correlation=TransitionPhaseCorrelationEvidenceSummary(
                pairs=[TransitionPhaseCorrelationPairSummary(**p) for p in details.get("phase_correlation", {}).get("pairs", [])],
            ),
            certainty=ann.certainty,
            confidence_score=ann.confidence_score,
            reasoning=ann.reasoning,
            evidence_summary=ann.evidence_summary,
            source=ann.source,
            produced_by_pass=ann.produced_by_pass,
        ))

    return ReferenceVideoResponse(
        id=rv.id,
        asset_id=rv.asset_id,
        original_filename=asset.original_filename,
        asset_file_path=asset.file_path,
        source=rv.source,
        original_url=rv.original_url,
        rights_status=rv.rights_status,
        created_at=rv.created_at,
        latest_analysis=analysis_summary,
        technical_details=rv.technical_details,
        shots=shots,
        recurring_elements=recurring_elements,
        speech_segments=speech_segments,
        audio_structure=audio_structure,
        transition_evidence=transition_evidence,
    )


@router.get("/", response_model=list[ReferenceVideoResponse])
async def list_reference_videos(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Restoration path for Create/Edit -> Import External: without this, a ReferenceVideo that
    was correctly persisted by Stage 2 had no way to be read back after a page reload/remount —
    the frontend held it only in local component state (see the defect report this fixes). Same
    list-scoped-to-user, newest-first pattern already used by list_assets/list_drafts/
    list_brands elsewhere in this codebase — the one missing piece of this resource's own
    create/get-by-id/list surface, not a new one."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.user_id == user.id).order_by(ReferenceVideo.created_at.desc())
    )
    responses = []
    for rv in result.scalars().all():
        asset = await db.get(Asset, rv.asset_id)
        if asset:  # should always be true (RESTRICT FK) — skip defensively rather than 500 a list call
            responses.append(await _to_response(db, rv, asset))
    return responses


@router.post("/", response_model=ReferenceVideoResponse, status_code=status.HTTP_201_CREATED)
async def ingest_reference_video(
    body: ReferenceVideoIngestRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(select(Asset).where(Asset.id == body.asset_id, Asset.user_id == user.id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    if asset.file_type != "video":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Asset {asset.id} is a {asset.file_type}, not a video — only a video asset can become a reference video",
        )

    # Idempotent re-ingestion of the same asset — see this module's own docstring.
    existing = await db.execute(select(ReferenceVideo).where(ReferenceVideo.asset_id == asset.id))
    rv = existing.scalar_one_or_none()
    if rv is not None:
        return await _to_response(db, rv, asset)

    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload")
    db.add(rv)
    await db.flush()  # assigns rv.id for the FK below, inside the same still-open transaction

    db.add(VideoAnalysis(reference_video_id=rv.id))  # status defaults to "pending"
    await db.commit()
    await db.refresh(rv)

    return await _to_response(db, rv, asset)


@router.get("/{reference_video_id}", response_model=ReferenceVideoResponse)
async def get_reference_video(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        # Should be unreachable: asset_id is a RESTRICT FK, so the Asset cannot be deleted while
        # this ReferenceVideo exists. Surfaced honestly rather than silently swallowed.
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")
    return await _to_response(db, rv, asset)


@router.post("/{reference_video_id}/analyze", response_model=ReferenceVideoResponse)
async def analyze_reference_video(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        # Unreachable via the normal Stage-2 ingest flow (it always creates one) — surfaced
        # honestly rather than silently fabricating a row here.
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    if latest.status == "complete":
        # Idempotent — analysis already succeeded. Return it as-is; do not re-run, do not create
        # a duplicate row. See this module's own docstring.
        return await _to_response(db, rv, asset)

    if latest.status == "running":
        now = datetime.now(timezone.utc)
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        # Stale — a prior run never reached a terminal state (e.g. a crashed process). Mark it
        # failed (an honest historical record) and fall through to start a fresh run, exactly
        # like a genuine retry after failure.
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
                status="failed", completed_at=now,
                pass_status={"technical_probe": "failed", "error": "Stale run — exceeded timeout, treated as failed"},
            )
        )
        await db.commit()
        latest.status = "failed"  # keep the in-memory object consistent with what was just committed

    if latest.status == "failed":
        # Retry — a new VideoAnalysis version, per Stage 1's own "every re-run is a new row"
        # convention. The failed row above remains, untouched, as a permanent historical record.
        target = VideoAnalysis(reference_video_id=rv.id, analysis_tier=latest.analysis_tier)
        db.add(target)
        await db.flush()
        target_id = target.id
    else:
        # status == "pending" — the normal first-run case: advance this SAME row through its
        # lifecycle rather than creating a new one (a pending row is a real, meaningful,
        # waiting-to-run state, not a throwaway placeholder).
        target_id = latest.id

    # Atomic claim: only proceeds if this row is still genuinely pending at the moment of the
    # UPDATE — closes the race between two near-simultaneous "Analyse" clicks on the same row.
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == target_id, VideoAnalysis.status == "pending")
        .values(status="running", started_at=datetime.now(timezone.utc), pass_status={"technical_probe": "running"})
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    try:
        details = await ffmpeg_svc.probe_technical_metadata(asset.file_path, file_size_bytes=asset.file_size)
    except ffmpeg_svc.TechnicalProbeError as exc:
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == target_id).values(
                status="failed", completed_at=datetime.now(timezone.utc),
                pass_status={"technical_probe": "failed", "error": str(exc)[:500]},
            )
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)
    except Exception as exc:  # noqa: BLE001 — any unexpected failure must still fail cleanly,
        # never crash the request or leave the row stuck at "running" forever.
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == target_id).values(
                status="failed", completed_at=datetime.now(timezone.utc),
                pass_status={"technical_probe": "failed", "error": f"Unexpected error: {exc}"[:500]},
            )
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    facts = ffmpeg_svc.summarize_technical_facts(details)
    # Both writes in one transaction: ReferenceVideo's technical facts and VideoAnalysis's
    # completion never disagree about whether this run succeeded.
    await db.execute(
        update(ReferenceVideo).where(ReferenceVideo.id == rv.id).values(
            duration=facts["duration"], width=facts["width"], height=facts["height"],
            fps=facts["fps"], codec=facts["codec"], has_audio=facts["has_audio"],
            technical_details=details,
        )
    )
    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == target_id).values(
            status="complete", completed_at=datetime.now(timezone.utc),
            pass_status={"technical_probe": "complete"},
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)


@router.post("/{reference_video_id}/analyze-structure", response_model=ReferenceVideoResponse)
async def analyze_reference_video_structure(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Stage 4 — deterministic shot/cut boundary detection ONLY. See this module's own docstring
    for the full concurrency/retry/pass-status design."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    pass_status = dict(latest.pass_status or {})
    if pass_status.get("technical_probe") != "complete" or rv.duration is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Technical analysis must complete before structural analysis can run",
        )

    if pass_status.get("scene_segmentation") == "complete":
        # Idempotent — already done. Return as-is; do not re-run, do not create duplicate Shots.
        return await _to_response(db, rv, asset)

    now = datetime.now(timezone.utc)
    if latest.status == "running":
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        # Stale — a prior structural-analysis attempt never reached a terminal state. Record it
        # as failed (honest history) and fall through to retry — technical_probe's own already-
        # complete state is untouched throughout.
        pass_status = {**pass_status, "scene_segmentation": "failed", "scene_segmentation_error": "Stale run — exceeded timeout, treated as failed"}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=pass_status)
        )
        await db.commit()

    # Atomic claim: only proceeds while the row's overall status is genuinely "complete" (i.e.
    # nothing else currently in flight) — the same mechanism Stage 3 already proved under real
    # concurrent requests, reused here for this second pass on the same row.
    running_pass_status = {**pass_status, "scene_segmentation": "running"}
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == latest.id, VideoAnalysis.status == "complete")
        .values(status="running", pass_status=running_pass_status)
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    try:
        boundaries = await ffmpeg_svc.detect_shot_boundary_candidates(asset.file_path)
        segments = ffmpeg_svc.build_shot_segments(boundaries, rv.duration)
        if not segments:
            raise ffmpeg_svc.TechnicalProbeError("No structural segments could be derived from this reference video's duration")
    except ffmpeg_svc.TechnicalProbeError as exc:
        failed_pass_status = {**pass_status, "scene_segmentation": "failed", "scene_segmentation_error": str(exc)[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)
    except Exception as exc:  # noqa: BLE001 — any unexpected failure must still fail cleanly,
        # never crash the request or leave the row stuck at "running" forever.
        failed_pass_status = {**pass_status, "scene_segmentation": "failed", "scene_segmentation_error": f"Unexpected error: {exc}"[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    # Defensive idempotency: clear any pre-existing Shots for this VideoAnalysis before writing
    # the fresh set — guarantees a retry can never leave duplicate/stale Shot rows behind, on top
    # of (not instead of) the single-transaction write below already preventing partial writes.
    await db.execute(delete(Shot).where(Shot.video_analysis_id == latest.id))

    for seg in segments:
        if seg["boundary_score"] is None:
            evidence = "Start of the reference video — no preceding detected cut."
        else:
            evidence = (
                f"Detected via ffmpeg scene-difference filter "
                f"(threshold={ffmpeg_svc.SHOT_DETECTION_THRESHOLD:.2f}, boundary score={seg['boundary_score']:.4f})."
            )
        db.add(Shot(
            video_analysis_id=latest.id,
            scene_id=None,  # no semantic Scene grouping — see this module's own docstring
            order=seg["order"],
            start_time=seg["start_time"],
            end_time=seg["end_time"],
            certainty="MEASURED",
            source="ffmpeg_scene_filter",
            evidence_summary=evidence,
            produced_by_pass=ffmpeg_svc.SHOT_DETECTION_PASS_NAME,
        ))

    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
            status="complete",
            pass_status={**pass_status, "scene_segmentation": "complete"},
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)


@router.post("/{reference_video_id}/analyze-frames", response_model=ReferenceVideoResponse)
async def analyze_reference_video_frames(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Stage 5 — deterministic representative-frame extraction ONLY. See this module's own
    docstring for the full concurrency/retry/pass-status design (mirrors Stage 4's exactly, one
    pass further along the same VideoAnalysis row)."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    pass_status = dict(latest.pass_status or {})
    if pass_status.get("scene_segmentation") != "complete":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Structural analysis must complete before visual-evidence extraction can run",
        )

    if pass_status.get("visual_evidence") == "complete":
        # Idempotent — already done. Return as-is; do not re-run, do not create duplicate frames.
        return await _to_response(db, rv, asset)

    now = datetime.now(timezone.utc)
    if latest.status == "running":
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        # Stale — a prior visual-evidence attempt never reached a terminal state. Record it as
        # failed (honest history) and fall through to retry — technical_probe's and
        # scene_segmentation's own already-complete states are untouched throughout.
        pass_status = {**pass_status, "visual_evidence": "failed", "visual_evidence_error": "Stale run — exceeded timeout, treated as failed"}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=pass_status)
        )
        await db.commit()

    # Atomic claim: same mechanism Stage 3/4 already proved under real concurrent requests,
    # reused here for this third pass on the same row.
    running_pass_status = {**pass_status, "visual_evidence": "running"}
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == latest.id, VideoAnalysis.status == "complete")
        .values(status="running", pass_status=running_pass_status)
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    shots_result = await db.execute(select(Shot).where(Shot.video_analysis_id == latest.id).order_by(Shot.order))
    shot_rows = shots_result.scalars().all()

    # Extraction happens entirely before any DB write (ffmpeg + Pillow/numpy only — see this
    # module's own docstring). extracted_by_shot: {shot_id: [frame dicts]}; all_extracted_paths
    # tracks every file written this attempt so a mid-run failure can clean every one of them up
    # rather than leaving orphaned files with no DB row to ever reference them.
    extracted_by_shot: dict[int, list[dict]] = {}
    all_extracted_paths: list[str] = []
    try:
        for shot in shot_rows:
            frames = await ffmpeg_svc.extract_representative_frames_for_shot(
                asset.file_path, shot.start_time, shot.end_time, user.id, total_duration=rv.duration,
            )
            extracted_by_shot[shot.id] = frames
            all_extracted_paths.extend(f["file_path"] for f in frames)
    except Exception as exc:  # noqa: BLE001 — any unexpected failure must still fail cleanly,
        # never crash the request or leave the row stuck at "running" forever.
        for p in all_extracted_paths:
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass
        failed_pass_status = {**pass_status, "visual_evidence": "failed", "visual_evidence_error": f"Unexpected error: {exc}"[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    # Defensive idempotency (same reasoning as Stage 4's own Shot cleanup): clear any pre-existing
    # ShotFrame rows THIS PASS produced, plus their Asset rows and files, before writing the fresh
    # set — on top of (not instead of) the single-transaction write below already preventing
    # partial writes. Only ever finds rows here after a stale-run retry (a genuinely completed
    # attempt is caught by the idempotent early-return above).
    stale_frames_result = await db.execute(
        select(ShotFrame).where(
            ShotFrame.video_analysis_id == latest.id,
            ShotFrame.produced_by_pass == ffmpeg_svc.FRAME_EXTRACTION_PASS_NAME,
        )
    )
    stale_frames = stale_frames_result.scalars().all()
    if stale_frames:
        stale_asset_ids = [f.asset_id for f in stale_frames]
        await db.execute(delete(ShotFrame).where(ShotFrame.id.in_([f.id for f in stale_frames])))
        stale_assets_result = await db.execute(select(Asset).where(Asset.id.in_(stale_asset_ids)))
        for stale_asset in stale_assets_result.scalars().all():
            try:
                Path(stale_asset.file_path).unlink(missing_ok=True)
            except OSError:
                pass
            await db.delete(stale_asset)

    for shot in shot_rows:
        midpoint_asset_id: int | None = None
        for frame in extracted_by_shot.get(shot.id, []):
            file_path = Path(frame["file_path"])
            frame_asset = Asset(
                job_id=None,
                user_id=user.id,
                original_filename=f"reference_frame_shot{shot.order + 1}_{frame['extraction_method']}.jpg",
                stored_filename=file_path.name,
                file_path=str(file_path),
                file_type="reference_frame",
                mime_type="image/jpeg",
                file_size=file_path.stat().st_size,
            )
            db.add(frame_asset)
            await db.flush()  # assigns frame_asset.id for the ShotFrame FK below

            m = frame["measurements"]
            db.add(ShotFrame(
                shot_id=shot.id,
                video_analysis_id=latest.id,
                asset_id=frame_asset.id,
                timestamp=frame["timestamp"],
                order=frame["order"],
                extraction_method=frame["extraction_method"],
                width=m["width"],
                height=m["height"],
                measurements=m,
                certainty="MEASURED",
                source="ffmpeg_frame_extraction",
                evidence_summary=(
                    f"Representative frame extracted via ffmpeg at {frame['timestamp']:.3f}s "
                    f"({frame['extraction_method']}); luminance_mean={m['luminance_mean']}, "
                    f"sharpness_score={m['sharpness_score']}."
                ),
                produced_by_pass=ffmpeg_svc.FRAME_EXTRACTION_PASS_NAME,
            ))
            if frame["extraction_method"] == "shot_midpoint" or midpoint_asset_id is None:
                midpoint_asset_id = frame_asset.id

        if midpoint_asset_id is not None:
            await db.execute(update(Shot).where(Shot.id == shot.id).values(keyframe_asset_id=midpoint_asset_id))

    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
            status="complete",
            pass_status={**pass_status, "visual_evidence": "complete"},
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)


TEXT_ANALYSIS_PASS_NAME = "ocr_text_detection_v1"


@router.post("/{reference_video_id}/analyze-text", response_model=ReferenceVideoResponse)
async def analyze_reference_video_text(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Stage 6 — deterministic OCR text/geometry/timing extraction ONLY. See this module's own
    docstring for the full concurrency/retry/pass-status design (mirrors Stage 4/5's exactly, a
    fourth pass further along the same VideoAnalysis row). Candidate frames = Stage 5's own
    already-extracted ShotFrame images (free, read-only reuse) PLUS new fixed-interval
    supplementary samples (see ffmpeg_svc.plan_supplementary_text_sample_timestamps for why a
    fixed interval, not a change detector, is used — an empirical finding made during this
    stage's own implementation). ocr_svc.select_frames_to_ocr then skips near-duplicate
    candidates via Stage 5's own proven dHash mechanism before any OCR runs."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    pass_status = dict(latest.pass_status or {})
    if pass_status.get("visual_evidence") != "complete":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Visual-evidence extraction must complete before text analysis can run",
        )

    if pass_status.get("text_analysis") == "complete":
        # Idempotent — already done. Return as-is; do not re-run, do not create duplicate rows.
        return await _to_response(db, rv, asset)

    now = datetime.now(timezone.utc)
    if latest.status == "running":
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        pass_status = {**pass_status, "text_analysis": "failed", "text_analysis_error": "Stale run — exceeded timeout, treated as failed"}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=pass_status)
        )
        await db.commit()

    running_pass_status = {**pass_status, "text_analysis": "running"}
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == latest.id, VideoAnalysis.status == "complete")
        .values(status="running", pass_status=running_pass_status)
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    shots_result = await db.execute(select(Shot).where(Shot.video_analysis_id == latest.id).order_by(Shot.order))
    shot_rows = shots_result.scalars().all()

    # Existing Stage-5 ShotFrame rows — free, read-only candidate input. Grouped by shot.
    frames_result = await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == latest.id))
    frame_rows = frames_result.scalars().all()
    frame_asset_ids = {f.asset_id for f in frame_rows}
    frame_assets_by_id: dict[int, Asset] = {}
    if frame_asset_ids:
        frame_assets_result = await db.execute(select(Asset).where(Asset.id.in_(frame_asset_ids)))
        frame_assets_by_id = {a.id: a for a in frame_assets_result.scalars().all()}
    frames_by_shot: dict[int, list[ShotFrame]] = {}
    for f in frame_rows:
        frames_by_shot.setdefault(f.shot_id, []).append(f)

    # Same end-of-file safety clamp Stage 5 needed (empirically verified: ffmpeg's own single-
    # frame extraction can fail within ~0.2s of a file's real end) — a supplementary sample near
    # a shot's own end can land there just as easily as a Stage-5 representative frame could.
    safe_limit = max(0.0, rv.duration - ffmpeg_svc.END_OF_FILE_SAFETY_SECONDS) if rv.duration else None

    # Extraction + OCR happens entirely before any DB write — same discipline as Stage 5.
    new_supplementary_paths: list[str] = []  # every NEW file this attempt wrote, for cleanup
    groups_by_shot: dict[int, list[list[dict]]] = {}
    try:
        for shot in shot_rows:
            candidates: list[dict] = []
            for f in frames_by_shot.get(shot.id, []):
                fa = frame_assets_by_id.get(f.asset_id)
                if fa is None:
                    continue  # unreachable via RESTRICT FK — skip defensively
                candidates.append({
                    "timestamp": f.timestamp, "file_path": fa.file_path,
                    "width": f.width, "height": f.height,
                    "existing_asset_id": f.asset_id, "is_new": False,
                })

            for ts in ffmpeg_svc.plan_supplementary_text_sample_timestamps(shot.start_time, shot.end_time):
                safe_ts = min(ts, safe_limit) if safe_limit is not None else ts
                out_path = await ffmpeg_svc.extract_thumbnail(asset.file_path, user.id, timestamp=safe_ts)
                new_supplementary_paths.append(str(out_path))
                measurements = ffmpeg_svc.compute_frame_measurements(str(out_path))
                candidates.append({
                    "timestamp": safe_ts, "file_path": str(out_path),
                    "width": measurements["width"], "height": measurements["height"],
                    "existing_asset_id": None, "is_new": True,
                })

            candidates.sort(key=lambda c: c["timestamp"])
            selected = ocr_svc.select_frames_to_ocr(candidates)

            detections: list[dict] = []
            for c in selected:
                w, h = c["width"], c["height"]
                if w <= 0 or h <= 0:
                    continue
                for r in await ocr_svc.detect_text_in_frame(c["file_path"]):
                    x0, y0, x1, y1 = r["bbox_px"]
                    bbox_norm = (
                        max(0.0, min(1.0, x0 / w)), max(0.0, min(1.0, y0 / h)),
                        max(0.0, min(1.0, x1 / w)), max(0.0, min(1.0, y1 / h)),
                    )
                    detections.append({
                        "text": r["text"], "confidence": r["confidence"],
                        "bbox_norm": bbox_norm, "timestamp": c["timestamp"],
                        "language_group": r["language_group"],
                        "style": ffmpeg_svc.compute_text_region_style(c["file_path"], r["bbox_px"]),
                        "file_path": c["file_path"], "existing_asset_id": c["existing_asset_id"],
                        "is_new": c["is_new"],
                    })

            detections.sort(key=lambda d: d["timestamp"])
            groups_by_shot[shot.id] = ocr_svc.group_occurrences(detections)
    except Exception as exc:  # noqa: BLE001 — any unexpected failure must still fail cleanly,
        # never crash the request or leave the row stuck at "running" forever.
        for p in new_supplementary_paths:
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass
        failed_pass_status = {**pass_status, "text_analysis": "failed", "text_analysis_error": f"Unexpected error: {exc}"[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    # Every shot's extraction+OCR succeeded. Discard any NEW supplementary frame file that ended
    # up unused (found no text at all, or was skipped as a near-duplicate by select_frames_to_ocr
    # before OCR ever ran on it) — never persisted as an Asset, keeping storage lean, same "don't
    # keep what nothing needs" philosophy as Stage 5's own dedup-skip. Every raw detection (every
    # member of every group, not just canonical heads — each raw observation needs its OWN
    # source-frame Asset for full audit) is kept, per the evidence-preservation requirement.
    referenced_new_paths = {
        d["file_path"] for groups in groups_by_shot.values() for group in groups for d in group if d["is_new"]
    }
    for p in new_supplementary_paths:
        if p not in referenced_new_paths:
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass

    # Defensive idempotency (same reasoning as Stage 4/5's own cleanup): clear any pre-existing
    # TextElement rows THIS PASS produced, plus any Asset rows created solely for them, before
    # writing the fresh set — on top of (not instead of) the single-transaction write below.
    # Only ever finds rows here after a stale-run retry (a genuinely completed attempt is caught
    # by the idempotent early-return above); a reused Stage-5 ShotFrame asset is NEVER deleted.
    stale_text_result = await db.execute(
        select(TextElement).where(
            TextElement.video_analysis_id == latest.id,
            TextElement.produced_by_pass == TEXT_ANALYSIS_PASS_NAME,
        )
    )
    stale_text_rows = stale_text_result.scalars().all()
    if stale_text_rows:
        stale_asset_ids = {t.source_frame_asset_id for t in stale_text_rows if t.source_frame_asset_id is not None}
        await db.execute(delete(TextElement).where(TextElement.id.in_([t.id for t in stale_text_rows])))
        if stale_asset_ids:
            protected_ids = frame_asset_ids  # Stage-5 ShotFrame assets are never this pass's to delete
            stale_assets_result = await db.execute(select(Asset).where(Asset.id.in_(stale_asset_ids)))
            for stale_asset in stale_assets_result.scalars().all():
                if stale_asset.id in protected_ids:
                    continue
                try:
                    Path(stale_asset.file_path).unlink(missing_ok=True)
                except OSError:
                    pass
                await db.delete(stale_asset)
    # Same defensive idempotency for a prior stale attempt's Recurring Element cross-references —
    # these reference TextElement ids directly (by design, see ocr_svc.link_recurring_elements'
    # own docstring), so any surviving from a stale run would point at now-deleted rows.
    await db.execute(
        delete(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.produced_by_pass == ocr_svc.RECURRING_ELEMENT_PASS_NAME,
        )
    )

    new_asset_id_by_path: dict[str, int] = {}

    async def _resolve_source_asset_id(shot: Shot, detection: dict) -> int:
        if not detection["is_new"]:
            return detection["existing_asset_id"]
        if detection["file_path"] not in new_asset_id_by_path:
            file_path = Path(detection["file_path"])
            new_asset = Asset(
                job_id=None, user_id=user.id,
                original_filename=f"text_evidence_shot{shot.order + 1}_{file_path.stem}.jpg",
                stored_filename=file_path.name, file_path=str(file_path),
                file_type="reference_frame", mime_type="image/jpeg",
                file_size=file_path.stat().st_size,
            )
            db.add(new_asset)
            await db.flush()  # assigns new_asset.id for the TextElement FK below
            new_asset_id_by_path[detection["file_path"]] = new_asset.id
        return new_asset_id_by_path[detection["file_path"]]

    def _evidence_summary(detection: dict, member_count: int) -> str:
        base = f"EasyOCR ({'+'.join(detection['language_group'])}) confidence={detection['confidence']:.3f}."
        if member_count > 1:
            base += f" Canonical (highest-confidence) reading of an Occurrence Group with {member_count} raw observation(s)."
        return base

    # Every raw detection becomes its own permanent TextElement row — see ocr_svc.py's own
    # module docstring for why nothing here is ever merged/edited/dropped. Each group's
    # highest-confidence member (already sorted first by group_occurrences) is written FIRST,
    # with occurrence_group_id left NULL — that is what makes it the group's own canonical head;
    # every other member is written next, pointing at the head's now-real id.
    all_group_heads: list[dict] = []  # {"id", "text", "bbox_norm", "timestamp"} — for
    # cross-shot Recurring Element linkage once every shot's groups have real, flushed ids.
    for shot in shot_rows:
        for group in groups_by_shot.get(shot.id, []):
            head_detection = group[0]
            head_source_asset_id = await _resolve_source_asset_id(shot, head_detection)
            x0, y0, x1, y1 = head_detection["bbox_norm"]
            head_row = TextElement(
                video_analysis_id=latest.id,
                shot_id=shot.id,
                text=head_detection["text"],
                x=x0, y=y0, width=x1 - x0, height=y1 - y0,
                start_time=head_detection["timestamp"], end_time=head_detection["timestamp"],
                certainty="MEASURED",
                confidence_score=head_detection["confidence"],
                source="easyocr",
                source_frame_asset_id=head_source_asset_id,
                style_details=head_detection["style"],
                evidence_summary=_evidence_summary(head_detection, len(group)),
                produced_by_pass=TEXT_ANALYSIS_PASS_NAME,
                occurrence_group_id=None,
            )
            db.add(head_row)
            await db.flush()  # assigns head_row.id — needed both for member FKs below and for
            # this group's own entry in all_group_heads (used by Recurring Element linkage)

            for member_detection in group[1:]:
                mx0, my0, mx1, my1 = member_detection["bbox_norm"]
                member_source_asset_id = await _resolve_source_asset_id(shot, member_detection)
                db.add(TextElement(
                    video_analysis_id=latest.id,
                    shot_id=shot.id,
                    text=member_detection["text"],
                    x=mx0, y=my0, width=mx1 - mx0, height=my1 - my0,
                    start_time=member_detection["timestamp"], end_time=member_detection["timestamp"],
                    certainty="MEASURED",
                    confidence_score=member_detection["confidence"],
                    source="easyocr",
                    source_frame_asset_id=member_source_asset_id,
                    style_details=member_detection["style"],
                    evidence_summary=_evidence_summary(member_detection, 1),
                    produced_by_pass=TEXT_ANALYSIS_PASS_NAME,
                    occurrence_group_id=head_row.id,
                ))

            # Recurring Element linkage itself still compares heads pairwise (bbox_norm/timestamp
            # are the head's own canonical reading — the right basis for "does this look like the
            # same element"), but each group's own start/end span (used only for the resulting
            # AnalysisAnnotation's own start_time/end_time below) reflects EVERY member, matching
            # exactly what TextElementSummary's own derived span already shows the frontend — the
            # two must never disagree about how wide a group's own evidence actually reaches.
            all_group_heads.append({
                "id": head_row.id, "text": head_row.text,
                "bbox_norm": head_detection["bbox_norm"], "timestamp": head_detection["timestamp"],
                "span_start": min(d["timestamp"] for d in group), "span_end": max(d["timestamp"] for d in group),
            })

    # Recurring Element linkage — explicitly INFERRED, a separate AnalysisAnnotation row per
    # cluster of 2+ probably-related Occurrence Groups (see ocr_svc.link_recurring_elements' own
    # docstring). Scoped to the whole VideoAnalysis (not per-shot) — a recurring element like a
    # persistent watermark could plausibly reappear across Shot boundaries too.
    for cluster in ocr_svc.link_recurring_elements(all_group_heads):
        member_heads = [h for h in all_group_heads if h["id"] in cluster["member_ids"]]
        db.add(AnalysisAnnotation(
            video_analysis_id=latest.id,
            shot_id=None,  # may span multiple Shots — same nullable convention this table
            # already uses for other cross-cutting categories
            category="recurring_text_element",
            start_time=min(h["span_start"] for h in member_heads),
            end_time=max(h["span_end"] for h in member_heads),
            details={
                "member_occurrence_group_head_ids": cluster["member_ids"],
                "pairwise_evidence": cluster["pairwise_evidence"],
            },
            certainty="INFERRED",
            confidence_score=cluster["confidence"],
            reasoning=(
                "Consistent recognized text across occurrence groups with no direct observation "
                "in the gap between them — visibility during that gap is not claimed."
            ),
            evidence_summary=(
                f"Linked {len(cluster['member_ids'])} occurrence groups via text similarity and "
                f"bbox position/size consistency (see details.pairwise_evidence)."
            ),
            source="deterministic_signal_linkage",
            produced_by_pass=ocr_svc.RECURRING_ELEMENT_PASS_NAME,
        ))

    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
            status="complete",
            pass_status={**pass_status, "text_analysis": "complete"},
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)


SPEECH_ANALYSIS_PASS_NAME = "speech_analysis_v1"


@router.post("/{reference_video_id}/analyze-speech", response_model=ReferenceVideoResponse)
async def analyze_reference_video_speech(
    reference_video_id: int,
    language: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Stage 7 (Audio / Speech / Transcript), Phase C — deterministic local-Whisper speech
    recognition ONLY. See this module's own docstring for the shared concurrency/retry/
    pass-status design this reuses unmodified (same shape as Stage 4/5/6's own further passes on
    the same VideoAnalysis row).

    Deliberately gated on `technical_probe` (Stage 3) alone, NOT on scene_segmentation/
    visual_evidence/text_analysis (Stage 4-6) — speech recognition needs only the underlying
    media file Stage 3 already validated (and its probed duration), never Shots, ShotFrames, or
    OCR results. `shot_id` is never set on a written SpeechSegment row for the same reason:
    speech is continuous and does not align to visual cut boundaries (see speech_segment.py's own
    docstring) — forcing an association here would be an invented, unearned claim.

    `language` (optional) is passed straight through to speech_analysis_svc.analyze_speech() as a
    decoding hint; omitted, Whisper performs its own detection. No per-segment language switching
    and no post-processing/translation/correction of the transcript text happens here — see
    speech_analysis_svc.py's own docstring for the full reasoning.

    Uses app.services.speech_analysis_svc (Stage 7 Phase B) — an independent, DB-agnostic local
    Whisper service — never app.services.whisper_svc (the separate, untouched, existing editor
    "Generate Captions from Audio" feature)."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    pass_status = dict(latest.pass_status or {})
    if pass_status.get("technical_probe") != "complete":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Technical analysis must complete before speech analysis can run",
        )

    if pass_status.get("speech_analysis") == "complete":
        # Idempotent — already done. Return as-is; do not re-run, do not create duplicate rows.
        return await _to_response(db, rv, asset)

    now = datetime.now(timezone.utc)
    if latest.status == "running":
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        pass_status = {**pass_status, "speech_analysis": "failed", "speech_analysis_error": "Stale run — exceeded timeout, treated as failed"}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=pass_status)
        )
        await db.commit()

    running_pass_status = {**pass_status, "speech_analysis": "running"}
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == latest.id, VideoAnalysis.status == "complete")
        .values(status="running", pass_status=running_pass_status)
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    # No DB write of any kind happens before this succeeds in full — a decode failure or a
    # genuine Whisper failure therefore can never leave a partial/orphan SpeechSegment row behind
    # (there is nothing partial to leave; the whole result either exists or it doesn't).
    try:
        speech_result = await speech_analysis_svc.analyze_speech(asset.file_path, language=language)
    except Exception as exc:  # noqa: BLE001 — any unexpected failure (media decode or Whisper
        # itself) must still fail cleanly, never crash the request or leave the row stuck at
        # "running" forever, and never fabricate a fallback transcript in its place.
        failed_pass_status = {**pass_status, "speech_analysis": "failed", "speech_analysis_error": f"Unexpected error: {exc}"[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    # Defensive idempotency (same reasoning as Stage 4/5/6's own cleanup): clear any pre-existing
    # SpeechSegment rows THIS PASS produced before writing the fresh set — on top of (not instead
    # of) the single-transaction write below. Only ever finds rows here after a stale-run retry (a
    # genuinely completed attempt is caught by the idempotent early-return above).
    await db.execute(
        delete(SpeechSegment).where(
            SpeechSegment.video_analysis_id == latest.id,
            SpeechSegment.produced_by_pass == SPEECH_ANALYSIS_PASS_NAME,
        )
    )

    # An empty segment list is a normal, valid, successful "no speech detected" outcome — zero
    # rows written, pass_status still becomes "complete", never "failed". See
    # speech_analysis_svc.py's own docstring: an empty result only ever means the media decoded
    # successfully and Whisper itself found no usable speech in it.
    detected_language = speech_result.get("detected_language")
    model_used = speech_result.get("model_used", "base")
    for seg in speech_result.get("segments", []):
        db.add(SpeechSegment(
            video_analysis_id=latest.id,
            shot_id=None,  # speech is continuous and not forced onto a visual cut boundary — see
            # this endpoint's own docstring.
            start_time=seg["start_time"], end_time=seg["end_time"],
            text=seg["text"],
            language=detected_language,
            speaker_label=None,  # no diarization pass exists yet — forward-compatible field only.
            certainty="MEASURED",  # direct engine extraction, same convention as TextElement's
            # own head rows.
            confidence_score=None,  # never fabricated from Whisper's own raw diagnostics — see
            # analysis_details below and speech_analysis_svc.py's own "confidence discipline".
            analysis_details=seg.get("analysis_details") or None,
            source="whisper",
            produced_by_pass=SPEECH_ANALYSIS_PASS_NAME,
            evidence_summary=f"Local Whisper ({model_used}) transcription segment.",
        ))

    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
            status="complete",
            pass_status={**pass_status, "speech_analysis": "complete"},
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)


AUDIO_STRUCTURE_PASS_NAME = "audio_structure_v1"


@router.post("/{reference_video_id}/analyze-audio-structure", response_model=ReferenceVideoResponse)
async def analyze_reference_video_audio_structure(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Stage 7 (Audio / Speech / Transcript), Phase D — deterministic FFmpeg `silencedetect`
    audio-structure evidence ONLY. See this module's own docstring for the shared concurrency/
    retry/pass-status design this reuses unmodified (same shape as Stage 4-7's own further passes
    on the same VideoAnalysis row).

    Gated on `technical_probe` (Stage 3) alone, same minimum prerequisite as
    analyze_reference_video_speech — and deliberately NOT gated on `speech_analysis`: the two
    Stage 7 passes are independent of each other (neither requires the other to have run), even
    though (like every other pass pair in this router) they cannot literally execute
    concurrently on the same VideoAnalysis row, since `status` is one shared top-level
    concurrency guard for whichever pass currently holds it.

    Reuses the existing AnalysisAnnotation table (category="audio_silence") rather than a new
    table — see app.services.audio_structure_svc.py's own docstring for the detection/parsing
    design, and app.models.analysis_annotation.py's own docstring for why this table already
    exists for exactly this kind of small, timeline-scoped, open-category evidence. `shot_id` is
    always left NULL — silence is a fact about the audio track, independent of and often crossing
    visual Shot boundaries.

    This pass observes WHERE silence is — it never infers pacing, rhythm, hook timing, or any
    other semantic meaning from it; that is explicitly out of scope here (a later stage's job)."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    pass_status = dict(latest.pass_status or {})
    if pass_status.get("technical_probe") != "complete":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Technical analysis must complete before audio-structure analysis can run",
        )

    if pass_status.get("audio_structure") == "complete":
        # Idempotent — already done. Return as-is; do not re-run, do not create duplicate rows.
        return await _to_response(db, rv, asset)

    now = datetime.now(timezone.utc)
    if latest.status == "running":
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        pass_status = {**pass_status, "audio_structure": "failed", "audio_structure_error": "Stale run — exceeded timeout, treated as failed"}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=pass_status)
        )
        await db.commit()

    running_pass_status = {**pass_status, "audio_structure": "running"}
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == latest.id, VideoAnalysis.status == "complete")
        .values(status="running", pass_status=running_pass_status)
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    # No DB write of any kind happens before this succeeds in full — a genuine ffmpeg failure
    # therefore can never leave a partial/orphan AnalysisAnnotation row behind.
    try:
        audio_result = await audio_structure_svc.analyze_audio_structure(asset.file_path)
    except Exception as exc:  # noqa: BLE001 — any unexpected failure must still fail cleanly,
        # never crash the request or leave the row stuck at "running" forever.
        failed_pass_status = {**pass_status, "audio_structure": "failed", "audio_structure_error": f"Unexpected error: {exc}"[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    # Defensive idempotency (same reasoning as Stage 4/5/6/7's own cleanup): clear any
    # pre-existing audio_silence rows THIS PASS produced before writing the fresh set. Only ever
    # finds rows here after a stale-run retry (a genuinely completed attempt is caught by the
    # idempotent early-return above).
    await db.execute(
        delete(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "audio_silence",
            AnalysisAnnotation.produced_by_pass == AUDIO_STRUCTURE_PASS_NAME,
        )
    )

    # No audio stream at all, or an audio stream with zero detected silence, are both normal,
    # valid, successful outcomes — zero rows written either way, pass_status still becomes
    # "complete", never "failed". "No audio track" (audio_stream_present=False) and "audio track
    # containing no silence" (audio_stream_present=True, zero rows) are kept as distinct facts —
    # see audio_structure_svc.py's own docstring.
    for interval in audio_result.get("silence_intervals", []):
        db.add(AnalysisAnnotation(
            video_analysis_id=latest.id,
            shot_id=None,  # silence is a fact about the audio track, independent of visual Shots
            # — see this endpoint's own docstring.
            category="audio_silence",
            start_time=interval["start_time"], end_time=interval["end_time"],
            details={
                "detector": audio_result["detector"],
                "noise_threshold_db": audio_result["noise_threshold_db"],
                "minimum_duration_seconds": audio_result["minimum_duration_seconds"],
                "duration": interval["duration"],
            },
            certainty="MEASURED",  # direct deterministic-detector extraction
            confidence_score=None,  # silencedetect is a fixed threshold/duration detector, not a
            # probabilistic model — there is no confidence concept to report at all.
            reasoning=None,
            evidence_summary="Deterministic FFmpeg silencedetect interval.",
            source="ffmpeg",
            produced_by_pass=AUDIO_STRUCTURE_PASS_NAME,
        ))

    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
            status="complete",
            pass_status={
                **pass_status, "audio_structure": "complete",
                "audio_structure_audio_present": audio_result["audio_stream_present"],
            },
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)


VISUAL_OBJECTS_PASS_NAME = "visual_objects_v1"


@router.post("/{reference_video_id}/analyze-visual-objects", response_model=ReferenceVideoResponse)
async def analyze_reference_video_visual_objects(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Stage 8 (Visual Objects / People / Products / Composition), Phase B — RAW DETECTOR
    EVIDENCE PERSISTENCE ONLY. See app/models/visual_object.py's own docstring and
    app/services/visual_object_svc.py's own docstring for the full RAW EVIDENCE vs. BUSINESS/
    CONTENT ROLE reasoning this endpoint exists to preserve, not resolve.

    Gated on `visual_evidence` (Stage 5) alone — deliberately NOT on `text_analysis`,
    `speech_analysis`, or `audio_structure`. This pass reads nothing but Stage 5's own already-
    extracted ShotFrame images, exactly the same "free, read-only reuse" input Stage 6's own text
    analysis pass already established, so it needs nothing else to have finished first.

    Frame source discipline: this pass runs the Phase-A detector (visual_object_svc.analyze_
    visual_objects) against ONLY Stage 5's own existing ShotFrame rows — no supplementary frame
    extraction of any kind (unlike Stage 6, which samples extra frames for text coverage). Every
    VisualObject row this pass writes is therefore traceable to one real, already-existing
    ShotFrame via source_frame_id.

    Category discipline (the reason this endpoint exists at all — see visual_object.py's own
    docstring): the detector's native COCO "person" label maps to category="person" (the same
    structural concept, not an interpretation); every other native COCO label maps to the neutral
    category="object". This pass never guesses "product", "prop", "logo", or "background" — that
    business/content-role judgment is explicitly out of scope here.

    Screen-within-screen limitation preserved: a "person" row here means only "the detector's own
    person class matched this pixel region with this score" — never "a physical, on-camera human
    was here." See visual_object_svc.py's own docstring for why a generic detector cannot and does
    not distinguish a directly-filmed person from one merely displayed inside another screen.

    Timing honesty: start_time and end_time are both set to the source frame's own single
    timestamp — a detection observed in one still frame has no measured duration, so none is
    fabricated. Transform columns (scale/rotation/anchor/opacity/z_index) are written at their
    schema defaults, not measured by this detector — evidence_summary says so explicitly on every
    row, mirroring visual_object.py's own docstring on this exact point."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    pass_status = dict(latest.pass_status or {})
    if pass_status.get("visual_evidence") != "complete":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Visual-evidence extraction must complete before visual-object detection can run",
        )

    if pass_status.get("visual_objects") == "complete":
        # Idempotent — already done. Return as-is; do not re-run, do not create duplicate rows.
        return await _to_response(db, rv, asset)

    now = datetime.now(timezone.utc)
    if latest.status == "running":
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        pass_status = {**pass_status, "visual_objects": "failed", "visual_objects_error": "Stale run — exceeded timeout, treated as failed"}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=pass_status)
        )
        await db.commit()

    running_pass_status = {**pass_status, "visual_objects": "running"}
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == latest.id, VideoAnalysis.status == "complete")
        .values(status="running", pass_status=running_pass_status)
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    shots_result = await db.execute(select(Shot).where(Shot.video_analysis_id == latest.id).order_by(Shot.order))
    shot_rows = shots_result.scalars().all()

    # Existing Stage-5 ShotFrame rows — the ONLY frame source this pass ever uses (no
    # supplementary extraction — see this endpoint's own docstring).
    frames_result = await db.execute(select(ShotFrame).where(ShotFrame.video_analysis_id == latest.id))
    frame_rows = frames_result.scalars().all()
    frame_asset_ids = {f.asset_id for f in frame_rows}
    frame_assets_by_id: dict[int, Asset] = {}
    if frame_asset_ids:
        frame_assets_result = await db.execute(select(Asset).where(Asset.id.in_(frame_asset_ids)))
        frame_assets_by_id = {a.id: a for a in frame_assets_result.scalars().all()}

    # Detection happens entirely before any DB write — same discipline as Stage 6/7 — so a
    # mid-run failure can never leave a partial/orphan VisualObject row behind.
    detections_by_frame: list[tuple[Shot, ShotFrame, dict]] = []
    try:
        for shot in shot_rows:
            for f in [fr for fr in frame_rows if fr.shot_id == shot.id]:
                fa = frame_assets_by_id.get(f.asset_id)
                if fa is None:
                    continue  # unreachable via RESTRICT FK — skip defensively
                result_dict = await visual_object_svc.analyze_visual_objects(fa.file_path)
                detections_by_frame.append((shot, f, result_dict))
    except Exception as exc:  # noqa: BLE001 — any unexpected failure must still fail cleanly,
        # never crash the request or leave the row stuck at "running" forever. Nothing has been
        # written to the DB yet at this point, so there is nothing to clean up here.
        failed_pass_status = {**pass_status, "visual_objects": "failed", "visual_objects_error": f"Unexpected error: {exc}"[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    # Defensive idempotency (same reasoning as Stage 4-7's own cleanup): clear any pre-existing
    # VisualObject rows THIS PASS produced before writing the fresh set. Only ever finds rows here
    # after a stale-run retry (a genuinely completed attempt is caught by the idempotent
    # early-return above).
    await db.execute(
        delete(VisualObject).where(
            VisualObject.video_analysis_id == latest.id,
            VisualObject.produced_by_pass == VISUAL_OBJECTS_PASS_NAME,
        )
    )

    # Zero detections across every frame is a normal, valid, successful outcome — zero rows
    # written, pass_status still becomes "complete", never "failed".
    for shot, frame, result_dict in detections_by_frame:
        model_name = result_dict["model"]
        for detection in result_dict["detections"]:
            category = "person" if detection["label"] == "person" else "object"
            bbox = detection["bbox_normalized"]
            db.add(VisualObject(
                video_analysis_id=latest.id,
                shot_id=shot.id,
                source_frame_id=frame.id,
                label=detection["label"],
                category=category,
                class_id=detection["class_id"],
                x=bbox["x"], y=bbox["y"], width=bbox["width"], height=bbox["height"],
                start_time=frame.timestamp, end_time=frame.timestamp,  # a single still frame has
                # no measured duration — see this endpoint's own docstring.
                certainty="MEASURED",
                confidence_score=detection["confidence_score"],
                reasoning=None,
                evidence_summary=(
                    f"{model_name} native COCO label '{detection['label']}' (class_id="
                    f"{detection['class_id']}), confidence={detection['confidence_score']:.3f}. "
                    "Label, confidence, and geometry are direct detector output for this exact "
                    "source frame; this is not a claim that a real physical object or person "
                    "exists, nor a claim about its business role (product/prop/logo/background). "
                    "Unlisted transform fields (scale/rotation/anchor/opacity/z_index) are "
                    "unmeasured schema defaults, not detector output."
                ),
                # `source` is the producer/engine FAMILY name — same convention as "easyocr"/
                # "whisper"/"ffmpeg" elsewhere in this router, never the exact model variant. The
                # exact model identifier (model_name) is preserved verbatim in evidence_summary
                # above instead, mirroring exactly where Whisper's own model variant lives
                # (SpeechSegment's evidence_summary embeds "Local Whisper (base) ...").
                source="torchvision",
                produced_by_pass=VISUAL_OBJECTS_PASS_NAME,
            ))

    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
            status="complete",
            pass_status={**pass_status, "visual_objects": "complete"},
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)


VISUAL_PERSISTENCE_PASS_NAME = "visual_persistence_v1"

# The one concise, repository-consistent producer/algorithm-family identifier this pass ever
# writes to AnalysisAnnotation.source — same convention as ocr_svc.RECURRING_ELEMENT_PASS_NAME's
# own "deterministic_signal_linkage" (28 chars, fits the existing String(32) column unmodified;
# this one is 22). Named here, not inlined, so a future Phase-C2 algorithm gets its own distinct
# value rather than silently overloading this one.
VISUAL_PERSISTENCE_SOURCE = "geometric_iou_linkage"


@router.post("/{reference_video_id}/analyze-visual-persistence", response_model=ReferenceVideoResponse)
async def analyze_reference_video_visual_persistence(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Stage 8 (Visual Objects / People / Products / Composition), Phase C1 — CONSERVATIVE
    SAME-SHOT NEAR-STATIC VISUAL PERSISTENCE. See app/services/visual_persistence_svc.py's own
    docstring for the full derivation reasoning this endpoint exists to apply, not extend.

    Gated on `visual_objects` (Stage 8 Phase B) alone — deliberately NOT on `text_analysis`,
    `speech_analysis`, or `audio_structure`. This pass reads nothing but Stage 8 Phase B's own
    already-persisted VisualObject rows; no object detection is ever re-run here.

    Reuses the existing AnalysisAnnotation table (category="persistent_visual_element") rather
    than a new table or a new VisualObject column — see visual_persistence_svc.py's own docstring
    and the Phase-C read-only inspection's own data-model verdict (A: existing architecture
    sufficient). Every derived row's `details` carries the full evidence
    (member_visual_object_ids, source_frame_ids, representative_bbox, detector_confidences,
    geometry_evidence, thresholds used) so a reader never needs to re-derive what this pass saw.

    Raw VisualObject rows are NEVER modified, deleted, or reinterpreted by this pass — this
    endpoint only ever adds AnalysisAnnotation rows alongside them. `certainty` is always
    "INFERRED" and `confidence_score` is always None (no calibrated linkage probability exists —
    see visual_persistence_svc.py's own docstring point 6); the real geometric evidence lives in
    `details.geometry_evidence` instead."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    pass_status = dict(latest.pass_status or {})
    if pass_status.get("visual_objects") != "complete":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Visual-object detection must complete before visual-persistence derivation can run",
        )

    if pass_status.get("visual_persistence") == "complete":
        # Idempotent — already done. Return as-is; do not re-run, do not create duplicate rows.
        return await _to_response(db, rv, asset)

    now = datetime.now(timezone.utc)
    if latest.status == "running":
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        pass_status = {**pass_status, "visual_persistence": "failed", "visual_persistence_error": "Stale run — exceeded timeout, treated as failed"}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=pass_status)
        )
        await db.commit()

    running_pass_status = {**pass_status, "visual_persistence": "running"}
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == latest.id, VideoAnalysis.status == "complete")
        .values(status="running", pass_status=running_pass_status)
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    # Existing Stage-8-Phase-B VisualObject rows — the ONLY input this pass ever uses. No object
    # detection is re-run; no ShotFrame/Asset is even read.
    visual_objects_result = await db.execute(
        select(VisualObject).where(VisualObject.video_analysis_id == latest.id).order_by(VisualObject.shot_id)
    )
    visual_object_rows = visual_objects_result.scalars().all()
    observations_by_shot: dict[int, list[dict]] = {}
    for vo in visual_object_rows:
        if vo.shot_id is None:
            continue  # unreachable today (Phase B always populates shot_id) — skip defensively
        observations_by_shot.setdefault(vo.shot_id, []).append({
            "visual_object_id": vo.id, "shot_id": vo.shot_id, "source_frame_id": vo.source_frame_id,
            "label": vo.label, "category": vo.category, "confidence_score": vo.confidence_score,
            "x": vo.x, "y": vo.y, "width": vo.width, "height": vo.height,
            "timestamp": vo.start_time,
        })

    # Derivation happens entirely before any DB write — same discipline as every prior Stage
    # 6-8 pass — so a mid-run failure can never leave a partial/orphan annotation behind. This
    # pass is pure in-memory computation (no I/O), but the same discipline is kept regardless.
    groups_by_shot: dict[int, list[dict]] = {}
    try:
        for shot_id, observations in observations_by_shot.items():
            groups_by_shot[shot_id] = visual_persistence_svc.derive_persistent_visual_elements(observations)
    except Exception as exc:  # noqa: BLE001 — any unexpected failure must still fail cleanly,
        # never crash the request or leave the row stuck at "running" forever. Nothing has been
        # written to the DB yet at this point, so there is nothing to clean up here.
        failed_pass_status = {**pass_status, "visual_persistence": "failed", "visual_persistence_error": f"Unexpected error: {exc}"[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    # Defensive idempotency (same reasoning as Stage 4-8's own cleanup): clear any pre-existing
    # persistent_visual_element rows THIS PASS produced before writing the fresh set. Only ever
    # finds rows here after a stale-run retry (a genuinely completed attempt is caught by the
    # idempotent early-return above).
    await db.execute(
        delete(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "persistent_visual_element",
            AnalysisAnnotation.produced_by_pass == VISUAL_PERSISTENCE_PASS_NAME,
        )
    )

    # Zero eligible groups across every shot is a normal, valid, successful outcome — zero rows
    # written, pass_status still becomes "complete", never "failed".
    for shot_id, groups in groups_by_shot.items():
        for group in groups:
            db.add(AnalysisAnnotation(
                video_analysis_id=latest.id,
                shot_id=shot_id,
                category="persistent_visual_element",
                start_time=group["start_time"], end_time=group["end_time"],
                details={
                    "native_label": group["native_label"],
                    "member_visual_object_ids": group["member_visual_object_ids"],
                    "source_frame_ids": group["source_frame_ids"],
                    "observation_count": group["observation_count"],
                    "representative_visual_object_id": group["representative_visual_object_id"],
                    "representative_bbox": group["representative_bbox"],
                    "detector_confidences": group["detector_confidences"],
                    "geometry_evidence": group["geometry_evidence"],
                    "iou_threshold_used": group["iou_threshold_used"],
                    "height_similarity_threshold_used": group["height_similarity_threshold_used"],
                },
                certainty="INFERRED",
                confidence_score=group["linkage_confidence"],  # always None — see this
                # endpoint's own docstring and visual_persistence_svc.py's own docstring point 6.
                reasoning=(
                    f"Native label '{group['native_label']}' observed in {group['observation_count']} "
                    f"distinct Stage-5 frames within this Shot, each meeting IoU >= "
                    f"{group['iou_threshold_used']} and height-similarity >= "
                    f"{group['height_similarity_threshold_used']} against the group's own "
                    "representative observation (an existing member, never fused or re-measured). "
                    "Exact native-label equality was required — no cross-label consolidation was "
                    "attempted; category='person' observations are always excluded."
                ),
                evidence_summary=(
                    "Inferred near-static persistent visual element, supported by repeated same-"
                    "label detector observations within one Shot. This is not a claim that a real "
                    "physical object was definitively re-identified, nor a claim about its "
                    "business role (product/prop/logo/background); see details.geometry_evidence "
                    "for the real, unmodified geometric evidence this claim rests on."
                ),
                source=VISUAL_PERSISTENCE_SOURCE,
                produced_by_pass=VISUAL_PERSISTENCE_PASS_NAME,
            ))

    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
            status="complete",
            pass_status={**pass_status, "visual_persistence": "complete"},
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)


VISUAL_COMPOSITION_PASS_NAME = "visual_composition_v1"

# Same producer/algorithm-family-identifier convention as C1's own VISUAL_PERSISTENCE_SOURCE
# ("geometric_iou_linkage") — this pass's own deterministic drift arithmetic gets its own,
# distinct value rather than silently overloading C1's.
VISUAL_COMPOSITION_SOURCE = "geometric_layout_drift"


@router.post("/{reference_video_id}/analyze-visual-composition", response_model=ReferenceVideoResponse)
async def analyze_reference_video_visual_composition(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Stage 8 (Visual Objects / People / Products / Composition), Composition MVP, Part B —
    shot-level LAYOUT-DRIFT evidence over already-existing Stage-8-Phase-C1
    `persistent_visual_element` annotations. See app/services/visual_composition_svc.py's own
    docstring for the exact metric definitions this endpoint persists.

    Gated on `visual_persistence` (Stage 8 Phase C1) alone — deliberately NOT on OCR/speech/
    audio_structure/C2/product recognition (none of those exist or are needed here). This pass
    reads nothing but Stage 8 Phase C1's own already-persisted `persistent_visual_element`
    AnalysisAnnotation rows (and, through them, their own member VisualObject rows' geometry) —
    no object detection is ever re-run, and no new persistence grouping is ever derived here.

    Reuses the existing AnalysisAnnotation table (category="persistent_layout_stability") rather
    than a new table or column — confirmed non-conflicting with the three existing categories
    (`audio_silence`, `recurring_text_element`, `persistent_visual_element`). Every derived row's
    `details` references its own source `persistent_visual_element` annotation id verbatim,
    alongside the same member_visual_object_ids/source_frame_ids/native_label C1 already
    established — this pass makes NO new identity or grouping claim of its own, only measures how
    much that already-established group's own geometry drifts across its members.

    `certainty` is always "INFERRED"; `confidence_score` is always None — no calibrated,
    defensible layout-stability probability exists (same discipline as C1's own
    linkage_confidence). No new "near-static" threshold is introduced: the underlying C1 group
    already qualified as persistent using its own approved criteria (IoU>=0.80, height-
    similarity>=0.85); this pass's own `reasoning` states that inheritance explicitly rather than
    re-classifying stability with a second, independent threshold."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    pass_status = dict(latest.pass_status or {})
    if pass_status.get("visual_persistence") != "complete":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Visual-persistence derivation must complete before composition layout-stability analysis can run",
        )

    if pass_status.get("visual_composition") == "complete":
        # Idempotent — already done. Return as-is; do not re-run, do not create duplicate rows.
        return await _to_response(db, rv, asset)

    now = datetime.now(timezone.utc)
    if latest.status == "running":
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        pass_status = {**pass_status, "visual_composition": "failed", "visual_composition_error": "Stale run — exceeded timeout, treated as failed"}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=pass_status)
        )
        await db.commit()

    running_pass_status = {**pass_status, "visual_composition": "running"}
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == latest.id, VideoAnalysis.status == "complete")
        .values(status="running", pass_status=running_pass_status)
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    # Existing Stage-8-Phase-C1 persistent_visual_element rows — the ONLY input this pass ever
    # uses. No object detection is re-run; no new persistence grouping is ever derived here.
    persistence_result = await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "persistent_visual_element",
        )
    )
    persistence_rows = persistence_result.scalars().all()

    all_member_ids: set[int] = set()
    for ann in persistence_rows:
        all_member_ids.update((ann.details or {}).get("member_visual_object_ids", []))
    member_vo_by_id: dict[int, VisualObject] = {}
    if all_member_ids:
        member_vo_result = await db.execute(select(VisualObject).where(VisualObject.id.in_(all_member_ids)))
        member_vo_by_id = {vo.id: vo for vo in member_vo_result.scalars().all()}

    # Drift computation happens entirely before any DB write — same discipline as every prior
    # Stage 6-8 pass — so a mid-run failure can never leave a partial/orphan annotation behind.
    drift_by_annotation_id: dict[int, dict] = {}
    try:
        for ann in persistence_rows:
            details = ann.details or {}
            member_ids = details.get("member_visual_object_ids", [])
            boxes = [
                visual_geometry_svc.Box(member_vo_by_id[mid].x, member_vo_by_id[mid].y, member_vo_by_id[mid].width, member_vo_by_id[mid].height)
                for mid in member_ids if mid in member_vo_by_id
            ]
            drift_by_annotation_id[ann.id] = visual_composition_svc.compute_layout_drift(boxes)
    except Exception as exc:  # noqa: BLE001 — any unexpected failure must still fail cleanly,
        # never crash the request or leave the row stuck at "running" forever. Nothing has been
        # written to the DB yet at this point, so there is nothing to clean up here.
        failed_pass_status = {**pass_status, "visual_composition": "failed", "visual_composition_error": f"Unexpected error: {exc}"[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    # Defensive idempotency (same reasoning as Stage 4-8's own cleanup): clear any pre-existing
    # persistent_layout_stability rows THIS PASS produced before writing the fresh set. Only ever
    # finds rows here after a stale-run retry (a genuinely completed attempt is caught by the
    # idempotent early-return above).
    await db.execute(
        delete(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "persistent_layout_stability",
            AnalysisAnnotation.produced_by_pass == VISUAL_COMPOSITION_PASS_NAME,
        )
    )

    # Zero eligible C1 elements is a normal, valid, successful outcome — zero rows written,
    # pass_status still becomes "complete", never "failed".
    for ann in persistence_rows:
        drift = drift_by_annotation_id.get(ann.id)
        if drift is None:
            continue
        details = ann.details or {}
        db.add(AnalysisAnnotation(
            video_analysis_id=latest.id,
            shot_id=ann.shot_id,
            category="persistent_layout_stability",
            start_time=ann.start_time, end_time=ann.end_time,
            details={
                "source_persistent_visual_element_id": ann.id,
                "member_visual_object_ids": details.get("member_visual_object_ids", []),
                "source_frame_ids": details.get("source_frame_ids", []),
                "native_label": details.get("native_label"),
                **drift,
            },
            certainty="INFERRED",
            confidence_score=None,  # always None — see this endpoint's own docstring and
            # visual_composition_svc.py's own docstring: no calibrated stability probability exists.
            reasoning=(
                f"Layout-drift evidence over Phase-C1 persistent_visual_element id={ann.id} "
                f"(native label '{details.get('native_label')}'), which already met C1's own "
                "persistence criteria (IoU >= 0.80, height-similarity >= 0.85 against its own "
                "reference observation) — that qualification is inherited here, not re-derived or "
                "re-classified by a new threshold. The drift numbers below are the real, "
                "unmodified geometric spread across this group's own already-persisted members."
            ),
            evidence_summary=(
                "Deterministic layout-drift measurement (centroid/width/height/occupancy) over an "
                "already-existing Phase-C1 persistent element's own members. This is not a claim "
                "about the real-world object's identity or composition role — only about how much "
                "its already-inferred persistent region's own geometry varies across observations."
            ),
            source=VISUAL_COMPOSITION_SOURCE,
            produced_by_pass=VISUAL_COMPOSITION_PASS_NAME,
        ))

    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
            status="complete",
            pass_status={**pass_status, "visual_composition": "complete"},
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)


GLOBAL_MOTION_EVIDENCE_PASS_NAME = "global_motion_evidence_v1"

# Producer/algorithm-family identifier — same convention as C1's own "geometric_iou_linkage" and
# Composition's own "geometric_layout_drift" (see this router's own other passes).
GLOBAL_MOTION_EVIDENCE_SOURCE = "opencv_phase_affine"


@router.post("/{reference_video_id}/analyze-global-motion", response_model=ReferenceVideoResponse)
async def analyze_reference_video_global_motion(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Stage 9 (Motion / Camera / Transitions / Animation), Phase A — TEMPORAL / GLOBAL-MOTION
    EVIDENCE FOUNDATION. See app/services/visual_motion_svc.py's own docstring for the full
    architecture (5fps shot-scoped transient sampling, boundary-safe windowing, two-stream
    phase-correlation + affine/RANSAC evidence) this endpoint persists.

    Gated on `scene_segmentation` (Stage 4) alone — deliberately NOT on OCR/speech/audio_structure/
    visual_objects/visual_persistence/visual_composition/C2. Global-motion evidence operates over
    Shot boundaries (Stage 4's own output) and the ORIGINAL reference-video source; it needs
    nothing else Stage 5-8 produced, though Stage 8's own persistence evidence was useful
    corroboration during this phase's own real-video benchmark (see that report) — it is NOT a
    dependency here.

    Analyzes the ORIGINAL ReferenceVideo source file (`asset.file_path`) — never Stage-5 stills,
    preview derivatives, or exported editor media. If that file is missing, this pass fails
    honestly (via the same try/except every prior pass uses) — it never silently substitutes a
    different frame source or fabricates successful evidence.

    Reuses the existing AnalysisAnnotation table (category="global_motion_evidence") — no
    schema/model change of any kind; confirmed non-conflicting with the existing
    `audio_silence`/`recurring_text_element`/`persistent_visual_element`/`persistent_layout_
    stability` categories. `certainty` is always "MEASURED" (a direct geometric measurement, the
    same tier as Stage 4/5's own deterministic facts); `confidence_score` is always None (no
    calibrated probability exists for a raw geometric measurement). This endpoint NEVER writes
    `Shot.camera_movement` and NEVER classifies a shot as static/pan/tilt/zoom/rotating — see
    visual_motion_svc.py's own docstring for exactly why that inference is out of scope here.

    A Shot too short to produce at least 2 analytical frames (visual_motion_svc's own
    `insufficient_temporal_samples`) gets NO AnalysisAnnotation row at all — the same "zero
    eligible -> zero rows" honesty convention every prior Stage 6-8 pass already established,
    never a fabricated placeholder row."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    pass_status = dict(latest.pass_status or {})
    if pass_status.get("scene_segmentation") != "complete":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shot detection must complete before global-motion analysis can run",
        )

    if pass_status.get("global_motion_evidence") == "complete":
        # Idempotent — already done. Return as-is; do not re-run, do not create duplicate rows.
        return await _to_response(db, rv, asset)

    now = datetime.now(timezone.utc)
    if latest.status == "running":
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        pass_status = {**pass_status, "global_motion_evidence": "failed", "global_motion_evidence_error": "Stale run — exceeded timeout, treated as failed"}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=pass_status)
        )
        await db.commit()

    running_pass_status = {**pass_status, "global_motion_evidence": "running"}
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == latest.id, VideoAnalysis.status == "complete")
        .values(status="running", pass_status=running_pass_status)
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    shots_result = await db.execute(select(Shot).where(Shot.video_analysis_id == latest.id).order_by(Shot.order))
    shot_rows = shots_result.scalars().all()

    # Measurement happens entirely before any DB write — same discipline as every prior Stage
    # 6-8 pass — so a mid-run failure can never leave a partial/orphan annotation behind.
    evidence_by_shot_id: dict[int, dict] = {}
    try:
        for shot in shot_rows:
            evidence = await visual_motion_svc.measure_shot_global_motion(asset.file_path, shot.start_time, shot.end_time)
            evidence_by_shot_id[shot.id] = evidence
    except Exception as exc:  # noqa: BLE001 — any unexpected failure (including a genuinely
        # missing/unreadable original source file) must still fail cleanly, never crash the
        # request or leave the row stuck at "running" forever. Nothing has been written to the DB
        # yet at this point, so there is nothing to clean up here.
        failed_pass_status = {**pass_status, "global_motion_evidence": "failed", "global_motion_evidence_error": f"Unexpected error: {exc}"[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    # Defensive idempotency (same reasoning as Stage 4-9's own cleanup): clear any pre-existing
    # global_motion_evidence rows THIS PASS produced before writing the fresh set. Only ever finds
    # rows here after a stale-run retry (a genuinely completed attempt is caught by the idempotent
    # early-return above).
    await db.execute(
        delete(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "global_motion_evidence",
            AnalysisAnnotation.produced_by_pass == GLOBAL_MOTION_EVIDENCE_PASS_NAME,
        )
    )

    # Every Shot too short for at least 2 analytical frames is a normal, valid, successful
    # outcome for THAT shot — zero rows for it, pass_status still becomes "complete" overall,
    # never "failed" merely because one shot was short.
    extraction_parameters = {
        "orb_nfeatures": visual_motion_svc.DEFAULT_ORB_NFEATURES,
        "ratio_test_threshold": visual_motion_svc.DEFAULT_RATIO_TEST_THRESHOLD,
        "ransac_reprojection_threshold_px": visual_motion_svc.DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX,
    }
    for shot in shot_rows:
        evidence = evidence_by_shot_id.get(shot.id)
        if evidence is None or evidence["insufficient_temporal_samples"]:
            continue
        db.add(AnalysisAnnotation(
            video_analysis_id=latest.id,
            shot_id=shot.id,
            category="global_motion_evidence",
            start_time=shot.start_time, end_time=shot.end_time,
            details={
                "sampling_fps": evidence["sampling_fps"],
                "sample_count": evidence["sample_count"],
                "frame_pair_count": evidence["frame_pair_count"],
                "affine": evidence["affine"],
                "phase_correlation": evidence["phase_correlation"],
                # Phase C1 — additive; .get() (not []) keeps this tolerant of any caller/fixture
                # still returning the pre-C1 evidence shape without this key.
                "cross_stream": evidence.get("cross_stream"),
                "extraction_parameters": extraction_parameters,
            },
            certainty="MEASURED",
            confidence_score=None,  # always None — see this endpoint's own docstring and
            # visual_motion_svc.py's own docstring: no calibrated probability exists for a raw
            # geometric measurement.
            reasoning=(
                f"Global-motion evidence measured over {evidence['sample_count']} analytical "
                f"frames ({evidence['frame_pair_count']} consecutive pairs) sampled at "
                f"{evidence['sampling_fps']} fps within this Shot's own boundary-safe window. "
                "This is raw geometric measurement only — it does not classify the shot as "
                "static, panning, tilting, zooming, or rotating; that inference is explicitly "
                "deferred to a later Stage-9 phase."
            ),
            evidence_summary=(
                "Two independently-measured evidence streams: ORB-feature + RANSAC-affine "
                "estimation (translation/scale/rotation, may fail honestly on low-texture pairs) "
                "and frequency-domain phase correlation (translation-only, always numeric). "
                "Never averaged into one synthetic motion score — see details.affine/"
                "details.phase_correlation for each stream's own real numbers."
            ),
            source=GLOBAL_MOTION_EVIDENCE_SOURCE,
            produced_by_pass=GLOBAL_MOTION_EVIDENCE_PASS_NAME,
        ))

    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
            status="complete",
            pass_status={**pass_status, "global_motion_evidence": "complete"},
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)


TRANSITION_EVIDENCE_PASS_NAME = "transition_evidence_v1"

# Producer/algorithm-family identifier — deliberately NOT "opencv_phase_affine" (Phase A's own
# value): this pass also measures luminance, frame-difference, and black-frame evidence that no
# single library "owns" — see the B0.4A design correction's own naming-accuracy discussion.
TRANSITION_EVIDENCE_SOURCE = "temporal_visual_measurements"


@router.post("/{reference_video_id}/analyze-transition-evidence", response_model=ReferenceVideoResponse)
async def analyze_reference_video_transition_evidence(
    reference_video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Stage 9 (Motion / Camera / Transitions / Animation), Phase B1 — BOUNDARY-TRIGGERED
    TRANSITION EVIDENCE MVP. See app/services/transition_evidence_svc.py's own docstring for the
    full architecture (own independent transient 10fps extraction, boundary-triggered candidate
    source only, neutral threshold-free measurement fields).

    Gated on `scene_segmentation` (Stage 4) ALONE — deliberately NOT on visual_evidence/
    text_analysis/speech_analysis/audio_structure/visual_objects/visual_persistence/
    visual_composition/global_motion_evidence. This pass reuses `ffmpeg_svc.
    FRAME_BLACK_LUMINANCE_THRESHOLD` and `visual_motion_svc`'s own pure measurement functions as
    plain importable CODE (see transition_evidence_svc.py's own docstring) — this does NOT create
    a Stage-5 or Stage-9-Phase-A pass-completion PREREQUISITE; a video whose only completed pass is
    scene_segmentation is fully eligible.

    CANDIDATE WINDOWS COME ONLY FROM EXISTING STAGE-4 SHOT BOUNDARIES — this pass never reruns or
    modifies Stage-4 shot detection; it reads already-persisted Shot rows (ordered by `order`) and
    measures the shared boundary instant between every pair of ADJACENT shots. THIS INCREMENT DOES
    NOT YET DETECT GRADUAL TRANSITIONS STAGE 4 NEVER FLAGGED AS A BOUNDARY — a slow fade/dissolve
    whose own frames never crossed Stage 4's own scene-difference threshold is invisible to this
    pass. This is a deliberate, stated MVP limitation (see the B0.4A design correction, section 9),
    not a claim of complete gradual-transition coverage.

    Analyzes the ORIGINAL ReferenceVideo source file (`asset.file_path`) — never Stage-5 stills or
    any other derivative. Reuses the existing AnalysisAnnotation table (category=
    "transition_evidence") — no schema/model change of any kind. `certainty` is always "MEASURED";
    `confidence_score` is always None. `shot_id` is ALWAYS None for every annotation this pass
    writes — a boundary-spanning window belongs to neither adjacent Shot alone (see this project's
    own B0.4A design correction for why a default-to-preceding-shot convention was explicitly
    rejected); the real relationship is instead recorded explicitly as `preceding_shot_id`/
    `following_shot_id`/`boundary_timestamp` inside `details`. This endpoint NEVER writes
    `Shot.camera_movement` and NEVER writes a transition-type label of any kind (no hard_cut/fade/
    dissolve/dip_to_black) — see transition_evidence_svc.py's own docstring for exactly why that
    inference is out of scope here.

    A boundary too close to either adjacent Shot's own edge to obtain at least one analytical
    sample on BOTH sides (transition_evidence_svc's own `insufficient_boundary_material`) gets NO
    AnalysisAnnotation row at all — the same "zero eligible -> zero rows" honesty convention every
    prior Stage 6-9 pass already established, never a fabricated placeholder row. A video with
    fewer than 2 shots (zero boundaries) is a normal, valid, successful outcome with zero rows."""
    result = await db.execute(
        select(ReferenceVideo).where(ReferenceVideo.id == reference_video_id, ReferenceVideo.user_id == user.id)
    )
    rv = result.scalar_one_or_none()
    if not rv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference video not found")
    asset = await db.get(Asset, rv.asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reference video's underlying asset is missing")

    result = await db.execute(
        select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv.id).order_by(VideoAnalysis.created_at.desc())
    )
    latest = result.scalars().first()
    if latest is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No analysis record exists for this reference video")

    pass_status = dict(latest.pass_status or {})
    if pass_status.get("scene_segmentation") != "complete":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shot detection must complete before transition-evidence analysis can run",
        )

    if pass_status.get("transition_evidence") == "complete":
        # Idempotent — already done. Return as-is; do not re-run, do not create duplicate rows.
        return await _to_response(db, rv, asset)

    now = datetime.now(timezone.utc)
    if latest.status == "running":
        stale = latest.started_at is not None and (now - latest.started_at).total_seconds() > STALE_RUNNING_TIMEOUT_SECONDS
        if not stale:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")
        pass_status = {**pass_status, "transition_evidence": "failed", "transition_evidence_error": "Stale run — exceeded timeout, treated as failed"}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=pass_status)
        )
        await db.commit()

    running_pass_status = {**pass_status, "transition_evidence": "running"}
    claim = await db.execute(
        update(VideoAnalysis)
        .where(VideoAnalysis.id == latest.id, VideoAnalysis.status == "complete")
        .values(status="running", pass_status=running_pass_status)
        .returning(VideoAnalysis.id)
    )
    await db.commit()
    if claim.first() is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analysis is already in progress for this reference video")

    shots_result = await db.execute(select(Shot).where(Shot.video_analysis_id == latest.id).order_by(Shot.order))
    shot_rows = shots_result.scalars().all()

    # One candidate boundary per ADJACENT shot pair — never a third shot's own territory (see
    # transition_evidence_svc._boundary_candidate_window's own docstring). Zero shot pairs (0 or 1
    # shots total) is a normal, valid outcome: zero boundaries, zero candidate windows.
    boundary_specs = [
        (shot_rows[i], shot_rows[i + 1], shot_rows[i].end_time)
        for i in range(len(shot_rows) - 1)
    ]

    # Measurement happens entirely before any DB write — same discipline as every prior Stage
    # 6-9 pass — so a mid-run failure can never leave a partial/orphan annotation behind.
    evidence_by_boundary: dict[int, dict] = {}
    try:
        for preceding_shot, following_shot, boundary_timestamp in boundary_specs:
            evidence = await transition_evidence_svc.measure_boundary_transition_evidence(
                asset.file_path, boundary_timestamp, preceding_shot.start_time, following_shot.end_time,
            )
            evidence_by_boundary[preceding_shot.id] = evidence
    except Exception as exc:  # noqa: BLE001 — any unexpected failure (including a genuinely
        # missing/unreadable original source file) must still fail cleanly, never crash the
        # request or leave the row stuck at "running" forever. Nothing has been written to the DB
        # yet at this point, so there is nothing to clean up here.
        failed_pass_status = {**pass_status, "transition_evidence": "failed", "transition_evidence_error": f"Unexpected error: {exc}"[:500]}
        await db.execute(
            update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(status="complete", pass_status=failed_pass_status)
        )
        await db.commit()
        await db.refresh(rv)
        return await _to_response(db, rv, asset)

    # Defensive idempotency (same reasoning as Stage 4-9's own cleanup): clear any pre-existing
    # transition_evidence rows THIS PASS produced before writing the fresh set. Only ever finds
    # rows here after a stale-run retry (a genuinely completed attempt is caught by the idempotent
    # early-return above).
    await db.execute(
        delete(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == latest.id,
            AnalysisAnnotation.category == "transition_evidence",
            AnalysisAnnotation.produced_by_pass == TRANSITION_EVIDENCE_PASS_NAME,
        )
    )

    for preceding_shot, following_shot, boundary_timestamp in boundary_specs:
        evidence = evidence_by_boundary.get(preceding_shot.id)
        if evidence is None or evidence["insufficient_boundary_material"]:
            continue
        db.add(AnalysisAnnotation(
            video_analysis_id=latest.id,
            shot_id=None,  # ALWAYS None — a boundary-spanning window belongs to neither Shot
            # alone; see this endpoint's own docstring and the B0.4A design correction.
            category="transition_evidence",
            start_time=evidence["window_start"], end_time=evidence["window_end"],
            details={
                "boundary_timestamp": evidence["boundary_timestamp"],
                "window_start": evidence["window_start"],
                "window_end": evidence["window_end"],
                "preceding_shot_id": preceding_shot.id,
                "following_shot_id": following_shot.id,
                "sampling_fps": evidence["sampling_fps"],
                "sample_count": evidence["sample_count"],
                "frame_pair_count": evidence["frame_pair_count"],
                "sample_timestamps": evidence["sample_timestamps"],
                "luminance": evidence["luminance"],
                "frame_difference": evidence["frame_difference"],
                "black_frame_flags": evidence["black_frame_flags"],
                "affine": evidence["affine_evidence"],
                "phase_correlation": evidence["phase_correlation_evidence"],
                "extraction_parameters": {
                    "margin_seconds": transition_evidence_svc.TRANSITION_BOUNDARY_MARGIN_SECONDS,
                    "orb_nfeatures": visual_motion_svc.DEFAULT_ORB_NFEATURES,
                    "ratio_test_threshold": visual_motion_svc.DEFAULT_RATIO_TEST_THRESHOLD,
                    "ransac_reprojection_threshold_px": visual_motion_svc.DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX,
                },
            },
            certainty="MEASURED",
            confidence_score=None,  # always None — no calibrated probability exists for a raw
            # temporal measurement, same discipline as global_motion_evidence.
            reasoning=(
                f"Boundary-triggered transition evidence measured over {evidence['sample_count']} "
                f"analytical frames ({evidence['frame_pair_count']} consecutive pairs) sampled at "
                f"{evidence['sampling_fps']} fps in a window bracketing the Stage-4 boundary at "
                f"{evidence['boundary_timestamp']}s. This is raw, neutral measurement only — it "
                "does not classify this boundary as a hard cut, fade, dissolve, or dip-to-black; "
                "that inference is explicitly deferred to a later Stage-9 phase."
            ),
            evidence_summary=(
                "Neutral luminance/frame-difference trajectories plus per-pair ORB+RANSAC-affine "
                "and phase-correlation evidence (each kept per-pair, never collapsed into a single "
                "aggregate) — see details.luminance/details.frame_difference/details.affine/"
                "details.phase_correlation for the real numbers. No transition-type label or "
                "interpreted shape field of any kind."
            ),
            source=TRANSITION_EVIDENCE_SOURCE,
            produced_by_pass=TRANSITION_EVIDENCE_PASS_NAME,
        ))

    await db.execute(
        update(VideoAnalysis).where(VideoAnalysis.id == latest.id).values(
            status="complete",
            pass_status={**pass_status, "transition_evidence": "complete"},
        )
    )
    await db.commit()
    await db.refresh(rv)
    return await _to_response(db, rv, asset)
