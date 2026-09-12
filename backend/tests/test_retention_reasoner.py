"""
Stage 11.4 — Retention reasoner contract + AnthropicRetentionReasoner + router tests. Every test
here uses a MOCKED Anthropic client (same AsyncMock pattern as tests/test_hook_reasoner.py) -- no
real network/API call is ever made in this file.
"""
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.retention_reasoner import RetentionReasoningError, classify_retention_candidate
from app.services.retention_reasoner.contract import (
    RETENTION_DEVICE_TYPE_VALUES, RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR,
    VALID_EVIDENCE_REFERENCE_KEYS, RetentionDecision,
)
from app.services.retention_reasoner.providers.anthropic_provider import (
    PROHIBITED_CLAIM_TERMS, RETENTION_PROMPT_VERSION, SYSTEM_PROMPT, AnthropicRetentionReasoner,
    _reject_prohibited_language,
)
import app.services.retention_reasoner.router as retention_router

_SAMPLE_BUNDLE = {
    "candidate_window": {"start_time": 10.0, "end_time": 13.0, "candidate_start": 11.0, "candidate_end": 11.5},
    "source_nominations": [{"source_type": "shot_cut", "source_id": 701, "timestamp": 11.2}],
    "speech_segments": [{"id": 501, "start_time": 10.5, "end_time": 12.5, "text": "but wait, what if you're wrong?", "language": "en"}],
    "text_elements": [{"id": 601, "start_time": 11.0, "end_time": 12.0, "text": "WAIT..."}],
    "shots": [{"id": 701, "order": 5, "start_time": 10.8, "end_time": 11.2}, {"id": 702, "order": 6, "start_time": 11.2, "end_time": 13.0}],
    "visual_objects": [], "motion_evidence": [], "transition_evidence": [], "audio_silence": [],
    "scenes": [{"id": 901, "order": 1, "start_time": 5.0, "end_time": 20.0}],
    "story_beats": [{"id": 1001, "start_time": 5.0, "end_time": 20.0, "boundary_status": "constructed"}],
    "editing_pacing_phases": [],
}


# ---------------------------------------------------------------------------
# Contract validation (no DB, no network).
# ---------------------------------------------------------------------------

def test_retention_decision_rejects_invalid_device_type():
    with pytest.raises(ValueError):
        RetentionDecision(device_type="proof_or_demo", confidence="high", reasoning="x")


def test_retention_decision_accepts_unclear():
    d = RetentionDecision(device_type="unclear", confidence="low", reasoning="insufficient evidence")
    assert d.device_type == "unclear"


def test_retention_decision_rejects_invalid_confidence():
    with pytest.raises(ValueError):
        RetentionDecision(device_type="question", confidence="certain", reasoning="x")


def test_retention_decision_validates_evidence_references():
    with pytest.raises(ValueError):
        RetentionDecision(device_type="question", confidence="high", reasoning="x", evidence_references={"bogus_key": [1]})
    d = RetentionDecision(device_type="question", confidence="high", reasoning="x", evidence_references={"supporting_speech_segment_ids": [501]})
    assert d.evidence_references == {"supporting_speech_segment_ids": [501]}


def test_device_type_vocabulary_is_small_and_excludes_deferred_categories():
    assert len(RETENTION_DEVICE_TYPE_VALUES) <= 12
    assert "other" in RETENTION_DEVICE_TYPE_VALUES
    assert "unclear" in RETENTION_DEVICE_TYPE_VALUES_WITH_UNCLEAR and "unclear" not in RETENTION_DEVICE_TYPE_VALUES
    # Explicitly excluded per the Stage 11.4 brief -- not part of the V1 vocabulary at all.
    for excluded in ("proof", "demo", "open_loop", "curiosity_gap", "payoff_delay"):
        assert excluded not in RETENTION_DEVICE_TYPE_VALUES


def test_evidence_reference_keys_match_candidate_bundle_shape():
    assert "supporting_scene_ids" in VALID_EVIDENCE_REFERENCE_KEYS
    assert "supporting_story_beat_ids" in VALID_EVIDENCE_REFERENCE_KEYS
    assert "supporting_visual_object_ids" in VALID_EVIDENCE_REFERENCE_KEYS


# ---------------------------------------------------------------------------
# Prohibited-language structural enforcement.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("term", ["effective", "engaging", "compelling", "retention", "viral", "convert", "successful", "score", "held attention"])
def test_reject_prohibited_language_catches_each_documented_term(term):
    with pytest.raises(RetentionReasoningError):
        _reject_prohibited_language(f"this moment is genuinely {term} at keeping people around")


