"""Video Deconstructor — Stage 9 Phase C1: motion dynamics evidence unit tests. Pure
input->output tests — no database, no router, synthetic per-pair dicts only, matching the
isolation this module's own docstring establishes.

Covers: tx/ty/rotation sign-change counting (first-order, on the pair's OWN motion value —
never confused with a second-order delta-of-successive-values), exact-zero handling, failed-pair
run-continuity (no bridging across a failure), successful_run_count/longest_successful_run_pair_
count, standard deviation (including the None-below-2-pairs rule), range, insufficient-evidence
nulls distinguished from genuinely observed zeros, the four cross-stream comparison fields
(including null-on-zero-denominator), and confirmation every existing Phase-A field/behavior is
untouched by this additive extension.
"""
import numpy as np
import pytest

from app.services import visual_motion_svc
from app.services.visual_motion_svc import (
    MINIMUM_PAIRS_FOR_STANDARD_DEVIATION, _axis_dynamics, _cross_stream_evidence, _magnitude_dynamics,
    _scale_dynamics, _sign, _successful_runs, aggregate_motion_evidence,
)


def _success(tx=0.0, ty=0.0, rot=0.0, scale=1.0, mag=None):
    return {
        "estimation_success": True, "translation_x": tx, "translation_y": ty,
        "translation_magnitude": mag if mag is not None else (tx ** 2 + ty ** 2) ** 0.5,
        "scale": scale, "rotation_deg": rot,
        "candidate_match_count": 100, "ransac_inlier_count": 95, "ransac_inlier_ratio": 0.95,
    }


def _failure(reason="insufficient_keypoints"):
    return {"estimation_success": False, "reason": reason}


def _phase(dx=0.0, dy=0.0, response=0.9):
    return {"dx": dx, "dy": dy, "magnitude": (dx ** 2 + dy ** 2) ** 0.5, "response": response}


# ---------------------------------------------------------------------------
# _sign
# ---------------------------------------------------------------------------

def test_sign_exact_values():
    assert _sign(5.0) == 1
    assert _sign(-5.0) == -1
    assert _sign(0.0) == 0


# ---------------------------------------------------------------------------
# _successful_runs — contiguity / no bridging across a failure.
# ---------------------------------------------------------------------------

def test_successful_runs_single_unbroken_run():
    pairs = [_success(), _success(), _success()]
    assert _successful_runs(pairs) == [[0, 1, 2]]


def test_successful_runs_failure_breaks_into_two_runs():
    pairs = [_success(), _success(), _failure(), _success(), _success(), _success()]
    assert _successful_runs(pairs) == [[0, 1], [3, 4, 5]]


def test_successful_runs_all_failed_yields_no_runs():
    pairs = [_failure(), _failure()]
    assert _successful_runs(pairs) == []


def test_successful_runs_leading_and_trailing_failures():
    pairs = [_failure(), _success(), _success(), _failure()]
    assert _successful_runs(pairs) == [[1, 2]]


# ---------------------------------------------------------------------------
# tx/ty/rotation sign-change counting — the worked example from the spec itself.
# ---------------------------------------------------------------------------

def test_tx_sign_change_worked_example():
    # [-2, -1, +1, +2, -1] -> 2 sign changes, exactly the spec's own example.
    pairs = [_success(tx=v) for v in [-2.0, -1.0, 1.0, 2.0, -1.0]]
    successes = pairs
    runs = _successful_runs(pairs)
    success_by_index = dict(enumerate(pairs))
    result = _axis_dynamics("translation_x", successes, runs, success_by_index)
    assert result["sign_change_count"] == 2


def test_ty_sign_change_counting():
    pairs = [_success(ty=v) for v in [1.0, 1.0, -3.0, -3.0, 2.0]]
    # signs: +,+,-,-,+  -> two flips (+ -> -, - -> +)
    runs = _successful_runs(pairs)
    result = _axis_dynamics("translation_y", pairs, runs, dict(enumerate(pairs)))
    assert result["sign_change_count"] == 2


