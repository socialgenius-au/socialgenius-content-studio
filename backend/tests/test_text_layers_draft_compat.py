"""M2.1a: a draft carrying reconstructed text layers (native TextOverlay objects with a `reconstruction` provenance field, plus a draft-level
`reconstruction` record) is accepted, stored and returned unchanged by the EXISTING video-studio-drafts API, survives an editor re-save, never alters any
other draft, and the layers are valid input for the EXISTING export request schema (exactly the fields the export button sends today).

The parts are the frontend engine's own output (frontend/src/pages/deconstructor/textlayers/__fixtures__/textlayers.draft.parts.json, synthetic data) merged into the
real VA5368 assembled draft from M1. The frontend test fails if the engine's output drifts from the fixture, so this checks what the engine really produces.
Local database only: it creates and deletes its own `m2_*` users and their drafts."""
import asyncio
import copy
import json
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
from app.schemas.video_export import ExportProjectRequest, ExportTextOverlay, ExportVideoClip
from app.services.auth import hash_password

pytestmark = pytest.mark.skipif(
    not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")),
    reason="creates and deletes users and drafts: only runs against a database on this machine",
)

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "deconstructor"
ASSEMBLED = FRONTEND / "assembly" / "__fixtures__" / "va5368.assembled.snapshot.json"
PARTS = FRONTEND / "textlayers" / "__fixtures__" / "textlayers.draft.parts.json"


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
              f"m2_{tag}", f"m2_{tag}@example.test", hash_password("x" * 14), fetch=True)[0]
    token = jwt.encode({"sub": str(row["id"]), "username": f"m2_{tag}", "role": "editor", "tv": 0, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                       settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return {"id": row["id"], "headers": {"Authorization": f"Bearer {token}"}}


def draft_rows(user_id: int):
    return [dict(r) for r in sql("SELECT id, name, project_json::text AS project_json, updated_at FROM video_studio_drafts WHERE user_id = $1 ORDER BY id", user_id, fetch=True)]


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c
        c.portal.call(engine.dispose)
    sql("DELETE FROM users WHERE username LIKE 'm2\\_%'")


@pytest.fixture(scope="module")
def draft() -> dict:
    """The M1 assembled draft with the engine's text layers merged in exactly as mergeTextLayers does."""
    assert PARTS.exists(), "run the frontend textlayers tests once (UPDATE_TEXTLAYER_FIXTURE=1) to generate the fixture"
    base = json.loads(ASSEMBLED.read_text(encoding="utf-8"))
    parts = json.loads(PARTS.read_text(encoding="utf-8"))
    snap = copy.deepcopy(base["snapshot"])
    remove = set(parts["removePlaceholderIds"])
    snap["textOverlays"] = [o for o in snap["textOverlays"] if o["id"] not in remove] + parts["textOverlays"]
    snap["reconstruction"] = parts["reconstruction"]
    assert [o["id"] for o in snap["textOverlays"]] == parts["expectedOverlayIds"]
    return {"name": base["name"], "snapshot": snap, "parts": parts}


def test_the_layers_are_native_text_overlays_with_provenance(draft):
    layers = draft["parts"]["textOverlays"]
    assert len(layers) >= 3
    for o in layers:
        assert {"id", "text", "x", "y", "width", "startTime", "endTime", "fontFamily", "fontSize", "color", "bgColor", "bgOpacity", "animation"} <= set(o)
        r = o["reconstruction"]
        assert r["schema"] == "reconstruction-v1" and r["kind"] == "text" and r["evidence"][0]["kind"] == "ocr_group"
        assert r["properties"]["text"]["basis"] in {"measured", "user"} and r["properties"]["fontSize"]["basis"] == "inferred"
    rec = draft["snapshot"]["reconstruction"]
    assert rec["claims"] == {"burnedInTextRemoved": False, "originalFontsRecovered": False, "originalLayersRecovered": False, "backgroundPixelsRecovered": False}


def test_a_replacing_layer_keeps_its_scene_link_and_only_the_replaced_placeholders_are_gone(draft):
    snap = draft["snapshot"]
    ids = [o["id"] for o in snap["textOverlays"]]
    for gone in draft["parts"]["removePlaceholderIds"]:
        assert gone not in ids
    assert sum(1 for i in ids if i.startswith("bp:")) == 8 - len(draft["parts"]["removePlaceholderIds"])
    replacing = [o for o in snap["textOverlays"] if o["id"].startswith("rc:") and "blueprint" in o]
    assert replacing and all(o["blueprint"]["kind"] in {"text", "cta"} for o in replacing)


def test_the_existing_drafts_api_stores_and_returns_it_unchanged(client, draft):
    user = make_user()
    created = client.post("/video-studio-drafts/", json={"name": draft["name"], "project_json": draft["snapshot"]}, headers=user["headers"])
    assert created.status_code == 201, created.text
    got = client.get(f"/video-studio-drafts/{created.json()['id']}", headers=user["headers"])
    assert got.status_code == 200
    assert got.json()["project_json"] == draft["snapshot"]                                   # layers, provenance and the record: equal after the JSON round trip


def test_reopening_and_editing_in_the_editor_keeps_the_provenance(client, draft):
    user = make_user()
    draft_id = client.post("/video-studio-drafts/", json={"name": draft["name"], "project_json": draft["snapshot"]}, headers=user["headers"]).json()["id"]
    edited = copy.deepcopy(draft["snapshot"])
    layer = next(o for o in edited["textOverlays"] if o["id"].startswith("rc:"))
    layer.update({"text": "Our own words", "fontSize": 64, "color": "#ffcc00"})             # the editor merges a partial patch onto the whole object
    put = client.put(f"/video-studio-drafts/{draft_id}", json={"name": "My text reconstruction", "project_json": edited}, headers=user["headers"])
    assert put.status_code == 200
    back = client.get(f"/video-studio-drafts/{draft_id}", headers=user["headers"]).json()["project_json"]
    again = next(o for o in back["textOverlays"] if o["id"] == layer["id"])
    assert again["text"] == "Our own words" and again["reconstruction"] == layer["reconstruction"]     # the evidence trail is untouched by the edit
    assert back["reconstruction"] == draft["snapshot"]["reconstruction"] and back["assembly"] == draft["snapshot"]["assembly"]


def test_creating_it_leaves_every_other_draft_untouched(client, draft):
    user, other = make_user(), make_user()
    legacy = {"videoClips": [], "textOverlays": [], "mediaOverlays": [], "audioTracks": []}
    first = client.post("/video-studio-drafts/", json={"name": "older draft", "project_json": legacy}, headers=user["headers"]).json()["id"]
    foreign = client.post("/video-studio-drafts/", json={"name": "someone else's", "project_json": legacy}, headers=other["headers"]).json()["id"]
    before_user, before_other = draft_rows(user["id"]), draft_rows(other["id"])
    made = client.post("/video-studio-drafts/", json={"name": draft["name"], "project_json": draft["snapshot"]}, headers=user["headers"])
    assert made.status_code == 201
    after = draft_rows(user["id"])
    assert after[:1] == before_user and [r["id"] for r in after] == [first, made.json()["id"]]
    assert draft_rows(other["id"]) == before_other
    assert client.get(f"/video-studio-drafts/{foreign}", headers=user["headers"]).status_code == 404
    assert client.delete(f"/video-studio-drafts/{made.json()['id']}", headers=user["headers"]).status_code == 204
    assert draft_rows(user["id"]) == before_user


def test_the_drafts_table_is_not_changed(client):
    cols = {r["column_name"] for r in sql("SELECT column_name FROM information_schema.columns WHERE table_name = 'video_studio_drafts'", fetch=True)}
    assert cols == {"id", "user_id", "name", "project_json", "created_at", "updated_at"}


def _export_body(snapshot: dict) -> dict:
    """The request body Video Studio V2's own export button builds from a project (see ReviewTab.tsx)."""
    return {
        "canvas_width": 1080, "canvas_height": 1920,
        "video_clips": [{
            "asset_id": c["assetId"], "start_time": c["startTime"], "end_time": c["endTime"], "trim_in": c["trimIn"], "speed": c["speed"], "color_grade": c["colorGrade"],
            "brightness": c["brightness"], "contrast": c["contrast"], "saturation": c["saturation"], "transition": c["transition"], "transition_duration": c["transitionDuration"],
            "muted": c.get("muted", False), "volume": c.get("volume", 1), "fit_mode": c.get("fitMode", "fit"), "crop_x": c.get("cropOffsetX", 50), "crop_y": c.get("cropOffsetY", 50),
        } for c in snapshot["videoClips"]],
        "text_overlays": [{"text": t["text"], "start_time": t["startTime"], "end_time": t["endTime"], "x": t["x"], "y": t["y"], "font_size": t["fontSize"], "color": t["color"], "order": t.get("order", 0)}
                          for t in snapshot["textOverlays"]],
        "media_overlays": [], "audio_tracks": [],
    }


def test_the_layers_are_valid_input_for_the_existing_export_request(draft):
    snap = draft["snapshot"]
    req = ExportProjectRequest(**_export_body(snap))                                        # raises if any field is rejected by the existing schema
    assert len(req.video_clips) == 7 and len(req.text_overlays) == len(snap["textOverlays"])
    assert all(isinstance(c, ExportVideoClip) for c in req.video_clips) and all(isinstance(t, ExportTextOverlay) for t in req.text_overlays)
    layers = {o["text"] for o in draft["parts"]["textOverlays"]}
    for ov in (t for t in req.text_overlays if t.text in layers):
        assert 0 <= ov.x <= 100 and 0 <= ov.y <= 100 and ov.end_time > ov.start_time and ov.color.startswith("#") and ov.font_size > 0
