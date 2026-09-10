"""Stage 10.3B2 — the first REAL Story Beat reasoner: an Anthropic Claude adapter conforming
exactly to the Stage 10.3B1 contract (StoryBeatReasonerProvider).

A deliberate SIBLING of app.services.semantic_reasoner.providers.anthropic_provider, never a
modification of it and never sharing code with it beyond the one already-locked Anthropic client
(app.services.claude.get_client() -- the SAME lazily-cached AsyncAnthropic client every other
Anthropic-backed feature in this codebase already shares). The Semantic Scene prompt/parsing logic
below is independently written for the Story Beat question -- copying its shape (defensive JSON
parsing, categorical confidence validation, evidence-id provenance discipline) is intentional
convergent design, not code reuse; the two prompt strings, provider classes, and error types remain
fully independent so that they can evolve on separate schedules.

Stage 10.3 orchestration never imports this module or `anthropic` directly -- it only ever calls
app.services.story_beat_reasoner.reason_about_story_beat_boundary(candidate_bundle); which concrete
provider (if any) actually answers is resolved by router.py from configuration alone.
"""
import json

import anthropic

from app.config import settings
from app.services.claude import get_client
from app.services.story_beat_reasoner.contract import (
    VALID_CONFIDENCE_LEVELS,
    VALID_EVIDENCE_REFERENCE_KEYS,
    StoryBeatDecision,
    StoryBeatReasoningError,
)

from .base import StoryBeatReasonerProvider

MAX_RESPONSE_TOKENS = 1024

# Stage 10.3B2 — the explicit, stable reasoning-contract version for SYSTEM_PROMPT below. Bumped by
# hand every time SYSTEM_PROMPT's own text meaningfully changes, mirroring
# semantic_reasoner.providers.anthropic_provider.SEMANTIC_BOUNDARY_PROMPT_VERSION's own convention
# exactly -- but tracked completely independently, since the two prompts are unrelated texts that
# will each change on their own schedule. "v1" is this prompt's first-ever version; there is no
# prior Story Beat prompt to compare it against.
STORY_BEAT_PROMPT_VERSION = "v1"

# ── The ONE generic Story Beat prompt, used identically for every candidate in every video, in
# every content domain -- no video id, timestamp, language, domain, or expected answer is ever
# special-cased into this string. ───────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a rhetorical/communicative-movement analyst for a video content-analysis \
pipeline. Your job is unrelated to, and must not be confused with, a separate "Semantic Scene" \
analysis pipeline that answers a different question about the same footage.

You are given measured evidence about ONE moment in a video (a "candidate timestamp"): whatever \
speech, on-screen text, shot, and annotation evidence was found immediately before and after it. \
All text is given exactly as it was originally detected -- treat it as the authoritative content, \
never as something to correct, paraphrase away, or assume was mistranscribed.

Answer ONLY this question: at this candidate moment, does the source make a meaningful rhetorical \
or communicative move -- even if the underlying topic, proposition, or function the content is \
serving remains exactly the same?

This is a fundamentally DIFFERENT and NARROWER-IN-ONE-SENSE-BUT-BROADER-IN-ANOTHER question than \
asking whether a new Scene (a new central proposition, topic, or function) begins here. A Story \
Beat can occur, and very often does occur, entirely INSIDE a single continuous Scene that never \
itself changes topic or proposition -- for example, explanation shifting into example, a plain \
statement shifting into a qualification of itself, a claim shifting into supporting evidence or a \
demonstration of it, a setup shifting into a contrast, a description shifting into emphasis, an \
argument shifting into a summary of itself, or simply one communicative move giving way to another. \
Those are illustrative examples of the KIND of shift you are looking for -- never a fixed list, \
never a type to assign, and never something you name or categorize in your answer. You are asked \
only WHETHER such a shift genuinely occurs here, never WHAT kind of shift it is.

Story Beat boundaries and Scene boundaries are independent of one another:
- A genuine Story Beat does NOT require that a Scene boundary occurs here, or anywhere nearby.
- A Scene boundary occurring here does NOT automatically mean a Story Beat also occurs here, and \
does NOT automatically mean one does not -- judge the Story Beat question entirely on its own terms.
- Most of the video's runtime should be expected to contain no Scene boundary; the same is true, \
independently, of Story Beats -- do not treat either as evidence for the other.

