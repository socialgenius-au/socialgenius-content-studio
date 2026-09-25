"""C4 -- provider-independent, DETERMINISTIC validation of a BlueprintDecision, plus finalisation into the storable
blueprint (stable id, deterministic constraints, mandatory-point accounting, gaps, provenance).

Called by router.derive_blueprint() for EVERY provider. A response that violates any rule is rejected whole, never
edited, never persisted.

MECHANISM SELECTION -- every C3 mechanism gets exactly ONE choice (USED / NOT_USED); ids must exist in the effective C3
result; USED needs sections that actually list it and NOT_USED needs a categorised reason; at least one mechanism must be
USED (otherwise nothing was transferred). Not every mechanism has to be used -- the provider decides suitability.
MANDATORY POINTS -- each is assigned to >= 1 section or explicitly reported unassigned with a reason; never both, never
neither, never an unknown id.
STRUCTURE -- sections are numbered 1..n in order; anatomy references must exist; planned durations must sum to within 15%
of a supplied target.
CTA -- planned only when the caller supplied a desired CTA (and then at least one section carries CTA direction); never
invented.
TEXT -- every free-text field passes guards.check_text (performance/causal, source copy, non-transferable subject terms,
final creative copy, prohibited elements).
"""
import hashlib
import json
from dataclasses import dataclass

from app.services.blueprint_reasoner.contract import (
    BLUEPRINT_VERSION, DURATION_TOLERANCE, BlueprintDecision, BlueprintReasoningError,
)
from app.services.blueprint_reasoner.guards import GuardContext, build_guard_context, check_text
from app.services.blueprint_reasoner.intent import intent_gaps, intent_summary, intent_tokens, mandatory_point_ids
from app.services.mechanism_reasoner.anatomy_input import source_texts, valid_section_numbers

__all__ = ["BlueprintContext", "build_context", "validate_decision", "finalize_blueprint", "blueprint_id_for"]

COPY_POLICY = ("Instructions only. This blueprint contains no final hook lines, captions, scripts, headlines, CTA wording or "
               "voiceover copy; those are produced downstream from these instructions.")
PERFORMANCE_POLICY = ("Structural design logic is transferred; no performance, engagement, retention or conversion outcome is "
                      "claimed or implied.")


@dataclass
class BlueprintContext:
    anatomy: dict
    mechanisms: list[dict]          # the C3 effective mechanisms (as returned by get_effective_mechanisms)
    intent: dict                    # canonical NewContentIntent
    mandatory_points: dict[str, str]
    guard: GuardContext


def build_context(anatomy: dict, mechanisms: list[dict], canonical_intent: dict) -> BlueprintContext:
    tokens = intent_tokens(canonical_intent)
    return BlueprintContext(
        anatomy=anatomy, mechanisms=mechanisms, intent=canonical_intent, mandatory_points=mandatory_point_ids(canonical_intent),
        guard=build_guard_context(anatomy, mechanisms, canonical_intent, tokens, source_texts(anatomy)),
    )


def _fail(message: str) -> None:
    raise BlueprintReasoningError(message)


