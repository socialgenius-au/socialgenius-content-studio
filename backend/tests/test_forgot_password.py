"""Forgot Password + email verification (app/routers/auth_recovery.py and its services).

Runs the real app (real routes, real Postgres, real rate limiter) with the Resend call replaced by a recorder, so no email is ever sent.
Refuses to run against any database that is not on this machine: it creates and deletes its own `fp_*` users.
"""
import asyncio
import hashlib
import inspect
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

import asyncpg
import httpx
import pytest
from fastapi.testclient import TestClient
from jose import jwt
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.database import engine
from app.limiter import limiter
from app.main import app
from app.routers import auth_recovery
from app.services import auth_mail, auth_tokens
from app.services import email as email_svc
from app.services.auth import create_token, hash_password, verify_password
from app.services.password_policy import validate_new_password

pytestmark = pytest.mark.skipif(
    not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")),
    reason="forgot-password tests create/delete users: they only run against a database on this machine",
)

PW = "correct-horse-battery"
NEW_PW = "A-brand-new-Passphrase-77"
FE = "https://fe.example.test"


# ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def sql(query: str, *args, fetch: bool = False):
    async def go():
        conn = await asyncpg.connect(settings.DATABASE_URL.replace("+asyncpg", ""))
        try:
            return await (conn.fetch(query, *args) if fetch else conn.execute(query, *args))
        finally:
            await conn.close()
    return asyncio.run(go())


def make_user(*, verified=True, active=True, password=PW) -> dict:
    tag = secrets.token_hex(4)
    username, email = f"fp_{tag}", f"fp_{tag}@example.test"
    rows = sql(
        "INSERT INTO users (username, email, hashed_password, role, is_active, email_verified_at) "
        "VALUES ($1, $2, $3, 'editor', $4, $5) RETURNING id",
        username, email, hash_password(password), active, datetime.now(timezone.utc) if verified else None, fetch=True,
    )
    return {"id": rows[0]["id"], "username": username, "email": email, "password": password}


def tokens_for(user_id: int, purpose: str | None = None):
    q, args = "SELECT * FROM auth_tokens WHERE user_id = $1", [user_id]
    if purpose:
        q, args = q + " AND purpose = $2", args + [purpose]
    return sql(q + " ORDER BY id", *args, fetch=True)


def user_row(user_id: int):
    return sql("SELECT * FROM users WHERE id = $1", user_id, fetch=True)[0]


def token_from(text: str) -> str:
    m = re.search(r"#token=([A-Za-z0-9_-]+)", text)
    assert m, "no token link in email"
    return m.group(1)


