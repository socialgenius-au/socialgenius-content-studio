"""Uploaded media: per-user isolation of files, listings, exports and integrity reports, and plain behaviour when a file is gone.
Local database only: it creates and deletes its own `m6_*` users, their assets and their upload folder (a temporary one)."""
import asyncio
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

import asyncpg
import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.config import settings
from app.database import engine
from app.main import app
from app.services.auth import hash_password

pytestmark = pytest.mark.skipif(
    not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")),
    reason="creates and deletes users and assets: only runs against a database on this machine",
)


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
    row = sql("INSERT INTO users (username, email, hashed_password, role, is_active) VALUES ($1, $2, $3, 'editor', true) RETURNING id",
              f"m6_{tag}", f"m6_{tag}@example.test", hash_password("x" * 14), fetch=True)[0]
    token = jwt.encode({"sub": str(row["id"]), "username": f"m6_{tag}", "role": "editor", "tv": 0, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                       settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return {"id": row["id"], "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture()
def world(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))
    a, b = make_user(), make_user()
    try:
        with TestClient(app) as client:                                   # one event loop for every request (the pooled DB connections belong to it)
            yield client, a, b
            client.portal.call(engine.dispose)
    finally:
        for u in (a, b):
            sql("DELETE FROM assets WHERE user_id = $1", u["id"])
            sql("DELETE FROM users WHERE id = $1", u["id"])


def upload(client, who, name="clip.mp4", data=b"0" * 2048):
    r = client.post("/upload/", headers=who["headers"], files={"file": (name, data, "video/mp4")})
    assert r.status_code == 200, r.text
    return r.json()


EXPORT_BODY = lambda asset_id: {"canvas_width": 1080, "canvas_height": 1920, "video_clips": [{"asset_id": asset_id, "start_time": 0, "end_time": 2, "trim_in": 0}]}


def test_one_users_files_are_invisible_to_another(world):
    client, a, b = world
    asset = upload(client, a)
    assert asset["file_path"].replace("\\", "/").split("/")[-2] == str(a["id"])           # stored under the owner's own folder
    assert client.get("/assets/", headers=b["headers"]).json() == []
    assert client.get(f"/assets/{asset['id']}/download", headers=b["headers"]).status_code == 404
    assert client.get(f"/assets/{asset['id']}/download", headers=a["headers"]).status_code == 200
    assert client.get(f"/assets/{asset['id']}/download").status_code in (401, 403)       # no token, no download
    assert client.post("/reference-videos/", headers=b["headers"], json={"asset_id": asset["id"]}).status_code == 404
    assert client.post("/video-export/export", headers=b["headers"], json=EXPORT_BODY(asset["id"])).status_code == 404
    integ_b = client.get("/assets/integrity", headers=b["headers"]).json()
    assert integ_b["total"] == 0 and integ_b["missing"] == []


def test_a_missing_file_is_reported_plainly_and_nothing_is_recreated(world):
    client, a, b = world
    asset = upload(client, a, name="Barakah ad.mp4")
    path = Path(asset["file_path"])
    assert client.get("/assets/integrity", headers=a["headers"]).json()["missing_count"] == 0
    path.unlink()                                                                         # the file is lost, the database record stays

    integ = client.get("/assets/integrity", headers=a["headers"]).json()
    assert integ["total"] == 1 and integ["available"] == 0 and integ["missing_count"] == 1
    assert integ["missing"][0]["id"] == asset["id"] and integ["missing"][0]["original_filename"] == "Barakah ad.mp4"

    dl = client.get(f"/assets/{asset['id']}/download", headers=a["headers"])
    assert dl.status_code == 410
    ex = client.post("/video-export/export", headers=a["headers"], json=EXPORT_BODY(asset["id"]))
    assert ex.status_code == 410
    assert "'Barakah ad.mp4'" in ex.json()["detail"] and "Nothing was replaced or recreated" in ex.json()["detail"]
    assert not path.exists()                                                              # reporting and refusing did not recreate or substitute anything
    assert client.get(f"/assets/{asset['id']}/download", headers=b["headers"]).status_code == 404   # and the other user still cannot see it
