"""Apify web scraping — run actors and retrieve dataset items."""
import asyncio
import httpx

from app.config import settings

BASE = "https://api.apify.com/v2"


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.APIFY_API_TOKEN}"}


async def run_actor(actor_id: str, input_data: dict, timeout_secs: int = 60) -> dict:
    """Synchronously run an Apify actor and return its dataset items."""
    if not settings.APIFY_API_TOKEN:
        raise ValueError("APIFY_API_TOKEN must be set")

    actor_id_escaped = actor_id.replace("/", "~")

    async with httpx.AsyncClient(timeout=timeout_secs + 10) as client:
        # Start the run
        r = await client.post(
            f"{BASE}/acts/{actor_id_escaped}/runs",
            params={"waitForFinish": timeout_secs},
            json={"input": input_data},
            headers={**_headers(), "Content-Type": "application/json"},
        )
        r.raise_for_status()
        run = r.json().get("data", {})
        run_id = run.get("id", "")
        dataset_id = run.get("defaultDatasetId", "")
        status = run.get("status", "UNKNOWN")

        items: list = []
        if status == "SUCCEEDED" and dataset_id:
            dr = await client.get(
                f"{BASE}/datasets/{dataset_id}/items",
                params={"format": "json", "clean": "true"},
                headers=_headers(),
            )
            if dr.status_code == 200:
                items = dr.json()

    return {
        "run_id": run_id,
        "status": status,
        "dataset_id": dataset_id,
        "items": items,
    }
