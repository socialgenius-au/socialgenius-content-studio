"""Verify no provider call occurs when spending is disabled."""
import unittest
from unittest.mock import patch

from app.services.ai import AIProviderError
from app.services.ai.router import generate_text


class SpendGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_creative_tasks_blocked_before_provider(self):
        tasks = ("prompt_generation", "hook_generation", "script_generation",
                 "caption_generation", "thumbnail_ideas")
        with patch("app.services.ai.router.settings.AI_SPEND_ENABLED", False):
            with patch("app.services.ai.router._PROVIDERS") as providers:
                for task in tasks:
                    with self.subTest(task=task):
                        with self.assertRaisesRegex(AIProviderError, "spending is switched off"):
                            await generate_text(task, "test input")
                providers.get.assert_not_called()


if __name__ == "__main__":
    unittest.main()
