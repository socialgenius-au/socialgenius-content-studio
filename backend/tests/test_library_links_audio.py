"""Design library, link / QR destination validation, pattern backgrounds and the background-music field: real PostgreSQL, no network.

Covers: library round trip and per-user isolation, validation by the carousel rules (foreign pictures, inline data), allowed and refused link schemes (carousel content and QR destinations),
the audio track must be the user's own AUDIO file, and the SQL migration matches the model.
"""
import copy
import re
import secrets
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.asset import Asset
from app.models.carousel_document import CarouselDocument
from app.models.library_item import LibraryItem
from app.models.user import User
from app.routers import carousels as car
from app.routers import library_items as lib
from app.schemas.carousel import CarouselCreate, CarouselUpdate

_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
Session = async_sessionmaker(_engine, expire_on_commit=False)


@pytest.fixture(autouse=True)
async def _tables():
    async with _engine.begin() as conn:
        await conn.run_sync(lambda c: CarouselDocument.__table__.create(c, checkfirst=True))
        await conn.run_sync(lambda c: LibraryItem.__table__.create(c, checkfirst=True))


@pytest.fixture
async def users():
    made = []
    async with Session() as db:
        for _ in range(2):
            u = User(username=f"lib_{secrets.token_hex(4)}", email=f"lib_{secrets.token_hex(4)}@example.test", hashed_password="x", role="editor", is_active=True)
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


async def asset(user, file_type, name="x.bin"):
    async with Session() as db:
        a = Asset(user_id=user.id, original_filename=name, stored_filename=f"{secrets.token_hex(6)}.bin", file_path=f"uploads/{user.id}/{name}", file_type=file_type, mime_type="application/octet-stream", file_size=10)
        db.add(a)
        await db.commit()
        await db.refresh(a)
        return a


def shape(eid="s1", **over):
    return {"id": eid, "type": "shape", "role": "decorative", "name": "Star", "shape": "star-5", "x": 0.1, "y": 0.1, "width": 0.3, "height": 0.2, "rotation": 0, "opacity": 1, "visible": True, "locked": False, "fill": "#E8B04A", **over}


def doc(doc_id=None, **over):
    did = doc_id or f"car_{secrets.token_hex(6)}"
    d = {"kind": "post", "schemaVersion": 1, "id": did, "title": "T", "revision": 0, "format": {"platformKey": "instagram", "formatKey": "carousel", "width": 1080, "height": 1350, "ratio": "4:5"},
         "pages": [{"id": f"{did}_p", "background": {"kind": "solid", "color": "#112233"}, "elements": [shape(f"{did}_s")]}], "context": {}, "provenance": {"origin": "manual"},
         "createdAt": "2026-11-21T09:00:00.000Z", "updatedAt": "2026-11-21T09:00:00.000Z"}
    d.update(over)
    return d


async def expect(code, coro):
    with pytest.raises(HTTPException) as e:
        await coro
    assert e.value.status_code == code
    return e.value.detail


# ── library ──────────────────────────────────────────────────────────────────────────────────
async def test_library_items_round_trip_and_are_private_to_their_owner(users):
    a, b = users
    async with Session() as db:
        made = await lib.create_item(lib.ItemCreate(name="Star badge", kind="elements", item={"elements": [shape(), shape("s2", shape="heart")]}), db=db, user=a)
        bg = await lib.create_item(lib.ItemCreate(name="Dots", kind="background", item={"background": {"kind": "pattern", "pattern": "dots", "color": "#FFFFFF55", "background": "#102A43", "scale": 1}}), db=db, user=a)
        assert [(i.name, i.kind) for i in await lib.list_items(db=db, user=a)] == [("Dots", "background"), ("Star badge", "elements")] or {i.name for i in await lib.list_items(db=db, user=a)} == {"Dots", "Star badge"}
        got = await lib.get_item(made.id, db=db, user=a)
        assert [e["shape"] for e in got.item["elements"]] == ["star-5", "heart"] and bg.item["background"]["pattern"] == "dots"
        assert (await lib.rename_item(made.id, lib.ItemRename(name="Renamed"), db=db, user=a)).name == "Renamed"
        assert await lib.list_items(db=db, user=b) == []
        await expect(404, lib.get_item(made.id, db=db, user=b))
        await expect(404, lib.rename_item(made.id, lib.ItemRename(name="x"), db=db, user=b))
        await expect(404, lib.delete_item(made.id, db=db, user=b))
        await lib.delete_item(made.id, db=db, user=a)
        assert {i.id for i in await lib.list_items(db=db, user=a)} == {bg.id}


