"""Export accuracy: (A) the passes that do not change the audio copy it instead of re-encoding it, so a layered export keeps its exact frame count and timeline length and the audio stays continuous and in sync;
(B) a speed change is resampled to the output frame rate inside the filter chain, so the decoded frames are the intended source frames at 0.5x, 1x, 1.5x and 2x and in a mixed-speed timeline.
Real ffmpeg, barcoded synthetic clips (the helpers and fixtures are the timeline-sync tests')."""
import asyncio
import subprocess
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.services import ffmpeg_svc
from test_timeline_sync_render import FPS, H, HZ, W, _clip, _frames, _read, _tone_span, sources  # noqa: F401  (sources is a fixture)

USER_ID = 993


@pytest.fixture(scope="module")
def long_sources(tmp_path_factory):
    """barcoded A/B/C sources, 14 s long (the timeline-sync fixture's 6 s clips run out when a clip is long, sped up or trimmed in)"""
    from test_timeline_sync_render import BIT_W, UV
    d = tmp_path_factory.mktemp("accsrc")
    out = {}
    for k, (cb, cr) in UV.items():
        p = d / f"long_{k}.mp4"
        geq = f"geq=lum='if(lt(Y,H/8),16+219*mod(floor(N/pow(2,floor(X/{BIT_W}))),2),100)':cb={cb}:cr={cr}"
        r = subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi", "-i", f"nullsrc=s={W}x{H}:r={FPS}:d=14,format=yuv420p,{geq}", "-f", "lavfi", "-i", f"sine=frequency={HZ[k]}:sample_rate=44100:duration=14",
                            "-c:v", "libx264", "-g", "30", "-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(p)], capture_output=True)
        assert r.returncode == 0, r.stderr.decode(errors="replace")[-400:]
        out[k] = str(p)
    return out


def _render(project, tmp_path, tag):
    out = asyncio.run(ffmpeg_svc.render_project(project, USER_ID))
    dst = tmp_path / f"{tag}.mp4"
    dst.write_bytes(Path(out).read_bytes())
    return str(dst)


def _project(clips, **layers):
    p = {"canvas_width": W, "canvas_height": H, "video_clips": clips, "text_overlays": [], "audio_tracks": [], "shapes": [], "subtitle_style": {}}
    p.update(layers)
    return p


def _audio(path):
    r = subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32)


def _tone_amp(x, hz, hop=0.01, win=0.04, sr=16000):
    N, Hh = int(win * sr), int(hop * sr)
    t = np.arange(N) / sr
    wn = np.hanning(N)
    c, s = np.cos(2 * np.pi * hz * t) * wn, np.sin(2 * np.pi * hz * t) * wn
    return np.array([np.hypot(x[i:i + N] @ c, x[i:i + N] @ s) / (wn.sum() / 2) for i in range(0, len(x) - N, Hh)]), hop, win


def _layers(tmp_path, source):
    img = tmp_path / "yellow.png"
    Image.new("RGBA", (60, 60), (255, 200, 0, 255)).save(img)
    voice = tmp_path / "voice.wav"
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100:duration=14", str(voice)], check=True)
    return dict(
        shapes=[{"kind": "rectangle", "start_time": 1, "end_time": 9, "x": 0, "y": 70, "width": 100, "height": 10, "fill_color": "#ff00ff", "opacity": 1.0, "border_color": None, "border_width": 0, "border_radius": 0, "full_width": False, "order": 0}],
        media_overlays=[{"path": str(img), "is_image": True, "order": 0, "start": 1, "end": 9, "x": 10, "y": 10, "width": 30, "height": 15, "opacity": 1.0, "muted": False, "volume": 1.0}],
        additional_video_clips=[{"path": source, "trim_in": 0, "start_time": 1, "end_time": 9, "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0, "fit_mode": "fit", "crop_x": 50, "crop_y": 50,
                                 "insert_x": 56, "insert_y": 56, "insert_width": 38, "insert_height": 38, "opacity": 100}],
        lower_thirds=[{"name": "Maya", "order": 0, "title": "Head", "start_time": 1, "end_time": 9, "x": 5, "y": 78, "width": 55, "height": 14}],
        subtitles=[{"text": "One", "order": 0, "start_time": 1, "end_time": 9, "x": 10, "y": 40, "width": 80, "style_override": None},
                   {"text": "یہ ایک آزمائش ہے", "order": 1, "start_time": 1, "end_time": 9, "x": 10, "y": 50, "width": 80, "style_override": None}],
        audio_tracks=[{"path": str(voice), "trim_in": 0, "start_time": 0, "end_time": 12, "volume": 0.5}],
    )


