"""C3 — structural language guards, applied provider-independently (router.py -> validation.py), so no
provider can ship a mechanism that claims performance, asserts causation, or reproduces the source.

Three independent guards, all raising MechanismReasoningError (never silently editing the text):

  1. PERFORMANCE / OUTCOME claims -- the pipeline holds no viewer data of any kind, so no text may claim that
     anything retained, engaged, converted, went viral, succeeded, or scored well. (A superset of Stage 11.4's
     term list, matched on word boundaries so "retention device" as a *structure name* is not confused with
     a retention *claim*.)
  2. CAUSAL / CERTAINTY claims -- "this caused...", "which is why it worked", "viewers will...", "proves...",
     "guarantees...". A mechanism describes what a structure APPEARS DESIGNED to do, never what it did.
  3. VERBATIM SOURCE REPRODUCTION -- a run of consecutive words copied from the anatomy's transcript /
     on-screen text. The transferable principle must be abstract (short run limit); every other field may
     quote at most a few words of the source, never a passage.
"""
import re

from app.services.mechanism_reasoner.contract import MechanismReasoningError

__all__ = [
    "PERFORMANCE_PATTERNS", "CAUSAL_PATTERNS", "DESIGN_LANGUAGE", "PRINCIPLE_VERBATIM_LIMIT", "OTHER_VERBATIM_LIMIT",
    "reject_prohibited_language", "has_design_language", "reject_source_reproduction", "reject_source_specific_references",
    "tokenize",
]

# ── 1. performance / outcome claims ───────────────────────────────────────────────────────────
PERFORMANCE_PATTERNS = tuple(re.compile(p, re.IGNORECASE) for p in (
    r"\beffective\w*", r"\bineffective\w*", r"\befficacy\b", r"\bengag(?:ing|ement|ed)\b", r"\bdisengag\w*",
    r"\bcompelling\b", r"\bcaptivating\b", r"\bgripping\b",
    r"\bviral\w*", r"\bconvert(?:s|ed|ing)?\b", r"\bconversions?\b",
    r"\bsuccess(?:ful|fully)?\b", r"\bperform(?:ed|s|ing|ance)?\s+(?:well|poorly|better|worse)\b", r"\bhigh[- ]performing\b", r"\bunderperform\w*",
    r"\bscor(?:e|es|ed|ing)\b", r"\brating of\b", r"\bstrong (?:hook|device|mechanism)\b", r"\bweak (?:hook|device|mechanism)\b",
    r"\bwatch[- ]?time\b", r"\battention span\b", r"\b(?:held|holds|holding|grabbed|grabs|captured|captures) (?:the )?(?:viewers?'?s?'? )?attention\b",
    r"\b(?:kept|keeps|keeping) (?:the )?(?:viewers?|audience)\b", r"\bretain(?:s|ed|ing)? (?:the )?(?:viewers?|audience)\b",
    r"\b(?:viewer|audience) retention\b", r"\bretention (?:rate|curve|score)\b", r"\bdrop[- ]?off\b", r"\bclick[- ]?through\b",
    r"\b(?:more|higher|better) (?:views|reach|likes|shares|clicks)\b",
))

# ── 2. causal / certainty claims ──────────────────────────────────────────────────────────────
CAUSAL_PATTERNS = tuple(re.compile(p, re.IGNORECASE) for p in (
    r"\b(?:caused|causes|causing)\b", r"\bresult(?:ed|s|ing)? in\b", r"\b(?:led|leads|leading) to\b",
    r"\b(?:drove|drives|driving) (?:the )?(?:viewers?|audience|results?|growth|views|engagement)\b",
    r"\b(?:that|this|which)(?:'s| is| was) (?:why|the reason)\b", r"\bthe reason (?:it|the video|this|the content) (?:worked|worked so well|succeeded|performed|went)\b",
    r"\b(?:viewers?|audiences?|people)\s+(?:will|would|definitely|certainly|always|surely|clearly|must|can't help)\b",
    r"\b(?:definitely|certainly|undoubtedly|unquestionably|obviously)\b", r"\b(?:proves|proved|proven|proof that)\b",
    r"\b(?:guarantee[sd]?|ensures|ensured)\b",
    r"\b(?:increas|boost|improv|maximi[sz]|rais|enhanc|lift)\w*\s+(?:the\s+)?(?:retention|watch|views?|viewers?|reach|completion|clicks?|sales)\b",
    r"\b(?:made|makes|make|making)\s+(?:the\s+)?(?:video|it|content|viewers?|audiences?)\s+(?:work|perform|succeed|popular|stick|watch)\b",
    r"\b(?:keep|kept|keeps|stay|stayed|stays)\s+(?:the\s+)?(?:viewers?\s+|audience\s+)?(?:watching|engaged|hooked|glued|tuned|scrolling)\b",
    r"\bbecause\b[^.;]{0,80}\b(?:viewers?|audience|people|watch\w*|scroll\w*|click\w*|retention)\b",
))

