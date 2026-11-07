"""A token issued by POST /auth/login must authenticate GET /auth/me, and everything that is NOT such a token must still be refused (401).

Why this exists: on the deconstructor-acceptance environment `POST /auth/login` answered 200 and the very next `GET /auth/me` answered 401 with `JWT verification rejected token: JWTError`. The investigation
(see the commit message) showed the server signs and verifies consistently, so a bare JWTError means the credential that ARRIVED is not the token that was issued. These tests pin down:
  * the whole login -> authenticated request flow through the real app (real routes, real Postgres, real rate limiter), for freshly issued tokens;
  * that invalid, expired, tampered, wrongly signed and MALFORMED credentials (quoted, doubled `Bearer`, `undefined`) are all refused, never accepted;
  * that a rejection is logged with the exception class only: never the token, a claim, the signing key or the password.
The HTTP tests need a database on this machine (they create and delete their own `jwt_*` users); the unit tests always run.
"""
import asyncio
import logging
import secrets
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.config import settings
from app.database import engine
from app.limiter import limiter
from app.main import app
from app.services.auth import create_token, decode_token, hash_password

PW = "correct-horse-battery"
LOCAL_DB = any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]"))
needs_local_db = pytest.mark.skipif(not LOCAL_DB, reason="these tests create/delete users: they only run against a database on this machine")


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── unit: the structure description and the decode path (no database) ────────────────────────────────────────────

def test_a_valid_token_decodes_and_carries_its_claims():
    claims = decode_token(create_token(7, "someone", "editor", 3))
    assert claims and claims["sub"] == "7" and claims["username"] == "someone" and claims["tv"] == 3


