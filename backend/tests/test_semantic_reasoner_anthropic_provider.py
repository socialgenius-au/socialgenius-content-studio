"""
Stage 10.2B2 — AnthropicSemanticReasoner (app/services/semantic_reasoner/providers/
anthropic_provider.py). Every test here uses a MOCKED Anthropic client (same AsyncMock pattern as
tests/test_ai_router.py) -- no real network/API call is ever made in this file.

Covers this phase's own required deterministic test list:
  - registration/routing (the provider is registered under "anthropic" and reachable via
    reason_about_boundary once SEMANTIC_REASONER_PROVIDER is set).
  - configured/unconfigured behaviour.
  - valid true / false / null results.
  - malformed structured response rejection.
  - unknown evidence-reference ID rejection.
  - missing required fields.
  - invalid confidence value.
  - provider (API) failure.
  - original multilingual text passed unchanged to the model (never translated before sending).
  - language treated as a hint, never asserted as ground truth, in the actual prompt sent.
  - no Scene creation / Shot.scene_id untouched (structural).
"""
import json
from unittest.mock import AsyncMock, patch

import anthropic
import pytest

from app.services.semantic_reasoner import SemanticReasoningError, reason_about_boundary
from app.services.semantic_reasoner.providers.anthropic_provider import (
    SYSTEM_PROMPT,
    AnthropicSemanticReasoner,
    _build_user_prompt,
    _collect_valid_evidence_ids,
)
import app.services.semantic_reasoner.router as reasoner_router

_SAMPLE_BUNDLE = {
    "candidate_timestamp": 12.0,
    "source_nominations": [{"source_type": "speech_gap", "source_id": 1, "timestamp": 12.0}],
    "speech_before": {"id": 101, "start_time": 9.08, "end_time": 11.8, "text": "تو آپ کی ماز سے بھی زیادہ محبت دے سکتے ہیں", "language": "hi"},
    "speech_after": {"id": 102, "start_time": 12.0, "end_time": 14.4, "text": "لیکن وہی اورت اگر", "language": "hi"},
    "ocr_before": None, "ocr_after": None,
    "shots_overlapping": [{"id": 3907, "order": 0, "start_time": 0.0, "end_time": 39.866667}],
    "nearby_annotations": {"audio_silence": [], "transition_evidence": [], "transition_similarity_evidence": [],
                            "recurring_text_element": [], "persistent_visual_element": []},
    "visual_objects_before": [], "visual_objects_after": [],
}


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


def _valid_true_response():
    return {
        "is_semantic_boundary": True, "confidence": "high", "confidence_score": None,
        "reasoning": "A contrastive marker introduces a reversal.",
        "evidence_references": {"supporting_speech_segment_ids": [101, 102]},
    }


# ---------------------------------------------------------------------------
# Registration/routing + configured/unconfigured behaviour.
# ---------------------------------------------------------------------------

def test_anthropic_reasoner_is_registered_under_the_expected_name():
    assert "anthropic" in reasoner_router._REASONER_PROVIDERS
    assert isinstance(reasoner_router._REASONER_PROVIDERS["anthropic"], AnthropicSemanticReasoner)


async def test_unconfigured_reasoner_raises_never_calls_the_client(monkeypatch):
    monkeypatch.setattr(reasoner_router.settings, "SEMANTIC_REASONER_PROVIDER", "anthropic")
    with patch("app.services.semantic_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", ""):
        with pytest.raises(SemanticReasoningError, match="not configured"):
            await reason_about_boundary(_SAMPLE_BUNDLE)


