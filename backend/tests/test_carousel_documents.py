"""Carousel Creator server persistence: real PostgreSQL, real auth dependency, no AI, no network.

Covers: round-trip of a whole document, ownership (another user can never see, change, duplicate or delete it), optimistic versioning and conflicts, validation and size limits,
inline-image and unsafe-URL refusal, asset ownership, media-token stripping, duplicate/delete, the per-user limit, HTTP authentication, and that the SQL migration matches the model.
"""
import copy
import json
import re
import secrets
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.database import get_db
from app.models.asset import Asset
from app.models.carousel_document import CarouselDocument
from app.models.user import User
from app.routers import carousels as car
from app.schemas.carousel import CarouselCreate, CarouselUpdate
from app.services.auth import create_token
from app.services import carousel_validation as cv

_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
Session = async_sessionmaker(_engine, expire_on_commit=False)


def new_doc(doc_id: str | None = None, slides: int = 3, title: str = "Tile tips") -> dict:
    did = doc_id or f"car_{secrets.token_hex(6)}"
    def text(i, content):
        return {"id": f"{did}_t{i}", "type": "text", "role": "primary_headline", "name": "Headline", "x": 0.07, "y": 0.2, "width": 0.86, "height": "auto", "rotation": 0, "opacity": 1,
                "visible": True, "locked": False, "content": content, "autoSize": "auto-height",
                "style": {"fontFamily": "Inter", "fontSize": 0.08, "fontWeight": 800, "lineHeight": 1.1, "align": "left", "color": "#FFFFFF"}}
    pages = [{"id": f"{did}_s{i}", "name": f"{i + 1}. Slide", "background": {"kind": "solid", "color": "#1E4D2B"}, "elements": [text(i, f"Slide {i + 1} headline")]} for i in range(slides)]
    return {"kind": "post", "schemaVersion": 1, "id": did, "title": title, "revision": 0, "format": {"platformKey": "instagram", "formatKey": "carousel", "width": 1080, "height": 1350, "ratio": "4:5"},
            "pages": pages, "context": {}, "provenance": {"origin": "manual"}, "createdAt": "2026-11-19T09:00:00.000Z", "updatedAt": "2026-11-19T09:00:00.000Z"}


@pytest.fixture(autouse=True)
async def _ensure_table():
    """The application's own startup does this (create_all creates only MISSING tables); doing it here keeps the file independent of how the test database was prepared."""
    async with _engine.begin() as conn:
        await conn.run_sync(lambda c: CarouselDocument.__table__.create(c, checkfirst=True))


@pytest.fixture
async def users():
    made = []
    async with Session() as db:
        for _ in range(2):
            u = User(username=f"car_{secrets.token_hex(4)}", email=f"car_{secrets.token_hex(4)}@example.test", hashed_password="x", role="editor", is_active=True)
            db.add(u)
            made.append(u)
        await db.commit()
        for u in made:
            await db.refresh(u)
    yield made
    async with Session() as db:
        for u in made:
            row = await db.get(User, u.id)
            if row:
                await db.delete(row)
        await db.commit()


async def create(db, user, doc, **kw):
    return await car.create_carousel(CarouselCreate(document=doc, **kw), db=db, user=user)


async def update(db, user, doc_id, doc, version, **kw):
    return await car.update_carousel(doc_id, CarouselUpdate(document=doc, expected_version=version, **kw), db=db, user=user)


async def expect(status_code, code, coro):
    with pytest.raises(HTTPException) as e:
        await coro
    assert e.value.status_code == status_code
    if code:
        d = e.value.detail
        assert (d.get("code") if isinstance(d, dict) else d) == code
    return e.value.detail


