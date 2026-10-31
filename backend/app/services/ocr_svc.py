"""Video Deconstructor — Stage 6 (OCR / On-Screen Text / Captions). Local/free only — no API
key, no per-call cost, no network call at inference time (EasyOCR's own model weights are
downloaded once on first use, a one-time local-cache fetch, not a per-request cost). Uses EasyOCR
specifically because it reuses this project's own already-installed torch runtime (pulled in for
Whisper) rather than adding a second heavy ML framework — PaddleOCR was considered and rejected
in the Stage-6 design review for exactly that reason.

Language grouping — verified directly against this project's own installed
`easyocr/config.py`, not assumed from documentation: EasyOCR's non-Latin recognition models are
each compatible ONLY with their own script group plus English; a single Reader instance cannot
mix Devanagari with Arabic-script languages. The real, installed groupings relevant to this
project's stated language requirements (English, Hindi, Urdu, Arabic):
    arabic_lang_list    = ('ar', 'fa', 'ug', 'ur')   — Arabic AND Urdu share ONE model
    devanagari_lang_list = ('hi', 'mr', 'ne', ...)    — Hindi is a SEPARATE, incompatible group
So covering English + Hindi + Urdu + Arabic needs exactly TWO Reader instances / OCR passes per
frame (OCR_LANGUAGE_GROUPS below), not three or four.

Certainty discipline: every detection this module returns is MEASURED (a deterministic
recognizer's own output — the raw string, its own reported confidence, its own detected
geometry). Nothing here classifies role/category, identifies a font, corrects spelling, or
translates — see the Stage-6 design review for the exact fact/interpretation boundary.

Two-level evidence structure (post-manual-test refinement — see the "evidence-preserving
canonical grouping" design review for the full reasoning this module implements):
  - group_occurrences(): every raw detection is kept; this only decides which ones are probably
    the SAME local appearance (read more than once), never merging/editing/dropping a row.
  - link_recurring_elements(): a SEPARATE, explicitly INFERRED cross-reference between different
    Occurrence Groups that probably represent the same real element reappearing after a gap too
    large to call one continuous local appearance — never merges their time spans.
"""
import asyncio
import difflib

import easyocr
import numpy as np
from PIL import Image

# See this module's own docstring above for why these two groups, and why exactly two (not more).
OCR_LANGUAGE_GROUPS: list[list[str]] = [
    ["en", "ar", "ur"],
    ["en", "hi"],
]

# Readers are expensive to construct (loads model weights from local cache, or downloads them on
# a genuine first-ever use) — cached per exact language-group tuple and reused for the lifetime
# of this process, never rebuilt per request/per frame.
_readers: dict[tuple[str, ...], "easyocr.Reader"] = {}


def _get_reader(languages: list[str]) -> "easyocr.Reader":
    key = tuple(languages)
    if key not in _readers:
        _readers[key] = easyocr.Reader(languages, gpu=False)
    return _readers[key]


async def detect_text_in_frame(image_path: str) -> list[dict]:
    """Runs EasyOCR against one frame image, once per language group in OCR_LANGUAGE_GROUPS, and
    returns every detection from every group as one flat list. Detections from different groups
    are NOT deduplicated here (e.g. a pure-English string may be read once by each group's own
    English fallback) — that's left entirely to dedupe_text_detections below, which already has
    to merge multi-frame detections and applies the exact same text+geometry rule to multi-group
    ones from the same frame, rather than needing two different merge implementations.

    Returns [{"text": str, "confidence": float, "bbox_px": (x0,y0,x1,y1), "language_group":
    [...]}, ...] — bbox_px is in the SOURCE IMAGE's own pixel coordinates, not yet normalized to
    this schema's 0-1 convention (the caller knows the frame's own dimensions and does that
    conversion — same separation of concerns as ffmpeg_svc.compute_frame_measurements returning
    raw pixel facts for its caller to interpret).

    Runs EasyOCR's own (synchronous, blocking, CPU-bound) inference via asyncio.to_thread — never
    call reader.readtext directly on the event loop.
    """
    img = np.array(Image.open(image_path).convert("RGB"))
    results: list[dict] = []
    for languages in OCR_LANGUAGE_GROUPS:
        reader = _get_reader(languages)
        detections = await asyncio.to_thread(reader.readtext, img)
        for bbox_points, text, confidence in detections:
            if not text.strip():
                continue  # a detected region with no actual characters is not evidence of text
            xs = [float(p[0]) for p in bbox_points]
            ys = [float(p[1]) for p in bbox_points]
            results.append({
                "text": text,
                "confidence": float(confidence),
                # EasyOCR's own bbox coordinates come back as numpy.float64 — cast to plain
                # Python floats here (not left for a caller to discover later) so every downstream
                # consumer (JSON serialization, Pydantic, the `round()`/arithmetic in
                # ffmpeg_svc.compute_text_region_style) gets ordinary floats, never a numpy scalar
                # leaking out of this module's own public return shape.
                "bbox_px": (min(xs), min(ys), max(xs), max(ys)),
                "language_group": languages,
            })
    return results


