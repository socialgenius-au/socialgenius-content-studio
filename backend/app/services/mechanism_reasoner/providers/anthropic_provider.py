"""C3 -- the first REAL Mechanism reasoner: an Anthropic Claude adapter conforming to MechanismReasonerProvider.

A sibling of the Hook/Retention Anthropic adapters (same lazily-created shared client, app.services.claude.
get_client(), same stateless shape), with its own prompt. It only obtains and parses the model's JSON; the
evidence / language / transferability validation is applied afterwards by the router for EVERY provider
(validation.validate_decision), so those safeguards never depend on this prompt being obeyed.

Mechanism orchestration never imports this module or `anthropic` directly -- it calls
app.services.mechanism_reasoner.derive_mechanisms; which provider answers (if any) is resolved from
configuration alone. NO call is ever made unless MECHANISM_REASONER_PROVIDER="anthropic" is set explicitly.

LIVE-RESPONSE HANDLING (prompt v2 / first real call): the first real call (28,062 input tokens) ended with
stop_reason="max_tokens" after exactly 4,096 output tokens and NO text block, so nothing was parseable. This
module therefore (a) sends a compact provider view of the anatomy (anatomy_input.build_reasoner_input), (b) asks
for concise output, (c) sets a documented output budget and a low reasoning `effort`, and (d) checks stop_reason,
block types and text presence BEFORE parsing, raising a clear MechanismReasoningError carrying response metadata
(never turning a truncated or empty response into mechanisms).
"""
import logging

import anthropic

from app.config import settings
from app.services.claude import get_client
from app.services.mechanism_reasoner.anatomy_input import serialize_reasoner_input
from app.services.mechanism_reasoner.contract import (
    EVIDENCE_ID_KEYS, MECHANISM_TYPES_WITHOUT_OTHER, NON_TRANSFERABLE_KINDS, MechanismDecision, MechanismReasoningError,
)
from app.services.mechanism_reasoner.parsing import decision_from_payload, parse_json_object

from .base import MechanismReasonerProvider

logger = logging.getLogger(__name__)

# OUTPUT BUDGET. `max_tokens` bounds visible output AND any reasoning the model does. The largest VALID response
# is 12 mechanisms; measured with the real tokenizer (count_tokens, claude-sonnet-5), a deliberately verbose
# 12-mechanism response (statement ~45 words, principle ~35, three non-transferable elements of ~20 words, ten
# evidence ids, two limitations each, four overall limitations) is 6.6k-7.2k tokens, and typical 4-6 mechanism
# responses are ~3k. 10,000 leaves >=39% headroom over that worst valid case (room for a little residual
# reasoning) without being arbitrarily large; the first call's 4,096 was below the worst valid response. A
# response that still hits the limit is REJECTED with diagnostics (extract_text_or_raise), never parsed.
MAX_RESPONSE_TOKENS = 10000

# `output_config.effort` is a documented, supported request parameter (the model's capability metadata lists
# low/medium/high/xhigh/max for claude-sonnet-5). This task is structured extraction over an already-structured
# anatomy, so the lowest effort is used to keep hidden reasoning from consuming the output budget. No `thinking`
# parameter is sent: the model reports `thinking.enabled` unsupported (only `adaptive`), and forcing/disabling it is
# not a documented option for this model.
MECHANISM_EFFORT = "low"

# The explicit, stable reasoning-contract version for SYSTEM_PROMPT. Bumped by hand whenever the prompt's
# meaning changes; recorded on every durable attempt so a result can be tied to the exact instructions used.
#
# v2 (live-response correction): compact anatomy view described to the model (`usable_features`, absent = empty),
# explicit concision / JSON-only / fewer-strong-mechanisms instructions. The locked C3 contract is unchanged.
MECHANISM_PROMPT_VERSION = "v2"

