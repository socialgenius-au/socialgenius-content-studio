"""C4 -- deterministic guards applied to EVERY free-text field of a blueprint, provider-independently.

Five independent guards, all raising BlueprintReasoningError (never silently editing the text):

  1. PERFORMANCE / CAUSAL claims -- reuses C3's language guard unchanged (a blueprint transfers design logic; it never
     claims that a structure increases retention, drives engagement, works because..., etc.).
  2. SOURCE COPY -- a run of consecutive words copied from the reference's transcript / on-screen text / C3's
     non-transferable descriptions (short run limit: a blueprint should be independently usable, so even a light lift is
     rejected). Reuses C3's verbatim matcher.
  3. NON-TRANSFERABLE SUBJECT TERMS -- distinctive content words from C3's non-transferable elements (and recurring
     source text such as handles/watermarks) may not appear unless the caller's own NewContentIntent uses them. This is
     what stops the reference's SUBJECT MATTER (its people, story, brand) crossing into the new plan.
  4. FINAL CREATIVE COPY -- a blueprint gives instructions, not copy. Quoted script lines, direct questions, exclamations,
     "Headline:"/"Caption:"/"Script:" labels, hashtags and emoji are rejected. (A heuristic backstop; the prompt is the
     primary control.)
  5. PROHIBITED ELEMENTS -- the caller's prohibited claims/elements may only be mentioned when explicitly negated
     ("avoid price comparisons"), never instructed.
"""
import re
from dataclasses import dataclass, field

from app.services.blueprint_reasoner.contract import BlueprintReasoningError, MAX_FIELD_CHARS
from app.services.mechanism_reasoner.contract import MechanismReasoningError
from app.services.mechanism_reasoner.language_guard import reject_prohibited_language, tokenize

__all__ = [
    "SOURCE_COPY_LIMIT", "META_STOPWORDS", "GuardContext", "build_guard_context", "blocked_source_terms", "check_text",
    "reject_final_copy", "reject_prohibited_elements", "reject_blocked_terms", "reject_performance", "reject_source_copy",
]

SOURCE_COPY_LIMIT = 5   # a blueprint field may not contain a 5-word run (or a whole short line of >= 4 words) from the source

_NEGATORS = frozenset({
    "no", "not", "never", "without", "avoid", "avoids", "avoiding", "avoided", "exclude", "excludes", "excluding", "omit",
    "omits", "omitting", "don", "dont", "cannot", "cant", "nor", "refrain", "refraining", "steer", "skip", "skipping", "ban",
    "banned", "prohibited", "forbidden", "except", "neither", "instead",
})

# Generic words that appear in C3's non-transferable DESCRIPTIONS ("Specific phrasing about ...") and are not
# source-subject terms. Anything else in those descriptions is treated as source-specific vocabulary.
META_STOPWORDS = frozenset("""
that with this from into about which where when what while they them their there these those have has had been being were was
will would could should than then also only over under after before during between within through across against because
other others another such some many much more most less least each every both either neither same very just even still
specific specifics specifically phrase phrases phrasing wording word words content centers center centres centred narrative
story stories text texts line lines exact exactly placement spoken speech caption captions transliterated matching overlay
recurring describing describes described versus type types kind kinds video videos second seconds source original reference
particular elements element style tone voice speaker person people visual visuals audio sound music shot shots frame frames
timing length lengths structure structural spacing used using uses use like look looks feel feeling appears appear seems
opening closing claim claims statement subject matter topic theme themes brand name names handle watermark creator creators
format formats delivery presentation moment moments part parts section sections piece pieces thing things way ways
""".split())

