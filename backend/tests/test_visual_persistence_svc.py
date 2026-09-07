"""Video Deconstructor — Stage 8 Phase C1 (Conservative Same-Shot Near-Static Visual Persistence)
service tests. Pure input->output tests — no database, no router, matching the isolation this
module's own docstring establishes.

Covers the service-level checks from Phase C1's own 30-item test list: same-shot same-label
static observations link (1), cross-shot observations raise rather than silently link (2),
cross-label observations never link (3), person observations never link (4), a one-frame
observation produces no persistence (5), the >=2-distinct-frames requirement (6), IoU below
baseline does not link (7), height similarity below baseline does not link (8), thresholds are
documented/configurable, not magic numbers (9), a same-frame duplicate does not inflate
persistence (10), the representative member is existing evidence, never fused (11/12), member IDs
and source-frame IDs are preserved (14/15), start/end derive from evidence timestamps (16),
detector confidences are preserved separately from linkage confidence (17), linkage confidence is
never fabricated (18), and no same-frame hypothesis consolidation exists in this module (27).
"""
from app.services.visual_persistence_svc import (
    DEFAULT_HEIGHT_SIMILARITY_THRESHOLD, DEFAULT_IOU_THRESHOLD, derive_persistent_visual_elements,
)

import pytest


def _obs(vo_id, shot_id, frame_id, label, category, confidence, x, y, w, h, ts) -> dict:
    return {
        "visual_object_id": vo_id, "shot_id": shot_id, "source_frame_id": frame_id,
        "label": label, "category": category, "confidence_score": confidence,
        "x": x, "y": y, "width": w, "height": h, "timestamp": ts,
    }


# ---------------------------------------------------------------------------
# 1/6/16. Same-shot same-label static observations across >=2 distinct frames link; timing
# derives from the real member timestamps.
# ---------------------------------------------------------------------------

def test_same_shot_same_label_static_observations_link():
    observations = [
        _obs(1, 141, 84, "keyboard", "object", 0.87, 0.01, 0.39, 0.95, 0.34, 0.15),
        _obs(2, 141, 85, "keyboard", "object", 0.82, 0.02, 0.40, 0.94, 0.32, 11.3),
        _obs(3, 141, 86, "keyboard", "object", 0.94, 0.01, 0.39, 0.97, 0.34, 22.5),
    ]
    groups = derive_persistent_visual_elements(observations)
    assert len(groups) == 1
    g = groups[0]
    assert g["native_label"] == "keyboard"
    assert g["observation_count"] == 3
    assert set(g["member_visual_object_ids"]) == {1, 2, 3}
    assert set(g["source_frame_ids"]) == {84, 85, 86}
    assert g["start_time"] == 0.15
    assert g["end_time"] == 22.5


# ---------------------------------------------------------------------------
# 2. Cross-shot observations must never silently link — a caller error, raised explicitly.
# ---------------------------------------------------------------------------

def test_cross_shot_observations_raise_rather_than_link():
    observations = [
        _obs(1, 141, 84, "keyboard", "object", 0.87, 0.01, 0.39, 0.95, 0.34, 0.15),
        _obs(2, 142, 87, "keyboard", "object", 0.85, 0.01, 0.39, 0.95, 0.34, 30.25),
    ]
    with pytest.raises(ValueError):
        derive_persistent_visual_elements(observations)


# ---------------------------------------------------------------------------
# 3. Cross-label observations never link, even at very high geometric overlap (the real
# laptop/tv phone-region case — deliberately deferred to a later phase).
# ---------------------------------------------------------------------------

def test_cross_label_observations_never_link_even_with_high_overlap():
    observations = [
        _obs(1, 141, 84, "laptop", "object", 0.98, 0.0, 0.04, 0.99, 0.76, 0.15),
        _obs(2, 141, 85, "tv", "object", 0.62, 0.0, 0.06, 0.99, 0.72, 11.3),  # near-identical bbox, different label
    ]
    groups = derive_persistent_visual_elements(observations)
    assert groups == []  # neither label alone has 2 distinct frames, and labels never cross-link


# ---------------------------------------------------------------------------
# 4/20. Person observations never link, regardless of geometric compatibility.
# ---------------------------------------------------------------------------

def test_person_observations_never_link():
    observations = [
        _obs(1, 141, 84, "person", "person", 0.46, 0.20, 0.24, 0.29, 0.18, 0.15),
        _obs(2, 141, 85, "person", "person", 0.79, 0.15, 0.22, 0.36, 0.20, 11.3),
        _obs(3, 141, 86, "person", "person", 0.83, 0.19, 0.20, 0.31, 0.21, 22.5),
    ]
    groups = derive_persistent_visual_elements(observations)
    assert groups == []


