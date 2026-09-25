"""The Blueprint reasoner provider adapter interface -- the one shape every provider must implement, so router.py never
needs to know which one it is talking to. A SEPARATE interface from the Mechanism/Retention/Hook ones (one call per
blueprint request)."""
from abc import ABC, abstractmethod

from app.services.blueprint_reasoner.contract import BlueprintDecision


class BlueprintReasonerProvider(ABC):
    name: str

    @abstractmethod
    def is_configured(self) -> bool:
        """Whether this provider has the secret(s)/setting(s) it needs -- checked by the router before any call."""

    @abstractmethod
    async def derive_blueprint(self, reasoner_input: dict, *, model: str) -> BlueprintDecision:
        """Given ONLY the bounded view from provider_input.build_reasoner_input (intent + reference skeleton + C3
        transferable principles; never source wording), returns a construction blueprint decision.

        Raises BlueprintReasoningError (never a fabricated decision) if unconfigured, the call fails, the response is
        empty/truncated/unparseable, or its shape violates the contract. The router then applies the provider-independent
        deterministic validation (validation.validate_decision), so a provider is NOT responsible for the safeguards --
        but its prompt should still ask for them.

        Must NEVER: produce final creative copy; carry across the reference's subject matter, wording or non-transferable
        elements; drop a mandatory point; use a prohibited element; claim performance or causation; invent a CTA, brand or
        fact the intent did not supply.
        """
