"""Video Deconstructor — Stage 8 Composition MVP: visual_geometry_svc.py unit tests. Pure
input->output tests — no database, no router, matching the isolation this module's own docstring
establishes.

Covers the geometry-service checks from the Composition MVP's own test list: area (1), centroid
(2), center distance (3), all four edge distances (4), nearest edge (5), thirds placement
boundaries (6), IoU (7), bidirectional containment (8), area ratio (9), centroid displacement
(10), centroid-relative position (11), zero-area/invalid input behavior (12), normalized boundary
boxes (13).
"""
import pytest

from app.services.visual_geometry_svc import (
    Box, THIRD_BOUNDARY_HIGH, THIRD_BOUNDARY_LOW, area, area_ratio, centroid,
    centroid_displacement, centroid_relative_position, containment_ratios, distance_from_frame_center,
    edge_distances, horizontal_third, intersection_area, iou, largest_by_area, nearest_edge_distance,
    vertical_third,
)


# ---------------------------------------------------------------------------
# 1. Area
# ---------------------------------------------------------------------------

def test_area_basic():
    assert area(Box(0.1, 0.2, 0.3, 0.4)) == pytest.approx(0.12)


def test_area_full_frame_box_is_one():
    assert area(Box(0.0, 0.0, 1.0, 1.0)) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# 2. Centroid
# ---------------------------------------------------------------------------

def test_centroid_basic():
    assert centroid(Box(0.2, 0.4, 0.2, 0.2)) == pytest.approx((0.3, 0.5))


def test_centroid_of_full_frame_is_frame_center():
    assert centroid(Box(0.0, 0.0, 1.0, 1.0)) == pytest.approx((0.5, 0.5))


# ---------------------------------------------------------------------------
# 3. Distance from frame center
# ---------------------------------------------------------------------------

def test_distance_from_frame_center_is_zero_when_centered():
    assert distance_from_frame_center(Box(0.4, 0.4, 0.2, 0.2)) == pytest.approx(0.0)


def test_distance_from_frame_center_nonzero_when_offset():
    d = distance_from_frame_center(Box(0.0, 0.0, 0.2, 0.2))
    expected = ((0.1 - 0.5) ** 2 + (0.1 - 0.5) ** 2) ** 0.5
    assert d == pytest.approx(expected)


# ---------------------------------------------------------------------------
# 4. All four edge distances
# ---------------------------------------------------------------------------

def test_edge_distances_full_frame_all_zero():
    e = edge_distances(Box(0.0, 0.0, 1.0, 1.0))
    assert e == {"left": pytest.approx(0.0), "right": pytest.approx(0.0), "top": pytest.approx(0.0), "bottom": pytest.approx(0.0)}


def test_edge_distances_centered_box():
    e = edge_distances(Box(0.25, 0.25, 0.5, 0.5))
    assert e["left"] == pytest.approx(0.25)
    assert e["right"] == pytest.approx(0.25)
    assert e["top"] == pytest.approx(0.25)
    assert e["bottom"] == pytest.approx(0.25)


def test_edge_distances_offset_box():
    e = edge_distances(Box(0.0, 0.1, 0.2, 0.3))
    assert e["left"] == pytest.approx(0.0)
    assert e["right"] == pytest.approx(0.8)
    assert e["top"] == pytest.approx(0.1)
    assert e["bottom"] == pytest.approx(0.6)


# ---------------------------------------------------------------------------
# 5. Nearest edge
# ---------------------------------------------------------------------------

def test_nearest_edge_distance_picks_smallest():
    assert nearest_edge_distance(Box(0.0, 0.1, 0.2, 0.3)) == pytest.approx(0.0)  # left is 0.0


def test_nearest_edge_distance_centered_box_equal_all_sides():
    assert nearest_edge_distance(Box(0.25, 0.25, 0.5, 0.5)) == pytest.approx(0.25)


# ---------------------------------------------------------------------------
# 6. Thirds placement boundaries
# ---------------------------------------------------------------------------

