"""Option C guard: the editor's TypeScript port of the footage-on-screen rules (frontend/src/pages/video-studio-v2/export/footageGeometry.ts) must agree with the exporter's own rules (behind_footage.py).
The shared fixture is generated HERE from the Python rules (deterministic seed) and consumed by the frontend test; this test fails when the Python changes without the fixture (and so the port) being regenerated.
Regenerate with:  SG_WRITE_FIXTURES=1 python -m pytest tests/test_footage_geometry_fixture.py"""
import json
import os
import random
from pathlib import Path

from app.services import behind_footage as bf, ffmpeg_svc, timeline_plan as tp

FIXTURE = Path(__file__).resolve().parents[2] / "frontend/src/pages/video-studio-v2/export/__fixtures__/footageGeometry.cases.json"
XF = ffmpeg_svc._XFADE_NAMES
TRANSITIONS = ["cut", "dissolve", "dissolve", "whip_pan", "zoom_punch", "fade_black"]
CANVASES = [(1080, 1920), (1920, 1080), (1080, 1080), (1080, 1350), (320, 180), (180, 320)]
SOURCES = [(1920, 1080), (1080, 1920), (1080, 1080), (1280, 720), (720, 1280), (640, 480), (360, 640), (400, 640), (1000, 563), (853, 480)]


def _rect_cases() -> list[dict]:
    out = []
    for cw, ch in CANVASES:
        for sw, sh in SOURCES:
            for fit in ("fit", "fill"):
                out.append({"canvas": [cw, ch], "source": [sw, sh], "fit": fit, "rect": list(bf.footage_rect(cw, ch, sw, sh, fit))})
    return out


def _occupancy_case(rng: random.Random, i: int) -> dict:
    cw, ch = rng.choice(CANVASES)
    n = rng.randint(1, 5)
    t = round(rng.choice([0.0, 0.0, 0.4]), 3)
    clips = []
    for k in range(n):
        length = round(rng.choice([0.5, 0.8, 1.0, 1.7, 2.5, 4.0]) + rng.choice([0, 0, 0.01, 0.033]), 3)
        speed = rng.choice([1, 1, 1.5])
        trim = round(rng.choice([0, 0.1, 0.5, 1.0, 3.0]), 3)
        src = round(trim + length * speed + rng.choice([0, 0.4, 2.0, 10.0]), 3) if rng.random() < 0.85 else None
        start = t
        if k > 0 and rng.random() < 0.2:
            start = round(t + rng.choice([0.04, 0.5, 1.0]), 3)
        size = rng.choice(SOURCES)
        clips.append({"id": f"c{k}", "url": f"u{k}", "size": list(size), "fit": rng.choice(["fit", "fit", "fill"]), "transition": rng.choice(TRANSITIONS), "transitionDuration": rng.choice([0.25, 0.5, 1.0]),
                      "startTime": start, "endTime": round(start + length, 3), "trimIn": trim, "speed": speed, "duration": src})
        t = round(start + length, 3)
    policy = rng.choice(["shorten", "shorten", "hold_incoming", "hold"])
    return {"name": f"occ{i}", "policy": policy, "canvas": [cw, ch], "clips": clips, "expected": _expected(clips, policy, cw, ch)}


def _expected(clips: list[dict], policy: str, cw: int, ch: int) -> list[dict]:
    """For the middle of every frame in the project: the set of footage rectangles on screen, exactly as the exporter's occupancy rules give it."""
    py = [{"path": c["id"], "trim_in": c["trimIn"], "start_time": c["startTime"], "end_time": c["endTime"], "speed": c["speed"], "transition": c["transition"],
           "transition_duration": c["transitionDuration"], "fit_mode": c["fit"]} for c in clips]
    durations = {c["id"]: c["duration"] for c in clips}
    sizes = {c["id"]: tuple(c["size"]) for c in clips}
    events = []
    for run in tp.split_runs(py):
        plan = tp.plan_timeline(run, XF, durations, policy=policy)
        events += bf.run_events(run, plan, cw, ch, sizes)
    total = tp.to_frames(clips[-1]["endTime"]) + 3
    out = []
    for sp in bf.occupancy(events, (0, total)):
        # sample every frame of the span only where it is interesting: the first, the last and a middle one (keeps the fixture small)
        for f in sorted({sp.t0, sp.t1 - 1, (sp.t0 + sp.t1) // 2}):
            out.append({"frame": f, "rects": sorted([list(r) for r in sp.rects])})
    return out


def _fixture() -> dict:
    rng = random.Random(20261103)
    return {"rects": _rect_cases(), "occupancy": [_occupancy_case(rng, i) for i in range(120)]}


def test_fixture_matches_the_exporters_rules():
    data = _fixture()
    assert sum(1 for c in data["occupancy"] for e in c["expected"] if len(e["rects"]) > 1) > 20, "the generator should exercise blend windows with two pictures on screen"
    assert sum(1 for c in data["occupancy"] for e in c["expected"] if not e["rects"]) > 10, "and gaps with no footage"
    text = json.dumps(data, indent=1) + "\n"
    if os.environ.get("SG_WRITE_FIXTURES"):
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(text, encoding="utf-8")
    assert FIXTURE.read_text(encoding="utf-8") == text, "footageGeometry.cases.json is stale: regenerate with SG_WRITE_FIXTURES=1"
