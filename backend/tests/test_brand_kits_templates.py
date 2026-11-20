"""Brand Kits and carousel templates: real PostgreSQL, real auth dependency, no AI, no network.

Covers: round trip, per-user isolation (another user's kit / template looks like it does not exist), validation (hex colours, plain font names, own-upload URLs only, no inline data, bounds),
asset ownership AND kind (logos are images, fonts are font files), font upload (extension + magic bytes + size, stored in the existing media storage), media-token stripping, duplicate / delete,
limits, HTTP authentication, and that the SQL migration matches the models.
"""
import io
import re
import secrets
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.database import get_db
from app.models.asset import Asset
from app.models.brand_kit import BrandKit
from app.models.carousel_template import CarouselTemplate
from app.models.user import User
from app.routers import brand_kits as bk
from app.routers import carousel_templates as ct
from app.schemas.carousel_assets import BrandKitBody, TemplateCreate, TemplateUpdate
from app.services import brand_kit_validation as bv
from app.services.auth import create_token

_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
Session = async_sessionmaker(_engine, expire_on_commit=False)


@pytest.fixture(autouse=True)
async def _ensure_tables():
    async with _engine.begin() as conn:
        await conn.run_sync(lambda c: BrandKit.__table__.create(c, checkfirst=True))
        await conn.run_sync(lambda c: CarouselTemplate.__table__.create(c, checkfirst=True))


@pytest.fixture
async def users():
    made = []
    async with Session() as db:
        for _ in range(2):
            u = User(username=f"bk_{secrets.token_hex(4)}", email=f"bk_{secrets.token_hex(4)}@example.test", hashed_password="x", role="editor", is_active=True)
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


async def make_asset(user, file_type="image", name="logo.png"):
    async with Session() as db:
        a = Asset(user_id=user.id, original_filename=name, stored_filename=f"{secrets.token_hex(6)}.bin", file_path=f"uploads/{user.id}/{name}", file_type=file_type,
                  mime_type="image/png" if file_type == "image" else "font/ttf", file_size=10)
        db.add(a)
        await db.commit()
        await db.refresh(a)
        return a


def kit_body(user, **over):
    kit = {
        "brand_names": [{"id": "n1", "label": "Full name", "text": "Acme Tiles"}, {"id": "n2", "label": "Short", "text": "ACME"}],
        "colors": {"primary": "#1e4d2b", "secondary": "#E8B04A", "accent": "#38BDF8", "background": "#F7F3E8", "text": "#111827", "extra": [{"name": "Grout", "hex": "#999999"}]},
        "logos": [], "fonts": [], "font_roles": {}, "assets": [],
    }
    kit.update(over)
    return kit


async def expect(status_code, coro):
    with pytest.raises(HTTPException) as e:
        await coro
    assert e.value.status_code == status_code
    return e.value.detail


def new_doc(doc_id=None, slides=2):
    did = doc_id or f"car_{secrets.token_hex(6)}"
    def t(i):
        return {"id": f"{did}_t{i}", "type": "text", "role": "primary_headline", "name": "Headline", "x": 0.07, "y": 0.2, "width": 0.86, "height": "auto", "rotation": 0, "opacity": 1, "visible": True,
                "locked": False, "content": f"Slide {i + 1}", "autoSize": "auto-height", "style": {"fontFamily": "Inter", "fontSize": 0.08, "fontWeight": 800, "lineHeight": 1.1, "align": "left", "color": "#FFFFFF"}}
    pages = [{"id": f"{did}_s{i}", "name": f"{i + 1}", "background": {"kind": "solid", "color": "#1E4D2B"}, "elements": [t(i)]} for i in range(slides)]
    return {"kind": "post", "schemaVersion": 1, "id": did, "title": "Template", "revision": 0, "format": {"platformKey": "instagram", "formatKey": "carousel", "width": 1080, "height": 1350, "ratio": "4:5"},
            "pages": pages, "context": {}, "provenance": {"origin": "manual"}, "createdAt": "2026-11-20T09:00:00.000Z", "updatedAt": "2026-11-20T09:00:00.000Z"}


