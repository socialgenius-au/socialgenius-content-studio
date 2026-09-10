"""
Stage 10.3B2 — AnthropicStoryBeatReasoner + router (app/services/story_beat_reasoner/providers/
anthropic_provider.py, app/services/story_beat_reasoner/router.py). Every test here uses a MOCKED
Anthropic client (same AsyncMock pattern as tests/test_semantic_reasoner_anthropic_provider.py) --
no real network/API call is ever made in this file.

Covers this phase's own required 16-test list:
  (1) valid True response parses
  (2) valid False response parses
  (3) valid None response parses
  (4) prompt version = v1 propagates correctly
  (5) provider/model attribution correct
  (6) invalid confidence rejected
  (7) malformed boolean/None rejected
  (8) unknown evidence-reference keys rejected
  (9) fabricated evidence IDs rejected
  (10) Story Beat-specific exception on provider/parse failure
  (11) prompt explicitly distinguishes Story Beat from Scene
  (12) prompt explicitly says pause/Shot/OCR/etc. alone are insufficient
  (13) no Story Beat type/taxonomy requested or returned
  (14) no marketing-specific vocabulary is required by the contract
  (15) no persistence/DB imports introduced
  (16) no Stage 10.2 provider/prompt files modified
"""
import json
from unittest.mock import AsyncMock, patch

import anthropic
import pytest

from app.services.story_beat_reasoner import StoryBeatReasoningError, reason_about_story_beat_boundary
from app.services.story_beat_reasoner.providers.anthropic_provider import (
    STORY_BEAT_PROMPT_VERSION,
    SYSTEM_PROMPT,
    AnthropicStoryBeatReasoner,
    _build_user_prompt,
    _collect_valid_evidence_ids,
)
import app.services.story_beat_reasoner.router as beat_router

# The exact same per-candidate bundle shape assemble_semantic_boundary_candidates() already
# produces -- reused unmodified, per Stage 10.3A's own audit, for Story Beat candidates too.
_SAMPLE_BUNDLE = {
    "candidate_timestamp": 12.0,
    "source_nominations": [{"source_type": "speech_gap", "source_id": 1, "timestamp": 12.0}],
    "speech_before": {"id": 101, "start_time": 9.08, "end_time": 11.8, "text": "so the first step is to open the file", "language": "en"},
    "speech_after": {"id": 102, "start_time": 12.0, "end_time": 14.4, "text": "for example, consider this simple case", "language": "en"},
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
        "is_story_beat_boundary": True, "confidence": "high",
        "reasoning": "the explanation shifts into a concrete worked example here.",
        "evidence_references": {"supporting_speech_segment_ids": [101, 102]},
    }


