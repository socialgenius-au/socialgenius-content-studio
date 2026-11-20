"""Server-side checks for a Brand Kit before it is stored, and for font uploads.

Only KNOWN fields are kept (the stored kit is rebuilt from them), so unexpected keys can never be stored. What is enforced, and why:
  * colours are hex values only, so a colour can never carry script or CSS;
  * font family names are plain names (letters, digits, spaces and a few punctuation marks) because they are later placed into CSS and canvas font strings;
  * counts and sizes are bounded;
  * every referenced file must be an asset of THIS user, of the right kind (logos / brand assets are images, fonts are font files), and its URL must be that user's own /uploads path;
  * font files are checked by extension AND by their leading bytes before they are accepted.
"""
from __future__ import annotations

import json
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.services.media_access import strip_media_tokens

MAX_KIT_BYTES = 1_000_000
MAX_KITS_PER_USER = 50
MAX_NAMES, MAX_LOGOS, MAX_FONTS, MAX_ASSETS, MAX_EXTRA_COLORS = 20, 50, 30, 200, 20
HEX = re.compile(r"^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")
ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
FAMILY_RE = re.compile(r"^[A-Za-z0-9 ,'\"._-]{1,200}$")
COLOR_KEYS = ("primary", "secondary", "accent", "background", "text")
IMAGE_TYPES = frozenset({"image", "thumbnail"})

FONT_EXTENSIONS = {"ttf": "font/ttf", "otf": "font/otf", "woff": "font/woff", "woff2": "font/woff2"}
MAX_FONT_BYTES = 8 * 1024 * 1024
_FONT_MAGIC = {"ttf": (b"\x00\x01\x00\x00", b"true"), "otf": (b"OTTO",), "woff": (b"wOFF",), "woff2": (b"wOF2",)}


class BrandKitValidationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors[:5]))
        self.errors = errors


def check_font_file(filename: str, content: bytes) -> tuple[str, str]:
    """Returns (extension, mime) for a valid font file, else raises BrandKitValidationError. Extension AND the file's first bytes must agree."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in FONT_EXTENSIONS:
        raise BrandKitValidationError([f"fonts: .{ext or '?'} is not a font file (use .ttf, .otf, .woff or .woff2)"])
    if len(content) == 0:
        raise BrandKitValidationError(["fonts: the file is empty"])
    if len(content) > MAX_FONT_BYTES:
        raise BrandKitValidationError([f"fonts: the file is larger than {MAX_FONT_BYTES // (1024 * 1024)} MB"])
    if not content.startswith(_FONT_MAGIC[ext]):
        raise BrandKitValidationError([f"fonts: the file does not look like a real .{ext} font"])
    return ext, FONT_EXTENSIONS[ext]


def _str(v, field: str, errors: list[str], *, max_len: int) -> str:
    if not isinstance(v, str) or not v.strip() or len(v) > max_len:
        errors.append(f"{field}: must be text of 1 to {max_len} characters")
        return ""
    if v[:5].lower() == "data:":
        errors.append(f"{field}: inline data is not stored")
        return ""
    return v.strip()


def _url(v, user_id: int, field: str, errors: list[str]) -> str:
    """Only this user's own /uploads files (token-free); anything else is refused."""
    if v is None or v == "":
        return ""
    if not isinstance(v, str) or len(v) > 2048 or not re.match(rf"^(?:https?://[^\s/]+)?/uploads/{user_id}/[A-Za-z0-9._-]+(?:\?[^\s#]*)?$", v):
        errors.append(f"{field}: must be one of your own uploaded files")
        return ""
    return v


