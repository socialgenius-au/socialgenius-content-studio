"""
Video Deconstructor — Stage 10.3B1: Story Beat Reasoning Contract.

Pure dataclass/contract tests -- no DB, no real reasoning, no external API of any kind. Mirrors
tests/test_semantic_reasoner_contract.py's own convention exactly, adapted for the sibling
Story Beat contract.
"""
import pytest

from app.services.story_beat_reasoner.contract import (
    VALID_CONFIDENCE_LEVELS,
    VALID_EVIDENCE_REFERENCE_KEYS,
    StoryBeatDecision,
    StoryBeatReasoningError,
    StoryBeatResult,
)


# ---------------------------------------------------------------------------
# Valid True / False / None decisions.
# ---------------------------------------------------------------------------

def test_valid_true_decision():
    decision = StoryBeatDecision(
        is_story_beat_boundary=True, confidence="high", reasoning="a new communicative move begins here",
        evidence_references={"supporting_speech_segment_ids": [1, 2]},
    )
    assert decision.is_story_beat_boundary is True


def test_valid_false_decision():
    decision = StoryBeatDecision(
        is_story_beat_boundary=False, confidence="medium", reasoning="continues the same communicative move",
        evidence_references={},
    )
    assert decision.is_story_beat_boundary is False


def test_valid_none_undecided_decision():
    decision = StoryBeatDecision(
        is_story_beat_boundary=None, confidence="low", reasoning="insufficient evidence to tell",
        evidence_references={},
    )
    assert decision.is_story_beat_boundary is None
    assert decision.is_story_beat_boundary is not False  # "don't know" != "no"


# ---------------------------------------------------------------------------
# Categorical confidence validation.
# ---------------------------------------------------------------------------

def test_confidence_must_be_one_of_the_valid_levels():
    assert VALID_CONFIDENCE_LEVELS == ("low", "medium", "high")
    for level in VALID_CONFIDENCE_LEVELS:
        StoryBeatDecision(is_story_beat_boundary=None, confidence=level, reasoning="x", evidence_references={})


def test_invalid_confidence_rejected():
    with pytest.raises(ValueError, match="confidence must be one of"):
        StoryBeatDecision(is_story_beat_boundary=True, confidence="very high", reasoning="x", evidence_references={})


# ---------------------------------------------------------------------------
# reasoning_contract_version survives construction.
# ---------------------------------------------------------------------------

def test_reasoning_contract_version_survives_construction():
    decision = StoryBeatDecision(
        is_story_beat_boundary=True, confidence="high", reasoning="x", evidence_references={},
        reasoning_contract_version="v1",
    )
    assert decision.reasoning_contract_version == "v1"


def test_reasoning_contract_version_defaults_to_none():
    decision = StoryBeatDecision(is_story_beat_boundary=None, confidence="low", reasoning="x", evidence_references={})
    assert decision.reasoning_contract_version is None


def test_story_beat_result_carries_reasoning_contract_version():
    decision = StoryBeatDecision(is_story_beat_boundary=True, confidence="high", reasoning="x", evidence_references={})
    result = StoryBeatResult(
        decision=decision, provider="anthropic", model="claude-sonnet-4-6",
        candidate_timestamp=12.5, reasoning_contract_version="v1",
    )
    assert result.reasoning_contract_version == "v1"
    assert result.candidate_timestamp == 12.5


# ---------------------------------------------------------------------------
# Bounded evidence-reference shape; malformed evidence rejected.
# ---------------------------------------------------------------------------

def test_evidence_reference_keys_include_the_full_five_key_scene_details_vocabulary():
    # Deliberately the FULL five-key set (including supporting_frame_ids), not the Scene
    # reasoner's own narrower four-key subset -- see contract.py's own docstring for why.
    assert VALID_EVIDENCE_REFERENCE_KEYS == {
        "supporting_shot_ids", "supporting_frame_ids", "supporting_speech_segment_ids",
        "supporting_text_element_ids", "supporting_annotation_ids",
    }


def test_all_valid_evidence_keys_accepted():
    refs = {key: [1, 2] for key in VALID_EVIDENCE_REFERENCE_KEYS}
    decision = StoryBeatDecision(is_story_beat_boundary=True, confidence="high", reasoning="x", evidence_references=refs)
    assert decision.evidence_references == refs


