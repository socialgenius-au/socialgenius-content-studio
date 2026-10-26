"""
Stage 11.3 — Hook reasoner contract + AnthropicHookReasoner + router tests. Every test here uses a
MOCKED Anthropic client (same AsyncMock pattern as tests/test_story_beat_reasoner_router.py) -- no
real network/API call is ever made in this file.
"""
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.hook_reasoner import HookReasoningError, classify_hook
from app.services.hook_reasoner.contract import (
    HOOK_INTENT_VALUES, HOOK_TYPE_VALUES, PRIMARY_HOOK_TYPE_VALUES, VALID_EVIDENCE_REFERENCE_KEYS,
    HookDecision, HookElement,
)
from app.services.hook_reasoner.providers.anthropic_provider import (
    HOOK_PROMPT_VERSION, PROHIBITED_CLAIM_TERMS, SYSTEM_PROMPT, AnthropicHookReasoner,
    _reject_prohibited_language,
)
import app.services.hook_reasoner.router as hook_router

_SAMPLE_BUNDLE = {
    "hook_window": {"start_time": 0.0, "end_time": 2.9, "hook_window_id": 1},
    "speech_segments": [{"id": 501, "start_time": 0.2, "end_time": 2.8, "text": "have you ever wondered why some ads just work?", "language": "en"}],
    "text_elements": [{"id": 601, "start_time": 0.5, "end_time": 2.5, "text": "WATCH THIS"}],
    "shots": [{"id": 701, "order": 0, "start_time": 0.0, "end_time": 2.9}],
    "visual_objects": [{"id": 801, "label": "person", "category": "person", "start_time": 0.0, "end_time": 2.9}],
    "motion_evidence": [], "transition_evidence": [], "audio_silence": [],
    "scenes": [{"id": 901, "order": 0, "start_time": 0.0, "end_time": 25.0}],
    "story_beats": [{"id": 1001, "start_time": 0.0, "end_time": 2.9, "boundary_status": "constructed"}],
    "editing_pacing_phases": [], "cuts": [],
}


# ---------------------------------------------------------------------------
# Contract validation (no DB, no network).
# ---------------------------------------------------------------------------

def test_hook_decision_rejects_invalid_primary_type():
    with pytest.raises(ValueError):
        HookDecision(primary_type="not_a_real_type", confidence="high", reasoning="x")


def test_hook_decision_accepts_unclear_as_primary_but_not_secondary():
    HookDecision(primary_type="unclear", confidence="low", reasoning="insufficient evidence")
    with pytest.raises(ValueError):
        HookDecision(primary_type="question", confidence="high", reasoning="x", secondary_types=["unclear"])


def test_hook_decision_rejects_invalid_probable_intent():
    with pytest.raises(ValueError):
        HookDecision(primary_type="question", confidence="high", reasoning="x", probable_intent="not_a_real_intent")


def test_hook_decision_allows_none_probable_intent():
    d = HookDecision(primary_type="unclear", confidence="low", reasoning="x", probable_intent=None)
    assert d.probable_intent is None


def test_hook_element_requires_nonempty_type_and_validates_evidence_refs():
    with pytest.raises(ValueError):
        HookElement(element_type="")
    with pytest.raises(ValueError):
        HookElement(element_type="spoken_question", evidence_references={"bogus_key": [1]})
    el = HookElement(element_type="spoken_question", evidence_references={"supporting_speech_segment_ids": [501]})
    assert el.element_type == "spoken_question"


def test_evidence_reference_keys_include_scene_and_story_beat_and_visual_object():
    assert "supporting_scene_ids" in VALID_EVIDENCE_REFERENCE_KEYS
    assert "supporting_story_beat_ids" in VALID_EVIDENCE_REFERENCE_KEYS
    assert "supporting_visual_object_ids" in VALID_EVIDENCE_REFERENCE_KEYS
    assert "supporting_frame_ids" not in VALID_EVIDENCE_REFERENCE_KEYS  # no frame evidence in a Hook bundle


def test_hook_type_vocabulary_is_small_and_has_other_escape_hatch():
    assert len(HOOK_TYPE_VALUES) <= 15
    assert "other" in HOOK_TYPE_VALUES
    assert "unclear" in PRIMARY_HOOK_TYPE_VALUES and "unclear" not in HOOK_TYPE_VALUES


# ---------------------------------------------------------------------------
# Prohibited-language structural enforcement (Section 7 of the brief).
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("term", ["effective", "engaging", "compelling", "retention", "viral", "convert", "successful", "score"])
def test_reject_prohibited_language_catches_each_documented_term(term):
    with pytest.raises(HookReasoningError):
        _reject_prohibited_language(f"this opening is genuinely {term} at capturing attention")


def test_reject_prohibited_language_allows_clean_factual_reasoning():
    _reject_prohibited_language("A spoken question is present, paired with on-screen text repeating the same idea.")  # must not raise


def test_prohibited_claim_terms_list_is_the_single_source_used_by_the_check():
    assert "retention" in PROHIBITED_CLAIM_TERMS
    assert "virality" in PROHIBITED_CLAIM_TERMS


# ---------------------------------------------------------------------------
# Anthropic provider + router, mocked client.
# ---------------------------------------------------------------------------

class _FakeTextBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class _FakeMessage:
    def __init__(self, text: str):
        self.content = [_FakeTextBlock(text)]


