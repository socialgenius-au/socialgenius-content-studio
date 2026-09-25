"""C4 -- the PERFORMANCE / CAUSAL claim guard, written for a planner that works in ARBITRARY business domains.

C3's guard was purely lexical ("success", "results", "performance" ... anywhere). That is right for C3 (which describes one video's
structure) but wrong for C4: words such as success / successful / performance / results / outcome routinely describe the SUBJECT MATTER
("show a successful tile and room pairing", "compare two renovation outcomes", "explain the result of choosing the wrong material") and
are not claims about the CONTENT. This guard therefore distinguishes:

  DOMAIN DESCRIPTION  -- allowed. The vocabulary of the caller's business: outcomes, results, success, effective, performance of a
                         product / material / room, "what causes X to crack", "that is why suitability depends on the room".
  CONTENT-PERFORMANCE claims -- rejected. Viewer-behaviour metrics and any claim that the content / video / hook / structure /
                         mechanism / approach / section / opening ... will retain, engage, convert, go viral, perform, work, or
                         "improve results".
  UNSUPPORTED CAUSATION -- rejected. "leads to better results", "produces better results", "guarantees results", "viewers will
                         definitely...", "causes engagement", "keeps viewers watching".

Three tiers, all raising BlueprintReasoningError (never editing text):
  1. METRICS       -- always rejected (retention, engagement, viral, watch time, conversions driven, "keeps viewers", ...).
  2. CONTENT CLAIMS -- rejected only when a CONTENT noun is the subject ("this structure performs better", "the opening is highly
                         effective", "this approach works because...", "this hook improves results").
  3. CAUSAL OUTCOME -- "leads/results in <better|higher|improved|greater|...>", "produces better results", certainty words,
                         viewer predictions, and 'guarantee(s)' unless explicitly negated ("avoid guaranteed results").

Heuristic by nature (a backstop; the prompt is the primary control), so it is tested on both sides.
"""
import re

from app.services.blueprint_reasoner.contract import BlueprintReasoningError
from app.services.mechanism_reasoner.language_guard import tokenize

__all__ = ["METRIC_PATTERNS", "CONTENT_CLAIM_PATTERNS", "CAUSAL_OUTCOME_PATTERNS", "find_claim", "reject_claims"]

_CONTENT = (r"(?:hooks?|videos?|content|structures?|mechanisms?|approach(?:es)?|blueprint|sections?|formats?|openings?|sequences?|contrasts?|"
            r"cta|call to action|edits?|editing|pacing|captions?|techniques?|strateg(?:y|ies)|templates?|reels?|posts?|ads?|adverts?|creatives?|clips?|"
            r"scenes?|intros?|openers?|plan|storyline)")
_GAP = r"(?:\W+\w+){0,4}?\W+"           # up to four words between a content noun and what is said about it
_ADV = r"(?:\w+ly\W+|very\W+|more\W+|most\W+)?"

_F = re.IGNORECASE

# 1. viewer-behaviour metrics: never a description of a business domain in this pipeline
METRIC_PATTERNS = tuple(re.compile(p, _F) for p in (
    r"\bretention\b", r"\bengagement\b", r"\bengaging\b", r"\bviral\w*", r"\bwatch[- ]?time\b", r"\battention span\b", r"\bclick[- ]?through\b",
    r"\bdrop[- ]?off\b", r"\bunderperform\w*", r"\boutperform\w*", r"\bhigh[- ]performing\b",
    r"\bengage(?:s|d)?\s+(?:the\s+)?(?:viewers?|audiences?|people|customers?)\b",
    r"\bperform(?:s|ed|ing)?\s+(?:well|poorly|better|worse|best)\b",
    r"\b(?:more|higher|better|greater)\s+(?:views|reach|likes|shares|clicks|sales|conversions?|traffic|leads|engagement|retention)\b",
    r"\bconvert(?:s|ed|ing)?\s+(?:the\s+)?(?:viewers?|audiences?|people|customers?|leads?|visitors?)\b",
    r"\b(?:driv|boost|increas|improv|maximi[sz]|rais|lift|generat)\w*\s+(?:the\s+|more\s+|your\s+|its\s+|overall\s+)?"
    r"(?:conversions?|sales|leads|traffic|revenue|growth|views|reach|clicks|engagement|retention|performance)\b",
    r"\b(?:kept|keeps|keeping|keep)\s+(?:the\s+)?(?:viewers?|audiences?)\b",
    r"\b(?:make|makes|made|making)\s+(?:the\s+)?(?:viewers?|audiences?|people|customers?|users?)\s+"
    r"(?:continue|keep|stay|watch|scroll|click|buy|convert|engage|care|stick|return|linger|listen|share|follow|subscribe|trust)\b",
    r"\b(?:make|makes|made|making)\s+(?:the\s+)?(?:video|content|reel|post)\s+(?:work|perform|succeed|popular|stick)\b",
    r"\bstrong (?:hook|device|mechanism)\b", r"\bweak (?:hook|device|mechanism)\b",
))

