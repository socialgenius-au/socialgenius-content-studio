"""Stage 11.3 — the first REAL Hook reasoner: an Anthropic Claude adapter conforming exactly to
the Stage 11.3 contract (HookReasonerProvider).

A deliberate SIBLING of app.services.story_beat_reasoner.providers.anthropic_provider and
app.services.semantic_reasoner.providers.anthropic_provider, never a modification of either and
never sharing code with them beyond the one already-locked Anthropic client
(app.services.claude.get_client()). The prompt/parsing logic below is independently written for
the Hook classification question -- copying their shape (defensive JSON parsing, categorical
confidence validation, evidence-id provenance discipline) is intentional convergent design, not
code reuse.

Hook orchestration never imports this module or `anthropic` directly -- it only ever calls
app.services.hook_reasoner.classify_hook(evidence_bundle); which concrete provider (if any)
actually answers is resolved by router.py from configuration alone.
"""
import json

import anthropic

from app.config import settings
from app.services.claude import get_client
from app.services.hook_reasoner.contract import (
    HOOK_INTENT_VALUES,
    HOOK_TYPE_VALUES,
    PRIMARY_HOOK_TYPE_VALUES,
    VALID_CONFIDENCE_LEVELS,
    VALID_EVIDENCE_REFERENCE_KEYS,
    HookDecision,
    HookElement,
    HookReasoningError,
)

from .base import HookReasonerProvider

MAX_RESPONSE_TOKENS = 1536

# Stage 11.3 — the explicit, stable reasoning-contract version for SYSTEM_PROMPT below. Bumped by
# hand every time SYSTEM_PROMPT's own text meaningfully changes, mirroring
# STORY_BEAT_PROMPT_VERSION's own convention exactly, tracked completely independently.
HOOK_PROMPT_VERSION = "v1"

# Structurally enforced, not merely requested by prompt (see _reject_prohibited_language below) --
# a case-insensitive substring blocklist covering the exact claim categories Section 7 of the
# Stage 11.3 brief explicitly prohibits: effectiveness/quality scoring, and any claim of actual
# viewer response (retention, conversion, virality, "success"). Deliberately a plain substring
# list, not a fancy NLP check -- the goal is a hard structural backstop behind the prompt's own
# instructions, not a perfect natural-language classifier of every possible phrasing.
PROHIBITED_CLAIM_TERMS = (
    "effective", "effectiveness", "ineffective",
    "engaging", "engagement", "disengaging",
    "compelling", "captivating",
    "retention", "retain viewers", "retained viewers", "watch time", "watch-time",
    "viral", "virality",
    "convert", "conversion",
    "successful", "success rate", "performed well", "performs well", "high-performing", "underperform",
    "score", "rating of", "strong hook", "weak hook",
)


def _reject_prohibited_language(*texts: str) -> None:
    """Structural backstop: raises HookReasoningError if ANY supplied text contains a prohibited
    performance/effectiveness/retention/virality/conversion claim -- checked case-insensitively,
    regardless of how the prompt itself is worded. This is intentionally NOT limited to a specific
    field: `reasoning` and `probable_intent`-adjacent free text are both checked, since a model
    could smuggle a prohibited claim into either."""
    for text in texts:
        if not text:
            continue
        lowered = text.lower()
        for term in PROHIBITED_CLAIM_TERMS:
            if term in lowered:
                raise HookReasoningError(
                    f"Anthropic Hook response contains a prohibited performance/effectiveness claim "
                    f"(matched {term!r}) -- Stage 11.3 must never claim viewer response, retention, "
                    f"conversion, virality, or an effectiveness score. Rejecting rather than persisting: {text!r}"
                )


