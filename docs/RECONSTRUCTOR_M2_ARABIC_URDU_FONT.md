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

## Verified on the preview environment (read-only, 2026-10-31)

Approved for the isolated Railway preview service `socialgenius-unified-preview`, not production. `docs/proposals/arabic-urdu-export/preview_render_check.py` was run inside that service's container through `railway ssh`: it fetched the font bytes into memory from the official URL (SHA-256 `67b5a525a661…` matched), used the preview's own Pillow 13.0.0 with Raqm, FriBiDi and HarfBuzz present, patched the font into the preview's own `render_styled_text_box` in memory, and measured the result. Nothing was written, installed or deployed. **10 of 10 checks passed**, and the rendered contact sheet (`preview_render_check.png`) was looked at:

| Check | Result |
|---|---|
| Coverage | every Urdu letter (incl. U+06C1, U+06D2), both digit sets, Arabic punctuation and the Latin a mixed line needs has a real glyph |
| Shaping | the layout differs from unjoined basic layout (142 px vs 164 px for one test phrase) and a joined word is narrower than its letters drawn alone: letters are joined |
| RTL order | the first word of an Urdu sentence is at the right, the second at the left |
| Punctuation | the Arabic question mark ؟ and the Urdu full stop ۔ close the sentence at the left |
| Numbers | Arabic-Indic (٢٠٢٦) and Western (2026) numbers keep their own left-to-right order, as a block between the two neighbouring words |
| Mixed, English first | the paragraph reads left-to-right; the Urdu run sits between the English words; the English keeps its order |
| Mixed, Urdu first | the paragraph reads right-to-left; the Urdu is at the right and the English phrase keeps its own left-to-right order at its left |

The same check run on a machine without Raqm fails every shaping and direction item (text comes out unjoined and left-to-right), so the passes above are meaningful.

## What this does and does not establish

Established: Urdu, as the real VA5368 transcript is written, draws with every letter present, joined, in the right direction, with correct punctuation, numbers and mixed English/Urdu lines, on the preview's real text stack, using the same renderer function the export uses.

**Not established, so multilingual support is not claimed to be complete:**
* This was measured on **synthetic** Urdu and mixed lines, in memory, through the renderer function with the font patched in. The exact combination "new routing code + deployed preview + a real MP4 export of a real Urdu subtitle" has not been run; it can only be run after this branch is deployed to a preview. The routing itself (which lines get the new font) is covered by unit tests.
* **Urdu is traditionally set in Nastaliq; this is Naskh.** It is correct and readable (the sheet shows it) but it is not the calligraphic style Urdu readers expect in print. A Nastaliq font (for example Noto Nastaliq Urdu, also OFL, much larger and with taller line metrics) is a separate design decision.
* Other Arabic-script languages (Pashto, Sindhi, Kurdish and others) use additional letters; coverage of those was not checked. Marks and diacritics (harakat), stacked marks and language-specific `locl` forms were not checked.
* **Hebrew, Indic scripts, Thai and CJK are unchanged:** DejaVu has no glyphs for them and the editor's existing warning for them is preserved.
* Letter spacing is ignored on Arabic lines by design.

## Unchanged

The editor's warnings for unsupported scripts (Hebrew, Indic, Thai, CJK) are preserved. The Arabic-script warning's wording should be revisited once a real Urdu export has been checked on a deployed preview.