async def test_configured_reasoner_reaches_the_mocked_client(monkeypatch):
    monkeypatch.setattr(reasoner_router.settings, "SEMANTIC_REASONER_PROVIDER", "anthropic")
    monkeypatch.setattr(reasoner_router.settings, "SEMANTIC_REASONER_MODEL", "claude-sonnet-4-20250514")
    fake_client = _fake_client_returning(_valid_true_response())
    with patch("app.services.semantic_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.semantic_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        result = await reason_about_boundary(_SAMPLE_BUNDLE)
    assert result.provider == "anthropic"
    assert result.model == "claude-sonnet-4-20250514"
    fake_client.messages.create.assert_awaited_once()


# ---------------------------------------------------------------------------
# Valid true / false / null results.
# ---------------------------------------------------------------------------

async def _run_with_response(monkeypatch, response_json):
    monkeypatch.setattr(reasoner_router.settings, "SEMANTIC_REASONER_PROVIDER", "anthropic")
    fake_client = _fake_client_returning(response_json)
    with patch("app.services.semantic_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.semantic_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        return await reason_about_boundary(_SAMPLE_BUNDLE)


async def test_valid_true_result_is_accepted(monkeypatch):
    result = await _run_with_response(monkeypatch, _valid_true_response())
    assert result.decision.is_semantic_boundary is True
    assert result.decision.confidence == "high"


async def test_valid_false_result_is_accepted(monkeypatch):
    response = {
        "is_semantic_boundary": False, "confidence": "medium", "confidence_score": None,
        "reasoning": "Clear continuation of the same point.", "evidence_references": {},
    }
    result = await _run_with_response(monkeypatch, response)
    assert result.decision.is_semantic_boundary is False


async def test_valid_null_result_is_accepted_and_distinct_from_false(monkeypatch):
    response = {
        "is_semantic_boundary": None, "confidence": "low", "confidence_score": None,
        "reasoning": "Insufficient content on one side to compare.", "evidence_references": {},
    }
    result = await _run_with_response(monkeypatch, response)
    assert result.decision.is_semantic_boundary is None
    assert result.decision.is_semantic_boundary is not False


# ---------------------------------------------------------------------------
# Malformed structured response rejection.
# ---------------------------------------------------------------------------

async def test_non_json_response_is_rejected(monkeypatch):
    with pytest.raises(SemanticReasoningError, match="not valid JSON|could not be parsed"):
        await _run_with_response(monkeypatch, "Sure! I think this is a boundary.")


async def test_response_with_surrounding_prose_is_extracted(monkeypatch):
    # A model that ignores "no commentary" instructions and wraps the JSON in stray prose -- this
    # module's own brace-extraction fallback (mirroring app.services.claude's own) should still
    # recover it.
    wrapped = "Here is my answer:\n" + json.dumps(_valid_true_response()) + "\nThat's my analysis."
    result = await _run_with_response(monkeypatch, wrapped)
    assert result.decision.is_semantic_boundary is True


# ---------------------------------------------------------------------------
# Missing required fields.
# ---------------------------------------------------------------------------

async def test_missing_required_field_is_rejected(monkeypatch):
    incomplete = {"is_semantic_boundary": True, "confidence": "high"}  # missing reasoning, evidence_references
    with pytest.raises(SemanticReasoningError, match="missing required field"):
        await _run_with_response(monkeypatch, incomplete)


# ---------------------------------------------------------------------------
# Invalid confidence value.
# ---------------------------------------------------------------------------

async def test_invalid_confidence_value_is_rejected(monkeypatch):
    response = {
        "is_semantic_boundary": True, "confidence": "very high", "confidence_score": None,
        "reasoning": "x", "evidence_references": {},
    }
    with pytest.raises(SemanticReasoningError, match="confidence must be one of"):
        await _run_with_response(monkeypatch, response)


async def test_non_bool_non_null_is_semantic_boundary_is_rejected(monkeypatch):
    response = {
        "is_semantic_boundary": "true", "confidence": "high", "confidence_score": None,
        "reasoning": "x", "evidence_references": {},
    }
    with pytest.raises(SemanticReasoningError, match="is_semantic_boundary must be"):
        await _run_with_response(monkeypatch, response)


# ---------------------------------------------------------------------------
# Unknown evidence-reference ID rejection -- never allow invented provenance.
# ---------------------------------------------------------------------------

async def test_cited_id_not_in_bundle_is_rejected(monkeypatch):
    response = {
        "is_semantic_boundary": True, "confidence": "high", "confidence_score": None,
        "reasoning": "x", "evidence_references": {"supporting_speech_segment_ids": [999999]},
    }
    with pytest.raises(SemanticReasoningError, match="never offered in this bundle"):
        await _run_with_response(monkeypatch, response)


async def test_unsupported_evidence_reference_key_is_rejected(monkeypatch):
    response = {
        "is_semantic_boundary": True, "confidence": "high", "confidence_score": None,
        "reasoning": "x", "evidence_references": {"supporting_frame_ids": [1]},
    }
    with pytest.raises(SemanticReasoningError, match="unsupported evidence_references key"):
        await _run_with_response(monkeypatch, response)


def test_collect_valid_evidence_ids_matches_bundle_contents():
    valid_ids = _collect_valid_evidence_ids(_SAMPLE_BUNDLE)
    assert valid_ids["supporting_speech_segment_ids"] == [101, 102]
    assert valid_ids["supporting_shot_ids"] == [3907]


# ---------------------------------------------------------------------------
# Provider (API) failure.
# ---------------------------------------------------------------------------

async def test_api_failure_raises_never_returns_a_result(monkeypatch):
    monkeypatch.setattr(reasoner_router.settings, "SEMANTIC_REASONER_PROVIDER", "anthropic")
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(side_effect=anthropic.APIConnectionError(request=AsyncMock()))
    with patch("app.services.semantic_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.semantic_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        with pytest.raises(SemanticReasoningError, match="Could not reach Anthropic Claude"):
            await reason_about_boundary(_SAMPLE_BUNDLE)


# ---------------------------------------------------------------------------
# Original multilingual text passed unchanged; language treated as a hint, not ground truth.
# ---------------------------------------------------------------------------

def test_original_urdu_hindi_script_text_sent_unchanged_in_prompt():
    valid_ids = _collect_valid_evidence_ids(_SAMPLE_BUNDLE)
    prompt = _build_user_prompt(_SAMPLE_BUNDLE, valid_ids)
    assert "تو آپ کی ماز سے بھی زیادہ محبت دے سکتے ہیں" in prompt
    assert "لیکن وہی اورت اگر" in prompt
    # The bundle's own raw language code passes through unchanged too -- never rewritten/upgraded.
    assert '"language": "hi"' in prompt


def test_language_is_presented_as_a_hint_never_as_asserted_ground_truth():
    # The actual system prompt sent to the model must contain the "language is only a measured
    # hint, may be imprecise" discipline -- not merely documented in a code comment.
    assert "hint" in SYSTEM_PROMPT.lower()
    assert "ground truth" in SYSTEM_PROMPT.lower() or "imprecise" in SYSTEM_PROMPT.lower()
    # And the prompt-builder itself never injects an authoritative claim like "This text is Hindi."
    valid_ids = _collect_valid_evidence_ids(_SAMPLE_BUNDLE)
    prompt = _build_user_prompt(_SAMPLE_BUNDLE, valid_ids)
    assert "this text is hindi" not in prompt.lower()
    assert "this text is urdu" not in prompt.lower()


def test_no_benchmark_labels_or_video_specific_hard_coding_in_the_prompt():
    # The generic system prompt must never mention a specific video id, a specific timestamp
    # value tied to this project's own benchmark, or a specific language name as a rule target.
    forbidden = ("rv146", "rv5127", "5368", "12.0", "25.64", "39.86", "urdu", "hindi", "لیکن")
    combined = SYSTEM_PROMPT.lower()
    for term in forbidden:
        assert term not in combined


# ---------------------------------------------------------------------------
# Structural: no Scene creation, no Shot.scene_id mutation -- this provider touches no DB at all.
# ---------------------------------------------------------------------------

def test_anthropic_provider_module_imports_no_orm_model():
    import inspect
    import app.services.semantic_reasoner.providers.anthropic_provider as module
    source = inspect.getsource(module)
    assert "from app.models" not in source
    assert "AsyncSession" not in source
