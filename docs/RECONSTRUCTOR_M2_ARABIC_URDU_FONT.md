# Arabic / Urdu export text: Noto Naskh Arabic

Branch `feature/m2-arabic-urdu-font` (from the released `d46bfa8`). **Local only, not pushed, not deployed: needs review.** Touches the protected `backend/app/services/canvas_render_svc.py` (approved for this change). No dependency, Dockerfile, system package or Railway change: the font is a file under `backend/app/assets/fonts/` that the existing `COPY . .` already ships.

## Licence (verified)

Noto Naskh Arabic, SIL Open Font License 1.1, copyright 2022 The Noto Project Authors. The OFL text from `github.com/notofonts/arabic` and from `github.com/google/fonts/ofl/notonaskharabic` is byte-identical (SHA-256 `a7a5a25e…ee13af`); the font's own METADATA says `license: "OFL"`. OFL permits bundling and redistribution with software, requires the licence and copyright to travel with the font (done: `NotoNaskhArabic-OFL.txt`, and an entry in the fonts `LICENSE.txt`), and forbids selling the font on its own. The font is **unmodified**. File: `NotoNaskhArabic-VF.ttf`, 307,592 bytes, SHA-256 `67b5a525a661b607971fbd3f96a81b89d3a768e74534fca84f18ac97e6fab72f` (pinned by a test). One variable font covers Regular (400) and Bold (700) and includes Latin.

## What changed

A line containing Arabic-script characters (Arabic, Urdu, Persian: the ranges U+0600–06FF, 0750–077F, 0870–08FF, FB50–FDFF, FE70–FEFF) is drawn with Naskh (weight 400 or 700 by the layer's Bold setting); every other line keeps DejaVu exactly as before (the very same font object; English output is byte-identical). Letter spacing is ignored for Arabic lines (per-character drawing would break joining). A missing font file falls back to DejaVu rather than failing an export. Subtitles, text overlays and lower-third name/title all go through the same routing. Layout (joining, right-to-left order, mixed runs) is Pillow's own Raqm engine, which the production image already has and uses by default (measured read-only on 2026-10-30: Pillow 13.0.0, Raqm/FriBiDi/HarfBuzz present, default engine RAQM).

## Results

* The missing characters: DejaVu has no glyph for U+06C1 (ہ) and U+06D2 (ے); Naskh has both. On the real VA5368 transcript (15 Urdu segments, 328 characters): **DejaVu missing 35 characters, Naskh missing 0**.
* Naskh covers every Urdu letter, both digit sets, Arabic punctuation and the Latin letters, digits and punctuation a mixed line needs, in Regular and Bold (so a mixed English/Urdu line needs one font).
* Tests (`tests/test_arabic_urdu_text.py`): 10 pass here; 2 are skipped here because they need Raqm and are written to run wherever Raqm exists: (1) right-to-left reading order, by correlating each word's column profile against the line (the first word of an Urdu sentence must sit to the right of the second); (2) a mixed English + Urdu line stays on one line. Existing text/export suites unchanged (63 passed with them).

## Not verified, and how to verify it

This development machine has no Raqm, so **joining and right-to-left order have not been seen in a real render here**. They are Raqm's job and Raqm is present in production, but until the two skipped tests (or a real render) run on a Raqm build, treat shaping and direction as unverified. The smallest read-only check on the production image, which needs approval before it is run, is to fetch the font bytes in memory from the official URL, render the Urdu test lines in memory with the production Pillow, and print the measurements: nothing written, nothing installed. The alternative is to run the two skipped tests inside the production image after this branch is deployed to a preview.

## Unchanged

The editor's warnings for unsupported scripts (Hebrew, Indic, Thai, CJK) are preserved; the Arabic-script warning's wording should be revisited only after shaping is verified on a Raqm build.
