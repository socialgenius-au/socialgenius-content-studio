"""Stage 10.2B — Semantic Boundary Reasoner: the one provider-neutral entry point Stage 10
orchestration should call, mirroring app/services/ai/'s own provider-neutral AI Tools pattern
exactly (see that package's own __init__.py docstring for the parallel structure).

    Stage 10 orchestration (future)
      -> reason_about_boundary(evidence_bundle)   <- this package's public entry point
      -> router._REASONER_PROVIDERS["anthropic"]   (registered Stage 10.2B2 — see router.py)
      -> providers.anthropic_provider.AnthropicSemanticReasoner (a future local/OpenAI/etc.
         provider can be added the same way, without this package's own callers changing at all)

Only reason_about_boundary, ReasonerDecision, ReasonerResult, and SemanticReasoningError are
meant to be imported from outside this package — which provider is active (if any), and how its
own call is made, are internal implementation details the caller never needs.

Stage 10.2B2 registers the first REAL reasoner (Anthropic Claude, reusing app.services.claude's
own already-configured client), but it runs ONLY when an operator explicitly opts in by setting
SEMANTIC_REASONER_PROVIDER="anthropic" (default: "", unconfigured) AND has ANTHROPIC_API_KEY set —
calling reason_about_boundary with neither set still raises SemanticReasoningError today, never a
fabricated decision. No local model, no embeddings, and no translation step exist in this package.
"""
from app.services.semantic_reasoner.contract import ReasonerDecision, ReasonerResult, SemanticReasoningError
from app.services.semantic_reasoner.router import reason_about_boundary

__all__ = ["reason_about_boundary", "ReasonerDecision", "ReasonerResult", "SemanticReasoningError"]
