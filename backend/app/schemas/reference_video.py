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

Stage 8, Composition MVP: adds deterministic, on-demand GEOMETRIC LAYOUT EVIDENCE — never a
creative/compositional judgment. Part A: `VisualObjectSummary.layout` (per-detection frame-
occupancy, centroid, distance-from-frame-center, edge distances, thirds placement — see
app.services.visual_geometry_svc.py's own docstring) and `ShotSummary.same_frame_layout_pairs`
(pairwise IoU/containment/area-ratio/centroid-displacement/centroid-relative-position between
detections sharing one source frame — never compared across different frames). Both are computed
fresh on every response from already-persisted VisualObject geometry; NOTHING here is persisted —
see visual_geometry_svc.py's own docstring for why these are trivial, on-demand derivatives, not
new facts. `is_largest_detected_region_in_source_frame` reports only which existing box has the
largest already-measured area — deliberately never called "dominant"/"primary"/"focal"/"hero"
anything (the real reference video's own coarse, mislabeled "laptop" detection is consistently the
single largest box in every real frame — exactly why that language would be misleading).

Part B: `ShotSummary.layout_stability` — the ONE new persisted Composition inference, reusing
AnalysisAnnotation (category="persistent_layout_stability") to record shot-level layout-DRIFT
evidence across an already-existing Phase-C1 persistent_visual_element's own members (see
app.services.visual_composition_svc.py's own docstring). This does NOT re-derive persistence —
every drift measurement here is over a shot/label/person-exclusion grouping C1 already
established — and introduces NO new "near-static" threshold: C1's own persistence criteria
(IoU>=0.80, height-similarity>=0.85) already qualified the underlying group, and this layer only
reports the real drift numbers on top of that inherited qualification. `certainty` is always
"INFERRED"; `confidence_score` is deliberately always None (no calibrated, defensible stability
probability exists).

Stage 9 (Motion / Camera / Transitions / Animation), Phase A: adds `ShotSummary.
global_motion_evidence` — MEASURED (not INFERRED) global-motion evidence for one Shot, derived
from the ORIGINAL reference-video source (never Stage-5 stills), reusing AnalysisAnnotation
(category="global_motion_evidence"). See app.services.visual_motion_svc.py's own docstring for
the full architecture: a fixed 5fps shot-scoped transient sampling foundation (selected from a
real-video benchmark, not guessed), two deliberately separate evidence streams (ORB+RANSAC affine
estimation and phase correlation, never averaged into one synthetic score), and boundary-safe
sampling that never crosses a real shot cut. This field answers only "what global geometric
change was measured" — it NEVER classifies a shot as static/pan/tilt/zoom/rotating; that
inference is explicitly deferred to a later Stage-9 phase. `Shot.camera_movement` remains
untouched by this phase.

Stage 9, Phase B1 (BOUNDARY-TRIGGERED TRANSITION EVIDENCE MVP): adds `ReferenceVideoResponse.
transition_evidence` — a video-level (never nested under a Shot, same reasoning as
`speech_segments`: a transition genuinely spans TWO Shots, not one) list of MEASURED evidence
windows, one per existing Stage-4 shot boundary this pass could obtain material on both sides of.
Reuses AnalysisAnnotation (category="transition_evidence"). See
app.services.transition_evidence_svc.py's own docstring for the full architecture: this pass
performs its OWN independent transient 10fps extraction (never reusing Phase-A's or Stage-5's own
already-deleted/derivative frames), candidate windows come ONLY from already-persisted Stage-4
shot boundaries (no independent coarse scan in this increment — a gradual transition Stage 4 never
flagged is invisible to this pass, a deliberate, stated MVP limitation), and every field is a
neutral, threshold-free measurement (raw values plus deterministic math summaries) — NEVER a
transition-type label (no hard_cut/fade/dissolve/dip_to_black anywhere in this schema) and NEVER
an interpreted shape (no declining/rising/sustained_plateau/monotonic-enough). `shot_id` is always
None for this MVP (a boundary-spanning window belongs to neither Shot alone); `preceding_shot_id`/
`following_shot_id` record the real relationship explicitly instead. `certainty` is always
"MEASURED"; `confidence_score` is always None (no calibrated probability exists for a raw
temporal measurement). Similarity-transfer evidence (dissolve reference-frame comparison) is
deliberately NOT implemented in this phase — see transition_evidence_svc.py's own docstring.

Stage 9, Phase C1 (MOTION DYNAMICS EVIDENCE): adds `AffineMotionEvidenceSummary.dynamics`
(SignedAxisDynamicsSummary for translation_x/translation_y/rotation_deg, UnsignedAxisDynamicsSummary
for scale, MagnitudeDynamicsSummary for translation_magnitude — median/min/max/range/standard_
deviation, plus sign/delta counts for the signed fields) and `GlobalMotionEvidenceSummary.
cross_stream` (CrossStreamMotionEvidenceSummary — neutral affine-vs-phase differences/ratio).
Both purely additive to the existing `global_motion_evidence` category/pass — no new
AnalysisAnnotation category, no schema migration, `certainty`/`source`/`produced_by_pass`
unchanged. See app.services.visual_motion_svc.py's own docstring for the exact fields, the
sign-change definition (the sign of each pair's own motion value, never a second-order delta of
successive values), and the run-continuity rule (a failed affine pair never bridges two
successful ones for sign-change purposes). Still zero classification — no STATIC/PAN/TILT/ZOOM/
ROTATION/HANDHELD/MIXED label anywhere in this schema, `Shot.camera_movement` still untouched,
and explicitly no scale/rotation-driven translation "correction" of any kind (Phase C0 identified
the coupling effect; any future correction needs the full affine transform, not a scale-only
approximation — C1 reports the raw dynamics only).
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


class VisualObjectLayoutSummary(BaseModel):
    """Stage-8-Composition-MVP deterministic, on-demand geometric layout measurements for one
    VisualObject detection — computed fresh on every response directly from that same row's own
    x/y/width/height (see app.services.visual_geometry_svc.py's own docstring), never persisted
    anywhere. SIMPLE GEOMETRIC LAYOUT EVIDENCE ONLY: `horizontal_third`/`vertical_third` are plain
    coordinate-space partitions (< 1/3, > 2/3, otherwise the middle third) — a documented,
    explicit geometric convention, NOT an AI/aesthetic composition judgment. `frame_occupancy` is
    identical to this detection's own normalized bbox area (width * height) — exposed under this
    name because it is the more directly useful framing for a Reconstructor, not a second,
    independently-measured quantity."""
    frame_occupancy: float
    centroid_x: float
    centroid_y: float
    distance_from_frame_center: float
    edge_distance_left: float
    edge_distance_right: float
    edge_distance_top: float
    edge_distance_bottom: float
    nearest_edge_distance: float
    horizontal_third: str
    vertical_third: str


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
    unmeasured defaults that could be mistaken for detector output.

    `layout` (Composition MVP) is a deterministic, on-demand derivative of this same row's own
    x/y/width/height — nothing new is measured, only recomputed for convenience on every
    response. `is_largest_detected_region_in_source_frame` is the Composition MVP's own
    `largest_detected_region` finding — see VisualObjectLayoutSummary's own docstring for why
    this is never called "dominant"/"primary"/"focal"/"hero" anything."""
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
    layout: VisualObjectLayoutSummary
    is_largest_detected_region_in_source_frame: bool = False


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


class SameFrameLayoutPairSummary(BaseModel):
    """Stage-8-Composition-MVP deterministic, on-demand pairwise geometric relationship between
    two VisualObject detections that share the SAME source_frame_id — comparisons are NEVER made
    across different frames (two detections from different timestamps do not coexist in one
    image, so comparing their geometry would be meaningless — see visual_geometry_svc.py's own
    docstring). Field names state their exact mathematical meaning (e.g. `a_centroid_above_b`,
    never "a is above b") so they cannot be misread as a claim about the real-world relationship
    between two physical things — only about the two detector boxes' own measured geometry.
    Nothing here is persisted; every value is recomputed fresh on every response."""
    source_frame_id: int
    visual_object_id_a: int
    visual_object_id_b: int
    iou: float
    intersection_over_a: float
    intersection_over_b: float
    area_ratio: float
    centroid_displacement: float
    a_centroid_above_b: bool
    a_centroid_below_b: bool
    a_centroid_left_of_b: bool
    a_centroid_right_of_b: bool


class PersistentLayoutStabilitySummary(BaseModel):
    """Stage-8-Composition-MVP shot-level LAYOUT-DRIFT evidence for one already-existing Phase-C1
    `persistent_visual_element` — see app.services.visual_composition_svc.py's own docstring for
    the exact metric definitions. This does NOT re-derive persistence (member/source-frame ids are
    copied verbatim from the source C1 annotation's own `details`), and introduces NO new
    "near-static" threshold — the underlying group already met C1's own persistence criteria
    (IoU>=0.80, height-similarity>=0.85); `reasoning` states this inheritance explicitly. Always
    `certainty="INFERRED"`; `confidence_score` is deliberately always None — no calibrated,
    defensible stability probability exists, matching C1's own `linkage_confidence` discipline."""
    model_config = {"from_attributes": True}

    id: int
    source_persistent_visual_element_id: int
    native_label: str
    member_visual_object_ids: list[int]
    source_frame_ids: list[int]
    centroid_max_pairwise_displacement: float
    width_min: float
    width_max: float
    width_range: float
    height_min: float
    height_max: float
    height_range: float
    occupancy_min: float
    occupancy_max: float
    occupancy_range: float
    certainty: str
    confidence_score: float | None
    reasoning: str | None
    evidence_summary: str | None
    source: str | None
    produced_by_pass: str | None


class SignedAxisDynamicsSummary(BaseModel):
    """Stage 9 Phase C1 — neutral, threshold-free dynamics for one signed per-pair affine field
    (translation_x, translation_y, or rotation_deg — each already IS a per-pair motion value, so
    its own sign is the fact of interest). `sign_change_count` only ever compares consecutive
    pairs within one contiguous run of successful affine estimations (see
    visual_motion_svc._successful_runs's own docstring) — a failed pair never bridges two
    successful ones. `zero_delta_count` is exact numeric equality (0.0) only, never a tolerance
    band. `standard_deviation` is None below 2 successful pairs (see visual_motion_svc.
    MINIMUM_PAIRS_FOR_STANDARD_DEVIATION's own docstring for why that is withheld rather than
    reported as a fabricated 0)."""
    positive_delta_count: int
    negative_delta_count: int
    zero_delta_count: int
    sign_change_count: int
    median: float
    min: float
    max: float
    range: float
    standard_deviation: float | None


class UnsignedAxisDynamicsSummary(BaseModel):
    """Stage 9 Phase C1 — neutral dynamics for a field with no sign concept (scale is always > 0;
    translation_magnitude is always >= 0) — median/min/max/range/standard_deviation only, same
    None-below-2-pairs rule as SignedAxisDynamicsSummary."""
    median: float
    min: float
    max: float
    range: float
    standard_deviation: float | None


class MagnitudeDynamicsSummary(UnsignedAxisDynamicsSummary):
    """UnsignedAxisDynamicsSummary plus a p95, for translation_magnitude specifically."""
    p95: float


class AffineDynamicsSummary(BaseModel):
    """Stage 9 Phase C1 — the full set of neutral dynamics statistics over one Shot's own
    successful affine pairs. None entirely whenever zero pairs succeeded (see
    AffineMotionEvidenceSummary.dynamics's own docstring) — never a fabricated 0/identity result
    for a shot with no successful affine evidence at all."""
    translation_x: SignedAxisDynamicsSummary
    translation_y: SignedAxisDynamicsSummary
    translation_magnitude: MagnitudeDynamicsSummary
    rotation_deg: SignedAxisDynamicsSummary
    scale: UnsignedAxisDynamicsSummary
    successful_run_count: int
    longest_successful_run_pair_count: int


class AffineMotionEvidenceSummary(BaseModel):
    """ORB-feature + RANSAC-affine global-motion evidence, aggregated across one Shot's own
    analytical frame pairs — see app.services.visual_motion_svc.py's own docstring for the exact
    method and why a failed per-pair estimate is never fabricated as zero motion.
    `estimation_success_rate` is over ALL frame pairs (successful + failed); every median/p95
    field is computed ONLY over the successful pairs and is None when zero pairs succeeded —
    never a fabricated 0.0. `failure_reason_counts` is a small, bounded count-by-reason map
    (never one entry per failed pair)."""
    successful_pair_count: int
    failed_pair_count: int
    estimation_success_rate: float
    median_translation_x: float | None
    median_translation_y: float | None
    median_translation_magnitude: float | None
    p95_translation_magnitude: float | None
    median_scale: float | None
    max_abs_scale_deviation_from_1: float | None
    median_rotation_deg: float | None
    max_abs_rotation_deg: float | None
    median_candidate_match_count: float | None
    median_ransac_inlier_count: float | None
    median_ransac_inlier_ratio: float | None
    failure_reason_counts: dict[str, int] | None
    # Stage 9 Phase C1 — additive; None whenever successful_pair_count == 0 (no successful pair
    # exists to compute dynamics from), never a fabricated 0/identity result. See
    # AffineDynamicsSummary's own docstring.
    dynamics: AffineDynamicsSummary | None = None


class PhaseCorrelationMotionEvidenceSummary(BaseModel):
    """Frequency-domain global-TRANSLATION-only evidence (cv2.phaseCorrelate), aggregated across
    the same frame pairs as AffineMotionEvidenceSummary — kept as a genuinely separate evidence
    stream, never averaged into one synthetic combined score (see visual_motion_svc.py's own
    docstring for why). `median_response`/`minimum_response` are the library's own real
    correlation-quality values, preserved verbatim."""
    median_dx: float
    median_dy: float
    median_translation_magnitude: float
    p95_translation_magnitude: float
    median_response: float
    minimum_response: float


class CrossStreamMotionEvidenceSummary(BaseModel):
    """Stage 9 Phase C1 — neutral, deterministic comparisons between the affine and phase-
    correlation evidence streams for the same Shot. NEVER an agreement/disagreement/trustworthy/
    usable/confidence judgment — see visual_motion_svc._cross_stream_evidence's own docstring.
    Every difference is affine value MINUS phase value, exactly as each field's own name states.
    `magnitude_ratio_affine_over_phase` is None when the phase denominator is exactly 0.0 — no
    epsilon substituted."""
    magnitude_absolute_difference: float
    magnitude_ratio_affine_over_phase: float | None
    signed_dx_difference_affine_minus_phase: float
    signed_dy_difference_affine_minus_phase: float


class GlobalMotionEvidenceSummary(BaseModel):
    """Stage 9 (Motion / Camera / Transitions / Animation), Phase A — MEASURED global-motion
    evidence for one Shot, derived entirely from the ORIGINAL reference-video source (never
    Stage-5 stills). Always `certainty="MEASURED"`; `confidence_score` is deliberately always
    None (no calibrated probability exists for a raw geometric measurement — same discipline as
    every other MEASURED evidence table in this project). This row NEVER classifies the shot as
    static/pan/tilt/zoom/rotating — see visual_motion_svc.py's own docstring: it answers only
    "what global geometric change was measured", never "was this a pan/tilt/zoom/static shot".
    Absent (no row) for a Shot too short to produce at least 2 analytical frames — never a
    fabricated zero-motion row for an unanalyzable shot."""
    model_config = {"from_attributes": True}

    id: int
    sampling_fps: float
    sample_count: int
    frame_pair_count: int
    affine: AffineMotionEvidenceSummary
    phase_correlation: PhaseCorrelationMotionEvidenceSummary
    # Stage 9 Phase C1 — additive; None whenever affine has zero successful pairs to compare
    # against phase evidence. See CrossStreamMotionEvidenceSummary's own docstring.
    cross_stream: CrossStreamMotionEvidenceSummary | None = None
    extraction_parameters: dict
    certainty: str
    confidence_score: float | None
    reasoning: str | None
    evidence_summary: str | None
    source: str | None
    produced_by_pass: str | None


class TransitionLuminanceSummary(BaseModel):
    """Stage 9 Phase B1 — neutral, threshold-free luminance measurements over one boundary
    candidate window. See transition_evidence_svc.py's own docstring for why no interpreted field
    (declining/rising/fade-like/plateau) exists here. `zero_delta_count` is EXACT numeric equality
    between consecutive samples only, never a "near-zero" tolerance band."""
    values: list[float]
    first_value: float
    last_value: float
    min: float
    max: float
    signed_total_change: float
    regression_slope: float
    positive_delta_count: int
    negative_delta_count: int
    zero_delta_count: int
    sign_change_count: int


class TransitionFrameDifferenceSummary(BaseModel):
    """Stage 9 Phase B1 — neutral frame-difference measurements (deterministic normalized
    mean-absolute-pixel-difference, the exact metric validated in Phase B0.3). No "elevated pair"
    concept and no run-length fields — deliberately omitted for this MVP (see
    transition_evidence_svc.py's own docstring)."""
    values: list[float]
    median: float
    max: float
    argmax_index: int


class TransitionAffinePairSummary(BaseModel):
    """One ORB+RANSAC-affine pair result, reused verbatim from visual_motion_svc._affine_pair — a
    failed estimate keeps its own explicit `reason` (insufficient_keypoints/insufficient_matches/
    affine_estimation_failed); every other field is None on failure, NEVER a fabricated
    translation=0/scale=1/rotation=0."""
    estimation_success: bool
    reason: str | None = None
    translation_x: float | None = None
    translation_y: float | None = None
    translation_magnitude: float | None = None
    scale: float | None = None
    rotation_deg: float | None = None
    candidate_match_count: int | None = None
    ransac_inlier_count: int | None = None
    ransac_inlier_ratio: float | None = None


class TransitionAffineEvidenceSummary(BaseModel):
    """Per-pair affine evidence for one boundary candidate window, kept PER PAIR (never collapsed
    into a single median the way Phase A's own global-motion evidence is) — see
    transition_evidence_svc.py's own docstring for why: transition identity depends on temporal
    shape, and a single failed/degenerate pair hidden inside an aggregate would erase exactly the
    evidence a future inference layer needs."""
    pairs: list[TransitionAffinePairSummary]
    successful_pair_count: int
    failed_pair_count: int
    failure_reason_counts: dict[str, int] | None = None


class TransitionPhaseCorrelationPairSummary(BaseModel):
    """One phase-correlation pair result, reused verbatim from visual_motion_svc._phase_correlation_
    pair — dx/dy/magnitude/response are always preserved, never erased or gated behind a general
    usability rule. `phase_quality_issue` is the ONE narrow, exact-value diagnostic Phase B1
    authorizes: "black_frame_zero_response" when an involved frame already meets the existing
    black-frame definition AND response is exactly 0.0 — never a generalized response threshold."""
    dx: float
    dy: float
    magnitude: float
    response: float
    phase_quality_issue: str | None = None


class TransitionPhaseCorrelationEvidenceSummary(BaseModel):
    """Per-pair phase-correlation evidence for one boundary candidate window — same "keep every
    pair, never collapse" reasoning as TransitionAffineEvidenceSummary."""
    pairs: list[TransitionPhaseCorrelationPairSummary]


class TransitionEvidenceSummary(BaseModel):
    """Stage 9 Phase B1 — one boundary-triggered MEASURED transition-evidence window (an
    AnalysisAnnotation row, category="transition_evidence"). `certainty` is always "MEASURED";
    `confidence_score` is always None. `shot_id` is always None for this MVP — a boundary-spanning
    window belongs to neither adjacent Shot alone; `preceding_shot_id`/`following_shot_id` record
    the real relationship instead (see this project's own B0.4A design correction for why a
    default-to-preceding-shot convention was explicitly rejected). NEVER contains a transition-type
    label (hard_cut/fade/dissolve/dip_to_black) or an interpreted shape field — see
    transition_evidence_svc.py's own docstring."""
    model_config = {"from_attributes": True}

    id: int
    boundary_timestamp: float
    window_start: float
    window_end: float
    preceding_shot_id: int | None
    following_shot_id: int | None
    sampling_fps: float
    sample_count: int
    frame_pair_count: int
    sample_timestamps: list[float]
    luminance: TransitionLuminanceSummary
    frame_difference: TransitionFrameDifferenceSummary
    black_frame_flags: list[bool]
    affine: TransitionAffineEvidenceSummary
    phase_correlation: TransitionPhaseCorrelationEvidenceSummary
    certainty: str
    confidence_score: float | None
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
    # Composition MVP Part A — deterministic, on-demand pairwise layout evidence between
    # visual_objects above that share the SAME source frame, never computed across frames.
    same_frame_layout_pairs: list[SameFrameLayoutPairSummary] = []
    # Composition MVP Part B — shot-level layout-drift evidence over the persistent_visual_elements
    # above; empty until the composition pass completes at least once, or when no C1 element
    # exists in this Shot.
    layout_stability: list[PersistentLayoutStabilitySummary] = []
    # Stage 9 Phase A — MEASURED global-motion evidence for this Shot, derived from the original
    # reference-video source; None until the global-motion pass completes at least once, or when
    # this Shot was too short to produce at least 2 analytical frames (never a fabricated
    # zero-motion row). No camera classification anywhere in this field.
    global_motion_evidence: GlobalMotionEvidenceSummary | None = None


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
    # Stage 9 Phase B1's boundary-triggered transition evidence — video-level (never nested under
    # a Shot; a transition genuinely spans TWO Shots, same reasoning as speech_segments above);
    # empty until that pass completes at least once, and empty (not an error) whenever the video
    # has zero shot boundaries (a single-shot video) or every boundary lacked enough material on
    # both sides to measure. No transition-type label anywhere in this list — see
    # TransitionEvidenceSummary's own docstring.
    transition_evidence: list[TransitionEvidenceSummary] = []
