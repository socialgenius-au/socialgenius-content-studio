"""The first controlled paid AI test on ONE reference video. Run INSIDE the backend container (it uses the server's own settings and a short-lived in-process token; nothing secret is printed).

    python scripts/ai_first_test.py <reference_video_id>          # DRY RUN: checks everything and prints the plan. Sends nothing. Always safe.
    python scripts/ai_first_test.py <reference_video_id> --go     # runs the test. Refuses unless AI_SPEND_ENABLED is true.

What --go does, in order, on that reference only: (1) the three AI deconstruction steps (scenes + story beats, hook, retention) through the normal one-click deconstruction, then (2) the Creative Read.
Every request is metered on the server ($1 per reference, $20 for the phase). The script stops at the first problem and prints the spending view at the end.
"""
import asyncio
import json
import os
import sys
import time

import httpx
from sqlalchemy import text

from app.config import settings
from app.database import AsyncSessionLocal
from app.services.ai_metering import price_for
from app.services.auth import create_token

BASE = f"http://127.0.0.1:{os.environ.get('PORT', '8080')}"
REASONER_SETTINGS = ["SEMANTIC", "STORY_BEAT", "HOOK", "RETENTION", "CREATIVE_READ"]


def line(ok, msg):
    print(("  OK   " if ok else "  STOP ") + msg, flush=True)
    return ok


async def main(ref_id: int, go: bool) -> int:
    async with AsyncSessionLocal() as s:
        u = (await s.execute(text("select id, username, role, token_version from users where id = 1"))).first()
    c = httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {create_token(u.id, u.username, u.role, u.token_version)}"}, timeout=900)

    print(f"\nFIRST CONTROLLED AI TEST - reference {ref_id} - {'LIVE RUN' if go else 'DRY RUN (nothing is sent)'}\n")
    ok = True
    print("Settings (names and yes/no only; the key itself is never shown):")
    ok &= line(bool(settings.ANTHROPIC_API_KEY), f"ANTHROPIC_API_KEY is {'set' if settings.ANTHROPIC_API_KEY else 'NOT set'}")
    spend_on = settings.AI_SPEND_ENABLED
    print(f"  {'ON ' if spend_on else 'OFF'}  AI_SPEND_ENABLED  (must be ON for a live run; it is switched on only after your explicit approval)")
    for name in REASONER_SETTINGS:
        prov, model = getattr(settings, f"{name}_REASONER_PROVIDER"), getattr(settings, f"{name}_REASONER_MODEL")
        ok &= line(prov == "anthropic" and price_for(model) is not None, f"{name}_REASONER_PROVIDER={prov or '(empty)'}  model={model}  {'priced' if price_for(model) else 'NO PRICE - would be refused'}")
    print(f"  Limits: ${settings.AI_PER_REFERENCE_BUDGET_USD:.2f} per reference, ${settings.AI_PHASE_BUDGET_USD:.2f} for phase '{settings.AI_PHASE_ID}' (enforced on the server before every request)")

    print("\nReference:")
    r = c.get(f"/reference-videos/{ref_id}")
    if not line(r.status_code == 200, f"reference {ref_id} exists for the admin account (HTTP {r.status_code})"):
        return 1
    ev = r.json()
    async with AsyncSessionLocal() as s:
        src = (await s.execute(text("select a.file_path from reference_videos rv join assets a on a.id = rv.asset_id where rv.id = :i"), {"i": ref_id})).scalar()
    src_ok = bool(src) and os.path.isfile(src)
    ok &= line(src_ok, "the original video file is on the server" if src_ok else "the original video file is MISSING - upload the original again, then Deconstruct, then re-run this check")
    frames = [f["asset_file_path"] for sh in ev.get("shots", []) for f in sh.get("frames", [])]
    present = [p for p in frames if os.path.isfile(p)]
    ok &= line(bool(present), f"{len(present)} of {len(frames)} keyframes are on the server" + ("" if present else " - run Deconstruct again after the upload"))
    st = c.get(f"/reference-videos/{ref_id}/deconstruct-all/status").json()
    ai_stages = [x for x in st["stages"] if x.get("requires_ai")]
    print(f"  Deconstruction: {sum(x['status'] in ('complete', 'already_complete', 'skipped') for x in st['stages'])} of {len(st['stages'])} steps settled; AI steps now: " + ", ".join(f"{x['key']}={x['status']}" for x in ai_stages))

    print("\nPlan: run the AI deconstruction steps for this reference, then the Creative Read. Server-side worst case for ONE short reference measured in tests: about $0.35; hard limit $1.00.")
    if not go:
        print("\nDRY RUN finished. Nothing was sent." + ("" if ok else " Fix the STOP items above before a live run."))
        return 0 if ok else 2
    if not (ok and spend_on):
        print("\nNOT RUNNING: " + ("AI_SPEND_ENABLED is off." if ok else "a check above failed."))
        return 2

    before = c.get("/ai/usage").json()["phase"]["spent_usd"]
    print("\nStep 1: AI deconstruction steps ...", flush=True)
    t0 = time.time()
    rr = c.post(f"/reference-videos/{ref_id}/deconstruct-all")
    if rr.status_code not in (200, 202):
        print("  STOP", rr.status_code, rr.text[:300])
        return 1
    while time.time() - t0 < 900:
        st = c.get(f"/reference-videos/{ref_id}/deconstruct-all/status").json()
        if (st.get("orchestration") or {}).get("status") not in ("running", None):
            break
        time.sleep(5)
    for x in st["stages"]:
        if x.get("requires_ai"):
            print(f"  {x['key']}: {x['status']}" + (f" - {x.get('error') or x.get('reason')}" if x['status'] != 'complete' else ""))

    print("\nStep 2: Creative Read ...", flush=True)
    cr = c.post(f"/reference-videos/{ref_id}/creative-read")
    if cr.status_code == 200:
        j = cr.json()
        print(f"  {len(j['findings'])} findings; frames shown {len(j['provenance']['frames_shown'])}; limitations: {len(j['limitations'])}")
        for f in j["findings"]:
            print(f"   - [{f['kind']}/{f['confidence']}] {f['statement']}")
    else:
        print("  STOP", cr.status_code, cr.text[:400])

    u = c.get("/ai/usage").json()
    print(f"\nSpent in this test (estimated): ${u['phase']['spent_usd'] - before:.4f}   phase total ${u['phase']['spent_usd']:.4f} of ${u['caps']['phase_usd']:.2f}   refused: {u['phase']['refused']}   failed: {u['phase']['failed']}")
    for row in u["recent"][:12]:
        print(f"   {row['reasoner']:<14} try {row['attempt']} {row['status']:<18} ${row['cost_usd']:.4f} {row['error'] or ''}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2 or not sys.argv[1].isdigit():
        sys.exit(__doc__)
    sys.exit(asyncio.run(main(int(sys.argv[1]), "--go" in sys.argv)))
