"""Server-side checks for a Carousel Creator document before it is stored.

The editor validates its own documents; the server must not trust that. What is enforced here, and why:
  * shape: a multi-page PostDocument (kind "post", schemaVersion 1) with at least one slide and NO fixed slide-count limit (only the size bounds below), unique ids, known element types, bounded depth and counts, so a malformed or hostile body can
    never be stored and later crash a reader;
  * size: the whole document and every string are bounded, and inline image data (`data:` URLs) is refused - images live in the existing media storage and a document only REFERENCES
    them, so a document can never become a way to put large blobs in the database;
  * URLs: only relative paths or http(s) URLs, so a stored URL can never be a `javascript:` or other scheme that is later rendered into an <img> or CSS url();
  * tokens: short-lived media tokens are stripped from media URLs (the owner gets a fresh one when reading);
  * ownership: every image that names an asset id must be an asset of THIS user (checked against the `assets` table), so a document cannot point at somebody else's file.
"""
from __future__ import annotations

import json
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.services.media_access import strip_media_tokens

SCHEMA_VERSION = 1
# There is deliberately no maximum number of slides: a large carousel is bounded by its SIZE. These are safety bounds against hostile or runaway documents, not product limits.
MAX_ELEMENTS_PER_SLIDE = 1000
MAX_DEPTH = 6
MAX_DOC_BYTES = 25_000_000
MAX_TOTAL_ELEMENTS = 200_000
MAX_STRING = 20_000
MAX_URL = 2048
MAX_CAROUSELS_PER_USER = 1000
ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
ELEMENT_TYPES = frozenset({"text", "image", "shape", "group"})
BACKGROUND_KINDS = frozenset({"solid", "gradient", "image"})
URL_OK = re.compile(r"^(?:/(?!/)|https?://)", re.IGNORECASE)


class CarouselValidationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors[:5]))
        self.errors = errors


def _walk_strings(obj, path: str, errors: list[str], depth: int = 0) -> None:
    if depth > 24:
        errors.append(f"{path}: nested too deeply")
        return
    if isinstance(obj, str):
        if len(obj) > MAX_STRING:
            errors.append(f"{path}: text is longer than {MAX_STRING} characters")
        if obj[:5].lower() == "data:":
            errors.append(f"{path}: inline image data is not stored; upload the picture instead")
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k == "url" and isinstance(v, str) and v != "":
                if len(v) > MAX_URL or not URL_OK.match(v):
                    errors.append(f"{path}.url: must be a relative path or an http(s) address of at most {MAX_URL} characters")
            _walk_strings(v, f"{path}.{k}", errors, depth + 1)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _walk_strings(v, f"{path}[{i}]", errors, depth + 1)


def _collect_assets(source, out: set[int], errors: list[str], path: str) -> None:
    if isinstance(source, dict) and source.get("kind") == "asset" and "assetId" in source and source["assetId"] is not None:
        aid = source["assetId"]
        if isinstance(aid, bool) or not isinstance(aid, int) or aid <= 0:
            errors.append(f"{path}.assetId: must be a positive whole number")
        else:
            out.add(aid)


def _check_elements(elements, path: str, ids: set[str], assets: set[int], errors: list[str], depth: int) -> None:
    if depth > MAX_DEPTH:
        errors.append(f"{path}: groups are nested too deeply")
        return
    if not isinstance(elements, list):
        errors.append(f"{path}: must be a list")
        return
    if len(elements) > MAX_ELEMENTS_PER_SLIDE:
        errors.append(f"{path}: at most {MAX_ELEMENTS_PER_SLIDE} elements per slide")
        return
    for i, el in enumerate(elements):
        p = f"{path}[{i}]"
        if not isinstance(el, dict):
            errors.append(f"{p}: not an object")
            continue
        eid = el.get("id")
        if not isinstance(eid, str) or not ID_RE.match(eid):
            errors.append(f"{p}.id: missing or not a valid id")
        elif eid in ids:
            errors.append(f"{p}.id: duplicate element id")
        else:
            ids.add(eid)
        if el.get("type") not in ELEMENT_TYPES:
            errors.append(f"{p}.type: unknown element type")
            continue
        if el["type"] == "image":
            _collect_assets(el.get("source"), assets, errors, f"{p}.source")
        elif el["type"] == "group":
            _check_elements(el.get("children"), f"{p}.children", ids, assets, errors, depth + 1)


