"""Stock provider adapters and metadata normalisation."""
import re
from urllib.parse import urlsplit

import httpx

from app.config import settings
from app.services import pixabay_svc
from app.services.reference_source import SourceUnavailable, _https_from, pexels_json, pexels_video_rendition

WORKSPACES = {
    "sameena": ("Wellness", "Real Estate", "Restaurants", "Fitness", "Mortgage"),
    "khudsia": ("Beauty", "Business Coaching", "Construction", "NDIS & Aged Care", "Retail"),
}
NICHES = {
    "Healthy ageing": ("healthy ageing", "healthy aging", "senior wellness"),
    "Mindfulness": ("meditation", "mindfulness", "breathwork"),
    "Residential property": ("apartment", "real estate", "house tour"),
    "Hospitality": ("restaurant", "chef", "fine dining", "cafe"),
    "Strength training": ("strength", "weightlifting", "resistance training"),
    "Home lending": ("mortgage", "home loan", "refinancing"),
    "Skincare": ("skincare", "facial mask", "serum"),
    "Entrepreneurship": ("entrepreneur", "business coaching", "mentorship"),
    "Building trades": ("construction", "carpentry", "bricklaying"),
    "Disability support": ("disability", "ndis", "wheelchair"),
    "Aged care": ("aged care", "elderly care", "caregiver"),
    "Visual merchandising": ("retail", "store display", "shopfront"),
}
LICENSES = {
    "pexels": ("Pexels License", "https://www.pexels.com/license/"),
    "pixabay": ("Pixabay Content License", "https://pixabay.com/service/license-summary/"),
    "unsplash": ("Unsplash License", "https://unsplash.com/license"),
}
HOSTS = {
    "pexels": {"images.pexels.com", "videos.pexels.com", "static-videos.pexels.com"},
    "pixabay": {"cdn.pixabay.com", "pixabay.com"},
    "unsplash": {"images.unsplash.com", "plus.unsplash.com"},
}
REFERRAL = "utm_source=social_genius_content_studio&utm_medium=referral"


def parse_key(key: str) -> tuple[str, str, str]:
    if not re.fullmatch(r"(pexels|pixabay|unsplash):(image|video):[A-Za-z0-9_-]{1,64}", key):
        raise ValueError("Invalid asset reference")
    provider, kind, identifier = key.split(":")
    if (provider != "unsplash" and not identifier.isdecimal()) or (provider == "unsplash" and kind == "video"):
        raise ValueError("Invalid asset reference")
    return provider, kind, identifier


def classify(title: str, tags: str) -> tuple[list[str], list[str]]:
    words = " ".join(re.findall(r"[a-z0-9]+", f"{title} {tags}".lower()))
    niches = [label for label, aliases in NICHES.items() if any(f" {alias} " in f" {words} " for alias in aliases)]
    keywords = [word for word in words.split() if len(word) > 2 and word not in {"the", "and", "with", "from", "for", "this", "image", "video"}]
    return list(dict.fromkeys([part.strip() for part in tags.lower().split(",") if part.strip()] + keywords))[:24], niches