def test_rotation_sign_change_counting():
    pairs = [_success(rot=v) for v in [0.5, -0.5, 0.5]]
    # signs: +,-,+ -> two flips
    runs = _successful_runs(pairs)
    result = _axis_dynamics("rotation_deg", pairs, runs, dict(enumerate(pairs)))
    assert result["sign_change_count"] == 2


def test_exact_zero_neither_starts_nor_breaks_a_sign_comparison():
    # [-1, 0, +1] -- the zero sits between a negative and a positive run but participates in
    # neither comparison ((-1,0) and (0,+1) both involve a zero, so neither counts).
    pairs = [_success(tx=v) for v in [-1.0, 0.0, 1.0]]
    runs = _successful_runs(pairs)
    result = _axis_dynamics("translation_x", pairs, runs, dict(enumerate(pairs)))
    assert result["sign_change_count"] == 0
    assert result["zero_delta_count"] == 1
    assert result["positive_delta_count"] == 1
    assert result["negative_delta_count"] == 1


def test_no_bridging_across_a_failed_pair_for_sign_changes():
    # Without continuity awareness, [-1, +1] (indices 0 and 2, separated by a failure at index 1)
    # would look like one sign change if naively concatenated -- but since a failure breaks the
    # run, these two successful pairs are NEVER compared to each other.
    pairs = [_success(tx=-1.0), _failure(), _success(tx=1.0)]
    successes = [p for p in pairs if p["estimation_success"]]
    runs = _successful_runs(pairs)
    success_by_index = {i: p for i, p in enumerate(pairs) if p["estimation_success"]}
    result = _axis_dynamics("translation_x", successes, runs, success_by_index)
    assert runs == [[0], [2]]  # two separate length-1 runs, never merged
    assert result["sign_change_count"] == 0  # no comparison ever made across the break


def test_sign_changes_aggregate_across_multiple_runs_deterministically():
    # Run 1: [-1, +1] -> 1 change. Run 2 (after a failure): [+1, -1, +1] -> 2 changes. Total: 3.
    pairs = [
        _success(tx=-1.0), _success(tx=1.0), _failure(),
        _success(tx=1.0), _success(tx=-1.0), _success(tx=1.0),
    ]
    successes = [p for p in pairs if p["estimation_success"]]
    runs = _successful_runs(pairs)
    success_by_index = {i: p for i, p in enumerate(pairs) if p["estimation_success"]}
    result = _axis_dynamics("translation_x", successes, runs, success_by_index)
    assert runs == [[0, 1], [3, 4, 5]]
    assert result["sign_change_count"] == 3


# ---------------------------------------------------------------------------
# successful_run_count / longest_successful_run_pair_count (via full aggregate_motion_evidence).
# ---------------------------------------------------------------------------

def test_successful_run_count_and_longest_run_via_full_aggregate():
    affine_pairs = [
        _success(tx=1.0), _success(tx=1.0), _failure(),
        _success(tx=1.0), _success(tx=1.0), _success(tx=1.0), _success(tx=1.0),
    ]
    phase_pairs = [_phase() for _ in affine_pairs]
    result = aggregate_motion_evidence(phase_pairs, affine_pairs, sampling_fps=5.0, sample_count=8)
    dyn = result["affine"]["dynamics"]
    assert dyn["successful_run_count"] == 2
    assert dyn["longest_successful_run_pair_count"] == 4


# ---------------------------------------------------------------------------
# Standard deviation — the None-below-2-pairs rule; range.
# ---------------------------------------------------------------------------

def test_standard_deviation_none_for_single_successful_pair():
    pairs = [_success(tx=5.0)]
    result = _axis_dynamics("translation_x", pairs, _successful_runs(pairs), dict(enumerate(pairs)))
    assert result["standard_deviation"] is None
    assert result["median"] == 5.0
    assert result["min"] == 5.0
    assert result["max"] == 5.0
    assert result["range"] == 0.0  # a genuinely computed fact for n=1, not fabricated


def test_standard_deviation_computed_for_two_or_more_pairs():
    assert MINIMUM_PAIRS_FOR_STANDARD_DEVIATION == 2
    pairs = [_success(tx=v) for v in [1.0, 3.0]]
    result = _axis_dynamics("translation_x", pairs, _successful_runs(pairs), dict(enumerate(pairs)))
    assert result["standard_deviation"] == pytest.approx(np.std([1.0, 3.0], ddof=0))
    assert result["range"] == pytest.approx(2.0)


