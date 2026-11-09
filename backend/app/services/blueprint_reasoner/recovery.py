"""Deterministic, auditable recovery of ALREADY-PAID blueprint replies (M6, reference 5131).

A paid reply sits in the AI spending ledger. If it was refused only because of a FORMAT slip that can be corrected without guessing (a lone section number `4` where a list `[4]` is required), it can be
re-read here without another paid request. Rules, all asserted by tests:
  * The ledger is READ ONLY. Its stored reply (and its status) are never edited, deleted or re-labelled; the audit trail lives on the saved blueprint instead.
  * The only normalisation is a lone integer -> one-item list for `applied_in_sections`; every applied change is listed in the audit record. Strings, booleans, floats, nested lists and other shapes are refused.
  * Every section number named must be a positive whole number that is one of the plan's own section numbers (out-of-range numbers are refused, unlike the paid path where a mismatch is only a quality note).
  * Every existing C4 safety check (`validate_decision`: source-term, source-copy, claims, prohibited elements, structure ...) is re-run in full after normalisation. Nothing is saved unless all of them pass.
  * No AI provider is called and no spend switch is needed.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from app.services.blueprint_reasoner.contract import BlueprintReasoningError
from app.services.blueprint_reasoner.parsing import decision_from_payload, parse_json_object
from app.services.blueprint_reasoner.providers.anthropic_provider import BLUEPRINT_PROMPT_VERSION
from app.services.blueprint_reasoner.router import BlueprintResult
from app.services.blueprint_reasoner.validation import validate_decision

__all__ = ["recover_stored_reply", "RECOVERY_VERSION"]

RECOVERY_VERSION = "rec-v1"


def _is_whole_number(n) -> bool:
    return isinstance(n, int) and not isinstance(n, bool)


def _normalisations(payload: dict) -> list[dict]:
    out = []
    for d in payload.get("mechanism_dispositions") or []:
        if isinstance(d, dict) and _is_whole_number(d.get("applied_in_sections")):
            out.append({"mechanism_id": d.get("mechanism_id"), "field": "applied_in_sections", "original": d["applied_in_sections"], "normalised": [d["applied_in_sections"]],
                        "rule": "a lone section number is read as a one-item list"})
    return out


def _check_section_numbers(decision) -> None:
    valid = {s.section_number for s in decision.sections}
    for c in decision.mechanism_choices:
        for n in c.applied_in_sections:
            if not _is_whole_number(n) or n < 1 or n not in valid:
                raise BlueprintReasoningError(f"{c.mechanism_id}: applied_in_sections names section {n!r}, which is not one of this plan's sections {sorted(valid)}. A recovered reply must name only real sections.")


def recover_stored_reply(raw_text: str, ctx, *, ledger: dict) -> tuple[BlueprintResult, dict]:
    """`raw_text` is the model's text from a ledger row; `ledger` carries {id, status, model, provider, request_hash}. Returns (result, audit) or raises BlueprintReasoningError. Pure: no I/O."""
    payload = parse_json_object(raw_text)
    applied = _normalisations(payload)
    decision = decision_from_payload(payload, reasoning_contract_version=BLUEPRINT_PROMPT_VERSION)
    _check_section_numbers(decision)
    validate_decision(decision, ctx)                      # the whole existing C4 safety suite, unchanged
    audit = {
        "source": "ai_call_ledger", "ledger_id": ledger.get("id"), "ledger_status_at_recovery": ledger.get("status"), "request_hash": ledger.get("request_hash"),
        "raw_reply_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest(), "raw_reply_chars": len(raw_text),
        "normalisations": applied, "checks_rerun": "validate_decision (all C4 guards) + strict section-number range", "recovery_version": RECOVERY_VERSION,
        "new_provider_calls": 0, "ledger_modified": False, "recovered_at": datetime.now(timezone.utc).isoformat(),
    }
    return BlueprintResult(decision=decision, provider=ledger.get("provider") or "anthropic", model=ledger.get("model") or "unknown",
                           reasoning_contract_version=decision.reasoning_contract_version), audit
