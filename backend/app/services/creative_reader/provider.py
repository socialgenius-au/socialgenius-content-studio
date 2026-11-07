"""The Anthropic Creative Read provider: shows Claude the selected keyframes (as images, each labelled with its id, shot and time) together with the measured evidence, and asks for a strictly
structured, evidence-cited reading. Every request goes through the metered client (kill switch, caps, ledger) via app.services.claude.get_client()."""
from __future__ import annotations

import json

import anthropic

from app.config import settings
from app.services.claude import get_client
from app.services.creative_reader.contract import CREATIVE_READ_PROMPT_VERSION, CreativeReadError, CreativeReadResult, FINDING_KINDS, MECHANISM_VOCABULARY
from app.services.creative_reader.validation import parse_json_object, validate

MAX_RESPONSE_TOKENS = 6000

SYSTEM_PROMPT = f"""You are a careful video analyst for a content studio. You are shown selected still frames from ONE short-form video (each labelled with its frame id, shot and time) and the \
measured evidence about it: shot timing, speech transcript segments and on-screen text, each with an id and, where known, a recognition confidence.

Your job: describe what is VISIBLE and what the video APPEARS DESIGNED to do, and extract reusable creative mechanisms, so a different creator could apply the same structure to NEW content.

Hard rules (a response that breaks one is rejected and discarded):
1. Describe only what you can see in the frames or find in the evidence. Never invent a frame, a shot, a line of speech or on-screen text. If a frame is unclear, say so in "limitations".
2. Recognition (speech/on-screen text) can be wrong, especially for mixed languages and AI-generated video. If the evidence looks garbled, do not build conclusions on it; say so in "limitations" and give any finding that cites it low confidence.
3. Every finding cites the evidence it rests on: {{"type": "frame"|"speech"|"text"|"shot", "id": <id>}}, using ONLY ids you were given. "high" confidence needs at least two different kinds of evidence.
4. Intent is always an inference: write "appears designed to ...", "seems to ...", "may function as ...". Never write that it WILL or DID work, never claim results, retention, views, engagement or audience reactions, never say why it "works".
5. "transferable_principle" must be abstract and reusable (no timestamps, no shot numbers, no wording copied from the speech or on-screen text). Put what only applies to this video in "source_specific".
6. Do not quote more than a few words of the source text.

Output ONLY a JSON object, no markdown, in exactly this shape:
{{
  "summary": "2-3 sentences, hedged, what this video appears to do visually and structurally",
  "shots": [{{"shot_order": <int>, "focal_subject": "what the eye is drawn to", "framing": "shot size / angle / composition", "notes": "optional"}}],
  "findings": [{{
     "kind": one of {list(FINDING_KINDS)},
     "statement": "one hedged sentence",
     "start_time": <seconds>, "end_time": <seconds>, "shot_orders": [<int>],
     "evidence": [{{"type": "frame", "id": <int>}}],
     "confidence": "low" | "medium" | "high",
     "mechanism_type": one of {list(MECHANISM_VOCABULARY)},
     "transferable_principle": "abstract, reusable, hedged" or null,
     "source_specific": "what is specific to this video" or null
  }}],
  "limitations": ["anything you could not see, could not trust, or could not conclude"]
}}
At most 14 findings. Prefer fewer, well-supported ones. Cover the opening (the first shot) explicitly."""


def build_messages(prepared: dict, images: list[dict]) -> list[dict]:
    content: list[dict] = [{"type": "text", "text": f"Frames follow in time order ({len(images)} of the video's frames; the rest were not selected). Each is preceded by its label."}]
    for im in images:
        content.append({"type": "text", "text": f"Frame id {im['frame_id']} | shot {im['shot_order']} | t={im['timestamp']:.2f}s"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": im["media_type"], "data": im["data"]}})
    evidence = {k: prepared[k] for k in ("video", "shots", "speech", "text")}
    evidence["frames_shown"] = [{"id": im["frame_id"], "shot_order": im["shot_order"], "t": round(im["timestamp"], 2)} for im in images]
    content.append({"type": "text", "text": "Measured evidence (ids are the only ids you may cite):\n" + json.dumps(evidence, ensure_ascii=False, separators=(",", ":"))})
    return [{"role": "user", "content": content}]


class AnthropicCreativeReader:
    name = "anthropic"

    def is_configured(self) -> bool:
        return bool(settings.ANTHROPIC_API_KEY)

    async def read(self, prepared: dict, images: list[dict], *, model: str) -> CreativeReadResult:
        shown_ids = {im["frame_id"] for im in images}
        shown = dict(prepared)
        shown["frames"] = [f for f in prepared["frames"] if f["id"] in shown_ids]           # validation allows citing only frames that were really shown
        try:
            message = await get_client().messages.create(model=model, max_tokens=MAX_RESPONSE_TOKENS, system=SYSTEM_PROMPT, messages=build_messages(prepared, images))
        except anthropic.AnthropicError as exc:
            raise CreativeReadError(f"Could not get a Creative Read from Claude: {exc}") from exc
        raw = "\n".join(b.text for b in message.content if b.type == "text").strip()
        if getattr(message, "stop_reason", None) == "max_tokens" and not raw:
            raise CreativeReadError(f"The Creative Read response was cut off at {MAX_RESPONSE_TOKENS} tokens before any answer.")
        u = getattr(message, "usage", None)
        usage = {"input_tokens": getattr(u, "input_tokens", None), "output_tokens": getattr(u, "output_tokens", None)}
        return validate(parse_json_object(raw), shown, model=model, usage=usage)
