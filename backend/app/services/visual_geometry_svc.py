"""Video Deconstructor — Stage 8 (Visual Objects / People / Products / Composition), Composition
MVP: reusable, deterministic, pure geometric measurements over already-persisted normalized
[x, y, width, height] boxes (VisualObject's own coordinate convention — see geometry.py's own
docstring: 0-1, resolution/aspect-ratio independent). Zero SQLAlchemy/database/router knowledge,
matching the isolation pattern already established by visual_object_svc.py (Phase A) and
visual_persistence_svc.py (Phase C1) — a peer of both, not a caller or callee of either.

Deliberately separate from app/models/geometry.py: that module holds SQL CHECK-constraint
strings for model/schema validation and stays focused on that; this module holds the actual
Python arithmetic, reusable anywhere a normalized box needs measuring (this file, C1's own
_iou/_centroid/_centroid_displacement helpers were NOT touched or generalized here — C1 remains
locked and untouched; this is new, independent code).

EVERYTHING HERE IS GEOMETRIC LAYOUT EVIDENCE, NEVER CREATIVE INTERPRETATION. A box's own centroid,
area, or which coordinate-space third it falls into are facts computable directly from numbers
already persisted by Phase B — this module adds no new detection, no new inference about WHAT a
region is, and no judgment about its creative/compositional importance. Every "third" boundary
below is a plain, explicit, documented coordinate-space partition (< 1/3, > 2/3, otherwise
middle) — a simple geometric convention, not an AI/aesthetic judgment. `largest_by_area` (see
below) reports only which existing box has the largest already-measured normalized area — see
this module's own real-video finding (a coarse, mislabeled "laptop" detection is consistently the
single largest box in every real frame) for exactly why this must never be read as "the important
one": it is reported as `largest_detected_region`, deliberately never as "dominant subject",
"primary subject", "focal point", or "hero" anything — those are semantic/creative judgments this
module's own pure geometry cannot honestly support.

Every function here is O(1) arithmetic on four numbers (or two boxes' worth) — genuinely trivial
to compute on demand from already-persisted VisualObject geometry. Nothing this module computes
is meant to be persisted; see visual_composition_svc.py's own docstring for the one narrow
exception (shot-level layout-DRIFT evidence across an already-existing C1 persistent group, which
this module's own pairwise/single-region functions are reused to compute).
"""
from dataclasses import dataclass

FRAME_CENTER = (0.5, 0.5)
# Simple geometric coordinate-space partition — NOT a composition/aesthetic judgment. A box whose
# own centroid falls below 1/3 is "the left/top third of the frame"; above 2/3 is "the right/
# bottom third"; otherwise "the center/middle third". Named/documented explicitly per this
# module's own docstring — never inlined as an unexplained magic number anywhere that uses it.
THIRD_BOUNDARY_LOW = 1 / 3
THIRD_BOUNDARY_HIGH = 2 / 3


@dataclass(frozen=True)
class Box:
    """One normalized [x, y, width, height] box — the same convention VisualObject's own columns
    already use. A thin, explicit wrapper (not a raw dict/tuple) so every function's own
    signature states exactly what it expects, matching this project's own preference for explicit
    field names over positional tuples wherever a shape is reused across many call sites."""
    x: float
    y: float
    width: float
    height: float


# ---------------------------------------------------------------------------
# Single-region measurements
# ---------------------------------------------------------------------------

def area(box: Box) -> float:
    """Normalized bbox area — also this box's own frame-occupancy FRACTION (0-1). A caller
    wanting a percentage multiplies by 100 at the response layer; this function's own semantics
    are the fraction, not a percentage, to avoid an ambiguous implicit unit."""
    return max(0.0, box.width) * max(0.0, box.height)


def centroid(box: Box) -> tuple[float, float]:
    """(centroid_x, centroid_y) — the geometric center of the box, in the same normalized 0-1
    space as x/y/width/height themselves."""
    return box.x + box.width / 2, box.y + box.height / 2


def distance_from_frame_center(box: Box) -> float:
    """Normalized Euclidean distance from this box's own centroid to the frame's own geometric
    center (0.5, 0.5) — 0.0 means centered exactly on the frame's own center point; never a claim
    about visual "centeredness" as a compositional judgment, only the raw distance number."""
    cx, cy = centroid(box)
    return ((cx - FRAME_CENTER[0]) ** 2 + (cy - FRAME_CENTER[1]) ** 2) ** 0.5


def edge_distances(box: Box) -> dict[str, float]:
    """Distance from each of the box's own four edges to the frame's own corresponding edge (all
    in normalized 0-1 units) — {"left", "right", "top", "bottom"}. A box flush against the
    frame's own left edge has left=0.0; a box occupying the full frame has all four at 0.0."""
    return {
        "left": box.x,
        "right": 1.0 - (box.x + box.width),
        "top": box.y,
        "bottom": 1.0 - (box.y + box.height),
    }