# ── round trip ───────────────────────────────────────────────────────────────────────────────
async def test_a_whole_document_round_trips_exactly_with_slide_order_layers_and_blueprint_metadata(users):
    a, _ = users
    doc = new_doc(slides=4)
    doc["pages"][1]["elements"].append({"id": "shape1", "type": "shape", "role": "decorative", "name": "Bar", "shape": "rect", "x": 0.1, "y": 0.1, "width": 0.3, "height": 0.02, "rotation": 0, "opacity": 1, "visible": True, "locked": False, "fill": "#E8B04A"})
    doc["pages"][2]["background"] = {"kind": "gradient", "angle": 160, "stops": [{"offset": 0, "color": "#111827"}, {"offset": 1, "color": "#1E8A55"}]}
    doc["provenance"] = {"origin": "template", "importRef": "blueprint:bp-14faad7aef8e1d60", "generation": {"briefRef": "bp-14faad7aef8e1d60", "intelligenceRefs": [{"kind": "reference_video", "id": "3"}, {"kind": "mechanism", "id": "M01"}], "engine": "no AI call"}}
    async with Session() as db:
        created = await create(db, a, doc, theme_id="ink", active_slide_id=doc["pages"][2]["id"])
    assert (created.version, created.slide_count, created.blueprint_id, created.reference_video_id, created.theme_id, created.active_slide_id) == (1, 4, "bp-14faad7aef8e1d60", 3, "ink", doc["pages"][2]["id"])
    async with Session() as db:
        opened = await car.get_carousel(doc["id"], db=db, user=a)
        listed = await car.list_carousels(db=db, user=a)
    assert opened.document == doc                                                     # identical: order, layers, backgrounds, canvas, provenance
    assert [p["id"] for p in opened.document["pages"]] == [p["id"] for p in doc["pages"]]
    assert [s.doc_id for s in listed] == [doc["id"]] and listed[0].slide_count == 4 and listed[0].title == "Tile tips"


async def test_each_user_only_ever_sees_their_own_carousels_and_the_same_id_can_exist_for_two_users(users):
    a, b = users
    doc = new_doc("car_shared_id")
    async with Session() as db:
        await create(db, a, doc)
        await create(db, b, new_doc("car_shared_id", title="B's"))                   # unique per user, not global
        assert [s.title for s in await car.list_carousels(db=db, user=a)] == ["Tile tips"]
        assert [s.title for s in await car.list_carousels(db=db, user=b)] == ["B's"]


# ── ownership ────────────────────────────────────────────────────────────────────────────────
async def test_another_users_carousel_cannot_be_opened_saved_duplicated_or_deleted_and_looks_like_it_does_not_exist(users):
    a, b = users
    doc = new_doc()
    async with Session() as db:
        await create(db, a, doc)
    async with Session() as db:
        await expect(404, "Carousel not found", car.get_carousel(doc["id"], db=db, user=b))
        await expect(404, "Carousel not found", update(db, b, doc["id"], doc, 1))
        await expect(404, "Carousel not found", car.duplicate_carousel(doc["id"], db=db, user=b))
        await expect(404, "Carousel not found", car.delete_carousel(doc["id"], db=db, user=b))
    async with Session() as db:
        still = await car.get_carousel(doc["id"], db=db, user=a)
    assert still.version == 1 and still.document == doc                              # untouched by every attempt


# ── versions and conflicts ───────────────────────────────────────────────────────────────────
async def test_saving_bumps_the_version_and_a_stale_save_is_refused_instead_of_overwriting(users):
    a, _ = users
    doc = new_doc()
    async with Session() as db:
        await create(db, a, doc)
    edited = copy.deepcopy(doc)
    edited["pages"][0]["elements"][0]["content"] = "Edited on device 1"
    async with Session() as db:
        saved = await update(db, a, doc["id"], edited, 1)
    assert saved.version == 2
    other = copy.deepcopy(doc)
    other["pages"][0]["elements"][0]["content"] = "Edited on device 2 (based on version 1)"
    async with Session() as db:
        detail = await expect(409, "version_conflict", update(db, a, doc["id"], other, 1))
    assert detail["server_version"] == 2 and "somewhere else" in detail["message"]
    async with Session() as db:
        now = await car.get_carousel(doc["id"], db=db, user=a)
    assert now.version == 2 and now.document["pages"][0]["elements"][0]["content"] == "Edited on device 1"       # the newer work survived


