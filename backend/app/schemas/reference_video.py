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

Stage 6: adds `text_elements` on each ShotSummary — deterministic OCR text occurrences (see
app.models.text_element.TextElement and app.services.ocr_svc for the full mechanism). Every
TextElementSummary field is MEASURED (the recognizer's own output and its own reported
confidence) — `category` is always None until a later, genuinely INFERRED stage populates it;
`font_family_estimate` is never populated by this stage at all.

Stage 6 (two-level evidence refinement): `TextElementSummary` now represents one Occurrence
Group's own canonical head, with `observations` carrying every raw OCR reading that supports it
(head included) — nothing is ever hidden, only grouped. A separate, video-level
`recurring_elements` list on `ReferenceVideoResponse` cross-references Occurrence Groups that
probably represent the same real element reappearing after a gap — explicitly `certainty:
"INFERRED"`, never confused with the unconditionally `"MEASURED"` groups/observations above it.

Stage 7 (Audio / Speech / Transcript), Phase C: adds `speech_segments`, a video-level (never
nested under a Shot) list — see app.models.speech_segment.SpeechSegment's own docstring for why
speech is timeline-based and deliberately not forced into visual Shot boundaries. Every
SpeechSegmentSummary field is direct local-Whisper output; `confidence_score` is deliberately
always None (Whisper's own raw decoding diagnostics live in `analysis_details` instead, verbatim,
never converted into a fabricated calibrated percentage — see speech_analysis_svc.py's own
docstring for the full reasoning), and `speaker_label` is always None until a future,
not-yet-built diarization pass populates it.

Stage 7, Phase D: adds `audio_structure` — deterministic FFmpeg `silencedetect` evidence (observed
silence intervals only, reusing the existing AnalysisAnnotation table, category="audio_silence";
see audio_structure_svc.py's own docstring for the full detection/parsing design and why no new
table was needed). Deliberately independent of, and never merged with, `speech_segments` above —
a silence interval is not evidence about speech specifically, and this pass never requires
speech_analysis to have run. `confidence_score` is always None here too — `silencedetect` is a
fixed threshold/duration detector, not a probabilistic model, so there is no confidence concept
to report at all.

Stage 8 (Visual Objects / People / Products / Composition), Phase B: adds `visual_objects` on
each ShotSummary (shot-scoped, like `frames`/`text_elements` — unlike Stage 7's timeline-wide
evidence, a detected object genuinely belongs to the one frame/Shot it was seen in). See
app.models.visual_object.py's own docstring for the full RAW-EVIDENCE-vs-BUSINESS-ROLE design
this exists to preserve: `label`/`class_id` are the detector's own native COCO output, never
rewritten into a guessed real-world identity; `category` is only ever "person" (the one
structurally-equivalent COCO label) or the new neutral "object" value — never a guessed product/
prop/logo/background role, which remains explicitly future-stage scope.

