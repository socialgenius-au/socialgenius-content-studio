from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from app.deps import current_user
from app.main import app
from app.models.user import User
from app.services import virtual_assets as stock
from app.services import virtual_asset_storage as storage


def test_pixabay_reference_keeps_licence_without_persistent_hotlink():
    row = stock.normalize("pixabay", "image", {
        "id": 5, "pageURL": "https://pixabay.com/photos/skincare-5/",
        "user": "Photographer", "tags": "skincare, facial mask",
        "webformatURL": "https://pixabay.com/get/preview.jpg",
        "largeImageURL": "https://pixabay.com/get/full.jpg",
    })
    assert row["niches"] == ["Skincare"]
    assert "facial mask" in row["tags"]
    assert row["licence"] == "Pixabay Content License"
    assert "preview" in stock.public(row)
    assert {"preview", "media"}.isdisjoint(stock.snapshot(row))


def test_unsplash_uses_attribution_and_original_hotlinks():
    row = stock.normalize("unsplash", "image", {
        "id": "photo-A", "links": {
            "html": "https://unsplash.com/photos/photo-A",
            "download_location": "https://api.unsplash.com/photos/photo-A/download",
        },
        "urls": {
            "small": "https://images.unsplash.com/photo-A?ixid=example",
            "regular": "https://images.unsplash.com/photo-A?ixid=example",
        },
        "user": {"name": "Artist", "links": {"html": "https://unsplash.com/@artist"}},
    })
    assert row["creator_url"].startswith("https://unsplash.com/@artist?utm_source=")
    assert row["preview"].endswith("ixid=example")
    assert "tracking" not in stock.public(row)


@pytest.mark.parametrize("key", ["pexels:video:abc", "unsplash:video:abc", "pixabay:image:../7"])
def test_invalid_provider_keys(key):
    with pytest.raises(ValueError):
        stock.parse_key(key)


@pytest.mark.skipif(not any(host in settings.DATABASE_URL for host in ("@127.0.0.1", "@localhost", "@[::1]")),
                    reason="writes fixtures to a local test database")
def test_bookmark_roundtrip_and_creator_media_reuse(monkeypatch, upload_dir):
    asset_id = str(uuid4().int)[:12]
    key = f"pexels:image:{asset_id}"
    details = stock.normalize("pexels", "image", {
        "id": asset_id, "url": f"https://www.pexels.com/photo/{asset_id}/",
        "alt": "Healthy ageing in a garden", "photographer": "Artist",
        "src": {"medium": "https://images.pexels.com/image.jpg", "large": "https://images.pexels.com/image.jpg"},
    })

    async def resolve(requested):
        assert requested == key
        return details

    calls = []
    async def fetch(row, destination):
        calls.append(destination)
        Image.new("RGB", (32, 24), "gold").save(destination, format="JPEG")
        return destination.stat().st_size, "jpg", "image/jpeg"

    monkeypatch.setattr(stock, "resolve", resolve)
    monkeypatch.setattr(storage, "fetch_media", fetch)
    with TestClient(app) as client:
        from app.database import AsyncSessionLocal
        async def user():
            async with AsyncSessionLocal() as session:
                new_user = User(username=f"virtual-{asset_id}", email=f"{asset_id}@example.com", hashed_password="x", role="admin")
                session.add(new_user)
                await session.commit()
                return new_user
        account = client.portal.call(user)
        app.dependency_overrides[current_user] = lambda: account
        try:
            target = {"key": key, "workspace": "sameena", "collection": "Wellness"}
            assert client.put("/virtual-assets/bookmarks", json=target).json() == {"duplicate": False}
            assert client.put("/virtual-assets/bookmarks", json=target).json() == {"duplicate": True}
            assert not calls
            workspaces = client.get("/virtual-assets/collections").json()
            wellness = next(team for team in workspaces if team["workspace"] == "sameena")["collections"][0]
            assert sum(row["key"] == key for row in wellness["items"]) == 1
            first = client.post("/virtual-assets/project-media", json={"key": key, "rights_confirmed": True})
            assert first.status_code == 200, first.text
            second = client.post("/virtual-assets/project-media", json={"key": key, "rights_confirmed": True})
            assert second.json()["id"] == first.json()["id"]
            assert len(calls) == 1
            assert not calls[0].exists()
            assert Path(first.json()["file_path"]).is_file()
            account.role = "editor"
            assert client.put("/virtual-assets/bookmarks", json=target).status_code == 403
        finally:
            app.dependency_overrides.pop(current_user, None)