def jwt_for(user: dict, *, tv: int | None = 0) -> str:
    claims = {"sub": str(user["id"]), "username": user["username"], "role": "editor", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    if tv is not None:
        claims["tv"] = tv
    return jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:                         # runs the real startup: create_all + additive patches + seeding
        yield c
        c.portal.call(engine.dispose)                  # leave no pooled connection bound to this module's event loop
    sql("DELETE FROM users WHERE username LIKE 'fp\\_%'")


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    limiter.reset()
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_test_not_a_real_key")
    monkeypatch.setattr(settings, "FRONTEND_BASE_URL", FE)
    monkeypatch.setattr(settings, "AUTH_FROM_EMAIL", "Test <noreply@example.test>")
    monkeypatch.setattr(email_svc, "_AUTH_RETRY_DELAY_SECONDS", 0)


@pytest.fixture
def outbox(monkeypatch):
    sent: list[dict] = []

    async def fake(to_email, subject, html, text):
        sent.append({"to": to_email, "subject": subject, "html": html, "text": text})
        return True
    monkeypatch.setattr(email_svc, "send_auth_email", fake)
    return sent


def request_reset(client, identifier):
    return client.post("/auth/password-reset/request", json={"identifier": identifier})


def reset_token(client, outbox, user) -> str:
    n = len(outbox)
    assert request_reset(client, user["username"]).status_code == 202
    assert len(outbox) == n + 1
    return token_from(outbox[-1]["text"])


# ── request: who gets an email, and what the caller can learn ────────────────────────────────────────────────────────────────────

def test_request_by_username_emails_the_verified_address_with_a_fragment_link(client, outbox):
    u = make_user()
    r = request_reset(client, u["username"])
    assert r.status_code == 202 and "reset link is on its way" in r.json()["message"]
    assert [m["to"] for m in outbox] == [u["email"]]
    assert re.search(rf"{re.escape(FE)}/reset-password#token=[A-Za-z0-9_-]{{40,}}", outbox[0]["text"])
    assert "?token=" not in outbox[0]["text"] and "?token=" not in outbox[0]["html"]          # never a query string (it would reach access logs)


def test_request_by_email_is_case_insensitive(client, outbox):
    u = make_user()
    assert request_reset(client, u["email"].upper()).status_code == 202
    assert [m["to"] for m in outbox] == [u["email"]]


def test_token_is_stored_only_as_a_hash_and_expires_in_30_minutes(client, outbox):
    u = make_user()
    raw = reset_token(client, outbox, u)
    (row,) = tokens_for(u["id"], "password_reset")
    assert row["token_hash"] == hashlib.sha256(raw.encode()).hexdigest() and raw not in str(dict(row))
    assert row["expires_at"] - row["created_at"] == timedelta(minutes=30) and row["used_at"] is None
    assert row["email"] == u["email"]


def test_no_account_enumeration_every_case_returns_the_identical_response(client, outbox):
    known = make_user()
    unverified, inactive = make_user(verified=False), make_user(active=False)
    capped = make_user()
    for _ in range(3):                                                   # exhaust the per-account hourly cap
        sql("INSERT INTO auth_tokens (user_id, purpose, token_hash, email, expires_at) VALUES ($1,'password_reset',$2,$3, now()+interval '1 hour')",
            capped["id"], secrets.token_hex(32), capped["email"])
    responses = []
    for ident in (known["username"], unverified["username"], inactive["username"], capped["username"], "no_such_user_zz", "ghost@example.test"):
        limiter.reset()
        r = request_reset(client, ident)
        responses.append((r.status_code, r.json()))
    assert len({str(x) for x in responses}) == 1 and responses[0][0] == 202
    assert [m["to"] for m in outbox] == [known["email"]]                 # only the one eligible account was actually emailed


def test_request_handler_does_no_database_work_before_answering():
    assert "db" not in inspect.signature(auth_recovery.request_password_reset).parameters


def test_unverified_email_never_receives_a_reset_link(client, outbox):
    u = make_user(verified=False)
    assert request_reset(client, u["username"]).status_code == 202
    assert outbox == [] and tokens_for(u["id"]) == []


def test_nothing_is_sent_while_the_frontend_url_is_unconfigured(client, outbox, monkeypatch):
    u = make_user()
    monkeypatch.setattr(settings, "FRONTEND_BASE_URL", "")
    assert request_reset(client, u["username"]).status_code == 202
    assert outbox == [] and tokens_for(u["id"]) == []


def test_per_ip_rate_limit_on_requests(client, outbox):
    u = make_user()
    codes = [request_reset(client, u["username"]).status_code for _ in range(6)]
    assert codes[:5] == [202] * 5 and codes[5] == 429


def test_per_account_cap_and_superseding_of_older_links(client, outbox):
    u = make_user()
    first = reset_token(client, outbox, u)
    second = reset_token(client, outbox, u)
    assert client.post("/auth/password-reset/validate", json={"token": first}).json() == {"valid": False}       # superseded
    assert client.post("/auth/password-reset/validate", json={"token": second}).json() == {"valid": True}
    third = reset_token(client, outbox, u)
    request_reset(client, u["username"])                                  # 4th request this hour: silently capped
    assert len(outbox) == 3 and len(tokens_for(u["id"], "password_reset")) == 3 and third


# ── confirm: success, one-time use, expiry, validation ───────────────────────────────────────────────────────────────────────────

def test_confirm_sets_the_password_signs_out_everyone_and_notifies(client, outbox):
    u = make_user()
    old_login = client.post("/auth/login", json={"username": u["username"], "password": PW}).json()["access_token"]
    assert client.get("/auth/me", headers=bearer(old_login)).status_code == 200
    token = reset_token(client, outbox, u)
    r = client.post("/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PW})
    assert r.status_code == 200 and "updated" in r.json()["message"]

    row = user_row(u["id"])
    assert verify_password(NEW_PW, row["hashed_password"]) and not verify_password(PW, row["hashed_password"])
    assert row["token_version"] == 1
    assert client.get("/auth/me", headers=bearer(old_login)).status_code == 401                 # the old session is dead
    assert client.post("/auth/login", json={"username": u["username"], "password": PW}).status_code == 401
    new_login = client.post("/auth/login", json={"username": u["username"], "password": NEW_PW})
    assert new_login.status_code == 200
    assert jwt.decode(new_login.json()["access_token"], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])["tv"] == 1
    assert client.get("/auth/me", headers=bearer(new_login.json()["access_token"])).status_code == 200
    assert [m["subject"] for m in outbox][-1] == "Your SocialGenius password was changed" and outbox[-1]["to"] == u["email"]
    assert NEW_PW not in outbox[-1]["text"] + outbox[-1]["html"]
    assert all(t["used_at"] is not None for t in tokens_for(u["id"], "password_reset"))


def test_a_reset_link_works_exactly_once(client, outbox):
    u = make_user()
    token = reset_token(client, outbox, u)
    assert client.post("/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PW}).status_code == 200
    again = client.post("/auth/password-reset/confirm", json={"token": token, "new_password": "Another-Passphrase-99"})
    assert again.status_code == 400 and again.json()["detail"]["code"] == "invalid_token"
    assert verify_password(NEW_PW, user_row(u["id"])["hashed_password"])


def test_concurrent_use_of_one_link_has_exactly_one_winner(client, outbox):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool
    u = make_user()
    raw = reset_token(client, outbox, u)

    async def race():
        eng = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
        maker = async_sessionmaker(eng, expire_on_commit=False)

        async def attempt():
            async with maker() as s:
                got = await auth_tokens.consume_token(s, raw, auth_tokens.PURPOSE_RESET)
                await s.commit()
                return got
        try:
            return await asyncio.gather(*[attempt() for _ in range(8)])
        finally:
            await eng.dispose()

    results = asyncio.run(race())
    assert len([r for r in results if r is not None]) == 1


def test_expired_link_is_rejected(client, outbox):
    u = make_user()
    token = reset_token(client, outbox, u)
    sql("UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1", u["id"])
    assert client.post("/auth/password-reset/validate", json={"token": token}).json() == {"valid": False}
    r = client.post("/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PW})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid_token"
    assert verify_password(PW, user_row(u["id"])["hashed_password"])


@pytest.mark.parametrize("bad", ["", "x", "not-a-real-token", "a" * 43, "../../etc/passwd", "a b c d e f g h i j k l m n o p q"])
def test_garbage_tokens_are_rejected_with_400(client, bad):
    r = client.post("/auth/password-reset/confirm", json={"token": bad or " ", "new_password": NEW_PW})
    assert r.status_code in (400, 422) and r.status_code != 401


@pytest.mark.parametrize("weak,reason", [
    ("short-pw-1", "at least 12"),
    ("x" * 73, "at most 72"),
    (" leading-space-pw-123", "start or end"),
    ("trailing-space-pw-123 ", "start or end"),
])
def test_weak_passwords_are_refused_and_do_not_use_up_the_link(client, outbox, weak, reason):
    u = make_user()
    token = reset_token(client, outbox, u)
    r = client.post("/auth/password-reset/confirm", json={"token": token, "new_password": weak})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "weak_password" and reason in " ".join(r.json()["detail"]["errors"])
    assert verify_password(PW, user_row(u["id"])["hashed_password"]) and user_row(u["id"])["token_version"] == 0
    assert client.post("/auth/password-reset/validate", json={"token": token}).json() == {"valid": True}      # still usable
    assert client.post("/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PW}).status_code == 200


def test_password_equal_to_username_or_email_is_refused(client, outbox):
    u = make_user()
    token = reset_token(client, outbox, u)
    r = client.post("/auth/password-reset/confirm", json={"token": token, "new_password": u["email"]})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "weak_password"


def test_link_dies_if_the_account_email_changes_or_the_account_is_disabled(client, outbox):
    a, b = make_user(), make_user()
    ta, tb = reset_token(client, outbox, a), reset_token(client, outbox, b)
    sql("UPDATE users SET email = $1 WHERE id = $2", f"changed_{a['email']}", a["id"])
    sql("UPDATE users SET is_active = false WHERE id = $1", b["id"])
    for t in (ta, tb):
        assert client.post("/auth/password-reset/validate", json={"token": t}).json() == {"valid": False}
        assert client.post("/auth/password-reset/confirm", json={"token": t, "new_password": NEW_PW}).status_code == 400
    assert verify_password(PW, user_row(a["id"])["hashed_password"]) and verify_password(PW, user_row(b["id"])["hashed_password"])


def test_confirm_endpoint_rate_limit(client):
    codes = [client.post("/auth/password-reset/confirm", json={"token": "a" * 43, "new_password": NEW_PW}).status_code for _ in range(11)]
    assert codes[:10] == [400] * 10 and codes[10] == 429


def test_no_reset_endpoint_ever_answers_401(client, outbox):
    """The frontend's axios interceptor turns every 401 into 'session expired' + a hard redirect to /login."""
    u = make_user()
    seen = {
        request_reset(client, "ghost").status_code,
        client.post("/auth/password-reset/validate", json={"token": "a" * 43}).status_code,
        client.post("/auth/password-reset/confirm", json={"token": "a" * 43, "new_password": NEW_PW}).status_code,
        client.post("/auth/email/verification/confirm", json={"token": "a" * 43}).status_code,
        request_reset(client, u["username"]).status_code,
    }
    assert 401 not in seen


# ── sessions: HTTP and WebSocket ─────────────────────────────────────────────────────────────────────────────────────────────

def _job_for(user_id: int) -> int:
    return sql("INSERT INTO jobs (user_id, title, prompt, status) VALUES ($1, 'fp job', 'fp prompt', 'pending') RETURNING id", user_id, fetch=True)[0]["id"]


def test_tokens_issued_before_this_feature_still_work_until_the_first_reset(client, outbox):
    u = make_user()
    legacy = jwt_for(u, tv=None)                                           # no `tv` claim at all, like every token issued before deploy
    assert client.get("/auth/me", headers=bearer(legacy)).status_code == 200
    token = reset_token(client, outbox, u)
    client.post("/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PW})
    assert client.get("/auth/me", headers=bearer(legacy)).status_code == 401


def test_websocket_connections_with_an_old_token_are_refused_after_a_reset(client, outbox):
    u = make_user()
    job_id = _job_for(u["id"])
    old = jwt_for(u, tv=0)
    with client.websocket_connect(f"/ws/jobs/{job_id}?token={old}") as ws:             # before the reset: allowed
        assert ws.receive_json()["type"] == "init"
    token = reset_token(client, outbox, u)
    assert client.post("/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PW}).status_code == 200
    with pytest.raises(WebSocketDisconnect) as refused:
        with client.websocket_connect(f"/ws/jobs/{job_id}?token={old}"):
            pass
    assert refused.value.code == 4001
    fresh = create_token(u["id"], u["username"], "editor", 1)
    with client.websocket_connect(f"/ws/jobs/{job_id}?token={fresh}") as ws:           # the new session works
        assert ws.receive_json()["type"] == "init"


def test_websocket_refuses_a_disabled_account(client):
    u = make_user()
    job_id = _job_for(u["id"])
    sql("UPDATE users SET is_active = false WHERE id = $1", u["id"])
    with pytest.raises(WebSocketDisconnect) as refused:
        with client.websocket_connect(f"/ws/jobs/{job_id}?token={jwt_for(u)}"):
            pass
    assert refused.value.code == 4001


def test_login_tokens_carry_the_current_token_version(client):
    u = make_user()
    sql("UPDATE users SET token_version = 4 WHERE id = $1", u["id"])
    tok = client.post("/auth/login", json={"username": u["username"], "password": PW}).json()["access_token"]
    assert jwt.decode(tok, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])["tv"] == 4


# ── email ownership verification ─────────────────────────────────────────────────────────────────────────────────────────────

def test_verification_requires_a_signed_in_user(client, outbox):
    assert client.post("/auth/email/verification/request").status_code in (401, 403)
    assert outbox == []


def test_verification_flow_marks_the_address_verified_and_unlocks_resets(client, outbox):
    u = make_user(verified=False)
    assert request_reset(client, u["username"]).status_code == 202 and outbox == []          # not yet: address unproven
    r = client.post("/auth/email/verification/request", headers=bearer(jwt_for(u)))
    assert r.status_code == 202 and r.json()["verified"] is False
    assert [m["to"] for m in outbox] == [u["email"]] and "verify-email#token=" in outbox[0]["text"]
    token = token_from(outbox[0]["text"])
    (row,) = tokens_for(u["id"], "email_verify")
    assert row["expires_at"] - row["created_at"] == timedelta(hours=24)

    done = client.post("/auth/email/verification/confirm", json={"token": token})
    assert done.status_code == 200 and done.json()["verified"] is True and user_row(u["id"])["email_verified_at"] is not None
    assert client.post("/auth/email/verification/confirm", json={"token": token}).status_code == 400          # one-time

    outbox.clear()
    assert request_reset(client, u["username"]).status_code == 202
    assert [m["subject"] for m in outbox] == ["Reset your SocialGenius password"]                                 # now it is sent


def test_verification_request_when_already_verified_sends_nothing(client, outbox):
    u = make_user(verified=True)
    r = client.post("/auth/email/verification/request", headers=bearer(jwt_for(u)))
    assert r.status_code == 200 and r.json()["verified"] is True and outbox == []


def test_verification_link_is_void_if_the_address_changed_or_it_expired(client, outbox):
    a, b = make_user(verified=False), make_user(verified=False)
    for u in (a, b):
        client.post("/auth/email/verification/request", headers=bearer(jwt_for(u)))
    ta, tb = token_from(outbox[0]["text"]), token_from(outbox[1]["text"])
    sql("UPDATE users SET email = $1 WHERE id = $2", f"other_{a['email']}", a["id"])              # token was for the OLD address
    sql("UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1", b["id"])
    assert client.post("/auth/email/verification/confirm", json={"token": ta}).status_code == 400
    assert client.post("/auth/email/verification/confirm", json={"token": tb}).status_code == 400
    assert user_row(a["id"])["email_verified_at"] is None and user_row(b["id"])["email_verified_at"] is None


def test_a_verification_token_cannot_reset_a_password_and_vice_versa(client, outbox):
    u = make_user(verified=False)
    client.post("/auth/email/verification/request", headers=bearer(jwt_for(u)))
    vtoken = token_from(outbox[0]["text"])
    assert client.post("/auth/password-reset/confirm", json={"token": vtoken, "new_password": NEW_PW}).status_code == 400
    sql("UPDATE users SET email_verified_at = now() WHERE id = $1", u["id"])
    rtoken = reset_token(client, outbox, u)
    assert client.post("/auth/email/verification/confirm", json={"token": rtoken}).status_code == 400


# ── recovery for an expired / used verification link ────────────────────────────────────────────────────────────────────────────

def _verification_token(client, outbox, user) -> str:
    n = len(outbox)
    assert client.post("/auth/email/verification/request", headers=bearer(jwt_for(user))).status_code == 202
    assert len(outbox) == n + 1
    return token_from(outbox[-1]["text"])


def resend(client, token):
    return client.post("/auth/email/verification/resend", json={"token": token})


def test_an_expired_verification_link_can_request_a_new_one_without_signing_in(client, outbox):
    u = make_user(verified=False)
    old = _verification_token(client, outbox, u)
    sql("UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1", u["id"])
    assert client.post("/auth/email/verification/confirm", json={"token": old}).status_code == 400          # the old link is dead
    r = resend(client, old)                                                                                    # no Authorization header
    assert r.status_code == 202 and r.json()["message"].startswith("If that link was valid")
    assert [m["to"] for m in outbox[1:]] == [u["email"]] and "verify-email#token=" in outbox[-1]["text"]      # to the address ON FILE
    fresh = token_from(outbox[-1]["text"])
    assert fresh != old and client.post("/auth/email/verification/confirm", json={"token": fresh}).status_code == 200
    assert user_row(u["id"])["email_verified_at"] is not None


def test_resend_replies_identically_and_sends_nothing_for_any_ineligible_link(client, outbox):
    eligible = make_user(verified=False)
    good_old = _verification_token(client, outbox, eligible)
    sql("UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1", eligible["id"])

    already = make_user(verified=False)                                    # a link that WAS used: the account is verified now
    used = _verification_token(client, outbox, already)
    assert client.post("/auth/email/verification/confirm", json={"token": used}).status_code == 200

    moved = make_user(verified=False)                                      # address changed after the link was sent
    moved_tok = _verification_token(client, outbox, moved)
    sql("UPDATE users SET email = $1 WHERE id = $2", f"new_{moved['email']}", moved["id"])

    disabled = make_user(verified=False)
    disabled_tok = _verification_token(client, outbox, disabled)
    sql("UPDATE users SET is_active = false WHERE id = $1", disabled["id"])

    stale = make_user(verified=False)                                      # link issued more than 30 days ago
    stale_tok = _verification_token(client, outbox, stale)
    sql("UPDATE auth_tokens SET created_at = now() - interval '31 days' WHERE user_id = $1", stale["id"])

    reset_owner = make_user(verified=True)                                 # a PASSWORD-RESET token must not work here
    reset_tok = reset_token(client, outbox, reset_owner)

    baseline = len(outbox)
    answers = []
    for tok in (good_old, used, moved_tok, disabled_tok, stale_tok, reset_tok, "a" * 43, "not-a-token", secrets.token_urlsafe(32)):
        limiter.reset()
        r = resend(client, tok)
        answers.append((r.status_code, r.json()))
    assert len({str(a) for a in answers}) == 1 and answers[0][0] == 202
    assert [m["to"] for m in outbox[baseline:]] == [eligible["email"]]     # exactly one email: the eligible account


def test_resend_is_capped_per_account_and_rate_limited_per_ip(client, outbox):
    u = make_user(verified=False)
    tok = _verification_token(client, outbox, u)                          # 1st link this hour
    sql("UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1", u["id"])
    n = len(outbox)
    for _ in range(4):
        assert resend(client, tok).status_code == 202
    assert len(outbox) - n == 2                                           # links 2 and 3 only: the account cap is 3 per hour
    assert resend(client, tok).status_code == 202                         # the 5th call this hour is still allowed
    assert resend(client, tok).status_code == 429                         # the 6th from this IP is refused


def test_resend_never_answers_401(client):
    assert resend(client, "a" * 43).status_code != 401 and resend(client, "x").status_code != 401


# ── verification links: opening / checking a link must never use it up (link previews, scanners) ───────────────────────────────

def validate_verification(client, token):
    return client.post("/auth/email/verification/validate", json={"token": token})


def test_validate_reports_a_usable_link_without_consuming_or_verifying_anything(client, outbox):
    u = make_user(verified=False)
    token = _verification_token(client, outbox, u)
    for _ in range(5):                                                                  # a scanner may check as often as it likes
        r = validate_verification(client, token)
        assert r.status_code == 200 and r.json() == {"valid": True}
    row = tokens_for(u["id"], "email_verify")[0]
    assert row["used_at"] is None                                                       # still unused
    assert user_row(u["id"])["email_verified_at"] is None                              # and nobody was verified by looking
    assert client.post("/auth/email/verification/confirm", json={"token": token}).status_code == 200      # the deliberate confirm still works, once
    assert client.post("/auth/email/verification/confirm", json={"token": token}).status_code == 400
    assert user_row(u["id"])["email_verified_at"] is not None


def test_validate_says_false_for_every_kind_of_dead_link_with_the_identical_reply(client, outbox):
    expired_user, used_user, moved_user, disabled_user = (make_user(verified=False) for _ in range(4))
    expired = _verification_token(client, outbox, expired_user)
    sql("UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1", expired_user["id"])
    used = _verification_token(client, outbox, used_user)
    assert client.post("/auth/email/verification/confirm", json={"token": used}).status_code == 200
    moved = _verification_token(client, outbox, moved_user)
    sql("UPDATE users SET email = $1 WHERE id = $2", f"new_{moved_user['email']}", moved_user["id"])
    disabled = _verification_token(client, outbox, disabled_user)
    sql("UPDATE users SET is_active = false WHERE id = $1", disabled_user["id"])
    reset_owner = make_user(verified=True)
    wrong_purpose = reset_token(client, outbox, reset_owner)                            # a password-reset token is not a verification token
    answers = []
    for tok in (expired, used, moved, disabled, wrong_purpose, "a" * 43, "not-a-token", secrets.token_urlsafe(32)):
        limiter.reset()
        r = validate_verification(client, tok)
        answers.append((r.status_code, r.json()))
    assert set(map(str, answers)) == {str((200, {"valid": False}))}


def test_validate_leaves_the_reset_link_and_the_reset_flow_untouched(client, outbox):
    u = make_user()
    reset = reset_token(client, outbox, u)
    assert validate_verification(client, reset).json() == {"valid": False}            # not a verification token
    assert client.post("/auth/password-reset/validate", json={"token": reset}).json() == {"valid": True}
    assert tokens_for(u["id"], "password_reset")[0]["used_at"] is None


def test_validate_is_rate_limited_and_never_401(client):
    codes = [validate_verification(client, "a" * 43).status_code for _ in range(21)]
    assert codes[:20] == [200] * 20 and codes[20] == 429


def test_only_post_can_touch_a_verification_link__no_get_consumes_anything(client, outbox):
    u = make_user(verified=False)
    token = _verification_token(client, outbox, u)
    for path in ("/auth/email/verification/validate", "/auth/email/verification/confirm", "/auth/email/verification/resend", "/auth/email/verification/request"):
        assert client.get(path, params={"token": token}).status_code == 405
    for path in ("/auth/email/verification/validate", "/auth/email/verification/confirm", "/auth/email/verification/resend"):
        assert client.get(f"{path}?token={token}").status_code == 405
    assert tokens_for(u["id"], "email_verify")[0]["used_at"] is None
    assert user_row(u["id"])["email_verified_at"] is None


# ── logging hygiene ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_logs_never_contain_tokens_passwords_links_or_email_addresses(client, outbox, caplog):
    caplog.set_level(logging.DEBUG)
    u = make_user()
    token = reset_token(client, outbox, u)
    client.post("/auth/password-reset/confirm", json={"token": token, "new_password": "weak"})
    client.post("/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PW})
    request_reset(client, "ghost@example.test")
    text = caplog.text
    for secret in (token, NEW_PW, "weak", u["email"], f"reset-password#token", "ghost@example.test", hashlib.sha256(token.encode()).hexdigest()):
        assert secret not in text, secret


# ── email sender: strict failure handling (Resend replaced by an in-process transport) ─────────────────────────────────────────

def _mock_resend(monkeypatch, handler):
    calls: list[httpx.Request] = []

    def wrapped(request):
        calls.append(request)
        return handler(request, len(calls))
    monkeypatch.setattr(email_svc, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(wrapped)))
    return calls


def test_send_auth_email_success_payload(monkeypatch):
    calls = _mock_resend(monkeypatch, lambda req, n: httpx.Response(200, json={"id": "x"}))
    assert asyncio.run(email_svc.send_auth_email("to@example.test", "Subject", "<p>h</p>", "t")) is True
    body = __import__("json").loads(calls[0].content)
    assert calls[0].url.host == "api.resend.com" and calls[0].headers["authorization"] == "Bearer re_test_not_a_real_key"
    assert body == {"from": "Test <noreply@example.test>", "to": ["to@example.test"], "subject": "Subject", "html": "<p>h</p>", "text": "t"}


def test_send_auth_email_falls_back_to_the_notification_sender(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_FROM_EMAIL", "")
    calls = _mock_resend(monkeypatch, lambda req, n: httpx.Response(200))
    asyncio.run(email_svc.send_auth_email("to@example.test", "s", "h", "t"))
    assert __import__("json").loads(calls[0].content)["from"] == settings.NOTIFY_FROM_EMAIL


def test_send_auth_email_client_error_is_not_retried(monkeypatch, caplog):
    calls = _mock_resend(monkeypatch, lambda req, n: httpx.Response(422, json={"message": "to@example.test is not allowed"}))
    caplog.set_level(logging.DEBUG)
    assert asyncio.run(email_svc.send_auth_email("to@example.test", "s", "h", "t")) is False
    assert len(calls) == 1 and "to@example.test" not in caplog.text and "re_test_not_a_real_key" not in caplog.text


def test_send_auth_email_retries_once_on_server_error_then_succeeds(monkeypatch):
    calls = _mock_resend(monkeypatch, lambda req, n: httpx.Response(503) if n == 1 else httpx.Response(200))
    assert asyncio.run(email_svc.send_auth_email("to@example.test", "s", "h", "t")) is True and len(calls) == 2


def test_send_auth_email_gives_up_after_two_network_failures(monkeypatch):
    def boom(req, n):
        raise httpx.ConnectTimeout("simulated")
    calls = _mock_resend(monkeypatch, boom)
    assert asyncio.run(email_svc.send_auth_email("to@example.test", "s", "h", "t")) is False and len(calls) == 2


def test_send_auth_email_without_an_api_key_makes_no_request(monkeypatch):
    monkeypatch.setattr(settings, "RESEND_API_KEY", "")
    calls = _mock_resend(monkeypatch, lambda req, n: httpx.Response(200))
    assert asyncio.run(email_svc.send_auth_email("to@example.test", "s", "h", "t")) is False and calls == []


def test_a_failed_email_does_not_change_the_response_or_break_the_request(client, monkeypatch):
    async def failing(*a, **k):
        return False
    monkeypatch.setattr(email_svc, "send_auth_email", failing)
    u = make_user()
    r = request_reset(client, u["username"])
    assert r.status_code == 202 and r.json()["message"].startswith("If an account matches")


def test_email_templates_escape_user_controlled_text(monkeypatch):
    captured = {}

    async def grab(to, subject, html, text):
        captured["html"] = html
        return True
    monkeypatch.setattr(email_svc, "send_auth_email", grab)
    asyncio.run(auth_mail.send_password_reset("to@example.test", "<script>alert(1)</script>", f"{FE}/reset-password#token=abc", 30))
    assert "<script>" not in captured["html"] and "&lt;script&gt;" in captured["html"]


# ── services: policy, tokens, links, schema patch ────────────────────────────────────────────────────────────────────────────

def test_password_policy_rules():
    assert validate_new_password("A-brand-new-Passphrase-77", "bob", "bob@x.test") == []
    assert validate_new_password("a" * 12) == [] and validate_new_password("a" * 72) == [] and validate_new_password("é" * 36) == []     # 72 bytes exactly
    assert validate_new_password("é" * 37)                                                                                                  # 74 bytes
    assert validate_new_password("a" * 11) and validate_new_password("a" * 73)
    assert validate_new_password("has-nul-\x00-char-1")
    assert validate_new_password("bobsmith12345", "BobSmith12345", "x@y.test")
    assert validate_new_password("alice.longname@x.test", "alice", "alice.longname@x.test")


def test_build_link_uses_only_the_configured_origin(monkeypatch):
    assert auth_tokens.build_link("reset-password", "T") == f"{FE}/reset-password#token=T"
    monkeypatch.setattr(settings, "FRONTEND_BASE_URL", f"{FE}/")
    assert auth_tokens.build_link("/reset-password", "T") == f"{FE}/reset-password#token=T"
    for unset in ("", "   ", "javascript:alert(1)", "ftp://x"):
        monkeypatch.setattr(settings, "FRONTEND_BASE_URL", unset)
        assert auth_tokens.build_link("reset-password", "T") is None


def test_tokens_are_high_entropy_and_unique():
    toks = {auth_tokens.new_token() for _ in range(500)}
    assert len(toks) == 500 and all(len(t) >= 43 for t in toks)


def test_the_two_user_column_patches_are_valid_and_additive_on_a_legacy_users_table():
    from app.schema_patches import _ADDITIVE_PATCHES
    user_patches = [p for p in _ADDITIVE_PATCHES if p.startswith("ALTER TABLE users ")]
    assert len(user_patches) == 2 and all("IF NOT EXISTS" in p for p in user_patches)

    async def go():
        conn = await asyncpg.connect(settings.DATABASE_URL.replace("+asyncpg", ""))
        try:
            await conn.execute("DROP SCHEMA IF EXISTS fp_legacy CASCADE; CREATE SCHEMA fp_legacy; SET search_path TO fp_legacy;")
            await conn.execute("CREATE TABLE users (id serial primary key, username varchar(64), email varchar(255), hashed_password varchar(255), role varchar(32), is_active boolean)")
            await conn.execute("INSERT INTO users (username, email, hashed_password, role, is_active) VALUES ('old', 'old@x.test', 'h', 'editor', true)")
            for _ in range(2):                                                   # idempotent: safe on every startup
                for p in user_patches:
                    await conn.execute(p)
            return await conn.fetchrow("SELECT email_verified_at, token_version FROM users")
        finally:
            await conn.execute("DROP SCHEMA IF EXISTS fp_legacy CASCADE")
            await conn.close()

    row = asyncio.run(go())
    assert row["email_verified_at"] is None and row["token_version"] == 0
