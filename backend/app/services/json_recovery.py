"""Free, deterministic recovery of the most common way a model's JSON goes wrong: raw double quotes INSIDE a string value (a quoted label, a quoted word), trailing commas, and prose or a code fence
around the object. It only ever inserts a backslash before such a quote or deletes a trailing comma: it never adds, removes or rewrites content, and the result still has to pass every
reasoner's own contract validation. If it cannot produce valid JSON it raises the ORIGINAL error, so nothing is silently accepted.

Found on reference 5131: `"reasoning": "... a static packaging label ("NET WT fLOZ (100g)") that recurs ..."` made one of nine paid replies unparseable.
"""
from __future__ import annotations

import json
import re

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
_VALUE_START = re.compile(r'["{\[\-0-9tfn]')


def _next_sig(s: str, i: int) -> tuple[str, int]:
    n = len(s)
    while i < n and s[i] in " \t\r\n":
        i += 1
    return (s[i] if i < n else "", i)


def escape_inner_quotes(s: str) -> tuple[str, int]:
    """Escapes a double quote inside a string when it cannot be the string's closing quote. A closing quote of a KEY is followed by ':'; of a VALUE by ',' + the next member, or '}' / ']'."""
    out: list[str] = []
    stack: list[str] = []
    in_str = False
    is_key = False
    prev_sig = ""
    fixed = 0
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if not in_str:
            out.append(ch)
            if ch == '"':
                in_str = True
                is_key = bool(stack) and stack[-1] == "{" and prev_sig in ("{", ",")
            elif ch in "{[":
                stack.append(ch)
                prev_sig = ch
            elif ch in "}]":
                if stack:
                    stack.pop()
                prev_sig = ch
            elif ch not in " \t\r\n":
                prev_sig = ch
            i += 1
            continue
        if ch == "\\" and i + 1 < n:
            out.append(ch)
            out.append(s[i + 1])
            i += 2
            continue
        if ch != '"':
            out.append(ch)
            i += 1
            continue
        c2, j = _next_sig(s, i + 1)
        closing = False
        if is_key:
            closing = c2 == ":"
        elif c2 in ("}", "]", ""):
            closing = True
        elif c2 == ",":
            c3, k = _next_sig(s, j + 1)
            if stack and stack[-1] == "{":
                closing = c3 == '"' and re.match(r'"[^"\n]{1,80}"\s*:', s[k:k + 90]) is not None
            else:
                closing = bool(c3) and _VALUE_START.match(c3) is not None
        if closing:
            out.append('"')
            in_str = False
            prev_sig = '"'
        else:
            out.append('\\"')
            fixed += 1
        i += 1
    return "".join(out), fixed


def strip_trailing_commas(s: str) -> tuple[str, int]:
    out: list[str] = []
    in_str = False
    removed = 0
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(s[i + 1])
                i += 2
                continue
            if ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
            out.append(ch)
        elif ch == ",":
            c, _ = _next_sig(s, i + 1)
            if c in ("}", "]"):
                removed += 1
            else:
                out.append(ch)
        else:
            out.append(ch)
        i += 1
    return "".join(out), removed


def loads_lenient(raw: str):
    """json.loads, then the {...} slice, then the deterministic repairs. Returns (object, notes); notes are empty when the text was valid as it came. Raises json.JSONDecodeError (the first error) otherwise."""
    try:
        return json.loads(raw), []
    except json.JSONDecodeError as first:
        text = _FENCE.sub("", (raw or "").strip())
        start, end = text.find("{"), text.rfind("}") + 1
        if start == -1 or end <= start:
            raise first
        body = text[start:end]
        try:
            return json.loads(body), ["extracted the JSON object from surrounding text"]
        except json.JSONDecodeError:
            pass
        notes: list[str] = []
        repaired, n_comma = strip_trailing_commas(body)
        if n_comma:
            notes.append(f"removed {n_comma} trailing comma(s)")
        repaired, n_quote = escape_inner_quotes(repaired)
        if n_quote:
            notes.append(f"escaped {n_quote} unescaped quotation mark(s) inside text")
        if not notes:
            raise first
        try:
            return json.loads(repaired), notes
        except json.JSONDecodeError:
            raise first
