"""D1 guard: the editor's TypeScript port of the blend-window rules (frontend/src/pages/video-studio-v2/export/dissolveWindow.ts) must agree with the exporter's own planner (timeline_plan.plan_timeline).
The shared fixture is generated HERE from the Python planner (deterministic seed) and consumed by the frontend test; this test fails when the planner changes without the fixture (and so the port) being regenerated.
Regenerate with:  SG_WRITE_FIXTURES=1 python -m pytest tests/test_dissolve_window_fixture.py"""
import json
import os
import random
from pathlib import Path

from app.services import ffmpeg_svc, timeline_plan as tp

FIXTURE = Path(__file__).resolve().parents[2] / "frontend/src/pages/video-studio-v2/export/__fixtures__/dissolveWindow.cases.json"
XF = ffmpeg_svc._XFADE_NAMES
TRANSITIONS = ["cut", "dissolve", "dissolve", "dissolve", "whip_pan", "zoom_punch", "fade_black"]


def _case(rng: random.Random, i: int) -> dict:
    n = rng.randint(2, 5)
    t = round(rng.choice([0.0, 0.0, 0.4, 1.0]), 3)
    clips = []
    for k in range(n):
        length = round(rng.choice([0.2, 0.5, 0.8, 1.0, 1.7, 2.5, 4.0]) + rng.choice([0, 0, 0.01, 0.033]), 3)
        speed = rng.choice([0.5, 1, 1, 1, 1.5, 2])
        trim = round(rng.choice([0, 0, 0.1, 0.5, 1.0, 3.0]), 3)
        src = round(trim + length * speed + rng.choice([0, 0.05, 0.4, 2.0, 10.0]), 3) if rng.random() < 0.85 else None       # None = unknown source length
        start = t
        if k > 0 and rng.random() < 0.15:
            start = round(t + rng.choice([0.04, 0.5, 1.0]), 3)                                                              # a gap: ends the run
        clips.append({"id": f"c{k}", "transition": rng.choice(TRANSITIONS), "transitionDuration": rng.choice([0.1, 0.25, 0.5, 0.5, 1.0, 1.5]),
                      "startTime": start, "endTime": round(start + length, 3), "trimIn": trim, "speed": speed, "duration": src})
        t = round(start + length, 3)
    policy = rng.choice(["shorten", "shorten", "hold_incoming", "hold"])
    return {"name": f"case{i}", "policy": policy, "clips": clips, "expected": _expected(clips, policy)}


def _expected(clips: list[dict], policy: str) -> list[dict]:
    py = [{"path": c["id"], "trim_in": c["trimIn"], "start_time": c["startTime"], "end_time": c["endTime"], "speed": c["speed"], "transition": c["transition"], "transition_duration": c["transitionDuration"]} for c in clips]
    durations = {c["id"]: c["duration"] for c in clips}
    out = []
    for run in tp.split_runs(py):
        if len(run) < 2:
            continue
        plan = tp.plan_timeline(run, XF, durations, policy=policy)
        for jn in plan.joins:
            if jn.kind == "blend":
                out.append({"outId": run[jn.index]["path"], "inId": run[jn.index + 1]["path"], "transition": run[jn.index]["transition"], "joinFrame": jn.join_f, "pre": jn.pre, "post": jn.post, "requested": jn.requested})
    return out


def _cases() -> list[dict]:
    rng = random.Random(20261102)
    return [_case(rng, i) for i in range(160)]


def test_fixture_matches_the_exporters_planner():
    cases = _cases()
    assert sum(len(c["expected"]) for c in cases) > 100, "the generator should exercise many blend windows"
    assert any(e["pre"] + e["post"] < e["requested"] for c in cases for e in c["expected"]), "and some shortened ones"
    text = json.dumps(cases, indent=1) + "\n"
    if os.environ.get("SG_WRITE_FIXTURES"):
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(text, encoding="utf-8")
    assert FIXTURE.read_text(encoding="utf-8") == text, "dissolveWindow.cases.json is stale: regenerate with SG_WRITE_FIXTURES=1"
