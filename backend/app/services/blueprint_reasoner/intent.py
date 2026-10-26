"""C4 -- NewContentIntent normalisation, hashing, mandatory-point ids and missing-information gaps.

Validation lives in ONE place (app.schemas.reconstruction_blueprint.NewContentIntentIn); this module wraps it for
service callers (dict or model in, canonical dict out) and derives the deterministic facts C4 needs from it.
"""
import hashlib
import json

from pydantic import ValidationError

from app.schemas.reconstruction_blueprint import NewContentIntentIn
from app.services.mechanism_reasoner.language_guard import tokenize

__all__ = ["BlueprintInputError", "normalize_intent", "intent_hash", "mandatory_point_ids", "intent_gaps", "intent_tokens", "intent_summary"]


class BlueprintInputError(Exception):
    """The request cannot be used as C4 input (invalid/missing NewContentIntent, unusable anatomy, no transferable
    mechanisms). Mapped to HTTP 422 -- an input problem, distinct from a reasoning failure."""


def normalize_intent(raw) -> dict:
    """Validates and canonicalises a NewContentIntent. Raises BlueprintInputError naming every offending field.
    The canonical dict ALWAYS carries every key (None / [] when not supplied) so hashing is stable."""
    try:
        model = raw if isinstance(raw, NewContentIntentIn) else NewContentIntentIn.model_validate(raw)
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(str(p) for p in e['loc']) or 'intent'}: {e['msg']}" for e in exc.errors())
        raise BlueprintInputError(f"Invalid NewContentIntent -- {problems}") from exc
    d = model.model_dump()
    dpc = d.get("duration_platform_constraints")
    if dpc is not None and not any(v is not None for v in dpc.values()):
        d["duration_platform_constraints"] = None
    return d


def intent_hash(canonical: dict) -> str:
    """sha256 over the canonical intent (sorted keys, no timestamps). Identical intent -> identical hash."""
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def mandatory_point_ids(canonical: dict) -> dict[str, str]:
    """{MP01: text, MP02: text, ...} in the caller's order."""
    return {f"MP{i:02d}": text for i, text in enumerate(canonical.get("mandatory_points") or [], 1)}


_OPTIONAL_LABELS = {
    "business_or_brand": "no business or brand name was supplied; none may be invented",
    "desired_cta": "no desired call to action was supplied; no CTA is planned",
    "tone_style_constraints": "no tone or style constraints were supplied",
    "duration_platform_constraints": "no duration or platform constraints were supplied",
    "mandatory_points": "no mandatory points were supplied",
    "prohibited_claims_or_elements": "no prohibited claims or elements were supplied",
}


def intent_gaps(canonical: dict) -> list[dict]:
    """Optional information the caller did not supply. Recorded as gaps -- NEVER filled in by C4."""
    gaps = [{"field": k, "kind": "not_supplied", "reason": reason} for k, reason in _OPTIONAL_LABELS.items() if not canonical.get(k)]
    dpc = canonical.get("duration_platform_constraints") or {}
    if dpc and dpc.get("target_duration_seconds") is None:
        gaps.append({"field": "duration_platform_constraints.target_duration_seconds", "kind": "not_supplied",
                     "reason": "no target duration was supplied; section durations are planning guidance only"})
    if dpc and not dpc.get("platform"):
        gaps.append({"field": "duration_platform_constraints.platform", "kind": "not_supplied", "reason": "no platform was supplied"})
    return gaps


def intent_tokens(canonical: dict) -> set[str]:
    """Every word the caller's own intent USES -- words the blueprint may legitimately use even if the reference did (a tile retailer
    may say 'tile'). Words that appear ONLY in the caller's PROHIBITED list are deliberately excluded: the caller is naming things to
    keep OUT, so 'relationship' in "no relationship narrative" must not exempt the word from the source-subject guard."""
    parts = [canonical.get(k) or "" for k in ("product_service_or_topic", "target_audience", "objective", "business_or_brand", "desired_cta")]
    parts += list(canonical.get("tone_style_constraints") or []) + list(canonical.get("mandatory_points") or [])
    dpc = canonical.get("duration_platform_constraints") or {}
    parts += [dpc.get("platform") or "", dpc.get("notes") or ""]
    return {t for p in parts for t in tokenize(p)}


def intent_summary(canonical: dict) -> str:
    """A deterministic one-paragraph restatement of the intent (built from the intent only -- never by a model)."""
    parts = [f"Topic: {canonical['product_service_or_topic']}.", f"Audience: {canonical['target_audience']}.", f"Objective: {canonical['objective']}."]
    if canonical.get("business_or_brand"):
        parts.append(f"Business: {canonical['business_or_brand']}.")
    dpc = canonical.get("duration_platform_constraints") or {}
    bits = [b for b in (dpc.get("platform"), f"{dpc['target_duration_seconds']:g}s" if dpc.get("target_duration_seconds") else None) if b]
    if bits:
        parts.append(f"Format: {', '.join(bits)}.")
    return " ".join(parts)