_STOP_SHORT = frozenset({"a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "by", "for", "is", "it", "as", "be"})


def _stem(t: str) -> str:
    return t[:-1] if len(t) > 3 and t.endswith("s") and not t.endswith("ss") else t


def _wrap(fn, *args):
    """Runs a C3 guard and re-raises its MechanismReasoningError as a BlueprintReasoningError."""
    try:
        fn(*args)
    except MechanismReasoningError as exc:
        raise BlueprintReasoningError(str(exc)) from exc


def reject_performance(field_name: str, text: str | None) -> None:
    """C3's performance / outcome / causal guard, unchanged."""
    _wrap(reject_prohibited_language, text)


def _norm(text: str) -> list[str]:
    return [_stem(t) for t in tokenize(text)]


def build_source_index(source_texts: list[str], limit: int = SOURCE_COPY_LIMIT) -> dict[int, set[tuple]]:
    """{run length: set of STEMMED word-runs} over the source texts (C3's matcher, but stem-aware so a light lift such as
    'never turns around' for 'never turn around' is still caught). A source item shorter than `limit` (but at least 4 words) is
    indexed as a whole."""
    index: dict[int, set[tuple]] = {}
    for text in source_texts:
        tokens = _norm(text)
        length = min(limit, len(tokens))
        if length < 4:
            continue
        grams = index.setdefault(length, set())
        for i in range(len(tokens) - length + 1):
            grams.add(tuple(tokens[i:i + length]))
    return index


def reject_source_copy(field_name: str, text: str | None, index: dict) -> None:
    """Rejects a run of source words (case-, punctuation- and inflection-insensitive) of at least the index's limit."""
    if not text or not index:
        return
    tokens = _norm(text)
    for length, grams in index.items():
        for i in range(len(tokens) - length + 1):
            if tuple(tokens[i:i + length]) in grams:
                raise BlueprintReasoningError(
                    f"{field_name} reproduces {length} consecutive words of the source ({' '.join(tokens[i:i + length])!r}, inflections ignored) -- "
                    "a blueprint transfers STRUCTURE and must be independently usable: do not lift or lightly paraphrase source wording.")


# ── 3. non-transferable subject terms ─────────────────────────────────────────────────────────

def blocked_source_terms(mechanisms: list[dict], anatomy: dict, intent_token_set: set[str]) -> list[str]:
    """Distinctive source-specific words the blueprint must not use: content words of every C3 non-transferable
    element (except pure timing) and the text of recurring on-screen elements (handles, watermarks) -- minus
    anything the caller's own intent uses (a tile retailer's blueprint may say 'tile' even if a reference did)."""
    terms: set[str] = set()
    for m in mechanisms:
        for e in (m.get("non_transferable_elements") or []):
            if e.get("kind") in ("timing_specific", "other"):
                continue
            for t in tokenize(e.get("description") or ""):
                if len(t) >= 4 and t.isalpha() and t not in META_STOPWORDS and t not in _STOP_SHORT:
                    terms.add(t)
    for section in anatomy.get("sections") or []:
        for item in (section.get("on_screen_text") or []):
            if item.get("recurring_element_id") is not None:
                for t in tokenize(item.get("text") or ""):
                    if len(t) >= 5:
                        terms.add(t)
    allowed = {_stem(t) for t in intent_token_set}
    return sorted(t for t in terms if _stem(t) not in allowed)


def reject_blocked_terms(field_name: str, text: str | None, blocked: list[str]) -> None:
    if not text or not blocked:
        return
    stems = {_stem(t): t for t in blocked}
    for token in tokenize(text):
        if _stem(token) in stems:
            raise BlueprintReasoningError(
                f"{field_name} uses {token!r}, a source-specific term from the reference's NON-TRANSFERABLE elements. A blueprint "
                f"transfers structure only -- it must not carry the reference's subject matter, names or story into the new plan: {text!r}"
            )


# ── 4. final creative copy ────────────────────────────────────────────────────────────────────

_QUOTED = (
    re.compile(r'"([^"]+)"'), re.compile(r"“([^”]+)”"), re.compile(r"«([^»]+)»"),
    re.compile(r"(?<![\w])'([^']+)'(?![\w])"), re.compile(r"‘([^’]+)’"),
)
_COPY_LABEL = re.compile(r"\b(?:headline|caption|script|voice[- ]?over|tagline|slogan|hook line|cta text|ad copy|dialogue|on-screen text reads)\s*:", re.IGNORECASE)
_HASHTAG = re.compile(r"(?<!\w)#\w{2,}")
_EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


def reject_final_copy(field_name: str, text: str | None) -> None:
    """A blueprint is a set of INSTRUCTIONS. Rejects text that is (or contains) polished creative copy."""
    if not text:
        return
    if len(text) > MAX_FIELD_CHARS * 2:
        raise BlueprintReasoningError(f"{field_name} is {len(text)} characters -- a blueprint gives concise instructions, not a script.")
    for pattern in _QUOTED:
        for match in pattern.finditer(text):
            if len(tokenize(match.group(1))) >= 3:
                raise BlueprintReasoningError(
                    f"{field_name} contains a quoted line ({match.group(0)!r}) -- that is final copy. C4 describes what a line must "
                    f"DO (an instruction), never the line itself: {text!r}")
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        s = sentence.strip()
        if s.endswith("?") and len(tokenize(s)) >= 3:
            raise BlueprintReasoningError(f"{field_name} contains a direct question ({s!r}) -- write the instruction, not the copy.")
    if "!" in text:
        raise BlueprintReasoningError(f"{field_name} contains an exclamation -- that is final copy, not an instruction: {text!r}")
    label = _COPY_LABEL.search(text)
    if label:
        raise BlueprintReasoningError(f"{field_name} contains a copy label ({label.group(0)!r}) -- headlines, captions, scripts and CTA wording belong downstream: {text!r}")
    if _HASHTAG.search(text) or _EMOJI.search(text):
        raise BlueprintReasoningError(f"{field_name} contains a hashtag or emoji -- that is final copy, not an instruction: {text!r}")


# ── 5. prohibited elements ────────────────────────────────────────────────────────────────────

def reject_prohibited_elements(field_name: str, text: str | None, prohibited: list[str]) -> None:
    """The caller's prohibited claims/elements may be mentioned only when negated within the six preceding words
    ('avoid price comparisons'), never instructed."""
    if not text or not prohibited:
        return
    for clause in re.split(r"[.;:!?]+", text):       # a negation only counts within its own clause
        raw = tokenize(clause)
        stemmed = [_stem(t) for t in raw]
        for phrase in prohibited:
            p = [_stem(t) for t in tokenize(phrase)]
            if not p:
                continue
            for i in range(len(stemmed) - len(p) + 1):
                if stemmed[i:i + len(p)] == p and not any(w in _NEGATORS for w in raw[max(0, i - 6):i]):
                    raise BlueprintReasoningError(
                        f"{field_name} instructs a PROHIBITED element ({phrase!r}) without negating it. Prohibited claims/elements may only "
                        f"appear as an exclusion (e.g. 'avoid ...'): {text!r}")


def _mask_prohibited(text: str, prohibited: list[str], *, only_negated: bool) -> str:
    """Replaces the caller's OWN prohibited phrases with a neutral token before the performance/causal guard runs, so a
    blueprint that respects "no guaranteed results" by writing "avoid guaranteed results" is not rejected for containing the
    word 'guaranteed'. `only_negated=True` (instructions) masks only explicitly excluded mentions -- an un-negated use stays
    visible to the guards; `only_negated=False` (explanatory text) masks every mention, since it is merely naming the element."""
    masked = text
    for phrase in prohibited:
        toks = [re.escape(_stem(t)) + "s?" for t in tokenize(phrase)]
        if not toks:
            continue
        pattern = re.compile(r"\b" + r"\W+".join(toks) + r"\b", re.IGNORECASE)

        def repl(m, _text=masked):
            if only_negated:
                clause = re.split(r"[.;:!?]+", _text[:m.start()])[-1]
                if not any(w in _NEGATORS for w in tokenize(clause)[-6:]):
                    return m.group(0)
            return "[excluded element]"
        masked = pattern.sub(repl, masked)
    return masked


# ── composite ─────────────────────────────────────────────────────────────────────────────────

@dataclass
class GuardContext:
    source_index: dict = field(default_factory=dict)
    blocked_terms: list[str] = field(default_factory=list)
    prohibited: list[str] = field(default_factory=list)


def build_guard_context(anatomy: dict, mechanisms: list[dict], canonical_intent: dict, intent_token_set: set[str], source_corpus: list[str]) -> GuardContext:
    corpus = list(source_corpus)
    for m in mechanisms:
        corpus += [e.get("description") or "" for e in (m.get("non_transferable_elements") or [])]
    return GuardContext(
        source_index=build_source_index(corpus, SOURCE_COPY_LIMIT),
        blocked_terms=blocked_source_terms(mechanisms, anatomy, intent_token_set),
        prohibited=list(canonical_intent.get("prohibited_claims_or_elements") or []),
    )


def check_text(field_name: str, text: str | None, ctx: GuardContext, *, instruction: bool = True) -> None:
    """Every free-text field of a blueprint passes through this single gate. `instruction=False` is for explanatory
    text (a NOT_USED reason, a limitation) that may need to NAME a prohibited element in order to say it was avoided;
    every other guard still applies to it."""
    if not text:
        return
    reject_performance(field_name, _mask_prohibited(text, ctx.prohibited, only_negated=instruction))
    reject_source_copy(field_name, text, ctx.source_index)
    reject_blocked_terms(field_name, text, ctx.blocked_terms)
    reject_final_copy(field_name, text)
    if instruction:
        reject_prohibited_elements(field_name, text, ctx.prohibited)