async def _run_with_response(monkeypatch, response_json):
    monkeypatch.setattr(beat_router.settings, "STORY_BEAT_REASONER_PROVIDER", "anthropic")
    fake_client = _fake_client_returning(response_json)
    with patch("app.services.story_beat_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.story_beat_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        return await reason_about_story_beat_boundary(_SAMPLE_BUNDLE)


# ---------------------------------------------------------------------------
# Registration/routing + configured/unconfigured behaviour.
# ---------------------------------------------------------------------------

def test_anthropic_story_beat_reasoner_is_registered_under_the_expected_name():
    assert "anthropic" in beat_router._REASONER_PROVIDERS
    assert isinstance(beat_router._REASONER_PROVIDERS["anthropic"], AnthropicStoryBeatReasoner)


async def test_unconfigured_provider_name_raises_never_calls_the_client(monkeypatch):
    monkeypatch.setattr(beat_router.settings, "STORY_BEAT_REASONER_PROVIDER", "")
    with pytest.raises(StoryBeatReasoningError, match="No Story Beat reasoner is configured"):
        await reason_about_story_beat_boundary(_SAMPLE_BUNDLE)


async def test_missing_anthropic_api_key_raises_never_calls_the_client(monkeypatch):
    monkeypatch.setattr(beat_router.settings, "STORY_BEAT_REASONER_PROVIDER", "anthropic")
    with patch("app.services.story_beat_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", ""):
        with pytest.raises(StoryBeatReasoningError, match="not configured"):
            await reason_about_story_beat_boundary(_SAMPLE_BUNDLE)


# ---------------------------------------------------------------------------
# (1)(2)(3) Valid True / False / None results.
# ---------------------------------------------------------------------------

async def test_valid_true_result_is_accepted(monkeypatch):
    result = await _run_with_response(monkeypatch, _valid_true_response())
    assert result.decision.is_story_beat_boundary is True
    assert result.decision.confidence == "high"


async def test_valid_false_result_is_accepted(monkeypatch):
    response = {
        "is_story_beat_boundary": False, "confidence": "medium",
        "reasoning": "continues the same communicative move.", "evidence_references": {},
    }
    result = await _run_with_response(monkeypatch, response)
    assert result.decision.is_story_beat_boundary is False


async def test_valid_none_result_is_accepted_and_distinct_from_false(monkeypatch):
    response = {
        "is_story_beat_boundary": None, "confidence": "low",
        "reasoning": "insufficient evidence to tell either way.", "evidence_references": {},
    }
    result = await _run_with_response(monkeypatch, response)
    assert result.decision.is_story_beat_boundary is None
    assert result.decision.is_story_beat_boundary is not False


# ---------------------------------------------------------------------------
# (4) Prompt version v1 propagates correctly.
# ---------------------------------------------------------------------------

async def test_prompt_version_v1_propagates_to_decision_and_result(monkeypatch):
    assert STORY_BEAT_PROMPT_VERSION == "v1"
    result = await _run_with_response(monkeypatch, _valid_true_response())
    assert result.decision.reasoning_contract_version == "v1"
    assert result.reasoning_contract_version == "v1"


# ---------------------------------------------------------------------------
# (5) Provider/model attribution correct.
# ---------------------------------------------------------------------------

async def test_provider_and_model_attribution_correct(monkeypatch):
    monkeypatch.setattr(beat_router.settings, "STORY_BEAT_REASONER_MODEL", "claude-sonnet-4-6")
    result = await _run_with_response(monkeypatch, _valid_true_response())
    assert result.provider == "anthropic"
    assert result.model == "claude-sonnet-4-6"


# ---------------------------------------------------------------------------
# (6) Invalid confidence rejected.
# ---------------------------------------------------------------------------

async def test_invalid_confidence_value_is_rejected(monkeypatch):
    response = {
        "is_story_beat_boundary": True, "confidence": "very high",
        "reasoning": "x", "evidence_references": {},
    }
    with pytest.raises(StoryBeatReasoningError, match="confidence must be one of"):
        await _run_with_response(monkeypatch, response)


# ---------------------------------------------------------------------------
# (7) Malformed boolean/None rejected.
# ---------------------------------------------------------------------------

async def test_non_bool_non_null_is_story_beat_boundary_is_rejected(monkeypatch):
    response = {
        "is_story_beat_boundary": "true", "confidence": "high",
        "reasoning": "x", "evidence_references": {},
    }
    with pytest.raises(StoryBeatReasoningError, match="is_story_beat_boundary must be"):
        await _run_with_response(monkeypatch, response)


async def test_missing_required_field_is_rejected(monkeypatch):
    incomplete = {"is_story_beat_boundary": True, "confidence": "high"}  # missing reasoning, evidence_references
    with pytest.raises(StoryBeatReasoningError, match="missing required field"):
        await _run_with_response(monkeypatch, incomplete)


# ---------------------------------------------------------------------------
# (8) Unknown evidence-reference keys rejected.
# ---------------------------------------------------------------------------

async def test_unsupported_evidence_reference_key_is_rejected(monkeypatch):
    response = {
        "is_story_beat_boundary": True, "confidence": "high",
        "reasoning": "x", "evidence_references": {"supporting_beat_type_ids": [1]},
    }
    with pytest.raises(StoryBeatReasoningError, match="unsupported evidence_references key"):
        await _run_with_response(monkeypatch, response)


# ---------------------------------------------------------------------------
# (9) Fabricated evidence IDs rejected.
# ---------------------------------------------------------------------------

async def test_cited_id_not_in_bundle_is_rejected(monkeypatch):
    response = {
        "is_story_beat_boundary": True, "confidence": "high",
        "reasoning": "x", "evidence_references": {"supporting_speech_segment_ids": [999999]},
    }
    with pytest.raises(StoryBeatReasoningError, match="never offered in this bundle"):
        await _run_with_response(monkeypatch, response)


def test_collect_valid_evidence_ids_matches_bundle_contents():
    valid_ids = _collect_valid_evidence_ids(_SAMPLE_BUNDLE)
    assert valid_ids["supporting_speech_segment_ids"] == [101, 102]
    assert valid_ids["supporting_shot_ids"] == [3907]
    # The bundle carries no frame evidence today -- always empty, but still a real key.
    assert valid_ids["supporting_frame_ids"] == []


# ---------------------------------------------------------------------------
# (10) Story Beat-specific exception on provider/parse failure -- never
# SemanticReasoningError, never a fabricated result.
# ---------------------------------------------------------------------------

async def test_api_failure_raises_story_beat_specific_error(monkeypatch):
    monkeypatch.setattr(beat_router.settings, "STORY_BEAT_REASONER_PROVIDER", "anthropic")
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(side_effect=anthropic.APIConnectionError(request=AsyncMock()))
    with patch("app.services.story_beat_reasoner.providers.anthropic_provider.get_client", return_value=fake_client), \
         patch("app.services.story_beat_reasoner.providers.anthropic_provider.settings.ANTHROPIC_API_KEY", "sk-ant-fake"):
        with pytest.raises(StoryBeatReasoningError, match="Could not reach Anthropic Claude"):
            await reason_about_story_beat_boundary(_SAMPLE_BUNDLE)


async def test_non_json_response_raises_story_beat_specific_error(monkeypatch):
    with pytest.raises(StoryBeatReasoningError, match="not valid JSON|could not be parsed"):
        await _run_with_response(monkeypatch, "Sure! I think a beat happens here.")


def test_story_beat_reasoning_error_is_never_semantic_reasoning_error():
    from app.services.semantic_reasoner.contract import SemanticReasoningError
    assert StoryBeatReasoningError is not SemanticReasoningError
    assert not issubclass(StoryBeatReasoningError, SemanticReasoningError)


async def test_response_with_surrounding_prose_is_extracted(monkeypatch):
    wrapped = "Here is my answer:\n" + json.dumps(_valid_true_response()) + "\nThat's my analysis."
    result = await _run_with_response(monkeypatch, wrapped)
    assert result.decision.is_story_beat_boundary is True


# ---------------------------------------------------------------------------
# (11) Prompt explicitly distinguishes Story Beat from Scene.
# ---------------------------------------------------------------------------

def _prompt_lower() -> str:
    return SYSTEM_PROMPT.lower()


def test_prompt_explicitly_distinguishes_story_beat_from_scene():
    prompt = _prompt_lower()
    assert "scene" in prompt
    assert "central proposition, topic, or function" in prompt or (
        "central proposition" in prompt and "topic" in prompt
    )
    assert "does not require that a scene boundary occurs" in prompt


def test_prompt_states_story_beat_can_occur_inside_one_continuous_scene():
    prompt = _prompt_lower()
    assert "inside a single continuous scene" in prompt or "inside one continuous scene" in prompt


def test_prompt_states_scene_boundary_does_not_imply_a_story_beat():
    prompt = _prompt_lower()
    assert "does not automatically mean a story beat also occurs" in prompt


def test_prompt_locks_the_exact_story_beat_question():
    prompt = _prompt_lower()
    assert "does the source make a meaningful rhetorical" in prompt
    assert "or communicative move" in prompt
    assert "even if the underlying topic, proposition, or function" in prompt


# ---------------------------------------------------------------------------
# (12) Prompt explicitly says pause/Shot/OCR/etc. alone are insufficient.
# ---------------------------------------------------------------------------

def test_prompt_lists_all_ten_insufficient_alone_signals():
    prompt = _prompt_lower()
    required_signals = (
        "a silence or pause in speech",
        "a sentence simply ending",
        "a speaker taking a breath",
        "a technical shot boundary or edit cut",
        "a camera angle or camera movement change",
        "on-screen text (ocr) appearing, changing, or disappearing",
        "a representative video frame changing",
        "a change in music or background audio",
        "a semantic scene boundary being reported nearby",
        "a new evidence source",
    )
    for signal in required_signals:
        assert signal in prompt, f"missing insufficient-alone signal: {signal!r}"
    assert "only nominates a moment as worth examining" in prompt


# ---------------------------------------------------------------------------
# (13) No Story Beat type/taxonomy requested or returned.
# ---------------------------------------------------------------------------

def test_prompt_requests_no_beat_type_or_taxonomy():
    prompt = _prompt_lower()
    assert "never a type to assign" in prompt
    assert "never something you name or categorize" in prompt
    assert '"beat_type"' not in SYSTEM_PROMPT
    assert '"story_beat_type"' not in SYSTEM_PROMPT
    assert '"rhetorical_move"' not in SYSTEM_PROMPT


def test_response_schema_carries_no_taxonomy_field():
    expected_schema_block = '''{
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
}'''
    assert expected_schema_block in SYSTEM_PROMPT


def test_decision_dataclass_never_carries_a_type_field():
    import dataclasses
    from app.services.story_beat_reasoner.contract import StoryBeatDecision
    field_names = {f.name for f in dataclasses.fields(StoryBeatDecision)}
    for forbidden in ("beat_type", "narrative_role", "rhetorical_type", "category"):
        assert forbidden not in field_names


# ---------------------------------------------------------------------------
# (14) No marketing-specific vocabulary is required by the contract.
# ---------------------------------------------------------------------------

def test_prompt_explicitly_excludes_marketing_vocabulary_from_the_task():
    prompt = _prompt_lower()
    assert "do not analyze this content for hooks, calls-to-action" in prompt


def test_prompt_never_requires_marketing_vocabulary_in_the_response():
    # The prompt may EXCLUDE marketing terms by name (rejecting them), but the strict response
    # schema and every reasoning example must never REQUIRE hook/CTA/funnel/virality vocabulary.
    forbidden_required_terms = (
        '"hook"', '"cta"', '"pain_point"', '"buyer_stage"', '"virality"', '"funnel"',
    )
    for term in forbidden_required_terms:
        assert term not in SYSTEM_PROMPT.lower()


def test_prompt_is_domain_neutral_naming_multiple_unrelated_domains():
    prompt = _prompt_lower()
    for domain in ("education", "medic", "software tutorial", "accounting", "documentary", "product or business"):
        assert domain in prompt


# ---------------------------------------------------------------------------
# (15) No persistence/DB imports introduced anywhere in this package.
# ---------------------------------------------------------------------------

def test_no_module_in_story_beat_reasoner_package_imports_orm_or_db_session():
    import inspect
    import app.services.story_beat_reasoner.contract as contract_module
    import app.services.story_beat_reasoner.router as router_module
    import app.services.story_beat_reasoner.providers.base as base_module
    import app.services.story_beat_reasoner.providers.anthropic_provider as provider_module

    for module in (contract_module, router_module, base_module, provider_module):
        source = inspect.getsource(module)
        assert "from app.models" not in source
        assert "AsyncSession" not in source
        assert "app.database" not in source
        assert "sqlalchemy" not in source.lower()


def test_no_persistence_function_names_exist_in_the_package():
    import app.services.story_beat_reasoner as package_module
    for forbidden in ("persist_reasoning_result", "load_latest_reasoning_results", "save", "persist"):
        assert not hasattr(package_module, forbidden)


# ---------------------------------------------------------------------------
# (16) No Stage 10.2 provider/prompt files modified.
# ---------------------------------------------------------------------------

def test_semantic_scene_prompt_version_and_content_remain_untouched():
    # Stage 10.3B2 must not have modified the locked Semantic Scene prompt/provider in any way --
    # confirm its own version constant and a known, already-tested rule string are still exactly
    # what Stage 10.2B2F shipped.
    from app.services.semantic_reasoner.providers.anthropic_provider import (
        SEMANTIC_BOUNDARY_PROMPT_VERSION,
        SYSTEM_PROMPT as SCENE_SYSTEM_PROMPT,
    )
    assert SEMANTIC_BOUNDARY_PROMPT_VERSION == "v3"
    assert "central proposition, topic, or function" in SCENE_SYSTEM_PROMPT.lower()
    assert "story beat" not in SCENE_SYSTEM_PROMPT.lower() or "do not produce a story beat" in SCENE_SYSTEM_PROMPT.lower()


def test_story_beat_provider_module_is_a_separate_file_never_importing_scene_provider():
    import ast
    import inspect
    import app.services.story_beat_reasoner.providers.anthropic_provider as module

    tree = ast.parse(inspect.getsource(module))
    imported_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_names.add(node.module)

    assert not any(name.startswith("app.services.semantic_reasoner") for name in imported_names)
