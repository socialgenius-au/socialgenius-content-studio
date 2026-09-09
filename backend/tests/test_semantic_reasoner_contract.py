"""
Stage 10.2B1 — Semantic Boundary Reasoner: model-independent contract + provider-neutral router
(app/services/semantic_reasoner/). Zero real reasoning exists yet -- no Anthropic call, no OpenAI
call, no local model, no embeddings, no translation. This file proves the CONTRACT behaves
correctly using a fake in-process provider only; no external network call is ever made anywhere
in this file (no anthropic/openai/httpx import exists here at all).

Covers this phase's own required test letters:
  E. semantic decision TRUE is representable.
  F. semantic decision FALSE is representable.
  G. undecided None is representable and distinct from False.
  H. categorical confidence values are constrained to low/medium/high.
  I. confidence_score may remain None.
  J. evidence references contain IDs rather than copied transcript/OCR content.
  K. provider/model metadata representable.
  L. candidate_timestamp preserved.
  M. unconfigured reasoner produces explicit unavailable/error behaviour, never False.
  N. provider failure cannot silently become False.
  P. no Scene rows created (structural: this package touches no DB/model at all).
  Q. no Shot.scene_id mutation (same structural guarantee).
  R. no external model/API call occurs during tests (no such dependency is even imported here).
"""
import inspect

import pytest

from app.services.semantic_reasoner import (
    ReasonerDecision,
    ReasonerResult,
    SemanticReasoningError,
    reason_about_boundary,
)
from app.services.semantic_reasoner.contract import VALID_CONFIDENCE_LEVELS, VALID_EVIDENCE_REFERENCE_KEYS
from app.services.semantic_reasoner.providers.base import SemanticReasonerProvider
import app.services.semantic_reasoner.router as reasoner_router

_SAMPLE_BUNDLE = {
    "candidate_timestamp": 12.0,
    "source_nominations": [{"source_type": "speech_gap", "source_id": 1, "timestamp": 12.0}],
    "speech_before": {"id": 101, "start_time": 9.08, "end_time": 11.8, "text": "before text", "language": "ur"},
    "speech_after": {"id": 102, "start_time": 12.0, "end_time": 14.4, "text": "after text", "language": "ur"},
    "ocr_before": None, "ocr_after": None, "shots_overlapping": [], "nearby_annotations": {},
    "visual_objects_before": [], "visual_objects_after": [],
}


class _FakeReasonerProvider(SemanticReasonerProvider):
    """An in-process test double -- never calls any real model/API. `configured` and
    `decision_factory` let each test control exactly what this "provider" does without touching
    any network, SDK, or external dependency."""

    name = "fake"

    def __init__(self, configured: bool = True, decision_factory=None, raise_error: Exception | None = None):
        self._configured = configured
        self._decision_factory = decision_factory
        self._raise_error = raise_error
        self.calls: list[dict] = []

    def is_configured(self) -> bool:
        return self._configured

    async def reason_about_boundary(self, evidence_bundle: dict, *, model: str) -> ReasonerDecision:
        self.calls.append({"evidence_bundle": evidence_bundle, "model": model})
        if self._raise_error is not None:
            raise self._raise_error
        return self._decision_factory()


def _register_fake_provider(monkeypatch, provider: _FakeReasonerProvider, provider_name: str = "fake"):
    monkeypatch.setattr(reasoner_router, "_REASONER_PROVIDERS", {provider_name: provider})
    monkeypatch.setattr(reasoner_router.settings, "SEMANTIC_REASONER_PROVIDER", provider_name)
    monkeypatch.setattr(reasoner_router.settings, "SEMANTIC_REASONER_MODEL", "fake-model-v1")


# ---------------------------------------------------------------------------
# E / F / G. True / False / None are all representable, and None != False.
# ---------------------------------------------------------------------------

async def test_decision_true_is_representable(monkeypatch):
    provider = _FakeReasonerProvider(decision_factory=lambda: ReasonerDecision(
        is_semantic_boundary=True, confidence="high", confidence_score=None,
        reasoning="contrastive marker present", evidence_references={"supporting_speech_segment_ids": [101, 102]},
    ))
    _register_fake_provider(monkeypatch, provider)
    result = await reason_about_boundary(_SAMPLE_BUNDLE)
    assert result.decision.is_semantic_boundary is True


async def test_decision_false_is_representable(monkeypatch):
    provider = _FakeReasonerProvider(decision_factory=lambda: ReasonerDecision(
        is_semantic_boundary=False, confidence="high", confidence_score=None,
        reasoning="clear continuation", evidence_references={},
    ))
    _register_fake_provider(monkeypatch, provider)
    result = await reason_about_boundary(_SAMPLE_BUNDLE)
    assert result.decision.is_semantic_boundary is False


