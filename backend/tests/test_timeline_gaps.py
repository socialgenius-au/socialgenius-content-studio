"""An explicit gap between V1 clips (or before the first clip) is exported as black video and silence, exactly as the editor shows it, WITHOUT shifting anything: the footage after the gap sits at its own
start time, and layers, subtitles and A1 audio laid at absolute times stay in step. Real ffmpeg renders of barcoded synthetic clips; the helpers are the ones the timeline-sync tests use."""
import asyncio
import subprocess
from pathlib import Path

import numpy as np
import pytest

from app.services import ffmpeg_svc, timeline_plan as tp
from test_timeline_sync_render import FPS, H, HZ, W, _clip, _content_offsets, _frames, _read, _shape, _tone_span, sources  # noqa: F401  (sources is a fixture)

USER_ID = 997


def clip(start, end):
    return {"start_time": start, "end_time": end}


def test_runs_are_split_only_at_a_real_gap():
    assert len(tp.split_runs([clip(0, 2), clip(2, 4), clip(4, 6)])) == 1
    assert [len(r) for r in tp.split_runs([clip(0, 2), clip(3, 5), clip(5, 6)])] == [1, 2]
    assert len(tp.split_runs([clip(0, 2), clip(2.01, 4)])) == 1                       # less than one frame apart: contiguous, as before
    assert len(tp.split_runs([clip(0, 2), clip(1.9, 4)])) == 1                        # an overlap is not a gap


def test_the_gap_graph_forces_exact_lengths_and_makes_black_and_silence_for_a_gap():
    args, graph = ffmpeg_svc.build_gap_graph([("a.mp4", 60), (None, 30), ("b.mp4", 60)])
    assert args.count("-i") == 4 and "color=c=black" in " ".join(args) and "anullsrc" in " ".join(args)
    assert graph.count("trim=end_frame=60") == 2 and "trim=end_frame=30" in graph and "atrim=end=1.000000" in graph and "concat=n=3:v=1:a=1" in graph


def _tone_wav(tmp_path, hz, secs):
    p = tmp_path / f"a1_{hz}.wav"
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi", "-i", f"sine=frequency={hz}:sample_rate=44100:duration={secs}", str(p)], check=True)
    return str(p)


def _project(clips, tmp_path, shapes=(), tracks=()):
    return {"canvas_width": W, "canvas_height": H, "video_clips": clips, "text_overlays": [], "shapes": list(shapes), "audio_tracks": list(tracks), "subtitle_style": {}}


def _render(project, tmp_path, tag):
    out = asyncio.run(ffmpeg_svc.render_project(project, USER_ID))
    dst = tmp_path / f"{tag}.mp4"
    dst.write_bytes(Path(out).read_bytes())
    return str(dst)


def test_a_gap_is_black_and_silent_and_nothing_after_it_moves(sources, tmp_path):
    clips = [_clip(sources["A"], 0, 2, 1), _clip(sources["B"], 3, 5, 1)]                # A at 0-2 s, a 1 s gap, B at 3-5 s
    a1 = {"path": _tone_wav(tmp_path, 3000, 6), "trim_in": 0, "start_time": 0.5, "end_time": 4.5, "volume": 1.0}
    out = _render(_project(clips, tmp_path, shapes=[_shape(3.5, 4.5)], tracks=[a1]), tmp_path, "gap")
    fr = _frames(out)
    idx, who, dist, mag = _read(fr)
    assert len(idx) == 150                                                                   # 5 s: the gap is kept, not collapsed
    for letter, off in _content_offsets(idx, who, dist, [("A", 0, 2, 1), ("B", 3, 5, 1)]).items():
        assert abs(off[0]) <= 1 and off[1] <= 1, (letter, off)                              # B's footage is at the editor's own 3.0 s
    luma = fr[:, 0].reshape(len(idx), -1).mean(axis=1)
    assert luma[62:88].max() < 24 and abs(fr[62:88, 1].mean() - 128) < 4                     # the gap is black (frames 60-89), not a held or stretched frame
    on = np.where(mag > 0.5)[0]
    assert (on[0], on[-1] + 1) == (105, 135)                                                 # the layer laid at 3.5-4.5 s is exactly there: the gap did not shift it
    b = _tone_span(out, HZ["B"])
    assert abs(b[0] - 3.0) < 0.08 and abs(b[1] - 5.0) < 0.12                                  # B's own audio starts at 3.0 s
    assert _tone_span(out, HZ["A"])[1] < 2.1                                                  # A's audio stops with A, and nothing of it leaks into the gap
    narration = _tone_span(out, 3000.0)
    assert abs(narration[0] - 0.5) < 0.08 and abs(narration[1] - 4.5) < 0.12                  # the A1 track plays straight through the gap at its absolute times


def test_a_leading_gap_is_black_and_everything_starts_at_its_own_time(sources, tmp_path):
    out = _render(_project([_clip(sources["A"], 1, 3, 1)], tmp_path), tmp_path, "lead")
    fr = _frames(out)
    idx, who, dist, _m = _read(fr)
    assert len(idx) == 90
    assert fr[:, 0][:28].reshape(28, -1).mean(axis=1).max() < 24                              # the first second is black
    for letter, off in _content_offsets(idx, who, dist, [("A", 1, 3, 1)]).items():
        assert abs(off[0]) <= 1 and off[1] <= 1, (letter, off)


def test_a_transition_inside_a_run_still_works_next_to_a_gap(sources, tmp_path):
    clips = [_clip(sources["A"], 0, 2, 1, "dissolve", 1.0), _clip(sources["B"], 2, 4, 1), _clip(sources["C"], 5, 7, 1)]
    out = _render(_project(clips, tmp_path), tmp_path, "gapdissolve")
    idx, who, dist, _m = _read(_frames(out))
    assert len(idx) == 210
    for letter, off in _content_offsets(idx, who, dist, [("A", 0, 2, 1), ("B", 2, 4, 1), ("C", 5, 7, 1)], margin=0.6).items():
        assert abs(off[0]) <= 1 and off[1] <= 1, (letter, off)


def test_a_project_without_a_gap_is_unchanged_one_run(sources, tmp_path):
    out = _render(_project([_clip(sources["A"], 0, 2, 1), _clip(sources["B"], 2, 4, 1)], tmp_path), tmp_path, "nogap")
    assert len(_read(_frames(out))[0]) == 120
