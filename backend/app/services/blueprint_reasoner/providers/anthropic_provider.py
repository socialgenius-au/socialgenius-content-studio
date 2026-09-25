"""C4 -- the first REAL Blueprint reasoner: an Anthropic Claude adapter conforming to BlueprintReasonerProvider.

Same shape and discipline as the C3 Mechanism adapter (shared lazily-created client, compact JSON input, documented output
budget, low reasoning effort, response diagnostics that refuse truncated/empty responses BEFORE parsing). It only obtains
and parses the model's JSON; every safeguard is applied afterwards by the router for EVERY provider, so none depends on
this prompt being obeyed.

NO call is ever made unless BLUEPRINT_REASONER_PROVIDER="anthropic" is set explicitly.
"""
import json
import logging

import anthropic

from app.config import settings
from app.services.blueprint_reasoner.contract import (
    MAX_FIELD_CHARS, MAX_SECTIONS, NOT_USED_REASONS, RELATIONSHIPS, STRUCTURAL_ROLES, BlueprintDecision, BlueprintReasoningError,
)
from app.services.blueprint_reasoner.parsing import decision_from_payload, parse_json_object
from app.services.claude import get_client

from .base import BlueprintReasonerProvider

logger = logging.getLogger(__name__)

# OUTPUT BUDGET. `max_tokens` bounds visible output AND any reasoning. Measured with the real tokenizer (count_tokens,
# claude-sonnet-5): the largest response that follows the prompt's own concision limits (12 sections, every field at most two
# sentences, three short required_information items, a full mechanism-disposition table) is ~7.5k tokens; the same shape at 1.5x
# (fields of ~3 sentences) is ~10.1k. A typical 5-6 section blueprint is ~3-4k. 14,000 leaves ~39% headroom over the 1.5x case and
# ~87% over the compliant maximum without being arbitrarily large. (The 600-character per-field validation cap exists to reject
# scripts, not to size the output.) A response that still reaches the limit is REJECTED with diagnostics, never parsed.
MAX_RESPONSE_TOKENS = 14000

# Documented, supported request parameter (model capability metadata: low/medium/high/xhigh/max). Structured planning over a
# small, fully specified input does not need extended reasoning. No `thinking` parameter is sent (only `adaptive` is supported).
BLUEPRINT_EFFORT = "low"

# Explicit, stable reasoning-contract version for SYSTEM_PROMPT; bumped by hand whenever its meaning changes and recorded on
# every durable attempt.
BLUEPRINT_PROMPT_VERSION = "v1"

