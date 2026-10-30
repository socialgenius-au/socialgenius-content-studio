"""Transitions must not move any footage: REAL ffmpeg renders of synthetic clips whose every frame carries a frame-index barcode and a per-clip colour, decoded back from the exported MP4.

The editor's contract: clip k sits at [start_k, end_k) on the timeline, the output is as long as the timeline, a layer is visible for start <= t < end, and A1 audio sits at absolute times.
Before the timeline plan, a join overlapped the two segments (a hard cut by 0.05 s, a 1 s dissolve by 1 s) and everything after it arrived early against the layers and audio.
"""
import asyncio
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from app.services import ffmpeg_svc

FF = ffmpeg_svc.FFMPEG_BIN
FPS = 30
W, H = 360, 640
BIT_W, NBITS = 24, 15
UV = {"A": (90, 240), "B": (240, 110), "C": (54, 34)}
HZ = {"A": 440.0, "B": 880.0, "C": 1320.0}
USER_ID = 998


def _run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    assert r.returncode == 0, r.stderr.decode(errors="replace")[-800:]
    return r


@pytest.fixture(scope="module")
def sources(tmp_path_factory):
    d = tmp_path_factory.mktemp("tlsync")
    out = {}
    for k, (cb, cr) in UV.items():
        p = d / f"src_{k}.mp4"
        geq = f"geq=lum='if(lt(Y,H/8),16+219*mod(floor(N/pow(2,floor(X/{BIT_W}))),2),100)':cb={cb}:cr={cr}"
        _run([FF, "-y", "-v", "error", "-f", "lavfi", "-i", f"nullsrc=s={W}x{H}:r={FPS}:d=6,format=yuv420p,{geq}", "-f", "lavfi", "-i", f"sine=frequency={HZ[k]}:sample_rate=44100:duration=6",
              "-c:v", "libx264", "-g", "30", "-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(p)])
        out[k] = str(p)
    short = d / "src_C_short.mp4"            # exactly as long as its use below: no spare frames before or after
    _run([FF, "-y", "-v", "error", "-i", out["C"], "-t", "2", "-c", "copy", str(short)])
    out["Cshort"] = str(short)
    return out


def _clip(path, start, end, trim=1.0, transition="cut", td=0.5, speed=1.0):
    return {"path": path, "trim_in": trim, "start_time": start, "end_time": end, "speed": speed, "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": transition, "transition_duration": td, "has_separated_audio": False, "muted": False, "volume": 1.0}


def _shape(start, end):
    return {"kind": "rectangle", "start_time": start, "end_time": end, "x": 0, "y": 70, "width": 100, "height": 10, "fill_color": "#ff00ff", "opacity": 1.0,
            "border_color": None, "border_width": 0, "border_radius": 0, "full_width": False, "order": 0}


def _render(clips, tmp_path, tag, shapes=(), audio_tracks=()):
    project = {"canvas_width": W, "canvas_height": H, "video_clips": clips, "text_overlays": [], "shapes": list(shapes), "audio_tracks": list(audio_tracks), "subtitle_style": {}}
    out = asyncio.run(ffmpeg_svc.render_project(project, USER_ID))
    dst = tmp_path / f"{tag}.mp4"
    dst.write_bytes(Path(out).read_bytes())
    return str(dst)


def _frames(path):
    r = _run([FF, "-v", "error", "-i", path, "-pix_fmt", "yuv444p", "-f", "rawvideo", "-"])
    buf = np.frombuffer(r.stdout, dtype=np.uint8)
    n = len(buf) // (W * H * 3)
    return buf[: n * W * H * 3].reshape(n, 3, H, W)


def _read(fr):
    """per frame: source frame index from the barcode, nearest clip letter (+ chroma distance), magenta share of the shape band"""
    n = fr.shape[0]
    idx = np.zeros(n, dtype=int)
    for k in range(NBITS):
        idx += (fr[:, 0, H // 16, k * BIT_W + BIT_W // 2] > 128).astype(int) << k
    u = np.median(fr[:, 1, int(H * .30):int(H * .55), W // 4:3 * W // 4].reshape(n, -1), axis=1)
    v = np.median(fr[:, 2, int(H * .30):int(H * .55), W // 4:3 * W // 4].reshape(n, -1), axis=1)
    who, dist = [], []
    for i in range(n):
        d = {k: np.hypot(u[i] - UV[k][0], v[i] - UV[k][1]) for k in UV}
        k = min(d, key=d.get); who.append(k); dist.append(d[k])
    band = fr[:, :, int(H * .72):int(H * .78), int(W * .1):int(W * .9)].astype(int)
    mag = ((abs(band[:, 1] - 212) < 18) & (abs(band[:, 2] - 234) < 18)).reshape(n, -1).mean(axis=1)
    return idx, who, np.array(dist), mag


def _content_offsets(idx, who, dist, clips_spec, margin=0.2):
    """for each clip: median (seen source time - the editor contract's source time) in frames, over the clip's pure frames away from its joins"""
    res = {}
    for letter, start, end, trim in clips_spec:
        errs = []
        for i in range(len(idx)):
            t = i / FPS
            if who[i] == letter and dist[i] < 12 and start + margin <= t < end - margin:
                errs.append(idx[i] - (trim + (t - start)) * FPS)
        res[letter] = (float(np.median(errs)), float(np.max(np.abs(np.array(errs) - np.median(errs))))) if errs else None
    return res


def _tone_span(path, hz):
    r = _run([FF, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"])
    x = np.frombuffer(r.stdout, dtype=np.float32)
    N, Hh = 640, 160
    t = np.arange(N) / 16000
    wn = np.hanning(N)
    c, s = np.cos(2 * np.pi * hz * t) * wn, np.sin(2 * np.pi * hz * t) * wn
    amp = np.array([np.hypot(x[i:i + N] @ c, x[i:i + N] @ s) / (wn.sum() / 2) for i in range(0, len(x) - N, Hh)])
    on = np.where(amp > 0.015)[0]
    return (on[0] * Hh / 16000 + 0.02, (on[-1] + 1) * Hh / 16000 + 0.02) if len(on) else None


# ── hard cuts ───────────────────────────────────────────────────────────────────────────────────

def test_hard_cuts_keep_every_clip_at_its_own_start_time(sources, tmp_path):
    spec = [("A", 0, 2, 1), ("B", 2, 4, 1), ("C", 4, 6, 1)]
    out = _render([_clip(sources[k], s, e, t) for k, s, e, t in spec], tmp_path, "cuts", shapes=[_shape(1, 5)])
    fr = _frames(out)
    idx, who, dist, mag = _read(fr)
    assert len(idx) == 180                                                               # was 177: a cut used to overlap by 0.05 s
    for letter, off in _content_offsets(idx, who, dist, spec).items():
        assert abs(off[0]) <= 1 and off[1] <= 1, (letter, off)
    on = np.where(mag > 0.5)[0]
    assert (on[0], on[-1] + 1) == (30, 150)                                              # a layer is visible for start <= t < end: [1 s, 5 s) is frames 30..149
    for letter, start, end, _t in spec:
        span = _tone_span(out, HZ[letter])
        assert abs(span[0] - start) < 0.08 and abs(span[1] - end) < 0.12, (letter, span)                 # each clip's own audio starts and ends at its own timeline times


# ── dissolve ────────────────────────────────────────────────────────────────────────────────────

def test_a_dissolve_blends_around_the_join_without_moving_either_clip(sources, tmp_path):
    spec = [("A", 0, 2.5, 1), ("B", 2.5, 5, 1)]
    out = _render([_clip(sources["A"], 0, 2.5, 1, "dissolve", 1.0), _clip(sources["B"], 2.5, 5, 1)], tmp_path, "dissolve")
    idx, who, dist, mag = _read(_frames(out))
    assert len(idx) == 150                                                               # was 120: the 1 s overlap shortened the timeline by 1 s
    for letter, off in _content_offsets(idx, who, dist, spec, margin=0.6).items():
        assert abs(off[0]) <= 1 and off[1] <= 1, (letter, off)
    blend = [i / FPS for i in range(len(idx)) if dist[i] >= 12]
    assert blend and min(blend) >= 2.5 - 0.55 and max(blend) <= 2.5 + 0.55              # centred on the join at 2.5 s (a 1 s window: 2.0-3.0 s, its faint ends read as pure)
    a_span, b_span = _tone_span(out, HZ["A"]), _tone_span(out, HZ["B"])
    assert abs(b_span[1] - 5.0) < 0.12 and a_span[0] < 0.08


# ── fade through black ──────────────────────────────────────────────────────────────────────────

def test_a_fade_through_black_is_inside_the_clips_and_darkest_at_the_join(sources, tmp_path):
    spec = [("A", 0, 2.5, 1), ("B", 2.5, 5, 1)]
    out = _render([_clip(sources["A"], 0, 2.5, 1, "fade_black", 1.0), _clip(sources["B"], 2.5, 5, 1)], tmp_path, "fade")
    fr = _frames(out)
    idx, who, dist, _m = _read(fr)
    assert len(idx) == 150
    for letter, off in _content_offsets(idx, who, dist, spec, margin=0.6).items():
        assert abs(off[0]) <= 1 and off[1] <= 1, (letter, off)
    luma = fr[:, 0, int(H * .30):int(H * .55), W // 4:3 * W // 4].reshape(len(idx), -1).mean(axis=1)
    assert abs(int(np.argmin(luma)) / FPS - 2.5) <= 0.07 and luma.min() < 20


# ── a blend with no spare source frames ─────────────────────────────────────────────────────────

def test_without_spare_source_frames_the_blend_is_shortened_not_invented_and_nothing_moves(sources, tmp_path):
    spec = [("B", 0, 2, 0), ("C", 2, 4, 0)]
    out = _render([_clip(sources["B"], 0, 2, 0, "dissolve", 1.0), _clip(sources["Cshort"], 2, 4, 0)], tmp_path, "nohandles")
    idx, who, dist, _m = _read(_frames(out))
    assert len(idx) == 120
    for letter, off in _content_offsets(idx, who, dist, spec).items():
        assert abs(off[0]) <= 1 and off[1] <= 1, (letter, off)


# ── mixed audible and silent clips, and a clip shorter than its neighbours' transitions ─────────

def test_a_silent_clip_and_a_short_clip_between_transitions_keep_the_timeline(sources, tmp_path):
    clips = [_clip(sources["A"], 0, 2, 1, "dissolve", 1.0), _clip(sources["B"], 2, 2.4, 1, "dissolve", 1.0), _clip(sources["C"], 2.4, 5, 1)]
    clips[1]["muted"] = True                                                              # mixed audible / silent
    out = _render(clips, tmp_path, "short")
    idx, who, dist, _m = _read(_frames(out))
    assert len(idx) == 150
    for letter, off in _content_offsets(idx, who, dist, [("A", 0, 2, 1), ("C", 2.4, 5, 1)], margin=0.6).items():
        assert abs(off[0]) <= 1 and off[1] <= 1, (letter, off)
    assert _tone_span(out, HZ["B"]) is None or (_tone_span(out, HZ["B"])[1] - _tone_span(out, HZ["B"])[0]) < 0.8     # the muted clip contributes no steady tone of its own
