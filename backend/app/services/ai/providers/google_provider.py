"""Google (Gemini) adapter — structured placeholder, not a working implementation (Task 6).
Deliberately has no dependency on Google's SDK, for the same reason as openai_provider.py: no
unused dependency, and none is needed for is_configured() to be honest.

To make this a real, working provider later: add `google-genai` to backend/requirements.txt,
build a lazily-cached client (same pattern as app.services.claude.get_client()) from
settings.GOOGLE_AI_API_KEY, call its generate_content-style method with `model`, `system`
(Gemini calls this system_instruction), `prompt`, `max_tokens` (max_output_tokens), and
`temperature`, then map the response into AIResult (text from the response, usage from its
usage_metadata if the SDK exposes one).
"""
from app.config import settings

from .base import AIProvider, AIProviderError, AIResult


class GoogleProvider(AIProvider):
    name = "google"

    def is_configured(self) -> bool:
        return bool(settings.GOOGLE_AI_API_KEY)

    async def generate_text(
        self,
        *,
        system: str,
        prompt: str,
        model: str,
        max_tokens: int,
        temperature: float | None,
    ) -> AIResult:
        raise AIProviderError(
            "AI_TEXT_PROVIDER is set to 'google', but the Google AI provider isn't implemented "
            "yet in this project (only its configuration placeholder exists — see "
            "app/services/ai/providers/google_provider.py for what remains). Set "
            "AI_TEXT_PROVIDER=anthropic (with ANTHROPIC_API_KEY configured) to use AI features "
            "today."
        )