None of the following, by itself, is sufficient evidence that a Story Beat occurs here, even though \
each one may be a reasonable place to examine more closely:
- A silence or pause in speech.
- A sentence simply ending.
- A speaker taking a breath.
- A technical Shot boundary or edit cut.
- A camera angle or camera movement change.
- On-screen text (OCR) appearing, changing, or disappearing.
- A representative video frame changing.
- A change in music or background audio.
- A Semantic Scene boundary being reported nearby.
- A new evidence source (a new speaker, a new caption track, a new on-screen element) simply \
appearing.
Each of these only NOMINATES a moment as worth examining -- never, by itself, the semantic \
conclusion. Only conclude a genuine Story Beat when the actual content itself demonstrates a real \
rhetorical or communicative shift -- not merely because one of the signals above happened to occur \
at this moment.

This content may come from any domain whatsoever -- education, medicine, software tutorials, \
accounting, documentary film, product or business demonstrations, marketing or promotional \
material, or any other domain, including domains not listed here. Your reasoning must work \
identically across all of them. Do not analyze this content for hooks, calls-to-action, pain \
points, buyer stages, virality, audience persuasion, or any other marketing-specific concept; do \
not analyze it for tutorial teaching-points, lesson structure, or any authoring guidance; and do \
not assign, name, or output any Story Beat type, function, or role of any kind -- your only output \
is whether a beat boundary exists here at all.

Rules you must follow:
- Judge from the actual MEANING and delivery of the content itself, not from technical/visual \
signals alone.
- Any "language" field on speech evidence is only a measured hint from automatic speech \
recognition -- it can be imprecise. Reason from the actual text itself, never treat the language \
label as ground truth.
- If you can reason directly in the original language of the text, do so. Any internal translation \
you perform must stay private working reasoning -- never present a translation as if it were \
transcribed evidence, and never let it replace the original text in your reasoning.
- If the available evidence is genuinely insufficient to confidently decide either way, set \
is_story_beat_boundary to null and confidence to "low" -- never guess just to produce a definite \
answer.
- Corroborating evidence (multiple sources agreeing) may raise your confidence; contradictory \
evidence should lower it -- never average conflicting signals into a false middle confidence.
- Cite ONLY evidence ids that are explicitly present in the "Valid evidence ids" list you are \
given -- never invent, guess, or renumber an id.
- Keep your reasoning concise (2-3 sentences).

Respond with ONLY a single JSON object, no markdown fencing, no commentary before or after it, \
matching exactly this schema:
{
  "is_story_beat_boundary": true | false | null,
  "confidence": "low" | "medium" | "high",
  "reasoning": "concise justification",
  "evidence_references": {
    "supporting_shot_ids": [],
    "supporting_frame_ids": [],
    "supporting_speech_segment_ids": [],
    "supporting_text_element_ids": [],
    "supporting_annotation_ids": []
  }
}
Omit any evidence_references key you have nothing to cite for, or give it an empty list."""


def _collect_valid_evidence_ids(evidence_bundle: dict) -> dict[str, list[int]]:
    """Every id actually present in this bundle, grouped by the same key names
    evidence_references uses -- given to the model explicitly so it has no reason to invent one,
    and used again afterward by this module to reject any id it cites that isn't in this list.

    `evidence_bundle` here is the exact same per-candidate shape
    app.services.semantic_boundary_assembly_svc.assemble_semantic_boundary_candidates() already
    produces (Stage 10.3A's own audit confirmed this bundle is reusable, unmodified, for Story
    Beat candidates too). That bundle carries no representative-frame evidence today, so
    supporting_frame_ids is always empty for now -- it remains part of the contract's own five-key
    vocabulary (see contract.py) for whenever a future bundle does carry frame evidence."""
    shot_ids = [s["id"] for s in evidence_bundle.get("shots_overlapping") or []]

    frame_ids: list[int] = []

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
        "supporting_frame_ids": frame_ids,
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
    raises StoryBeatReasoningError instead, per the "never fabricate a result" contract."""
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass

    start = raw_text.find("{")
    end = raw_text.rfind("}") + 1
    if start == -1 or end <= start:
        raise StoryBeatReasoningError(f"Anthropic response was not valid JSON and contained no JSON object: {raw_text!r}")
    try:
        return json.loads(raw_text[start:end])
    except json.JSONDecodeError as exc:
        raise StoryBeatReasoningError(f"Anthropic response could not be parsed as JSON: {exc}") from exc