# ── A: which passes copy the audio ──────────────────────────────────────────────────────────────

def test_only_passes_that_change_the_audio_re_encode_it(long_sources, tmp_path, monkeypatch):
    seen = []
    real = ffmpeg_svc._run

    async def spy(cmd):
        seen.append(list(cmd))
        return await real(cmd)

    monkeypatch.setattr(ffmpeg_svc, "_run", spy)
    _render(_project([_clip(long_sources["A"], 0, 6, 1, "dissolve", 1.0), _clip(long_sources["B"], 6, 12, 1)], **_layers(tmp_path, long_sources["A"])), tmp_path, "cmds")
    codec = lambda c: c[c.index("-c:a") + 1]
    overlay_passes = [c for c in seen if "-filter_complex" in c and "-map" in c and "0:a?" in c]                 # shapes/pictures/inserts/lower thirds/text/subtitles
    assert len(overlay_passes) >= 4 and all(codec(c) == "copy" for c in overlay_passes)                          # none of them touches the audio: copied
    assert all("-t" in c and "-shortest" not in c for c in overlay_passes)                                        # ...and ends at the timeline's exact length: -shortest with copied audio can cut the last video frames
    changing = [c for c in seen if "-filter_complex" in c and ("amix" in " ".join(c) or "acrossfade" in " ".join(c) or "concat" in " ".join(c))]
    assert changing and all(codec(c) == "aac" for c in changing)                                                  # the join and the A1 mix really do change it: still encoded


def test_overlay_audio_is_still_mixed_and_encoded(long_sources, tmp_path):
    ov = {"path": long_sources["B"], "is_image": False, "order": 0, "start": 1, "end": 3, "x": 10, "y": 10, "width": 40, "height": 20, "opacity": 1.0, "muted": False, "volume": 1.0}
    out = _render(_project([_clip(long_sources["A"], 0, 4, 1)], media_overlays=[ov]), tmp_path, "ovaudio")
    x = _audio(out)
    amp_b, hop, win = _tone_amp(x, HZ["B"])
    assert amp_b[int(1.3 / hop):int(2.7 / hop)].min() > 0.01                                                      # the video overlay's own audio (880 Hz) is in the mix while it is on


# ── A: frame count, duration, continuity, sync ──────────────────────────────────────────────────

def test_a_fully_layered_export_keeps_its_frame_count_and_timeline_length(long_sources, tmp_path):
    out = _render(_project([_clip(long_sources["A"], 0, 6, 1, "dissolve", 1.0), _clip(long_sources["B"], 6, 12, 1)], **_layers(tmp_path, long_sources["A"])), tmp_path, "layered")
    n = len(_frames(out))
    x = _audio(out)
    assert n == 360                                                                    # was 358: each pass lost a frame
    assert abs(len(x) / 16000 - 12.0) < 0.03 and abs(ffmpeg_svc_duration(out) - 12.0) < 0.02


def ffmpeg_svc_duration(path):
    return asyncio.run(ffmpeg_svc._get_duration(path))


def test_audio_is_continuous_and_in_sync_through_every_pass(long_sources, tmp_path):
    out = _render(_project([_clip(long_sources["A"], 0, 6, 1), _clip(long_sources["B"], 6, 12, 1)], **_layers(tmp_path, long_sources["A"])), tmp_path, "sync")
    x = _audio(out)
    a, hop, win = _tone_amp(x, HZ["A"])
    b, _h, _w = _tone_amp(x, HZ["B"])
    v, _h2, _w2 = _tone_amp(x, 220.0)
    centre = lambda t: int((t) / hop)
    assert a[centre(0.3):centre(5.6)].min() > 0.02 and b[centre(6.4):centre(11.7)].min() > 0.02                  # each clip's audio has no dropout anywhere inside it
    assert v[centre(0.3):centre(11.7)].min() > 0.01                                                              # the A1 voice-over is continuous across the join
    on_b = (np.where(b > 0.015)[0][0]) * hop + win / 2
    assert abs(on_b - 6.0) < 0.08                                                                                # clip B's audio starts at the editor's 6.0 s
    assert a[centre(6.3):centre(11.5)].max() < 0.02 and b[centre(0.3):centre(5.5)].max() < 0.02                  # no bleed across the join


def test_explicit_gap_keeps_duration_frames_and_audio_after_the_corrections(long_sources, tmp_path):
    out = _render(_project([_clip(long_sources["A"], 0, 3, 1), _clip(long_sources["B"], 4, 7, 1)], **{**_layers(tmp_path, long_sources["A"]), "audio_tracks": []}), tmp_path, "gap2")
    assert len(_frames(out)) == 210
    b = _tone_span(out, HZ["B"])
    assert abs(b[0] - 4.0) < 0.08 and abs(b[1] - 7.0) < 0.12