def _validate_mechanisms(decision: BlueprintDecision, ctx: BlueprintContext) -> dict:
    known = {m["mechanism_id"]: m for m in ctx.mechanisms}
    ids = [c.mechanism_id for c in decision.mechanism_choices]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        _fail(f"mechanism_dispositions lists {dup} more than once -- each C3 mechanism gets exactly one choice.")
    unknown = sorted(set(ids) - set(known))
    if unknown:
        _fail(f"mechanism_dispositions references unknown mechanism id(s) {unknown} (the effective C3 result has {sorted(known)}) -- "
              "rejecting rather than allowing invented provenance.")
    missing = sorted(set(known) - set(ids))
    if missing:
        _fail(f"mechanism_dispositions omits C3 mechanism(s) {missing} -- every mechanism must be explicitly USED or NOT_USED with a reason.")
    choices = {c.mechanism_id: c for c in decision.mechanism_choices}
    if known and not any(c.decision == "USED" for c in choices.values()):
        _fail("no C3 mechanism is USED -- a blueprint that transfers nothing from the reference is not a reconstruction.")
    numbers = {s.section_number for s in decision.sections}
    by_section = {s.section_number: set(s.mechanisms_applied) for s in decision.sections}
    for s in decision.sections:
        for mid in s.mechanisms_applied:
            c = choices.get(mid)
            if c is None:
                _fail(f"section {s.section_number} applies unknown mechanism {mid!r} -- rejecting rather than allowing invented provenance.")
            if c.decision != "USED":
                _fail(f"section {s.section_number} applies {mid}, which is NOT_USED.")
            if s.section_number not in c.applied_in_sections:
                _fail(f"section {s.section_number} lists {mid}, but {mid}'s applied_in_sections does not include it.")
    for c in decision.mechanism_choices:
        if c.decision != "USED":
            continue
        for n in c.applied_in_sections:
            if n not in numbers:
                _fail(f"{c.mechanism_id} is applied in section {n}, which does not exist (sections 1..{len(numbers)}).")
            if c.mechanism_id not in by_section[n]:
                _fail(f"{c.mechanism_id} says it is applied in section {n}, but that section does not list it in mechanisms_applied.")
    return choices


def _validate_structure(decision: BlueprintDecision, ctx: BlueprintContext) -> float:
    for i, s in enumerate(decision.sections, 1):
        if s.section_number != i:
            _fail(f"sections must be numbered 1..n in order; position {i} has section_number {s.section_number}.")
    valid = set(valid_section_numbers(ctx.anatomy))
    for s in decision.sections:
        bad = sorted(set(s.anatomy_section_numbers) - valid)
        if bad:
            _fail(f"section {s.section_number} references anatomy section(s) {bad} that do not exist (valid: {sorted(valid)}) -- "
                  "rejecting rather than allowing invented provenance.")
        if s.relationship != "independent_of_reference" and not s.anatomy_section_numbers:
            _fail(f"section {s.section_number} claims relationship {s.relationship!r} but names no anatomy section.")
    total = round(sum(s.target_duration_seconds for s in decision.sections), 3)
    target = (ctx.intent.get("duration_platform_constraints") or {}).get("target_duration_seconds")
    if target and abs(total - target) > DURATION_TOLERANCE * target:
        _fail(f"planned section durations total {total:g}s, which is more than {int(DURATION_TOLERANCE * 100)}% away from the "
              f"supplied target of {target:g}s.")
    return total


def _validate_mandatory_points(decision: BlueprintDecision, ctx: BlueprintContext) -> dict[str, list[int]]:
    known = set(ctx.mandatory_points)
    assigned: dict[str, list[int]] = {}
    for s in decision.sections:
        if len(set(s.mandatory_points_assigned)) != len(s.mandatory_points_assigned):
            _fail(f"section {s.section_number} lists the same mandatory point twice.")
        for mp in s.mandatory_points_assigned:
            if mp not in known:
                _fail(f"section {s.section_number} assigns unknown mandatory point {mp!r} (valid: {sorted(known)}).")
            assigned.setdefault(mp, []).append(s.section_number)
    unassigned_ids = [u.id for u in decision.unassigned_mandatory_points]
    if len(set(unassigned_ids)) != len(unassigned_ids):
        _fail("unassigned_mandatory_points lists the same point more than once.")
    for uid in unassigned_ids:
        if uid not in known:
            _fail(f"unassigned_mandatory_points references unknown mandatory point {uid!r} (valid: {sorted(known)}).")
        if uid in assigned:
            _fail(f"mandatory point {uid} is both assigned to section(s) {assigned[uid]} and reported unassigned.")
    silently_dropped = sorted(known - set(assigned) - set(unassigned_ids))
    if silently_dropped:
        _fail(f"mandatory point(s) {silently_dropped} are neither assigned to a section nor reported unassigned with a reason -- "
              "a mandatory point may never silently disappear.")
    return assigned