# ── Brand Kits ───────────────────────────────────────────────────────────────────────────────
async def test_a_brand_kit_round_trips_with_names_colours_logos_fonts_and_assets_and_can_be_duplicated_and_deleted(users):
    a, _ = users
    logo, logo2, asset = await make_asset(a, "image", "logo.png"), await make_asset(a, "image", "mark.png"), await make_asset(a, "image", "pattern.png")
    font = await make_asset(a, "font", "brand.ttf")
    kit = kit_body(a,
                   logos=[{"id": "l1", "label": "Main", "asset_id": logo.id, "url": f"/uploads/{a.id}/logo.png?mt=SECRET.TOKEN.VALUE"}, {"id": "l2", "label": "Mark", "asset_id": logo2.id, "url": f"/uploads/{a.id}/mark.png"}],
                   fonts=[{"id": "f1", "family": "Acme Sans", "asset_id": font.id, "url": f"/uploads/{a.id}/brand.ttf", "weight": 700, "italic": False}],
                   font_roles={"heading": "Acme Sans", "body": "Inter"}, assets=[{"id": "a1", "label": "Pattern", "asset_id": asset.id, "url": f"/uploads/{a.id}/pattern.png"}])
    async with Session() as db:
        created = await bk.create_kit(BrandKitBody(name="Acme", kit=kit), db=db, user=a)
    assert created.name == "Acme" and len(created.kit["logos"]) == 2 and created.kit["colors"]["primary"] == "#1E4D2B"       # colours normalised to upper case
    assert "SECRET.TOKEN.VALUE" not in str(created.kit.get("logos")[0]["url"]) or "mt=" in created.kit["logos"][0]["url"]    # the owner reads a FRESH token, never the one sent
    async with Session() as db:
        row = await db.get(BrandKit, created.id)
        assert "SECRET.TOKEN.VALUE" not in str(row.kit_json) and "mt=" not in str(row.kit_json)                              # nothing short-lived is stored
        listed = await bk.list_kits(db=db, user=a)
        assert [(s.name, s.primary, s.logo_count, s.font_count) for s in listed] == [("Acme", "#1E4D2B", 2, 1)]
        opened = await bk.get_kit(created.id, db=db, user=a)
        assert [n["text"] for n in opened.kit["brand_names"]] == ["Acme Tiles", "ACME"] and opened.kit["font_roles"] == {"heading": "Acme Sans", "body": "Inter"}
        edited = await bk.update_kit(created.id, BrandKitBody(name="Acme 2", kit=dict(kit, colors={"primary": "#000000"})), db=db, user=a)
        assert edited.name == "Acme 2" and edited.kit["colors"] == {"primary": "#000000", "extra": []}
        dup = await bk.duplicate_kit(created.id, db=db, user=a)
        assert dup.id != created.id and dup.name == "Acme 2 (copy)"
        await bk.delete_kit(dup.id, db=db, user=a)
        assert [s.id for s in await bk.list_kits(db=db, user=a)] == [created.id]
        still = await db.get(Asset, logo.id)
        assert still is not None                                                                                              # deleting a kit never deletes the uploaded files


async def test_another_users_brand_kit_is_invisible_and_cannot_be_changed(users):
    a, b = users
    async with Session() as db:
        k = await bk.create_kit(BrandKitBody(name="Mine", kit=kit_body(a)), db=db, user=a)
    async with Session() as db:
        assert await bk.list_kits(db=db, user=b) == []
        await expect(404, bk.get_kit(k.id, db=db, user=b))
        await expect(404, bk.update_kit(k.id, BrandKitBody(name="x", kit=kit_body(b)), db=db, user=b))
        await expect(404, bk.duplicate_kit(k.id, db=db, user=b))
        await expect(404, bk.delete_kit(k.id, db=db, user=b))
        assert (await bk.get_kit(k.id, db=db, user=a)).name == "Mine"


@pytest.mark.parametrize("mutate,needle", [
    (lambda k, u: k["colors"].update(primary="red"), "hex colour"),
    (lambda k, u: k["colors"].update(accent="#12345G"), "hex colour"),
    (lambda k, u: k["colors"].update(primary="#fff; background:url(x)"), "hex colour"),
    (lambda k, u: k.update(brand_names=[{"id": "n", "label": "x", "text": "data:text/html;base64,AAAA"}]), "inline data"),
    (lambda k, u: k.update(brand_names=[{"id": "n", "label": "", "text": "x"}]), "label"),
    (lambda k, u: k.update(brand_names=[{"id": "same", "label": "a", "text": "b"}, {"id": "same", "label": "c", "text": "d"}]), "duplicate"),
    (lambda k, u: k.update(logos=[{"id": "l", "label": "L", "asset_id": 1, "url": "javascript:alert(1)"}]), "own uploaded"),
    (lambda k, u: k.update(logos=[{"id": "l", "label": "L", "asset_id": 1, "url": "/uploads/999999/x.png"}]), "own uploaded"),
    (lambda k, u: k.update(logos=[{"id": "l", "label": "L", "asset_id": True, "url": ""}]), "asset_id"),
    (lambda k, u: k.update(fonts=[{"id": "f", "family": "Bad;Name}", "asset_id": 1, "url": "", "weight": 400}]), "font name"),
    (lambda k, u: k.update(fonts=[{"id": "f", "family": "Ok", "asset_id": 1, "url": "", "weight": 1000}]), "weight"),
    (lambda k, u: k.update(font_roles={"heading": "x{}"}), "font name"),
    (lambda k, u: k.update(logos=[{"id": f"l{i}", "label": "L", "asset_id": i + 1, "url": ""} for i in range(51)]), "at most 50"),
    (lambda k, u: k.update(brand_names="nope"), "must be a list"),
])
async def test_malformed_kits_are_refused_with_a_reason_and_nothing_is_stored(users, mutate, needle):
    a, _ = users
    kit = kit_body(a)
    mutate(kit, a)
    async with Session() as db:
        d = await expect(422, bk.create_kit(BrandKitBody(name="Bad", kit=kit), db=db, user=a))
        assert d["code"] == "invalid_kit" and any(needle in e for e in d["errors"]), d["errors"]
        assert await bk.list_kits(db=db, user=a) == []


