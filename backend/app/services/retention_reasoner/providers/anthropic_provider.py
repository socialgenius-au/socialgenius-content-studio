"""Stage 11.4 — the first REAL Retention Device reasoner: an Anthropic Claude adapter conforming
exactly to the Stage 11.4 contract (RetentionReasonerProvider).

A deliberate SIBLING of app.services.hook_reasoner.providers.anthropic_provider, never a
modification of it and never sharing code with it beyond the one already-locked Anthropic client
(app.services.claude.get_client()) and the identical prohibited-language enforcement mechanism
(reused as the exact same pattern, independently applied to Retention's own term list -- see
_reject_prohibited_language below). The prompt/parsing logic is independently written for the
Retention classification question.

Retention orchestration never imports this module or `anthropic` directly -- it only ever calls
app.services.retention_reasoner.classify_retention_candidate(evidence_bundle); which concrete
provider (if any) actually answers is resolved by router.py from configuration alone.
"""
import json

import anthropic

from app.config import settings
from app.services.claude import get_client
from app.services.retention_reasoner.contract import (
    RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR,
    VALID_CONFIDENCE_LEVELS,
    VALID_EVIDENCE_REFERENCE_KEYS,
    RetentionDecision,
    RetentionReasoningError,
)

from .base import RetentionReasonerProvider

MAX_RESPONSE_TOKENS = 1024

# Stage 11.4 — the explicit, stable reasoning-contract version for SYSTEM_PROMPT below. Bumped by
# hand every time SYSTEM_PROMPT's own text meaningfully changes, mirroring HOOK_PROMPT_VERSION's
# own convention exactly, tracked completely independently.
RETENTION_PROMPT_VERSION = "v1"

# Structurally enforced, not merely requested by prompt -- reuses the exact same mechanism as
# hook_reasoner's own _reject_prohibited_language (a case-insensitive substring blocklist), applied
# to Retention's own prohibited-claim categories: this pipeline has no viewer-performance,
# attention, or engagement data of any kind, so no reasoning text may claim any.
PROHIBITED_CLAIM_TERMS = (
    "effective", "effectiveness", "ineffective",
    "engaging", "engagement", "disengaging",
    "compelling", "captivating",
    "retention", "retain viewers", "retained viewers", "watch time", "watch-time",
    "attention span", "held attention", "holds attention", "kept viewers", "keeps viewers",
    "viral", "virality",
    "convert", "conversion",
    "successful", "success rate", "performed well", "performs well", "high-performing", "underperform",
    "score", "rating of", "strong device", "weak device",
)


def _reject_prohibited_language(*texts: str) -> None:
    """Structural backstop: raises RetentionReasoningError if ANY supplied text contains a
    prohibited actual-retention/attention/engagement/performance claim -- checked case-
    insensitively, regardless of how the prompt itself is worded."""
    for text in texts:
        if not text:
            continue
        lowered = text.lower()
        for term in PROHIBITED_CLAIM_TERMS:
            if term in lowered:
                raise RetentionReasoningError(
                    f"Anthropic Retention response contains a prohibited actual-retention/attention/"
                    f"performance claim (matched {term!r}) -- Stage 11.4 must never claim actual "
                    f"viewer retention, attention, engagement, or an effectiveness score. Rejecting "
                    f"rather than persisting: {text!r}"
                )