async def test_force_is_an_explicit_overwrite_and_still_bumps_the_version(users):
    a, _ = users
    doc = new_doc()
    async with Session() as db:
        await create(db, a, doc)
        await update(db, a, doc["id"], doc, 1)                                        # server is now version 2
    mine = copy.deepcopy(doc)
    mine["pages"][0]["elements"][0]["content"] = "Keep mine"
    async with Session() as db:
        saved = await update(db, a, doc["id"], mine, 1, force=True)
    assert saved.version == 3
    async with Session() as db:
        assert (await car.get_carousel(doc["id"], db=db, user=a)).document["pages"][0]["elements"][0]["content"] == "Keep mine"


async def test_two_overlapping_saves_of_the_same_version_apply_exactly_one(users):
    a, _ = users
    doc = new_doc()
    async with Session() as db:
        await create(db, a, doc)
    import asyncio
    docs = []
    for i in range(2):
        d = copy.deepcopy(doc)
        d["pages"][0]["elements"][0]["content"] = f"racer {i}"
        docs.append(d)

    async def go(d):
        async with Session() as db:
            try:
                return ("ok", (await update(db, a, doc["id"], d, 1)).version)
            except HTTPException as e:
                return ("conflict", e.status_code)

    results = await asyncio.gather(go(docs[0]), go(docs[1]))
    assert sorted(r[0] for r in results) == ["conflict", "ok"]
    async with Session() as db:
        assert (await car.get_carousel(doc["id"], db=db, user=a)).version == 2


async def test_creating_an_id_that_exists_is_refused_and_leaves_the_original_alone(users):
    a, _ = users
    doc = new_doc()
    async with Session() as db:
        await create(db, a, doc)
    clash = new_doc(doc["id"], title="Impostor")
    async with Session() as db:
        detail = await expect(409, "exists", create(db, a, clash, imported_from="browser"))
    assert detail["server_version"] == 1
    async with Session() as db:
        assert (await car.get_carousel(doc["id"], db=db, user=a)).title == "Tile tips"


async def test_a_save_for_one_id_cannot_smuggle_in_a_document_with_another_id(users):
    a, _ = users
    doc = new_doc()
    async with Session() as db:
        await create(db, a, doc)
        other = new_doc("car_someone_else")
        d = await expect(422, "invalid_document", update(db, a, doc["id"], other, 1))
    assert any("does not match" in e for e in d["errors"])


# ── validation, size, safety ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("mutate,needle", [
    (lambda d: d.update(kind="page"), "kind"),
    (lambda d: d.update(schemaVersion=2), "schemaVersion"),
    (lambda d: d.update(pages=[]), "at least one slide"),
    (lambda d: d.update(pages=d["pages"] * 7), "duplicate"),                             # 21 slides, but the ids repeat
    (lambda d: d["pages"][0].update(background={"kind": "plasma"}), "background"),
    (lambda d: d["pages"][0]["elements"][0].update(type="script"), "unknown element type"),
    (lambda d: d["pages"][1]["elements"][0].update(id=d["pages"][0]["elements"][0]["id"]), "duplicate element id"),
    (lambda d: d.update(title="x" * 300), "title"),
    (lambda d: d["format"].update(width=-5), "format"),
    (lambda d: d["pages"][0]["elements"][0].update(content="y" * 25_000), "longer than"),
])
async def test_malformed_documents_are_refused_with_a_clear_reason(users, mutate, needle):
    a, _ = users
    doc = new_doc()
    mutate(doc)
    async with Session() as db:
        d = await expect(422, "invalid_document", create(db, a, doc))
    assert any(needle in e for e in d["errors"]), d["errors"]
    async with Session() as db:
        assert await car.list_carousels(db=db, user=a) == []                          # nothing half-saved


async def test_inline_image_data_unsafe_urls_and_oversized_documents_are_refused(users):
    a, _ = users
    img = {"id": "i1", "type": "image", "role": "hero_image", "name": "Photo", "x": 0.1, "y": 0.1, "width": 0.5, "height": 0.3, "rotation": 0, "opacity": 1, "visible": True, "locked": False,
           "fit": "cover", "lockAspect": False}
    for url, needle in [("data:image/png;base64," + "A" * 200, "inline image data"), ("javascript:alert(1)", "relative path or an http"), ("//evil.example/x.png", "relative path or an http"),
                        ("file:///etc/passwd", "relative path or an http")]:
        doc = new_doc()
        doc["pages"][0]["elements"].append({**img, "source": {"kind": "asset", "url": url}})
        async with Session() as db:
            d = await expect(422, "invalid_document", create(db, a, doc))
        assert any(needle in e for e in d["errors"]), (url, d["errors"])
    big = new_doc()
    for i in range(1400):                                                            # many long (but individually legal) strings: the whole document exceeds the cap
        big["pages"][0]["elements"].append({**img, "id": f"big{i}", "alt": "z" * 19_000, "source": {"kind": "placeholder", "label": "x"}})
    async with Session() as db:
        d = await expect(422, "invalid_document", create(db, a, big))
    assert any("limit is" in e for e in d["errors"])


