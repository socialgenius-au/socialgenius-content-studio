"""Arabic / Urdu export text: lines that contain Arabic-script characters are drawn with the bundled Noto Naskh Arabic (SIL OFL 1.1) instead of DejaVu, which lacks letters such as U+06C1 and
U+06D2. Everything that does not need Raqm is tested here for real; the two right-to-left checks need Pillow's Raqm layout (present in the production image, absent on a plain Windows
install) and are skipped where it is missing. No database, no network."""
import hashlib
from pathlib import Path

import pytest
from PIL import Image, ImageFont, features

from app.services import canvas_render_svc as svc

FONTS = Path(svc.__file__).resolve().parent.parent / "assets" / "fonts"
RAQM = features.check("raqm") and features.check("fribidi")

URDU_LETTERS = "ابپتٹثجچحخدڈذرڑزژسشصضطظعغفقکگلمنںوہھءیے"          # the Urdu alphabet, including ہ (U+06C1), ھ (U+06BE), ے (U+06D2), ں (U+06BA), ٹ ڈ ڑ
DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹"
PUNCT = "،؟۔؛"
LATIN = "Hello World 2026 .,!?-:'\"()/%&@"


def _blank_mask(font):
    m = font.getmask("\U0010ffff")                                                  # a code point no font maps: FreeType draws .notdef
    return bytes(m), m.size


def _has_glyph(font, ch):
    m = font.getmask(ch)
    return (bytes(m), m.size) != _blank_mask(font)


def test_the_font_and_its_licence_are_bundled_unmodified():
    ttf, lic = FONTS / "NotoNaskhArabic-VF.ttf", FONTS / "NotoNaskhArabic-OFL.txt"
    assert hashlib.sha256(ttf.read_bytes()).hexdigest() == "67b5a525a661b607971fbd3f96a81b89d3a768e74534fca84f18ac97e6fab72f" and ttf.stat().st_size == 307592
    text = lic.read_text(encoding="utf-8")
    assert "SIL OPEN FONT LICENSE Version 1.1" in text and "The Noto Project Authors" in text
    assert "Noto Naskh Arabic" in (FONTS / "LICENSE.txt").read_text(encoding="utf-8")


def test_the_missing_letters_are_missing_from_dejavu_and_present_in_naskh():
    dejavu, naskh = svc._load_font(40, False), svc._load_font(40, False, True)
    for ch in "ہے":
        assert not _has_glyph(dejavu, ch), hex(ord(ch))                            # the defect: drawn as an empty box today
        assert _has_glyph(naskh, ch), hex(ord(ch))                                # fixed


@pytest.mark.parametrize("weight_bold", [False, True])
def test_naskh_draws_every_urdu_letter_digit_punctuation_mark_and_the_latin_a_mixed_line_needs(weight_bold):
    font = svc._load_font(40, weight_bold, True)
    missing = [hex(ord(c)) for c in URDU_LETTERS + DIGITS + PUNCT + LATIN.replace(" ", "") if not _has_glyph(font, c)]
    assert missing == [], missing                                                  # one font covers a mixed Urdu + English line


def test_only_arabic_script_lines_change_font():
    assert svc.has_arabic_script("سلام") and svc.has_arabic_script("Hello سلام") and svc.has_arabic_script("ہے") and svc.has_arabic_script("ﷺ")
    assert not svc.has_arabic_script("Hello world 123") and not svc.has_arabic_script("") and not svc.has_arabic_script("שלום 你好 नमस्ते")      # other scripts keep today's warning, unchanged
    assert svc._load_font(30, False, svc.has_arabic_script("English")) is svc._load_font(30, False)                                          # English: the very same DejaVu font object as before
    assert svc._load_font(30, True, svc.has_arabic_script("English")) is svc._load_font(30, True)
    assert svc._load_font(30, False, True) is not svc._load_font(30, False)


def test_a_missing_font_file_falls_back_to_dejavu_instead_of_failing_an_export(monkeypatch):
    monkeypatch.setattr(svc, "_NASKH_PATH", FONTS / "does-not-exist.ttf")
    svc._FONT_CACHE.clear()
    assert svc._load_font(31, False, True) is svc._load_font(31, False)
    svc._FONT_CACHE.clear()


