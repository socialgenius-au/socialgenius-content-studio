"""OpenAI adapter — structured placeholder, not a working implementation (Task 6). Deliberately
has no dependency on the `openai` SDK: adding an unused dependency "just in case" was explicitly
out of scope, and none is needed for is_configured() to be honest about whether a key exists.

To make this a real, working provider later: add `openai` to backend/requirements.txt, then
implement generate_text() the same shape as AnthropicProvider.generate_text() — build an
AsyncOpenAI client (lazily cached, same pattern as app.services.claude.get_client()), call
client.chat.completions.create(model=model, max_tokens=max_tokens, temperature=temperature,
messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}]), and map
the response into AIResult (text from choices[0].message.content, usage from response.usage).
"""
from app.config import settings

from .base import AIProvider, AIProviderError, AIResult


class OpenAIProvider(AIProvider):
    name = "openai"

    def is_configured(self) -> bool:
        return bool(settings.OPENAI_API_KEY)

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
            "AI_TEXT_PROVIDER is set to 'openai', but the OpenAI provider isn't implemented yet "
            "in this project (only its configuration placeholder exists — see "
            "app/services/ai/providers/openai_provider.py for what remains). Set "
            "AI_TEXT_PROVIDER=anthropic (with ANTHROPIC_API_KEY configured) to use AI features "
            "today."
        )