def nearest_edge_distance(box: Box) -> float:
    """The smallest of the box's own four edge_distances — how close this box comes to touching
    ANY frame edge, whichever edge that is."""
    return min(edge_distances(box).values())


def horizontal_third(box: Box) -> str:
    """"left" | "center" | "right" — a SIMPLE GEOMETRIC PARTITION of the box's own centroid_x
    into thirds (< 1/3 -> left, > 2/3 -> right, otherwise center). Not an AI/aesthetic judgment —
    see this module's own docstring."""
    cx, _ = centroid(box)
    if cx < THIRD_BOUNDARY_LOW:
        return "left"
    if cx > THIRD_BOUNDARY_HIGH:
        return "right"
    return "center"


def vertical_third(box: Box) -> str:
    """"top" | "middle" | "bottom" — same simple geometric partition as horizontal_third, applied
    to centroid_y."""
    _, cy = centroid(box)
    if cy < THIRD_BOUNDARY_LOW:
        return "top"
    if cy > THIRD_BOUNDARY_HIGH:
        return "bottom"
    return "middle"


# ---------------------------------------------------------------------------
# Pairwise measurements
# ---------------------------------------------------------------------------

def intersection_area(a: Box, b: Box) -> float:
    ax0, ay0, ax1, ay1 = a.x, a.y, a.x + a.width, a.y + a.height
    bx0, by0, bx1, by1 = b.x, b.y, b.x + b.width, b.y + b.height
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    return max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)


def iou(a: Box, b: Box) -> float:
    """Standard intersection-over-union. 0.0 for two zero-area or non-overlapping boxes (never a
    division error)."""
    inter = intersection_area(a, b)
    union = area(a) + area(b) - inter
    return inter / union if union > 0 else 0.0


def containment_ratios(a: Box, b: Box) -> dict[str, float]:
    """Bidirectional containment — {"intersection_over_a", "intersection_over_b"}. Deliberately
    TWO separate numbers, never one generic "containment" scalar: see the real-video evidence
    (Stage 8's own Phase-C/C2 read-only inspections) that "A contains B" (intersection_over_b close
    to 1.0) is different, real evidence from "A and B describe roughly the same extent"
    (both ratios comparably high) — collapsing these into one number would discard exactly the
    distinction this project's own prior evidence-gathering relied on."""
    inter = intersection_area(a, b)
    area_a, area_b = area(a), area(b)
    return {
        "intersection_over_a": inter / area_a if area_a > 0 else 0.0,
        "intersection_over_b": inter / area_b if area_b > 0 else 0.0,
    }


def area_ratio(a: Box, b: Box) -> float:
    """min(area)/max(area) — 1.0 for equal-area boxes, approaching 0.0 as their areas diverge.
    0.0 (not an error) when both boxes have zero area."""
    area_a, area_b = area(a), area(b)
    larger = max(area_a, area_b)
    return min(area_a, area_b) / larger if larger > 0 else 0.0


def centroid_displacement(a: Box, b: Box) -> float:
    """Normalized Euclidean distance between the two boxes' own centroids."""
    ax, ay = centroid(a)
    bx, by = centroid(b)
    return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5


def centroid_relative_position(a: Box, b: Box) -> dict[str, bool]:
    """Deliberately named so their mathematical meaning is explicit and cannot be misread as a
    claim about the real-world objects themselves: {"a_centroid_above_b", "a_centroid_below_b",
    "a_centroid_left_of_b", "a_centroid_right_of_b"} — every key names EXACTLY what is compared
    (the two boxes' own centroid coordinates), never "A is above B" (which would imply a claim
    about the physical/creative relationship between two real things, not two detector boxes).
    Ties (equal centroid coordinates on one axis) are False on both keys for that axis — no
    relationship is asserted when the numbers are exactly equal."""
    ax, ay = centroid(a)
    bx, by = centroid(b)
    return {
        "a_centroid_above_b": ay < by,
        "a_centroid_below_b": ay > by,
        "a_centroid_left_of_b": ax < bx,
        "a_centroid_right_of_b": ax > bx,
    }


def largest_by_area(boxes: dict[int, Box]) -> list[int]:
    """Given {id: Box}, returns the id(s) of the box/boxes with the largest normalized area —
    ALWAYS "largest_detected_region", NEVER "dominant"/"primary"/"focal"/"hero" anything (see
    this module's own docstring for the real-video evidence why). A list, not a single id: on an
    exact tie, every tied id is returned rather than an arbitrary, invented tie-break choosing one
    as more "important" than the others it is numerically equal to. Empty input returns an empty
    list, never an error."""
    if not boxes:
        return []
    areas = {bid: area(b) for bid, b in boxes.items()}
    max_area = max(areas.values())
    return sorted(bid for bid, a in areas.items() if a == max_area)
