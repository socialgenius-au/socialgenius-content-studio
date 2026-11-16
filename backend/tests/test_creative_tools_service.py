"""Focused no-cost creative tool tests; no live provider calls."""
from unittest.mock import AsyncMock, patch

import pytest

from app.services import generate_svc
from app.services.ai import AIResult


@pytest.mark.parametrize("task", [
    "hook_generation", "script_generation", "caption_generation", "thumbnail_ideas"
])
async def test_creative_tool_routes_to_configured_provider_neutral_task(task):
    fake = AIResult(text="Editable creative suggestion", provider="mock", model="fixture")
    with patch("app.services.generate_svc.ai_service.generate_text",
               new=AsyncMock(return_value=fake)) as generate:
        result = await generate_svc.generate_creative_tool(
            task, "Make an original video", None,
            {"client": "SocialGenius", "project_duration_seconds": 12}
        )
    assert result is fake
    generate.assert_awaited_once()
    assert generate.call_args.args[0] == task
    assert "SocialGenius" in generate.call_args.args[1]
    assert "structure only" in generate.call_args.args[1]


async def test_creative_tool_rejects_unknown_task_without_provider_call():
    with patch("app.services.generate_svc.ai_service.generate_text",
               new=AsyncMock()) as generate:
        with pytest.raises(ValueError, match="Unsupported"):
            await generate_svc.generate_creative_tool("image_generation", "a", None, {})
        generate.assert_not_awaited()


async def test_creative_tool_rejects_blank_instruction_without_provider_call():
    with patch("app.services.generate_svc.ai_service.generate_text",
               new=AsyncMock()) as generate:
        with pytest.raises(ValueError, match="blank"):
            await generate_svc.generate_creative_tool("hook_generation", "   ", None, {})
        generate.assert_not_awaited()