Stage 8, Phase C1: adds `persistent_visual_elements` on each ShotSummary (shot-scoped, same
reasoning as `visual_objects` — a persistence claim about objects in one Shot belongs to that
Shot, never a video-wide claim). Reuses AnalysisAnnotation (category="persistent_visual_element"),
the same "small, derived, JSON-detailed claim" pattern Stage 6's own `recurring_elements` already
established for TextElement, extended here from raw VisualObject rows. Every
PersistentVisualElementSummary is deliberately conservative — see
app.services.visual_persistence_svc.py's own docstring for the full reasoning — requiring exact
native-label equality (no laptop/tv/cell-phone consolidation), excluding `category="person"`
entirely (never identity/face tracking), and requiring >=2 distinct source frames within the SAME
shot. `certainty` is always "INFERRED"; `confidence_score`/`linkage_confidence` are deliberately
always None — there is no calibrated, defensible probability this derivation could honestly
report — with the real geometric evidence (IoU/height-similarity of every member against the
group's own representative) preserved verbatim in `geometry_evidence` instead of a fabricated
score. `representative_bbox` is always one EXISTING member's own real bounding box, never fused or
re-measured.
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


class TextObservationSummary(BaseModel):
    """One RAW OCR observation — a single engine reading of a single candidate frame. Always
    certainty "MEASURED". Never edited, merged, or dropped once written — this is the permanent,
    auditable evidence record; TextElementSummary below (an Occurrence Group's own canonical
    head) is a VIEW over a collection of these, not a replacement for keeping them."""
    model_config = {"from_attributes": True}

    id: int
    text: str
    timestamp: float
    x: float
    y: float
    width: float
    height: float
    confidence_score: float | None
    evidence_summary: str | None
    source_frame_asset_file_path: str | None = None


class TextElementSummary(BaseModel):
    """One Stage-6 Occurrence Group, represented by its own canonical head observation (the
    group's highest-confidence raw reading — never a synthetic average). certainty is always
    "MEASURED" — the recognized string, its geometry, and confidence_score (the OCR engine's own
    reported confidence — a deliberate departure from Stage 4/5's convention of leaving
    confidence_score NULL on MEASURED rows, since here it genuinely IS a measurement of
    recognition quality, not a semantic judgment) are all direct recognizer output on this one
    head row. `category` is always None until a later, genuinely INFERRED stage populates it —
    Stage 6 cannot honestly know a text occurrence's ROLE (headline vs CTA vs disclaimer) from
    OCR alone. `font_family_estimate`/`font_confidence` are likewise never populated by this
    stage (OCR doesn't identify typefaces).

    `observations` carries EVERY raw detection grouped under this head (the head itself first,
    included — never hidden), so nothing is lost even though only the canonical head's own
    text/geometry/confidence drive this summary's own top-level fields. `start_time`/`end_time`
    are this GROUP's derived, computed-on-read span (earliest/latest member timestamp) — never
    stored, never a claim that the text was continuously visible for the whole span, only that
    it was observed at least at those two (and possibly more, in between) sampled instants."""
    model_config = {"from_attributes": True}

    id: int
    text: str
    start_time: float
    end_time: float
    x: float
    y: float
    width: float
    height: float
    certainty: str
    confidence_score: float | None
    category: str | None
    style_details: dict | None = None
    evidence_summary: str | None
    produced_by_pass: str | None
    # The source frame this text was read from — same asset_file_path pattern as
    # ShotFrameSummary, lets the frontend build a thumbnail via the existing
    # assetsApi.previewUrl() helper. None only if the underlying Asset is somehow missing
    # (unreachable via the RESTRICT FK in normal operation).
    source_frame_asset_file_path: str | None = None
    observations: list[TextObservationSummary] = []


class RecurringElementSummary(BaseModel):
    """A cross-reference between 2+ Occurrence Groups (by their TextElement id) that probably
    represent the same real on-screen element reappearing — e.g. a watermark seen at separated
    moments. Explicitly, unconditionally certainty "INFERRED" — never confused with the
    unconditionally "MEASURED" TextElementSummary/TextObservationSummary above it. Deliberately
    carries no merged time span claim beyond start_time/end_time (the outer bounds of its own
    member groups) — visibility in any gap between members is never claimed."""
    model_config = {"from_attributes": True}

    id: int
    member_text_element_ids: list[int]
    start_time: float
    end_time: float
    certainty: str
    confidence_score: float | None
    reasoning: str | None
    evidence_summary: str | None
    produced_by_pass: str | None


class SpeechSegmentSummary(BaseModel):
    """One Stage-7 speech-recognition evidence row — direct local-Whisper output for one decoded
    segment. certainty is always "MEASURED" (a direct engine extraction, same convention as
    ShotFrameSummary/TextElementSummary's own head rows). `confidence_score` is deliberately
    always None — Whisper's own per-segment decoding diagnostics (avg_logprob, no_speech_prob,
    compression_ratio, temperature) are NOT a calibrated 0-1 probability of transcript
    correctness, so they are preserved verbatim in `analysis_details` instead of being converted
    into a fabricated confidence value. `speaker_label` is always None — no diarization pass
    exists yet; the column/field exists only as forward-compatible storage."""
    model_config = {"from_attributes": True}

    id: int
    start_time: float
    end_time: float
    text: str
    language: str | None
    speaker_label: str | None
    certainty: str
    confidence_score: float | None
    analysis_details: dict | None = None
    source: str | None
    produced_by_pass: str | None


class AudioSilenceIntervalSummary(BaseModel):
    """One Stage-7-Phase-D observed silence interval — deterministic FFmpeg `silencedetect`
    output (an AnalysisAnnotation row, category="audio_silence"). certainty is always "MEASURED"
    — a fixed amplitude-threshold/duration detector, not a probabilistic model, so
    confidence_score is always None (there is no calibrated-or-uncalibrated confidence concept
    here at all, unlike Whisper's own raw decoding diagnostics — see audio_structure_svc.py's own
    docstring). `details` carries the detector parameters actually used (noise_threshold_db,
    minimum_duration_seconds) plus the detector's own reported duration, never an interpretation
    of what the silence means."""
    model_config = {"from_attributes": True}

    id: int
    start_time: float
    end_time: float
    certainty: str
    confidence_score: float | None
    source: str | None
    produced_by_pass: str | None
    evidence_summary: str | None
    details: dict | None = None


class AudioStructureSummary(BaseModel):
    """Stage-7-Phase-D audio-structure evidence for one VideoAnalysis — observed silence
    intervals only (see audio_structure_svc.py's own docstring for why derived audio-active
    regions are not persisted or exposed here). `audio_stream_present=False` and
    `silence_intervals=[]` together mean "no audio track at all" — a distinct fact from "has an
    audio track, but zero silence was detected in it" (audio_stream_present=True,
    silence_intervals=[])."""
    audio_stream_present: bool
    silence_count: int
    silence_intervals: list[AudioSilenceIntervalSummary] = []


class VisualObjectSummary(BaseModel):
    """One Stage-8-Phase-B raw visual-object detection — direct local-torchvision-detector
    output for one Stage-5 ShotFrame. certainty is always "MEASURED" — see
    app.models.visual_object.py's own docstring for the full RAW-EVIDENCE-vs-BUSINESS-ROLE
    reasoning this field set exists to preserve.

    `label` is the detector's own native COCO label (e.g. "cell phone", "keyboard", "laptop",
    "tv") — NEVER rewritten into a guessed "real" object identity. `class_id` is the same
    evidence in the detector's own native integer form. `category` is either "person" (the one
    COCO label structurally equivalent to this project's own category of the same name) or
    "object" (every other COCO label — a deliberately neutral placeholder, never a guessed
    product/prop/logo/background role — see the model's own docstring point 1). `confidence_score`
    is the detector's own real, unmodified score.

    `source_frame_id`/`source_frame_asset_file_path` trace this detection back to the EXACT
    Stage-5 ShotFrame/image it came from — never merely "this Shot, sometime." `start_time`/
    `end_time` are both the source frame's own timestamp (a single-instant observation; Stage 8
    Phase B never infers how long an object was actually visible beyond the one frame it was
    seen in).

    scale_x/scale_y/rotation/anchor_x/anchor_y/opacity/z_index are deliberately NOT exposed here
    — Phase B never measures them (a 2D bounding-box detector cannot), so this schema is exactly
    the fields Phase B genuinely knows, not the full VisualObject column set padded out with
    unmeasured defaults that could be mistaken for detector output."""
    model_config = {"from_attributes": True}

    id: int
    label: str
    category: str
    class_id: int | None
    x: float
    y: float
    width: float
    height: float
    start_time: float
    end_time: float
    certainty: str
    confidence_score: float | None
    evidence_summary: str | None
    source: str | None
    produced_by_pass: str | None
    source_frame_id: int | None
    source_frame_asset_file_path: str | None = None


class PersistentVisualElementGeometryEvidence(BaseModel):
    """One non-representative member's own real geometric comparison against the group's own
    representative observation — never a claim about the representative itself (nothing to
    compare it against)."""
    visual_object_id: int
    source_frame_id: int
    iou_vs_reference: float
    height_similarity_vs_reference: float
    centroid_displacement_vs_reference: float


class PersistentVisualElementDetectorConfidence(BaseModel):
    """One member's own real, unmodified detector confidence — kept separate from this element's
    own linkage_confidence (see PersistentVisualElementSummary's own docstring for why the two
    must never be conflated)."""
    visual_object_id: int
    confidence_score: float | None


class PersistentVisualElementBoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class PersistentVisualElementSummary(BaseModel):
    """One Stage-8-Phase-C1 conservative same-shot, same-native-label, non-person persistence
    claim, derived entirely from already-persisted Phase-B VisualObject rows — see
    app.services.visual_persistence_svc.py's own docstring for the full derivation reasoning.
    Always `certainty="INFERRED"` — the first INFERRED-tier claim Stage 8 has produced (every
    VisualObject row it derives from stays "MEASURED" and untouched).

    `representative_bbox` is `representative_visual_object_id`'s own real, already-persisted
    bounding box — chosen (the highest-confidence member), never averaged or re-measured.
    `linkage_confidence` is deliberately always None: there is no calibrated, defensible
    probability this module can honestly report for "these are the same physical object" — the
    real geometric evidence lives in `geometry_evidence` instead, one entry per non-representative
    member, so a reader can judge the evidence directly. `detector_confidences` preserves every
    member's own real detector confidence_score separately — never averaged into a linkage score.

    Deliberately NOT present: any cross-label consolidation (a `laptop`/`tv` reading of the same
    physical region stays as two separate, unlinked elements in Phase C1 — see the module
    docstring's own "false split is safer than a manufactured merge" reasoning), any
    dominant-subject/product-role/composition field, and any element for `category="person"`
    observations (Phase C1 never performs identity/face tracking)."""
    model_config = {"from_attributes": True}

    id: int
    native_label: str
    member_visual_object_ids: list[int]
    source_frame_ids: list[int]
    observation_count: int
    start_time: float
    end_time: float
    representative_visual_object_id: int
    representative_bbox: PersistentVisualElementBoundingBox
    detector_confidences: list[PersistentVisualElementDetectorConfidence]
    geometry_evidence: list[PersistentVisualElementGeometryEvidence]
    certainty: str
    linkage_confidence: float | None
    reasoning: str | None
    evidence_summary: str | None
    source: str | None
    produced_by_pass: str | None


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
    # Stage 6's OCR text occurrences for this Shot, chronological order — empty until text
    # analysis completes at least once.
    text_elements: list[TextElementSummary] = []
    # Stage 8 Phase B's raw visual-object detections for this Shot, chronological order (by
    # source frame timestamp) — empty until visual-object detection completes at least once. No
    # grouping/tracking/composition here — see visual_object_svc.py's own docstring for why.
    visual_objects: list[VisualObjectSummary] = []
    # Stage 8 Phase C1's derived same-shot persistence claims over the visual_objects above —
    # empty until the visual-persistence pass completes at least once, or when nothing in this
    # Shot qualifies (e.g. every label appeared in only one frame). See
    # visual_persistence_svc.py's own docstring for the exact conservative derivation rules.
    persistent_visual_elements: list[PersistentVisualElementSummary] = []


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
    # Stage 6's Recurring Element cross-references — video-level (not nested under a Shot) since
    # a recurring element may span multiple Shots; empty until text analysis completes at least
    # once, and even then only present when 2+ Occurrence Groups were actually linked.
    recurring_elements: list[RecurringElementSummary] = []
    # Stage 7's speech-recognition evidence — video-level (never nested under a Shot; speech is
    # timeline-based and can cross visual cut boundaries) — empty until speech analysis completes
    # at least once, and empty (not an error) whenever no speech was detected in the audio.
    speech_segments: list[SpeechSegmentSummary] = []
    # Stage 7 Phase D's audio-structure evidence (observed silence only) — None until that pass
    # has completed at least once; kept entirely separate from speech_segments above (see
    # AudioStructureSummary's own docstring for why the two are never merged/overloaded).
    audio_structure: AudioStructureSummary | None = None