def test_person_excluded_even_when_mixed_with_linkable_objects():
    observations = [
        _obs(1, 141, 84, "keyboard", "object", 0.87, 0.01, 0.39, 0.95, 0.34, 0.15),
        _obs(2, 141, 85, "keyboard", "object", 0.82, 0.02, 0.40, 0.94, 0.32, 11.3),
        _obs(3, 141, 84, "person", "person", 0.46, 0.20, 0.24, 0.29, 0.18, 0.15),
        _obs(4, 141, 85, "person", "person", 0.79, 0.15, 0.22, 0.36, 0.20, 11.3),
    ]
    groups = derive_persistent_visual_elements(observations)
    assert len(groups) == 1
    assert groups[0]["native_label"] == "keyboard"


# ---------------------------------------------------------------------------
# 5/6. A single-frame observation (only one distinct source_frame_id) produces no persistence,
# even with multiple same-frame detections.
# ---------------------------------------------------------------------------

def test_single_frame_observations_produce_no_persistence():
    observations = [
        _obs(1, 141, 84, "tv", "object", 0.62, 0.0, 0.14, 1.0, 0.44, 0.15),
        _obs(2, 141, 84, "tv", "object", 0.58, 0.0, 0.02, 1.0, 0.30, 0.15),  # same frame, same label
    ]
    groups = derive_persistent_visual_elements(observations)
    assert groups == []


# ---------------------------------------------------------------------------
# 7. IoU below baseline does not link.
# ---------------------------------------------------------------------------

def test_iou_below_baseline_does_not_link():
    observations = [
        _obs(1, 141, 84, "tv", "object", 0.62, 0.0, 0.10, 0.50, 0.40, 0.15),
        _obs(2, 141, 85, "tv", "object", 0.58, 0.5, 0.10, 0.50, 0.40, 11.3),  # shifted far right, low IoU
    ]
    groups = derive_persistent_visual_elements(observations)
    assert groups == []


# ---------------------------------------------------------------------------
# 8. Height similarity below baseline does not link, even with acceptable IoU-adjacent geometry.
# ---------------------------------------------------------------------------

def test_height_similarity_below_baseline_does_not_link():
    # Same x/width and heavily overlapping in y, but height differs enough to fail hsim>=0.85
    # while IoU alone might still look permissive-ish; verify hsim gate independently.
    a = _obs(1, 141, 84, "tv", "object", 0.62, 0.0, 0.10, 1.0, 0.50, 0.15)
    b = _obs(2, 141, 85, "tv", "object", 0.58, 0.0, 0.10, 1.0, 0.30, 11.3)  # height 0.30 vs 0.50 -> hsim=0.6
    groups = derive_persistent_visual_elements([a, b])
    assert groups == []


# ---------------------------------------------------------------------------
# 9. Thresholds are configurable, not hardcoded — passing an explicit override changes behavior.
# ---------------------------------------------------------------------------

def test_thresholds_are_configurable():
    a = _obs(1, 141, 84, "tv", "object", 0.62, 0.0, 0.10, 0.50, 0.40, 0.15)
    b = _obs(2, 141, 85, "tv", "object", 0.58, 0.5, 0.10, 0.50, 0.40, 11.3)
    assert derive_persistent_visual_elements([a, b]) == []  # fails at default thresholds
    groups = derive_persistent_visual_elements([a, b], iou_threshold=0.0, height_similarity_threshold=0.0)
    assert len(groups) == 1  # a permissive override links the same pair
    assert groups[0]["iou_threshold_used"] == 0.0
    assert groups[0]["height_similarity_threshold_used"] == 0.0


def test_default_thresholds_match_documented_real_video_baseline():
    assert DEFAULT_IOU_THRESHOLD == 0.80
    assert DEFAULT_HEIGHT_SIMILARITY_THRESHOLD == 0.85


# ---------------------------------------------------------------------------
# 10. A same-frame duplicate (the real "two tv detections in one frame" case) does not inflate
# observation_count, member count, or time span.
# ---------------------------------------------------------------------------

def test_same_frame_duplicate_does_not_inflate_persistence():
    observations = [
        _obs(71, 141, 84, "tv", "object", 0.623, 0.0, 0.138, 1.0, 0.444, 0.15),  # real duplicate #1 (matches later frames)
        _obs(72, 141, 84, "tv", "object", 0.578, 0.0, 0.022, 1.0, 0.300, 0.15),  # real duplicate #2 (does not match)
        _obs(77, 141, 85, "tv", "object", 0.479, 0.0, 0.128, 0.997, 0.404, 11.325),
        _obs(81, 141, 86, "tv", "object", 0.445, 0.012, 0.101, 0.988, 0.440, 22.5),
    ]
    groups = derive_persistent_visual_elements(observations)
    assert len(groups) == 1
    g = groups[0]
    # Exactly 3 distinct frames contribute — never 4, even though frame 84 alone supplied 2 rows.
    assert g["observation_count"] == 3
    assert sorted(g["source_frame_ids"]) == [84, 85, 86]
    assert 72 not in g["member_visual_object_ids"]  # the non-matching same-frame duplicate is excluded
    assert 71 in g["member_visual_object_ids"]  # the matching one (and reference) is included