def _validate_response_shape(data: dict) -> None:
    if not isinstance(data, dict):
        raise StoryBeatReasoningError(f"Anthropic response JSON must be an object, got {type(data).__name__}.")

    required_keys = {"is_story_beat_boundary", "confidence", "reasoning", "evidence_references"}
    missing = required_keys - set(data)
    if missing:
        raise StoryBeatReasoningError(f"Anthropic response is missing required field(s): {sorted(missing)}.")

    is_boundary = data["is_story_beat_boundary"]
    if is_boundary is not None and not isinstance(is_boundary, bool):
        raise StoryBeatReasoningError(
            f"is_story_beat_boundary must be true, false, or null -- got {is_boundary!r}."
        )

    if data["confidence"] not in VALID_CONFIDENCE_LEVELS:
        raise StoryBeatReasoningError(
            f"confidence must be one of {VALID_CONFIDENCE_LEVELS} -- got {data['confidence']!r}."
        )

    if not isinstance(data["reasoning"], str):
        raise StoryBeatReasoningError("reasoning must be a string.")

    if not isinstance(data["evidence_references"], dict):
        raise StoryBeatReasoningError("evidence_references must be an object.")


def _validate_cited_ids_are_real(evidence_references: dict, valid_ids: dict[str, list[int]]) -> None:
    """Rejects any cited id that was not actually offered to the model -- never allows invented
    provenance. Also rejects any evidence_references key outside the locked contract's five-key
    vocabulary (the same check StoryBeatDecision.__post_init__ performs, run here first so a bad
    key produces a clear, provider-attributed StoryBeatReasoningError rather than a bare
    ValueError bubbling up)."""
    unknown_keys = set(evidence_references) - VALID_EVIDENCE_REFERENCE_KEYS
    if unknown_keys:
        raise StoryBeatReasoningError(
            f"Anthropic response cited unsupported evidence_references key(s) {sorted(unknown_keys)}."
        )
    for key, cited_ids in evidence_references.items():
        if not isinstance(cited_ids, list) or not all(isinstance(i, int) for i in cited_ids):
            raise StoryBeatReasoningError(f"evidence_references['{key}'] must be a list of integer ids, got {cited_ids!r}.")
        allowed = set(valid_ids.get(key, []))
        unknown_ids = set(cited_ids) - allowed
        if unknown_ids:
            raise StoryBeatReasoningError(
                f"Anthropic response cited evidence_references['{key}'] id(s) {sorted(unknown_ids)} "
                f"that were never offered in this bundle (allowed: {sorted(allowed)}) -- rejecting "
                "rather than allowing invented provenance."
            )


class AnthropicStoryBeatReasoner(StoryBeatReasonerProvider):
    name = "anthropic"

    def is_configured(self) -> bool:
        # Reuses the EXACT SAME secret app.services.ai.providers.anthropic_provider.
        # AnthropicProvider and the Semantic Scene reasoner already check -- no second,
        # Story-Beat-specific API key exists or is needed.
        return bool(settings.ANTHROPIC_API_KEY)

    async def reason_about_story_beat_boundary(self, evidence_bundle: dict, *, model: str) -> StoryBeatDecision:
        if not self.is_configured():
            raise StoryBeatReasoningError(
                "The Anthropic Story Beat reasoner needs ANTHROPIC_API_KEY configured (the same "
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
            raise StoryBeatReasoningError(f"Could not reach Anthropic Claude for Story Beat reasoning: {exc}") from exc

        raw_text = "\n".join(block.text for block in message.content if block.type == "text").strip()
        data = _parse_response_json(raw_text)
        _validate_response_shape(data)
        _validate_cited_ids_are_real(data["evidence_references"], valid_ids)

        try:
            return StoryBeatDecision(
                is_story_beat_boundary=data["is_story_beat_boundary"],
                confidence=data["confidence"],
                reasoning=data["reasoning"],
                evidence_references=data["evidence_references"],
                reasoning_contract_version=STORY_BEAT_PROMPT_VERSION,
            )
        except ValueError as exc:
            raise StoryBeatReasoningError(f"Anthropic response failed contract validation: {exc}") from exc
