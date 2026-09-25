"""C3 -- the first REAL Mechanism reasoner: an Anthropic Claude adapter conforming to MechanismReasonerProvider.

A sibling of the Hook/Retention Anthropic adapters (same lazily-created shared client, app.services.claude.
get_client(), same stateless shape), with its own prompt. It only obtains and parses the model's JSON; the
evidence / language / transferability validation is applied afterwards by the router for EVERY provider
(validation.validate_decision), so those safeguards never depend on this prompt being obeyed.

Mechanism orchestration never imports this module or `anthropic` directly -- it calls
app.services.mechanism_reasoner.derive_mechanisms; which provider answers (if any) is resolved from
configuration alone. NO call is ever made unless MECHANISM_REASONER_PROVIDER="anthropic" is set explicitly.
"""
import json

import anthropic

from app.config import settings
from app.services.claude import get_client
from app.services.mechanism_reasoner.contract import (
    ANATOMY_FEATURE_KEYS, EVIDENCE_ID_KEYS, MECHANISM_TYPES_WITHOUT_OTHER, NON_TRANSFERABLE_KINDS, MechanismDecision,
    MechanismReasoningError,
)
from app.services.mechanism_reasoner.parsing import decision_from_payload, parse_json_object

from .base import MechanismReasonerProvider

MAX_RESPONSE_TOKENS = 4096

# The explicit, stable reasoning-contract version for SYSTEM_PROMPT. Bumped by hand whenever the prompt's
# meaning changes; recorded on every durable attempt so a result can be tied to the exact instructions used.
MECHANISM_PROMPT_VERSION = "v1"

SYSTEM_PROMPT = """You are a structural content analyst. You are given the CONTENT ANATOMY of ONE \
short-form video: an ordered, evidence-referenced map of how it is constructed (sections with their \
timing, transcript, on-screen text, visual facts, audio, pacing, accepted structural devices, and a \
list of GAPS -- things the analysis could not establish). Your job is to identify the underlying DESIGN \
MECHANISMS that APPEAR to be operating in it, and, for each, to separate what is TRANSFERABLE to \
entirely NEW content from what belongs only to this source.

You are NOT copying the source, rewriting the source, writing new content, predicting performance, \
claiming causation, or planning a new video. You describe STRUCTURE.

CREATE A MECHANISM ONLY WHEN THE ANATOMY SUPPORTS IT. Returning {{"mechanisms": []}} is a correct, \
valued answer when the evidence is thin. Do not force the video into the taxonomy, do not create one \
mechanism per type, and do not pad. If you return no mechanisms, say why in overall_limitations. Multiple \
mechanisms of the same type are allowed ONLY when they are structurally different (different sections or \
different evidence).

TAXONOMY (mechanism_type): {types}, or "other". Use "other" only when a real, evidence-supported \
structure fits none of the named types; then you MUST give other_label (a short name) and \
other_rationale (what in the anatomy supports it) and the label must not simply rename a named type.

STRICT RULES:
- Use ONLY the anatomy you are given. Never invent content, evidence, sections, timings, or features.
- NULL MEANS UNKNOWN. Where the anatomy's narrative_role / messaging_role / emotional_function / \
cta_role are null, you do not know them; do not assert them. Respect every entry in `gaps`: do not claim \
what a gap says was not established, and mention the relevant limitation. Zero accepted retention devices \
is normal -- never assume a device exists, and do not treat rejected candidates as mechanisms.
- Captions, watermarks and recurring on-screen text (recurring_element_id set) are not, by themselves, \
attention mechanisms.
- STATEMENT: one or two sentences in cautious DESIGN language: "appears designed to...", "places...", \
"introduces...", "creates a structural...", "withholds... until...". NEVER say or imply that anything \
made the video successful, effective, engaging, compelling or viral, increased or held retention or \
attention, kept viewers watching, caused or led to an outcome, or that viewers will/definitely do \
something. You have no viewer data. No effectiveness scores or strong/weak ratings. No "because ... \
viewers". A mechanism is what a structure appears designed to do, never what it did.
- TRANSFERABLE PRINCIPLE: an abstract, source-independent structure that could be applied to a \
different business, topic, person and wording (e.g. "open with an unresolved question before giving \
the explanation"). It must make sense with no reference to this video: no section numbers, no \
timestamps, no names, no brand, no subject matter, and no words copied from the source's transcript or \
on-screen text.
- NON-TRANSFERABLE ELEMENTS: at least one entry naming what is specific to THIS source and must NOT be \
carried over. Each has a kind ({kinds}) and a description. Describe them; never quote a passage of the \
source (at most a few words).
- Never reproduce long passages of the transcript or on-screen text anywhere in your answer.
- EVIDENCE: supporting_evidence_ids may contain ONLY ids listed in valid_evidence_ids, grouped under \
these keys: {evidence_keys}. Every mechanism must cite at least one id. section_numbers must come from \
valid_section_numbers. When scope is "sections", cite ids that belong to those sections; when scope is \
"video", section_numbers may be empty or list the sections it mainly rests on.
- anatomy_features_used: choose from {features}, and only features that are actually present in the \
sections you cite (video-level features: hook_classification, structural_pattern, progression, \
pacing_profile).
- Type preconditions: text_attention needs on_screen_text; audio_attention needs speech or silence; \
pacing_rhythm needs measured cuts in scope; contrast and payoff_resolution need at least two sections; \
hook_curiosity must be anchored to the opening/hook; emotional_progression and cta_next_step cannot be \
"high" confidence (their anatomy role fields are unknown).
- confidence is "low", "medium" or "high" -- how well the anatomy supports the INFERENCE. It is not a \
performance rating. Everything you produce is an inference (certainty INFERRED); do not present an \
inference as fact.
- limitations (per mechanism) and overall_limitations state what the anatomy does not establish that bears \
on the claim.

Respond with ONLY a single JSON object, no markdown fencing and no commentary, exactly of this shape:
{{
  "mechanisms": [
    {{
      "mechanism_type": "one of the taxonomy types",
      "other_label": null,
      "other_rationale": null,
      "statement": "cautious design language",
      "scope": "video" | "sections",
      "section_numbers": [1],
      "supporting_evidence_ids": {{"speech_segments": [], "text_elements": [], "shots": []}},
      "anatomy_features_used": ["speech"],
      "transferable_principle": "abstract, source-independent structure",
      "non_transferable_elements": [{{"kind": "wording", "description": "what is specific to this source"}}],
      "confidence": "low" | "medium" | "high",
      "limitations": ["what is not established"]
    }}
  ],
  "overall_limitations": ["..."]
}}""".format(
    types=", ".join(MECHANISM_TYPES_WITHOUT_OTHER),
    kinds=", ".join(sorted(NON_TRANSFERABLE_KINDS)),
    evidence_keys=", ".join(sorted(EVIDENCE_ID_KEYS)),
    features=", ".join(sorted(ANATOMY_FEATURE_KEYS)),
)


def build_user_prompt(reasoner_input: dict) -> str:
    return "Content Anatomy (JSON):\n" + json.dumps(reasoner_input, ensure_ascii=False, indent=1, default=str)


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
                messages=[{"role": "user", "content": build_user_prompt(reasoner_input)}],
            )
        except anthropic.AnthropicError as exc:
            raise MechanismReasoningError(f"Could not reach Anthropic Claude for Mechanism derivation: {exc}") from exc

        raw_text = "\n".join(block.text for block in message.content if block.type == "text").strip()
        return decision_from_payload(parse_json_object(raw_text), reasoning_contract_version=MECHANISM_PROMPT_VERSION)