# ── The ONE generic Retention Device classification prompt, used identically for every candidate. ──
SYSTEM_PROMPT = """You are a structural content analyst for a video content-analysis pipeline. You \
classify ONE already-identified CANDIDATE MOMENT in a short-form video -- an already-fixed, already-\
grouped time span you are given, never one you decide, adjust, or re-group yourself.

You will be given a bounded local evidence bundle: whatever spoken transcript, on-screen text, \
shot, visual-object, motion/camera, transition, silence, Scene, Story Beat, and editing-pacing-\
phase evidence exists in a short window immediately around this candidate, and ONLY that window. \
Do not assume anything about the rest of the video beyond what this bundle tells you. You are also \
given the specific "source_nominations" that caused this moment to be nominated as a candidate at \
all (e.g. a shot cut, a Story Beat boundary, a pacing change, on-screen text appearing) -- use these \
as your starting point, not as something to independently re-derive.

Your job is to decide: does this moment appear structurally designed to maintain a viewer's \
attention or interest at that point in the video -- and if so, what KIND of device does it appear \
to be? You are NOT deciding whether it actually worked. You have no viewer data of any kind.

STRICT RULES YOU MUST FOLLOW:
- Classify ONLY from the supplied evidence. Never invent, assume, or imagine visuals, audio, or \
text that is not present in the bundle.
- NEVER infer or state anything about actual viewer attention, retention, engagement, watch time, \
conversion, or virality. You have no such data and must not pretend otherwise.
- NEVER assign an effectiveness score, quality score, or a strong/weak rating of any kind.
- Phrase any design-level reasoning as "this moment appears designed to..." -- never as "this kept \
viewers watching" or any language implying a known outcome.
- Classify device_type as "question" ONLY if the transcript or on-screen text evidence itself \
actually contains a real question (spoken or written words forming a question, not merely a bare \
"?" character with no supporting content, and not merely because the candidate happens to sit near \
a question mark in unrelated text).
- Classify device_type as "pattern_interrupt" or "emphasis" ONLY when you see a genuine COMBINATION \
of evidence signals working together (for example: an unusually short shot immediately after several \
much longer ones, PLUS a transition or motion signal at the same moment) -- never for a single, \
ordinary cut or an ordinary shot change with nothing else notable about it. An ordinary shot cut \
with no other supporting signal should usually be classified as "visual_change" or "scene_switch" \
instead, or "unclear" if even that is not well supported.
- If the evidence is genuinely insufficient to confidently choose any device_type, or the moment \
does not appear to be a real attention-maintenance device at all, set device_type to "unclear" -- \
never force a listed type onto weak or absent evidence.
- Clearly separate FACT from INTERPRETATION in your own reasoning: cite what is factually present \
(spoken text, on-screen text, a cut, a visible person, a camera move, a pacing-phase change) \
separately from what you infer it suggests about apparent design.
- Cite ONLY evidence ids that are explicitly present in the "Valid evidence ids" list you are \
given -- never invent, guess, or renumber an id.
- Any "language" field on speech evidence is only a measured hint from automatic speech \
recognition -- reason from the actual text itself, never treat the language label as ground truth.
- If you can reason directly in the original language of the text, do so; keep any internal \
translation as private working reasoning only, never presented as if it were transcribed evidence.
- Keep your reasoning concise (1-3 sentences) and free of any of the prohibited claims above.

Valid device_type values: {device_types}

Respond with ONLY a single JSON object, no markdown fencing, no commentary before or after it, \
matching exactly this schema:
{{
  "device_type": "one of the valid device_type values",
  "confidence": "low" | "medium" | "high",
  "reasoning": "concise, fact-then-interpretation justification, never a retention/attention/performance claim",
  "evidence_references": {{"supporting_speech_segment_ids": [], "supporting_text_element_ids": [], "supporting_shot_ids": [], "supporting_visual_object_ids": [], "supporting_scene_ids": [], "supporting_story_beat_ids": [], "supporting_annotation_ids": []}}
}}
Omit any evidence_references key you have nothing to cite for, or give it an empty list.""".format(
    device_types=", ".join(sorted(RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR)),
)


def _collect_valid_evidence_ids(evidence_bundle: dict) -> dict[str, list[int]]:
    """Every id actually present in this candidate's local evidence bundle, grouped by the same key
    names evidence_references uses -- given to the model explicitly so it has no reason to invent
    one, and used again afterward by this module to reject any id it cites that isn't in this
    list. Deliberately mirrors hook_reasoner's own _collect_valid_evidence_ids exactly, since both
    bundles share the same underlying evidence-table field shapes."""
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
        "Candidate moment local evidence bundle (JSON):\n"
        + json.dumps(evidence_bundle, ensure_ascii=False, indent=2)
        + "\n\nValid evidence ids you may cite in evidence_references (citing any id not listed "
        "here will be rejected):\n"
        + json.dumps(valid_ids, indent=2)
    )