def test_unknown_evidence_reference_key_rejected():
    with pytest.raises(ValueError, match="unsupported key"):
        StoryBeatDecision(
            is_story_beat_boundary=True, confidence="high", reasoning="x",
            evidence_references={"supporting_beat_type_ids": [1]},
        )


def test_evidence_reference_value_must_be_list_of_ints():
    with pytest.raises(ValueError, match="must be a list of integer ids"):
        StoryBeatDecision(
            is_story_beat_boundary=True, confidence="high", reasoning="x",
            evidence_references={"supporting_shot_ids": "not-a-list"},
        )
    with pytest.raises(ValueError, match="must be a list of integer ids"):
        StoryBeatDecision(
            is_story_beat_boundary=True, confidence="high", reasoning="x",
            evidence_references={"supporting_shot_ids": [1, "two"]},
        )


def test_empty_evidence_references_valid():
    decision = StoryBeatDecision(is_story_beat_boundary=None, confidence="low", reasoning="x", evidence_references={})
    assert decision.evidence_references == {}


# ---------------------------------------------------------------------------
# Structural: no Scene FK/parent requirement; no beat taxonomy; no Tutorial coupling.
# ---------------------------------------------------------------------------

def test_contract_has_no_scene_parent_field():
    import dataclasses
    field_names = {f.name for f in dataclasses.fields(StoryBeatDecision)} | {f.name for f in dataclasses.fields(StoryBeatResult)}
    for forbidden in ("scene_id", "parent_scene_id", "scene", "required_scene_id"):
        assert forbidden not in field_names


def test_contract_has_no_beat_type_or_taxonomy_field():
    import dataclasses
    field_names = {f.name for f in dataclasses.fields(StoryBeatDecision)} | {f.name for f in dataclasses.fields(StoryBeatResult)}
    for forbidden in ("beat_type", "narrative_role", "rhetorical_type", "function", "beat_function", "category"):
        assert forbidden not in field_names


def test_contract_has_no_tutorial_or_teaching_point_field():
    import dataclasses
    field_names = {f.name for f in dataclasses.fields(StoryBeatDecision)} | {f.name for f in dataclasses.fields(StoryBeatResult)}
    for forbidden in ("tutorial_segment_id", "teaching_point", "is_teaching_point", "suggested_pause", "authoring_note"):
        assert forbidden not in field_names


def test_no_beat_taxonomy_constant_exists_in_module():
    import app.services.story_beat_reasoner.contract as module
    module_names = dir(module)
    for forbidden in ("BEAT_TYPES", "VALID_BEAT_TYPES", "BEAT_FUNCTIONS", "NARRATIVE_ROLES"):
        assert forbidden not in module_names


# ---------------------------------------------------------------------------
# Structural: contract module imports/calls no provider (Anthropic or otherwise).
# ---------------------------------------------------------------------------

def test_contract_module_imports_no_provider_or_external_api():
    import ast
    import inspect
    import app.services.story_beat_reasoner.contract as contract_module
    import app.services.story_beat_reasoner as package_module

    for module in (contract_module, package_module):
        tree = ast.parse(inspect.getsource(module))
        imported_names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_names.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_names.add(node.module)

        assert "anthropic" not in imported_names
        assert not any(name.startswith("app.services.semantic_reasoner.router") for name in imported_names)
        assert not any(name.startswith("app.services.semantic_reasoner.providers") for name in imported_names)
        assert "reason_about_boundary" not in imported_names


def test_router_entry_point_now_exists_as_of_stage_10_3b2():
    # Superseded by Stage 10.3B2 (see tests/test_story_beat_reasoner_router.py for full coverage
    # of the entry point itself): Stage 10.3B1's own explicit scope was contract-only, with no
    # reason_about_story_beat_boundary() callable yet. That scope has since expanded on purpose --
    # this test now records the opposite fact, rather than being deleted outright, so the contract-
    # only era stays visible in this file's own history.
    import app.services.story_beat_reasoner as package_module
    assert hasattr(package_module, "reason_about_story_beat_boundary")
    assert callable(package_module.reason_about_story_beat_boundary)


def test_reasoning_error_is_a_distinct_exception_type_from_semantic_reasoning_error():
    from app.services.semantic_reasoner.contract import SemanticReasoningError
    assert StoryBeatReasoningError is not SemanticReasoningError
    assert not issubclass(StoryBeatReasoningError, SemanticReasoningError)
    assert not issubclass(SemanticReasoningError, StoryBeatReasoningError)