SYSTEM_PROMPT = """You are a structural content analyst. You are given the CONTENT ANATOMY of ONE \
short-form video, in a compact form: an ordered, evidence-referenced map of how it is constructed, plus a list \
of GAPS (things the analysis could not establish). Identify the underlying DESIGN MECHANISMS that APPEAR to \
be operating in it and, for each, separate what is TRANSFERABLE to entirely NEW content from what belongs only \
to this source.

You are NOT copying the source, rewriting the source, writing new content, predicting performance, \
claiming causation, or planning a new video. You describe STRUCTURE.

HOW TO READ THE INPUT: each section has n (its number), start/end (seconds), and only the facts that exist: \
opening / hook (true only when set), transcript, speech (id, text), on_screen_text (id, text; `recurring` marks \
a persistent caption or watermark), objects, motion_evidence / transition_evidence, silences, pacing (shots, \
cuts), accepted_retention_devices, rejected_retention_candidates (references only), interpretive (only if \
upstream supplied a role), usable_features and evidence_ids. A field that is ABSENT means empty, false or not \
established -- never assume it. `usable_features` lists the ONLY feature names you may use for that section; \
video.usable_features does the same at video level.

OUTPUT: return ONLY a single JSON object -- begin with "{{" and end with "}}". No preamble, no markdown, no \
code fences, no explanation outside the schema. Keep every value concise. Do not deliberate at length: the \
anatomy is already structured, so answer directly.

CREATE A MECHANISM ONLY WHEN THE ANATOMY SUPPORTS IT. Return only mechanisms that are genuinely supported; a \
few strong, well-evidenced mechanisms are far better than filling the maximum of 12, and {{"mechanisms": []}} \
is a correct answer when the evidence is thin. Do not force the video into the taxonomy, do not create one \
mechanism per type, and do not pad. If you return none, say why in overall_limitations. Multiple mechanisms of \
the same type are allowed ONLY when structurally different (different sections or evidence).

TAXONOMY (mechanism_type): {types}, or "other". Use "other" only when a real, evidence-supported structure \
fits none of the named types; then you MUST give other_label (a short name) and other_rationale, and the label \
must not simply rename a named type.

STRICT RULES:
- Use ONLY the anatomy you are given. Never invent content, evidence, sections, timings, or features.
- NULL MEANS UNKNOWN. Where narrative / messaging / emotional / CTA roles are not supplied, you do not know \
them; do not assert them. Respect every entry in `gaps`: do not claim what a gap says was not established, and \
state the relevant limitation. Zero accepted retention devices is normal -- never assume a device exists, and \
never treat rejected candidates as mechanisms.
- Captions, watermarks and recurring on-screen text are not, by themselves, attention mechanisms.
- Go BEYOND describing what happened. "The video contains text" is not a mechanism; "on-screen text appears \
positioned as a parallel reinforcement of the spoken progression" is. A mechanism explains the apparent \
structural function of an arrangement.
- STATEMENT (max 2 sentences): cautious DESIGN language -- "appears designed to...", "places...", \
"introduces...", "creates a structural...", "withholds... until...". NEVER say or imply that anything made the \
video successful, effective, engaging, compelling or viral, increased or held retention or attention, kept \
viewers watching, caused or led to an outcome, or that viewers will/definitely do something. You have no viewer \
data. No effectiveness scores or strong/weak ratings. No "because ... viewers".
- TRANSFERABLE PRINCIPLE (1-2 sentences): an abstract, source-independent structure usable by a different \
business, topic, person and wording (e.g. "open with an unresolved question before giving the explanation"). \
It must make sense with no reference to this video: no section numbers, no timestamps, no names, no brand, no \
subject matter, and no words copied from the transcript or on-screen text.
- NON-TRANSFERABLE ELEMENTS (1-3 entries, each under 20 words): what is specific to THIS source and must NOT \
be carried over. Each has a kind ({kinds}) and a description. Describe; never quote a passage (at most a few \
words).
- Never reproduce passages of the transcript or on-screen text anywhere in your answer.
- EVIDENCE: supporting_evidence_ids may contain ONLY ids in valid_evidence_ids, under these keys: \
{evidence_keys}. Cite only the few ids that matter (not every id). Every mechanism must cite at least one. \
section_numbers must come from valid_section_numbers. When scope is "sections", cite ids belonging to those \
sections; when scope is "video", section_numbers may be empty or list the sections it mainly rests on.
- anatomy_features_used: ONLY names from usable_features of the sections you cite (or video.usable_features).
- Type preconditions: text_attention needs on_screen_text; audio_attention needs speech or silence; \
pacing_rhythm needs measured cuts in scope; contrast and payoff_resolution need at least two sections; \
hook_curiosity must be anchored to the opening/hook; emotional_progression and cta_next_step cannot be "high" \
confidence (their role fields are unknown).
- confidence is "low", "medium" or "high": how well the anatomy supports the INFERENCE. It is not a \
performance rating. Everything is an inference (INFERRED); never present an inference as fact.
- limitations (per mechanism, at most 2, each under 20 words) and overall_limitations (at most 4) state what \
the anatomy does not establish that bears on the claim.

Schema (exactly these fields, no others):
{{"mechanisms":[{{"mechanism_type":"<taxonomy type>","other_label":null,"other_rationale":null,\
"statement":"...","scope":"video"|"sections","section_numbers":[1],\
"supporting_evidence_ids":{{"speech_segments":[],"text_elements":[],"shots":[]}},\
"anatomy_features_used":["speech"],"transferable_principle":"...",\
"non_transferable_elements":[{{"kind":"wording","description":"..."}}],\
"confidence":"low"|"medium"|"high","limitations":["..."]}}],"overall_limitations":["..."]}}""".format(
    types=", ".join(MECHANISM_TYPES_WITHOUT_OTHER),
    kinds=", ".join(sorted(NON_TRANSFERABLE_KINDS)),
    evidence_keys=", ".join(sorted(EVIDENCE_ID_KEYS)),
)


