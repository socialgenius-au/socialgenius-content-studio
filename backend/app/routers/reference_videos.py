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
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.schemas.reference_video import (
    RecurringElementSummary, ReferenceVideoIngestRequest, ReferenceVideoResponse, ShotFrameSummary,
    ShotSummary, TextElementSummary, TextObservationSummary, VideoAnalysisSummary,
)
from app.services import ffmpeg_svc, ocr_svc

router = APIRouter()

# Probing is a header-only read (sub-second in practice, verified against a real ~6.5MB/34s
# file during Stage 3's own implementation) — a "running" row still stuck past this is almost
# certainly a crashed/killed process, not a slow probe. Generous on purpose.
STALE_RUNNING_TIMEOUT_SECONDS = 300


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
        or pass_status.get("text_analysis_error"),
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

    shots = [
        ShotSummary(
            id=s.id, order=s.order, start_time=s.start_time, end_time=s.end_time,
            certainty=s.certainty, evidence_summary=s.evidence_summary, produced_by_pass=s.produced_by_pass,
            frames=frames_by_shot.get(s.id, []),
            text_elements=text_by_shot.get(s.id, []),
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
