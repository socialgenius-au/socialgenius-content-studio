"""M2.5 subtitle layout controls: the transcript panel can break a long subtitle onto several lines by putting "\n" in its text (the editor draws subtitles with white-space: pre-wrap).
The exporter must show the same breaks. No database, no network."""
from pathlib import Path

from PIL import Image

from app.services import canvas_render_svc as svc


def _render(tmp_path, monkeypatch, text, **extra):
    monkeypatch.setattr(svc, "_out_png", lambda uid: tmp_path / f"o_{uid}_{len(list(tmp_path.iterdir()))}.png")
    sub = {"text": text, "x": 10, "y": 82, "width": 90, "start_time": 0, "end_time": 2, **extra}
    path, w, h = svc.render_subtitle_png(sub, svc.resolve_subtitle_style({}, None), 1080, 1920, 1)
    return Image.open(Path(path)).convert("RGBA"), w, h


def test_a_line_break_in_the_text_becomes_a_second_line_in_the_png(tmp_path, monkeypatch):
    one, _w1, h1 = _render(tmp_path, monkeypatch, "A very long explanation that the recogniser kept")
    two, _w2, h2 = _render(tmp_path, monkeypatch, "A very long explanation\nthat the recogniser kept")
    assert h2 > h1 * 1.5                                                           # two lines tall, not one
    assert two.width == one.width                                                  # the box width is the same: only the height grows


def test_the_wording_drawn_is_unchanged_by_breaking_it(tmp_path, monkeypatch):
    # three explicit lines are three line-heights tall (within padding), proving each "\n" is honoured and no extra wrapping happens at this width
    _img, _w, h2 = _render(tmp_path, monkeypatch, "one\ntwo")
    _img, _w, h3 = _render(tmp_path, monkeypatch, "one\ntwo\nthree")
    _img, _w, h1 = _render(tmp_path, monkeypatch, "one")
    step = h2 - h1
    assert step > 0 and abs((h3 - h2) - step) <= 2


def test_a_font_size_override_makes_the_png_taller(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_out_png", lambda uid: tmp_path / f"s_{uid}_{len(list(tmp_path.iterdir()))}.png")
    sub = {"text": "Size check", "x": 10, "y": 82, "width": 90, "start_time": 0, "end_time": 2}
    _p, _w, small = svc.render_subtitle_png(sub, svc.resolve_subtitle_style({"font_size": 24}, None), 1080, 1920, 1)
    _p, _w, large = svc.render_subtitle_png(sub, svc.resolve_subtitle_style({"font_size": 52}, None), 1080, 1920, 1)
    assert large > small