async def test_an_image_must_be_one_of_your_own_assets(users):
    a, b = users
    async with Session() as db:
        mine = Asset(user_id=a.id, original_filename="mine.png", stored_filename="m.png", file_path="uploads/%d/m.png" % a.id, file_type="image", mime_type="image/png", file_size=10)
        theirs = Asset(user_id=b.id, original_filename="theirs.png", stored_filename="t.png", file_path="uploads/%d/t.png" % b.id, file_type="image", mime_type="image/png", file_size=10)
        db.add_all([mine, theirs])
        await db.commit()
        await db.refresh(mine); await db.refresh(theirs)
    def with_asset(aid):
        d = new_doc()
        d["pages"][0]["elements"].append({"id": "pic", "type": "image", "role": "hero_image", "name": "Photo", "x": 0.1, "y": 0.1, "width": 0.5, "height": 0.3, "rotation": 0, "opacity": 1, "visible": True,
                                          "locked": False, "fit": "cover", "lockAspect": False, "source": {"kind": "asset", "assetId": aid, "url": f"/uploads/{a.id}/m.png"}})
        d["pages"][1]["background"] = {"kind": "image", "fit": "cover", "source": {"kind": "asset", "assetId": aid, "url": f"/uploads/{a.id}/m.png"}}
        return d
    async with Session() as db:
        await create(db, a, with_asset(mine.id))                                     # own asset: fine, in an element and as a background
        d = await expect(422, "invalid_document", create(db, a, with_asset(theirs.id)))
        assert "not in your media library" in d["errors"][0]
        await expect(422, "invalid_document", create(db, a, with_asset(99_999_999)))   # a missing id looks the same as someone else's
        await expect(422, "invalid_document", create(db, a, with_asset(True)))        # not a whole number
    async with Session() as db:
        for x in (mine, theirs):
            row = await db.get(Asset, x.id)
            await db.delete(row)
        await db.commit()


async def test_media_tokens_are_never_stored_and_the_owner_gets_a_fresh_one_when_reading(users):
    a, _ = users
    doc = new_doc()
    doc["pages"][0]["elements"].append({"id": "pic", "type": "image", "role": "hero_image", "name": "Photo", "x": 0.1, "y": 0.1, "width": 0.5, "height": 0.3, "rotation": 0, "opacity": 1, "visible": True,
                                        "locked": False, "fit": "cover", "lockAspect": False, "source": {"kind": "placeholder", "label": "x", "url": f"http://localhost:8000/uploads/{a.id}/pic.png?mt=SECRETTOKEN"}})
    async with Session() as db:
        await create(db, a, doc)
    async with Session() as db:
        raw = (await db.execute(select(CarouselDocument.document_json).where(CarouselDocument.doc_id == doc["id"]))).scalar_one()
        assert "SECRETTOKEN" not in json.dumps(raw) and "mt=" not in json.dumps(raw)
        opened = await car.get_carousel(doc["id"], db=db, user=a)
    url = opened.document["pages"][0]["elements"][-1]["source"]["url"]
    assert re.search(r"\?mt=[^&]+$", url) and "SECRETTOKEN" not in url


