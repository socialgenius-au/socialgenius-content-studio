"""Claude-powered content generation — turns a plan step into ready-to-publish copy."""
import json

from app.config import settings
from app.services.claude import get_client

SYSTEM = """You are SocialGenius, a professional social media content writer.
Given a content plan step, write the final production-ready content for the specified platform.

Return ONLY valid JSON (no markdown fences) matching exactly:
{
  "platform": "Instagram",
  "content_type": "caption|email_body|newsletter|gmb_post|script|ad_copy|linkedin_post",
  "content": "the full written content, formatted for the platform",
  "hashtags": ["#tag1", "#tag2"],
  "character_count": 0,
  "cta": "call-to-action text or empty string",
  "notes": "brief production notes for the team or empty string"
}"""


async def generate_content(
    step: dict,
    platform: str,
    tone: str,
    brand_context: dict | None,
    additional_context: str,
    job_summary: str,
    word_limit: int | None = None,
) -> dict:
    brand_block = f"\nBrand: {json.dumps(brand_context)}" if brand_context else ""
    wl_block = f"\nWord/character limit: {word_limit}" if word_limit else ""
    ctx_block = f"\nAdditional context from creator: {additional_context}" if additional_context else ""

    user_msg = (
        f"Platform: {platform}\n"
        f"Tone: {tone}\n"
        f"Campaign summary: {job_summary}\n"
        f"Step to write: {json.dumps(step)}"
        f"{brand_block}{wl_block}{ctx_block}\n\n"
        "Write the content now. Return only the JSON object."
    )

    message = await get_client().messages.create(
        model=settings.CLAUDE_MODEL,
        max_tokens=1024,
        system=SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    )

    text = message.content[0].text.strip()
    try:
        start = text.find("{")
        end = text.rfind("}") + 1
        data = json.loads(text[start:end])
        data["character_count"] = len(data.get("content", ""))
        return data
    except (json.JSONDecodeError, ValueError):
        return {
            "platform": platform,
            "content_type": "copy",
            "content": text,
            "hashtags": [],
            "character_count": len(text),
            "cta": "",
            "notes": "Raw response — JSON parse failed",
        }


CHAT_SYSTEM = """You are SocialGenius, the AI assistant embedded in a social media content studio.
Help the creator plan, write, and refine content conversationally — be concise and actionable.
If brand context is provided, follow its tone of voice. Reference the current editor context
(platform, content type, clip count, playhead position) when it's relevant to the question."""


async def chat_reply(prompt: str, brand_context: dict | None, context: dict) -> str:
    brand_block = f"\nBrand: {json.dumps(brand_context)}" if brand_context else ""
    ctx_block = f"\nCurrent editor context: {json.dumps(context)}" if context else ""

    message = await get_client().messages.create(
        model=settings.CLAUDE_MODEL,
        max_tokens=1024,
        system=CHAT_SYSTEM,
        messages=[{"role": "user", "content": f"{prompt}{brand_block}{ctx_block}"}],
    )
    return message.content[0].text.strip()