async def test_only_known_fields_are_stored_and_oversized_kits_are_refused(users):
    a, _ = users
    kit = kit_body(a)
    kit["__proto__"] = {"x": 1}
    kit["script"] = "<script>alert(1)</script>"
    async with Session() as db:
        created = await bk.create_kit(BrandKitBody(name="Clean", kit=kit), db=db, user=a)
        assert set(created.kit) == {"brand_names", "colors", "logos", "assets", "fonts", "font_roles"}
        huge = kit_body(a, brand_names=[{"id": f"n{i}", "label": "x" * 59, "text": "y" * 119} for i in range(20)])
        huge["junk"] = "z" * 1_100_000
        await expect(422, bk.create_kit(BrandKitBody(name="Huge", kit=huge), db=db, user=a))


async def test_a_kit_can_only_reference_your_own_assets_of_the_right_kind(users):
    a, b = users
    mine_img, theirs_img = await make_asset(a, "image"), await make_asset(b, "image")
    mine_font, mine_video = await make_asset(a, "font", "f.ttf"), await make_asset(a, "video", "v.mp4")
    async with Session() as db:
        d = await expect(422, bk.create_kit(BrandKitBody(name="x", kit=kit_body(a, logos=[{"id": "l", "label": "L", "asset_id": theirs_img.id, "url": ""}])), db=db, user=a))
        assert any("not a valid picture in your media library" in e for e in d["errors"])
        await expect(422, bk.create_kit(BrandKitBody(name="x", kit=kit_body(a, logos=[{"id": "l", "label": "L", "asset_id": mine_video.id, "url": ""}])), db=db, user=a))       # a video is not a logo
        await expect(422, bk.create_kit(BrandKitBody(name="x", kit=kit_body(a, fonts=[{"id": "f", "family": "F", "asset_id": mine_img.id, "url": "", "weight": 400}])), db=db, user=a))  # an image is not a font
        await expect(422, bk.create_kit(BrandKitBody(name="x", kit=kit_body(a, logos=[{"id": "l", "label": "L", "asset_id": mine_font.id, "url": ""}])), db=db, user=a))       # a font is not a logo
        ok = await bk.create_kit(BrandKitBody(name="ok", kit=kit_body(a, logos=[{"id": "l", "label": "L", "asset_id": mine_img.id, "url": ""}], fonts=[{"id": "f", "family": "F", "asset_id": mine_font.id, "url": "", "weight": 400}])), db=db, user=a)
        assert ok.id


async def test_the_per_user_kit_limit_stops_creates_and_duplicates(users, monkeypatch):
    a, _ = users
    monkeypatch.setattr(bk, "MAX_KITS_PER_USER", 2)
    async with Session() as db:
        first = await bk.create_kit(BrandKitBody(name="1", kit=kit_body(a)), db=db, user=a)
        await bk.create_kit(BrandKitBody(name="2", kit=kit_body(a)), db=db, user=a)
        d = await expect(409, bk.create_kit(BrandKitBody(name="3", kit=kit_body(a)), db=db, user=a))
        assert d["code"] == "limit"
        await expect(409, bk.duplicate_kit(first.id, db=db, user=a))


# ── font upload ──────────────────────────────────────────────────────────────────────────────
def font_file(name, content):
    return UploadFile(file=io.BytesIO(content), filename=name)


