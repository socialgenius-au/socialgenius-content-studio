"""Focused regression tests for C4 mechanism/scene mapping integrity.

No network or paid AI calls. Existing mismatch-as-quality-note policy remains unchanged.
"""
import copy

import pytest

from app.services.blueprint_reasoner import BlueprintReasoningError, validate_decision
from app.services.blueprint_reasoner.parsing import decision_from_payload
from tests.test_blueprint_reasoner import default_ctx, tile_payload


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda p: p["sections"][0]["mechanisms_applied"].append("M01"), "repeats a mechanism"),
        (lambda p: p["mechanism_dispositions"][0]["applied_in_sections"].append(1), "repeats a section"),
        (lambda p: p["mechanism_dispositions"][0]["applied_in_sections"].append(99), "nonexistent section"),
    ],
)
def test_invalid_mechanism_section_mappings_are_rejected(mutate, message):
    payload = copy.deepcopy(tile_payload())
    mutate(payload)
    decision = decision_from_payload(payload, prompt_version="v3")
    with pytest.raises(BlueprintReasoningError, match=message):
        validate_decision(decision, default_ctx())


def test_existing_valid_cross_business_blueprint_is_accepted():
    decision = decision_from_payload(tile_payload(), prompt_version="v3")
    validate_decision(decision, default_ctx())
