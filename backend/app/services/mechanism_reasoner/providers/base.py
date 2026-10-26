"""The Mechanism reasoner provider adapter interface -- the one shape every provider must implement, so
router.py never needs to know which one it is talking to. A SEPARATE interface from the Retention/Hook ones
(one call per ANATOMY, not per candidate/window), following the same stateless-adapter pattern.
"""
from abc import ABC, abstractmethod

from app.services.mechanism_reasoner.contract import MechanismDecision


class MechanismReasonerProvider(ABC):
    name: str

    @abstractmethod
    def is_configured(self) -> bool:
        """Whether this provider has the secret(s)/setting(s) it needs -- checked by the router before any call."""

    @abstractmethod
    async def derive_mechanisms(self, reasoner_input: dict, *, model: str) -> MechanismDecision:
        """Given ONLY the bounded C2 anatomy view (anatomy_input.build_reasoner_input), returns the apparent
        design mechanisms it supports -- possibly none.

        Raises MechanismReasoningError (never a fabricated decision) if unconfigured, the call fails, the
        response cannot be parsed into a MechanismDecision, or its shape violates the contract. The router
        then applies the provider-independent, anatomy-aware validation (validation.validate_decision), so a
        provider is NOT responsible for evidence/language/transferability checks -- but its prompt should
        still ask for them.

        Must NEVER: use anything outside `reasoner_input`; invent evidence, sections or features; claim
        performance or causation; reproduce source wording; or force a mechanism where none is supported.
        """
