"""Short-lived signed access to uploaded media.

`/uploads/<user_id>/<file>` is no longer public. A request needs `?mt=<media token>`, a JWT that
  * is signed with the server key and carries `typ: "media"` (so it can never be used as an API login token, and an API token is never accepted here),
  * names ONE user (`sub`) and expires (settings.MEDIA_TOKEN_TTL_SECONDS, default 1 hour; the browser refreshes it before it runs out),
  * is only valid for files in THAT user's own folder: the owner is read from the path (`/uploads/<id>/...`) and must equal the token's user.
A token is issued only to an authenticated user (POST /media/token), so ownership is verified before any link exists. There is no public fallback: no token, an expired or forged token -> 401;
a valid token for somebody else's folder -> 403. Range requests (seeking), thumbnails and caching behave as before because the files are still served by the same static handler.

Stored projects keep plain URLs: tokens are stripped when a draft is saved and a fresh one is added when the owner reads it back, so nothing short-lived is ever persisted.
"""
from __future__ import annotations

import re
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from jose import JWTError, jwt

from app.config import settings

MEDIA_TYPE = "media"
QUERY_KEY = "mt"
_UPLOAD_PATH = re.compile(r"^/uploads/(\d+)/([^/]+)$")
# Keys that hold what a person typed: never rewritten, even if the text happens to look like a media URL.
_TEXT_KEYS = frozenset({"text", "name", "label", "title", "content", "caption", "description", "notes"})
_MEDIA_URL = re.compile(r"^(?:https?://[^\s?#]*)?/uploads/(\d+)/[A-Za-z0-9._-]+(?:\?[^\s#]*)?$")


def create_media_token(user_id: int, ttl: int | None = None) -> tuple[str, int]:
    ttl = int(ttl if ttl is not None else settings.MEDIA_TOKEN_TTL_SECONDS)
    token = jwt.encode({"sub": str(user_id), "typ": MEDIA_TYPE, "exp": int(time.time()) + ttl}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return token, ttl


def verify_media_token(token: str | None) -> int | None:
    """The user id the token is for, or None (missing, malformed, forged, expired, or not a media token)."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
    if payload.get("typ") != MEDIA_TYPE:
        return None
    try:
        return int(payload["sub"])
    except (KeyError, ValueError, TypeError):
        return None


def upload_owner(path: str) -> int | None:
    """The user id folder of an `/uploads/<id>/<file>` path, or None for any other shape (deeper paths, `..`, no file...)."""
    m = _UPLOAD_PATH.match(path)
    if not m or m.group(2) in (".", ".."):
        return None
    return int(m.group(1))


class MediaAuthMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so streaming and Range responses pass through untouched."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and (scope["path"] == "/uploads" or scope["path"].startswith("/uploads/")):
            owner = upload_owner(scope["path"])
            token = dict(parse_qsl(scope.get("query_string", b"").decode("latin-1"))).get(QUERY_KEY)
            uid = verify_media_token(token)
            if uid is None:
                return await self._reject(send, 401, "Media access needs a valid, current media link.")
            if owner is None or owner != uid:
                return await self._reject(send, 403, "This media link does not grant access to that file.")
        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(send, code: int, detail: str):
        body = ('{"detail":"%s"}' % detail).encode()
        await send({"type": "http.response.start", "status": code, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"cache-control", b"no-store")]})
        await send({"type": "http.response.body", "body": body})


def _with_token(url: str, token: str | None) -> str:
    parts = urlsplit(url)
    q = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != QUERY_KEY]
    if token:
        q.append((QUERY_KEY, token))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))


def rewrite_media_urls(obj, user_id: int, token: str):
    """A copy of `obj` where every string that IS a media URL of this user's gets a fresh token. Other users' URLs are left without one (so they cannot be opened); ordinary text is never touched."""
    if isinstance(obj, str):
        m = _MEDIA_URL.match(obj)
        return _with_token(obj, token) if m and int(m.group(1)) == user_id else obj
    if isinstance(obj, dict):
        return {k: (v if k in _TEXT_KEYS else rewrite_media_urls(v, user_id, token)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [rewrite_media_urls(v, user_id, token) for v in obj]
    return obj


def strip_media_tokens(obj):
    """A copy of `obj` with the token removed from every media URL (what is stored)."""
    if isinstance(obj, str):
        return _with_token(obj, None) if _MEDIA_URL.match(obj) else obj
    if isinstance(obj, dict):
        return {k: (v if k in _TEXT_KEYS else strip_media_tokens(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [strip_media_tokens(v) for v in obj]
    return obj