# ── duplicate / delete / limits ──────────────────────────────────────────────────────────────
async def test_duplicate_makes_an_independent_copy_with_its_own_id_and_delete_removes_only_that_one(users):
    a, _ = users
    doc = new_doc(slides=2)
    async with Session() as db:
        await create(db, a, doc, theme_id="ivory")
        copy_ = await car.duplicate_carousel(doc["id"], db=db, user=a)
    assert copy_.doc_id != doc["id"] and copy_.document["id"] == copy_.doc_id and copy_.title == "Tile tips (copy)" and copy_.version == 1 and copy_.origin == "duplicate"
    assert copy_.theme_id == "ivory" and [p["id"] for p in copy_.document["pages"]] == [p["id"] for p in doc["pages"]]
    edited = copy.deepcopy(copy_.document)
    edited["pages"][0]["elements"][0]["content"] = "Only in the copy"
    async with Session() as db:
        await update(db, a, copy_.doc_id, edited, 1)
        original = await car.get_carousel(doc["id"], db=db, user=a)
        assert original.document["pages"][0]["elements"][0]["content"] == "Slide 1 headline"
        await car.delete_carousel(copy_.doc_id, db=db, user=a)
    async with Session() as db:
        assert [s.doc_id for s in await car.list_carousels(db=db, user=a)] == [doc["id"]]
        await expect(404, None, car.get_carousel(copy_.doc_id, db=db, user=a))


async def test_the_per_user_limit_stops_creates_and_duplicates(users, monkeypatch):
    a, _ = users
    monkeypatch.setattr(car, "MAX_CAROUSELS_PER_USER", 2)
    async with Session() as db:
        await create(db, a, new_doc())
        await create(db, a, new_doc())
        await expect(409, "limit", create(db, a, new_doc()))
        first = (await car.list_carousels(db=db, user=a))[0]
        await expect(409, "limit", car.duplicate_carousel(first.doc_id, db=db, user=a))


async def test_deleting_a_user_removes_their_carousels_but_not_anyone_elses(users):
    a, b = users
    async with Session() as db:
        await create(db, a, new_doc())
        await create(db, b, new_doc())
    async with Session() as db:
        await db.delete(await db.get(User, a.id))
        await db.commit()
        left = (await db.execute(select(CarouselDocument.user_id))).scalars().all()
    assert a.id not in left and b.id in left


# ── HTTP: the real authentication dependency ─────────────────────────────────────────────────
def http_app() -> FastAPI:
    app = FastAPI()
    app.include_router(car.router, prefix="/carousels")
    async def override():
        async with Session() as s:
            yield s
    app.dependency_overrides[get_db] = override
    return app


def bearer(u: User) -> dict:
    return {"Authorization": f"Bearer {create_token(u.id, u.username, u.role, u.token_version)}"}


async def test_every_endpoint_requires_a_valid_session_and_isolates_users_over_http(users):
    a, b = users
    doc = new_doc()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=http_app()), base_url="http://t") as c:
        for method, url in [("GET", "/carousels/"), ("POST", "/carousels/"), ("GET", "/carousels/x"), ("PUT", "/carousels/x"), ("DELETE", "/carousels/x"), ("POST", "/carousels/x/duplicate")]:
            r = await c.request(method, url, json={})
            assert r.status_code in (401, 403), (method, url, r.status_code)
            r = await c.request(method, url, json={}, headers={"Authorization": "Bearer not-a-token"})
            assert r.status_code == 401, (method, url)
        r = await c.post("/carousels/", json={"document": doc, "theme_id": "forest"}, headers=bearer(a))
        assert r.status_code == 201 and r.json()["version"] == 1
        assert (await c.get(f"/carousels/{doc['id']}", headers=bearer(a))).status_code == 200
        assert (await c.get(f"/carousels/{doc['id']}", headers=bearer(b))).status_code == 404
        assert (await c.get("/carousels/", headers=bearer(b))).json() == []
        r = await c.put(f"/carousels/{doc['id']}", json={"document": doc, "expected_version": 1}, headers=bearer(a))
        assert r.status_code == 200 and r.json()["version"] == 2
        r = await c.put(f"/carousels/{doc['id']}", json={"document": doc, "expected_version": 1}, headers=bearer(a))
        assert r.status_code == 409 and r.json()["detail"]["code"] == "version_conflict"
        assert (await c.delete(f"/carousels/{doc['id']}", headers=bearer(b))).status_code == 404
        assert (await c.delete(f"/carousels/{doc['id']}", headers=bearer(a))).status_code == 204