# ── B: speed accuracy ───────────────────────────────────────────────────────────────────────────

def _errors(idx, who, dist, letter, start, end, trim, speed, margin=0.1):
    out = []
    for i in range(len(idx)):
        t = i / FPS
        if who[i] == letter and dist[i] < 12 and start + margin <= t < end - margin:
            out.append(int(idx[i]) - round((trim + (t - start) * speed) * FPS))
    return out


@pytest.mark.parametrize("speed", [0.5, 1.0, 1.5, 2.0])
def test_decoded_frames_are_the_intended_source_frames_at_every_speed(long_sources, tmp_path, speed):
    out = _render(_project([_clip(long_sources["A"], 0, 3, 1.0, speed=speed)]), tmp_path, f"sp{speed}")
    idx, who, dist, _m = _read(_frames(out))
    assert len(idx) == 90                                                              # exactly the 3 s timeline, at every speed (0.75x used to give 91, 0.5x 89)
    err = _errors(idx, who, dist, "A", 0, 3, 1.0, speed, margin=0.0)
    assert int(np.median(err)) == 0                                                    # no lag (2x used to be one output frame late)
    assert max(abs(e) for e in err) <= (0 if speed in (1.0, 2.0) else 1)               # integer ratios are exact; the others differ from the ideal only by rounding to a whole source frame


def test_a_mixed_speed_timeline_keeps_every_clip_on_its_source_frames_and_the_timeline_length(long_sources, tmp_path):
    clips = [_clip(long_sources["A"], 0, 2, 1.0, speed=2.0), _clip(long_sources["B"], 2, 4, 1.0, speed=1.0), _clip(long_sources["C"], 4, 6, 1.0, speed=0.5)]
    out = _render(_project(clips), tmp_path, "mixed")
    idx, who, dist, _m = _read(_frames(out))
    assert len(idx) == 180
    for letter, start, end, trim, speed in (("A", 0, 2, 1.0, 2.0), ("B", 2, 4, 1.0, 1.0), ("C", 4, 6, 1.0, 0.5)):
        err = _errors(idx, who, dist, letter, start, end, trim, speed)
        assert err and int(np.median(err)) == 0 and max(abs(e) for e in err) <= 1, (letter, err[:12])


def test_speed_change_keeps_the_clips_audio_on_its_own_timeline_span(long_sources, tmp_path):
    out = _render(_project([_clip(long_sources["A"], 0, 3, 1.0, speed=2.0), _clip(long_sources["B"], 3, 6, 1.0, speed=1.0)]), tmp_path, "spaudio")
    a, b = _tone_span(out, HZ["A"]), _tone_span(out, HZ["B"])
    assert abs(a[1] - 3.0) < 0.15 and abs(b[0] - 3.0) < 0.1 and abs(b[1] - 6.0) < 0.15


def test_the_speed_change_adds_one_resample_to_the_filter_chain_and_nothing_else(long_sources, tmp_path, monkeypatch):
    seen = []
    real = ffmpeg_svc._run

    async def spy(cmd):
        seen.append(list(cmd))
        return await real(cmd)

    monkeypatch.setattr(ffmpeg_svc, "_run", spy)
    _render(_project([_clip(long_sources["A"], 0, 3, 1.0, speed=2.0)]), tmp_path, "vf")
    vf = next(c[c.index("-vf") + 1] for c in seen if "-vf" in c)
    assert "setpts=PTS/2.0,fps=30" in vf
    seen.clear()
    _render(_project([_clip(long_sources["A"], 0, 3, 1.0, speed=1.0)]), tmp_path, "vf1")
    assert "setpts" not in next(c[c.index("-vf") + 1] for c in seen if "-vf" in c)       # 1x clips take exactly the path they always did


def test_layers_that_outlast_the_timeline_do_not_shorten_it(long_sources, tmp_path):
    """layer windows may run past the end of the timeline (a layer placed near the end and the clips trimmed afterwards). -shortest with copied audio used to cut 2-4 video frames here (found while verifying this change)."""
    for tag, clips, total in (("contig", [_clip(long_sources["A"], 0, 3, 1), _clip(long_sources["B"], 3, 7, 1)], 210), ("gapped", [_clip(long_sources["A"], 0, 3, 1), _clip(long_sources["B"], 4, 7, 1)], 210)):
        out = _render(_project(clips, **{**_layers(tmp_path, long_sources["A"]), "audio_tracks": []}), tmp_path, f"past_{tag}")      # every layer runs to 9 s on a 7 s timeline
        assert len(_frames(out)) == total, tag
