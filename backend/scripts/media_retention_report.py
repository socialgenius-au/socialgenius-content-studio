"""READ-ONLY report on the media volume: which files are protected and which are unreferenced leftovers (mostly finished export MP4s, which the exporter serves and never deletes).

    python scripts/media_retention_report.py            # run INSIDE the backend container

This script contains NO deletion code and changes nothing. A file is PROTECTED if any of these reference it: an asset row (uploads, extracted keyframes, anything the Library lists, and so every source video, reference video and
generated image), or any saved draft / job / template (searched by file name inside their stored JSON). Everything else is an UNREFERENCED candidate. Candidates are further split by age so a retention window can be chosen
(files younger than the window might still be an active download). See docs/ops/MEDIA_RETENTION_PROPOSAL.md for the proposed policy (nothing is deleted automatically).
"""
import asyncio
import os
import sys
import time
from pathlib import Path

from sqlalchemy import text

from app.config import settings
from app.database import AsyncSessionLocal

DAY = 86400


def mb(n: int) -> str:
    return f"{n / 1e6:,.1f} MB"


async def main() -> int:
    root = Path(settings.UPLOAD_DIR)
    async with AsyncSessionLocal() as s:
        asset_paths = {Path(p).as_posix().lstrip("./") for (p,) in (await s.execute(text("select file_path from assets"))).all() if p}
        blobs = []
        for table, col in (("video_studio_drafts", "project_json"), ("jobs", "plan_json"), ("templates", "plan_json")):
            try:
                blobs += [str(v) for (v,) in (await s.execute(text(f"select {col}::text from {table}"))).all() if v]
            except Exception as exc:  # noqa: BLE001 - a missing table/column must not hide the rest of the report
                print(f"(skipped {table}.{col}: {type(exc).__name__})")
    blob = "\n".join(blobs)
    now = time.time()
    protected = {"asset": [0, 0], "draft_or_job_reference": [0, 0]}
    cand: list[tuple[float, int, str]] = []
    total = [0, 0]
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        st = path.stat()
        total[0] += 1; total[1] += st.st_size
        rel = path.as_posix()
        rel_up = rel[rel.find("uploads/"):] if "uploads/" in rel else rel
        if rel_up in asset_paths or rel.lstrip("./") in asset_paths:
            protected["asset"][0] += 1; protected["asset"][1] += st.st_size
        elif path.name in blob:
            protected["draft_or_job_reference"][0] += 1; protected["draft_or_job_reference"][1] += st.st_size
        else:
            cand.append((now - st.st_mtime, st.st_size, rel_up))
    print(f"Volume {root}: {total[0]} files, {mb(total[1])}")
    for k, (n, b) in protected.items():
        print(f"  PROTECTED ({k}): {n} files, {mb(b)}")
    print(f"  UNREFERENCED candidates: {len(cand)} files, {mb(sum(c[1] for c in cand))}")
    for label, lo, hi in (("younger than 1 day (possible active download)", 0, DAY), ("1 to 7 days", DAY, 7 * DAY), ("older than 7 days", 7 * DAY, 10 ** 12)):
        grp = [c for c in cand if lo <= c[0] < hi]
        print(f"    {label}: {len(grp)} files, {mb(sum(c[1] for c in grp))}")
    by_type: dict[str, list[int]] = {}
    for _, size, rel in cand:
        e = by_type.setdefault(Path(rel).suffix.lower() or "(none)", [0, 0]); e[0] += 1; e[1] += size
    print("    by type:", {k: f"{v[0]} files, {mb(v[1])}" for k, v in sorted(by_type.items())})
    print("  largest 8 candidates:")
    for age, size, rel in sorted(cand, key=lambda c: -c[1])[:8]:
        print(f"    {mb(size):>10}  {age / 3600:7.1f} h old  {rel}")
    print("NOTHING WAS CHANGED.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
