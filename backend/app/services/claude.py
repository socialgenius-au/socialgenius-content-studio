import json

from anthropic import AsyncAnthropic

from app.config import settings

_client: AsyncAnthropic | None = None


def get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


SYSTEM_PROMPT = """You are the SocialGenius Content Studio AI planner.
Given a plain-English content request, return a structured JSON job plan with no markdown fencing.

Respond with ONLY valid JSON matching this exact schema:
{
  "title": "short job title (max 80 chars)",
  "summary": "one sentence describing what will be produced",
  "platforms": ["Instagram", "LinkedIn", "TikTok", "YouTube", "Facebook", "Email"],
  "content_types": ["video", "image", "copy", "audio", "transcript"],
  "steps": [
    {
      "step": 1,
      "action": "concise action name",
      "description": "detailed instructions",
      "tool": "ffmpeg|whisper|canva|beehiiv|gmb|apify|pixabay|manual",
      "inputs": ["list of input files or data"],
      "outputs": ["list of output files or data"],
      "estimated_duration": "e.g. 5 minutes"
    }
  ],
  "estimated_total_time": "e.g. 45 minutes",
  "brand_guidelines_applied": true
}"""


async def generate_job_plan(prompt: str, brand_context: dict | None = None) -> dict:
    extra = f"\n\nBrand context: {json.dumps(brand_context)}" if brand_context else ""

    message = await get_client().messages.create(
        model=settings.CLAUDE_MODEL,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"{prompt}{extra}"}],
    )

    text = message.content[0].text.strip()
    try:
        start = text.find("{")
        end = text.rfind("}") + 1
        return json.loads(text[start:end])
    except (json.JSONDecodeError, ValueError):
        return {"error": "Could not parse plan", "raw": text, "title": prompt[:80]}