_TEMPLATE = """You are a content-construction planner. You are given: (1) a NEW CONTENT INTENT (what the new piece is for), (2) \
the structural SKELETON of a reference video (numbers, timing, kinds of evidence -- never its words), and (3) the reference's \
TRANSFERABLE MECHANISMS (design principles) with what must NOT be carried over. Produce a RECONSTRUCTION BLUEPRINT: a \
construction plan for a completely NEW piece of content that applies the transferable principles to the NEW intent.

You transfer STRUCTURE, never SUBJECT. The new piece must be independently usable by someone who has never seen the reference.

INSTRUCTIONS, NOT COPY. You write construction instructions. You NEVER write final creative copy: no hook lines, captions, \
scripts, headlines, taglines, CTA wording or voiceover lines; no quoted lines, no direct questions, no exclamations, no \
hashtags, no emoji. Describe what a line/shot/caption must DO, never the line itself.
  GOOD: "Open with a concise unresolved contrast relevant to the audience's decision, before explaining the distinction."
  BAD:  "Are you tired of wasting money on bad accountants?"   (that is final copy)

MECHANISMS. For EVERY mechanism in `mechanisms` (use its exact mechanism_id) decide USED or NOT_USED for THIS intent. Do not \
copy mechanisms mechanically: use one only if it genuinely suits the objective, platform, tone and supplied information. USED \
requires applied_in_sections (the NEW section numbers) and each of those sections must list the id in mechanisms_applied. \
NOT_USED requires reason_category (one of <<NOT_USED_REASONS>>) and a concrete reason. At least one mechanism must be USED. When \
you use a mechanism, apply ONLY its transferable_principle to the new subject -- translate it, do not restate it.

DO NOT CARRY OVER: every entry in `do_not_carry_over` and every word in `blocked_source_terms` is forbidden in your output \
(the words are checked). Do not reuse the reference's subject matter, people, story, names, wording, visuals or audio. Do not \
lightly paraphrase anything from the reference. Use only the caller's own subject matter (their intent).

MANDATORY POINTS. Each id in valid.mandatory_point_ids must be assigned to at least one section (list the id in that section's \
mandatory_points_assigned) OR be listed in unassigned_mandatory_points with a concrete reason. Never drop one silently. A point \
is never both assigned and unassigned.

PROHIBITED. Never instruct any prohibited_claims_or_elements. You may mention one only as an explicit exclusion ("avoid ...").

CTA. Plan a call to action ONLY if new_content_intent.desired_cta is supplied: then at least one section (normally the last) \
carries cta_direction describing the CTA as an instruction (never its wording). If no desired_cta is supplied, cta_direction \
must be null in every section. Do not invent a brand, product fact, price, claim or CTA the intent did not supply; if a \
section needs information the intent lacks, say so in required_information ("to be supplied: ...").

DURATION. Give each section a target_duration_seconds. If duration_platform_constraints.target_duration_seconds is supplied, \
the durations must total within 15% of it. Use 3-8 sections unless the intent needs more (maximum <<MAX_SECTIONS>>). Sections are \
numbered 1..n in order.

SKELETON. reference_skeleton shows how the reference is ordered and paced. You may follow, adapt or ignore it: set \
source_anatomy_relationship.relationship to one of <<RELATIONSHIPS>> and list the reference section numbers it relates to \
(from valid.anatomy_section_numbers; empty only for independent_of_reference). Do not reinterpret evidence; the mechanisms \
already contain the transferable abstraction.

NO PERFORMANCE CLAIMS. Never say or imply that a structure increases retention, drives engagement, makes viewers continue, \
improves performance, works because..., went viral or converts. Say "this section applies the <type> mechanism" or "uses \
contrast to organise the information". You are transferring design logic, not proven results.

STYLE. Concise. Every text value is at most <<MAX_FIELD_CHARS>> characters (aim for one or two sentences). structural_role is one of \
<<STRUCTURAL_ROLES>>. confidence is "low", "medium" or "high" (how well the plan fits the supplied information, not a \
performance rating). limitations state what the intent did not supply that bears on the plan.

OUTPUT: ONLY one JSON object -- begin with "{" and end with "}". No preamble, no markdown, no code fences, no commentary. Do \
not deliberate at length; answer directly. Exactly these fields, no others:
{"structural_approach":"<one or two sentences>","mechanism_dispositions":[{"mechanism_id":"M01","decision":"USED","reason_category":null,\
"reason":null,"applied_in_sections":[1]},{"mechanism_id":"M02","decision":"NOT_USED","reason_category":"<category>","reason":"<concrete reason>",\
"applied_in_sections":[]}],"sections":[{"section_number":1,"section_purpose":"...","structural_role":"opening","target_duration_seconds":6,\
"mechanisms_applied":["M01"],"source_anatomy_relationship":{"relationship":"adapts_reference_structure","anatomy_section_numbers":[1]},\
"content_instruction":"...","required_information":["..."],"visual_direction":"...","text_direction":"...","speech_direction":"...",\
"pacing_direction":"...","transition_direction":"..." or null,"cta_direction":"..." or null,"mandatory_points_assigned":["MP01"],\
"confidence":"medium","limitations":["..."]}],"unassigned_mandatory_points":[{"id":"MP02","reason":"<concrete reason>"}],\
"limitations":["..."]}"""

SYSTEM_PROMPT = (_TEMPLATE
                 .replace("<<NOT_USED_REASONS>>", ", ".join(sorted(NOT_USED_REASONS)))
                 .replace("<<RELATIONSHIPS>>", ", ".join(sorted(RELATIONSHIPS)))
                 .replace("<<STRUCTURAL_ROLES>>", ", ".join(sorted(STRUCTURAL_ROLES)))
                 .replace("<<MAX_SECTIONS>>", str(MAX_SECTIONS))
                 .replace("<<MAX_FIELD_CHARS>>", str(MAX_FIELD_CHARS)))