# A mechanism STATEMENT must read as a description of apparent design. This is the accepted vocabulary
# (the brief's own examples plus close structural verbs); the guard checks presence, not quality.
DESIGN_LANGUAGE = re.compile(
    r"\b(?:appears?|seems?|creates? a structural|places?|introduces?|positions?|sets? up|sequences?|withholds?|delays?|"
    r"presents?|opens?|structures?|pairs?|juxtaposes?|frames?|arranges?)\b", re.IGNORECASE)


def _reject(text: str, patterns, label: str) -> None:
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            raise MechanismReasoningError(
                f"Mechanism text contains a prohibited {label} (matched {match.group(0)!r}) -- C3 may only describe what a "
                f"structure APPEARS DESIGNED to do, never a performance, outcome, or causal claim. Rejecting rather than "
                f"persisting: {text!r}"
            )


def reject_prohibited_language(*texts: str | None) -> None:
    """Raises MechanismReasoningError if ANY supplied text makes a performance/outcome claim or an unsupported
    causal/certainty claim. Case-insensitive, word-boundary matched, independent of how the prompt is worded."""
    for text in texts:
        if not text:
            continue
        _reject(text, PERFORMANCE_PATTERNS, "performance/outcome claim")
        _reject(text, CAUSAL_PATTERNS, "causal/certainty claim")


def has_design_language(statement: str) -> bool:
    return bool(DESIGN_LANGUAGE.search(statement or ""))


# ── 3. source reproduction ────────────────────────────────────────────────────────────────────
PRINCIPLE_VERBATIM_LIMIT = 5   # the transferable principle may not contain a 5-word run copied from the source
OTHER_VERBATIM_LIMIT = 7       # any other field may not contain a 7-word run
_MIN_WHOLE_ITEM_WORDS = 4      # a short source item (e.g. an on-screen line) of >= 4 words may not appear whole

_WORD = re.compile(r"\w+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(text or "")]


def build_source_index(source_texts: list[str], limit: int) -> dict[int, set[tuple]]:
    """{run length: set of word-runs} over the source texts. A source item shorter than `limit` (but at least
    _MIN_WHOLE_ITEM_WORDS words) is indexed as a whole, so a short on-screen line cannot slip under the limit."""
    index: dict[int, set[tuple]] = {}
    for text in source_texts:
        tokens = tokenize(text)
        length = min(limit, len(tokens))
        if length < _MIN_WHOLE_ITEM_WORDS:
            continue
        grams = index.setdefault(length, set())
        for i in range(len(tokens) - length + 1):
            grams.add(tuple(tokens[i:i + length]))
    return index


def reject_source_reproduction(field_name: str, text: str | None, index: dict[int, set[tuple]]) -> None:
    """Raises MechanismReasoningError if `text` contains a run of source words at least as long as the index's
    limit (see build_source_index). Compares normalised words, so punctuation/case changes do not evade it."""
    if not text or not index:
        return
    tokens = tokenize(text)
    for length, grams in index.items():
        for i in range(len(tokens) - length + 1):
            if tuple(tokens[i:i + length]) in grams:
                raise MechanismReasoningError(
                    f"{field_name} reproduces {length} consecutive words of the source ({' '.join(tokens[i:i + length])!r}) -- "
                    "C3 learns STRUCTURE and must not reproduce source wording. Rewrite it abstractly."
                )


_SOURCE_SPECIFIC = re.compile(r"\bsections?\s*#?\d+\b|\b\d{1,2}:\d{2}\b", re.IGNORECASE)


def reject_source_specific_references(field_name: str, text: str | None) -> None:
    """A TRANSFERABLE principle must be source-independent: it may not point at this source's own section
    numbers or timestamps (those belong in `section_numbers` / the non-transferable elements)."""
    if text and _SOURCE_SPECIFIC.search(text):
        raise MechanismReasoningError(
            f"{field_name} refers to this source's own section numbers or timestamps ({text!r}) -- a transferable "
            "principle must be expressible without reference to the source."
        )
