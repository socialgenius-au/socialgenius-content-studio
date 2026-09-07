"""Video Deconstructor — Stage 8 Composition MVP, Part B: visual_composition_svc.py unit tests.
Pure input->output — no database, no C1 re-derivation of any kind."""
import pytest

from app.services.visual_composition_svc import compute_layout_drift
from app.services.visual_geometry_svc import Box


def test_requires_at_least_two_members():
    with pytest.raises(ValueError):
        compute_layout_drift([Box(0.0, 0.0, 0.5, 0.5)])


def test_two_identical_boxes_zero_drift():
    a = Box(0.1, 0.1, 0.3, 0.3)
    result = compute_layout_drift([a, a])
    assert result["centroid_max_pairwise_displacement"] == pytest.approx(0.0)
    assert result["width_range"] == pytest.approx(0.0)
    assert result["height_range"] == pytest.approx(0.0)
    assert result["occupancy_range"] == pytest.approx(0.0)


def test_known_drift_values():
    boxes = [
        Box(0.0, 0.0, 0.20, 0.30),   # centroid (0.10, 0.15), area 0.060
        Box(0.02, 0.01, 0.24, 0.28),  # centroid (0.14, 0.15), area 0.0672
        Box(0.01, 0.03, 0.22, 0.32),  # centroid (0.12, 0.19), area 0.0704
    ]
    result = compute_layout_drift(boxes)
    assert result["width_min"] == pytest.approx(0.20)
    assert result["width_max"] == pytest.approx(0.24)
    assert result["width_range"] == pytest.approx(0.04)
    assert result["height_min"] == pytest.approx(0.28)
    assert result["height_max"] == pytest.approx(0.32)
    assert result["height_range"] == pytest.approx(0.04)
    assert result["occupancy_min"] == pytest.approx(0.06)
    assert result["occupancy_max"] == pytest.approx(0.0704)
    assert result["occupancy_range"] == pytest.approx(0.0104)
    # max pairwise centroid displacement is the worst-case pair, not an average
    import math
    d01 = math.dist((0.10, 0.15), (0.14, 0.15))
    d02 = math.dist((0.10, 0.15), (0.12, 0.19))
    d12 = math.dist((0.14, 0.15), (0.12, 0.19))
    assert result["centroid_max_pairwise_displacement"] == pytest.approx(max(d01, d02, d12))


def test_real_laptop_group_shot_141():
    # Real persisted geometry for VisualObject ids 69, 74, 79 (label='laptop', shot 141).
    boxes = [
        Box(0.0, 0.03943967819213867, 0.9934682846069336, 0.7553522851732042),
        Box(0.0, 0.05933819876776801, 0.9863601684570312, 0.7258580349109791),
        Box(0.0, 0.05982491705152723, 1.0, 0.7223975481810393),
    ]
    result = compute_layout_drift(boxes)
    assert result["centroid_max_pairwise_displacement"] == pytest.approx(0.0069, abs=0.001)
    assert result["width_min"] == pytest.approx(0.9864, abs=0.001)
    assert result["width_max"] == pytest.approx(1.0, abs=0.001)
    assert result["height_min"] == pytest.approx(0.7224, abs=0.001)
    assert result["height_max"] == pytest.approx(0.7554, abs=0.001)
    assert result["occupancy_min"] == pytest.approx(0.7160, abs=0.001)
    assert result["occupancy_max"] == pytest.approx(0.7504, abs=0.001)


def test_worst_case_pair_is_not_hidden_by_averaging():
    # Two members very close together, one far outlier -- the max-pairwise metric must reflect
    # the outlier, not an average that would mask it.
    a = Box(0.0, 0.0, 0.1, 0.1)   # centroid (0.05, 0.05)
    b = Box(0.01, 0.0, 0.1, 0.1)  # centroid (0.06, 0.05) -- very close to a
    c = Box(0.8, 0.0, 0.1, 0.1)   # centroid (0.85, 0.05) -- far outlier
    result = compute_layout_drift([a, b, c])
    assert result["centroid_max_pairwise_displacement"] == pytest.approx(0.80, abs=0.001)