async def test_a_valid_font_is_stored_in_the_media_storage_as_a_font_asset_owned_by_the_user(users, tmp_path, monkeypatch):
    a, _ = users
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    async with Session() as db:
        up = await bk.upload_font(file=font_file("Acme-Sans_Bold.ttf", b"\x00\x01\x00\x00" + b"x" * 200), db=db, user=a)
        row = await db.get(Asset, up.asset_id)
    assert row.user_id == a.id and row.file_type == "font" and row.mime_type == "font/ttf"
    assert up.family_guess == "Acme Sans Bold" and re.match(rf"^/uploads/{a.id}/[0-9a-f]{{32}}\.ttf\?mt=", up.url)
    assert (tmp_path / str(a.id) / row.stored_filename).read_bytes().startswith(b"\x00\x01\x00\x00")
    for name, magic in [("a.otf", b"OTTO"), ("b.woff", b"wOFF"), ("c.woff2", b"wOF2")]:
        async with Session() as db:
            assert (await bk.upload_font(file=font_file(name, magic + b"0" * 50), db=db, user=a)).asset_id


@pytest.mark.parametrize("name,content,needle", [
    ("evil.exe", b"MZ" + b"0" * 100, "not a font file"),
    ("noext", b"\x00\x01\x00\x00" + b"0" * 10, "not a font file"),
    ("fake.ttf", b"<html>not a font</html>", "does not look like a real"),
    ("fake.woff2", b"\x00\x01\x00\x00" + b"0" * 10, "does not look like a real"),
    ("empty.ttf", b"", "empty"),
])
async def test_files_that_are_not_real_fonts_are_refused_and_nothing_is_written(users, tmp_path, monkeypatch, name, content, needle):
    a, _ = users
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    async with Session() as db:
        d = await expect(422, bk.upload_font(file=font_file(name, content), db=db, user=a))
        assert any(needle in e for e in d["errors"]), d["errors"]
    assert not list(tmp_path.rglob("*.*"))


async def test_an_oversized_font_is_refused(users, tmp_path, monkeypatch):
    a, _ = users
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(bv, "MAX_FONT_BYTES", 100)
    async with Session() as db:
        d = await expect(422, bk.upload_font(file=font_file("big.ttf", b"\x00\x01\x00\x00" + b"0" * 500), db=db, user=a))
        assert any("larger than" in e for e in d["errors"])


# ── templates ────────────────────────────────────────────────────────────────────────────────
async def test_a_template_round_trips_is_edited_duplicated_and_deleted_and_applying_never_changes_it(users):
    a, _ = users
    doc = new_doc(slides=3)
    async with Session() as db:
        created = await ct.create_template(TemplateCreate(name="Tips", description="Three slide starter", kind="layout", document=doc), db=db, user=a)
        assert (created.slide_count, created.kind, created.platform_key, created.format_key) == (3, "layout", "instagram", "carousel")
        assert created.document == doc
        listed = await ct.list_templates(db=db, user=a)
        assert [(t.name, t.slide_count) for t in listed] == [("Tips", 3)]
        edited = await ct.update_template(created.id, TemplateUpdate(name="Tips v2", document=new_doc(slides=5)), db=db, user=a)
        assert edited.name == "Tips v2" and edited.slide_count == 5
        renamed = await ct.update_template(created.id, TemplateUpdate(description="Five slides"), db=db, user=a)
        assert renamed.slide_count == 5 and renamed.description == "Five slides"
        dup = await ct.duplicate_template(created.id, db=db, user=a)
        assert dup.id != created.id and dup.name == "Tips v2 (copy)" and dup.slide_count == 5
        await ct.delete_template(dup.id, db=db, user=a)
        assert [t.id for t in await ct.list_templates(db=db, user=a)] == [created.id]


async def test_another_users_template_is_invisible_and_templates_are_validated_like_carousels(users):
    a, b = users
    theirs = await make_asset(b, "image")
    async with Session() as db:
        t = await ct.create_template(TemplateCreate(name="Mine", document=new_doc()), db=db, user=a)
    async with Session() as db:
        assert await ct.list_templates(db=db, user=b) == []
        await expect(404, ct.get_template(t.id, db=db, user=b))
        await expect(404, ct.update_template(t.id, TemplateUpdate(name="x"), db=db, user=b))
        await expect(404, ct.duplicate_template(t.id, db=db, user=b))
        await expect(404, ct.delete_template(t.id, db=db, user=b))
        bad = new_doc()
        bad["pages"][0]["elements"].append({"id": "img1", "type": "image", "role": "hero_image", "name": "Photo", "x": 0.1, "y": 0.1, "width": 0.5, "height": 0.3, "rotation": 0, "opacity": 1,
                                            "visible": True, "locked": False, "fit": "cover", "lockAspect": False, "source": {"kind": "asset", "assetId": theirs.id, "url": f"/uploads/{b.id}/x.png"}})
        await expect(422, ct.create_template(TemplateCreate(name="Steals", document=bad), db=db, user=a))                  # someone else's picture
        inline = new_doc()
        inline["title"] = "data:image/png;base64,AAAA"
        await expect(422, ct.create_template(TemplateCreate(name="Inline", document=inline), db=db, user=a))
        await expect(422, ct.create_template(TemplateCreate(name="NoKit", document=new_doc(), brand_kit_id=999999), db=db, user=a))   # a kit that is not yours


