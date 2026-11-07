"""Creative Read: an AI looks at selected keyframes next to the measured evidence and returns evidence-cited, hedged findings with reusable mechanisms. Off unless an operator opts in
(CREATIVE_READ_REASONER_PROVIDER) AND AI spending is switched on (AI_SPEND_ENABLED); every request is metered (app.services.ai_metering)."""
from app.config import settings
from app.services.ai_metering import run_reasoner_call
from app.services.creative_reader.contract import CreativeReadError, CreativeReadInputError, CreativeReadResult
from app.services.creative_reader.provider import AnthropicCreativeReader

_PROVIDERS = {"anthropic": AnthropicCreativeReader()}


async def read_video(prepared: dict, images: list[dict]) -> CreativeReadResult:
    name = settings.CREATIVE_READ_REASONER_PROVIDER
    if not name:
        raise CreativeReadError(f"No Creative Read reasoner is configured (CREATIVE_READ_REASONER_PROVIDER is empty). Set it to one of: {', '.join(sorted(_PROVIDERS))} to opt in explicitly.")
    provider = _PROVIDERS.get(name)
    if provider is None:
        raise CreativeReadError(f"CREATIVE_READ_REASONER_PROVIDER '{name}' is not recognised (expected one of: {', '.join(sorted(_PROVIDERS))}).")
    if not provider.is_configured():
        raise CreativeReadError(f"Creative Read reasoner '{name}' is registered but not configured (its API key is missing).")
    return await run_reasoner_call(lambda: provider.read(prepared, images, model=settings.CREATIVE_READ_REASONER_MODEL))


__all__ = ["read_video", "CreativeReadError", "CreativeReadInputError", "CreativeReadResult"]
