"""C4 -- provider-independent parsing of a provider's raw JSON payload into a BlueprintDecision. A future provider only
has to obtain the JSON text. Raises BlueprintReasoningError (never a placeholder) on anything malformed."""
import json

from app.services.blueprint_reasoner.contract import (
    BlueprintDecision, BlueprintReasoningError, MechanismChoice, SectionPlan, UnassignedPoint, schema_requires_rationale,
)

__all__ = ["parse_json_object", "decision_from_payload"]

_TOP = {"structural_approach", "mechanism_dispositions", "sections", "unassigned_mandatory_points", "limitations"}
_SECTION_REQUIRED = {
    "section_number", "section_purpose", "structural_role", "target_duration_seconds", "mechanisms_applied",
    "source_anatomy_relationship", "content_instruction", "required_information", "visual_direction", "text_direction",
    "speech_direction", "pacing_direction", "mandatory_points_assigned", "confidence",
}
_SECTION_OPTIONAL = {"transition_direction", "cta_direction", "limitations"}
_CHOICE_KEYS = {"mechanism_id", "decision", "reason_category", "reason", "applied_in_sections", "application_rationale"}
_REL_KEYS = {"relationship", "anatomy_section_numbers"}


def parse_json_object(raw_text: str) -> dict:
    """Strict JSON first, then a brace-extraction fallback (a model may wrap the object in prose/fences)."""
    try:
        data = json.loads(raw_text)
    except (json.JSONDecodeError, TypeError):
        start = raw_text.find("{") if isinstance(raw_text, str) else -1
        end = raw_text.rfind("}") + 1 if isinstance(raw_text, str) else 0
        if start == -1 or end <= start:
            raise BlueprintReasoningError(f"Blueprint response was not valid JSON and contained no JSON object: {str(raw_text)[:300]!r}")
        try:
            data = json.loads(raw_text[start:end])
        except json.JSONDecodeError as exc:
            raise BlueprintReasoningError(f"Blueprint response could not be parsed as JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise BlueprintReasoningError(f"Blueprint response JSON must be an object, got {type(data).__name__}.")
    return data


def _obj(x, where: str) -> dict:
    if not isinstance(x, dict):
        raise BlueprintReasoningError(f"{where} must be an object.")
    return x


def _clean_unknown(raw: dict, allowed: set[str], where: str, ignored: list[str]) -> dict:
    """UNKNOWN key + null value -> dropped (recorded in `ignored`); UNKNOWN key + any non-null value -> rejected. Schema strictness is
    otherwise unchanged: a stray null is harmless, an explanatory/helper field with content is not part of the schema."""
    unknown = set(raw) - allowed
    non_null = sorted(k for k in unknown if raw[k] is not None)
    if non_null:
        raise BlueprintReasoningError(f"{where} has unexpected field(s) {non_null}.")
    ignored += [f"{where}.{k}" for k in sorted(unknown)]
    return {k: v for k, v in raw.items() if k in allowed}


def decision_from_payload(data: dict, *, reasoning_contract_version: str | None = None) -> BlueprintDecision:
    missing = {"structural_approach", "mechanism_dispositions", "sections"} - set(data)
    if missing:
        raise BlueprintReasoningError(f"Blueprint response is missing required field(s): {sorted(missing)}.")
    ignored: list[str] = []
    try:
        data = _clean_unknown(data, _TOP, "Blueprint response", ignored)
    except BlueprintReasoningError as exc:
        raise BlueprintReasoningError(str(exc).replace("has unexpected field(s)", "has unexpected top-level field(s)")) from exc
    require_rationale = schema_requires_rationale(reasoning_contract_version)
    for name in ("mechanism_dispositions", "sections", "unassigned_mandatory_points"):
        if name in data and not isinstance(data[name], list):
            raise BlueprintReasoningError(f"`{name}` must be a list.")

    choices = []
    for i, raw in enumerate(data["mechanism_dispositions"], 1):
        raw = _clean_unknown(_obj(raw, f"mechanism_dispositions[{i}]"), _CHOICE_KEYS, f"mechanism_dispositions[{i}]", ignored)
        if require_rationale and raw.get("decision") == "USED" and not (isinstance(raw.get("application_rationale"), str) and raw["application_rationale"].strip()):
            raise BlueprintReasoningError(
                f"mechanism_dispositions[{i}] ({raw.get('mechanism_id')}) is USED but has no application_rationale -- every USED mechanism must "
                "explain HOW its transferable principle is instantiated in the blueprint.")
        try:
            choices.append(MechanismChoice(
                mechanism_id=raw.get("mechanism_id"), decision=raw.get("decision"), reason=raw.get("reason"),
                reason_category=raw.get("reason_category"), applied_in_sections=raw.get("applied_in_sections") or [],
                application_rationale=raw.get("application_rationale")))
        except ValueError as exc:
            raise BlueprintReasoningError(f"mechanism_dispositions[{i}] failed contract validation: {exc}") from exc

    sections = []
    for i, raw in enumerate(data["sections"], 1):
        raw = _obj(raw, f"sections[{i}]")
        missing = _SECTION_REQUIRED - set(raw)
        if missing:
            raise BlueprintReasoningError(f"sections[{i}] is missing required field(s): {sorted(missing)}.")
        raw = _clean_unknown(raw, _SECTION_REQUIRED | _SECTION_OPTIONAL, f"sections[{i}]", ignored)
        rel = _clean_unknown(_obj(raw["source_anatomy_relationship"], f"sections[{i}].source_anatomy_relationship"), _REL_KEYS,
                             f"sections[{i}].source_anatomy_relationship", ignored)
        if "relationship" not in rel:
            raise BlueprintReasoningError(f"sections[{i}].source_anatomy_relationship must be {{relationship, anatomy_section_numbers}}.")
        try:
            sections.append(SectionPlan(
                section_number=raw["section_number"], section_purpose=raw["section_purpose"], structural_role=raw["structural_role"],
                target_duration_seconds=raw["target_duration_seconds"], mechanisms_applied=raw["mechanisms_applied"],
                relationship=rel["relationship"], anatomy_section_numbers=rel.get("anatomy_section_numbers") or [],
                content_instruction=raw["content_instruction"], required_information=raw["required_information"],
                visual_direction=raw["visual_direction"], text_direction=raw["text_direction"], speech_direction=raw["speech_direction"],
                pacing_direction=raw["pacing_direction"], transition_direction=raw.get("transition_direction"),
                cta_direction=raw.get("cta_direction"), mandatory_points_assigned=raw["mandatory_points_assigned"],
                confidence=raw["confidence"], limitations=raw.get("limitations") or []))
        except (ValueError, TypeError) as exc:
            raise BlueprintReasoningError(f"sections[{i}] failed contract validation: {exc}") from exc

    unassigned = []
    for i, raw in enumerate(data.get("unassigned_mandatory_points") or [], 1):
        raw = _clean_unknown(_obj(raw, f"unassigned_mandatory_points[{i}]"), {"id", "reason"}, f"unassigned_mandatory_points[{i}]", ignored)
        if set(raw) != {"id", "reason"}:
            raise BlueprintReasoningError(f"unassigned_mandatory_points[{i}] must be {{id, reason}}.")
        try:
            unassigned.append(UnassignedPoint(id=raw["id"], reason=raw["reason"]))
        except ValueError as exc:
            raise BlueprintReasoningError(f"unassigned_mandatory_points[{i}] failed contract validation: {exc}") from exc

    try:
        return BlueprintDecision(
            structural_approach=data["structural_approach"], mechanism_choices=choices, sections=sections,
            unassigned_mandatory_points=unassigned, limitations=data.get("limitations") or [],
            reasoning_contract_version=reasoning_contract_version, ignored_null_fields=ignored)
    except ValueError as exc:
        raise BlueprintReasoningError(f"Blueprint response failed contract validation: {exc}") from exc
