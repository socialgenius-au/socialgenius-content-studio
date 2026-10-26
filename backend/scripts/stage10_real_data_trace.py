"""Video Deconstructor — Stage 10 real-data developer trace utility.

Converts the Stage 10.3 Boundary Methodology Review's own ad-hoc investigation procedure into a
committed, repeatable tool, per the Stage 10 Application Access Checkpoint's own explicit
instruction. This is a manual developer utility, NOT a pytest/CI test (it needs a real database
with real analyzed videos in it) — run it directly:

    python scripts/stage10_real_data_trace.py                 # traces VA159 and VA5368, and
                                                                # checks them against the two
                                                                # currently-known checkpoints
    python scripts/stage10_real_data_trace.py <video_analysis_id>   # traces any other video

READ-ONLY: every function this script calls is a SELECT-only service function already used in
production (story_beat_boundary_reasoning_store_svc.load_latest_story_beat_reasoning_results,
story_beat_construction_svc's own _is_accepted/_dedup_transition_clusters/_speech_ids, and a plain
Scene/SpeechSegment read). It never calls construct_and_persist_* and never writes a row — rerunning
it as often as you like changes nothing in the database.

WHY THIS EXISTS: the Stage 10.3 clustering methodology fix (locked at `ffa0fe5`) was originally
verified by hand, once, in a disposable session scratchpad script that no longer exists anywhere in
the repository. That meant the exact evidence trace behind the decision could never be re-run to
check a future change against the same real data. This script is that trace, made permanent and
reusable for ANY video_analysis_id — the two "known checkpoint" numbers below describe what was
true for VA159/VA5368 on the day the methodology was locked; they are asserted HERE, in a dev
utility, purely so a future run immediately flags if a later change to the (locked) clustering
methodology would alter that real, already-reviewed result. They are never read by, or hard-coded
into, any production construction logic — story_beat_construction_svc.py has no knowledge this
script, or these specific videos, exist.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Real transcript evidence in this dataset includes non-ASCII (Urdu) text -- Windows terminals
# default stdout to a narrow codepage (cp1252) that cannot encode it. Reconfigure to UTF-8 rather
# than let a print() of genuine evidence crash the trace.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
from app.models.scene import Scene  # noqa: E402
from app.models.speech_segment import SpeechSegment  # noqa: E402
from app.services.story_beat_construction_svc import (  # noqa: E402
    _dedup_transition_clusters, _is_accepted, _latest_attempt_rows_per_candidate, _speech_ids,
)

# The two real videos this Stage's methodology was actually reviewed and locked against, and what
# was true for each on that day (see the Stage 10.3 Boundary Methodology Review report). Checked,
# never assumed, every time this script runs against one of these two ids.
KNOWN_CHECKPOINTS = {
    # VA159: 0 accepted Story Beat boundaries -- construction still produces exactly ONE
    # whole-video beat (boundary_status="no_accepted_boundary"), never zero rows; see
    # construct_and_persist_story_beats's own "NO-ACCEPTED-BOUNDARY CASE" docstring section.
    159: {"accepted_candidates": 0, "selected_boundaries": 0, "story_beats": 1},
    5368: {"accepted_candidates": 15, "selected_boundaries": 13, "story_beats": 14},
}


async def trace_one(db, video_analysis_id: int) -> None:
    print(f"\n{'=' * 90}\nVA{video_analysis_id}\n{'=' * 90}")

    latest = await _latest_attempt_rows_per_candidate(db, video_analysis_id)
    accepted = [r for r in latest if _is_accepted(r)]
    print(f"latest-per-candidate reasoning attempts: {len(latest)}   accepted (True + medium/high): {len(accepted)}")

    if accepted:
        all_speech_ids: set[int] = set()
        for row in accepted:
            all_speech_ids |= _speech_ids(row)
        speech_rows: dict[int, SpeechSegment] = {}
        if all_speech_ids:
            result = await db.execute(select(SpeechSegment).where(SpeechSegment.id.in_(all_speech_ids)))
            speech_rows = {s.id: s for s in result.scalars().all()}

        print("\n--- accepted candidates, in order, with cited speech evidence ---")
        for row in accepted:
            details = row.details or {}
            speech_ids = sorted(_speech_ids(row))
            print(f"  id={row.id}  ts={row.start_time}  confidence={details.get('confidence')}  speech_ids={speech_ids}")
            for sid in speech_ids:
                seg = speech_rows.get(sid)
                if seg:
                    print(f"    speech[{sid}] ({seg.start_time:.3f}-{seg.end_time:.3f}): {seg.text!r}")

        survivors, co_nominated = _dedup_transition_clusters(accepted)
        print(f"\nselected boundaries: {len(survivors)}")
        for row in survivors:
            co = co_nominated.get(row.id, [])
            print(f"  survivor id={row.id}  ts={row.start_time}" + (f"  co_nominated={co}" if co else ""))
    else:
        survivors = []

    scenes = list((await db.execute(
        select(Scene).where(Scene.video_analysis_id == video_analysis_id).order_by(Scene.order)
    )).scalars().all())
    print(f"\nScene rows: {len(scenes)}")
    for scene in scenes:
        print(f"  Scene order={scene.order}  [{scene.start_time}, {scene.end_time}]  narrative_role={scene.narrative_role}")

    # Mirrors construct_and_persist_story_beats's own range-construction rule exactly (never
    # reimplemented as new logic): zero survivors still yields exactly one whole-video beat.
    story_beat_count = len(survivors) + 1 if survivors else 1
    if video_analysis_id in KNOWN_CHECKPOINTS:
        expected = KNOWN_CHECKPOINTS[video_analysis_id]
        actual = {
            "accepted_candidates": len(accepted),
            "selected_boundaries": len(survivors),
            "story_beats": story_beat_count,
        }
        print(f"\nknown checkpoint check: expected={expected}  actual={actual}")
        if actual != expected:
            print("  *** MISMATCH — a change to the locked clustering methodology, or the underlying "
                  "real evidence, has altered this previously-reviewed result. Investigate before "
                  "treating this as expected. ***")
        else:
            print("  OK — matches the reviewed checkpoint.")


async def main() -> None:
    ids = [int(a) for a in sys.argv[1:]] or list(KNOWN_CHECKPOINTS)
    async with AsyncSessionLocal() as db:
        for video_analysis_id in ids:
            await trace_one(db, video_analysis_id)


if __name__ == "__main__":
    asyncio.run(main())