def normalize(provider: str, kind: str, item: dict) -> dict:
    user = item.get("user")
    user = user if isinstance(user, dict) else {"name": user}
    creator, creator_url, tracking = user.get("name"), None, None
    width, height = item.get("width"), item.get("height")
    title = item.get("alt") or item.get("alt_description") or item.get("description") or ""
    raw_tags = item.get("tags")
    if isinstance(raw_tags, str):
        tags = raw_tags
    elif isinstance(raw_tags, list):
        labels = [tag.get("title") or tag.get("name") or tag.get("slug")
                  if isinstance(tag, dict) else tag for tag in raw_tags]
        tags = ", ".join(label.replace("-", " ") for label in labels if isinstance(label, str))
    else:
        tags = ""
    poster = None
    if provider == "pexels":
        source = item["url"]
        creator = creator or item.get("photographer")
        creator_url = user.get("url") or item.get("photographer_url")
        if kind == "image":
            preview, media = item["src"]["medium"], item["src"]["large"]
        else:
            poster = item.get("image")
            preview = media = pexels_video_rendition(item)["link"]
    elif provider == "pixabay":
        source = item["pageURL"]
        if kind == "image":
            preview, media = item["webformatURL"], item["largeImageURL"]
            width, height = item.get("imageWidth"), item.get("imageHeight")
        else:
            rendition = next((item["videos"].get(r) for r in ("medium", "small", "large") if item["videos"].get(r, {}).get("url")), None)
            if not rendition:
                raise ValueError("No playable Pixabay rendition")
            preview = media = rendition["url"]
            poster = rendition.get("thumbnail")
            width, height = rendition.get("width"), rendition.get("height")
    else:
        source = item["links"]["html"] + "?" + REFERRAL
        creator_url = user["links"]["html"] + "?" + REFERRAL
        tracking = item["links"]["download_location"]
        preview, media = item["urls"]["small"], item["urls"]["regular"]
        tags = ""
    if not all(_https_from(url, HOSTS[provider]) for url in (preview, media)):
        raise ValueError("Unsupported asset host")
    if not isinstance(title, str) or not title.strip():
        title = tags
    if not title:
        title = urlsplit(source).path.rstrip("/").rsplit("/", 1)[-1].replace("-", " ")
    key = f"{provider}:{kind}:{item['id']}"
    parse_key(key)
    keywords, niches = classify(title, tags)
    licence, licence_url = LICENSES[provider]
    return dict(key=key, provider=provider, kind=kind, title=title[:300], creator=creator,
                creator_url=creator_url, source=source, preview=preview, poster=poster, media=media,
                duration=item.get("duration"), width=width, height=height, tags=keywords, niches=niches,
                licence=licence, licence_url=licence_url, tracking=tracking)


async def unsplash(path: str, params=None) -> dict:
    if not settings.UNSPLASH_ACCESS_KEY:
        raise SourceUnavailable("UNSPLASH_ACCESS_KEY is required")
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        response = await client.get(f"https://api.unsplash.com{path}", params=params,
                                    headers={"Authorization": f"Client-ID {settings.UNSPLASH_ACCESS_KEY}"})
        response.raise_for_status()
        return response.json()


async def search(provider: str, kind: str, query: str, page: int) -> list[dict]:
    if provider == "pexels":
        path, field = ("/v1/search", "photos") if kind == "image" else ("/videos/search", "videos")
        items = (await pexels_json(path, {"query": query, "page": page, "per_page": 12})).get(field, [])
    elif provider == "pixabay":
        find = pixabay_svc.search_images if kind == "image" else pixabay_svc.search_videos
        items = (await find(query, page=page, per_page=12))["hits"]
    else:
        items = (await unsplash("/search/photos", {"query": query, "page": page, "per_page": 12, "content_filter": "high"})).get("results", [])
    results = []
    for item in items:
        try:
            results.append(normalize(provider, kind, item))
        except (ValueError, KeyError, TypeError):
            continue
    return results


async def resolve(key: str) -> dict:
    provider, kind, identifier = parse_key(key)
    if provider == "pexels":
        path = f"/v1/photos/{identifier}" if kind == "image" else f"/v1/videos/videos/{identifier}"
        item = await pexels_json(path)
    elif provider == "pixabay":
        url = pixabay_svc.IMAGE_URL if kind == "image" else pixabay_svc.VIDEO_URL
        hits = (await pixabay_svc.lookup(url, id=identifier, safesearch="true"))["hits"]
        if not hits:
            raise SourceUnavailable("Pixabay asset is unavailable")
        item = hits[0]
    else:
        item = await unsplash(f"/photos/{identifier}")
    return normalize(provider, kind, item)


def public(details: dict) -> dict:
    return {key: value for key, value in details.items() if key not in {"media", "tracking"}}


def snapshot(details: dict) -> dict:
    keys = {"media", "tracking", "preview", "poster"} if details["provider"] == "pixabay" else {"media", "tracking"}
    return {key: value for key, value in details.items() if key not in keys}