@pytest.mark.parametrize("make", [
    lambda: "not-a-token",
    lambda: "",
    lambda: "undefined",
    lambda: jwt.encode({"sub": "1", "exp": datetime.now(timezone.utc) - timedelta(minutes=5)}, settings.SECRET_KEY, algorithm=settings.ALGORITHM),   # expired
    lambda: jwt.encode({"sub": "1", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, "a-different-signing-key-entirely-0123456789", algorithm=settings.ALGORITHM),  # wrong key
    lambda: create_token(1, "u", "editor", 0)[:-3] + "AAA",                                                                                          # tampered signature
    lambda: '"' + create_token(1, "u", "editor", 0) + '"',                                                                                        # wrapped in quotes
])
def test_everything_that_is_not_a_genuine_token_is_refused(make):
    assert decode_token(make()) is None


def test_a_rejection_logs_the_class_but_never_secrets(caplog):
    t = create_token(1, "u", "editor", 0)
    with caplog.at_level(logging.WARNING, logger="app.services.auth"):
        assert decode_token(f'"{t}"') is None
        expired = jwt.encode({"sub": "1", "exp": datetime.now(timezone.utc) - timedelta(minutes=5)}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
        assert decode_token(expired) is None
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "JWT verification rejected token: JWTError" in text                                           # a malformed credential ...
    assert "ExpiredSignatureError" in text                                                              # ... is told apart from an expired one
    for secret in (settings.SECRET_KEY, t, t.split(".")[1], t.split(".")[2], expired.split(".")[1]):
        assert secret not in text


# ── the whole flow through the real app (needs a local database) ────────────────────────────────────────────────

def sql(query: str, *args, fetch: bool = False):
    async def go():
        conn = await asyncpg.connect(settings.DATABASE_URL.replace("+asyncpg", ""))
        try:
            return await (conn.fetch(query, *args) if fetch else conn.execute(query, *args))
        finally:
            await conn.close()
    return asyncio.run(go())


def make_user(password: str = PW) -> dict:
    tag = secrets.token_hex(4)
    username, email = f"jwt_{tag}", f"jwt_{tag}@example.test"
    rows = sql("INSERT INTO users (username, email, hashed_password, role, is_active, email_verified_at) VALUES ($1, $2, $3, 'editor', true, $4) RETURNING id",
               username, email, hash_password(password), datetime.now(timezone.utc), fetch=True)
    return {"id": rows[0]["id"], "username": username, "email": email, "password": password}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:                         # the real startup: create_all + additive patches + seeding
        yield c
        c.portal.call(engine.dispose)
    sql("DELETE FROM users WHERE username LIKE 'jwt\\_%'")


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    limiter.reset()


def login(client, user) -> str:
    r = client.post("/auth/login", json={"username": user["username"], "password": user["password"]})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@needs_local_db
def test_a_freshly_issued_login_token_authenticates_auth_me(client):
    u = make_user()
    r = client.post("/auth/login", json={"username": u["username"], "password": u["password"]})
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer" and body["username"] == u["username"] and body["user_id"] == u["id"]
    me = client.get("/auth/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200, me.text
    assert me.json() == {"id": u["id"], "username": u["username"], "email": u["email"], "role": "editor"}


@needs_local_db
def test_every_new_login_token_works_and_the_scheme_is_case_insensitive(client):
    u = make_user()
    first, second = login(client, u), login(client, u)
    for t in (first, second):
        assert client.get("/auth/me", headers=bearer(t)).status_code == 200
    assert client.get("/auth/me", headers={"Authorization": f"bearer {second}"}).status_code == 200


@needs_local_db
@pytest.mark.parametrize("name,make", [
    ("garbage", lambda real: "not-a-token"),
    ("placeholder text", lambda real: "undefined"),
    ("tampered signature", lambda real: real[:-3] + "AAA"),
    ("signed with another key", lambda real: jwt.encode({"sub": "1", "tv": 0, "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, "another-signing-key-entirely-0123456789", algorithm="HS256")),
    ("expired", lambda real: jwt.encode({"sub": "1", "tv": 0, "exp": datetime.now(timezone.utc) - timedelta(minutes=5)}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)),
    ("wrapped in double quotes", lambda real: f'"{real}"'),
    ("wrapped in single quotes", lambda real: f"'{real}'"),
])
def test_invalid_expired_and_malformed_credentials_are_still_401(client, name, make):
    real = login(client, make_user())
    r = client.get("/auth/me", headers=bearer(make(real)))
    assert r.status_code == 401, (name, r.status_code)
    assert r.json()["detail"] == "Invalid or expired token"


@needs_local_db
def test_a_doubled_bearer_prefix_and_a_missing_header_are_refused(client):
    real = login(client, make_user())
    assert client.get("/auth/me", headers={"Authorization": f"Bearer Bearer {real}"}).status_code == 401
    assert client.get("/auth/me").status_code in (401, 403)                                   # no credentials at all


@needs_local_db
def test_a_rejected_request_logs_the_class_without_leaking_anything(client, caplog):
    u = make_user()
    real = login(client, u)
    with caplog.at_level(logging.WARNING):
        assert client.get("/auth/me", headers=bearer(f'"{real}"')).status_code == 401
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "JWT verification rejected token: JWTError" in text
    for secret in (real, real.split(".")[1], real.split(".")[2], settings.SECRET_KEY, u["password"]):
        assert secret not in text


@needs_local_db
def test_a_valid_token_for_a_disabled_or_reset_account_is_still_refused(client):
    """The pre-existing checks around the signature are untouched: a good signature is necessary but not sufficient."""
    u = make_user()
    real = login(client, u)
    sql("UPDATE users SET token_version = token_version + 1 WHERE id = $1", u["id"])
    assert client.get("/auth/me", headers=bearer(real)).status_code == 401                   # password reset elsewhere bumped the version
    fresh = login(client, u)
    assert client.get("/auth/me", headers=bearer(fresh)).status_code == 200
    sql("UPDATE users SET is_active = false WHERE id = $1", u["id"])
    assert client.get("/auth/me", headers=bearer(fresh)).status_code == 401
