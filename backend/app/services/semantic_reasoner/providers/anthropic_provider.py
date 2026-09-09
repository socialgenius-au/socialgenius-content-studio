"""Stage 10.2B2 — the first REAL semantic-boundary reasoner: an Anthropic Claude adapter
conforming exactly to the Stage 10.2B1 contract (SemanticReasonerProvider).

Reuses app.services.claude.get_client() -- the EXACT SAME lazily-cached AsyncAnthropic client
app.services.ai.providers.anthropic_provider.AnthropicProvider and the older Job Planner/AI
Assistant code (generate_job_plan/generate_content/chat_reply) already share -- rather than
standing up a second Anthropic client architecture. This module is a thin, independent adapter
for the semantic-reasoner contract to go through; it does not modify, wrap, or depend on
app.services.ai.router.generate_text() or AIResult in any way (that pipeline answers a
structurally different question -- freeform text generation for AI Tools -- see contract.py's own
docstring on why the two contracts stay separate).

Stage 10 orchestration never imports this module or `anthropic` directly -- it only ever calls
app.services.semantic_reasoner.reason_about_boundary(evidence_bundle); which concrete provider (if
any) actually answers is resolved by router.py from configuration alone.
"""
import json

import anthropic

from app.config import settings
from app.services.claude import get_client
from app.services.semantic_reasoner.contract import (
    VALID_CONFIDENCE_LEVELS,
    VALID_EVIDENCE_REFERENCE_KEYS,
    ReasonerDecision,
    SemanticReasoningError,
)

from .base import SemanticReasonerProvider

MAX_RESPONSE_TOKENS = 1024

# ── The ONE generic semantic-boundary prompt, used identically for every candidate in every video
# -- no video id, timestamp, language, or expected answer is ever special-cased into this string.
# Per the Stage 10.2B2 task's own explicit "DO NOT CHEAT THE BENCHMARK" section: this prompt is
# written and locked BEFORE any real benchmark call is made, and is never edited afterward to
# chase a particular desired answer. ────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a semantic-boundary analyst for a video content-analysis pipeline.

You are given measured evidence about ONE moment in a video (a "candidate timestamp"): whatever \
speech, on-screen text, shot, and annotation evidence was found immediately before and after it. \
All text is given exactly as it was originally detected -- treat it as the authoritative content, \
never as something to correct, paraphrase away, or assume was mistranscribed.

Answer ONLY this question: does the content immediately AFTER this candidate begin a genuinely \
distinct, coherent unit of meaning compared to the content immediately BEFORE it -- as opposed to \
merely continuing through a technical edit, a pause, a caption change, a camera change, or \
ordinary sentence segmentation?

Rules you must follow:
- A technical shot cut or edit boundary does NOT by itself imply a semantic boundary.
- The ABSENCE of a technical cut does NOT imply semantic continuity -- meaning can change entirely \
within one continuous shot.
- Judge from the actual MEANING of the content itself, not from technical/visual signals alone.
- Any "language" field on speech evidence is only a measured hint from automatic speech \
recognition -- it can be imprecise (for example, a closely related language sometimes gets \
misidentified). Reason from the actual text itself, never treat the language label as ground truth.
- If you can reason directly in the original language of the text, do so. Any internal translation \
you perform must stay private working reasoning -- never present a translation as if it were \
transcribed evidence, and never let it replace the original text in your reasoning.
- If the available evidence is genuinely insufficient to confidently decide either way, set \
is_semantic_boundary to null and confidence to "low" -- never guess just to produce a definite answer.
- Corroborating evidence (multiple sources agreeing) may raise your confidence; contradictory \
evidence should lower it -- never average conflicting signals into a false middle confidence.
- Cite ONLY evidence ids that are explicitly present in the "Valid evidence ids" list you are \
given -- never invent, guess, or renumber an id.
- Do not analyze this content for marketing, hook, CTA, virality, audience, tutorial, medical, or \
educational purposes, and do not produce a Story Beat or narrative-role judgment. Answer only the \
single semantic-boundary question above.
- Keep your reasoning concise (2-3 sentences).

Respond with ONLY a single JSON object, no markdown fencing, no commentary before or after it, \
matching exactly this schema:
{
  "is_semantic_boundary": true | false | null,
  "confidence": "low" | "medium" | "high",
  "confidence_score": null,
  "reasoning": "concise justification",
  "evidence_references": {
    "supporting_shot_ids": [],
    "supporting_speech_segment_ids": [],
    "supporting_text_element_ids": [],
    "supporting_annotation_ids": []
  }
}
Omit any evidence_references key you have nothing to cite for, or give it an empty list. Leave \
confidence_score as null unless you have a genuinely calibrated numeric probability to report \
(ordinarily you do not -- leave it null rather than inventing a number)."""


def _collect_valid_evidence_ids(evidence_bundle: dict) -> dict[str, list[int]]:
    """Every id actually present in this bundle, grouped by the same key names
    evidence_references uses -- given to the model explicitly so it has no reason to invent one,
    and used again afterward by this module to reject any id it cites that isn't in this list."""
    shot_ids = [s["id"] for s in evidence_bundle.get("shots_overlapping") or []]

    speech_ids = [
        evidence_bundle[side]["id"]
        for side in ("speech_before", "speech_after")
        if evidence_bundle.get(side) is not None
    ]

    text_element_ids = [
        evidence_bundle[side]["id"]
        for side in ("ocr_before", "ocr_after")
        if evidence_bundle.get(side) is not None
    ]

    annotation_ids = [
        row["id"]
        for rows in (evidence_bundle.get("nearby_annotations") or {}).values()
        for row in rows
    ]

    return {
        "supporting_shot_ids": shot_ids,
        "supporting_speech_segment_ids": speech_ids,
        "supporting_text_element_ids": text_element_ids,
        "supporting_annotation_ids": annotation_ids,
    }


