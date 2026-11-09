"""Recovery of an already-paid blueprint reply (reference 5131, ledger row 36). Pure behaviour here; persistence in test_c4_recovery_persist.py. No AI call, no database writes to the ledger."""
import copy
import hashlib
import json
from pathlib import Path

import pytest

from app.services.blueprint_reasoner import recovery
from app.services.blueprint_reasoner.contract import BlueprintReasoningError
from app.services.blueprint_reasoner.recovery import recover_stored_reply
from tests.test_c4_generic_vocabulary import FX, ctx

RAW = (FX / "rejected_reply_3_bare_integer.json").read_text(encoding="utf8")
LEDGER = {"id": 36, "status": "invalid_output", "request_hash": "abc", "provider": "anthropic", "model": "claude-sonnet-5"}


def raw_with(mutator):
    p = json.loads(RAW[RAW.index("{"): RAW.rindex("}") + 1])
    mutator(p)
    return json.dumps(p, ensure_ascii=False)


def m03(p):
    return next(d for d in p["mechanism_dispositions"] if d["mechanism_id"] == "M03")


def test_the_stored_reply_is_recovered_with_a_complete_audit_record():
    result, audit = recover_stored_reply(RAW, ctx(), ledger=LEDGER)
    assert {c.mechanism_id: c.applied_in_sections for c in result.decision.mechanism_choices} == {"M01": [1], "M02": [2, 3], "M03": [4]}
    assert [s.section_number for s in result.decision.sections] == [1, 2, 3, 4]
    assert (result.provider, result.model) == ("anthropic", "claude-sonnet-5")
    assert audit["ledger_id"] == 36 and audit["ledger_status_at_recovery"] == "invalid_output" and audit["request_hash"] == "abc"
    assert audit["raw_reply_sha256"] == hashlib.sha256(RAW.encode("utf-8")).hexdigest() and audit["raw_reply_chars"] == len(RAW)
    assert audit["normalisations"] == [{"mechanism_id": "M03", "field": "applied_in_sections", "original": 4, "normalised": [4], "rule": "a lone section number is read as a one-item list"}]
    assert audit["new_provider_calls"] == 0 and audit["ledger_modified"] is False and "validate_decision" in audit["checks_rerun"]


def test_a_reply_that_needed_no_normalisation_records_none():
    _, audit = recover_stored_reply(raw_with(lambda p: m03(p).update(applied_in_sections=[4])), ctx(), ledger=LEDGER)
    assert audit["normalisations"] == []


def test_recovery_is_deterministic():
    a = recover_stored_reply(RAW, ctx(), ledger=LEDGER)
    b = recover_stored_reply(RAW, ctx(), ledger=LEDGER)
    assert a[0].decision == b[0].decision and {k: v for k, v in a[1].items() if k != "recovered_at"} == {k: v for k, v in b[1].items() if k != "recovered_at"}


# ── only valid section numbers are accepted ──
@pytest.mark.parametrize("bad", [9, 0, -1, 5, [4, 9], [0], [-2, 4], [1, 2, 3, 4, 5]])
def test_out_of_range_or_non_positive_section_numbers_are_refused(bad):
    with pytest.raises(BlueprintReasoningError):
        recover_stored_reply(raw_with(lambda p: m03(p).update(applied_in_sections=bad)), ctx(), ledger=LEDGER)


@pytest.mark.parametrize("bad", ["4", ["4"], [[4]], True, [True], 4.0, 4.5, {"n": 4}, None, []])
def test_strings_booleans_floats_nested_lists_and_other_shapes_are_refused(bad):
    with pytest.raises(BlueprintReasoningError):
        recover_stored_reply(raw_with(lambda p: m03(p).update(applied_in_sections=bad)), ctx(), ledger=LEDGER)


@pytest.mark.parametrize("breakage", [
    lambda p: p.update(mechanism_dispositions="M01"),
    lambda p: p.update(mechanism_dispositions=[]),
    lambda p: p.update(sections=[]),
    lambda p: p.pop("sections"),
    lambda p: p.update(sections="x"),
])
def test_malformed_structures_are_refused(breakage):
    with pytest.raises(BlueprintReasoningError):
        recover_stored_reply(raw_with(breakage), ctx(), ledger=LEDGER)


def test_text_that_is_not_a_json_object_is_refused():
    for bad in ("", "no json here", "[1, 2, 3]", "{ broken"):
        with pytest.raises(BlueprintReasoningError):
            recover_stored_reply(bad, ctx(), ledger=LEDGER)


# ── every existing C4 safety check is re-run ──
def test_a_distinctive_source_term_is_still_refused_after_normalisation():
    with pytest.raises(BlueprintReasoningError, match="source-specific"):
        recover_stored_reply(raw_with(lambda p: p["sections"][0].update(speech_direction="A calm voice-over over the ginger paste.")), ctx(), ledger=LEDGER)


def test_a_prohibited_claim_is_still_refused_after_normalisation():
    with pytest.raises(BlueprintReasoningError):
        recover_stored_reply(raw_with(lambda p: p["sections"][3].update(cta_direction="Promise guaranteed sales for every business that joins.")), ctx(), ledger=LEDGER)


def test_copying_whole_source_wording_is_still_refused_after_normalisation():
    anatomy = json.loads((FX / "anatomy.json").read_text(encoding="utf8"))
    line = next(t["text"] for s in anatomy["sections"] for t in s.get("on_screen_text", []) if len((t.get("text") or "").split()) >= 1)
    # the OCR artefacts / brand text are blocked words; embedding one must fail
    with pytest.raises(BlueprintReasoningError):
        recover_stored_reply(raw_with(lambda p: p["sections"][1].update(text_direction=f"Show the label {line} and the word Waites.")), ctx(), ledger=LEDGER)


# ── the ledger is never touched ──
def test_the_recovery_module_cannot_write_to_the_ledger_it_does_no_database_work_at_all():
    src = Path(recovery.__file__).read_text(encoding="utf8")
    for forbidden in ("sqlalchemy", "AsyncSession", "ai_call_ledger.", "UPDATE", "DELETE", "INSERT", "session_factory", "metered_create"):
        assert forbidden not in src.replace("source\": \"ai_call_ledger\"", ""), forbidden