def test_scale_dynamics_no_sign_fields():
    pairs = [_success(scale=v) for v in [1.0, 1.1, 0.95]]
    result = _scale_dynamics(pairs)
    for forbidden in ("sign_change_count", "positive_delta_count", "negative_delta_count", "zero_delta_count"):
        assert forbidden not in result
    assert result["median"] == pytest.approx(1.0)
    assert result["range"] == pytest.approx(0.15)


def test_magnitude_dynamics_includes_p95_no_sign_fields():
    pairs = [_success(tx=v, ty=0.0, mag=v) for v in [1.0, 2.0, 3.0, 4.0, 5.0]]
    result = _magnitude_dynamics(pairs)
    assert "p95" in result
    for forbidden in ("sign_change_count", "positive_delta_count"):
        assert forbidden not in result
    assert result["median"] == pytest.approx(3.0)


# ---------------------------------------------------------------------------
# Insufficient evidence -> None, never a fabricated 0/identity.
# ---------------------------------------------------------------------------

def test_zero_successful_pairs_dynamics_is_none_not_fabricated():
    affine_pairs = [_failure(), _failure()]
    phase_pairs = [_phase(), _phase()]
    result = aggregate_motion_evidence(phase_pairs, affine_pairs, sampling_fps=5.0, sample_count=3)
    assert result["affine"]["dynamics"] is None
    assert result["cross_stream"] is None


def test_insufficient_temporal_samples_still_has_cross_stream_key_as_none():
    result = aggregate_motion_evidence([], [], sampling_fps=5.0, sample_count=1)
    assert result["insufficient_temporal_samples"] is True
    assert result["cross_stream"] is None


def test_observed_zero_distinguishable_from_unavailable():
    # A genuinely observed exact-zero delta among REAL successful pairs is reported as a real
    # count (not null) -- distinct from the None returned when there is no evidence at all.
    pairs = [_success(tx=0.0), _success(tx=0.0), _success(tx=1.0)]
    result = _axis_dynamics("translation_x", pairs, _successful_runs(pairs), dict(enumerate(pairs)))
    assert result["zero_delta_count"] == 2  # genuinely observed, not None
    # Contrast: zero successful pairs anywhere -> the whole dynamics block is None (tested above),
    # never a zero_delta_count of 0 masquerading as "no motion was observed".


# ---------------------------------------------------------------------------
# Cross-stream evidence.
# ---------------------------------------------------------------------------

def test_cross_stream_signed_differences_affine_minus_phase():
    affine_agg = {"median_translation_x": 5.0, "median_translation_y": -3.0, "median_translation_magnitude": 10.0}
    phase_agg = {"median_dx": 2.0, "median_dy": -1.0, "median_translation_magnitude": 4.0}
    result = _cross_stream_evidence(affine_agg, phase_agg)
    assert result["signed_dx_difference_affine_minus_phase"] == pytest.approx(3.0)
    assert result["signed_dy_difference_affine_minus_phase"] == pytest.approx(-2.0)
    assert result["magnitude_absolute_difference"] == pytest.approx(6.0)
    assert result["magnitude_ratio_affine_over_phase"] == pytest.approx(2.5)


def test_cross_stream_ratio_null_on_exact_zero_denominator():
    affine_agg = {"median_translation_x": 5.0, "median_translation_y": 0.0, "median_translation_magnitude": 5.0}
    phase_agg = {"median_dx": 0.0, "median_dy": 0.0, "median_translation_magnitude": 0.0}
    result = _cross_stream_evidence(affine_agg, phase_agg)
    assert result["magnitude_ratio_affine_over_phase"] is None
    assert result["magnitude_absolute_difference"] == pytest.approx(5.0)


def test_no_agreement_disagreement_trustworthy_usable_confidence_fields():
    affine_agg = {"median_translation_x": 1.0, "median_translation_y": 1.0, "median_translation_magnitude": 1.41}
    phase_agg = {"median_dx": 1.0, "median_dy": 1.0, "median_translation_magnitude": 1.41}
    result = _cross_stream_evidence(affine_agg, phase_agg)
    for forbidden in ("agreement", "disagreement", "trustworthy", "usable", "confidence"):
        assert forbidden not in result


