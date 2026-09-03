"""The provider adapter interface — the one shape every AI provider (Anthropic today; OpenAI/
Google as structured stubs, see openai_provider.py/google_provider.py) must implement, so
router.py never needs to know which one it's actually talking to.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass


class AIProviderError(Exception):
    """Raised for both "this provider isn't configured" (missing API key) and "the call to this
    provider's API failed" (invalid key, rate limit, outage, network error, not-yet-implemented
    provider) — the router always turns this into a truthful, user-facing error, never a faked
    result. The message is written to be shown directly to the person configuring the project
    (which env var, which file) — never includes the API key itself.
    """


@dataclass
class AIResult:
    """The one normalized shape every provider returns, regardless of that provider's own
    response format — this is what makes the frontend/caller provider-agnostic. Usage/cost
    fields (Task 7) are populated when the provider's own API reports them, else left None —
    never estimated or guessed. No pricing table exists yet to turn tokens into a dollar
    estimate; estimated_cost_usd is here so that can be added later without changing this shape
    or anything that consumes it.
    """
    text: str
    provider: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None


class AIProvider(ABC):
    """One instance per provider, stateless aside from lazily caching its own SDK client —
    see AnthropicProvider for the reference implementation."""

    name: str

    @abstractmethod
    def is_configured(self) -> bool:
        """Whether this provider has the secret(s) it needs (e.g. its own API key) — checked by
        generate_text itself before making a call, not by the router, since only the provider
        knows what it actually needs."""

    @abstractmethod
    async def generate_text(
        self,
        *,
        system: str,
        prompt: str,
        model: str,
        max_tokens: int,
        temperature: float | None,
    ) -> AIResult:
        """Raises AIProviderError (never returns a fabricated result) if this provider is
        unconfigured or the call fails for any reason."""