# 2. claims about the CONTENT itself -- only when a content noun is the subject
CONTENT_CLAIM_PATTERNS = tuple(re.compile(p, _F) for p in (
    rf"\b{_CONTENT}\b{_GAP}(?:will\W+|would\W+|can\W+|may\W+|should\W+)?(?:is|are|be|proves?|proved)\W+{_ADV}"
    r"(?:effective|successful|persuasive|compelling|impactful|winning|powerful|convincing|irresistible)\b",
    rf"\b{_CONTENT}\b{_GAP}(?:will\W+|would\W+|can\W+)?(?:works?|worked|working)\W+(?:well|better|best|effectively|because|brilliantly)\b",
    rf"\b{_CONTENT}\b{_GAP}(?:will\W+|would\W+|can\W+)?(?:improv|enhanc|boost|increas|maximi[sz]|driv|rais|lift)\w*\W+(?:\w+\W+){{0,2}}?"
    r"(?:performance|results?|effectiveness|impact|conversions?|sales|reach|awareness)\b",
    rf"\b{_CONTENT}\b{_GAP}(?:will\W+|would\W+|can\W+)?succeed\w*\b",
))

# 3. unsupported causal / certainty claims
_OUTCOME_UP = r"(?:better|higher|improved|greater|superior|stronger|best|optimal|increased|more successful|success|guaranteed)"
CAUSAL_OUTCOME_PATTERNS = tuple(re.compile(p, _F) for p in (
    rf"\b(?:lead|leads|led|leading|result|results|resulted|resulting|translate|translates|translating|contribute|contributes|contributing)\s+(?:in|to)\s+"
    rf"(?:\w+\W+){{0,2}}?{_OUTCOME_UP}\b",
    r"\b(?:produce|produces|deliver|delivers|yield|yields|bring|brings|give|gives|get|gets)\s+(?:you\s+|viewers\s+|customers\s+)?"
    r"(?:better|higher|greater|superior|the best)\s+(?:results?|outcomes?|performance|returns?)\b",
    r"\bcaus\w+\s+(?:the\s+)?(?:viewers?|audiences?|people|customers?|engagement|retention|growth|sales|conversions?|views)\b",
    r"\b(?:definitely|certainly|undoubtedly|unquestionably)\b",
    r"\b(?:viewers?|audiences?|people|customers?)\s+(?:will|would)\s+(?:definitely|certainly|always|surely|automatically|instantly|inevitably)\b",
    r"\b(?:viewers?|audiences?)\s+(?:will|would)\s+(?:buy|convert|engage|stay|keep|continue|watch|scroll|click|trust|remember|respond|follow|subscribe|return)\b",
    r"\bbecause\b[^.;]{0,80}\b(?:viewers?|audience|watch\w*|scroll\w*|click\w*|retention)\b",
    r"\bensur(?:es|ed|ing)\s+(?:that\s+)?(?:the\s+)?(?:viewers?|audiences?|success|results?|conversions?|engagement)\b",
))

_NEGATORS = frozenset({"no", "not", "never", "without", "avoid", "avoids", "avoiding", "avoided", "exclude", "excludes", "excluding", "omit",
                       "omits", "omitting", "don", "dont", "cannot", "cant", "nor", "refrain", "refraining", "skip", "skipping", "except",
                       "neither", "instead"})
_GUARANTEE = re.compile(r"\bguarantee(?:s|d|ing)?\b", _F)


def find_claim(text: str) -> tuple[str, str] | None:
    """Returns (tier, matched phrase) for the first content-performance / unsupported-causation claim in `text`, else None.
    Domain description returns None."""
    if not text:
        return None
    for tier, patterns in (("metric", METRIC_PATTERNS), ("content-claim", CONTENT_CLAIM_PATTERNS), ("causal-outcome", CAUSAL_OUTCOME_PATTERNS)):
        for pattern in patterns:
            m = pattern.search(text)
            if m:
                return tier, m.group(0)
    for clause in re.split(r"[.;:!?]+", text):     # 'guarantee(s)' is a claim unless explicitly negated in its own clause
        m = _GUARANTEE.search(clause)
        if m and not any(w in _NEGATORS for w in tokenize(clause[:m.start()])[-6:]):
            return "causal-outcome", m.group(0)
    return None


def reject_claims(field_name: str, text: str | None) -> None:
    hit = find_claim(text or "")
    if hit:
        tier, phrase = hit
        raise BlueprintReasoningError(
            f"{field_name} makes a {tier} claim ({phrase!r}). A blueprint transfers design logic: it may describe the caller's subject matter "
            "(outcomes, results, success of a product or pairing) but must not claim that the CONTENT performs, engages, retains or converts, "
            f"or assert an unsupported causal outcome. Rejecting rather than persisting: {text!r}")
