"""Signed media access: no public fallback, ownership by folder, seeking still works, tokens are not API logins, drafts never store a token.
Local database only: creates and deletes its own `m6med_*` users, drafts and files."""
import asyncio
import secrets
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import asyncpg
import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.config import settings
from app.database import engine
from app.main import app
from app.services import media_access as ma
from app.services.auth import decode_token, hash_password

pytestmark = pytest.mark.skipif(
    not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")),
    reason="creates and deletes users, drafts and files: only runs against a database on this machine",
)


# ── pure ──
def test_a_media_token_names_one_user_and_expires():
    token, ttl = ma.create_media_token(7, ttl=60)
    assert ttl == 60 and ma.verify_media_token(token) == 7
    expired, _ = ma.create_media_token(7, ttl=-5)
    assert ma.verify_media_token(expired) is None


def test_forged_malformed_missing_and_wrong_type_tokens_are_rejected():
    assert ma.verify_media_token(None) is None and ma.verify_media_token("") is None and ma.verify_media_token("not.a.jwt") is None
    forged = jwt.encode({"sub": "7", "typ": "media", "exp": int(time.time()) + 600}, "some-other-key", algorithm=settings.ALGORITHM)
    assert ma.verify_media_token(forged) is None
    api_like = jwt.encode({"sub": "7", "username": "x", "role": "admin", "tv": 0, "exp": int(time.time()) + 600}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    assert ma.verify_media_token(api_like) is None                       # an API login token is not accepted as a media link
    token, _ = ma.create_media_token(7)
    assert decode_token(token) is None                                   # and a media token is never an API login


def test_upload_owner_accepts_only_the_exact_shape():
    assert ma.upload_owner("/uploads/12/abc.mp4") == 12
    for bad in ("/uploads/12", "/uploads/12/", "/uploads/12/a/b.mp4", "/uploads/12/..", "/uploads/x/a.mp4", "/uploads//a.mp4", "/uploads/12/../13/a.mp4", "/other/12/a.mp4"):
        assert ma.upload_owner(bad) is None, bad


def test_urls_get_a_token_only_for_the_owner_and_text_is_never_touched():
    doc = {"videoClips": [{"url": "http://api.test/uploads/5/a.mp4"}, {"url": "/uploads/5/b.mp4?x=1"}, {"url": "http://api.test/uploads/6/c.mp4"}],
           "textOverlays": [{"text": "see /uploads/5/a.mp4 for details"}], "n": 3}
    out = ma.rewrite_media_urls(doc, 5, "TKN")
    assert out["videoClips"][0]["url"] == "http://api.test/uploads/5/a.mp4?mt=TKN"
    assert out["videoClips"][1]["url"] == "/uploads/5/b.mp4?x=1&mt=TKN"
    assert out["videoClips"][2]["url"] == "http://api.test/uploads/6/c.mp4"      # another user's file: no token is attached
    assert out["textOverlays"][0]["text"] == doc["textOverlays"][0]["text"] and out["n"] == 3
    assert doc["videoClips"][0]["url"] == "http://api.test/uploads/5/a.mp4"      # the input is not mutated


def test_stripping_removes_tokens_everywhere_and_is_idempotent():
    stored = ma.strip_media_tokens({"a": {"url": "http://h/uploads/5/a.mp4?mt=OLD"}, "l": ["/uploads/5/b.mp4?x=1&mt=OLD", "plain"]})
    assert stored == {"a": {"url": "http://h/uploads/5/a.mp4"}, "l": ["/uploads/5/b.mp4?x=1", "plain"]}
    assert ma.strip_media_tokens(stored) == stored


# ── through the real app ──
def sql(query: str, *args, fetch: bool = False):
    async def go():
        conn = await asyncpg.connect(settings.DATABASE_URL.replace("+asyncpg", ""))
        try:
            return await (conn.fetch(query, *args) if fetch else conn.execute(query, *args))
        finally:
            await conn.close()
    return asyncio.run(go())


def make_user() -> dict:
    tag = secrets.token_hex(4)
    row = sql("INSERT INTO users (username, email, hashed_password, role, is_active) VALUES ($1, $2, $3, 'editor', true) RETURNING id", f"m6med_{tag}", f"m6med_{tag}@example.test", hash_password("x" * 14), fetch=True)[0]
    api = jwt.encode({"sub": str(row["id"]), "username": f"m6med_{tag}", "role": "editor", "tv": 0, "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return {"id": row["id"], "headers": {"Authorization": f"Bearer {api}"}}


@pytest.fixture(scope="module")
def world():
    a, b = make_user(), make_user()
    root = Path(settings.UPLOAD_DIR)
    for u in (a, b):
        d = root / str(u["id"])
        d.mkdir(parents=True, exist_ok=True)
        (d / "clip.bin").write_bytes(bytes(range(256)) * 40)               # 10,240 bytes
    with TestClient(app) as client:
        yield client, a, b
        client.portal.call(engine.dispose)
    for u in (a, b):
        sql("DELETE FROM video_studio_drafts WHERE user_id = $1", u["id"])
        sql("DELETE FROM users WHERE id = $1", u["id"])
        shutil.rmtree(root / str(u["id"]), ignore_errors=True)


def mt(client, user):
    r = client.post("/media/token", headers=user["headers"])
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_no_public_fallback_every_missing_or_bad_token_is_401(world):
    client, a, _b = world
    url = f"/uploads/{a['id']}/clip.bin"
    assert client.get(url).status_code == 401
    assert client.get(url + "?mt=garbage").status_code == 401
    expired, _ = ma.create_media_token(a["id"], ttl=-5)
    assert client.get(url + f"?mt={expired}").status_code == 401
    api_token = a["headers"]["Authorization"].split(" ", 1)[1]
    assert client.get(url + f"?mt={api_token}").status_code == 401           # the API login token does not open media
    assert client.get(url, headers=a["headers"]).status_code == 401           # nor does a Bearer header: media needs the link token
    assert client.head(url).status_code == 401


def test_the_owner_can_play_seek_and_load_with_a_valid_token(world):
    client, a, _b = world
    url = f"/uploads/{a['id']}/clip.bin?mt={mt(client, a)}"
    full = client.get(url)
    assert full.status_code == 200 and len(full.content) == 10240 and full.headers.get("accept-ranges") == "bytes"
    part = client.get(url, headers={"Range": "bytes=100-199"})                # what a <video> element sends when seeking
    assert part.status_code == 206 and len(part.content) == 100 and part.headers["content-range"] == "bytes 100-199/10240" and part.content == full.content[100:200]
    assert client.head(url).status_code == 200


def test_a_valid_token_never_opens_another_users_files(world):
    client, a, b = world
    token = mt(client, a)
    assert client.get(f"/uploads/{b['id']}/clip.bin?mt={token}").status_code == 403
    assert client.get(f"/uploads/{a['id']}/../{b['id']}/clip.bin?mt={token}").status_code in (403, 404)
    assert client.get(f"/uploads/{a['id']}/%2e%2e/{b['id']}/clip.bin?mt={token}").status_code in (403, 404)
    assert client.get(f"/uploads/{a['id']}/sub/clip.bin?mt={token}").status_code == 403


def test_refusals_still_carry_cors_headers_so_the_page_can_read_them(world):
    client, a, _b = world
    r = client.get(f"/uploads/{a['id']}/clip.bin", headers={"Origin": "http://localhost:3000"})
    assert r.status_code == 401 and r.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_a_media_token_is_not_an_api_login_and_the_token_endpoint_needs_a_real_login(world):
    client, a, _b = world
    token = mt(client, a)
    assert client.get("/assets/", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert client.post("/media/token", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert client.post("/media/token").status_code in (401, 403)
    assert ma.verify_media_token(token) == a["id"]


def test_drafts_never_store_a_token_and_hand_the_owner_a_fresh_one(world):
    client, a, b = world
    stale, _ = ma.create_media_token(a["id"], ttl=-100)
    proj = {"videoClips": [{"url": f"http://api.test/uploads/{a['id']}/clip.bin?mt={stale}"}, {"url": f"http://api.test/uploads/{b['id']}/clip.bin"}], "textOverlays": [{"text": f"/uploads/{a['id']}/clip.bin"}]}
    created = client.post("/video-studio-drafts/", headers=a["headers"], json={"name": "m6med draft", "project_json": proj})
    assert created.status_code == 201
    did = created.json()["id"]
    stored = sql("SELECT project_json::text AS j FROM video_studio_drafts WHERE id = $1", did, fetch=True)[0]["j"]
    assert "mt=" not in stored                                                # nothing short-lived is persisted
    got = client.get(f"/video-studio-drafts/{did}", headers=a["headers"]).json()["project_json"]
    own, other = got["videoClips"][0]["url"], got["videoClips"][1]["url"]
    assert own.startswith(f"http://api.test/uploads/{a['id']}/clip.bin?mt=") and ma.verify_media_token(own.split("mt=")[1]) == a["id"]
    assert other == f"http://api.test/uploads/{b['id']}/clip.bin"             # another user's file gets no token
    assert got["textOverlays"][0]["text"] == f"/uploads/{a['id']}/clip.bin"   # text is untouched
    assert client.get(own.replace("http://api.test", "")).status_code == 200  # the fresh link really opens the file
    assert client.get(f"/video-studio-drafts/{did}", headers=b["headers"]).status_code == 404
    upd = client.put(f"/video-studio-drafts/{did}", headers=a["headers"], json={"name": "m6med draft", "project_json": got})
    assert upd.status_code == 200 and "mt=" not in sql("SELECT project_json::text AS j FROM video_studio_drafts WHERE id = $1", did, fetch=True)[0]["j"]
