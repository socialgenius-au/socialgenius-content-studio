"""SocialGenius AI service — the one provider-neutral entry point every AI Tool should call
through, rather than any tool reaching for a specific provider's SDK directly.

    AI Tool (e.g. generate_svc.generate_prompt)
      -> router.generate_text(task, prompt)          <- this package's public entry point
      -> tasks.TASK_CONFIGS[task]                     (system prompt, max_tokens, temperature,
                                                         optional provider/model override)
      -> providers.base.AIProvider (anthropic today; openai/google are structured stubs)
      -> external AI API

Only `router.generate_text` and `providers.base.AIProviderError`/`AIResult` are meant to be
imported from outside this package — everything else (which provider is active, which model,
how a task's prompt is built) is an internal implementation detail the caller never needs.
"""
from app.services.ai.providers.base import AIProviderError, AIResult
from app.services.ai.router import generate_text

__all__ = ["generate_text", "AIResult", "AIProviderError"]
