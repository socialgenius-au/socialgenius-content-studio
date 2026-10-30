"""M2.2a: a draft carrying reconstructed image layers (native MediaOverlay objects with a `reconstruction` provenance field, plus a draft-level
`imageReconstruction` record) is accepted, stored and returned unchanged by the EXISTING video-studio-drafts API, survives an editor re-save, never alters any
other draft, and the layers are valid input for the EXISTING export request schema (exactly the fields the export button sends today for image overlays).

The parts are the frontend engine's own output (frontend/src/pages/deconstructor/imagelayers/__fixtures__/imagelayers.draft.parts.json, synthetic data) merged into the
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
from app.schemas.video_export import ExportMediaOverlay, ExportProjectRequest, ExportVideoClip
from app.services.auth import hash_password

pytestmark = pytest.mark.skipif(
    not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")),
    reason="creates and deletes users and drafts: only runs against a database on this machine",
)

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "deconstructor"
ASSEMBLED = FRONTEND / "assembly" / "__fixtures__" / "va5368.assembled.snapshot.json"
PARTS = FRONTEND / "imagelayers" / "__fixtures__" / "imagelayers.draft.parts.json"
CLAIMS = {"isolated": False, "backgroundRemoved": False, "burnedInContentRemoved": False, "originalResolutionRecovered": False}


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
    """The M1 assembled draft with the engine's image layers merged in exactly as mergeImageLayers does."""
    assert PARTS.exists(), "run the frontend imagelayers tests once (UPDATE_IMAGELAYER_FIXTURE=1) to generate the fixture"
    base = json.loads(ASSEMBLED.read_text(encoding="utf-8"))
    parts = json.loads(PARTS.read_text(encoding="utf-8"))
    snap = copy.deepcopy(base["snapshot"])
    have = {o["id"] for o in snap["mediaOverlays"]}
    snap["mediaOverlays"] = snap["mediaOverlays"] + [o for o in parts["mediaOverlays"] if o["id"] not in have]
    snap["imageReconstruction"] = parts["imageReconstruction"]
    assert [o["id"] for o in snap["mediaOverlays"]] == parts["expectedMediaOverlayIds"]
    return {"name": base["name"], "snapshot": snap, "parts": parts}


def test_the_layers_are_native_media_overlays_with_provenance(draft):
    layers = draft["parts"]["mediaOverlays"]
    assert len(layers) == 2
    for o in layers:
        assert {"id", "url", "assetId", "x", "y", "width", "height", "opacity", "startTime", "endTime"} <= set(o)
        assert 0 <= o["x"] and o["x"] + o["width"] <= 100 and 0 <= o["y"] and o["y"] + o["height"] <= 100 and o["endTime"] > o["startTime"]
        r = o["reconstruction"]
        assert r["schema"] == "reconstruction-v1" and r["kind"] == "image" and r["claims"] == CLAIMS
        assert r["properties"]["startTime"]["basis"] in {"inferred", "user"} and r["properties"]["box"]["basis"] == "inferred"
    upload, crop = layers
    assert upload["reconstruction"]["image"]["source"] == "user_upload" and upload["reconstruction"]["origin"] == "user_region"
    assert crop["reconstruction"]["image"]["source"] == "reference_frame_crop" and crop["reconstruction"]["image"]["rightsAcknowledged"] is True
    assert crop["reconstruction"]["evidence"] == [{"kind": "visual_object", "id": 102}]
    rec = draft["snapshot"]["imageReconstruction"]
    assert rec["claims"] == CLAIMS and rec["kind"] == "image"


def test_the_picture_is_never_stretched_by_the_box(draft):
    """The editor preview fits the picture inside the box, the exporter scales the picture to exactly the box: they only agree if the box has the picture's own aspect."""
    for o in draft["parts"]["mediaOverlays"]:
        img = o["reconstruction"]["image"]
        box_aspect = (o["width"] * 1080) / (o["height"] * 1920)
        assert box_aspect == pytest.approx(img["width"] / img["height"], rel=0.01)


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
    layer = next(o for o in edited["mediaOverlays"] if o["id"].startswith("ri:"))
    layer.update({"x": 12.5, "y": 7.25, "width": 20, "opacity": 0.8, "startTime": 2, "endTime": 9})      # the editor merges a partial patch onto the whole object
    put = client.put(f"/video-studio-drafts/{draft_id}", json={"name": "My image reconstruction", "project_json": edited}, headers=user["headers"])
    assert put.status_code == 200
    back = client.get(f"/video-studio-drafts/{draft_id}", headers=user["headers"]).json()["project_json"]
    again = next(o for o in back["mediaOverlays"] if o["id"] == layer["id"])
    assert again["x"] == 12.5 and again["opacity"] == 0.8 and again["reconstruction"] == layer["reconstruction"]     # the evidence trail is untouched by the edit
    assert back["imageReconstruction"] == draft["snapshot"]["imageReconstruction"] and back["assembly"] == draft["snapshot"]["assembly"]


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
    """The request body Video Studio V2's own export button builds from a project (see ReviewTab.tsx): clips and media overlays."""
    return {
        "canvas_width": 1080, "canvas_height": 1920,
        "video_clips": [{
            "asset_id": c["assetId"], "start_time": c["startTime"], "end_time": c["endTime"], "trim_in": c["trimIn"], "speed": c["speed"], "color_grade": c["colorGrade"],
            "brightness": c["brightness"], "contrast": c["contrast"], "saturation": c["saturation"], "transition": c["transition"], "transition_duration": c["transitionDuration"],
            "muted": c.get("muted", False), "volume": c.get("volume", 1), "fit_mode": c.get("fitMode", "fit"), "crop_x": c.get("cropOffsetX", 50), "crop_y": c.get("cropOffsetY", 50),
        } for c in snapshot["videoClips"]],
        "text_overlays": [],
        "media_overlays": [{"asset_id": o["assetId"], "start_time": o["startTime"], "end_time": o["endTime"], "x": o["x"], "y": o["y"], "width": o["width"], "height": o["height"],
                            "opacity": o["opacity"], "order": o.get("order", 0), "muted": o.get("muted", False), "volume": o.get("volume", 1)} for o in snapshot["mediaOverlays"]],
        "audio_tracks": [],
    }


def test_the_layers_are_valid_input_for_the_existing_export_request(draft):
    snap = draft["snapshot"]
    req = ExportProjectRequest(**_export_body(snap))                                        # raises if any field is rejected by the existing schema
    assert len(req.video_clips) == 7 and len(req.media_overlays) == 2
    assert all(isinstance(c, ExportVideoClip) for c in req.video_clips) and all(isinstance(m, ExportMediaOverlay) for m in req.media_overlays)
    for ov in req.media_overlays:
        assert 0 <= ov.x <= 100 and 0 <= ov.y <= 100 and ov.end_time > ov.start_time and 0 < ov.opacity <= 1 and ov.width > 0 and ov.height > 0
