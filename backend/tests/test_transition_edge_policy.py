"""Opt-in transition edge policy "hold_incoming": when the incoming clip has no spare frames before its first frame (and the outgoing clip none after its last), a dissolve keeps its full length by
holding the incoming clip's FIRST frame while it fades in. Verified here with real ffmpeg on barcoded synthetic clips that are exactly as long as their use (no spare frames anywhere):
 - the default ("shorten", or no policy at all) is unchanged: the dissolve collapses to a hard cut at the join, and an explicit "shorten" is identical to no policy;
 - with "hold_incoming" the total length, the join position and the incoming clip's own footage (frame 0 at the join, frame k at join+k) are unchanged;
 - inside the window the picture is a blend of the outgoing clip's own frames and the incoming clip's frame 0, held (not its real frames 0..14);
 - the incoming clip's audio is silent during the hold and enters at the join; the outgoing clip's audio fades out across the window; the audio length is unchanged.
Synthetic test inputs, not real reference footage."""
import asyncio
import subprocess
from pathlib import Path

import numpy as np
import pytest

from app.services import ffmpeg_svc
from test_timeline_sync_render import BIT_W, FPS, H, HZ, NBITS, UV, W, _clip, _frames, _read, _run, _tone_span, sources  # noqa: F401  (sources is a fixture)

USER_ID = 994
JOIN = 60          # frame of the join: the outgoing clip is 2 s long
WINDOW = 15        # a 0.5 s dissolve


@pytest.fixture(scope="module")
def short_pair(sources, tmp_path_factory):
    """the outgoing clip (C) and the incoming clip (B), each exactly 2 s long: no spare source frames before or after either"""
    d = tmp_path_factory.mktemp("edgepolicy")
    out = {}
    for k in ("C", "B"):
        p = d / f"short_{k}.mp4"
        _run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-i", sources[k], "-t", "2", "-c", "copy", str(p)])
        out[k] = str(p)
    return out


def _render(short_pair, tmp_path, tag, policy=None):
    clips = [_clip(short_pair["C"], 0, 2, trim=0.0, transition="dissolve", td=0.5), _clip(short_pair["B"], 2, 4, trim=0.0)]
    project = {"canvas_width": W, "canvas_height": H, "video_clips": clips, "text_overlays": [], "shapes": [], "audio_tracks": [], "subtitle_style": {}}
    if policy is not None:
        project["transition_edge_policy"] = policy
    out = asyncio.run(ffmpeg_svc.render_project(project, USER_ID))
    dst = tmp_path / f"{tag}.mp4"
    dst.write_bytes(Path(out).read_bytes())
    return str(dst)


