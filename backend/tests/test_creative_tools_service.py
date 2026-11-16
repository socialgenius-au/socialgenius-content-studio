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


async def test_script_uses_scene_timing_and_relevant_accepted_lessons():
    fake = AIResult(text="Scene script", provider="mock", model="fixture")
    context = {
        "source_business": "Food Company", "target_business": "Social Genius",
        "topic": "Business positioning", "audience": "Business owners",
        "objective": "Book a consultation",
        "scenes": [
            {"start_seconds": 0, "end_seconds": 3, "purpose": "Hook", "mechanism": "Curiosity"},
            {"start_seconds": 3, "end_seconds": 9, "purpose": "Contrast", "mechanism": "Before/after"},
        ],
        "lessons": [
            {"recommendation": "Lead with contrast", "status": "accepted", "relevant_to_target": True},
            {"recommendation": "Claim 10x sales", "status": "dismissed", "relevant_to_target": True},
        ],
    }
    with patch("app.services.generate_svc.ai_service.generate_text",
               new=AsyncMock(return_value=fake)) as generate:
        await generate_svc.generate_creative_tool("script_generation", "Create a reel", None, context)
    prompt = generate.call_args.args[1]
    assert "Scene 1: 0-3s" in prompt
    assert "Lead with contrast" in prompt
    assert "Source business (structure ONLY): Food Company" in prompt
    assert "Relevant accepted lessons" in prompt


async def test_scene_adaptation_rejects_missing_target():
    context = {"scenes": [{"start_seconds": 0, "end_seconds": 3}]}
    with patch("app.services.generate_svc.ai_service.generate_text",
               new=AsyncMock()) as generate:
        with pytest.raises(ValueError, match="Target business"):
            await generate_svc.generate_creative_tool("hook_generation", "Create hook", None, context)
        generate.assert_not_awaited()