def _box(text, **kw):
    args = dict(text=text, box_w=600, font_size=40, color="#ffffff", align="center", bold=False)
    args.update(kw)
    return svc.render_styled_text_box(**args)


def _ink(img: Image.Image):
    a = img.getchannel("A").point(lambda v: 255 if v > 40 else 0)
    return a.getbbox()


def test_an_urdu_line_renders_with_ink_and_bold_is_heavier_than_regular():
    reg, bold = _box("اردو زبان ہے", bold=False), _box("اردو زبان ہے", bold=True)
    assert _ink(reg) is not None and _ink(bold) is not None
    ink = lambda im: sum(1 for v in im.getchannel("A").getdata() if v > 128)
    assert ink(bold) > ink(reg)                                                    # the weight axis took effect


def test_letter_spacing_never_breaks_arabic_joining():
    assert _box("اردو زبان ہے", letter_spacing=6).tobytes() == _box("اردو زبان ہے", letter_spacing=0).tobytes()


def test_english_text_is_unchanged_by_this_feature(monkeypatch):
    same = _box("Hello world, this is a subtitle.", letter_spacing=2, bold=True)
    monkeypatch.setattr(svc, "_NASKH_PATH", FONTS / "does-not-exist.ttf")          # even with the new font gone, English renders identically
    svc._FONT_CACHE.clear()
    assert _box("Hello world, this is a subtitle.", letter_spacing=2, bold=True).tobytes() == same.tobytes()
    svc._FONT_CACHE.clear()


def test_subtitle_and_lower_third_png_render_urdu(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_out_png", lambda uid: tmp_path / f"o_{uid}_{len(list(tmp_path.iterdir()))}.png")
    sub = {"text": "یہ ایک آزمائش ہے", "x": 10, "y": 82, "width": 80, "start_time": 0, "end_time": 2}
    path, w, h = svc.render_subtitle_png(sub, svc.resolve_subtitle_style({}, None), 540, 960, 1)
    assert Path(path).exists() and w > 0 and h > 0 and _ink(Image.open(path).convert("RGBA")) is not None
    lt = {"name": "نام", "title": "Head of Growth", "width": 55, "height": 14}
    p2, _w, _h = svc.render_lower_third_png(lt, 540, 960, 1)
    assert Path(p2).exists()


def _profile(im: Image.Image, box):
    a = im.getchannel("A").crop(box)
    w, h = a.size
    px = a.load()
    return [sum(px[x, y] for y in range(h)) for x in range(w)]


def _best_position(word_profile, line_profile):
    """x offset in the line where the word's column-ink profile matches best (sliding dot product, normalised)"""
    best, best_x = -1.0, 0
    n = len(word_profile)
    wn = sum(v * v for v in word_profile) ** 0.5 or 1.0
    for x in range(0, len(line_profile) - n + 1):
        seg = line_profile[x:x + n]
        sn = sum(v * v for v in seg) ** 0.5 or 1.0
        score = sum(a * b for a, b in zip(word_profile, seg)) / (wn * sn)
        if score > best:
            best, best_x = score, x
    return best_x, best


@pytest.mark.skipif(not RAQM, reason="needs Pillow's Raqm layout (in the production image); a plain Windows install has none")
def test_urdu_reads_right_to_left_so_the_first_word_is_on_the_right():
    line, first, second = _box("اردو پاکستان", box_w=900, align="left"), _box("اردو", box_w=900, align="left"), _box("پاکستان", box_w=900, align="left")
    lb, fb, sb = _ink(line), _ink(first), _ink(second)
    lp = _profile(line, (lb[0], lb[1], lb[2], lb[3]))
    x_first, score_first = _best_position(_profile(first, fb), lp)
    x_second, score_second = _best_position(_profile(second, sb), lp)
    assert score_first > 0.8 and score_second > 0.8                                  # each word really is in the line, drawn the way it is drawn alone (joined)
    assert x_first > x_second                                                       # right-to-left: the FIRST word of the sentence is the right-hand one


@pytest.mark.skipif(not RAQM, reason="needs Pillow's Raqm layout (in the production image)")
def test_a_mixed_english_and_urdu_line_keeps_both_in_one_font_and_one_line():
    img = _box("Welcome خوش آمدید to Social Genius", box_w=900)
    assert _ink(img) is not None and img.height < 120                               # one line, English and Urdu runs together
