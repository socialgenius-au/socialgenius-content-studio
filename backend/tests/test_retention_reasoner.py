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


# ---------------------------------------------------------------------------
# Stage 11.4 text-reveal correction (prompt v2): a TextElement appearing is not, by itself,
# sufficient evidence for device_type "text_reveal". These tests confirm the corrected guidance is
# actually present in the shipped prompt and that the reasoning-contract version was bumped --
# the model's own live judgment against real evidence is verified separately by the real-data rerun
# (VA159/VA5368), not by a mocked unit test, since no unit test can assert what a live LLM decides.
# ---------------------------------------------------------------------------

def test_retention_prompt_version_is_v2_after_text_reveal_correction():
    assert RETENTION_PROMPT_VERSION == "v2"


def test_prompt_states_text_appearance_alone_is_not_sufficient_for_text_reveal():
    assert 'NOT, by itself, sufficient evidence' in SYSTEM_PROMPT
    assert "text_reveal" in SYSTEM_PROMPT


def test_prompt_describes_routine_caption_subtitle_progression_pattern():
    assert "ROUTINE CAPTION/SUBTITLE PROGRESSION" in SYSTEM_PROMPT
    assert "steady stream of similar" in SYSTEM_PROMPT


def test_prompt_describes_persistent_watermark_and_garbled_ocr_patterns():
    assert "PERSISTENT WATERMARK" in SYSTEM_PROMPT
    assert "GARBLED / LOW-INFORMATION OCR" in SYSTEM_PROMPT


def test_prompt_documents_v1_subtitle_vs_reveal_limitation():
    assert "KNOWN V1 LIMITATION" in SYSTEM_PROMPT
    assert "karaoke" in SYSTEM_PROMPT


def test_prompt_gives_illustrative_not_hardcoded_support_criteria_for_text_reveal():
    assert "illustrative examples of" in SYSTEM_PROMPT
    assert "not a checklist or scoring formula" in SYSTEM_PROMPT


# ---------------------------------------------------------------------------
# Section 8 required fixtures — mocked round-trips proving the ARCHITECTURE accepts the desired
# outcome for each named scenario (the live model's actual judgment is separately confirmed by the
# real-data rerun).
# ---------------------------------------------------------------------------

_SUBTITLE_LIKE_BUNDLE = {
    "candidate_window": {"start_time": 5.0, "end_time": 8.0, "candidate_start": 6.13, "candidate_end": 6.13},
    "source_nominations": [{"source_type": "text_appearance", "source_id": 1255, "timestamp": 6.13}],
    "speech_segments": [{"id": 705, "start_time": 5.9, "end_time": 6.5, "text": "aap ki duniya bhi barbaad kar sakti hain", "language": "ur"}],
    "text_elements": [
        {"id": 1255, "start_time": 6.13, "end_time": 6.13, "text": "Ki Dun"},
        {"id": 1257, "start_time": 6.13, "end_time": 6.13, "text": "Aap"},
        {"id": 1258, "start_time": 6.4, "end_time": 6.4, "text": "Aap"},
    ],
    "shots": [{"id": 3907, "order": 0, "start_time": 0.0, "end_time": 39.87}],
    "visual_objects": [], "motion_evidence": [], "transition_evidence": [], "audio_silence": [],
    "scenes": [], "story_beats": [{"id": 5277, "start_time": 2.9, "end_time": 7.08, "boundary_status": "constructed"}],
    "editing_pacing_phases": [],
}