def _build_user_prompt(evidence_bundle: dict, valid_ids: dict) -> str:
    return (
        "Evidence bundle for one candidate timestamp (JSON):\n"
        + json.dumps(evidence_bundle, ensure_ascii=False, indent=2)
        + "\n\nValid evidence ids you may cite in evidence_references (citing any id not listed "
        "here will be rejected):\n"
        + json.dumps(valid_ids, indent=2)
    )


def _parse_response_json(raw_text: str) -> dict:
    """Mirrors app.services.claude.generate_job_plan's own brace-extraction fallback for a model
    that occasionally wraps JSON in stray prose despite instructions not to -- but, unlike that
    function, never silently returns a placeholder/error dict on failure: this module always
    raises SemanticReasoningError instead, per the "never fabricate a result" contract."""
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass

    start = raw_text.find("{")
    end = raw_text.rfind("}") + 1
    if start == -1 or end <= start:
        raise SemanticReasoningError(f"Anthropic response was not valid JSON and contained no JSON object: {raw_text!r}")
    try:
        return json.loads(raw_text[start:end])
    except json.JSONDecodeError as exc:
        raise SemanticReasoningError(f"Anthropic response could not be parsed as JSON: {exc}") from exc


def _validate_response_shape(data: dict) -> None:
    if not isinstance(data, dict):
        raise SemanticReasoningError(f"Anthropic response JSON must be an object, got {type(data).__name__}.")

    required_keys = {"is_semantic_boundary", "confidence", "reasoning", "evidence_references"}
    missing = required_keys - set(data)
    if missing:
        raise SemanticReasoningError(f"Anthropic response is missing required field(s): {sorted(missing)}.")

    is_boundary = data["is_semantic_boundary"]
    if is_boundary is not None and not isinstance(is_boundary, bool):
        raise SemanticReasoningError(
            f"is_semantic_boundary must be true, false, or null -- got {is_boundary!r}."
        )

    if data["confidence"] not in VALID_CONFIDENCE_LEVELS:
        raise SemanticReasoningError(
            f"confidence must be one of {VALID_CONFIDENCE_LEVELS} -- got {data['confidence']!r}."
        )

    if not isinstance(data["reasoning"], str):
        raise SemanticReasoningError("reasoning must be a string.")

    if not isinstance(data["evidence_references"], dict):
        raise SemanticReasoningError("evidence_references must be an object.")

    confidence_score = data.get("confidence_score")
    if confidence_score is not None and not isinstance(confidence_score, (int, float)):
        raise SemanticReasoningError("confidence_score must be numeric or null.")


def _validate_cited_ids_are_real(evidence_references: dict, valid_ids: dict[str, list[int]]) -> None:
    """Rejects any cited id that was not actually offered to the model -- never allows invented
    provenance. Also rejects any evidence_references key outside the locked v1 subset (the same
    check ReasonerDecision.__post_init__ performs, run here first so a bad key produces a clear,
    provider-attributed SemanticReasoningError rather than a bare ValueError bubbling up)."""
    unknown_keys = set(evidence_references) - VALID_EVIDENCE_REFERENCE_KEYS
    if unknown_keys:
        raise SemanticReasoningError(
            f"Anthropic response cited unsupported evidence_references key(s) {sorted(unknown_keys)}."
        )
    for key, cited_ids in evidence_references.items():
        if not isinstance(cited_ids, list) or not all(isinstance(i, int) for i in cited_ids):
            raise SemanticReasoningError(f"evidence_references['{key}'] must be a list of integer ids, got {cited_ids!r}.")
        allowed = set(valid_ids.get(key, []))
        unknown_ids = set(cited_ids) - allowed
        if unknown_ids:
            raise SemanticReasoningError(
                f"Anthropic response cited evidence_references['{key}'] id(s) {sorted(unknown_ids)} "
                f"that were never offered in this bundle (allowed: {sorted(allowed)}) -- rejecting "
                "rather than allowing invented provenance."
            )


class AnthropicSemanticReasoner(SemanticReasonerProvider):
    name = "anthropic"

    def is_configured(self) -> bool:
        # Reuses the EXACT SAME secret app.services.ai.providers.anthropic_provider.
        # AnthropicProvider already checks -- no second, semantic-reasoner-specific API key exists
        # or is needed.
        return bool(settings.ANTHROPIC_API_KEY)

    async def reason_about_boundary(self, evidence_bundle: dict, *, model: str) -> ReasonerDecision:
        if not self.is_configured():
            raise SemanticReasoningError(
                "The Anthropic semantic reasoner needs ANTHROPIC_API_KEY configured (the same "
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
            raise SemanticReasoningError(f"Could not reach Anthropic Claude for semantic reasoning: {exc}") from exc

        raw_text = "\n".join(block.text for block in message.content if block.type == "text").strip()
        data = _parse_response_json(raw_text)
        _validate_response_shape(data)
        _validate_cited_ids_are_real(data["evidence_references"], valid_ids)

        try:
            return ReasonerDecision(
                is_semantic_boundary=data["is_semantic_boundary"],
                confidence=data["confidence"],
                confidence_score=data.get("confidence_score"),
                reasoning=data["reasoning"],
                evidence_references=data["evidence_references"],
            )
        except ValueError as exc:
            raise SemanticReasoningError(f"Anthropic response failed contract validation: {exc}") from exc
