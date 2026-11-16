"""Image generation adapter. No network request unless spending is explicitly enabled."""
import base64
import binascii

import httpx

from app.config import settings


class ImageGenerationError(Exception):
    pass


async def generate_image_png(prompt: str) -> bytes:
    if not settings.AI_SPEND_ENABLED:
        raise ImageGenerationError(
            "AI spending is switched off (AI_SPEND_ENABLED=false). Nothing was sent."
        )
    if not settings.OPENAI_API_KEY:
        raise ImageGenerationError("Image provider is not configured (OPENAI_API_KEY missing).")
    if not prompt.strip() or len(prompt) > 4000:
        raise ImageGenerationError("Image prompt must contain 1–4000 characters.")

    # No automatic retries: a single explicit request can incur a charge.
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                json={
                    "model": "gpt-image-1",
                    "prompt": prompt,
                    "size": "1024x1024",
                    "n": 1,
                    "output_format": "png",
                },
            )
        response.raise_for_status()
        encoded = response.json()["data"][0]["b64_json"]
        output = base64.b64decode(encoded, validate=True)
        if not output.startswith(bytes((137, 80, 78, 71, 13, 10, 26, 10))):
            raise ImageGenerationError("Image provider did not return a PNG.")
        if len(output) > 20 * 1024 * 1024:
            raise ImageGenerationError("Generated image exceeds the 20 MB download limit.")
        return output
    except (httpx.HTTPError, KeyError, IndexError, ValueError, binascii.Error) as exc:
        raise ImageGenerationError(
            "Image provider request failed. Check provider configuration and usage before retrying."
        ) from exc