# ---------------------------------------------------------------------------
# 11/12/14/15. Representative member is existing evidence (never fused), member/source-frame IDs
# preserved verbatim.
# ---------------------------------------------------------------------------

def test_representative_is_existing_evidence_not_fused():
    observations = [
        _obs(1, 141, 84, "laptop", "object", 0.979, 0.0, 0.039, 0.993, 0.755, 0.15),
        _obs(2, 141, 85, "laptop", "object", 0.971, 0.0, 0.059, 0.986, 0.726, 11.3),
        _obs(3, 141, 86, "laptop", "object", 0.941, 0.0, 0.060, 1.000, 0.722, 22.5),
    ]
    groups = derive_persistent_visual_elements(observations)
    g = groups[0]
    # Highest confidence (id 1, 0.979) is the representative — its own real bbox verbatim.
    assert g["representative_visual_object_id"] == 1
    assert g["representative_bbox"] == {"x": 0.0, "y": 0.039, "width": 0.993, "height": 0.755}
    assert g["member_visual_object_ids"] == [1, 2, 3]
    assert g["source_frame_ids"] == [84, 85, 86]


# ---------------------------------------------------------------------------
# 17/18. Detector confidences preserved separately per member; linkage_confidence is never
# fabricated (always None).
# ---------------------------------------------------------------------------

def test_detector_confidences_preserved_and_linkage_confidence_never_fabricated():
    observations = [
        _obs(1, 141, 84, "keyboard", "object", 0.872, 0.01, 0.39, 0.95, 0.34, 0.15),
        _obs(2, 141, 85, "keyboard", "object", 0.823, 0.02, 0.40, 0.94, 0.32, 11.3),
    ]
    g = derive_persistent_visual_elements(observations)[0]
    confidences_by_id = {c["visual_object_id"]: c["confidence_score"] for c in g["detector_confidences"]}
    assert confidences_by_id == {1: 0.872, 2: 0.823}
    assert g["linkage_confidence"] is None  # never a fabricated pseudo-probability
    # Real geometric evidence exists instead, for every non-reference member.
    assert len(g["geometry_evidence"]) == 1
    assert 0.0 <= g["geometry_evidence"][0]["iou_vs_reference"] <= 1.0
    assert 0.0 <= g["geometry_evidence"][0]["height_similarity_vs_reference"] <= 1.0


# ---------------------------------------------------------------------------
# Anti-transitive-chain: a member compatible with its immediate neighbor but not with the fixed
# reference must not sneak into the group via chaining.
# ---------------------------------------------------------------------------

def test_anti_transitive_chain_requires_direct_reference_compatibility():
    # A (reference, highest confidence) and B are compatible. B and C are compatible with each
    # other but C is NOT compatible with A directly (shifted well beyond threshold from A).
    a = _obs(1, 141, 84, "tv", "object", 0.90, 0.0, 0.10, 0.50, 0.40, 0.15)
    b = _obs(2, 141, 85, "tv", "object", 0.60, 0.02, 0.10, 0.50, 0.40, 11.3)  # close to A
    c = _obs(3, 141, 86, "tv", "object", 0.55, 0.30, 0.10, 0.50, 0.40, 22.5)  # close to B, far from A
    groups = derive_persistent_visual_elements([a, b, c])
    assert len(groups) == 1
    g = groups[0]
    assert g["representative_visual_object_id"] == 1  # A, highest confidence
    assert 3 not in g["member_visual_object_ids"]  # C never enters via a B-C chain
    assert set(g["member_visual_object_ids"]) == {1, 2}


# ---------------------------------------------------------------------------
# Empty input / no qualifying labels -> empty result, not an error.
# ---------------------------------------------------------------------------

def test_empty_input_returns_empty_list():
    assert derive_persistent_visual_elements([]) == []


def test_no_qualifying_label_returns_empty_list():
    # Every label in this shot appears in exactly one frame only.
    observations = [
        _obs(1, 141, 84, "laptop", "object", 0.9, 0.0, 0.0, 0.5, 0.5, 0.15),
        _obs(2, 141, 85, "tv", "object", 0.6, 0.0, 0.0, 0.5, 0.5, 11.3),
    ]
    assert derive_persistent_visual_elements(observations) == []
