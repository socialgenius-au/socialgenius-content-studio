"""C3 -- provider-independent parsing of a provider's raw JSON payload into a MechanismDecision, so a future
provider only has to obtain the JSON text and never re-implements shape checking. Raises
MechanismReasoningError (never returns a placeholder) on anything malformed."""
import json

from app.services.mechanism_reasoner.contract import (
    Mechanism, MechanismDecision, MechanismReasoningError, NonTransferableElement,
)

__all__ = ["parse_json_object", "decision_from_payload"]

_MECHANISM_KEYS = {
    "mechanism_type", "statement", "scope", "section_numbers", "supporting_evidence_ids", "anatomy_features_used",
    "transferable_principle", "non_transferable_elements", "confidence",
}
_OPTIONAL_MECHANISM_KEYS = {"other_label", "other_rationale", "limitations", "certainty"}


def parse_json_object(raw_text: str) -> dict:
    """Strict JSON first, then a brace-extraction fallback (a model may wrap the object in prose/fences)."""
    try:
        data = json.loads(raw_text)
    except (json.JSONDecodeError, TypeError):
        start = raw_text.find("{") if isinstance(raw_text, str) else -1
        end = raw_text.rfind("}") + 1 if isinstance(raw_text, str) else 0
        if start == -1 or end <= start:
            raise MechanismReasoningError(f"Mechanism response was not valid JSON and contained no JSON object: {str(raw_text)[:300]!r}")
        try:
            data = json.loads(raw_text[start:end])
        except json.JSONDecodeError as exc:
            raise MechanismReasoningError(f"Mechanism response could not be parsed as JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise MechanismReasoningError(f"Mechanism response JSON must be an object, got {type(data).__name__}.")
    return data


def decision_from_payload(data: dict, *, reasoning_contract_version: str | None = None) -> MechanismDecision:
    if "mechanisms" not in data or not isinstance(data["mechanisms"], list):
        raise MechanismReasoningError("Mechanism response must contain a `mechanisms` list (empty is valid).")
    limitations = data.get("overall_limitations", [])
    if not isinstance(limitations, list) or not all(isinstance(x, str) for x in limitations):
        raise MechanismReasoningError("`overall_limitations` must be a list of strings.")
    unknown_top = set(data) - {"mechanisms", "overall_limitations"}
    if unknown_top:
        raise MechanismReasoningError(f"Mechanism response has unexpected top-level field(s) {sorted(unknown_top)}.")

    mechanisms = []
    for i, raw in enumerate(data["mechanisms"], 1):
        if not isinstance(raw, dict):
            raise MechanismReasoningError(f"mechanisms[{i}] must be an object.")
        missing = _MECHANISM_KEYS - set(raw)
        if missing:
            raise MechanismReasoningError(f"mechanisms[{i}] is missing required field(s): {sorted(missing)}.")
        unknown = set(raw) - _MECHANISM_KEYS - _OPTIONAL_MECHANISM_KEYS
        if unknown:
            raise MechanismReasoningError(f"mechanisms[{i}] has unexpected field(s) {sorted(unknown)}.")
        elements = raw["non_transferable_elements"]
        if not isinstance(elements, list) or not all(isinstance(e, dict) and set(e) == {"kind", "description"} for e in elements):
            raise MechanismReasoningError(f"mechanisms[{i}].non_transferable_elements must be a list of {{kind, description}} objects.")
        try:
            mechanisms.append(Mechanism(
                mechanism_type=raw["mechanism_type"], statement=raw["statement"], scope=raw["scope"],
                section_numbers=raw["section_numbers"], supporting_evidence_ids=raw["supporting_evidence_ids"],
                anatomy_features_used=raw["anatomy_features_used"], transferable_principle=raw["transferable_principle"],
                non_transferable_elements=[NonTransferableElement(kind=e["kind"], description=e["description"]) for e in elements],
                confidence=raw["confidence"], limitations=raw.get("limitations") or [],
                other_label=raw.get("other_label"), other_rationale=raw.get("other_rationale"),
                certainty=raw.get("certainty") or "INFERRED",
            ))
        except ValueError as exc:
            raise MechanismReasoningError(f"mechanisms[{i}] failed contract validation: {exc}") from exc
    try:
        return MechanismDecision(mechanisms=mechanisms, overall_limitations=limitations,
                                 reasoning_contract_version=reasoning_contract_version)
    except ValueError as exc:
        raise MechanismReasoningError(f"Mechanism response failed contract validation: {exc}") from exc
