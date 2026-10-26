"""C3 -- Mechanism Reasoner: a sibling package to app.services.retention_reasoner / hook_reasoner, with the
same provider-independent contract shape.

    Mechanism orchestration (app.services.transferable_mechanism_svc)
      -> derive_mechanisms(anatomy)                         <- this package's public entry point, ONE call per anatomy
      -> router._REASONER_PROVIDERS["anthropic"]            (registered in C3)
      -> validation.validate_decision(...)                  <- provider-independent, anatomy-aware safeguards

Consumes ONLY the C2 Content Anatomy response. Runs ONLY when an operator explicitly sets
MECHANISM_REASONER_PROVIDER="anthropic" (default: "", unconfigured) AND has ANTHROPIC_API_KEY set. NO
PERSISTENCE of any kind exists in this package.
"""
from app.services.mechanism_reasoner.anatomy_input import MechanismInputError
from app.services.mechanism_reasoner.contract import (
    ANATOMY_FEATURE_KEYS, MECHANISM_TYPES, NON_TRANSFERABLE_KINDS, TAXONOMY_VERSION, VALID_CONFIDENCE_LEVELS,
    Mechanism, MechanismDecision, MechanismReasoningError, MechanismResult, NonTransferableElement,
)
from app.services.mechanism_reasoner.router import derive_mechanisms

__all__ = [
    "ANATOMY_FEATURE_KEYS", "MECHANISM_TYPES", "NON_TRANSFERABLE_KINDS", "TAXONOMY_VERSION", "VALID_CONFIDENCE_LEVELS",
    "Mechanism", "MechanismDecision", "MechanismInputError", "MechanismReasoningError", "MechanismResult",
    "NonTransferableElement", "derive_mechanisms",
]