def validate_kit(kit, user_id: int) -> tuple[dict, set[int], set[int]]:
    """Returns (clean kit with media tokens stripped, image asset ids, font asset ids). Raises BrandKitValidationError listing every problem."""
    errors: list[str] = []
    if not isinstance(kit, dict):
        raise BrandKitValidationError(["kit: must be an object"])
    try:
        size = len(json.dumps(kit, separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError):
        raise BrandKitValidationError(["kit: is not valid JSON data"])
    if size > MAX_KIT_BYTES:
        raise BrandKitValidationError([f"kit: is larger than {MAX_KIT_BYTES // 1024} KB"])

    image_ids: set[int] = set()
    font_ids: set[int] = set()
    seen_ids: set[str] = set()

    def item_id(it, path):
        v = it.get("id")
        if not isinstance(v, str) or not ID_RE.match(v):
            errors.append(f"{path}.id: missing or not a valid id")
            return ""
        if v in seen_ids:
            errors.append(f"{path}.id: duplicate id")
        seen_ids.add(v)
        return v

    def listed(key, limit):
        v = kit.get(key, [])
        if not isinstance(v, list):
            errors.append(f"{key}: must be a list")
            return []
        if len(v) > limit:
            errors.append(f"{key}: at most {limit}")
            return []
        return v

    clean: dict = {}
    names = []
    for i, n in enumerate(listed("brand_names", MAX_NAMES)):
        p = f"brand_names[{i}]"
        if not isinstance(n, dict):
            errors.append(f"{p}: not an object")
            continue
        names.append({"id": item_id(n, p), "label": _str(n.get("label"), f"{p}.label", errors, max_len=60), "text": _str(n.get("text"), f"{p}.text", errors, max_len=120)})
    clean["brand_names"] = names

    colors_in = kit.get("colors", {})
    colors: dict = {}
    if not isinstance(colors_in, dict):
        errors.append("colors: must be an object")
    else:
        for k in COLOR_KEYS:
            v = colors_in.get(k)
            if v is None or v == "":
                continue
            if not isinstance(v, str) or not HEX.match(v):
                errors.append(f"colors.{k}: must be a hex colour such as #1E4D2B")
            else:
                colors[k] = v.upper()
        extra = colors_in.get("extra", [])
        if not isinstance(extra, list) or len(extra) > MAX_EXTRA_COLORS:
            errors.append(f"colors.extra: a list of at most {MAX_EXTRA_COLORS}")
        else:
            ex = []
            for i, e in enumerate(extra):
                if not isinstance(e, dict) or not isinstance(e.get("hex"), str) or not HEX.match(e["hex"]):
                    errors.append(f"colors.extra[{i}]: needs a name and a hex colour")
                    continue
                ex.append({"name": _str(e.get("name"), f"colors.extra[{i}].name", errors, max_len=40), "hex": e["hex"].upper()})
            colors["extra"] = ex
    clean["colors"] = colors

    def media_items(key, limit, kind_ids, extra_fields):
        out = []
        for i, it in enumerate(listed(key, limit)):
            p = f"{key}[{i}]"
            if not isinstance(it, dict):
                errors.append(f"{p}: not an object")
                continue
            aid = it.get("asset_id")
            if isinstance(aid, bool) or not isinstance(aid, int) or aid <= 0:
                errors.append(f"{p}.asset_id: must be a positive whole number")
                continue
            kind_ids.add(aid)
            row = {"id": item_id(it, p), "asset_id": aid, "url": _url(it.get("url"), user_id, f"{p}.url", errors)}
            row.update(extra_fields(it, p))
            out.append(row)
        return out

    def label_extra(it, p):
        return {"label": _str(it.get("label"), f"{p}.label", errors, max_len=60)}

    clean["logos"] = media_items("logos", MAX_LOGOS, image_ids, label_extra)
    clean["assets"] = media_items("assets", MAX_ASSETS, image_ids, label_extra)

    def font_extra(it, p):
        fam = it.get("family")
        if not isinstance(fam, str) or not FAMILY_RE.match(fam):
            errors.append(f"{p}.family: a plain font name (letters, numbers, spaces)")
            fam = ""
        w = it.get("weight", 400)
        if isinstance(w, bool) or not isinstance(w, int) or not 100 <= w <= 900:
            errors.append(f"{p}.weight: 100 to 900")
            w = 400
        return {"family": fam.strip(), "weight": w, "italic": bool(it.get("italic", False))}

    clean["fonts"] = media_items("fonts", MAX_FONTS, font_ids, font_extra)

    roles_in = kit.get("font_roles", {})
    roles: dict = {}
    if not isinstance(roles_in, dict):
        errors.append("font_roles: must be an object")
    else:
        for k in ("heading", "body"):
            v = roles_in.get(k)
            if v is None or v == "":
                continue
            if not isinstance(v, str) or not FAMILY_RE.match(v):
                errors.append(f"font_roles.{k}: a plain font name")
            else:
                roles[k] = v.strip()
    clean["font_roles"] = roles

    if errors:
        raise BrandKitValidationError(errors)
    return strip_media_tokens(clean), image_ids, font_ids


async def check_kit_assets(db: AsyncSession, user_id: int, image_ids: set[int], font_ids: set[int]) -> None:
    """Every referenced asset must belong to this user and be of the right kind. The message never reveals whether an id exists for somebody else."""
    errors: list[str] = []
    for label, ids, ok_types in (("pictures", image_ids, IMAGE_TYPES), ("fonts", font_ids, frozenset({"font"}))):
        if not ids:
            continue
        rows = (await db.execute(select(Asset.id, Asset.file_type).where(Asset.id.in_(ids), Asset.user_id == user_id))).all()
        good = {r[0] for r in rows if r[1] in ok_types}
        missing = sorted(ids - good)
        if missing:
            errors.append(f"{label}: {', '.join(map(str, missing[:5]))} {'is' if len(missing) == 1 else 'are'} not a valid {label[:-1]} in your media library")
    if errors:
        raise BrandKitValidationError(errors)