def _validate_cta(decision: BlueprintDecision, ctx: BlueprintContext) -> None:
    with_cta = [s.section_number for s in decision.sections if s.cta_direction]
    if ctx.intent.get("desired_cta"):
        if not with_cta:
            _fail("a desired CTA was supplied but no section carries cta_direction -- the CTA must be planned (as an instruction).")
    elif with_cta:
        _fail(f"no desired CTA was supplied, but section(s) {with_cta} plan one -- C4 does not invent a CTA.")


def _validate_text(decision: BlueprintDecision, ctx: BlueprintContext) -> None:
    g = ctx.guard
    check_text("structural_approach", decision.structural_approach, g)
    for i, text in enumerate(decision.limitations):
        check_text(f"limitations[{i}]", text, g, instruction=False)
    for c in decision.mechanism_choices:
        check_text(f"{c.mechanism_id}.reason", c.reason, g, instruction=False)
    for u in decision.unassigned_mandatory_points:
        check_text(f"{u.id}.reason", u.reason, g, instruction=False)
    for s in decision.sections:
        p = f"section {s.section_number}"
        for name in ("section_purpose", "content_instruction", "visual_direction", "text_direction", "speech_direction", "pacing_direction",
                     "transition_direction", "cta_direction"):
            check_text(f"{p}.{name}", getattr(s, name), g)
        for i, text in enumerate(s.required_information):
            check_text(f"{p}.required_information[{i}]", text, g)
        for i, text in enumerate(s.limitations):
            check_text(f"{p}.limitations[{i}]", text, g, instruction=False)


def validate_decision(decision: BlueprintDecision, ctx: BlueprintContext) -> None:
    """Raises BlueprintReasoningError for any violation; returns None when the decision is safe to persist."""
    _validate_mechanisms(decision, ctx)
    _validate_structure(decision, ctx)
    _validate_mandatory_points(decision, ctx)
    _validate_cta(decision, ctx)
    _validate_text(decision, ctx)


def blueprint_id_for(pins: dict) -> str:
    """Stable identifier: identical anatomy + mechanism result + intent + provider/model/prompt -> identical id."""
    key = {k: pins.get(k) for k in ("anatomy_fingerprint", "mechanism_attempt_id", "intent_hash", "provider", "model", "prompt_version")}
    return "bp-" + hashlib.sha256(json.dumps(key, sort_keys=True).encode("utf-8")).hexdigest()[:16]