def select_frames_to_ocr(candidates: list[dict]) -> list[dict]:
    """Given a chronologically-sorted list of candidate frames (Stage 5's own existing
    ShotFrames plus Stage 6's own supplementary fixed-interval samples, already merged and
    sorted by timestamp), returns only those genuinely worth running OCR against — skipping any
    candidate whose dHash is a near-duplicate of the last SELECTED frame, using the exact same
    threshold/mechanism Stage 5 already proved (ffmpeg_svc.compute_dhash/hamming_distance/
    FRAME_DUPLICATE_HAMMING_THRESHOLD) rather than inventing a second one.

    Last-candidate safeguard: the loop below already guarantees the FIRST candidate of a shot is
    always kept (nothing precedes it to compare against) — this extends the identical guarantee
    to the LAST one. Verified against a real, confirmed completeness gap found by direct
    investigation against Sameena's own real reference video: a short Shot with few candidates
    can have ALL of them judged against the same stale, distant "last accepted" anchor, silently
    losing coverage of the shot's own ending instants. Concretely, Shot 02 (3 total candidates)
    lost its only two supplementary candidates this way, both compared against a single existing
    frame 1.2-2.6s earlier — one of them (the chronologically last) showed the video's own
    recurring watermark at 67% confidence, text nothing else in that shot ever captured. Adds at
    most ONE extra OCR call per shot, only when the last candidate would otherwise have been
    dropped — FRAME_DUPLICATE_HAMMING_THRESHOLD is unchanged, and Stage 5's own separate,
    independently-implemented dedup (ffmpeg_svc.extract_representative_frames_for_shot) is
    untouched — this function has exactly one caller (the Stage-6 endpoint in
    routers/reference_videos.py), so this change carries zero Stage-5 risk.

    `candidates`: [{"timestamp": float, "file_path": str, ...other caller-attached fields...}]
    (already extracted to real files by the caller — this function only decides which of them get
    OCR'd, it does not do any extraction itself). Returns the same dicts, filtered — every other
    field the caller attached (e.g. which ShotFrame/Asset a candidate came from) passes through
    untouched. Order is chronological except for a safeguarded last candidate appended at the
    end when it wouldn't otherwise have survived — harmless, since every caller re-sorts by
    timestamp before using the result for anything order-sensitive.
    """
    from app.services import ffmpeg_svc  # local import: avoids a hard OCR-engine dependency for
    # any caller that only wants ffmpeg_svc's own frame/measurement functions without EasyOCR.

    if not candidates:
        return []

    selected: list[dict] = []
    last_hash: int | None = None
    for c in candidates:
        digest = ffmpeg_svc.compute_dhash(c["file_path"])
        if last_hash is not None and ffmpeg_svc.hamming_distance(digest, last_hash) <= ffmpeg_svc.FRAME_DUPLICATE_HAMMING_THRESHOLD:
            continue
        selected.append(c)
        last_hash = digest

    if selected[-1] is not candidates[-1]:
        selected.append(candidates[-1])

    return selected


def _normalize_for_comparison(text: str) -> str:
    """Whitespace/case normalization used ONLY to decide whether two detections are "the same
    occurrence" — the ORIGINAL raw text (verbatim, unnormalized) is what actually gets stored;
    this never overwrites or cleans the stored value."""
    return " ".join(text.split()).casefold()


def _text_similarity(a: str, b: str) -> float:
    """0-1 similarity, stdlib-only (no new dependency) — difflib's ratio() on whitespace/case-
    normalized text. Used only to decide grouping/linking; never fed back into what's stored."""
    return difflib.SequenceMatcher(None, _normalize_for_comparison(a), _normalize_for_comparison(b)).ratio()


def _bbox_iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    intersection = (ix1 - ix0) * (iy1 - iy0)
    area_a = (ax1 - ax0) * (ay1 - ay0)
    area_b = (bx1 - bx0) * (by1 - by0)
    union = area_a + area_b - intersection
    return intersection / union if union > 0 else 0.0


