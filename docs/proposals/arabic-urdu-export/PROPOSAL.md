# Arabic / Urdu subtitle export — dependency assessment and proposal

Status: **assessment only. Nothing here is installed, downloaded or deployed.** No dependency, font or Railway setting has been changed. The existing editor warnings for unsupported scripts are unchanged and stay until a fix is verified.

## 1. The problem, as measured

The real VA5368 transcript is Urdu in Arabic script. The editor shows it correctly (the browser lays it out). The MP4 does not, because the exporter draws text with Pillow's *basic* layout and one font:

* **No right-to-left ordering, no joining/shaping:** Pillow's basic engine places characters left to right as stored.
* **Missing glyphs:** the bundled DejaVu Sans has no glyph for the Urdu letters U+06C1 (ہ) and U+06D2 (ے): 35 of the transcript's 328 letters (11 %) export as empty boxes.
* The same limits apply to Hebrew, Indic scripts, Thai and CJK (the panel's warning already covers them).

## 2. What the existing export runtime has (read from the repository and this machine)

| Question | Finding |
|---|---|
| Fonts | Two bundled files: `DejaVuSans.ttf` (760 KB) and `DejaVuSans-Bold.ttf` (709 KB), licence in `backend/app/assets/fonts/LICENSE.txt` (Bitstream Vera / public-domain changes). |
| Pillow | `Pillow>=11.0.0`, unpinned. The local development copy is 12.3.0 on Windows with `raqm`, `fribidi` and `harfbuzz` all **unavailable**, so it cannot show the result either way. |
| Production image | `backend/Dockerfile`: `python:3.12-slim` plus `apt-get install ffmpeg git curl build-essential libpq-dev`. No FriBiDi, HarfBuzz or any font package is installed. |
| Right-to-left shaping | Not available in the renderer today. `canvas_render_svc.py` never selects a layout engine and never passes `direction`, `language` or OpenType `features`. |
| Per-character drawing | `_draw_text_line` draws character by character when `letter_spacing ≠ 0`. That breaks shaping, but subtitles never set letter spacing (text overlays can). |
| Mixed-language lines | Pillow uses **one font per draw call** and does no font fallback. A line of Urdu with an English word needs either one font with both scripts or per-run fonts. |
| Railway | Not inspected beyond the repository's own `Dockerfile` and `railway.toml`. No Railway setting was touched. |

**Not established (stated, not assumed):** whether Pillow's current Linux wheels vendor FriBiDi or load the system `libfribidi` at run time. A web search did not settle it, and there is no container runtime on this machine to test it. This decides whether Option A needs an `apt` line (below). It is settled by one read-only command on the production image: `python -c "from PIL import features; print(features.check('raqm'), features.check('fribidi'), features.check('harfbuzz'))"`.

## 3. Options

### Option A (recommended): complex-text layout with Pillow's own Raqm engine + one OFL font

* **Layout:** use `ImageFont.truetype(..., layout_engine=ImageFont.Layout.RAQM)` when `features.check("raqm")` is true, with a graceful fallback to today's basic layout otherwise. Raqm gives right-to-left ordering, Arabic joining/shaping and the bidi algorithm for mixed lines in a single call. No new Python package (Pillow is already required).
* **Possible system line:** if the production check above reports `raqm`/`fribidi` unavailable, add `libfribidi0` to the existing `apt-get install` line of `backend/Dockerfile` (a Debian shared library, LGPL-2.1, dynamically linked, about 100 KB). This is a **Railway build change and needs your approval**.
* **Font:** add **Noto Naskh Arabic** (Regular and Bold) as a second bundled font. It is a Noto font under the **SIL Open Font License 1.1** (sources: [Fontsource](https://fontsource.org/fonts/noto-naskh-arabic/about), [the OFL listing](https://online-fonts.com/fonts/noto-naskh-arabic)): free for commercial use, may be bundled and redistributed with software, must ship with its copyright and licence text, may not be sold on its own, and carries no obligation on our code. It lists Urdu among its languages (1,598 glyphs). I could not confirm its file size from the searches; Noto Naskh files are a few hundred KB each, to be measured on the exact files before anything is added. The licence file `NotoNaskhArabic-OFL.txt` would sit next to the existing `LICENSE.txt`.
* **Script routing:** a line containing Arabic-block characters is drawn with the Naskh font, any other line with DejaVu, exactly as today. **Mixed Urdu + English lines** need glyph coverage checked on the exact font file (does Naskh carry the Latin letters used?). If not, the second step is per-run font selection (split the line into script runs, draw each with its font, order runs with the bidi algorithm). That is more code and its own tests; it is staged separately below.
* **Resource impact:** image +~0.5–1 MB (fonts) and ~100 KB if `libfribidi0` is needed; build time + a few seconds; memory: fonts are cached once per size and are small; CPU: shaping adds milliseconds per subtitle image (a 100-subtitle export adds well under a second); no new network service.
* **Risk:** low. Feature-detected with a fallback, confined to `canvas_render_svc.py` (protected), covered by pixel tests that render real Urdu through the real renderer.

### Option B: pure-Python reshaping (`arabic-reshaper` + `python-bidi`)

Reorder and shape the string in Python, then draw the result with the basic engine and an Arabic-capable font. **Two new pip dependencies** (both small; licences to be confirmed before use) and still needs the Naskh font. Works without any system library, but it is a re-implementation of what Raqm does, handles fewer cases (mixed numerals, marks, stroke/shadow interplay), and adds long-term maintenance. Only worth it if Option A's system library cannot be added.

### Option C: render the text in the browser

The browser already lays Arabic out correctly; the editor could render a subtitle to an image and send it. That turns text into a picture (no longer editable text in the export request), adds uploads and storage, and changes the architecture. Not recommended.

### Option D: do nothing

Keep the warnings. Urdu/Arabic subtitles remain editor-only until the exporter changes.

## 4. Proposed stages (each needs its own approval)

1. **Read-only check on the production image** (one command, above) to decide whether `libfribidi0` is needed. No change.
2. **Fonts and licence files:** add Noto Naskh Arabic Regular/Bold and the OFL text under `backend/app/assets/fonts/` (measure sizes first; verify Latin and Urdu glyph coverage with the file in hand).
3. **Renderer:** feature-detected Raqm; Arabic-block lines use the Naskh font; `letter_spacing` ignored for shaped lines; tests that render real Urdu text and assert joined glyphs, right-to-left order and **no missing-glyph boxes** for U+06C1/U+06D2 on both portrait and landscape canvases.
4. **Dockerfile** (only if stage 1 says so): add `libfribidi0`. Staging build first; no production change without approval.
5. **Mixed-language runs** (only if the coverage check says Naskh lacks the Latin letters).
6. **Panel:** keep the warning until the renderer is verified, then replace it by a capability check (a small read-only endpoint reporting what the exporter can draw) so the warning disappears only where it is true.

## 5. What would be needed from you

Approval for: the stage-1 read-only check on the production container; adding the two font files (OFL); the renderer change in `canvas_render_svc.py`; and, if needed, the one `apt` line in `backend/Dockerfile`. Until then nothing changes and the warnings stay.
