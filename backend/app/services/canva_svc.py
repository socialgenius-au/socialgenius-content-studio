"""Canva Connect API — OAuth 2.0 client credentials + design operations."""
import time
import httpx

from app.config import settings

BASE = "https://api.canva.com/rest/v1"
_token_cache: dict = {}


async def _get_token() -> str:
    """Obtain and cache a client-credentials access token."""
    if not settings.CANVA_CLIENT_ID or not settings.CANVA_CLIENT_SECRET:
        raise ValueError("CANVA_CLIENT_ID and CANVA_CLIENT_SECRET must be set")

    now = time.time()
    if _token_cache.get("expires_at", 0) > now + 60:
        return _token_cache["access_token"]

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{BASE}/oauth/token",
            data={
                "grant_type": "client_credentials",
                "client_id": settings.CANVA_CLIENT_ID,
                "client_secret": settings.CANVA_CLIENT_SECRET,
                "scope": "design:meta:read design:content:read design:content:write asset:read asset:write",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        r.raise_for_status()
        data = r.json()

    _token_cache["access_token"] = data["access_token"]
    _token_cache["expires_at"] = now + data.get("expires_in", 3600)
    return _token_cache["access_token"]


async def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {await _get_token()}", "Content-Type": "application/json"}


async def list_brand_templates(query: str = "") -> list[dict]:
    params = {"query": query} if query else {}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{BASE}/brand-templates",
            params=params,
            headers=await _auth_headers(),
        )
        r.raise_for_status()
        return r.json().get("items", [])


async def create_design(
    title: str,
    design_type: str = "PRESENTATION",
    brand_template_id: str | None = None,
    data: dict | None = None,
) -> dict:
    payload: dict = {"title": title}

    if brand_template_id:
        payload["design_type"] = {"type": "brand_template", "brand_template_id": brand_template_id}
        if data:
            payload["data_fields"] = [{"name": k, "text": {"text": v}} for k, v in data.items()]
    else:
        payload["design_type"] = {"type": "preset", "name": design_type}

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{BASE}/designs", json=payload, headers=await _auth_headers())
        r.raise_for_status()
        design = r.json().get("design", {})

    return {
        "design_id": design.get("id", ""),
        "edit_url": design.get("urls", {}).get("edit_url", ""),
        "thumbnail_url": design.get("thumbnail", {}).get("url"),
    }


async def export_design(design_id: str, export_format: str = "png") -> str:
    """Start a design export and return the download URL."""
    payload = {"design_id": design_id, "format": export_format.upper()}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{BASE}/exports", json=payload, headers=await _auth_headers())
        r.raise_for_status()
        job = r.json().get("job", {})
        job_id = job.get("id", "")

        # Poll for completion (max 30 seconds)
        for _ in range(15):
            import asyncio
            await asyncio.sleep(2)
            pr = await client.get(f"{BASE}/exports/{job_id}", headers=await _auth_headers())
            pr.raise_for_status()
            status = pr.json().get("job", {})
            if status.get("status") == "success":
                return status.get("urls", [{}])[0].get("url", "")
            if status.get("status") == "failed":
                raise RuntimeError("Canva export failed")

    raise TimeoutError("Canva export did not complete in time")
