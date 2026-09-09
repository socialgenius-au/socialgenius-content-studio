"""Stage 10.2B — Semantic Boundary Reasoner: the one provider-neutral entry point Stage 10
orchestration should call, mirroring app/services/ai/'s own provider-neutral AI Tools pattern
exactly (see that package's own __init__.py docstring for the parallel structure).

    Stage 10 orchestration (future)
      -> reason_about_boundary(evidence_bundle)   <- this package's public entry point
      -> router._REASONER_PROVIDERS[...]           (empty as of Stage 10.2B1 — see router.py)
      -> a future SemanticReasonerProvider implementation (Anthropic, local, etc. — Stage 10.2B2+)

Only reason_about_boundary, ReasonerDecision, ReasonerResult, and SemanticReasoningError are
meant to be imported from outside this package — which provider is active (if any), and how its
own call is made, are internal implementation details the caller never needs.

Stage 10.2B1 ships this contract with ZERO real reasoning behind it: no Anthropic call, no OpenAI
call, no local model, no embeddings, no translation. Calling reason_about_boundary today always
raises SemanticReasoningError ("no semantic reasoner configured") — never a fabricated decision.
"""
from app.services.semantic_reasoner.contract import ReasonerDecision, ReasonerResult, SemanticReasoningError
from app.services.semantic_reasoner.router import reason_about_boundary

__all__ = ["reason_about_boundary", "ReasonerDecision", "ReasonerResult", "SemanticReasoningError"]