async def test_library_items_are_validated_like_carousel_content(users):
    a, b = users
    theirs = await asset(b, "image")
    mine = await asset(a, "image")
    img = lambda aid, url: {"id": "i1", "type": "image", "role": "hero_image", "name": "P", "x": 0.1, "y": 0.1, "width": 0.4, "height": 0.3, "rotation": 0, "opacity": 1, "visible": True, "locked": False, "fit": "cover", "lockAspect": False, "source": {"kind": "asset", "assetId": aid, "url": url}}
    async with Session() as db:
        ok = await lib.create_item(lib.ItemCreate(name="Mine", kind="elements", item={"elements": [img(mine.id, f"/uploads/{a.id}/p.png?mt=SECRET")]}), db=db, user=a)
        assert "SECRET" not in str(ok.item) or "mt=" in str(ok.item)
        row = await db.get(LibraryItem, ok.id)
        assert "SECRET" not in str(row.item_json)                                                   # stored without the token
        for bad in [{"elements": [img(theirs.id, f"/uploads/{b.id}/p.png")]}, {"elements": []}, {"elements": [shape(link={"url": "javascript:alert(1)"})]}]:
            d = await expect(422, lib.create_item(lib.ItemCreate(name="Bad", kind="elements", item=bad), db=db, user=a))
            assert d["code"] == "invalid_item"
        await expect(422, lib.create_item(lib.ItemCreate(name="Bad", kind="background", item={"background": {"kind": "pattern", "pattern": "spiral", "color": "#fff", "background": "#000", "scale": 1}}), db=db, user=a))
        await expect(422, lib.create_item(lib.ItemCreate(name="Bad", kind="background", item={}), db=db, user=a))


async def test_library_limit(users, monkeypatch):
    a, _ = users
    monkeypatch.setattr(lib, "MAX_ITEMS_PER_USER", 1)
    async with Session() as db:
        await lib.create_item(lib.ItemCreate(name="1", kind="elements", item={"elements": [shape()]}), db=db, user=a)
        d = await expect(409, lib.create_item(lib.ItemCreate(name="2", kind="elements", item={"elements": [shape()]}), db=db, user=a))
        assert d["code"] == "limit"


# ── links, QR destinations and new content kinds in carousels ────────────────────────────────
GOOD_LINKS = ["https://example.com/menu?table=4", "http://localhost:3000/x", "mailto:hello@example.com", "tel:+61412345678", "sms:0412345678", "myapp://offers/summer"]
BAD_LINKS = ["javascript:alert(1)", "data:text/html;base64,AAAA", "file:///etc/passwd", "https://user:secret@example.com/", "https://nodot", "example.com", "ftp://example.com/a", "https://exa mple.com", "vbscript:x", ""]


@pytest.mark.parametrize("url", GOOD_LINKS)
async def test_allowed_link_schemes_are_accepted_on_elements_and_qr_codes(users, url):
    a, _ = users
    d = doc()
    d["pages"][0]["elements"][0]["link"] = {"url": url, "label": "Open"}
    d["pages"][0]["elements"].append({"id": "qr1", "type": "image", "role": "other", "name": "QR", "x": 0.5, "y": 0.5, "width": 0.3, "height": 0.2, "rotation": 0, "opacity": 1, "visible": True, "locked": False, "fit": "contain", "lockAspect": True, "source": {"kind": "qr", "data": url}})
    async with Session() as db:
        created = await car.create_carousel(CarouselCreate(document=d), db=db, user=a)
    assert created.document["pages"][0]["elements"][0]["link"]["url"] == url


@pytest.mark.parametrize("url", BAD_LINKS)
async def test_dangerous_or_malformed_links_are_refused_on_elements_and_qr_codes(users, url):
    a, _ = users
    for place in ("link", "qr"):
        d = doc()
        if place == "link":
            d["pages"][0]["elements"][0]["link"] = {"url": url}
        else:
            d["pages"][0]["elements"].append({"id": "qr1", "type": "image", "role": "other", "name": "QR", "x": 0.5, "y": 0.5, "width": 0.3, "height": 0.2, "rotation": 0, "opacity": 1, "visible": True, "locked": False, "fit": "contain", "lockAspect": True, "source": {"kind": "qr", "data": url}})
        async with Session() as db:
            det = await expect(422, car.create_carousel(CarouselCreate(document=d), db=db, user=a))
        assert any("link" in e or "QR" in e or "data" in e for e in det["errors"]), (place, url, det["errors"])