def _bbox_size_similarity(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    """0-1: how similarly SIZED two boxes are, independent of position — the ratio of the
    smaller to the larger dimension, averaged over width and height. Used by Recurring Element
    linkage (below) specifically for the case where the same-looking text/graphic appears at a
    DIFFERENT screen position — position-based IoU is 0 there by construction, so size is the
    only geometric signal left that can still tell "same kind of element" from "coincidence"."""
    aw, ah = a[2] - a[0], a[3] - a[1]
    bw, bh = b[2] - b[0], b[3] - b[1]
    if aw <= 0 or ah <= 0 or bw <= 0 or bh <= 0:
        return 0.0
    return (min(aw, bw) / max(aw, bw) + min(ah, bh) / max(ah, bh)) / 2


class _UnionFind:
    """Minimal union-find for connected-component grouping — a chain of pairwise matches (A-B,
    B-C) puts A/B/C in one group even where A-C alone wouldn't independently clear the bar."""
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


# ─── Occurrence Grouping — evidence-preserving; see the module docstring above and the Stage-6
# manual-test design review for the full "why two levels, why these signals" reasoning. ─────────
#
# EVERY raw detection is kept forever, unedited — grouping only decides which raw rows point at
# a shared canonical head; it never merges, edits, or drops one.
#
# Two ways two detections can belong to the same Occurrence Group ("the same LOCAL appearance,
# read more than once"):
#   Rule A ("same photograph"): same source frame (identical extracted image) AND near-total
#   bbox overlap — regardless of text similarity. Verified directly against this project's own
#   real reference video: every one of 20 same-frame detection pairs found there had bbox IoU of
#   exactly 1.0; 5 of those 20 had ZERO text similarity between the two readings (e.g. one pass
#   read "عتعما", the other read "Kawne") yet are unquestionably the same on-screen spot at the
#   same instant — proof text similarity cannot be trusted for this case, only geometry+identity
#   can.
#   Rule B ("recurring within a short window"): different frames, but ALL THREE of: bbox overlap,
#   text similarity, AND a small time gap. All three required together — text similarity alone is
#   never sufficient.
#
# PROVISIONAL, NAMED, VERSIONED thresholds (OCCURRENCE_GROUPING_PASS_NAME) — set by inspecting
# every one of 861 real pairwise combinations from this project's own single real reference
# video, not guessed: every genuine same-frame pair measured bbox IoU = 1.0 (hence 0.85, a
# comfortable margin below that for float noise); every genuine cross-frame "same local
# appearance" pair measured bbox IoU 0.58-1.0, text similarity 0.58-1.0, and a 2.32s gap (one
# real sampling step) — hence 0.5 / 0.5 / 5.0s, each with real margin from the observed values.
# This is ONE video's worth of evidence, not a universal constant — because every raw observation
# is now kept forever (never discarded), recalibrating these against more real videos later never
# needs to re-run OCR, only re-analyse stored rows. Bump the pass name (v2, v3, ...) if these
# change, so a historical row's own provenance always shows which threshold-set produced it.
OCCURRENCE_GROUPING_PASS_NAME = "occurrence_grouping_v1"
OCCURRENCE_SAMEFRAME_IOU_MIN = 0.85
OCCURRENCE_CROSSFRAME_IOU_MIN = 0.5
OCCURRENCE_CROSSFRAME_SIM_MIN = 0.5
OCCURRENCE_CROSSFRAME_MAX_GAP_SECONDS = 5.0


def group_occurrences(detections: list[dict]) -> list[list[dict]]:
    """detections: raw OCR detections for one Shot (any order) — each a dict with at least
    "text", "confidence", "bbox_norm" (x0,y0,x1,y1 in 0-1), "timestamp", "file_path" (the exact
    source frame it came from — used for Rule A's "same photograph" identity check).

    Returns a list of GROUPS — each group the SAME detection dicts (never copied, merged, or
    edited), sorted highest-confidence first. That first member is the group's own canonical
    head. Every input detection appears in exactly one output group; a detection matching nothing
    else is its own group of one — the "ambiguous cases stay separate" requirement, satisfied by
    construction (nothing here ever forces an unmatched detection into a group).
    """
    n = len(detections)
    uf = _UnionFind(n)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = detections[i], detections[j]
            iou = _bbox_iou(a["bbox_norm"], b["bbox_norm"])
            same_frame = a["file_path"] == b["file_path"]
            if same_frame and iou >= OCCURRENCE_SAMEFRAME_IOU_MIN:
                uf.union(i, j)
                continue
            gap = abs(a["timestamp"] - b["timestamp"])
            if gap > OCCURRENCE_CROSSFRAME_MAX_GAP_SECONDS or iou < OCCURRENCE_CROSSFRAME_IOU_MIN:
                continue
            if _text_similarity(a["text"], b["text"]) >= OCCURRENCE_CROSSFRAME_SIM_MIN:
                uf.union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(n):
        clusters.setdefault(uf.find(i), []).append(i)

    return [
        sorted((detections[i] for i in members), key=lambda d: -d["confidence"])
        for members in clusters.values()
    ]


# ─── Recurring Element linkage — explicitly INFERRED; see the module docstring above for the
# certainty/provenance split from Occurrence Grouping. ───────────────────────────────────────────
#
# Cross-references two or more Occurrence Groups (by their own canonical head) that PROBABLY
# represent the same real on-screen element reappearing — e.g. a watermark visible at three
# separated moments — WITHOUT merging their time spans or claiming visibility in between. Unlike
# Occurrence Grouping, the two groups' screen POSITIONS may differ (bridging exactly the case
# Occurrence Grouping's tight window can't reach) — so a match needs text similarity plus ONE of
# two alternative second signals (never text alone):
#   Path 1 ("same spot, reappeared"): high text similarity AND the canonical bboxes still
#   substantially overlap (the element didn't move, just went off-screen and came back).
#   Path 2 ("same-looking element, different spot"): high text similarity AND the bboxes are a
#   similar SIZE even at a different position. Verified directly against this project's own real
#   video: the one real cross-position recurrence found there (a watermark seen in one screen
#   corner, then a different corner 9s later) had bbox size-similarity of 0.83 while position IoU
#   was 0 — sizes agree even though position doesn't, exactly what this path is built to catch.
# A stricter text bar than Occurrence Grouping's (0.85 vs 0.5): bridging a large, unobserved time
# gap is a bigger inferential leap than confirming a nearby local moment, and deserves more
# textual agreement before making that leap. Same "provisional, named, versioned, one video's
# evidence" caveat as Occurrence Grouping above.
RECURRING_ELEMENT_PASS_NAME = "recurring_text_linkage_v1"
RECURRING_TEXT_SIMILARITY_MIN = 0.85
RECURRING_POSITION_IOU_MIN = 0.5
RECURRING_SIZE_SIMILARITY_MIN = 0.7


def link_recurring_elements(group_heads: list[dict]) -> list[dict]:
    """group_heads: one dict per Occurrence Group's own canonical head, each with "id" (the
    real, already-persisted TextElement id), "text", "bbox_norm", "timestamp". Only ever compares
    heads of DIFFERENT groups — two members of the same Occurrence Group are already known to be
    the same appearance and have no need of this.

    Returns one entry per cluster of 2+ linked heads: {"member_ids": [...], "confidence": float,
    "pairwise_evidence": [...]}. A head matching nothing else is simply omitted — never forced
    into a relationship the evidence doesn't support, the same "ambiguous stays separate"
    guarantee as Occurrence Grouping.
    """
    n = len(group_heads)
    uf = _UnionFind(n)
    pairwise: dict[tuple[int, int], dict] = {}
    for i in range(n):
        for j in range(i + 1, n):
            a, b = group_heads[i], group_heads[j]
            sim = _text_similarity(a["text"], b["text"])
            if sim < RECURRING_TEXT_SIMILARITY_MIN:
                continue
            iou = _bbox_iou(a["bbox_norm"], b["bbox_norm"])
            size_sim = _bbox_size_similarity(a["bbox_norm"], b["bbox_norm"])
            if iou < RECURRING_POSITION_IOU_MIN and size_sim < RECURRING_SIZE_SIMILARITY_MIN:
                continue
            uf.union(i, j)
            pairwise[(i, j)] = {
                "a": a["id"], "b": b["id"],
                "text_similarity": round(sim, 3),
                "bbox_iou": round(iou, 3),
                "bbox_size_similarity": round(size_sim, 3),
                "time_gap": round(abs(a["timestamp"] - b["timestamp"]), 2),
            }

    clusters: dict[int, list[int]] = {}
    for i in range(n):
        clusters.setdefault(uf.find(i), []).append(i)

    results = []
    for members in clusters.values():
        if len(members) < 2:
            continue
        evidence = [e for (i, j), e in pairwise.items() if i in members and j in members]
        avg_sim = sum(e["text_similarity"] for e in evidence) / len(evidence)
        results.append({
            "member_ids": [group_heads[i]["id"] for i in members],
            "confidence": round(avg_sim, 3),
            "pairwise_evidence": evidence,
        })
    return results