async def test_routine_subtitle_progression_may_be_classified_unclear(monkeypatch):
    """A candidate whose only evidence is caption-like text closely echoing concurrent speech,
    amid a stream of similar fragments, must not be forced into text_reveal by the contract --
    "unclear" is a normal, accepted outcome for exactly this shape."""
    response = {"device_type": "unclear", "confidence": "low",
                "reasoning": "The on-screen text closely tracks the concurrently spoken line as part of an ongoing caption stream; this appears to be routine subtitle rendering rather than a distinct designed reveal.",
                "evidence_references": {"supporting_speech_segment_ids": [705], "supporting_text_element_ids": [1255]}}
    monkeypatch.setattr(retention_router.settings, "RETENTION_REASONER_PROVIDER", "anthropic")
    fake_client = _fake_client_returning(response)
    with patch("app.services.retention_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.retention_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        result = await classify_retention_candidate(_SUBTITLE_LIKE_BUNDLE)
    assert result.decision.device_type == "unclear"


async def test_genuine_text_reveal_may_still_be_classified(monkeypatch):
    """A candidate where a new headline appears after a gap with no text, aligned with a structural
    transition, may still be classified text_reveal -- the correction narrows acceptance, it does
    not eliminate the category."""
    bundle = {
        "candidate_window": {"start_time": 8.0, "end_time": 11.0, "candidate_start": 9.5, "candidate_end": 9.5},
        "source_nominations": [{"source_type": "text_appearance", "source_id": 2001, "timestamp": 9.5}, {"source_type": "scene_boundary", "source_id": 55, "timestamp": 9.5}],
        "speech_segments": [],
        "text_elements": [{"id": 2001, "start_time": 9.5, "end_time": 12.0, "text": "THE SHOCKING TRUTH"}],
        "shots": [{"id": 10, "order": 0, "start_time": 0.0, "end_time": 9.5}, {"id": 11, "order": 1, "start_time": 9.5, "end_time": 20.0}],
        "visual_objects": [], "motion_evidence": [], "transition_evidence": [{"id": 900, "category": "transition_evidence", "start_time": 9.4, "end_time": 9.6, "fact": "Detected hard cut."}],
        "audio_silence": [], "scenes": [{"id": 55, "order": 1, "start_time": 9.5, "end_time": 20.0}], "story_beats": [], "editing_pacing_phases": [],
    }
    response = {"device_type": "text_reveal", "confidence": "medium",
                "reasoning": "A new headline-style phrase appears exactly at a scene cut, with no prior on-screen text in this window -- this appears designed to renew attention at the scene transition.",
                "evidence_references": {"supporting_text_element_ids": [2001], "supporting_annotation_ids": [900]}}
    monkeypatch.setattr(retention_router.settings, "RETENTION_REASONER_PROVIDER", "anthropic")
    fake_client = _fake_client_returning(response)
    with patch("app.services.retention_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.retention_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        result = await classify_retention_candidate(bundle)
    assert result.decision.device_type == "text_reveal"


async def test_garbled_ocr_only_may_be_classified_unclear(monkeypatch):
    response = {"device_type": "unclear", "confidence": "low",
                "reasoning": "The only evidence is a single unreadable OCR fragment with no supporting speech, cut, or transition -- too low-information to establish an attention-maintenance function.",
                "evidence_references": {"supporting_text_element_ids": [344]}}
    bundle = {**_SAMPLE_BUNDLE, "text_elements": [{"id": 344, "start_time": 0.15, "end_time": 0.15, "text": "٨u"}], "speech_segments": []}
    monkeypatch.setattr(retention_router.settings, "RETENTION_REASONER_PROVIDER", "anthropic")
    fake_client = _fake_client_returning(response)
    with patch("app.services.retention_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.retention_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        result = await classify_retention_candidate(bundle)
    assert result.decision.device_type == "unclear"


async def test_text_with_structural_emphasis_may_classify_emphasis_or_text_reveal(monkeypatch):
    """Text appearing alongside matching speech AND a structural/motion emphasis combination may be
    classified as either text_reveal or emphasis, whichever the evidence better supports -- the
    contract does not force one over the other."""
    response = {"device_type": "emphasis", "confidence": "medium",
                "reasoning": "New on-screen text appears exactly as speech pauses, combined with a short shot immediately following several longer ones -- this combination appears designed to create emphasis at this moment.",
                "evidence_references": {"supporting_text_element_ids": [601], "supporting_speech_segment_ids": [501]}}
    monkeypatch.setattr(retention_router.settings, "RETENTION_REASONER_PROVIDER", "anthropic")
    fake_client = _fake_client_returning(response)
    with patch("app.services.retention_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.retention_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        result = await classify_retention_candidate(_SAMPLE_BUNDLE)
    assert result.decision.device_type == "emphasis"


async def test_performance_language_guard_matches_brief_prohibited_examples(monkeypatch):
    for phrase in ["retained viewers", "kept viewers watching", "increased watch time", "improved engagement", "boosted retention", "was effective"]:
        response = _valid_question_response()
        response["reasoning"] = f"This moment {phrase} at this point in the video."
        with pytest.raises(RetentionReasoningError):
            await _run_with_response(monkeypatch, response)


async def test_cautious_attention_function_language_matches_brief_allowed_examples(monkeypatch):
    for phrase in ["appears designed to renew attention", "appears intended to create emphasis", "may function as a visual reset"]:
        response = _valid_question_response()
        response["reasoning"] = f"This moment {phrase}."
        result = await _run_with_response(monkeypatch, response)
        assert result.decision.reasoning == response["reasoning"]