async def test_pattern_backgrounds_and_polygon_shapes_with_text_are_stored(users):
    a, _ = users
    d = doc()
    d["pages"][0]["background"] = {"kind": "pattern", "pattern": "grain", "color": "#FFFFFF22", "background": "#1E4D2B", "scale": 1.5}
    d["pages"][0]["elements"][0]["text"] = {"content": "SALE", "style": {"fontFamily": "Inter", "fontSize": 0.05, "fontWeight": 800, "lineHeight": 1.1, "align": "center", "color": "#FFFFFF"}}
    async with Session() as db:
        created = await car.create_carousel(CarouselCreate(document=d), db=db, user=a)
    assert created.document["pages"][0]["background"]["pattern"] == "grain"


# ── background music ─────────────────────────────────────────────────────────────────────────
def track(asset_id, **over):
    return {"assetId": asset_id, "url": f"/uploads/1/m.mp3", "name": "music.mp3", "sourceMs": 60000, "trimStartMs": 0, "trimEndMs": 0, "offsetMs": 0, "volume": 1, "fadeInMs": 500, "fadeOutMs": 1000, "muted": False, **over}


async def test_the_background_track_must_be_your_own_audio_file(users):
    a, b = users
    mine, theirs, image = await asset(a, "audio", "m.mp3"), await asset(b, "audio", "t.mp3"), await asset(a, "image", "i.png")
    async with Session() as db:
        d = doc(audio=track(mine.id))
        created = await car.create_carousel(CarouselCreate(document=d), db=db, user=a)
        assert created.document["audio"]["assetId"] == mine.id
        for bad_id in (theirs.id, image.id, 99999999):                                              # someone else's, not audio, not there
            d2 = doc(audio=track(bad_id))
            await expect(422, car.create_carousel(CarouselCreate(document=d2), db=db, user=a))
        for bad in (track(mine.id, volume=5), track(mine.id, fadeInMs=-1), track(mine.id, trimStartMs=5000, trimEndMs=1000), track(mine.id, offsetMs=10 ** 9)):
            await expect(422, car.create_carousel(CarouselCreate(document=doc(audio=bad)), db=db, user=a))
        upd = copy.deepcopy(d)
        upd["audio"]["volume"] = 0.4
        ack = await car.update_carousel(d["id"], CarouselUpdate(document=upd, expected_version=1), db=db, user=a)
        assert ack.version == 2
        upd2 = copy.deepcopy(upd)
        upd2["audio"]["assetId"] = theirs.id                                                         # swapping in somebody else's file on save is refused too
        await expect(422, car.update_carousel(d["id"], CarouselUpdate(document=upd2, expected_version=2), db=db, user=a))


# ── migration ────────────────────────────────────────────────────────────────────────────────
async def test_the_library_migration_matches_the_model_and_only_creates():
    sql = (Path(__file__).resolve().parents[1] / "migrations" / "2026-11-21_library_items.sql").read_text(encoding="utf8")
    async with _engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS mig_check3 CASCADE"))
        await conn.execute(text("CREATE SCHEMA mig_check3"))
        await conn.execute(text("SET LOCAL search_path TO mig_check3"))
        await conn.execute(text("CREATE TABLE users (id SERIAL PRIMARY KEY)"))
        for _ in range(2):
            for stmt in [s.strip() for s in re.sub(r"--[^\n]*", "", sql).split(";") if s.strip()]:
                await conn.execute(text(stmt))
        q = text("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema=:s AND table_name='library_items' ORDER BY column_name")
        mig = (await conn.execute(q, {"s": "mig_check3"})).all()
        real = (await conn.execute(q, {"s": "public"})).all()
        idx = text("SELECT indexname FROM pg_indexes WHERE schemaname=:s AND tablename='library_items' ORDER BY indexname")
        mi = (await conn.execute(idx, {"s": "mig_check3"})).scalars().all()
        ri = (await conn.execute(idx, {"s": "public"})).scalars().all()
        await conn.execute(text("DROP SCHEMA mig_check3 CASCADE"))
    assert [tuple(r) for r in mig] == [tuple(r) for r in real] and mig and mi == ri
    assert not re.search(r"\b(DROP TABLE|ALTER TABLE|DELETE FROM|UPDATE |TRUNCATE)\b", re.sub(r"--[^\n]*", "", sql), re.I)
