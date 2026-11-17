"""Recovers an ALREADY-PAID blueprint reply from the AI spending ledger and saves it as the reference's blueprint, if (and only if) every C4 check passes. Run INSIDE the backend container.

    python scripts/recover_blueprint_from_ledger.py <reference_video_id> <ledger_id> <intent.json>

No AI provider is called, AI_SPEND_ENABLED is not needed (and must be off: the script refuses to run otherwise), and the ledger is only READ: the script proves the row (and the totals) are identical before and after.
The audit trail (ledger row, SHA-256 of the stored reply, every normalisation, the checks re-run) is saved on the blueprint itself. See app/services/blueprint_reasoner/recovery.py.
"""
import asyncio
import hashlib
import json
import sys

from sqlalchemy import text

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.user import User
from app.services.reconstruction_blueprint_svc import derive_and_persist_blueprint


async def snapshot(ledger_id: int, ref: int) -> tuple[str, float, int]:
    async with AsyncSessionLocal() as s:
        row = (await s.execute(text("select * from ai_call_ledger where id = :i"), {"i": ledger_id})).mappings().first()
        tot = (await s.execute(text("select count(*), coalesce(sum(cost_usd),0) from ai_call_ledger where reference_video_id = :r"), {"r": ref})).first()
    return hashlib.sha256(json.dumps(dict(row), sort_keys=True, default=str).encode()).hexdigest(), float(tot[1]), int(tot[0])


async def main(ref: int, ledger_id: int, intent_path: str) -> int:
    if settings.AI_SPEND_ENABLED:
        print("REFUSED: AI spending is ON. Recovery needs no spending; switch it off first.")
        return 2
    intent = json.load(open(intent_path, encoding="utf8"))
    async with AsyncSessionLocal() as s:
        row = (await s.execute(text("select id, reasoner, status, model, provider, request_hash, reference_video_id, response_json from ai_call_ledger where id = :i"), {"i": ledger_id})).mappings().first()
    if row is None or row["reasoner"] != "blueprint" or row["reference_video_id"] != ref or not row["response_json"]:
        print("REFUSED: that ledger row is not a stored blueprint reply for this reference.")
        return 2
    raw = "".join(b.get("text") or "" for b in json.loads(row["response_json"]).get("content", []) if b.get("type") == "text")
    before = await snapshot(ledger_id, ref)
    print(f"ledger row {ledger_id}: status={row['status']} model={row['model']} reply chars={len(raw)} sha256={hashlib.sha256(raw.encode()).hexdigest()[:16]}...")
    print(f"before: row fingerprint {before[0][:16]}..., reference cost ${before[1]:.4f} in {before[2]} rows")
    async with AsyncSessionLocal() as db:
        user = await db.get(User, 1)
        out = await derive_and_persist_blueprint(db, user, ref, intent, recovered_reply={"raw_text": raw, "ledger": {"id": row["id"], "status": row["status"], "model": row["model"],
                                                                                                                   "provider": row["provider"], "request_hash": row["request_hash"]}})
    after = await snapshot(ledger_id, ref)
    print(f"after:  row fingerprint {after[0][:16]}..., reference cost ${after[1]:.4f} in {after[2]} rows")
    print("LEDGER UNCHANGED:", before == after)
    bp = out["blueprint"]
    print(f"SAVED blueprint {bp['blueprint_id']} status={out['status']} sections={len(bp['sections'])} mechanisms_used={bp['mechanisms_used']} llm_calls={out['provenance']['llm_calls']}")
    print("audit:", json.dumps({k: v for k, v in out["provenance"]["recovery"].items() if k != "request_hash"}, ensure_ascii=False))
    return 0 if before == after else 1


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sys.exit(asyncio.run(main(int(sys.argv[1]), int(sys.argv[2]), sys.argv[3])))
