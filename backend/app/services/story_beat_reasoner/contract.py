"""Stage 10.3B1 — the model-independent STORY BEAT reasoning CONTRACT: the one result shape every
future provider (Anthropic, a local/open-source model, a different vendor entirely) must produce,
so Stage 10 orchestration never needs to know which one actually answered a given candidate.

DELIBERATELY A SIBLING of app.services.semantic_reasoner.contract, never a reuse or modification of
it (per the Stage 10.3A architecture audit's own Verdict A and the Stage 10.3B1 task's own explicit
scoping) -- the two contracts answer genuinely different questions:

  Semantic Scene boundary (app.services.semantic_reasoner.contract.ReasonerDecision):
      does the content's own CENTRAL PROPOSITION, TOPIC, OR FUNCTION materially change here?

  Story Beat boundary (THIS module's StoryBeatDecision):
      is there a distinguishable change in the RHETORICAL OR COMMUNICATIVE MOVEMENT of the
      source -- explanation to example, statement to qualification, claim to supporting
      demonstration, setup to contrast, description to emphasis, argument to summary, or simply
      one communicative move giving way to another -- even when the SAME underlying proposition,
      topic, or function continues unchanged. (These are illustrative examples for the reasoner's
      own judgment only -- never a fixed enum, never persisted as a beat-TYPE label. See "NO BEAT
      TAXONOMY" below.)

A Story Beat boundary can exist entirely INSIDE a Semantic Scene that never itself splits, and a
Story Beat's own existence never depends on a Scene boundary occurring nearby -- Story Beat
reasoning must never require, infer from, or be gated by a Scene change. Conversely, a Scene
boundary's own rhetorical-movement-is-not-sufficient rule (Stage 10.2B2F) describes PRECISELY the
signal Story Beat reasoning exists to capture -- the two contracts are complementary, not
overlapping, and a real boundary is very often accepted as a Story Beat at the very moment it is
correctly REJECTED as a Scene boundary.

IMPORTANT NEGATIVE CASES (a future provider's own prompt must encode these, but the contract
itself does not — and cannot — mechanically enforce a semantic judgment; this docstring records
the locked rule for whoever implements that provider next): a Story Beat boundary must NOT be
inferred merely because there is a pause, OCR text changes, a technical Shot changes, a new
representative frame appears, music/audio changes, a speaker takes a breath, a sentence ends, or a
Scene boundary happens to exist nearby. Every one of those is a candidate-NOMINATION signal (the
exact same raw material Stage 10.2A's own candidate generation already produces and remains fully
reusable, unmodified, for Story Beat candidates too) — never, by itself, the semantic conclusion.

NO BEAT TAXONOMY (Stage 10.3B1's own explicit scope limit): this contract carries no `beat_type`,
no `narrative_role`, no marketing label (hook/CTA/problem/solution), and no fixed rhetorical enum
of any kind. Stage 10.3 first establishes ONLY whether a meaningful beat boundary exists — WHAT
kind of rhetorical move it is remains an explicitly deferred, later, separate question, mirroring
exactly how Scene's own `narrative_role` stays reserved and unpopulated until Stage 15 rather than
guessed at boundary-detection time.

NO SCENE-PARENT REQUIREMENT: a StoryBeatDecision never references, requires, or is validated
against any Scene id — Story Beats remain independent of Scene, overlapping only by time, exactly
as Scene itself remains independent of Shot. If a future evidence bundle ever wants to cite an
overlapping Scene for context, that belongs in `evidence_references` as an ordinary reference (see
VALID_EVIDENCE_REFERENCE_KEYS below), never as a required field or a foreign key.

NO TUTORIAL/TEACHING-POINT COUPLING: this contract carries no authoring field of any kind (no
teaching-point flag, no "suggested pause," no tutorial-segment id). A Story Beat is Deconstructor-
side INFERRED evidence only; a Tutorial Segment remains a separate, later, user-authored decision
that this contract has no awareness of and must never automatically produce.

Stage 10.3B1 ships this contract with ZERO real reasoning behind it -- no provider exists yet, no
router exists yet (see this package's own __init__.py). Nothing here makes, or is capable of
making, an actual semantic judgment; it only defines the shape a future judgment must take.
"""
from dataclasses import dataclass, field

# Reused verbatim from the Scene reasoner's own already-locked contract -- a genuinely shared,
# trivial primitive (an immutable 3-value tuple) that costs nothing to import and nothing to
# duplicate-and-risk-drifting instead. This is a pure read import: it does not modify, wrap, or
# depend on any OTHER part of app.services.semantic_reasoner, and changes nothing about Stage
# 10.2's own behaviour (see the Stage 10.3B1 task's own explicit permission for exactly this kind
# of tiny shared primitive).
from app.services.semantic_reasoner.contract import VALID_CONFIDENCE_LEVELS

__all__ = [
    "VALID_CONFIDENCE_LEVELS",
    "VALID_EVIDENCE_REFERENCE_KEYS",
    "StoryBeatReasoningError",
    "StoryBeatDecision",
    "StoryBeatResult",
]

