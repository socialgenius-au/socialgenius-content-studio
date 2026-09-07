"""Video Deconstructor — Stage 8 (Visual Objects / People / Products / Composition), Phase C1:
CONSERVATIVE SAME-SHOT NEAR-STATIC VISUAL PERSISTENCE.

Pure input -> output derivation over already-persisted Phase-B VisualObject evidence. Zero
SQLAlchemy/database/router knowledge, extending the exact isolation pattern already proven by
visual_object_svc.py (Phase A) and every other Deconstructor service — a peer, not a caller or
callee, of the other Stage 6/7/8 services. The caller (the router) fetches VisualObject rows for
one shot, builds the plain observation dicts this module expects, and persists whatever this
module returns; nothing here touches a database or knows about VideoAnalysis/ReferenceVideo.

WHAT PHASE C1 DOES NOT DO (deliberately, per the read-only Phase-C inspection this stage is
built from) — see that inspection's own findings for the real evidence behind each exclusion:

  1. NO same-frame competing-hypothesis consolidation. The real inspection found `laptop`'s own
     bounding box containing `keyboard`'s bounding box ~100% in one frame — genuinely DIFFERENT
     physical objects, not competing guesses about one region. A same-frame IoU/containment rule
     could not safely distinguish that case from the real `laptop`/`tv` competing-hypothesis case
     (also high containment) without more evidence than this module has. That problem is
     deliberately deferred to a later phase (C2+), never solved here.
  2. NO cross-label linkage. `laptop` and `tv` observations of what a human can tell is the same
     physical phone region are NEVER linked here, even at very high geometric overlap. This
     module requires EXACT native-label equality to link two observations — accepting a known,
     deliberate FALSE SPLIT of that one real physical object into two separate `laptop` and `tv`
     persistence claims, because a false split is safer than a manufactured semantic merge this
     module has no evidence to justify.
  3. NO person persistence of any kind. `category == "person"` observations are excluded from
     grouping entirely, unconditionally, regardless of how well their geometry might otherwise
     match this module's own thresholds. The real reference video demonstrates why: geometrically
     stable "person" boxes across a shot can be different people appearing in a phone screen's
     changing video content, not the same real individual. This module performs OBJECT
     persistence, never identity/face tracking, and never claims a person is the "same" person
     across observations.
  4. NO cross-shot linkage. A candidate persistence group's every member must share both
     video_analysis_id and shot_id (enforced by raising ValueError on mixed-shot input — see
     `derive_persistent_visual_elements`'s own docstring). Cross-shot persistence is deferred.
  5. NO fused/re-measured geometry. A persistence claim's own "representative" geometry is always
     one EXISTING member's own real, already-persisted bounding box — chosen, never averaged,
     never recomputed. See `_select_group` below for exactly which member and why.
  6. NO fabricated linkage confidence. `linkage_confidence` in every returned group is always
     `None` — there is no calibrated, defensible probability this module could honestly report
     for "these observations are the same physical object." The real geometric evidence (IoU and
     height-similarity of every member against the group's own reference) is preserved verbatim
     instead, so a reader can judge the evidence directly rather than trust a manufactured score.

ANTI-TRANSITIVE-CHAIN GROUPING (why this module does not do nearest-neighbor chaining): a naive
"link A to B if compatible, then B to C if compatible" chain can silently accept a final group
whose first and last members are NOT geometrically compatible with each other at all — a real
correctness risk this module was explicitly asked to avoid. Instead, every group has exactly ONE
reference observation (the label's own highest-confidence observation across the whole shot), and
EVERY other member is compared directly against that fixed reference, never against another
member. A candidate frame's own competing same-label observations (see the real `tv` duplicate in
one frame below) are resolved by picking whichever ONE of that frame's own same-label observations
best matches the reference (highest IoU) — so a persistence group can never contain more than one
observation from the same source frame, and same-frame duplicates never inflate observation_count,
member count, or time span. A rejected same-frame duplicate is not deleted or altered anywhere —
it remains its own fully intact, independently-queryable raw VisualObject row; only its candidacy
for THIS particular derived group is set aside.

THRESHOLDS — INITIAL BASELINES DERIVED FROM ONE REAL REFERENCE VIDEO, NOT UNIVERSAL VALIDATED
THRESHOLDS (see the Phase-C read-only inspection report for the full real pairwise-metric
evidence this baseline was derived from): the real same-label cross-frame positives observed were
IoU 0.829-0.982 and height-similarity 0.909-1.000, while the real closest cross-label false
candidate (the `laptop`/`tv` phone-region hypothesis) topped out at IoU 0.615 and height-similarity
0.612 — a real, comfortable separation in this one sample, not a claim that these numbers hold
for any other video. Width similarity was deliberately NOT used as a gate: in this real portrait-
format sample nearly every large detection spans most of the frame's width regardless of whether
it is a true match or a false one (0.964-1.000 across both), making it a non-discriminating signal
here. Centroid displacement is recorded as real evidence (see geometry_evidence) but is not a
third hard gate — IoU and height-similarity together already reproduce the exact conservative
result the real inspection called for; a third gate was not added speculatively.
"""
from dataclasses import dataclass

