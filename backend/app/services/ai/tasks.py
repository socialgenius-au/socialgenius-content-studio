"""Task configuration — what each AI Tool needs from the router: its own system prompt, and how
it wants the call tuned (max_tokens, temperature, and an optional provider/model override for
when a specific task genuinely needs a different one than the project-wide default).

Only "prompt_generation" is active right now (AI Prompt Generator, the only implemented AI
Tool). The other four are listed as the identifiers Video Studio V2's remaining AI Tools cards
will use once each is actually built — adding one is just adding a TaskConfig entry here plus a
caller (a generate_svc.py-style function) that assembles that task's prompt; the router/provider
layer underneath already supports it with no further changes.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class TaskConfig:
    system_prompt: str
    max_tokens: int = 1024
    temperature: float | None = None
    # None on either of these means "use this project's configured default" — AI_TEXT_PROVIDER/
    # AI_TEXT_MODEL (see app/config.py) — rather than every task needing to repeat it. A future
    # task can still pin its own provider/model here (e.g. a task that specifically wants
    # Google's image-capable model regardless of the project-wide text default) without
    # affecting any other task.
    provider: str | None = None
    model: str | None = None


PROMPT_GENERATION_SYSTEM = """You are a professional creative director generating production-ready \
prompts/creative briefs for short promotional videos, working inside a video editor called \
SocialGenius Content Studio.

Given a plain-English instruction from the editor and whatever real project context is \
provided (platform, aspect ratio, project duration, existing on-screen text, selected media, \
client/campaign name), write ONE clear, specific, production-ready prompt a video creator or \
an AI video generation tool could act on directly.

Use only the context you are actually given — never invent specific facts about the client's \
business, brand, or audience that were not provided. If some context is missing, write around \
the gap sensibly rather than fabricating specifics.

Return plain text only: the prompt itself, ready to use. No markdown headers, no meta-commentary, \
no "Here is your prompt:" preamble."""


TASK_CONFIGS: dict[str, TaskConfig] = {
    "prompt_generation": TaskConfig(system_prompt=PROMPT_GENERATION_SYSTEM, max_tokens=1024),
    "hook_generation": TaskConfig(system_prompt=(
        "Generate three original short-video hooks for the target business. For each provide "
        "spoken/on-screen words, a specific first shot, and the mechanism used. "
        "Keep within scene timing. Never copy source-business claims or footage, or invent results."
    ), max_tokens=900),
    "script_generation": TaskConfig(system_prompt=(
        "Write a production-ready, original scene-by-scene short-video script for the target "
        "business. Include timestamps, voiceover, on-screen text, visual directions and CTA. "
        "Preserve source structural mechanisms but not source wording, visuals, claims or sensory "
        "cues. Never invent facts or performance. Flag missing facts. Respect scene durations."
    ), max_tokens=1600),
    "caption_generation": TaskConfig(system_prompt=(
        "Write an original platform-specific caption, call to action and relevant hashtags. "
        "Use only provided business facts. Return ready-to-edit text, no invented claims."
    ), max_tokens=900),
    "thumbnail_ideas": TaskConfig(system_prompt=(
        "Provide three practical thumbnail concepts, each with short headline, composition "
        "and legibility guidance. Never fabricate results, endorsements or brand assets."
    ), max_tokens=900),
}
