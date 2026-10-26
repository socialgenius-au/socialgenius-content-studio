"""CORS origins, seeded users and SECRET_KEY safety (app/startup_security.py). Pure unit tests: no database, no network."""
from pathlib import Path

import pytest

from app import startup_security as ss

ORIGINAL_ORIGINS = [
    "https://content-studio-frontend-production-84fe.up.railway.app",
    "https://frontend-ayubtest-contentstudio-production.up.railway.app",
    "https://socialgenius-video-studio-test.netlify.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
RAILWAY = {"RAILWAY_ENVIRONMENT_NAME": "production"}
GOOD_PW = "correct-horse-battery"


# ── CORS ──────────────────────────────────────────────────────────────────────────────────────

def test_original_origins_are_exactly_preserved_and_unset_env_adds_nothing():
    assert ss.build_allowed_origins(None) == ORIGINAL_ORIGINS
    assert ss.build_allowed_origins("") == ORIGINAL_ORIGINS
    assert ss.build_allowed_origins("  ,  ") == ORIGINAL_ORIGINS


def test_env_origins_are_added_after_the_originals():
    got = ss.build_allowed_origins("https://preview-fe.up.railway.app,https://other.example.com")
    assert got[:5] == ORIGINAL_ORIGINS
    assert got[5:] == ["https://preview-fe.up.railway.app", "https://other.example.com"]


def test_env_origins_accept_whitespace_newlines_trailing_slash_and_case():
    got = ss.build_allowed_origins("https://Preview-FE.up.railway.app/ \n https://b.example.com:8443/path?x=1")
    assert got[5:] == ["https://preview-fe.up.railway.app", "https://b.example.com:8443"]


def test_duplicates_are_removed_and_originals_cannot_be_reordered():
    got = ss.build_allowed_origins("http://localhost:3000, https://x.example.com, https://x.example.com")
    assert got == [*ORIGINAL_ORIGINS, "https://x.example.com"]


@pytest.mark.parametrize("bad", ["*", "https://*.up.railway.app", "preview-fe.up.railway.app", "ftp://x.example.com", "javascript:alert(1)", "https://user:pw@x.example.com", "https://"])
def test_invalid_or_wildcard_origins_fail_fast(bad):
    with pytest.raises(ValueError):
        ss.build_allowed_origins(bad)


def test_main_module_wires_cors_through_the_helper_with_no_inline_origin_list():
    src = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text(encoding="utf-8")
    assert "allow_origins=build_allowed_origins(os.environ.get(CORS_ENV_VAR))" in src
    assert "up.railway.app" not in src and "netlify.app" not in src          # origins live only in startup_security.py
    assert ss.CORS_ENV_VAR == "CORS_ALLOWED_ORIGINS"


# ── seeded users ──────────────────────────────────────────────────────────────────────────────

def test_local_default_is_unchanged_dev_mode():
    plan = ss.plan_seed_users({})
    assert plan.mode == "dev"
    assert plan.passwords == {"ayub": "ayub123", "priya": "priya123", "iqra": "iqra123"}


def test_railway_default_is_env_mode_and_creates_nobody_without_passwords():
    plan = ss.plan_seed_users(RAILWAY)
    assert plan.mode == "env"
    assert plan.passwords == {}
    assert set(plan.skipped) == {"ayub", "priya", "iqra"}


def test_railway_refuses_dev_mode_even_when_asked():
    with pytest.raises(ss.StartupConfigError):
        ss.plan_seed_users({**RAILWAY, "SEED_USERS_MODE": "dev"})


@pytest.mark.parametrize("marker", ["RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"])
def test_any_railway_marker_counts_as_railway(marker):
    assert ss.on_railway({marker: "x"}) is True
    assert ss.on_railway({}) is False


def test_env_mode_uses_only_the_supplied_passwords_never_a_username_derived_one():
    plan = ss.plan_seed_users({
        **RAILWAY,
        "SEED_PASSWORD_AYUB": GOOD_PW,
        "SEED_PASSWORD_PRIYA": "short",          # < 12 chars: rejected
    })
    assert plan.passwords == {"ayub": GOOD_PW}
    assert set(plan.skipped) == {"priya", "iqra"}
    assert "ayub123" not in plan.passwords.values()


def test_env_mode_off_railway_also_never_falls_back():
    plan = ss.plan_seed_users({"SEED_USERS_MODE": "env", "SEED_PASSWORD_IQRA": GOOD_PW})
    assert plan.passwords == {"iqra": GOOD_PW}


def test_off_mode_creates_nobody():
    plan = ss.plan_seed_users({**RAILWAY, "SEED_USERS_MODE": "off", "SEED_PASSWORD_AYUB": GOOD_PW})
    assert plan.mode == "off" and plan.passwords == {}


def test_unknown_mode_is_rejected():
    with pytest.raises(ss.StartupConfigError):
        ss.plan_seed_users({"SEED_USERS_MODE": "yolo"})


def test_passwords_are_never_logged(caplog):
    with caplog.at_level("WARNING"):
        ss.plan_seed_users({**RAILWAY, "SEED_PASSWORD_AYUB": GOOD_PW, "SEED_PASSWORD_PRIYA": "tiny-secret"})
    assert GOOD_PW not in caplog.text and "tiny-secret" not in caplog.text


def test_main_seed_function_has_no_hard_coded_username_derived_password():
    src = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text(encoding="utf-8")
    assert "123" not in src.split("async def _seed_users", 1)[1].split("app = FastAPI", 1)[0]
    assert "plan_seed_users(os.environ)" in src


# ── SECRET_KEY ────────────────────────────────────────────────────────────────────────────────

def test_secret_key_check_is_inert_off_railway():
    ss.check_secret_key(ss.DEFAULT_SECRET_KEY, {})
    ss.check_secret_key("short", {})


def test_railway_rejects_default_and_short_secret_keys():
    for bad in (ss.DEFAULT_SECRET_KEY, "short", "x" * 31, ""):
        with pytest.raises(ss.StartupConfigError):
            ss.check_secret_key(bad, RAILWAY)


def test_railway_accepts_a_long_random_secret_key():
    ss.check_secret_key("k" * 48, RAILWAY)


def test_lifespan_runs_the_secret_key_check_before_touching_the_database():
    src = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text(encoding="utf-8")
    body = src.split("async def lifespan", 1)[1]
    assert body.index("check_secret_key(") < body.index("engine.begin()")