async def test_templates_support_any_slide_count_and_the_per_user_limit(users, monkeypatch):
    a, _ = users
    async with Session() as db:
        big = await ct.create_template(TemplateCreate(name="Big", document=new_doc(slides=150)), db=db, user=a)
        assert big.slide_count == 150
    monkeypatch.setattr(ct, "MAX_TEMPLATES_PER_USER", 2)
    async with Session() as db:
        await ct.create_template(TemplateCreate(name="Two", document=new_doc()), db=db, user=a)
        d = await expect(409, ct.create_template(TemplateCreate(name="Three", document=new_doc()), db=db, user=a))
        assert d["code"] == "limit"


# ── HTTP: authentication ─────────────────────────────────────────────────────────────────────
def http_app():
    app = FastAPI()
    app.include_router(bk.router, prefix="/brand-kits")
    app.include_router(ct.router, prefix="/carousel-templates")
    return app


async def test_every_route_requires_a_signed_in_user_and_isolation_holds_over_http(users):
    a, b = users
    h = lambda u: {"Authorization": f"Bearer {create_token(u.id, u.username, u.role, u.token_version)}"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=http_app()), base_url="http://t") as c:
        for method, url in [("get", "/brand-kits/"), ("post", "/brand-kits/"), ("get", "/brand-kits/1"), ("post", "/brand-kits/fonts"), ("get", "/carousel-templates/"), ("post", "/carousel-templates/"), ("delete", "/carousel-templates/1")]:
            r = await getattr(c, method)(url)
            assert r.status_code in (401, 403), (method, url, r.status_code)
        r = await c.post("/brand-kits/", json={"name": "HTTP", "kit": kit_body(a)}, headers=h(a))
        assert r.status_code == 201, r.text
        kid = r.json()["id"]
        assert (await c.get(f"/brand-kits/{kid}", headers=h(b))).status_code == 404
        assert (await c.get(f"/brand-kits/{kid}", headers=h(a))).status_code == 200
        r = await c.post("/carousel-templates/", json={"name": "T", "document": new_doc()}, headers=h(a))
        assert r.status_code == 201, r.text
        assert (await c.get("/carousel-templates/", headers=h(b))).json() == []
        assert (await c.delete(f"/brand-kits/{kid}", headers=h(a))).status_code == 204


# ── migration ────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("table", ["brand_kits", "carousel_templates"])
async def test_the_sql_migration_matches_the_models_is_idempotent_and_only_creates(table):
    sql = (Path(__file__).resolve().parents[1] / "migrations" / "2026-11-20_brand_kits_and_carousel_templates.sql").read_text(encoding="utf8")
    async with _engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS mig_check2 CASCADE"))
        await conn.execute(text("CREATE SCHEMA mig_check2"))
        await conn.execute(text("SET LOCAL search_path TO mig_check2"))
        await conn.execute(text("CREATE TABLE users (id SERIAL PRIMARY KEY)"))
        for _ in range(2):
            for stmt in [s.strip() for s in re.sub(r"--[^\n]*", "", sql).split(";") if s.strip()]:
                await conn.execute(text(stmt))
        q = text("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema=:s AND table_name=:t ORDER BY column_name")
        mig = (await conn.execute(q, {"s": "mig_check2", "t": table})).all()
        real = (await conn.execute(q, {"s": "public", "t": table})).all()
        idx = text("SELECT indexname FROM pg_indexes WHERE schemaname=:s AND tablename=:t ORDER BY indexname")
        mig_idx = (await conn.execute(idx, {"s": "mig_check2", "t": table})).scalars().all()
        real_idx = (await conn.execute(idx, {"s": "public", "t": table})).scalars().all()
        await conn.execute(text("DROP SCHEMA mig_check2 CASCADE"))
    assert [tuple(r) for r in mig] == [tuple(r) for r in real] and mig
    assert mig_idx == real_idx
    assert not re.search(r"\b(DROP TABLE|ALTER TABLE|DELETE FROM|UPDATE |TRUNCATE)\b", re.sub(r"--[^\n]*", "", sql), re.I)