def serialize_input(reasoner_input: dict) -> str:
    return json.dumps(reasoner_input, ensure_ascii=False, separators=(",", ":"), default=str)


def build_user_prompt(reasoner_input: dict) -> str:
    return "Blueprint input (compact JSON):\n" + serialize_input(reasoner_input)


def response_diagnostics(message) -> dict:
    """Non-sensitive METADATA about a response (never the payload, never a secret)."""
    blocks = list(getattr(message, "content", None) or [])
    types = [getattr(b, "type", type(b).__name__) for b in blocks]
    text = "".join(getattr(b, "text", "") or "" for b in blocks if getattr(b, "type", None) == "text")
    usage = getattr(message, "usage", None)
    return {
        "stop_reason": getattr(message, "stop_reason", None), "block_types": types, "has_text_block": "text" in types,
        "text_chars": len(text), "input_tokens": getattr(usage, "input_tokens", None),
        "output_tokens": getattr(usage, "output_tokens", None), "max_tokens": MAX_RESPONSE_TOKENS,
    }


def extract_text_or_raise(message) -> str:
    """Returns the response text ONLY if the response is complete and non-empty; otherwise raises a clear
    BlueprintReasoningError carrying diagnostics. A truncated or empty response is never parsed into a blueprint."""
    diag = response_diagnostics(message)
    suffix = f" Response metadata: {diag}"
    if diag["stop_reason"] == "max_tokens":
        logger.warning("Blueprint response truncated: %s", diag)
        raise BlueprintReasoningError(
            f"The Blueprint response was truncated at max_tokens={MAX_RESPONSE_TOKENS} (output_tokens={diag['output_tokens']}, block types "
            f"{diag['block_types']}, text_chars={diag['text_chars']}); a truncated response is never parsed." + suffix, diagnostics=diag)
    joined = "".join(getattr(b, "text", "") or "" for b in (getattr(message, "content", None) or []) if getattr(b, "type", None) == "text")
    if not joined.strip():
        logger.warning("Blueprint response had no text: %s", diag)
        raise BlueprintReasoningError(
            f"The Blueprint response contained no text (block types {diag['block_types']}, stop_reason {diag['stop_reason']!r})." + suffix,
            diagnostics=diag)
    if diag["stop_reason"] != "end_turn":
        logger.warning("Blueprint response ended abnormally: %s", diag)
        raise BlueprintReasoningError(
            f"The Blueprint response ended with unexpected stop_reason {diag['stop_reason']!r} (expected 'end_turn')." + suffix, diagnostics=diag)
    logger.info("Blueprint response received: %s", diag)
    return joined.strip()


class AnthropicBlueprintReasoner(BlueprintReasonerProvider):
    name = "anthropic"

    def is_configured(self) -> bool:
        # The EXACT SAME secret every other Anthropic-backed reasoner already checks -- no second key.
        return bool(settings.ANTHROPIC_API_KEY)

    async def derive_blueprint(self, reasoner_input: dict, *, model: str) -> BlueprintDecision:
        if not self.is_configured():
            raise BlueprintReasoningError(
                "The Anthropic Blueprint reasoner needs ANTHROPIC_API_KEY configured (the same setting app/services/ai/ already uses) -- "
                "set it in backend/.env.")
        try:
            message = await get_client().messages.create(
                model=model, max_tokens=MAX_RESPONSE_TOKENS, system=SYSTEM_PROMPT, output_config={"effort": BLUEPRINT_EFFORT},
                messages=[{"role": "user", "content": build_user_prompt(reasoner_input)}],
            )
        except anthropic.AnthropicError as exc:
            raise BlueprintReasoningError(f"Could not reach Anthropic Claude for Blueprint derivation: {exc}") from exc

        raw_text = extract_text_or_raise(message)
        try:
            payload = parse_json_object(raw_text)
        except BlueprintReasoningError as exc:
            raise BlueprintReasoningError(f"{exc} Response metadata: {response_diagnostics(message)}", diagnostics=response_diagnostics(message)) from exc
        return decision_from_payload(payload, reasoning_contract_version=BLUEPRINT_PROMPT_VERSION)
