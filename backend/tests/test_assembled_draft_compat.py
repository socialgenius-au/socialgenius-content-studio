"""M1 / Stage 1: an assembled draft (produced by the frontend's pure assembly engine) is accepted, stored and returned unchanged by the EXISTING
video-studio-drafts API, is valid input for the EXISTING export request schema, and creating it never alters any other draft.

The fixture is the engine's own output for the real VA5368 blueprint (frontend/src/pages/deconstructor/assembly/__fixtures__/va5368.assembled.snapshot.json);
the frontend test fails if the engine's output ever drifts from it, so this test always checks what the engine really produces.
Local database only: it creates and deletes its own `m1_*` users and their drafts."""
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

FIXTURE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "deconstructor" / "assembly" / "__fixtures__" / "va5368.assembled.snapshot.json"
LEGACY_DRAFT = {  # a draft as the editor saved it before blueprints or assembly existed
    "videoClips": [{"id": "c1", "assetId": 1, "url": "/u/a.mp4", "name": "a.mp4", "duration": 5, "startTime": 0, "endTime": 5, "trimIn": 0, "trimOut": 0, "colorGrade": "none", "speed": 1,
                    "brightness": 0, "contrast": 0, "saturation": 0, "transition": "cut", "transitionDuration": 0.5}],
    "textOverlays": [], "mediaOverlays": [], "audioTracks": [], "timeline": {"currentTime": 0, "duration": 5, "playing": False, "markIn": None, "markOut": None},
}


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
              f"m1_{tag}", f"m1_{tag}@example.test", hash_password("x" * 14), fetch=True)[0]
    token = jwt.encode({"sub": str(row["id"]), "username": f"m1_{tag}", "role": "editor", "tv": 0, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                       settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return {"id": row["id"], "headers": {"Authorization": f"Bearer {token}"}}


def draft_rows(user_id: int):
    return [dict(r) for r in sql("SELECT id, name, project_json::text AS project_json, updated_at FROM video_studio_drafts WHERE user_id = $1 ORDER BY id", user_id, fetch=True)]


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c
        c.portal.call(engine.dispose)
    sql("DELETE FROM users WHERE username LIKE 'm1\\_%'")


@pytest.fixture(scope="module")
def fx() -> dict:
    assert FIXTURE.exists(), "run the frontend assembly tests once (UPDATE_ASSEMBLY_FIXTURE=1) to generate the fixture"
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_the_fixture_is_the_engines_real_output(fx):
    snap = fx["snapshot"]
    assert fx["name"].startswith("Blueprint — ") and len(fx["name"]) <= 255            # the drafts table's name column is 255 characters
    assert len(snap["videoClips"]) == 7 and len(snap["textOverlays"]) == 8
    assert snap["assembly"]["schema"] == "assembly-v1" and snap["assembly"]["summary"]["plannedSeconds"] == 30


def test_the_existing_drafts_api_stores_and_returns_it_unchanged(client, fx):
    user = make_user()
    created = client.post("/video-studio-drafts/", json={"name": fx["name"], "project_json": fx["snapshot"]}, headers=user["headers"])
    assert created.status_code == 201, created.text
    draft_id = created.json()["id"]
    got = client.get(f"/video-studio-drafts/{draft_id}", headers=user["headers"])
    assert got.status_code == 200
    assert got.json()["project_json"] == fx["snapshot"]                                    # byte-for-byte equal after the JSON round trip
    assert got.json()["name"] == fx["name"]
    listed = client.get("/video-studio-drafts/", headers=user["headers"]).json()
    assert [d["id"] for d in listed] == [draft_id] and "project_json" not in listed[0]       # the list view stays lightweight


def test_saving_the_draft_again_from_the_editor_is_just_a_normal_update(client, fx):
    user = make_user()
    draft_id = client.post("/video-studio-drafts/", json={"name": fx["name"], "project_json": fx["snapshot"]}, headers=user["headers"]).json()["id"]
    edited = copy.deepcopy(fx["snapshot"])
    edited["textOverlays"][0]["text"] = "Our real opening line"                              # the person replaces a placeholder in the editor
    put = client.put(f"/video-studio-drafts/{draft_id}", json={"name": "My reconstruction", "project_json": edited}, headers=user["headers"])
    assert put.status_code == 200
    got = client.get(f"/video-studio-drafts/{draft_id}", headers=user["headers"]).json()
    assert got["name"] == "My reconstruction" and got["project_json"]["textOverlays"][0]["text"] == "Our real opening line"
    assert got["project_json"]["assembly"] == fx["snapshot"]["assembly"]                   # the assembly record rides along untouched


def test_creating_an_assembled_draft_leaves_every_existing_draft_untouched(client, fx):
    user, other = make_user(), make_user()
    legacy_id = client.post("/video-studio-drafts/", json={"name": "ABC Tiles — older draft", "project_json": LEGACY_DRAFT}, headers=user["headers"]).json()["id"]
    plan_only = copy.deepcopy(fx["snapshot"]); plan_only["videoClips"] = []; del plan_only["assembly"]                      # a Stage-C6 blueprint draft: placeholders only
    plan_id = client.post("/video-studio-drafts/", json={"name": "Blueprint draft (no media)", "project_json": plan_only}, headers=user["headers"]).json()["id"]
    others_id = client.post("/video-studio-drafts/", json={"name": "someone else's", "project_json": LEGACY_DRAFT}, headers=other["headers"]).json()["id"]
    before_user, before_other = draft_rows(user["id"]), draft_rows(other["id"])

    assembled = client.post("/video-studio-drafts/", json={"name": fx["name"], "project_json": fx["snapshot"]}, headers=user["headers"])
    assert assembled.status_code == 201

    after_user = draft_rows(user["id"])
    assert after_user[:2] == before_user                                                    # both older drafts identical, including updated_at
    assert [r["id"] for r in after_user] == [legacy_id, plan_id, assembled.json()["id"]]
    assert draft_rows(other["id"]) == before_other                                          # and another user's drafts are not even visible, let alone changed
    assert client.get(f"/video-studio-drafts/{assembled.json()['id']}", headers=other["headers"]).status_code == 404
    assert client.get(f"/video-studio-drafts/{others_id}", headers=user["headers"]).status_code == 404

    assert client.delete(f"/video-studio-drafts/{assembled.json()['id']}", headers=user["headers"]).status_code == 204
    assert draft_rows(user["id"]) == before_user                                            # removing it restores exactly the previous state


def test_the_drafts_table_is_not_changed_by_this_feature(client):
    cols = {r["column_name"] for r in sql("SELECT column_name FROM information_schema.columns WHERE table_name = 'video_studio_drafts'", fetch=True)}
    assert cols == {"id", "user_id", "name", "project_json", "created_at", "updated_at"}


def _export_body(snapshot: dict) -> dict:
    """The request body Video Studio V2's own export button builds from a project (see ReviewTab.tsx), applied to the assembled snapshot."""
    return {
        "canvas_width": 1080, "canvas_height": 1920,
        "video_clips": [{
            "asset_id": c["assetId"], "start_time": c["startTime"], "end_time": c["endTime"], "trim_in": c["trimIn"], "speed": c["speed"], "color_grade": c["colorGrade"],
            "brightness": c["brightness"], "contrast": c["contrast"], "saturation": c["saturation"], "transition": c["transition"], "transition_duration": c["transitionDuration"],
            "muted": c.get("muted", False), "volume": c.get("volume", 1), "fit_mode": c.get("fitMode", "fit"), "crop_x": c.get("cropOffsetX", 50), "crop_y": c.get("cropOffsetY", 50),
        } for c in snapshot["videoClips"]],
        "text_overlays": [{"text": t["text"], "start_time": t["startTime"], "end_time": t["endTime"], "x": t["x"], "y": t["y"], "font_size": t["fontSize"], "color": t["color"], "order": t.get("order", 0)} for t in snapshot["textOverlays"]],
        "media_overlays": [], "audio_tracks": [],
    }


def test_the_assembled_draft_is_valid_input_for_the_existing_export_request(fx):
    snap = fx["snapshot"]
    req = ExportProjectRequest(**_export_body(snap))                                        # raises if any field is rejected by the existing schema
    assert len(req.video_clips) == 7 and len(req.text_overlays) == 8
    assert all(isinstance(c, ExportVideoClip) for c in req.video_clips) and all(isinstance(t, ExportTextOverlay) for t in req.text_overlays)


def test_every_clip_reads_only_inside_its_source_file_exactly_as_the_exporter_will(fx):
    """ffmpeg_svc.render_project reads source [trim_in, trim_in + (end_time - start_time) * speed) from each file."""
    for c in fx["snapshot"]["videoClips"]:
        span = (c["endTime"] - c["startTime"]) * c["speed"]
        assert c["trimIn"] >= 0 and c["trimIn"] + span <= c["duration"] + 0.001, c["id"]


def test_the_timeline_is_gapless_scene_by_scene_and_matches_the_plan(fx):
    snap = fx["snapshot"]
    scenes = snap["assembly"]["scenes"]
    assert [s["startTime"] for s in scenes] == [0, 4, 9, 14, 20, 25, 27]
    clips = sorted(snap["videoClips"], key=lambda c: c["startTime"])
    assert [(c["startTime"], c["endTime"]) for c in clips] == [(s["startTime"], s["endTime"]) for s in scenes]
    assert snap["timeline"]["duration"] == 30 == scenes[-1]["endTime"]


def test_provenance_labels_survive_storage(client, fx):
    user = make_user()
    draft_id = client.post("/video-studio-drafts/", json={"name": fx["name"], "project_json": fx["snapshot"]}, headers=user["headers"]).json()["id"]
    stored = client.get(f"/video-studio-drafts/{draft_id}", headers=user["headers"]).json()["project_json"]["assembly"]["scenes"][0]
    assert (stored["evidence"]["origin"], stored["structure"]["origin"], stored["media"]["origin"], stored["text"]["origin"]) == ("reference_evidence", "inferred_structure", "user_supplied", "placeholder")