def test_horizontal_third_boundaries():
    assert horizontal_third(Box(0.0, 0.0, 0.1, 0.1)) == "left"  # centroid_x=0.05 < 1/3
    assert horizontal_third(Box(0.45, 0.0, 0.1, 0.1)) == "center"  # centroid_x=0.5
    assert horizontal_third(Box(0.95, 0.0, 0.1, 0.1)) == "right"  # centroid_x=1.0 > 2/3


def test_vertical_third_boundaries():
    assert vertical_third(Box(0.0, 0.0, 0.1, 0.1)) == "top"
    assert vertical_third(Box(0.0, 0.45, 0.1, 0.1)) == "middle"
    assert vertical_third(Box(0.0, 0.95, 0.1, 0.1)) == "bottom"


def test_third_boundary_exact_values_documented():
    assert THIRD_BOUNDARY_LOW == pytest.approx(1 / 3)
    assert THIRD_BOUNDARY_HIGH == pytest.approx(2 / 3)


def test_horizontal_third_exactly_at_low_boundary_is_center():
    # centroid_x exactly == 1/3 -> not "< 1/3" -> falls into "center", not "left".
    box = Box(1 / 3 - 0.05, 0.0, 0.1, 0.1)
    assert horizontal_third(box) == "center"


# ---------------------------------------------------------------------------
# 7. IoU
# ---------------------------------------------------------------------------

def test_iou_identical_boxes_is_one():
    a = Box(0.1, 0.1, 0.3, 0.3)
    assert iou(a, a) == pytest.approx(1.0)


def test_iou_non_overlapping_boxes_is_zero():
    a = Box(0.0, 0.0, 0.1, 0.1)
    b = Box(0.5, 0.5, 0.1, 0.1)
    assert iou(a, b) == pytest.approx(0.0)


def test_iou_partial_overlap():
    a = Box(0.0, 0.0, 0.5, 0.5)
    b = Box(0.25, 0.25, 0.5, 0.5)
    # intersection = 0.25*0.25 = 0.0625; union = 0.25+0.25-0.0625 = 0.4375
    assert iou(a, b) == pytest.approx(0.0625 / 0.4375)


# ---------------------------------------------------------------------------
# 8. Bidirectional containment
# ---------------------------------------------------------------------------

def test_containment_ratios_full_containment_asymmetric():
    a = Box(0.0, 0.0, 1.0, 1.0)  # large
    b = Box(0.4, 0.4, 0.2, 0.2)  # fully inside a
    r = containment_ratios(a, b)
    assert r["intersection_over_a"] == pytest.approx(0.04)  # b's tiny area / a's full area
    assert r["intersection_over_b"] == pytest.approx(1.0)  # b is 100% inside a


def test_containment_ratios_partial_overlap_both_moderate():
    a = Box(0.0, 0.0, 0.5, 0.5)
    b = Box(0.25, 0.25, 0.5, 0.5)
    r = containment_ratios(a, b)
    assert r["intersection_over_a"] == pytest.approx(0.0625 / 0.25)
    assert r["intersection_over_b"] == pytest.approx(0.0625 / 0.25)


# ---------------------------------------------------------------------------
# 9. Area ratio
# ---------------------------------------------------------------------------

def test_area_ratio_equal_areas_is_one():
    a = Box(0.0, 0.0, 0.2, 0.2)
    b = Box(0.5, 0.5, 0.2, 0.2)
    assert area_ratio(a, b) == pytest.approx(1.0)


def test_area_ratio_different_areas():
    a = Box(0.0, 0.0, 0.4, 0.4)  # area 0.16
    b = Box(0.0, 0.0, 0.2, 0.2)  # area 0.04
    assert area_ratio(a, b) == pytest.approx(0.25)


# ---------------------------------------------------------------------------
# 10. Centroid displacement
# ---------------------------------------------------------------------------

def test_centroid_displacement_same_box_is_zero():
    a = Box(0.1, 0.1, 0.2, 0.2)
    assert centroid_displacement(a, a) == pytest.approx(0.0)


def test_centroid_displacement_known_value():
    a = Box(0.0, 0.0, 0.2, 0.2)  # centroid (0.1, 0.1)
    b = Box(0.3, 0.0, 0.2, 0.2)  # centroid (0.4, 0.1)
    assert centroid_displacement(a, b) == pytest.approx(0.3)