async def test_decision_none_is_representable_and_distinct_from_false(monkeypatch):
    provider = _FakeReasonerProvider(decision_factory=lambda: ReasonerDecision(
        is_semantic_boundary=None, confidence="low", confidence_score=None,
        reasoning="one-sided evidence, cannot confirm either way", evidence_references={},
    ))
    _register_fake_provider(monkeypatch, provider)
    result = await reason_about_boundary(_SAMPLE_BUNDLE)
    assert result.decision.is_semantic_boundary is None
    assert result.decision.is_semantic_boundary is not False
    assert (result.decision.is_semantic_boundary == False) is False  # noqa: E712 -- explicit identity check


# ---------------------------------------------------------------------------
# H. Categorical confidence is constrained to low/medium/high.
# ---------------------------------------------------------------------------

def test_confidence_accepts_only_the_three_valid_levels():
    assert VALID_CONFIDENCE_LEVELS == ("low", "medium", "high")
    for level in VALID_CONFIDENCE_LEVELS:
        ReasonerDecision(is_semantic_boundary=None, confidence=level, confidence_score=None, reasoning="x", evidence_references={})


def test_confidence_rejects_an_invented_level():
    with pytest.raises(ValueError):
        ReasonerDecision(is_semantic_boundary=None, confidence="very high", confidence_score=None, reasoning="x", evidence_references={})
    with pytest.raises(ValueError):
        ReasonerDecision(is_semantic_boundary=None, confidence=0.87, confidence_score=None, reasoning="x", evidence_references={})


# ---------------------------------------------------------------------------
# I. confidence_score may remain None.
# ---------------------------------------------------------------------------

def test_confidence_score_may_remain_none():
    decision = ReasonerDecision(is_semantic_boundary=True, confidence="high", confidence_score=None, reasoning="x", evidence_references={})
    assert decision.confidence_score is None


def test_confidence_score_is_never_fabricated_by_the_router(monkeypatch):
    # The fake provider never sets confidence_score -- the router must not invent one either.
    provider = _FakeReasonerProvider(decision_factory=lambda: ReasonerDecision(
        is_semantic_boundary=True, confidence="medium", confidence_score=None, reasoning="x", evidence_references={},
    ))
    _register_fake_provider(monkeypatch, provider)

    async def _run():
        return await reason_about_boundary(_SAMPLE_BUNDLE)

    import asyncio
    result = asyncio.run(_run())
    assert result.decision.confidence_score is None


# ---------------------------------------------------------------------------
# J. Evidence references contain IDs only -- never copied transcript/OCR text.
# ---------------------------------------------------------------------------

def test_evidence_references_hold_ids_not_text():
    decision = ReasonerDecision(
        is_semantic_boundary=True, confidence="high", confidence_score=None, reasoning="x",
        evidence_references={"supporting_speech_segment_ids": [101, 102], "supporting_shot_ids": [3907]},
    )
    for key, ids in decision.evidence_references.items():
        assert all(isinstance(i, int) for i in ids)
    serialized_keys = set(decision.evidence_references)
    assert serialized_keys.issubset(VALID_EVIDENCE_REFERENCE_KEYS)


def test_evidence_references_reject_unknown_keys():
    with pytest.raises(ValueError):
        ReasonerDecision(
            is_semantic_boundary=True, confidence="high", confidence_score=None, reasoning="x",
            evidence_references={"raw_transcript_text": "لیکن وہی اورت اگر"},
        )


def test_evidence_references_reject_non_integer_values():
    with pytest.raises(ValueError):
        ReasonerDecision(
            is_semantic_boundary=True, confidence="high", confidence_score=None, reasoning="x",
            evidence_references={"supporting_shot_ids": ["not-an-id"]},
        )


def test_evidence_reference_keys_are_a_strict_subset_of_scene_details_v1_keys():
    from app.models.scene import Scene  # noqa: F401 -- imported only to confirm the module exists; no DB touched

    scene_details_v1_keys = {
        "supporting_shot_ids", "supporting_frame_ids", "supporting_text_element_ids",
        "supporting_speech_segment_ids", "supporting_annotation_ids",
    }
    assert VALID_EVIDENCE_REFERENCE_KEYS.issubset(scene_details_v1_keys)
    assert VALID_EVIDENCE_REFERENCE_KEYS != scene_details_v1_keys  # a strict subset, not a copy


# ---------------------------------------------------------------------------
# K / L. Provider/model metadata and candidate_timestamp are preserved on the result envelope.
# ---------------------------------------------------------------------------

async def test_provider_model_and_candidate_timestamp_preserved(monkeypatch):
    provider = _FakeReasonerProvider(decision_factory=lambda: ReasonerDecision(
        is_semantic_boundary=True, confidence="high", confidence_score=None, reasoning="x", evidence_references={},
    ))
    _register_fake_provider(monkeypatch, provider, provider_name="fake")
    result = await reason_about_boundary(_SAMPLE_BUNDLE)

    assert result.provider == "fake"
    assert result.model == "fake-model-v1"
    assert result.candidate_timestamp == 12.0


