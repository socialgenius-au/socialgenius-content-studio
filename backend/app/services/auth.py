import logging
import re
from datetime import datetime, timedelta, timezone

from jose import jwt, JWTError
from passlib.context import CryptContext

from app.config import settings

logger = logging.getLogger(__name__)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(user_id: int, username: str, role: str, token_version: int = 0) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        # `tv` = the user's token_version at login; a password reset bumps it, which invalidates every token issued before.
        {"sub": str(user_id), "username": username, "role": role, "tv": token_version, "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


_BASE64URL = re.compile(r"^[A-Za-z0-9_-]+$")
_KNOWN_ALGS = {"HS256", "HS384", "HS512", "RS256", "ES256", "none"}
_PLACEHOLDERS = {"undefined", "null", "none", "nan", "true", "false", "[object object]"}


def describe_credential(credential: str | None) -> str:
    """Non-secret STRUCTURAL facts about a credential that was rejected, so a log line can tell "the server could not verify a well-formed token" (a configuration problem) from "the client
    sent something that is not the token it was issued" (quotes around it, a doubled `Bearer`, the text `undefined`, a truncated value). It never contains the credential, any claim, the key or any part of them:
    only a length, a segment count, fixed flag names and, if the header parses, the algorithm name when it is one of a short fixed list."""
    if credential is None:
        return "no credential"
    text = credential.strip()
    parts = text.split(".")
    flags: list[str] = []
    if credential != text:
        flags.append("outer_whitespace")
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        flags.append("wrapped_in_quotes")
    elif any(q in text for q in "\"'"):
        flags.append("contains_quote")
    if re.match(r"(?i)^bearer\b", text):
        flags.append("repeated_bearer_prefix")
    if text.lower() in _PLACEHOLDERS:
        flags.append("placeholder_text")
    if any(ch.isspace() for ch in text):
        flags.append("inner_whitespace")
    if len(parts) == 3 and all(_BASE64URL.match(p) for p in parts):
        flags.append("jwt_shaped")
        try:
            alg = jwt.get_unverified_header(text).get("alg")
            flags.append(f"alg={alg if alg in _KNOWN_ALGS else 'other'}")
        except JWTError:
            flags.append("header_unreadable")
    return f"length={len(credential)} segments={len(parts)} flags={','.join(flags) or 'none'}"


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        # Log only the exception class and the credential's STRUCTURE (describe_credential): never the token, claims, key or message.
        # This distinguishes expired, signature and claims errors, and a malformed credential from a well-formed one, in acceptance logs.
        logger.warning("JWT verification rejected token: %s (%s)", type(exc).__name__, describe_credential(token))
        return None
