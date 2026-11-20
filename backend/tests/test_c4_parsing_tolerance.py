"""A lone section number in applied_in_sections is read as a one-item list; nothing else is loosened. Regression: reference 5131's third paid blueprint reply (saved as a fixture)."""
import json
from pathlib import Path

import pytest

from app.services.blueprint_reasoner.contract import BlueprintReasoningError
from app.services.blueprint_reasoner.parsing import decision_from_payload, parse_json_object
from tests.test_c4_generic_vocabulary import FX, ctx
from app.services.blueprint_reasoner.validation import validate_decision


def payload():
    return parse_json_object((FX / "rejected_reply_3_bare_integer.json").read_text(encoding="utf8"))


def test_the_fixture_really_has_the_bare_number():
    d = {x["mechanism_id"]: x for x in payload()["mechanism_dispositions"]}
    assert d["M03"]["applied_in_sections"] == 4 and d["M01"]["applied_in_sections"] == [1]


def test_the_refused_paid_reply_is_now_read_correctly_and_passes_every_guard():
    dec = decision_from_payload(payload(), reasoning_contract_version="test")
    assert {c.mechanism_id: c.applied_in_sections for c in dec.mechanism_choices} == {"M01": [1], "M02": [2, 3], "M03": [4]}
    validate_decision(dec, ctx())


@pytest.mark.parametrize("bad", ["4", [[4]], True, ["4"], 4.5, {"n": 4}])
def test_anything_other_than_a_lone_integer_or_a_list_of_integers_is_still_refused(bad):
    p = payload()
    for x in p["mechanism_dispositions"]:
        if x["mechanism_id"] == "M03":
            x["applied_in_sections"] = bad
    with pytest.raises(BlueprintReasoningError):
        decision_from_payload(p, reasoning_contract_version="test")