# ── The ONE generic Hook classification prompt, used identically for every video. ─────────────────
SYSTEM_PROMPT = """You are a structural content analyst for a video content-analysis pipeline. You \
classify the OPENING "Hook Window" of a short-form video -- an already-fixed time range you are \
given, never one you decide or adjust yourself.

You will be given a bounded evidence bundle: whatever spoken transcript, on-screen text, shot, \
visual-object, motion/camera, transition, silence, Scene, Story Beat, and editing-rhythm evidence \
was measured or already inferred for that window, and ONLY that window. Do not assume anything \
about the rest of the video beyond what this bundle tells you.

Your job has exactly three parts:
1. Classify the PRIMARY type of hook that appears (one type only), and zero or more SECONDARY \
types if the opening genuinely combines more than one recognizable pattern.
2. Identify the specific HOOK ELEMENTS that appear to compose it (e.g. a spoken line, an on-screen \
headline, a visual subject, a camera/motion change, a cut or pattern interruption, an opening \
question) -- each one citing the specific evidence id(s) that support it.
3. Infer a PROBABLE INTENT the opening appears designed to serve -- an inference about apparent \
DESIGN, never a claim about what actually happened to any viewer.

STRICT RULES YOU MUST FOLLOW:
- Classify ONLY from the supplied evidence. Never invent, assume, or imagine visuals, audio, or \
text that is not present in the bundle.
- NEVER infer or state anything about actual viewer response, attention, retention, watch time, \
conversion, or virality. You have no such data and must not pretend otherwise.
- NEVER assign an effectiveness score, quality score, or a strong/weak rating of any kind. This \
pipeline currently has no viewer-performance evidence at all -- do not compensate for that by \
guessing.
- Phrase probable_intent-supporting reasoning as "the opening appears designed to..." -- never as \
"this hook successfully..." or any language implying a known outcome.
- If the evidence is genuinely insufficient to confidently choose a primary type, set primary_type \
to "unclear" -- never force a listed type onto weak or absent evidence.
- If the evidence does not support even a limited intent inference, set probable_intent to null.
- Clearly separate FACT from INTERPRETATION in your own reasoning: cite what is factually present \
(spoken text, on-screen text, a cut, a visible person, a camera move) separately from what you \
infer it suggests.
- Cite ONLY evidence ids that are explicitly present in the "Valid evidence ids" list you are \
given -- never invent, guess, or renumber an id.
- Any "language" field on speech evidence is only a measured hint from automatic speech \
recognition -- reason from the actual text itself, never treat the language label as ground truth.
- If you can reason directly in the original language of the text, do so; keep any internal \
translation as private working reasoning only, never presented as if it were transcribed evidence.
- Keep your reasoning concise (2-4 sentences) and free of any of the prohibited claims above.

Valid primary_type values: {primary_types}
Valid secondary_types values (never "unclear"): {secondary_types}
Valid probable_intent values (or null): {intent_values}

Respond with ONLY a single JSON object, no markdown fencing, no commentary before or after it, \
matching exactly this schema:
{{
  "primary_type": "one of the valid primary_type values",
  "secondary_types": ["zero or more of the valid secondary_types values"],
  "hook_elements": [
    {{"element_type": "short description, e.g. spoken_question, on_screen_headline, visual_subject, camera_motion_change, cut_or_pattern_interruption",
      "evidence_references": {{"supporting_speech_segment_ids": [], "supporting_text_element_ids": [], "supporting_shot_ids": [], "supporting_visual_object_ids": [], "supporting_scene_ids": [], "supporting_story_beat_ids": [], "supporting_annotation_ids": []}}}}
  ],
  "probable_intent": "one of the valid probable_intent values, or null",
  "confidence": "low" | "medium" | "high",
  "reasoning": "concise, fact-then-interpretation justification, never a performance claim",
  "evidence_references": {{"supporting_speech_segment_ids": [], "supporting_text_element_ids": [], "supporting_shot_ids": [], "supporting_visual_object_ids": [], "supporting_scene_ids": [], "supporting_story_beat_ids": [], "supporting_annotation_ids": []}}
}}
Omit any evidence_references key you have nothing to cite for, or give it an empty list.""".format(
    primary_types=", ".join(sorted(PRIMARY_HOOK_TYPE_VALUES)),
    secondary_types=", ".join(sorted(HOOK_TYPE_VALUES)),
    intent_values=", ".join(sorted(HOOK_INTENT_VALUES)),
)