def _parse_response_json(raw_text: str) -> dict:
    """Mirrors hook_reasoner's own brace-extraction fallback -- never silently returns a
    placeholder on failure, always raises RetentionReasoningError instead."""
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass

    start = raw_text.find("{")
    end = raw_text.rfind("}") + 1
    if start == -1 or end <= start:
        raise RetentionReasoningError(f"Anthropic response was not valid JSON and contained no JSON object: {raw_text!r}")
    try:
        return json.loads(raw_text[start:end])
    except json.JSONDecodeError as exc:
        raise RetentionReasoningError(f"Anthropic response could not be parsed as JSON: {exc}") from exc


def _validate_response_shape(data: dict) -> None:
    if not isinstance(data, dict):
        raise RetentionReasoningError(f"Anthropic response JSON must be an object, got {type(data).__name__}.")

    required_keys = {"device_type", "confidence", "reasoning", "evidence_references"}
    missing = required_keys - set(data)
    if missing:
        raise RetentionReasoningError(f"Anthropic response is missing required field(s): {sorted(missing)}.")

    if data["device_type"] not in RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR:
        raise RetentionReasoningError(
            f"device_type must be one of {sorted(RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR)} -- got {data['device_type']!r}."
        )

    if data["confidence"] not in VALID_CONFIDENCE_LEVELS:
        raise RetentionReasoningError(f"confidence must be one of {VALID_CONFIDENCE_LEVELS} -- got {data['confidence']!r}.")

    if not isinstance(data["reasoning"], str):
        raise RetentionReasoningError("reasoning must be a string.")

    if not isinstance(data["evidence_references"], dict):
        raise RetentionReasoningError("evidence_references must be an object.")


def _validate_evidence_ref_dict(evidence_references: dict, valid_ids: dict[str, list[int]]) -> None:
    unknown_keys = set(evidence_references) - VALID_EVIDENCE_REFERENCE_KEYS
    if unknown_keys:
        raise RetentionReasoningError(f"Anthropic response cited unsupported evidence_references key(s) {sorted(unknown_keys)}.")
    for key, cited_ids in evidence_references.items():
        if not isinstance(cited_ids, list) or not all(isinstance(i, int) for i in cited_ids):
            raise RetentionReasoningError(f"evidence_references['{key}'] must be a list of integer ids, got {cited_ids!r}.")
        allowed = set(valid_ids.get(key, []))
        unknown_ids = set(cited_ids) - allowed
        if unknown_ids:
            raise RetentionReasoningError(
                f"Anthropic response cited evidence_references['{key}'] id(s) {sorted(unknown_ids)} "
                f"that were never offered in this bundle (allowed: {sorted(allowed)}) -- rejecting "
                "rather than allowing invented provenance."
            )


class AnthropicRetentionReasoner(RetentionReasonerProvider):
    name = "anthropic"

    def is_configured(self) -> bool:
        # Reuses the EXACT SAME secret every other Anthropic-backed reasoner in this codebase
        # already checks -- no second, Retention-specific API key exists or is needed.
        return bool(settings.ANTHROPIC_API_KEY)

    async def classify_retention_candidate(self, evidence_bundle: dict, *, model: str) -> RetentionDecision:
        if not self.is_configured():
            raise RetentionReasoningError(
                "The Anthropic Retention reasoner needs ANTHROPIC_API_KEY configured (the same "
                "setting app/services/ai/ already uses) -- set it in backend/.env."
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
            raise RetentionReasoningError(f"Could not reach Anthropic Claude for Retention classification: {exc}") from exc

        raw_text = "\n".join(block.text for block in message.content if block.type == "text").strip()
        data = _parse_response_json(raw_text)
        _validate_response_shape(data)
        _validate_evidence_ref_dict(data["evidence_references"], valid_ids)
        _reject_prohibited_language(data["reasoning"])

        try:
            return RetentionDecision(
                device_type=data["device_type"],
                confidence=data["confidence"],
                reasoning=data["reasoning"],
                evidence_references=data["evidence_references"],
                reasoning_contract_version=RETENTION_PROMPT_VERSION,
            )
        except ValueError as exc:
            raise RetentionReasoningError(f"Anthropic response failed contract validation: {exc}") from exc