# ---------------------------------------------------------------------------
# 11. Centroid-relative position
# ---------------------------------------------------------------------------

def test_centroid_relative_position_above_and_left():
    a = Box(0.0, 0.0, 0.1, 0.1)  # centroid (0.05, 0.05)
    b = Box(0.5, 0.5, 0.1, 0.1)  # centroid (0.55, 0.55)
    rel = centroid_relative_position(a, b)
    assert rel == {"a_centroid_above_b": True, "a_centroid_below_b": False, "a_centroid_left_of_b": True, "a_centroid_right_of_b": False}


def test_centroid_relative_position_exact_tie_is_false_both_ways():
    a = Box(0.0, 0.0, 0.2, 0.2)
    b = Box(0.0, 0.0, 0.2, 0.2)  # identical centroid
    rel = centroid_relative_position(a, b)
    assert rel == {"a_centroid_above_b": False, "a_centroid_below_b": False, "a_centroid_left_of_b": False, "a_centroid_right_of_b": False}


# ---------------------------------------------------------------------------
# 12. Zero-area / invalid input behavior
# ---------------------------------------------------------------------------

def test_zero_area_box_does_not_crash_iou():
    a = Box(0.5, 0.5, 0.0, 0.0)
    b = Box(0.0, 0.0, 0.5, 0.5)
    assert iou(a, b) == pytest.approx(0.0)


def test_zero_area_box_does_not_crash_containment():
    a = Box(0.5, 0.5, 0.0, 0.0)
    b = Box(0.0, 0.0, 0.5, 0.5)
    r = containment_ratios(a, b)
    assert r["intersection_over_a"] == 0.0  # division-by-zero guarded, not an exception
    assert r["intersection_over_b"] == 0.0


def test_zero_area_box_does_not_crash_area_ratio():
    a = Box(0.5, 0.5, 0.0, 0.0)
    b = Box(0.5, 0.5, 0.0, 0.0)
    assert area_ratio(a, b) == 0.0  # both zero-area -> 0.0, not NaN or ZeroDivisionError


def test_largest_by_area_empty_input_returns_empty_list():
    assert largest_by_area({}) == []


def test_largest_by_area_tie_returns_all_tied_ids_sorted():
    boxes = {3: Box(0.0, 0.0, 0.2, 0.2), 1: Box(0.5, 0.5, 0.2, 0.2), 2: Box(0.0, 0.0, 0.1, 0.1)}
    assert largest_by_area(boxes) == [1, 3]  # both area 0.04, id 2 smaller (0.01) excluded


def test_largest_by_area_single_winner():
    boxes = {1: Box(0.0, 0.0, 0.1, 0.1), 2: Box(0.0, 0.0, 0.5, 0.5)}
    assert largest_by_area(boxes) == [2]


# ---------------------------------------------------------------------------
# 13. Normalized boundary boxes (0,0,0,0 and full-frame 0,0,1,1)
# ---------------------------------------------------------------------------

def test_zero_box_all_measurements_well_defined():
    z = Box(0.0, 0.0, 0.0, 0.0)
    assert area(z) == 0.0
    assert centroid(z) == (0.0, 0.0)
    assert nearest_edge_distance(z) == pytest.approx(0.0)
    assert horizontal_third(z) == "left"
    assert vertical_third(z) == "top"


def test_full_frame_box_all_measurements_well_defined():
    f = Box(0.0, 0.0, 1.0, 1.0)
    assert area(f) == pytest.approx(1.0)
    assert centroid(f) == pytest.approx((0.5, 0.5))
    assert distance_from_frame_center(f) == pytest.approx(0.0)
    assert nearest_edge_distance(f) == pytest.approx(0.0)
    assert horizontal_third(f) == "center"
    assert vertical_third(f) == "middle"


def test_intersection_area_direct():
    a = Box(0.0, 0.0, 0.5, 0.5)
    b = Box(0.25, 0.25, 0.5, 0.5)
    assert intersection_area(a, b) == pytest.approx(0.0625)