# INITIAL BASELINE FROM ONE REAL REFERENCE VIDEO — see this module's own docstring. Named,
# configurable constants (never buried as magic numbers in call sites), matching this project's
# own convention (see visual_object_svc.py's own DEFAULT_CONFIDENCE_THRESHOLD).
DEFAULT_IOU_THRESHOLD = 0.80
DEFAULT_HEIGHT_SIMILARITY_THRESHOLD = 0.85


def _area(obs: dict) -> float:
    return obs["width"] * obs["height"]


def _iou(a: dict, b: dict) -> float:
    """Standard 2D intersection-over-union on normalized [x, y, width, height] boxes."""
    ax0, ay0, aw, ah = a["x"], a["y"], a["width"], a["height"]
    bx0, by0, bw, bh = b["x"], b["y"], b["width"], b["height"]
    ax1, ay1 = ax0 + aw, ay0 + ah
    bx1, by1 = bx0 + bw, by0 + bh
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    union = _area(a) + _area(b) - inter
    return inter / union if union > 0 else 0.0


def _height_similarity(a: dict, b: dict) -> float:
    """min/max ratio of the two boxes' own heights — see this module's own docstring for why
    width similarity is deliberately not used as a gate in this sample."""
    ah, bh = a["height"], b["height"]
    if ah <= 0 or bh <= 0:
        return 0.0
    return min(ah, bh) / max(ah, bh)


def _centroid(obs: dict) -> tuple[float, float]:
    return obs["x"] + obs["width"] / 2, obs["y"] + obs["height"] / 2


def _centroid_displacement(a: dict, b: dict) -> float:
    ax, ay = _centroid(a)
    bx, by = _centroid(b)
    return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5


