"""Offline tests: no live image provider requests or spending."""
import asyncio
from unittest.mock import patch

import pytest

from app.services.image_generation import ImageGenerationError, generate_image_png


def test_image_generation_refuses_spend_when_disabled():
    with patch("app.services.image_generation.settings.AI_SPEND_ENABLED", False):
        with patch("httpx.AsyncClient.post") as post:
            with pytest.raises(ImageGenerationError, match="Nothing was sent"):
                asyncio.run(generate_image_png("A product photo"))
            post.assert_not_called()


def test_image_generation_requires_provider_key():
    with patch("app.services.image_generation.settings.AI_SPEND_ENABLED", True):
        with patch("app.services.image_generation.settings.OPENAI_API_KEY", ""):
            with patch("httpx.AsyncClient.post") as post:
                with pytest.raises(ImageGenerationError, match="not configured"):
                    asyncio.run(generate_image_png("A product photo"))
                post.assert_not_called()


def test_image_generation_rejects_blank_prompt_without_network():
    with patch("app.services.image_generation.settings.AI_SPEND_ENABLED", True):
        with patch("app.services.image_generation.settings.OPENAI_API_KEY", "test-key"):
            with patch("httpx.AsyncClient.post") as post:
                with pytest.raises(ImageGenerationError, match="prompt"):
                    asyncio.run(generate_image_png(" "))
                post.assert_not_called()