def build_user_prompt(reasoner_input: dict) -> str:
    return "Content Anatomy (compact JSON):\n" + serialize_reasoner_input(reasoner_input)


def response_diagnostics(message) -> dict:
    """Non-sensitive METADATA about a response (never the payload, never a secret): what came back and how much."""
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
    MechanismReasoningError carrying diagnostics. A truncated or empty response is never parsed into mechanisms."""
    diag = response_diagnostics(message)
    suffix = f" Response metadata: {diag}"
    if diag["stop_reason"] == "max_tokens":
        logger.warning("Mechanism response truncated: %s", diag)
        raise MechanismReasoningError(
            f"The Mechanism response was truncated at max_tokens={MAX_RESPONSE_TOKENS} "
            f"(output_tokens={diag['output_tokens']}, block types {diag['block_types']}, text_chars={diag['text_chars']}); "
            "a truncated response is never parsed." + suffix, diagnostics=diag)
    joined = "".join(getattr(b, "text", "") or "" for b in (getattr(message, "content", None) or []) if getattr(b, "type", None) == "text")
    if not joined.strip():
        logger.warning("Mechanism response had no text: %s", diag)
        raise MechanismReasoningError(
            f"The Mechanism response contained no text (block types {diag['block_types']}, stop_reason {diag['stop_reason']!r})." + suffix,
            diagnostics=diag)
    if diag["stop_reason"] != "end_turn":
        logger.warning("Mechanism response ended abnormally: %s", diag)
        raise MechanismReasoningError(
            f"The Mechanism response ended with unexpected stop_reason {diag['stop_reason']!r} (expected 'end_turn')." + suffix,
            diagnostics=diag)
    logger.info("Mechanism response received: %s", diag)
    return "".join(b.text for b in message.content if getattr(b, "type", None) == "text").strip()


class AnthropicMechanismReasoner(MechanismReasonerProvider):
    name = "anthropic"

    def is_configured(self) -> bool:
        # The EXACT SAME secret every other Anthropic-backed reasoner already checks -- no second key.
        return bool(settings.ANTHROPIC_API_KEY)

    async def derive_mechanisms(self, reasoner_input: dict, *, model: str) -> MechanismDecision:
        if not self.is_configured():
            raise MechanismReasoningError(
                "The Anthropic Mechanism reasoner needs ANTHROPIC_API_KEY configured (the same setting app/services/ai/ "
                "already uses) -- set it in backend/.env."
            )
        try:
            message = await get_client().messages.create(
                model=model, max_tokens=MAX_RESPONSE_TOKENS, system=SYSTEM_PROMPT,
                output_config={"effort": MECHANISM_EFFORT},
                messages=[{"role": "user", "content": build_user_prompt(reasoner_input)}],
            )
        except anthropic.AnthropicError as exc:
            raise MechanismReasoningError(f"Could not reach Anthropic Claude for Mechanism derivation: {exc}") from exc

        raw_text = extract_text_or_raise(message)
        try:
            payload = parse_json_object(raw_text)
        except MechanismReasoningError as exc:
            raise MechanismReasoningError(f"{exc} Response metadata: {response_diagnostics(message)}",
                                          diagnostics=response_diagnostics(message)) from exc
        return decision_from_payload(payload, reasoning_contract_version=MECHANISM_PROMPT_VERSION)