def _select_group(label: str, obs_list: list[dict], iou_threshold: float, height_similarity_threshold: float) -> dict | None:
    """One label's worth of same-shot observations in -> at most one persistence group out (or
    None if fewer than 2 distinct source frames survive). See this module's own docstring for the
    full reference-based, anti-transitive-chain reasoning."""
    distinct_frames = {o["source_frame_id"] for o in obs_list}
    if len(distinct_frames) < 2:
        return None  # a single frame can never establish persistence on its own

    # Representative/reference: the highest-confidence observation for this label across the
    # whole shot — an EXISTING member, never a fused/recomputed box. Ties broken by encounter
    # order (not expected to matter in practice with real float detector confidences).
    reference = max(obs_list, key=lambda o: o["confidence_score"] if o["confidence_score"] is not None else float("-inf"))

    by_frame: dict[int, list[dict]] = {}
    for o in obs_list:
        by_frame.setdefault(o["source_frame_id"], []).append(o)

    members = [reference]
    geometry_evidence = []
    for frame_id, frame_obs in by_frame.items():
        if frame_id == reference["source_frame_id"]:
            continue  # the reference itself already represents its own frame; any other
            # same-label detection in that same frame (e.g. the real duplicate "tv" case) is
            # never even considered for any frame slot, so it can never inflate this group.
        # Among this OTHER frame's own same-label candidates, pick whichever ONE best matches
        # the reference — never more than one observation per frame enters this group.
        best = max(frame_obs, key=lambda o: _iou(reference, o))
        iou_val = _iou(reference, best)
        hsim_val = _height_similarity(reference, best)
        if iou_val >= iou_threshold and hsim_val >= height_similarity_threshold:
            members.append(best)
            geometry_evidence.append({
                "visual_object_id": best["visual_object_id"],
                "source_frame_id": best["source_frame_id"],
                "iou_vs_reference": iou_val,
                "height_similarity_vs_reference": hsim_val,
                "centroid_displacement_vs_reference": _centroid_displacement(reference, best),
            })

    member_frames = {m["source_frame_id"] for m in members}
    if len(member_frames) < 2:
        return None  # the reference found no compatible cross-frame match — no persistence claim

    members_sorted = sorted(members, key=lambda o: o["timestamp"])
    return {
        "native_label": label,
        "member_visual_object_ids": [m["visual_object_id"] for m in members_sorted],
        "source_frame_ids": [m["source_frame_id"] for m in members_sorted],
        "observation_count": len(members_sorted),
        "start_time": min(m["timestamp"] for m in members_sorted),
        "end_time": max(m["timestamp"] for m in members_sorted),
        "representative_visual_object_id": reference["visual_object_id"],
        "representative_bbox": {"x": reference["x"], "y": reference["y"], "width": reference["width"], "height": reference["height"]},
        "detector_confidences": [
            {"visual_object_id": m["visual_object_id"], "confidence_score": m["confidence_score"]} for m in members_sorted
        ],
        "geometry_evidence": geometry_evidence,  # excludes the reference itself — nothing to compare it against
        # Deliberately None — see this module's own docstring point 6. Real geometric evidence
        # lives in geometry_evidence above instead of a fabricated pseudo-probability.
        "linkage_confidence": None,
        "iou_threshold_used": iou_threshold,
        "height_similarity_threshold_used": height_similarity_threshold,
    }


def derive_persistent_visual_elements(
    observations: list[dict],
    *,
    iou_threshold: float = DEFAULT_IOU_THRESHOLD,
    height_similarity_threshold: float = DEFAULT_HEIGHT_SIMILARITY_THRESHOLD,
) -> list[dict]:
    """Derives conservative same-shot, same-native-label, near-static, non-person persistent
    visual elements from a set of raw Phase-B VisualObject observations.

    Args:
        observations: one shot's worth of raw VisualObject evidence, each a dict with:
            visual_object_id (int), shot_id (int), source_frame_id (int), label (str, the
            detector's own native label), category (str, "person" or "object"),
            confidence_score (float | None), x/y/width/height (float, normalized geometry),
            timestamp (float, the source frame's own timestamp — VisualObject's start_time ==
            end_time, see Phase B). Every observation MUST belong to the same shot_id — this is
            enforced (see below), never silently assumed.
        iou_threshold / height_similarity_threshold: see this module's own docstring for the
            real-video baseline these default to, and why they are named/configurable rather than
            inlined at any call site.

    Returns a list of persistence-group dicts (see `_select_group`'s own return shape) — one per
    native label that produced at least 2 distinct compatible source frames in this shot. An empty
    list is a normal, valid, successful result when nothing in this shot qualifies (e.g. a
    single-frame shot, or a shot with no non-person label appearing more than once).

    Raises:
        ValueError: if `observations` spans more than one shot_id — a caller error (Phase C1's
            own hard "same shot only" rule; see this module's own docstring point 4), never
            silently ignored or partially processed.
    """
    if not observations:
        return []

    shot_ids = {o["shot_id"] for o in observations}
    if len(shot_ids) > 1:
        raise ValueError(f"derive_persistent_visual_elements received observations spanning multiple shots: {sorted(shot_ids)!r}")

    # Hard rule, not a convenience filter — see this module's own docstring point 3. Applied
    # unconditionally, regardless of how compatible a person observation's geometry might
    # otherwise look; Phase C1 performs object persistence, never identity/face tracking.
    candidates = [o for o in observations if o["category"] != "person"]

    by_label: dict[str, list[dict]] = {}
    for o in candidates:
        by_label.setdefault(o["label"], []).append(o)

    groups = []
    for label, obs_list in by_label.items():
        group = _select_group(label, obs_list, iou_threshold, height_similarity_threshold)
        if group is not None:
            groups.append(group)

    return sorted(groups, key=lambda g: g["native_label"])
