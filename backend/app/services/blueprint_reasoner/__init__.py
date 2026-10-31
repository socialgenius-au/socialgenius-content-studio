"""C4 -- Blueprint Reasoner: a sibling package to app.services.mechanism_reasoner, with the same provider-independent shape.

    Blueprint orchestration (app.services.reconstruction_blueprint_svc)
      -> derive_blueprint(ctx)                          <- this package's public entry point, ONE call per request
      -> router._REASONER_PROVIDERS["anthropic"]        (registered in C4)
      -> validation.validate_decision(...)              <- provider-independent, deterministic safeguards

Consumes the pinned C2 anatomy (skeleton only), the persisted C3 effective mechanisms (transferable principles only) and a
NewContentIntent. Runs ONLY when an operator explicitly sets BLUEPRINT_REASONER_PROVIDER="anthropic" (default: "") AND has
ANTHROPIC_API_KEY set. NO PERSISTENCE of any kind exists in this package.
"""
from app.services.blueprint_reasoner.contract import (
    BLUEPRINT_VERSION, NOT_USED_REASONS, RELATIONSHIPS, STRUCTURAL_ROLES, BlueprintDecision, BlueprintReasoningError, BlueprintResult,
    MechanismChoice, SectionPlan, UnassignedPoint,
)
from app.services.blueprint_reasoner.intent import BlueprintInputError, intent_hash, normalize_intent
from app.services.blueprint_reasoner.router import derive_blueprint
from app.services.blueprint_reasoner.validation import BlueprintContext, build_context, finalize_blueprint, validate_decision

__all__ = [
    "BLUEPRINT_VERSION", "NOT_USED_REASONS", "RELATIONSHIPS", "STRUCTURAL_ROLES", "BlueprintContext", "BlueprintDecision",
    "BlueprintInputError", "BlueprintReasoningError", "BlueprintResult", "MechanismChoice", "SectionPlan", "UnassignedPoint",
    "build_context", "derive_blueprint", "finalize_blueprint", "intent_hash", "normalize_intent", "validate_decision",
]