def _fake_client_returning(response_json: dict | str):
    text = response_json if isinstance(response_json, str) else json.dumps(response_json)
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(return_value=_FakeMessage(text))
    return fake_client


def _valid_question_response():
    return {
        "primary_type": "question", "secondary_types": ["direct_address"],
        "hook_elements": [
            {"element_type": "spoken_question", "evidence_references": {"supporting_speech_segment_ids": [501]}},
            {"element_type": "on_screen_text", "evidence_references": {"supporting_text_element_ids": [601]}},
        ],
        "probable_intent": "create_curiosity",
        "confidence": "high",
        "reasoning": "A direct question is spoken and reinforced by matching on-screen text; a person addresses the camera.",
        "evidence_references": {"supporting_speech_segment_ids": [501], "supporting_visual_object_ids": [801]},
    }


async def _run_with_response(monkeypatch, response_json):
    monkeypatch.setattr(hook_router.settings, "HOOK_REASONER_PROVIDER", "anthropic")
    fake_client = _fake_client_returning(response_json)
    with patch("app.services.hook_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.hook_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        return await classify_hook(_SAMPLE_BUNDLE)


def test_anthropic_hook_reasoner_is_registered():
    assert "anthropic" in hook_router._REASONER_PROVIDERS
    assert isinstance(hook_router._REASONER_PROVIDERS["anthropic"], AnthropicHookReasoner)


async def test_unconfigured_provider_name_raises_never_calls_client(monkeypatch):
    monkeypatch.setattr(hook_router.settings, "HOOK_REASONER_PROVIDER", "")
    with pytest.raises(HookReasoningError):
        await classify_hook(_SAMPLE_BUNDLE)


async def test_missing_api_key_raises_never_calls_client(monkeypatch):
    monkeypatch.setattr(hook_router.settings, "HOOK_REASONER_PROVIDER", "anthropic")
    with patch("app.services.hook_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", ""):
        with pytest.raises(HookReasoningError):
            await classify_hook(_SAMPLE_BUNDLE)


async def test_valid_multimodal_response_parses_with_both_elements_and_secondary_type(monkeypatch):
    result = await _run_with_response(monkeypatch, _valid_question_response())
    assert result.decision.primary_type == "question"
    assert result.decision.secondary_types == ["direct_address"]
    assert len(result.decision.hook_elements) == 2
    assert result.decision.probable_intent == "create_curiosity"
    assert result.decision.reasoning_contract_version == HOOK_PROMPT_VERSION
    assert result.provider == "anthropic"


async def test_unclear_primary_type_with_null_intent_is_accepted(monkeypatch):
    response = {
        "primary_type": "unclear", "secondary_types": [], "hook_elements": [],
        "probable_intent": None, "confidence": "low",
        "reasoning": "The available evidence does not clearly indicate a recognizable opening pattern.",
        "evidence_references": {},
    }
    result = await _run_with_response(monkeypatch, response)
    assert result.decision.primary_type == "unclear"
    assert result.decision.probable_intent is None


async def test_fabricated_evidence_id_is_rejected(monkeypatch):
    response = _valid_question_response()
    response["evidence_references"] = {"supporting_speech_segment_ids": [999999]}  # never offered
    with pytest.raises(HookReasoningError):
        await _run_with_response(monkeypatch, response)


async def test_fabricated_evidence_id_inside_hook_element_is_rejected(monkeypatch):
    response = _valid_question_response()
    response["hook_elements"][0]["evidence_references"] = {"supporting_speech_segment_ids": [424242]}
    with pytest.raises(HookReasoningError):
        await _run_with_response(monkeypatch, response)


async def test_invalid_primary_type_is_rejected(monkeypatch):
    response = _valid_question_response()
    response["primary_type"] = "clickbait"  # not in the vocabulary
    with pytest.raises(HookReasoningError):
        await _run_with_response(monkeypatch, response)


async def test_response_attempting_prohibited_performance_claim_is_rejected(monkeypatch):
    """Fixture required by Section 11 of the brief: a reasoner response that tries to claim
    effectiveness/retention must be structurally rejected, not merely discouraged by prompt."""
    response = _valid_question_response()
    response["reasoning"] = "This is a highly effective hook that will maximize viewer retention."
    with pytest.raises(HookReasoningError):
        await _run_with_response(monkeypatch, response)


async def test_missing_required_field_is_rejected(monkeypatch):
    response = _valid_question_response()
    del response["confidence"]
    with pytest.raises(HookReasoningError):
        await _run_with_response(monkeypatch, response)


async def test_secondary_types_outside_vocabulary_rejected(monkeypatch):
    response = _valid_question_response()
    response["secondary_types"] = ["not_a_real_type"]
    with pytest.raises(HookReasoningError):
        await _run_with_response(monkeypatch, response)


def test_prompt_lists_prohibitions_and_unclear_escape_hatch():
    assert "NEVER infer or state anything about actual viewer response" in SYSTEM_PROMPT
    assert "effectiveness score" in SYSTEM_PROMPT or "effectiveness" in SYSTEM_PROMPT
    assert '"unclear"' in SYSTEM_PROMPT


def test_prompt_requires_fact_vs_interpretation_separation():
    assert "FACT from INTERPRETATION" in SYSTEM_PROMPT