async def test_an_oversized_request_is_refused_before_it_is_read(users):
    a, _ = users
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=http_app()), base_url="http://t") as c:
        r = await c.post("/carousels/", content=b"{}", headers={**bearer(a), "content-length": str(30_000_000), "content-type": "application/json"})
        assert r.status_code == 413


# ── migration ────────────────────────────────────────────────────────────────────────────────
async def test_the_sql_migration_matches_the_model_and_is_idempotent():
    sql = (Path(__file__).resolve().parents[1] / "migrations" / "2026-11-19_carousel_documents.sql").read_text(encoding="utf8")
    async with _engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS mig_check CASCADE"))
        await conn.execute(text("CREATE SCHEMA mig_check"))
        await conn.execute(text("SET LOCAL search_path TO mig_check"))
        await conn.execute(text("CREATE TABLE users (id SERIAL PRIMARY KEY)"))
        for _ in range(2):                                                           # applying twice must be harmless
            for stmt in [s.strip() for s in re.sub(r"--[^\n]*", "", sql).split(";") if s.strip()]:
                await conn.execute(text(stmt))
        q = text("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema=:s AND table_name='carousel_documents' ORDER BY column_name")
        mig = (await conn.execute(q, {"s": "mig_check"})).all()
        real = (await conn.execute(q, {"s": "public"})).all()
        idx = text("SELECT indexname FROM pg_indexes WHERE schemaname=:s AND tablename='carousel_documents' ORDER BY indexname")
        mig_idx = (await conn.execute(idx, {"s": "mig_check"})).scalars().all()
        real_idx = (await conn.execute(idx, {"s": "public"})).scalars().all()
        await conn.execute(text("DROP SCHEMA mig_check CASCADE"))
    assert [tuple(r) for r in mig] == [tuple(r) for r in real]                       # same columns, types and nullability as the application's own table
    assert mig_idx == real_idx and "uq_carousel_user_doc" in mig_idx and "ix_carousel_user_updated" in mig_idx
    assert not re.search(r"\b(DROP TABLE|ALTER TABLE|DELETE FROM|UPDATE |TRUNCATE)\b", re.sub(r"--[^\n]*", "", sql), re.I)   # the migration only ever creates


def test_extract_metadata_and_validation_are_pure_and_do_not_mutate_the_input():
    doc = new_doc()
    doc["pages"][0]["elements"][0]["content"] = "keep"
    before = json.dumps(doc, sort_keys=True)
    cleaned, assets = cv.validate_document(doc, doc["id"])
    assert json.dumps(doc, sort_keys=True) == before and assets == set()
    assert cv.extract_metadata(cleaned)["slide_count"] == 3
    with pytest.raises(cv.CarouselValidationError):
        cv.validate_document("not a dict")


# ── no slide-count limit ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("slides", [21, 100, 400])
async def test_there_is_no_slide_count_limit_only_a_size_bound(users, slides):
    a, _ = users
    async with Session() as db:
        doc = new_doc(slides=slides)
        created = await create(db, a, doc)
        assert created.slide_count == slides
        got = await car.get_carousel(doc["id"], db=db, user=a)
        assert [p["id"] for p in got.document["pages"]] == [p["id"] for p in doc["pages"]]
        ack = await update(db, a, doc["id"], dict(doc, title="Still saves"), 1)
        assert ack.version == 2 and ack.slide_count == slides


async def test_a_carousel_must_still_have_at_least_one_slide_and_an_unreasonable_size_is_still_refused(users):
    a, _ = users
    async with Session() as db:
        with pytest.raises(HTTPException) as e:
            await create(db, a, dict(new_doc(), pages=[]))
        assert e.value.status_code == 422
        huge = new_doc(slides=3)
        huge["pages"][0]["elements"][0]["content"] = "x" * 19_000
        huge["pages"] = huge["pages"] + [dict(copy.deepcopy(huge["pages"][0]), id=f"huge_{i}", elements=[dict(copy.deepcopy(huge["pages"][0]["elements"][0]), id=f"huge_{i}_t") ]) for i in range(1400)]
        with pytest.raises(HTTPException) as e:
            await create(db, a, huge)
        assert e.value.status_code == 422