# ---------------------------------------------------------------------------
# Existing Phase-A fields/behavior unchanged.
# ---------------------------------------------------------------------------

def test_existing_phase_a_aggregate_fields_unchanged():
    phase_pairs = [
        {"dx": 1.0, "dy": 2.0, "magnitude": (1.0 ** 2 + 2.0 ** 2) ** 0.5, "response": 0.9},
        {"dx": 2.0, "dy": 3.0, "magnitude": (2.0 ** 2 + 3.0 ** 2) ** 0.5, "response": 0.95},
        {"dx": 3.0, "dy": 1.0, "magnitude": (3.0 ** 2 + 1.0 ** 2) ** 0.5, "response": 0.5},
    ]
    affine_pairs = [
        {"estimation_success": True, "translation_x": 1.0, "translation_y": 1.0, "translation_magnitude": 1.41,
         "scale": 1.01, "rotation_deg": 0.5, "candidate_match_count": 100, "ransac_inlier_count": 95, "ransac_inlier_ratio": 0.95},
        {"estimation_success": True, "translation_x": 2.0, "translation_y": 2.0, "translation_magnitude": 2.83,
         "scale": 0.99, "rotation_deg": -0.5, "candidate_match_count": 110, "ransac_inlier_count": 100, "ransac_inlier_ratio": 0.909},
        {"estimation_success": False, "reason": "insufficient_matches"},
    ]
    result = aggregate_motion_evidence(phase_pairs, affine_pairs, sampling_fps=5.0, sample_count=4)
    # Every pre-existing Phase-A field, exactly as test_aggregation_known_values already asserts.
    assert result["insufficient_temporal_samples"] is False
    assert result["sample_count"] == 4
    assert result["frame_pair_count"] == 3
    assert result["affine"]["successful_pair_count"] == 2
    assert result["affine"]["failed_pair_count"] == 1
    assert result["affine"]["estimation_success_rate"] == pytest.approx(2 / 3)
    assert result["affine"]["median_translation_x"] == pytest.approx(1.5)
    assert result["affine"]["median_scale"] == pytest.approx(1.0)
    assert result["affine"]["failure_reason_counts"] == {"insufficient_matches": 1}
    assert result["phase_correlation"]["median_dx"] == pytest.approx(2.0)
    assert result["phase_correlation"]["minimum_response"] == pytest.approx(0.5)
    assert "motion_score" not in result
    assert "combined_score" not in result
    # New C1 fields present ADDITIVELY, alongside the unchanged existing ones.
    assert "dynamics" in result["affine"]
    assert "cross_stream" in result


def test_default_sampling_constants_unchanged():
    assert visual_motion_svc.DEFAULT_SAMPLING_FPS == 5.0
    assert visual_motion_svc.DEFAULT_ORB_NFEATURES == 500
    assert visual_motion_svc.DEFAULT_RATIO_TEST_THRESHOLD == 0.75
    assert visual_motion_svc.DEFAULT_RANSAC_REPROJECTION_THRESHOLD_PX == 3.0
    assert visual_motion_svc.MINIMUM_ANALYZABLE_FRAMES == 2


# ---------------------------------------------------------------------------
# No camera-motion classification labels anywhere in this module's own output.
# ---------------------------------------------------------------------------

def test_no_camera_motion_labels_anywhere_in_dynamics_output():
    affine_pairs = [_success(tx=1.0, ty=-1.0, rot=0.3, scale=1.05) for _ in range(3)]
    phase_pairs = [_phase(dx=1.0, dy=-1.0) for _ in range(3)]
    result = aggregate_motion_evidence(phase_pairs, affine_pairs, sampling_fps=5.0, sample_count=4)
    dumped = str(result).lower()
    for forbidden in ("static", "pan_left", "pan_right", "tilt_up", "tilt_down", "zoom_in", "zoom_out",
                       "rotation_clockwise", "rotation_counterclockwise", "handheld", "shake", "mixed",
                       "insufficient_evidence"):
        assert forbidden not in dumped
