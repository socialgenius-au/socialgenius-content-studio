"""The SocialGenius AI Service/Router — the one place that decides which provider and model
actually handle a given AI task, so no AI Tool (or the frontend) ever hard-codes a provider.

    generate_text(task, prompt)
      -> look up the task's TaskConfig (tasks.py) for its system prompt / tuning
      -> resolve provider: TaskConfig.provider override, else settings.AI_TEXT_PROVIDER
      -> resolve model:    TaskConfig.model override,    else settings.AI_TEXT_MODEL
      -> call that provider's adapter (providers/) and return its normalized AIResult
"""
from app.config import settings

from .providers.anthropic_provider import AnthropicProvider
from .providers.base import AIProvider, AIProviderError, AIResult
from .providers.google_provider import GoogleProvider
from .providers.openai_provider import OpenAIProvider
from .tasks import TASK_CONFIGS

# One instance per provider — providers are stateless aside from lazily caching their own SDK
# client, so these are safe to share across every request/task.
_PROVIDERS: dict[str, AIProvider] = {
    "anthropic": AnthropicProvider(),
    "openai": OpenAIProvider(),
    "google": GoogleProvider(),
}


async def generate_text(task: str, prompt: str) -> AIResult:
    """The one entry point every AI Tool should call through — see this package's __init__.py.
    `prompt` is the fully-assembled user-turn text for this task (instruction + whatever context
    that specific tool has already folded in); assembling it is that tool's own job (e.g.
    generate_svc.generate_prompt), since the shape of "context" is different per task and the
    router has no business knowing it.
    """
    task_config = TASK_CONFIGS.get(task)
    if task_config is None:
        raise AIProviderError(f"Unknown AI task '{task}' — no TaskConfig registered for it.")

    provider_name = task_config.provider or settings.AI_TEXT_PROVIDER
    provider = _PROVIDERS.get(provider_name)
    if provider is None:
        raise AIProviderError(
            f"AI_TEXT_PROVIDER '{provider_name}' is not a recognized provider "
            f"(expected one of: {', '.join(sorted(_PROVIDERS))})."
        )

    model = task_config.model or settings.AI_TEXT_MODEL
    return await provider.generate_text(
        system=task_config.system_prompt,
        prompt=prompt,
        model=model,
        max_tokens=task_config.max_tokens,
        temperature=task_config.temperature,
    )
