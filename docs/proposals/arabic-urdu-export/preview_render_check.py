import io, os, sys, hashlib, base64, urllib.request
try:
    import app
except ImportError:
    sys.path.insert(0, os.environ.get("BACKEND", "/app"))
import PIL
from PIL import Image, ImageDraw, ImageFont, features
import app.services.canvas_render_svc as svc

URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf"
data = urllib.request.urlopen(URL, timeout=60).read() if not os.environ.get("FONT_FILE") else open(os.environ["FONT_FILE"], "rb").read()
print("font", len(data), hashlib.sha256(data).hexdigest()[:12], "| pillow", PIL.__version__, "| raqm", features.check("raqm"), "fribidi", features.check("fribidi"), "harfbuzz", features.check("harfbuzz"))


def font(size, bold=False, engine=None):
    f = ImageFont.truetype(io.BytesIO(data), max(1, round(size)), **({"layout_engine": engine} if engine is not None else {}))
    f.set_variation_by_axes([700 if bold else 400])
    return f


svc._load_font = lambda size, bold, *a: font(size, bold)          # the preview's own renderer, with the new font in place of DejaVu; nothing is written anywhere


def box(text, w=900, align="left", size=44, bold=False):
    return svc.render_styled_text_box(text=text, box_w=w, font_size=size, color="#ffffff", align=align, bold=bold)


def ink(im):
    return im.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()


def profile(im, b):
    a = im.getchannel("A").crop(b); w, h = a.size; px = a.load()
    return [sum(px[x, y] for y in range(h)) for x in range(w)]


def best(word, line):
    n = len(word); wn = sum(v * v for v in word) ** .5 or 1.; bs, bx = -1., 0
    for x in range(0, len(line) - n + 1):
        seg = line[x:x + n]; sn = sum(v * v for v in seg) ** .5 or 1.
        sc = sum(a * b for a, b in zip(word, seg)) / (wn * sn)
        if sc > bs: bs, bx = sc, x
    return bx, round(bs, 2)


def where(part, line_im):
    lb, pb = ink(line_im), ink(box(part))
    return best(profile(box(part), pb), profile(line_im, lb))


R = []
def check(name, ok, detail=""):
    R.append(ok); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


# 1 coverage: no .notdef box for any letter, both digit sets, Arabic punctuation or the Latin a mixed line needs
f = font(40)
nd = f.getmask("\U0010ffff"); nd = (bytes(nd), nd.size)
chars = "ابپتٹثجچحخدڈذرڑزژسشصضطظعغفقکگلمنںوہھءیے" + "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹" + "،؟۔؛" + "AaBbEeGgHhMmNnOoSsWw0123456789.,!?-:"
miss = [hex(ord(c)) for c in chars if (bytes(f.getmask(c)), f.getmask(c).size) == nd]
check("coverage: every Urdu letter, both digit sets, punctuation and Latin has a real glyph (incl. U+06C1, U+06D2)", not miss, str(miss))

# 2 shaping: the layout engine joins letters (a joined word is narrower than the same letters set unjoined)
word = "اردو زبان"
raqm_w = ImageDraw.Draw(Image.new("L", (1, 1))).textlength(word, font=font(44))
basic_w = ImageDraw.Draw(Image.new("L", (1, 1))).textlength(word, font=font(44, engine=ImageFont.Layout.BASIC))
check("shaping: Raqm lays the word out differently from unjoined basic layout (letters joined)", abs(raqm_w - basic_w) > 4, f"raqm {raqm_w:.0f}px vs basic {basic_w:.0f}px")
iso = sum(ImageDraw.Draw(Image.new("L", (1, 1))).textlength(c, font=font(44)) for c in word.replace(" ", ""))
check("shaping: the joined word is narrower than the sum of its letters drawn alone (contextual forms)", raqm_w < iso + ImageDraw.Draw(Image.new("L", (1, 1))).textlength(" ", font=font(44)) - 4, f"joined {raqm_w:.0f}px, isolated sum {iso:.0f}px")

# 3 RTL order
line = box("اردو پاکستان")
xa, sa = where("اردو", line); xb, sb = where("پاکستان", line)
check("RTL: the first word of an Urdu sentence is on the RIGHT, the second on the left", sa > .8 and sb > .8 and xa > xb, f"first word x={xa} (match {sa}), second x={xb} (match {sb})")

# 4 punctuation: the question mark and the Urdu full stop belong at the LEFT (the end of a right-to-left sentence)
q = box("کیا آپ ٹھیک ہیں؟")
xq, sq = where("؟", q); xk, sk = where("کیا", q)
check("punctuation: the Arabic question mark ends the sentence at the LEFT; the first word is at the right", sq > .7 and xq < xk, f"؟ x={xq} (match {sq}), کیا x={xk} (match {sk})")
d = box("یہ ایک جملہ ہے۔")
xd, sd = where("۔", d); xj, sj = where("یہ", d)
check("punctuation: the Urdu full stop ۔ ends the sentence at the LEFT", sd > .7 and xd < xj, f"۔ x={xd} (match {sd}), یہ x={xj} (match {sj})")

# 5 numbers keep their own left-to-right order inside a right-to-left sentence
for label, digits in (("Arabic-Indic", "٢٠٢٦"), ("Western", "2026")):
    s = box(f"سال {digits} ہے")
    x, sc = where(digits, s); xs, _ = where("سال", s); xh, _ = where("ہے", s)
    check(f"numbers ({label}): the number reads left-to-right as a block, between the two words", sc > .8 and xh < x < xs, f"number x={x} (match {sc}); ہے x={xh}, سال x={xs}")

# 6 mixed English / Urdu, both base directions
m1 = box("Welcome خوش آمدید to Social Genius", w=1100)
xe1, s1 = where("Welcome", m1); xu1, su1 = where("خوش آمدید", m1); xe2, s2 = where("Social Genius", m1)
check("mixed (English first): paragraph reads left-to-right, the Urdu run sits between the English words, English keeps its order", min(s1, su1, s2) > .75 and xe1 < xu1 < xe2, f"Welcome x={xe1}, Urdu x={xu1}, Social Genius x={xe2}; matches {s1}/{su1}/{s2}")
m2 = box("خوش آمدید Welcome to Social Genius", w=1100)
xu2, tu2 = where("خوش آمدید", m2); xe3, te3 = where("Welcome to Social Genius", m2)
check("mixed (Urdu first): paragraph reads right-to-left, the Urdu is at the right and the English phrase keeps its own left-to-right order at its left", min(tu2, te3) > .75 and xu2 > xe3, f"Urdu x={xu2} (match {tu2}); English x={xe3} (match {te3})")

# a contact sheet to look at, returned as a small PNG (in memory only)
lines = ["اردو پاکستان کا مستقبل", "کیا آپ ٹھیک ہیں؟ جی ہاں۔", "سال ٢٠٢٦ اور 2026 ہے", "Welcome خوش آمدید to Social Genius", "خوش آمدید Welcome to Social Genius", "یہ ایک آزمائش ہے ہے ے ہ"]
sheet = Image.new("RGB", (1100, 78 * len(lines) + 10), (20, 30, 60)); y = 8
for t in lines:
    im = box(t, w=1060, size=46); sheet.paste(im, (20, y), im); y += 78
buf = io.BytesIO(); sheet.save(buf, "PNG", optimize=True)
print("RESULT", sum(R), "of", len(R), "passed")
print("PNGB64:" + base64.b64encode(buf.getvalue()).decode())
