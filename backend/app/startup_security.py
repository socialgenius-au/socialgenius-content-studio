"""Deployment-time security configuration: CORS origins, seeded users and the JWT signing key.

Everything here is a pure function of its arguments (the environment is passed in, never read at
import time) so it can be unit-tested without a database. app/main.py is the only caller.

Why this exists (preview/unified-v1): the original behaviour was fine for a single trusted
developer machine but unsafe on a public URL --
  * CORS origins were a hard-coded list, so every new frontend host needed a code change;
  * three users were seeded with the PREDICTABLE password "<username>123" (and the login page
    advertised it);
  * SECRET_KEY had a public default, which lets anyone forge a login token.
The defaults for local development are unchanged; on Railway the unsafe combinations fail closed.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

# Origins that have always been allowed. Environment-supplied origins are only ever ADDED to these.
BASE_ALLOWED_ORIGINS: tuple[str, ...] = (
    "https://content-studio-frontend-production-84fe.up.railway.app",
    # Ayub staging test frontend (snapshot branch only) — see staging/ayub-video-studio-test-03-sep-2026.
    "https://frontend-ayubtest-contentstudio-production.up.railway.app",
    # Ayub staging test frontend, Netlify deploy — see staging/ayub-video-studio-test-03-sep-2026.
    "https://socialgenius-video-studio-test.netlify.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)

CORS_ENV_VAR = "CORS_ALLOWED_ORIGINS"

SEED_USERNAMES: tuple[str, ...] = ("ayub", "priya", "iqra")
MIN_SEED_PASSWORD_LENGTH = 12
MIN_SECRET_KEY_LENGTH = 32
DEFAULT_SECRET_KEY = "change-me-in-production-use-32-chars-minimum"

_RAILWAY_MARKERS = ("RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID")


class StartupConfigError(RuntimeError):
    """The deployment configuration is unsafe; the app must not start with it."""


def on_railway(env: Mapping[str, str]) -> bool:
    return any(env.get(k) for k in _RAILWAY_MARKERS)


# ── CORS ──────────────────────────────────────────────────────────────────────────────────────

def normalise_origin(raw: str) -> str:
    """Return scheme://host[:port] for a well-formed http(s) origin, or raise ValueError.

    A browser's Origin header never has a path, query or trailing slash, so an entry that does is
    almost certainly a pasted URL; it is normalised rather than silently never matching.
    Wildcards are rejected outright: this app allows credentials, and "*" with credentials is both
    refused by browsers and the wrong intent.
    """
    value = raw.strip()
    if not value:
        raise ValueError("empty origin")
    if "*" in value:
        raise ValueError(f"wildcard origins are not allowed: {value!r}")
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError(f"origin must look like https://host[:port]: {value!r}")
    if parts.username or parts.password:
        raise ValueError(f"origin must not contain credentials: {value!r}")
    host = parts.hostname.lower()
    if ":" in host:                         # IPv6 literal
        host = f"[{host}]"
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{host}{port}"


def parse_extra_origins(raw: str | None) -> list[str]:
    """Parse the comma/whitespace-separated CORS_ALLOWED_ORIGINS value. Invalid entries raise."""
    if not raw:
        return []
    out: list[str] = []
    for item in re.split(r"[,\s]+", raw.strip()):
        if item:
            out.append(normalise_origin(item))
    return out


def build_allowed_origins(raw_extra: str | None) -> list[str]:
    """BASE_ALLOWED_ORIGINS first (order preserved), then any env-supplied origins, de-duplicated."""
    seen: set[str] = set()
    result: list[str] = []
    for origin in (*BASE_ALLOWED_ORIGINS, *parse_extra_origins(raw_extra)):
        if origin not in seen:
            seen.add(origin)
            result.append(origin)
    return result


# ── Seeded users ──────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SeedPlan:
    mode: str                                   # "dev" | "env" | "off"
    passwords: dict[str, str]                   # username -> plaintext, only for users to create
    skipped: tuple[str, ...]                    # usernames that will NOT be created, and why is logged


def seed_password_env_var(username: str) -> str:
    return f"SEED_PASSWORD_{username.upper()}"


def plan_seed_users(env: Mapping[str, str]) -> SeedPlan:
    """Decide which users to create at startup and with which passwords.

    SEED_USERS_MODE:
      dev (default off Railway)  — the original behaviour: "<username>123". Local development only.
      env (default ON Railway)   — each user is created only if SEED_PASSWORD_<USERNAME> is set to
                                   a password of at least 12 characters; there is NO fallback.
      off                        — create no users (use a deliberate provisioning step instead).
    The 'dev' mode is refused on Railway so that forgetting to set the variable cannot publish
    predictable credentials. Passwords are never logged.
    """
    mode = (env.get("SEED_USERS_MODE") or "").strip().lower()
    railway = on_railway(env)
    if not mode:
        mode = "env" if railway else "dev"
    if mode not in ("dev", "env", "off"):
        raise StartupConfigError(f"SEED_USERS_MODE must be 'dev', 'env' or 'off' (got {mode!r})")
    if mode == "dev" and railway:
        raise StartupConfigError(
            "SEED_USERS_MODE=dev creates users with predictable passwords and is refused on Railway. "
            "Use SEED_USERS_MODE=env with SEED_PASSWORD_AYUB / _PRIYA / _IQRA, or SEED_USERS_MODE=off."
        )

    if mode == "off":
        return SeedPlan(mode, {}, SEED_USERNAMES)
    if mode == "dev":
        return SeedPlan(mode, {u: f"{u}123" for u in SEED_USERNAMES}, ())

    passwords: dict[str, str] = {}
    skipped: list[str] = []
    for username in SEED_USERNAMES:
        value = env.get(seed_password_env_var(username), "")
        if len(value) >= MIN_SEED_PASSWORD_LENGTH:
            passwords[username] = value
        else:
            skipped.append(username)
            logger.warning(
                "Seed user %r not created: %s is unset or shorter than %d characters",
                username, seed_password_env_var(username), MIN_SEED_PASSWORD_LENGTH,
            )
    return SeedPlan(mode, passwords, tuple(skipped))


# ── JWT signing key ───────────────────────────────────────────────────────────────────────────

def check_secret_key(secret_key: str, env: Mapping[str, str]) -> None:
    """On Railway, refuse the public default or a short key: anyone could forge login tokens."""
    if not on_railway(env):
        return
    if secret_key == DEFAULT_SECRET_KEY or len(secret_key) < MIN_SECRET_KEY_LENGTH:
        raise StartupConfigError(
            f"SECRET_KEY must be set to a random value of at least {MIN_SECRET_KEY_LENGTH} characters on Railway "
            "(the built-in default is public)."
        )
