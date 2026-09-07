"""Video Deconstructor — Stage 8 (Visual Objects / People / Products / Composition), Composition
MVP, Part B: shot-level LAYOUT-DRIFT evidence over an already-existing Stage-8-Phase-C1
`persistent_visual_element` annotation's own member VisualObject rows.

Pure input (a list of already-persisted member geometries) -> output (a plain drift-evidence dict)
function — zero SQLAlchemy/database/router knowledge, matching visual_geometry_svc.py's own
isolation (this module is built entirely on top of that one's reusable single-region
measurements; it adds no new geometry math of its own).

CRITICAL SCOPE BOUNDARY — this module does NOT re-derive persistence: it consumes a persistence
grouping C1 (visual_persistence_svc.py, LOCKED) has already established, and ONLY measures how
much that already-inferred group's own member geometry drifts across its member observations. It
never independently re-groups VisualObject rows, never applies a new same-shot/same-label/person-
exclusion rule of its own (all of that is C1's own job, already done), and never introduces a new
"near-static" classification threshold — see this module's own docstring point on that below.

Every metric here has an unambiguous mathematical definition, not an ambiguous "spread"/"range"
description:
  - `centroid_max_pairwise_displacement`: the LARGEST centroid_displacement (see
    visual_geometry_svc.centroid_displacement) between any two members — a single worst-case
    number, not an average, so a single outlier member is never hidden by averaging.
  - `width_min`/`width_max`/`width_range` (= max - min), and the same trio for `height` and
    `occupancy` (occupancy = normalized bbox area, see visual_geometry_svc.area — the SAME
    quantity Phase B's own response already exposes per-detection, not a new concept).

NO NEW "NEAR-STATIC" THRESHOLD: C1 already qualified this group as a persistent element using its
own approved criteria (IoU >= 0.80, height-similarity >= 0.85 against a fixed reference — see
visual_persistence_svc.py's own docstring). This module does not invent a second, independent
threshold to re-classify "near-static" from these drift numbers — it reports the real drift
evidence and lets a reader (or a future stage) judge stability from the actual numbers, with
`reasoning` explicitly noting that the underlying group ALREADY met C1's own persistence
criteria — this classification is inherited, not created here."""
from app.services.visual_geometry_svc import Box, area, centroid_displacement


def compute_layout_drift(member_boxes: list[Box]) -> dict:
    """Args:
        member_boxes: one C1 persistent element's own member VisualObject geometries, in any
            order — this function makes no assumption about which member is the group's own
            "representative" (that concept belongs to C1's own persistence record, not to this
            drift measurement, which treats every member symmetrically).

    Returns:
        {
            "centroid_max_pairwise_displacement": float,
            "width_min": float, "width_max": float, "width_range": float,
            "height_min": float, "height_max": float, "height_range": float,
            "occupancy_min": float, "occupancy_max": float, "occupancy_range": float,
        }

    Raises:
        ValueError: if fewer than 2 member boxes are given — drift is undefined for a single
            observation (mirrors C1's own >=2-distinct-frame persistence requirement; a caller
            should never invoke this on a C1 group that didn't already satisfy that, but this is
            still an explicit, honest error rather than a silently fabricated zero-drift result).
    """
    if len(member_boxes) < 2:
        raise ValueError(f"compute_layout_drift requires >=2 member boxes, got {len(member_boxes)}")

    max_disp = 0.0
    for i in range(len(member_boxes)):
        for j in range(i + 1, len(member_boxes)):
            d = centroid_displacement(member_boxes[i], member_boxes[j])
            if d > max_disp:
                max_disp = d

    widths = [b.width for b in member_boxes]
    heights = [b.height for b in member_boxes]
    occupancies = [area(b) for b in member_boxes]

    return {
        "centroid_max_pairwise_displacement": max_disp,
        "width_min": min(widths), "width_max": max(widths), "width_range": max(widths) - min(widths),
        "height_min": min(heights), "height_max": max(heights), "height_range": max(heights) - min(heights),
        "occupancy_min": min(occupancies), "occupancy_max": max(occupancies),
        "occupancy_range": max(occupancies) - min(occupancies),
    }