def _alpha(fr):
    """how far each frame has moved from the outgoing clip's chroma toward the incoming clip's (0 = all outgoing, 1 = all incoming)"""
    u = np.median(fr[:, 1, int(H * .30):int(H * .55), W // 4:3 * W // 4].reshape(len(fr), -1), axis=1)
    return (u - UV["C"][0]) / (UV["B"][0] - UV["C"][0])


def _strip(fr, n):
    """the barcode strip's luma at each bit centre for frame n"""
    return np.array([fr[n, 0, H // 16, k * BIT_W + BIT_W // 2] for k in range(NBITS)], dtype=float)


def _bits(idx):
    return np.array([16 + 219 * ((idx >> k) & 1) for k in range(NBITS)], dtype=float)


def _amp(path, hz, hop=0.01, win=0.04, sr=16000):
    r = subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True, check=True)
    x = np.frombuffer(r.stdout, dtype=np.float32)
    N, Hh = int(win * sr), int(hop * sr)
    t = np.arange(N) / sr
    wn = np.hanning(N)
    c, s = np.cos(2 * np.pi * hz * t) * wn, np.sin(2 * np.pi * hz * t) * wn
    return np.array([np.hypot(x[i:i + N] @ c, x[i:i + N] @ s) / (wn.sum() / 2) for i in range(0, len(x) - N, Hh)]), hop, len(x) / sr


def test_the_default_is_unchanged_and_an_explicit_shorten_is_identical(short_pair, tmp_path):
    none = _frames(_render(short_pair, tmp_path, "none"))
    shorten = _frames(_render(short_pair, tmp_path, "shorten", "shorten"))
    assert none.shape == shorten.shape and (none == shorten).all()
    idx, who, dist, _ = _read(none)
    assert len(idx) == 120
    assert who[JOIN - 1] == "C" and who[JOIN] == "B"                       # no spare frames: the dissolve shortened away to a hard cut at the join
    assert idx[JOIN - 1] == JOIN - 1 and idx[JOIN] == 0 and idx[JOIN + 5] == 5
    assert dist[JOIN - 3:JOIN + 3].max() < 6                               # pure frames either side: nothing is blended


def test_hold_incoming_keeps_the_length_and_the_join_and_does_not_move_the_incoming_footage(short_pair, tmp_path):
    base = _frames(_render(short_pair, tmp_path, "base"))
    held = _frames(_render(short_pair, tmp_path, "held", "hold_incoming"))
    assert held.shape == base.shape == (120, 3, H, W)                      # same total length, frame for frame
    idx, who, dist, _ = _read(held)
    assert who[JOIN] == "B" and idx[JOIN] == 0 and dist[JOIN] < 12         # the incoming clip still starts on its frame 0 exactly at the join (the blend reaches ~96 % on that frame and is complete on the next, as with every dissolve)
    assert dist[JOIN + 1] < 3
    assert list(idx[JOIN:JOIN + 10]) == list(range(10))                    # and plays its own footage from there, unshifted
    assert list(idx[:JOIN - WINDOW]) == list(range(JOIN - WINDOW))         # the outgoing clip is untouched before the window
    assert np.abs(held[JOIN + 20:].astype(int) - base[JOIN + 20:].astype(int)).max() <= 2             # everything after the window is the same as the default (to the encoder's rounding)
    assert (held[:JOIN - WINDOW] == base[:JOIN - WINDOW]).all()            # ... and everything before it, exactly


def _pixels(fr, n, k):
    """the luma pixels of bit k's cell in the barcode strip of frame n (a margin inside the cell, so edges do not count)"""
    return fr[n, 0, 4:H // 8 - 4, k * BIT_W + 4:(k + 1) * BIT_W - 4]


def test_inside_the_window_every_pixel_is_the_outgoing_footage_or_the_incoming_clips_first_frame_held(short_pair, tmp_path):
    """ffmpeg's `dissolve` switches pixels from one picture to the other at random times (it does not mix them), so inside the window each barcode pixel is either the outgoing frame's bit
    or the incoming picture's bit. The incoming first frame has every bit 0 (frame number 0): a bright pixel where the OUTGOING bit is 0 can only come from an incoming picture that is
    moving on (frame number > 0), so none must exist if the first frame is really held."""
    held = _frames(_render(short_pair, tmp_path, "held2", "hold_incoming"))
    a = _alpha(held)
    assert a[JOIN - WINDOW - 1] < 0.05 and a[JOIN] > 0.9                   # a real dissolve: outgoing before it, incoming after it
    ramp = [a[n] for n in range(JOIN - WINDOW, JOIN)]
    assert all(b >= x - 0.03 for x, b in zip(ramp, ramp[1:])) and ramp[-1] - ramp[0] > 0.6            # steadily moves toward the incoming clip
    bad, sensitive, switched = 0, 0, []
    for n in range(JOIN - WINDOW + 2, JOIN - 1):
        k_moving = n - (JOIN - WINDOW)                                     # where the incoming clip would be if it were playing on instead of being held
        for k in range(NBITS):
            out_bit, moving_bit = (n >> k) & 1, (k_moving >> k) & 1
            high = _pixels(held, n, k) > 128
            if out_bit == 0:
                bad += int(high.sum())                                     # bright where the outgoing frame is dark: only a moving incoming picture could do that
                sensitive += int(moving_bit) * high.size                   # the number of pixels where a moving incoming picture WOULD have shown up
            else:
                switched.append((n, 1 - high.mean()))                      # share already switched to the (dark) incoming first frame
    assert bad <= 0.003 * max(sensitive, 1), (bad, sensitive)             # held: essentially no such pixels
    assert sensitive > 3000                                                # and the check could have seen them: plenty of pixels where a moving picture would differ
    for n, share in switched:
        assert abs(share - float(np.clip(a[n], 0, 1))) < 0.3, (n, share, a[n])      # and the switched share follows the dissolve's progress


def test_the_incoming_audio_is_silent_during_the_hold_and_enters_at_the_join_while_the_outgoing_audio_fades_out(short_pair, tmp_path):
    base = _render(short_pair, tmp_path, "abase")
    held = _render(short_pair, tmp_path, "aheld", "hold_incoming")
    b_start, b_end = _tone_span(held, HZ["B"])
    assert abs(b_start - 2.0) < 0.08                                       # B's sound begins at the join, not at the start of the window (1.5 s)
    amp_b, hop, dur = _amp(held, HZ["B"])
    assert amp_b[int(1.55 / hop):int(1.95 / hop)].max() < 0.02             # silent while its first frame is held
    amp_c, hop, _ = _amp(held, HZ["C"])
    assert amp_c[int(1.0 / hop)] > 0.1                                     # the outgoing clip is at full level before the window
    fade = amp_c[int(1.5 / hop):int(2.0 / hop)]
    assert fade[0] > 0.7 * amp_c[int(1.0 / hop)] and fade[-3:].max() < 0.25 * amp_c[int(1.0 / hop)] and fade[0] > fade[len(fade) // 2] > fade[-2]     # fades out across the window
    _, _, base_dur = _amp(base, HZ["C"])
    assert abs(dur - base_dur) < 0.06 and abs(dur - 4.0) < 0.08            # the audio length is unchanged