async def test_model_passed_through_to_the_provider_call(monkeypatch):
    provider = _FakeReasonerProvider(decision_factory=lambda: ReasonerDecision(
        is_semantic_boundary=None, confidence="low", confidence_score=None, reasoning="x", evidence_references={},
    ))
    _register_fake_provider(monkeypatch, provider)
    await reason_about_boundary(_SAMPLE_BUNDLE)
    assert provider.calls[0]["model"] == "fake-model-v1"
    assert provider.calls[0]["evidence_bundle"] is _SAMPLE_BUNDLE  # unmodified, not reshaped


# ---------------------------------------------------------------------------
# M. Unconfigured reasoner -> explicit error, never a fabricated False decision.
# ---------------------------------------------------------------------------

async def test_no_provider_configured_raises_never_returns_false(monkeypatch):
    monkeypatch.setattr(reasoner_router, "_REASONER_PROVIDERS", {})
    monkeypatch.setattr(reasoner_router.settings, "SEMANTIC_REASONER_PROVIDER", "")

    with pytest.raises(SemanticReasoningError, match="No semantic boundary reasoner is configured"):
        await reason_about_boundary(_SAMPLE_BUNDLE)


async def test_unrecognized_provider_name_raises_explicitly(monkeypatch):
    monkeypatch.setattr(reasoner_router, "_REASONER_PROVIDERS", {})
    monkeypatch.setattr(reasoner_router.settings, "SEMANTIC_REASONER_PROVIDER", "not-a-real-provider")

    with pytest.raises(SemanticReasoningError, match="not a recognized semantic reasoner"):
        await reason_about_boundary(_SAMPLE_BUNDLE)


async def test_registered_but_not_configured_provider_raises_explicitly(monkeypatch):
    provider = _FakeReasonerProvider(configured=False)
    _register_fake_provider(monkeypatch, provider)

    with pytest.raises(SemanticReasoningError, match="not configured"):
        await reason_about_boundary(_SAMPLE_BUNDLE)


# ---------------------------------------------------------------------------
# N. A provider call that fails cannot silently become False.
# ---------------------------------------------------------------------------

async def test_provider_call_failure_raises_never_returns_false(monkeypatch):
    provider = _FakeReasonerProvider(raise_error=SemanticReasoningError("simulated network/timeout failure"))
    _register_fake_provider(monkeypatch, provider)

    with pytest.raises(SemanticReasoningError, match="simulated network/timeout failure"):
        await reason_about_boundary(_SAMPLE_BUNDLE)


async def test_malformed_provider_response_raises_never_returns_false(monkeypatch):
    # A provider whose own parsing of a real response failed raises SemanticReasoningError
    # itself, per providers/base.py's own contract -- the router does not need to (and must not)
    # paper over that with a fabricated decision.
    provider = _FakeReasonerProvider(raise_error=SemanticReasoningError("could not parse provider response into a ReasonerDecision"))
    _register_fake_provider(monkeypatch, provider)

    with pytest.raises(SemanticReasoningError):
        await reason_about_boundary(_SAMPLE_BUNDLE)


# ---------------------------------------------------------------------------
# P / Q. This package touches no DB, no Scene, no Shot -- structural guarantee, not behavioral
# luck. Verified by inspecting the actual function signatures/module contents, not merely
# asserted in prose.
# ---------------------------------------------------------------------------

def test_reason_about_boundary_signature_takes_no_db_session():
    sig = inspect.signature(reason_about_boundary)
    assert "db" not in sig.parameters
    assert "session" not in sig.parameters


def test_semantic_reasoner_package_imports_no_orm_model():
    import app.services.semantic_reasoner.contract as contract_module
    import app.services.semantic_reasoner.router as router_module
    import app.services.semantic_reasoner.providers.base as base_module

    for module in (contract_module, router_module, base_module):
        source = inspect.getsource(module)
        assert "from app.models" not in source
        assert "import app.models" not in source
        assert "AsyncSession" not in source


# ---------------------------------------------------------------------------
# R. No external model/API call occurs anywhere in this file (structural: no such dependency is
# even imported here -- this test file has no anthropic/openai/httpx import at all).
# ---------------------------------------------------------------------------

def test_this_test_file_imports_no_external_ai_sdk():
    # AST-based, not a crude substring search: a substring check against this module's own raw
    # source would trivially "find" these names inside the very string literals this assertion
    # itself contains -- parsing only the actual `import`/`from ... import` statements avoids
    # that self-reference problem entirely.
    import ast
    import sys

    this_module = sys.modules[__name__]
    tree = ast.parse(inspect.getsource(this_module))
    imported_top_level_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_top_level_names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_top_level_names.add(node.module.split(".")[0])

    for forbidden in ("anthropic", "openai", "httpx", "requests"):
        assert forbidden not in imported_top_level_names