# The full bounded v1 key set Scene.details itself already locked (app/models/scene.py) -- Story
# Beat's own future evidence bundle is not yet designed, so this contract deliberately allows the
# FULL five-key vocabulary (including `supporting_frame_ids`, which the Scene reasoner's own
# narrower four-key set excludes only because ITS particular Stage 10.2A bundle happens to carry
# no frame evidence) rather than importing and inheriting that narrower restriction. This is an
# independent decision about what STORY BEAT evidence may cite, not a reuse of Scene's own
# candidate-bundle limitation.
VALID_EVIDENCE_REFERENCE_KEYS = frozenset({
    "supporting_shot_ids",
    "supporting_frame_ids",
    "supporting_speech_segment_ids",
    "supporting_text_element_ids",
    "supporting_annotation_ids",
})


class StoryBeatReasoningError(Exception):
    """Raised for both "no Story Beat reasoner is configured" and "a configured reasoner's own
    call failed" (missing secret, network/timeout error, an outage, a response that could not be
    parsed into a StoryBeatDecision at all) -- a deliberately SEPARATE exception type from
    SemanticReasoningError (never a shared/aliased class), so a caller can always tell which
    reasoning subsystem actually failed. Mirrors SemanticReasoningError's own exact "never returns
    a fabricated result" discipline.

    Raising this is NEVER equivalent to a negative decision. A caller catching this must treat the
    affected candidate as genuinely UNREASONED -- not yet decided, not decided "no"."""


def _validate_evidence_references(evidence_references: dict) -> None:
    unknown_keys = set(evidence_references) - VALID_EVIDENCE_REFERENCE_KEYS
    if unknown_keys:
        raise ValueError(
            f"evidence_references contains unsupported key(s) {sorted(unknown_keys)} -- only "
            f"{sorted(VALID_EVIDENCE_REFERENCE_KEYS)} are valid."
        )
    for key, value in evidence_references.items():
        if not isinstance(value, list) or not all(isinstance(v, int) for v in value):
            raise ValueError(f"evidence_references['{key}'] must be a list of integer ids, got {value!r}.")


@dataclass
class StoryBeatDecision:
    """The structured Story Beat decision itself -- provider-independent, never provider-specific.

    is_story_beat_boundary: bool | None
        True  -> the reasoner concluded a distinguishable rhetorical/communicative movement
                 genuinely occurs here (a new communicative move begins), independent of whether
                 any Semantic Scene boundary exists nearby.
        False -> the reasoner concluded the surrounding content continues the SAME rhetorical/
                 communicative movement -- no distinguishable beat-level shift.
        None  -> UNDECIDED: the reasoner examined the evidence but could not confidently tell
                 either way. This is NEVER equivalent to False -- "no" and "don't know" are
                 different outcomes, identical in spirit to Scene's own is_semantic_boundary
                 semantics.

    confidence: one of VALID_CONFIDENCE_LEVELS -- required, categorical, never fabricated
        precision. Independent of is_story_beat_boundary's own value.

    reasoning: short prose justification for the decision.

    evidence_references: which already-persisted ids (by category) this decision cites --
        REFERENCES ONLY, never copied transcript/OCR/frame content. Restricted to
        VALID_EVIDENCE_REFERENCE_KEYS; every value is a list of ids (int), possibly empty, never
        required to cite every category. Never fabricated -- a provider must cite only ids it was
        actually given.

    reasoning_contract_version: which version of the PROMPT/reasoning instructions actually
        produced this decision -- independent of provider/model, mirroring
        ReasonerResult.reasoning_contract_version's own rationale (provider+model+pass-name alone
        cannot distinguish two different prompt revisions sent to the same model). A concrete
        provider reports its own version string here; None only for a provider that has not been
        updated to report one.
    """
    is_story_beat_boundary: bool | None
    confidence: str
    reasoning: str
    evidence_references: dict = field(default_factory=dict)
    reasoning_contract_version: str | None = None

    def __post_init__(self) -> None:
        if self.confidence not in VALID_CONFIDENCE_LEVELS:
            raise ValueError(
                f"confidence must be one of {VALID_CONFIDENCE_LEVELS}, got {self.confidence!r}."
            )
        _validate_evidence_references(self.evidence_references)


@dataclass
class StoryBeatResult:
    """The outer envelope a future story_beat_reasoner.router.reason_about_story_beat() would
    return on success -- mirrors ReasonerResult's own provider/model metadata pattern exactly.
    Always carries a real `decision` (never None): infrastructure failures raise
    StoryBeatReasoningError instead, keeping "the call failed" (an exception) structurally
    distinct from "the call succeeded but the reasoner itself couldn't tell"
    (decision.is_story_beat_boundary is None).

    No router or provider exists yet to construct one of these (Stage 10.3B1's own explicit
    scope) -- this dataclass exists now so the eventual provider/router phase has an already-
    reviewed, already-tested target shape to build against.
    """
    decision: StoryBeatDecision
    provider: str
    model: str
    candidate_timestamp: float
    reasoning_contract_version: str | None = None