def finalize_blueprint(decision: BlueprintDecision, ctx: BlueprintContext, pins: dict, reference_limitations: list[str]) -> dict:
    """The storable blueprint. Deterministic parts (constraints, prohibited elements, mandatory-point accounting, gaps,
    provenance) are filled by CODE; only the semantic parts come from the provider. Call only AFTER validate_decision."""
    intent = ctx.intent
    mech = {m["mechanism_id"]: m for m in ctx.mechanisms}
    choices = {c.mechanism_id: c for c in decision.mechanism_choices}
    dispositions = []
    for m in ctx.mechanisms:
        c = choices[m["mechanism_id"]]
        dispositions.append({
            "mechanism_id": c.mechanism_id, "mechanism_type": m.get("mechanism_type"), "decision": c.decision,
            "reason_category": c.reason_category, "reason": c.reason, "applied_in_sections": sorted(c.applied_in_sections),
            "transferable_principle": m.get("transferable_principle"),
        })
    assigned: dict[str, list[int]] = {}
    for s in decision.sections:
        for mp in s.mandatory_points_assigned:
            assigned.setdefault(mp, []).append(s.section_number)
    unassigned = {u.id: u.reason for u in decision.unassigned_mandatory_points}
    accounting = [{
        "id": mp_id, "text": text, "status": "ASSIGNED" if mp_id in assigned else "UNASSIGNED",
        "section_numbers": sorted(assigned.get(mp_id, [])), "reason": unassigned.get(mp_id),
    } for mp_id, text in ctx.mandatory_points.items()]

    prohibited = list(intent.get("prohibited_claims_or_elements") or [])
    sections = []
    for s in decision.sections:
        sections.append({
            "section_number": s.section_number, "section_purpose": s.section_purpose, "structural_role": s.structural_role,
            "target_duration_seconds": s.target_duration_seconds, "mechanisms_applied": list(s.mechanisms_applied),
            "source_anatomy_relationship": {"relationship": s.relationship, "anatomy_section_numbers": sorted(s.anatomy_section_numbers)},
            "content_instruction": s.content_instruction, "required_information": list(s.required_information),
            "visual_direction": s.visual_direction, "text_direction": s.text_direction, "speech_direction": s.speech_direction,
            "pacing_direction": s.pacing_direction, "transition_direction": s.transition_direction, "cta_direction": s.cta_direction,
            "mandatory_points_assigned": list(s.mandatory_points_assigned), "prohibited_elements": prohibited,
            "evidence_refs": {"anatomy_section_numbers": sorted(s.anatomy_section_numbers), "mechanism_ids": sorted(s.mechanisms_applied)},
            "confidence": s.confidence, "limitations": list(s.limitations),
        })

    gaps = list(intent_gaps(intent))
    for g in ctx.anatomy.get("gaps") or []:
        gaps.append({"field": f"reference:{g.get('field')}", "kind": "reference_gap", "reason": g.get("reason") or ""})
    for text in reference_limitations:
        gaps.append({"field": "reference:mechanisms", "kind": "reference_limitation", "reason": text})
    for u in decision.unassigned_mandatory_points:
        gaps.append({"field": f"mandatory_points.{u.id}", "kind": "unassigned_mandatory_point", "reason": f"{ctx.mandatory_points[u.id]} -- {u.reason}"})
    for text in decision.limitations:
        gaps.append({"field": "blueprint", "kind": "provider_limitation", "reason": text})
    seen, unique_gaps = set(), []
    for g in gaps:
        key = (g["field"], g["kind"], g["reason"])
        if key not in seen:
            seen.add(key)
            unique_gaps.append(g)

    dpc = intent.get("duration_platform_constraints") or {}
    planned = round(sum(s.target_duration_seconds for s in decision.sections), 3)
    return {
        "blueprint_id": blueprint_id_for(pins), "blueprint_version": BLUEPRINT_VERSION,
        "intent": intent, "intent_summary": intent_summary(intent),
        "structural_approach": decision.structural_approach,
        "target": {"platform": dpc.get("platform"), "target_duration_seconds": dpc.get("target_duration_seconds"), "planned_total_seconds": planned},
        "mechanisms_used": sorted(mid for mid, c in choices.items() if c.decision == "USED"),
        "mechanisms_not_used": [d for d in dispositions if d["decision"] == "NOT_USED"],
        "mechanism_dispositions": dispositions,
        "constraints": {
            "tone_style": list(intent.get("tone_style_constraints") or []), "duration_platform": dpc or None,
            "prohibited_claims_or_elements": prohibited,
            "do_not_reproduce": [{"mechanism_id": m["mechanism_id"], "kind": e.get("kind"), "description": e.get("description")}
                                 for m in ctx.mechanisms for e in (m.get("non_transferable_elements") or [])],
            "copy_policy": COPY_POLICY, "performance_policy": PERFORMANCE_POLICY,
        },
        "sections": sections, "mandatory_point_accounting": accounting, "gaps": unique_gaps,
        "limitations": list(decision.limitations),
        "provenance": {**pins, "blueprint_version": BLUEPRINT_VERSION, "certainty": "INFERRED", "source_mechanism_count": len(mech)},
    }