def _collect_valid_evidence_ids(evidence_bundle: dict) -> dict[str, list[int]]:
    """Every id actually present in this Hook evidence bundle, grouped by the same key names
    evidence_references uses -- given to the model explicitly so it has no reason to invent one,
    and used again afterward by this module to reject any id it cites that isn't in this list."""
    return {
        "supporting_shot_ids": [s["id"] for s in evidence_bundle.get("shots") or []],
        "supporting_speech_segment_ids": [s["id"] for s in evidence_bundle.get("speech_segments") or []],
        "supporting_text_element_ids": [t["id"] for t in evidence_bundle.get("text_elements") or []],
        "supporting_visual_object_ids": [v["id"] for v in evidence_bundle.get("visual_objects") or []],
        "supporting_scene_ids": [s["id"] for s in evidence_bundle.get("scenes") or []],
        "supporting_story_beat_ids": [b["id"] for b in evidence_bundle.get("story_beats") or []],
        "supporting_annotation_ids": [
            a["id"] for a in (
                (evidence_bundle.get("motion_evidence") or [])
                + (evidence_bundle.get("transition_evidence") or [])
                + (evidence_bundle.get("audio_silence") or [])
                + (evidence_bundle.get("editing_pacing_phases") or [])
            )
        ],
    }


def _build_user_prompt(evidence_bundle: dict, valid_ids: dict) -> str:
    return (
        "Hook Window evidence bundle (JSON):\n"
        + json.dumps(evidence_bundle, ensure_ascii=False, indent=2)
        + "\n\nValid evidence ids you may cite in evidence_references (citing any id not listed "
        "here will be rejected):\n"
        + json.dumps(valid_ids, indent=2)
    )


def _parse_response_json(raw_text: str) -> dict:
    """Mirrors the Story Beat/Semantic reasoners' own brace-extraction fallback -- never silently
    returns a placeholder on failure, always raises HookReasoningError instead."""
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass

    start = raw_text.find("{")
    end = raw_text.rfind("}") + 1
    if start == -1 or end <= start:
        raise HookReasoningError(f"Anthropic response was not valid JSON and contained no JSON object: {raw_text!r}")
    try:
        return json.loads(raw_text[start:end])
    except json.JSONDecodeError as exc:
        raise HookReasoningError(f"Anthropic response could not be parsed as JSON: {exc}") from exc


def _validate_response_shape(data: dict) -> None:
    if not isinstance(data, dict):
        raise HookReasoningError(f"Anthropic response JSON must be an object, got {type(data).__name__}.")

    required_keys = {"primary_type", "secondary_types", "hook_elements", "probable_intent", "confidence", "reasoning", "evidence_references"}
    missing = required_keys - set(data)
    if missing:
        raise HookReasoningError(f"Anthropic response is missing required field(s): {sorted(missing)}.")

    if data["primary_type"] not in PRIMARY_HOOK_TYPE_VALUES:
        raise HookReasoningError(f"primary_type must be one of {sorted(PRIMARY_HOOK_TYPE_VALUES)} -- got {data['primary_type']!r}.")

    if not isinstance(data["secondary_types"], list) or any(t not in HOOK_TYPE_VALUES for t in data["secondary_types"]):
        raise HookReasoningError(f"secondary_types must be a list drawn only from {sorted(HOOK_TYPE_VALUES)} -- got {data['secondary_types']!r}.")

    if not isinstance(data["hook_elements"], list):
        raise HookReasoningError("hook_elements must be a list.")

    if data["probable_intent"] is not None and data["probable_intent"] not in HOOK_INTENT_VALUES:
        raise HookReasoningError(f"probable_intent must be null or one of {sorted(HOOK_INTENT_VALUES)} -- got {data['probable_intent']!r}.")

    if data["confidence"] not in VALID_CONFIDENCE_LEVELS:
        raise HookReasoningError(f"confidence must be one of {VALID_CONFIDENCE_LEVELS} -- got {data['confidence']!r}.")

    if not isinstance(data["reasoning"], str):
        raise HookReasoningError("reasoning must be a string.")

    if not isinstance(data["evidence_references"], dict):
        raise HookReasoningError("evidence_references must be an object.")


