"""scripts/set_recovery_email.py - the separately-approved procedure for changing an account's recovery email. Local database only."""
import argparse
import asyncio
import importlib.util
import secrets
from datetime import datetime, timezone
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.services import email as email_svc
from app.services.auth import hash_password

pytestmark = pytest.mark.skipif(
    not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")),
    reason="creates and deletes users: only runs against a database on this machine",
)

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "set_recovery_email.py"
spec = importlib.util.spec_from_file_location("set_recovery_email", SCRIPT)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


def sql(query, *args, fetch=False):
    async def go():
        conn = await asyncpg.connect(settings.DATABASE_URL.replace("+asyncpg", ""))
        try:
            return await (conn.fetch(query, *args) if fetch else conn.execute(query, *args))
        finally:
            await conn.close()
    return asyncio.run(go())


def make_user(email=None, verified=True):
    tag = secrets.token_hex(4)
    return sql(
        "INSERT INTO users (username, email, hashed_password, role, is_active, email_verified_at) "
        "VALUES ($1,$2,$3,'admin',true,$4) RETURNING id, username, email, hashed_password",
        f"fr_{tag}", email or f"fr_{tag}@old.example.test", hash_password("x" * 14), datetime.now(timezone.utc) if verified else None,
        fetch=True,
    )[0]


def run_tool(username, email, *, apply=False, confirm=None):
    async def go():
        eng = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
        try:
            return await tool.run(argparse.Namespace(username=username, email=email, apply=apply, confirm_username=confirm or ""), async_sessionmaker(eng, expire_on_commit=False))
        finally:
            await eng.dispose()
    return asyncio.run(go())


def snapshot(user_id):
    return dict(sql("SELECT * FROM users WHERE id = $1", user_id, fetch=True)[0])


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_test_not_a_real_key")
    monkeypatch.setattr(settings, "FRONTEND_BASE_URL", "https://fe.example.test")
    sent = []

    async def fake(to, subject, html, text):
        sent.append({"to": to, "subject": subject, "text": text})
        return True
    monkeypatch.setattr(email_svc, "send_auth_email", fake)
    yield sent
    sql("DELETE FROM users WHERE username LIKE 'fr\\_%'")


def test_dry_run_changes_nothing_and_sends_nothing(configured, capsys):
    u = make_user()
    before = snapshot(u["id"])
    assert run_tool(u["username"], "owner@new.example.test") == 0
    assert snapshot(u["id"]) == before and configured == []
    out = capsys.readouterr().out
    assert "DRY RUN" in out and "owner@new.example.test" not in out and "o***@new.example.test" in out


def test_apply_changes_only_the_email_and_verification_and_starts_verification(configured, capsys):
    u, other = make_user(), make_user()
    other_before = snapshot(other["id"])
    before = snapshot(u["id"])
    sql("INSERT INTO auth_tokens (user_id, purpose, token_hash, email, expires_at) VALUES ($1,'password_reset',$2,$3, now()+interval '1 hour')", u["id"], secrets.token_hex(32), u["email"])
    assert run_tool(u["username"], "Owner@New.Example.test", apply=True, confirm=u["username"]) == 0
    after = snapshot(u["id"])
    changed = {k for k in after if after[k] != before[k]}
    assert changed == {"email", "email_verified_at"}
    assert after["email"] == "owner@new.example.test" and after["email_verified_at"] is None
    assert after["hashed_password"] == before["hashed_password"] and after["token_version"] == before["token_version"]
    assert snapshot(other["id"]) == other_before
    old_reset = sql("SELECT used_at FROM auth_tokens WHERE user_id=$1 AND purpose='password_reset'", u["id"], fetch=True)
    assert all(r["used_at"] is not None for r in old_reset)                                       # the link sent to the OLD address is dead
    assert [m["to"] for m in configured] == ["owner@new.example.test"] and "verify-email#token=" in configured[0]["text"]
    out = capsys.readouterr().out
    assert "SENT" in out and "#token=" not in out and "owner@new.example.test" not in out


def test_the_new_address_cannot_receive_a_reset_link_until_verified(configured):
    from fastapi.testclient import TestClient
    from app.database import engine
    from app.limiter import limiter
    from app.main import app
    u = make_user()
    run_tool(u["username"], "owner@new.example.test", apply=True, confirm=u["username"])
    configured.clear()
    limiter.reset()
    with TestClient(app) as c:
        assert c.post("/auth/password-reset/request", json={"identifier": u["username"]}).status_code == 202
        assert configured == []                                                                 # unverified -> no reset link
        c.portal.call(engine.dispose)


def test_confirm_username_must_match(configured):
    u = make_user()
    before = snapshot(u["id"])
    assert run_tool(u["username"], "owner@new.example.test", apply=True, confirm="someone-else") == 2
    assert run_tool(u["username"], "owner@new.example.test", apply=True) == 2
    assert snapshot(u["id"]) == before and configured == []


def test_refuses_an_address_used_by_another_account(configured):
    a, b = make_user(), make_user()
    before = snapshot(a["id"])
    assert run_tool(a["username"], b["email"], apply=True, confirm=a["username"]) == 2
    assert snapshot(a["id"]) == before and configured == []


def test_refuses_unknown_user_and_invalid_address(configured):
    u = make_user()
    before = snapshot(u["id"])
    assert run_tool("fr_does_not_exist", "owner@new.example.test", apply=True, confirm="fr_does_not_exist") == 2
    assert run_tool(u["username"], "not-an-email", apply=True, confirm=u["username"]) == 2
    assert snapshot(u["id"]) == before


@pytest.mark.parametrize("break_what", ["RESEND_API_KEY", "FRONTEND_BASE_URL"])
def test_preflight_aborts_before_writing_anything_when_email_cannot_be_sent(configured, monkeypatch, break_what):
    u = make_user()
    before = snapshot(u["id"])
    monkeypatch.setattr(settings, break_what, "")
    assert run_tool(u["username"], "owner@new.example.test", apply=True, confirm=u["username"]) == 2
    assert snapshot(u["id"]) == before and configured == []


def test_rerun_with_the_same_unverified_address_only_resends(configured):
    u = make_user()
    run_tool(u["username"], "owner@new.example.test", apply=True, confirm=u["username"])
    mid = snapshot(u["id"])
    assert run_tool(u["username"], "owner@new.example.test", apply=True, confirm=u["username"]) == 0
    assert snapshot(u["id"]) == mid and len(configured) == 2


def test_already_set_and_verified_is_a_no_op(configured, capsys):
    u = make_user()
    assert run_tool(u["username"], u["email"], apply=True, confirm=u["username"]) == 0
    assert configured == [] and "Nothing to do" in capsys.readouterr().out


def test_failed_send_is_reported_and_leaves_the_address_unverified(configured, monkeypatch):
    async def failing(*a, **k):
        return False
    monkeypatch.setattr(email_svc, "send_auth_email", failing)
    u = make_user()
    assert run_tool(u["username"], "owner@new.example.test", apply=True, confirm=u["username"]) == 1
    row = snapshot(u["id"])
    assert row["email"] == "owner@new.example.test" and row["email_verified_at"] is None