def test_reject_prohibited_language_allows_clean_factual_reasoning():
    _reject_prohibited_language("A short cut interrupts a long static shot, paired with a spoken question.")  # must not raise


def test_prohibited_claim_terms_list_is_the_single_source_used_by_the_check():
    assert "retention" in PROHIBITED_CLAIM_TERMS
    assert "virality" in PROHIBITED_CLAIM_TERMS
    assert "held attention" in PROHIBITED_CLAIM_TERMS


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
        "device_type": "question",
        "confidence": "high",
        "reasoning": "A spoken question ('what if you're wrong?') is reinforced by matching on-screen text at the same moment.",
        "evidence_references": {"supporting_speech_segment_ids": [501], "supporting_text_element_ids": [601]},
    }


async def _run_with_response(monkeypatch, response_json):
    monkeypatch.setattr(retention_router.settings, "RETENTION_REASONER_PROVIDER", "anthropic")
    fake_client = _fake_client_returning(response_json)
    with patch("app.services.retention_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.retention_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        return await classify_retention_candidate(_SAMPLE_BUNDLE)


def test_anthropic_retention_reasoner_is_registered():
    assert "anthropic" in retention_router._REASONER_PROVIDERS
    assert isinstance(retention_router._REASONER_PROVIDERS["anthropic"], AnthropicRetentionReasoner)


async def test_unconfigured_provider_name_raises_never_calls_client(monkeypatch):
    monkeypatch.setattr(retention_router.settings, "RETENTION_REASONER_PROVIDER", "")
    with pytest.raises(RetentionReasoningError):
        await classify_retention_candidate(_SAMPLE_BUNDLE)


async def test_missing_api_key_raises_never_calls_client(monkeypatch):
    monkeypatch.setattr(retention_router.settings, "RETENTION_REASONER_PROVIDER", "anthropic")
    with patch("app.services.retention_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", ""):
        with pytest.raises(RetentionReasoningError):
            await classify_retention_candidate(_SAMPLE_BUNDLE)


async def test_valid_question_response_parses(monkeypatch):
    result = await _run_with_response(monkeypatch, _valid_question_response())
    assert result.decision.device_type == "question"
    assert result.decision.confidence == "high"
    assert result.decision.reasoning_contract_version == RETENTION_PROMPT_VERSION
    assert result.provider == "anthropic"


async def test_unclear_device_type_is_accepted(monkeypatch):
    response = {
        "device_type": "unclear", "confidence": "low",
        "reasoning": "The available evidence does not clearly support any single device type.",
        "evidence_references": {},
    }
    result = await _run_with_response(monkeypatch, response)
    assert result.decision.device_type == "unclear"


async def test_fabricated_evidence_id_is_rejected(monkeypatch):
    response = _valid_question_response()
    response["evidence_references"] = {"supporting_speech_segment_ids": [999999]}  # never offered
    with pytest.raises(RetentionReasoningError):
        await _run_with_response(monkeypatch, response)


async def test_invalid_device_type_is_rejected(monkeypatch):
    response = _valid_question_response()
    response["device_type"] = "clickbait"  # not in the vocabulary
    with pytest.raises(RetentionReasoningError):
        await _run_with_response(monkeypatch, response)


async def test_response_attempting_prohibited_performance_claim_is_rejected(monkeypatch):
    response = _valid_question_response()
    response["reasoning"] = "This moment is highly effective and maximizes viewer retention."
    with pytest.raises(RetentionReasoningError):
        await _run_with_response(monkeypatch, response)


async def test_missing_required_field_is_rejected(monkeypatch):
    response = _valid_question_response()
    del response["confidence"]
    with pytest.raises(RetentionReasoningError):
        await _run_with_response(monkeypatch, response)


async def test_invalid_confidence_is_rejected(monkeypatch):
    response = _valid_question_response()
    response["confidence"] = "certain"
    with pytest.raises(RetentionReasoningError):
        await _run_with_response(monkeypatch, response)


def test_prompt_contains_conservative_question_rule():
    assert "ONLY if the transcript or on-screen text evidence itself" in SYSTEM_PROMPT


def test_prompt_contains_conservative_pattern_interrupt_and_emphasis_rule():
    assert "pattern_interrupt" in SYSTEM_PROMPT and "COMBINATION" in SYSTEM_PROMPT


def test_prompt_lists_prohibitions_and_unclear_escape_hatch():
    assert "NEVER infer or state anything about actual viewer attention" in SYSTEM_PROMPT
    assert '"unclear"' in SYSTEM_PROMPT


def test_prompt_requires_fact_vs_interpretation_separation():
    assert "FACT from INTERPRETATION" in SYSTEM_PROMPT
