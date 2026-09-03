"""The Anthropic Claude adapter — the one fully-implemented provider today. Reuses
app.services.claude.get_client() (the exact same lazily-cached AsyncAnthropic client
generate_job_plan/generate_content/chat_reply already use for the Job Planner and AI Assistant,
both of which are untouched by this refactor and keep calling that module directly) rather than
standing up a second Anthropic client — this adapter is a thin wrapper for the NEW provider-
neutral callers (currently just AI Prompt Generator) to go through, not a replacement for the
existing direct usage.
"""
import anthropic

from app.config import settings
from app.services.claude import get_client

from .base import AIProvider, AIProviderError, AIResult


class AnthropicProvider(AIProvider):
    name = "anthropic"

    def is_configured(self) -> bool:
        return bool(settings.ANTHROPIC_API_KEY)

    async def generate_text(
        self,
        *,
        system: str,
        prompt: str,
        model: str,
        max_tokens: int,
        temperature: float | None,
    ) -> AIResult:
        if not self.is_configured():
            raise AIProviderError(
                "AI features need the Anthropic Claude API configured. Set ANTHROPIC_API_KEY in "
                "backend/.env (see backend/.env.example for the exact format) — AI_TEXT_PROVIDER "
                "is currently set to 'anthropic', which needs that key."
            )

        kwargs: dict = {}
        if temperature is not None:
            kwargs["temperature"] = temperature

        try:
            message = await get_client().messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                **kwargs,
            )
        except anthropic.AnthropicError as exc:
            # A key IS set but the call itself failed (invalid key, rate limit, outage, network
            # issue) — still a truthful, non-fabricated error. str(exc) is the SDK's own message
            # and never includes the key itself.
            raise AIProviderError(f"Could not reach Anthropic Claude: {exc}") from exc

        text = "\n".join(block.text for block in message.content if block.type == "text").strip()
        usage = getattr(message, "usage", None)
        return AIResult(
            text=text,
            provider=self.name,
            model=model,
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
        )
