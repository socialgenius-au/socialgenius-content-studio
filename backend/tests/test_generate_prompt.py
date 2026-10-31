"""
Video Studio V2 AI Tools — AI Prompt Generator (first of six AI Tools cards).

Focused unit coverage for generate_svc.generate_prompt's own job under the provider-neutral
refactor: assembling this task's prompt (instruction + brand + project context) and handing it
to the central AI service under the "prompt_generation" task id — it no longer knows or cares
which provider actually serves it. Provider/config/routing behaviour itself is covered in
test_ai_router.py; this file mocks app.services.ai.generate_text (the one seam generate_svc
actually calls through) rather than any provider's SDK.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services import generate_svc
from app.services.ai import AIResult


async def test_generate_prompt_routes_through_the_central_ai_service_with_the_right_task():
    """Task 10.1 — prompt_generation routes through the central AI service, not some direct
    provider call generate_svc makes on its own."""
    fake_result = AIResult(text="A 15-second vertical reel opening on...", provider="anthropic", model="claude-sonnet-4-20250514")
    with patch("app.services.generate_svc.ai_service.generate_text", new=AsyncMock(return_value=fake_result)) as mocked:
        result = await generate_svc.generate_prompt("Give me a prompt for a 15s Reel", None, {})
    mocked.assert_awaited_once()
    assert mocked.call_args.args[0] == "prompt_generation"
    assert result is fake_result


async def test_generate_prompt_sends_the_instruction_brand_and_project_context():
    """The whole point of Task 3 (project context) — the brand/project context actually has to
    reach the model, not just be accepted and silently dropped."""
    fake_result = AIResult(text="prompt text", provider="anthropic", model="claude-sonnet-4-20250514")
    with patch("app.services.generate_svc.ai_service.generate_text", new=AsyncMock(return_value=fake_result)) as mocked:
        await generate_svc.generate_prompt(
            "Create a promotional video concept for ABC Tiles",
            {"name": "ABC Tiles", "tone_of_voice": "Authoritative but Simple"},
            {"platform_format": "Instagram - Reel / Story (9:16)", "project_duration_seconds": 15},
        )
    sent_prompt = mocked.call_args.args[1]
    assert "Create a promotional video concept for ABC Tiles" in sent_prompt
    assert "ABC Tiles" in sent_prompt and "Authoritative but Simple" in sent_prompt
    assert "Instagram - Reel / Story (9:16)" in sent_prompt


async def test_generate_prompt_omits_brand_block_when_no_brand_context():
    """No fabricated brand context: when brand_context is None (no Brand row exists), the
    assembled prompt must not mention "Brand:" at all — never invent one from thin air."""
    fake_result = AIResult(text="prompt text", provider="anthropic", model="claude-sonnet-4-20250514")
    with patch("app.services.generate_svc.ai_service.generate_text", new=AsyncMock(return_value=fake_result)) as mocked:
        await generate_svc.generate_prompt("An instruction", None, {"platform_format": "16:9"})
    sent_prompt = mocked.call_args.args[1]
    assert "Brand:" not in sent_prompt


async def test_generate_prompt_returns_the_ai_results_metadata_unchanged():
    """Task 10.5 — provider/model/usage metadata flows back out of generate_svc untouched, so
    the router endpoint can surface it (see test_ai_router.py for the endpoint-level check)."""
    fake_result = AIResult(
        text="prompt text", provider="anthropic", model="claude-sonnet-4-20250514",
        input_tokens=42, output_tokens=128,
    )
    with patch("app.services.generate_svc.ai_service.generate_text", new=AsyncMock(return_value=fake_result)):
        result = await generate_svc.generate_prompt("An instruction", None, {})
    assert result.provider == "anthropic"
    assert result.input_tokens == 42
    assert result.output_tokens == 128