def validate_document(doc, expected_doc_id: str | None = None) -> tuple[dict, set[int]]:
    """Returns (the document to store - tokens stripped, the asset ids it references). Raises CarouselValidationError listing every problem found."""
    errors: list[str] = []
    if not isinstance(doc, dict):
        raise CarouselValidationError(["document: must be an object"])
    try:
        size = len(json.dumps(doc, separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError):
        raise CarouselValidationError(["document: is not valid JSON data"])
    if size > MAX_DOC_BYTES:
        raise CarouselValidationError([f"document: is {size // 1024} KB; the limit is {MAX_DOC_BYTES // 1024} KB (images belong in the media library, not in the document)"])

    if doc.get("kind") != "post":
        errors.append('kind: must be "post"')
    if doc.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(f"schemaVersion: expected {SCHEMA_VERSION}")
    did = doc.get("id")
    if not isinstance(did, str) or not ID_RE.match(did):
        errors.append("id: missing or not a valid id")
    elif expected_doc_id is not None and did != expected_doc_id:
        errors.append("id: does not match the carousel being saved")
    if not isinstance(doc.get("title"), str) or len(doc.get("title", "")) > 255:
        errors.append("title: must be text of at most 255 characters")
    fmt = doc.get("format")
    if not isinstance(fmt, dict) or not all(isinstance(fmt.get(k), str) and 0 < len(fmt[k]) <= 64 for k in ("platformKey", "formatKey")) \
            or not all(isinstance(fmt.get(k), (int, float)) and not isinstance(fmt.get(k), bool) and 0 < fmt[k] <= 8192 for k in ("width", "height")):
        errors.append("format: needs platformKey, formatKey and a width/height between 1 and 8192")

    pages = doc.get("pages")
    ids: set[str] = set()
    assets: set[int] = set()
    if not isinstance(pages, list) or len(pages) < 1:
        errors.append("pages: a carousel needs at least one slide")
    else:
        page_ids: set[str] = set()
        for i, p in enumerate(pages):
            path = f"pages[{i}]"
            if not isinstance(p, dict):
                errors.append(f"{path}: not an object")
                continue
            pid = p.get("id")
            if not isinstance(pid, str) or not ID_RE.match(pid):
                errors.append(f"{path}.id: missing or not a valid id")
            elif pid in page_ids:
                errors.append(f"{path}.id: duplicate slide id")
            else:
                page_ids.add(pid)
            bg = p.get("background")
            if not isinstance(bg, dict) or bg.get("kind") not in BACKGROUND_KINDS:
                errors.append(f"{path}.background: invalid")
            elif bg.get("kind") == "image":
                _collect_assets(bg.get("source"), assets, errors, f"{path}.background.source")
            _check_elements(p.get("elements"), f"{path}.elements", ids, assets, errors, 0)

    if len(ids) > MAX_TOTAL_ELEMENTS:
        errors.append(f"document: has {len(ids)} elements; the limit is {MAX_TOTAL_ELEMENTS}")
    _walk_strings(doc, "document", errors)
    if errors:
        raise CarouselValidationError(errors)
    return strip_media_tokens(doc), assets


async def check_asset_ownership(db: AsyncSession, user_id: int, asset_ids: set[int]) -> None:
    """Every referenced asset must belong to this user; the message does not reveal whether a missing id exists for somebody else."""
    if not asset_ids:
        return
    rows = (await db.execute(select(Asset.id).where(Asset.id.in_(asset_ids), Asset.user_id == user_id))).scalars().all()
    missing = sorted(asset_ids - set(rows))
    if missing:
        raise CarouselValidationError([f"images: {', '.join(map(str, missing[:5]))} {'is' if len(missing) == 1 else 'are'} not in your media library"])


def extract_metadata(doc: dict) -> dict:
    """The few fields kept in their own columns so lists can be shown without loading every document."""
    prov = doc.get("provenance") or {}
    gen = prov.get("generation") or {}
    blueprint = prov.get("importRef", "")
    ref = next((r.get("id") for r in (gen.get("intelligenceRefs") or []) if isinstance(r, dict) and r.get("kind") == "reference_video"), None)
    try:
        ref_id = int(ref) if ref is not None else None
    except (TypeError, ValueError):
        ref_id = None
    fmt = doc.get("format") or {}
    return {
        "title": (doc.get("title") or "")[:255],
        "slide_count": len(doc.get("pages") or []),
        "platform_key": fmt.get("platformKey", ""),
        "format_key": fmt.get("formatKey", ""),
        "blueprint_id": blueprint[len("blueprint:"):][:64] if isinstance(blueprint, str) and blueprint.startswith("blueprint:") else None,
        "reference_video_id": ref_id,
    }