def _validate_evidence_ref_dict(evidence_references: dict, valid_ids: dict[str, list[int]], where: str) -> None:
    unknown_keys = set(evidence_references) - VALID_EVIDENCE_REFERENCE_KEYS
    if unknown_keys:
        raise HookReasoningError(f"Anthropic response ({where}) cited unsupported evidence_references key(s) {sorted(unknown_keys)}.")
    for key, cited_ids in evidence_references.items():
        if not isinstance(cited_ids, list) or not all(isinstance(i, int) for i in cited_ids):
            raise HookReasoningError(f"evidence_references['{key}'] ({where}) must be a list of integer ids, got {cited_ids!r}.")
        allowed = set(valid_ids.get(key, []))
        unknown_ids = set(cited_ids) - allowed
        if unknown_ids:
            raise HookReasoningError(
                f"Anthropic response ({where}) cited evidence_references['{key}'] id(s) {sorted(unknown_ids)} "
                f"that were never offered in this bundle (allowed: {sorted(allowed)}) -- rejecting "
                "rather than allowing invented provenance."
            )


class AnthropicHookReasoner(HookReasonerProvider):
    name = "anthropic"

    def is_configured(self) -> bool:
        # Reuses the EXACT SAME secret every other Anthropic-backed reasoner in this codebase
        # already checks -- no second, Hook-specific API key exists or is needed.
        return bool(settings.ANTHROPIC_API_KEY)

    async def classify_hook(self, evidence_bundle: dict, *, model: str) -> HookDecision:
        if not self.is_configured():
            raise HookReasoningError(
                "The Anthropic Hook reasoner needs ANTHROPIC_API_KEY configured (the same setting "
                "app/services/ai/ already uses) -- set it in backend/.env."
            )

        valid_ids = _collect_valid_evidence_ids(evidence_bundle)
        user_prompt = _build_user_prompt(evidence_bundle, valid_ids)

        try:
            message = await get_client().messages.create(
                model=model,
                max_tokens=MAX_RESPONSE_TOKENS,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}],
            )
        except anthropic.AnthropicError as exc:
            raise HookReasoningError(f"Could not reach Anthropic Claude for Hook classification: {exc}") from exc

        raw_text = "\n".join(block.text for block in message.content if block.type == "text").strip()
        data = _parse_response_json(raw_text)
        _validate_response_shape(data)

        _validate_evidence_ref_dict(data["evidence_references"], valid_ids, "top-level evidence_references")
        for element in data["hook_elements"]:
            if not isinstance(element, dict) or "element_type" not in element:
                raise HookReasoningError(f"Each hook_elements entry must be an object with 'element_type' -- got {element!r}.")
            _validate_evidence_ref_dict(element.get("evidence_references") or {}, valid_ids, f"hook_elements[{element.get('element_type')!r}]")

        _reject_prohibited_language(data["reasoning"])

        try:
            return HookDecision(
                primary_type=data["primary_type"],
                confidence=data["confidence"],
                reasoning=data["reasoning"],
                secondary_types=data["secondary_types"],
                hook_elements=[
                    HookElement(element_type=e["element_type"], evidence_references=e.get("evidence_references") or {})
                    for e in data["hook_elements"]
                ],
                probable_intent=data["probable_intent"],
                evidence_references=data["evidence_references"],
                reasoning_contract_version=HOOK_PROMPT_VERSION,
            )
        except ValueError as exc:
            raise HookReasoningError(f"Anthropic response failed contract validation: {exc}") from exc
