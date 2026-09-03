"""Video Deconstructor — Stage 2 (Ingestion), Stage 3 (Technical Analysis), Stage 4 (Deterministic
Shot Boundary Detection).

Stage 2: wraps an already-uploaded Asset (created by the existing, untouched POST /upload/
endpoint) into an immutable ReferenceVideo plus its initial, empty, pending VideoAnalysis.

Stage 3: adds `technical_details` — the deterministic container/stream facts extracted by
app.services.ffmpeg_svc.probe_technical_metadata (see that function's own docstring for the
exact structure and why each field is what it is) — plus started_at/completed_at/error on the
analysis summary so the frontend can render the full pending -> running -> complete/failed
lifecycle.

Stage 4: adds `pass_status` (exposes VideoAnalysis's own existing JSON column so the frontend can
track Stage 3's and Stage 4's pass states INDEPENDENTLY — a running/failed Stage-4 pass must
never hide Stage 3's already-trustworthy, still-valid results) and `shots` — the deterministic
cut-boundary segments Stage 4 detects (see app.routers.reference_videos and
app.services.ffmpeg_svc.detect_shot_boundary_candidates/build_shot_segments for the full
mechanism). Nothing in this whole schema is ever populated by AI/inference — see each stage's
own implementation report for its certainty/evidence treatment.

Stage 5: adds `frames` on each ShotSummary — the small, deterministic set of representative
still-frame extracted from that Shot (see app.models.shot_frame.ShotFrame and
app.services.ffmpeg_svc.plan_representative_frame_timestamps for the full mechanism). Every
ShotFrameSummary field is a MEASURED, pixel-level fact about the extracted image itself (its
timestamp, dimensions, luminance/black-frame/sharpness) — never a semantic claim about what the
frame shows.
"""
from datetime import datetime

from pydantic import BaseModel


class ReferenceVideoIngestRequest(BaseModel):
    # The Asset must already exist — created by uploading via the existing /upload/ endpoint
    # first. This router never receives or writes a file itself; it only wraps an asset that
    # already has one, reusing the existing upload/storage pipeline rather than duplicating it.
    asset_id: int


class VideoAnalysisSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    analysis_tier: str
    status: str
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    # Populated only when status == "failed" — extracted from VideoAnalysis.pass_status
    # (reuses the existing Stage-1 JSON column exactly as its own docstring anticipated: "which
    # named pass is running/done/failed" — no new column needed for this).
    error: str | None = None
    # Stage 4: the raw per-pass state dict itself, e.g. {"technical_probe": "complete",
    # "scene_segmentation": "running"} — lets the frontend render each pass's own lifecycle
    # independently of `status` above (which reflects only the MOST RECENTLY attempted pass).
    pass_status: dict = {}


class ShotFrameSummary(BaseModel):
    """One Stage-5 representative still frame extracted from a Shot. certainty is always
    "MEASURED" — every field here (timestamp, dimensions, measurements) is a direct, deterministic
    fact about the extracted image itself, never an interpretation of what it shows. `measurements`
    mirrors ReferenceVideo.technical_details' own "small versioned JSON payload" convention:
    {width, height, luminance_mean, is_black_frame, sharpness_score} today, extensible later
    without a migration."""
    model_config = {"from_attributes": True}

    id: int
    order: int
    timestamp: float
    extraction_method: str
    width: int
    height: int
    measurements: dict = {}
    certainty: str
    evidence_summary: str | None
    produced_by_pass: str | None
    # The extracted frame's own file, exposed the exact same way ReferenceVideoResponse exposes
    # asset_file_path — lets the frontend build a thumbnail URL via the existing
    # assetsApi.previewUrl() helper, no new download endpoint.
    asset_file_path: str


class ShotSummary(BaseModel):
    """One deterministically-detected cut-bounded segment. certainty is always "MEASURED" —
    Stage 4 never writes an INFERRED Shot. evidence_summary carries the detector's own score and
    the threshold used (detector evidence, not semantic confidence — confidence_score, a
    different column entirely reserved for future INFERRED-tier judgments, is deliberately never
    populated here)."""
    model_config = {"from_attributes": True}

    id: int
    order: int
    start_time: float
    end_time: float
    certainty: str
    evidence_summary: str | None
    produced_by_pass: str | None
    # Stage 5's representative-frame evidence set for this Shot, chronological order — empty
    # until visual-evidence extraction completes at least once.
    frames: list[ShotFrameSummary] = []


class ReferenceVideoResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    asset_id: int
    original_filename: str
    # Read-only Reference Preview (post-Stage-4 UI gap fix): the underlying Asset's own
    # file_path, exposed exactly the way AssetResponse already exposes it elsewhere in this app
    # — lets the frontend build a preview URL via the existing assetsApi.previewUrl() helper, the
    # same one every editor clip already uses, without adding a new download endpoint. This is
    # the ONE field that made an independent, editor-timeline-decoupled reference player
    # possible: without it, Import External had no way to know where the analysed file even is.
    asset_file_path: str
    source: str
    original_url: str | None
    rights_status: str
    created_at: datetime
    # The latest VideoAnalysis version for this ReferenceVideo — its status is exactly the
    # ingestion/analysis lifecycle state Stage 2/3/4's UI surfaces (pending -> running ->
    # complete/failed).
    latest_analysis: VideoAnalysisSummary
    # Stage 3's controlled, versioned technical-facts structure — None until analysis completes
    # at least once. See ffmpeg_svc.probe_technical_metadata / _empty_technical_details for the
    # exact, stable shape (schema_version key included inside).
    technical_details: dict | None = None
    # Stage 4's deterministically-detected shot segments, in chronological order — empty until
    # structural analysis completes at least once.
    shots: list[ShotSummary] = []
