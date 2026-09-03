"""
SocialGenius AI service (app/services/ai/) — the provider-neutral router/task-config/provider-
adapter layer every AI Tool goes through instead of any tool hard-wiring a specific provider.

Covers Task 10's own checklist:
  1. prompt_generation routes through the central AI service (also covered by
     test_generate_prompt.py, one layer up).
  2. selected provider is read from backend config (AI_TEXT_PROVIDER).
  3. missing selected-provider key returns a truthful error.
  4. frontend never receives an API key (the error message never contains one).
  5. provider/model metadata can be returned safely.
  6. no fake result is generated when a provider is missing/unimplemented.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.ai import AIProviderError, AIResult, generate_text
from app.services.ai.providers.anthropic_provider import AnthropicProvider
from app.services.ai.providers.google_provider import GoogleProvider
from app.services.ai.providers.openai_provider import OpenAIProvider


class _FakeTextBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class _FakeUsage:
    def __init__(self, input_tokens: int, output_tokens: int):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class _FakeMessage:
    def __init__(self, text: str, usage: _FakeUsage | None = None):
        self.content = [_FakeTextBlock(text)]
        self.usage = usage


# ---------------------------------------------------------------------------
# Task 10.2/10.1 — provider selection reads from config, and generate_text is the one seam
# every task routes through.
# ---------------------------------------------------------------------------

async def test_generate_text_uses_the_configured_default_provider_and_model(monkeypatch):
    monkeypatch.setattr("app.services.ai.router.settings.AI_TEXT_PROVIDER", "anthropic")
    monkeypatch.setattr("app.services.ai.router.settings.AI_TEXT_MODEL", "claude-sonnet-4-20250514")
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(return_value=_FakeMessage("ok", _FakeUsage(10, 20)))
    with patch("app.services.ai.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.ai.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        result = await generate_text("prompt_generation", "an assembled prompt")
    assert result.provider == "anthropic"
    assert result.model == "claude-sonnet-4-20250514"
    call_kwargs = fake_client.messages.create.call_args.kwargs
    assert call_kwargs["model"] == "claude-sonnet-4-20250514"
    assert call_kwargs["messages"][0]["content"] == "an assembled prompt"


async def test_generate_text_switches_provider_purely_from_config(monkeypatch):
    """Task 2's whole point: the caller (generate_svc) never named a provider — only the task id
    changed nothing, only AI_TEXT_PROVIDER did, and the router picked a different adapter."""
    monkeypatch.setattr("app.services.ai.router.settings.AI_TEXT_PROVIDER", "openai")
    with pytest.raises(AIProviderError, match="openai"):
        await generate_text("prompt_generation", "an assembled prompt")


async def test_generate_text_rejects_an_unknown_task():
    with pytest.raises(AIProviderError, match="Unknown AI task"):
        await generate_text("not_a_real_task", "irrelevant")


async def test_generate_text_rejects_an_unrecognized_provider_name(monkeypatch):
    monkeypatch.setattr("app.services.ai.router.settings.AI_TEXT_PROVIDER", "some-made-up-provider")
    with pytest.raises(AIProviderError, match="not a recognized provider"):
        await generate_text("prompt_generation", "irrelevant")


# ---------------------------------------------------------------------------
# Task 10.3/10.4/10.6 — missing key -> truthful error, never a key leak, never a fake result.
# ---------------------------------------------------------------------------

async def test_anthropic_provider_missing_key_gives_truthful_error_naming_the_env_var():
    provider = AnthropicProvider()
    with patch("app.services.ai.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", ""):
        assert provider.is_configured() is False
        with pytest.raises(AIProviderError) as exc_info:
            await provider.generate_text(system="sys", prompt="p", model="m", max_tokens=10, temperature=None)
    assert "ANTHROPIC_API_KEY" in str(exc_info.value)
    assert "backend/.env" in str(exc_info.value)


@pytest.mark.parametrize("provider_cls,key_setting,key_name", [
    (OpenAIProvider, "app.services.ai.providers.openai_provider.settings.OPENAI_API_KEY", "OPENAI_API_KEY"),
    (GoogleProvider, "app.services.ai.providers.google_provider.settings.GOOGLE_AI_API_KEY", "GOOGLE_AI_API_KEY"),
])
async def test_unimplemented_providers_are_honest_never_fake_a_result(provider_cls, key_setting, key_name):
    """Task 6: OpenAI/Google are structured placeholders. Even with a key "configured", calling
    generate_text on them must raise, never fabricate output — is_configured() only reports
    whether a key string is present, it doesn't imply the adapter actually works yet."""
    provider = provider_cls()
    with patch(key_setting, "some-fake-key-value"):
        assert provider.is_configured() is True  # key IS present...
        with pytest.raises(AIProviderError, match="isn't implemented"):
            # ...but generate_text still refuses to fabricate a response
            await provider.generate_text(system="sys", prompt="p", model="m", max_tokens=10, temperature=None)


async def test_provider_error_messages_never_contain_a_real_api_key_value():
    """Task 10.4 — the frontend only ever sees str(AIProviderError). A key IS configured here
    (unlike the "missing key" test above) so this specifically checks the OTHER risk: that
    wrapping a failed call's exception (anthropic.AnthropicError) into AIProviderError never
    interpolates the configured secret value anywhere in the message."""
    import anthropic

    secret = "sk-ant-api03-THIS-SHOULD-NEVER-APPEAR-ANYWHERE"
    provider = AnthropicProvider()
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(side_effect=anthropic.AnthropicError("authentication failed"))
    with patch("app.services.ai.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", secret), \
         patch("app.services.ai.providers.anthropic_provider.get_client", return_value=fake_client):
        with pytest.raises(AIProviderError) as exc_info:
            await provider.generate_text(system="sys", prompt="p", model="m", max_tokens=10, temperature=None)
    assert secret not in str(exc_info.value)


# ---------------------------------------------------------------------------
# Task 10.5 — provider/model/usage metadata can be returned safely (shape check).
# ---------------------------------------------------------------------------

def test_ai_result_carries_provider_model_and_usage_fields():
    result = AIResult(text="hi", provider="anthropic", model="claude-sonnet-4-20250514", input_tokens=5, output_tokens=7)
    assert result.provider == "anthropic"
    assert result.model == "claude-sonnet-4-20250514"
    assert result.input_tokens == 5
    assert result.output_tokens == 7
    assert result.estimated_cost_usd is None  # no pricing table yet — never guessed
