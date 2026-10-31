# Reconstructor M2.1a — editable text layers from reference text

Status: implemented locally on `feature/m2-1-text-layers` (base `ee54e5f`). Not pushed, not deployed. M1 acceptance is separate and unaffected.

## What it does

Reference analysis → detected text → **review** → native, editable Video Studio V2 text layers → save / reopen / edit / export.

It reads the OCR evidence the existing Deconstructor already stored (`GET /reference-videos/{id}`, no new endpoint, no database change, no AI call), proposes one text layer per detected text group, lets a person select, reword, retime, move, resize, recolour or exclude each one, and writes the approved ones into the draft that M1's "Save draft" already creates.

## What it does not do (and never claims)

* The text in the reference video is **still burned into its pixels**. Nothing is removed, hidden or covered. There is no cover-up technique here.
* Fonts, weights, outlines, shadows, original layers and background pixels are **not recovered**. Every draft carries `claims: { burnedInTextRemoved, originalFontsRecovered, originalLayersRecovered, backgroundPixelsRecovered }`, all `false`.
* Timing is known only between sampled frames.

## Data flow and files (`frontend/src/pages/deconstructor/textlayers/`)

| Step | Module | Pure? |
|---|---|---|
| Read evidence → frozen copy | `evidence.ts` | yes |
| Where / how long (± uncertainty) | `timing.ts` | yes |
| Handles, URLs, platform names, recurring watermarks | `branding.ts` | yes |
| Text colour from the frame's pixels | `appearance.ts` (+ `framePixels.ts` for the browser read) | yes / browser I/O |
| Box → editor units, size, position | `geometry.ts` | yes |
| Candidates + flags + default inclusion | `candidates.ts` | yes |
| A person's corrections (separate from evidence) | `corrections.ts` | yes |
| Approved candidates → `TextOverlay[]`, conflicts, duplicates, merge | `materialize.ts` | yes |
| Reusable contract (provenance, bases) | `contract.ts` | yes |
| Review panel | `TextLayersReview.tsx` (container), `TextLayersReviewView.tsx` (view) | I/O / view |

Changed outside this folder (all additive; behaviour is identical when no layers are supplied):

* `types/index.ts` — optional `TextOverlay.reconstruction` provenance field (same pattern as `blueprint`).
* `footage/assembledDraft.ts` — optional `textLayers` input merged into the snapshot at save.
* `footage/FootageAssignment.tsx` — optional `textLayers` prop (passed through; included in the "saved vs edited" signature only when present).
* `DeconstructorPage.tsx` — renders the review panel **only** when the address carries `?m2=text-layers`.

No protected editor file is changed (`CreateEditTab`, `ReviewTab`, `videoPreviewUtils`, `StudioContext`, `ffmpeg_svc` are untouched).

## Contract (reusable for images, logos, shapes and Post/Image reconstruction)

`evidence → candidate → review (corrections) → layer → provenance`. Evidence is deep-frozen and never edited. Every property is labelled `measured` (read off the evidence), `inferred` (estimated), `default` (nothing to estimate from) or `user` (a person set it). Each layer stores `reconstruction: { schema, kind, candidateId, evidence[], sourceConfidence, properties{}, corrected[] }`; the draft stores a `reconstruction` record with counts, the time map, every item's outcome and the claims above.

## Decisions and defaults

* **Left out by default:** low OCR confidence (< 50 %), single characters, handles / URLs / platform names, and anything the analysis linked as a recurring element (watermark-like — note this can also catch a repeated caption word; it is a default, never a block).
* **Colour:** the stored `dominant_text_color_rgb` / `dominant_background_color_rgb` pair is **not used** — it is simply the darkest and lightest quarter of the region, so light text on a dark picture comes out swapped. Colour is estimated from the frame's pixels (two-group split + two independent cues) and falls back to white, labelled as a default, when it cannot be read reliably.
* **Size / position** are calibrated against the real export renderer (DejaVu Sans, 8 px box padding, as the export button calls it today): ink height ≈ 0.95 em, ≈ 0.5 em per character, ink starts 8 px + 0.17 em below the box top. Constants live in `geometry.ts` (`RENDER_CALIBRATION`).
* **Time mapping:** the reference is stretched onto the blueprint's length by default (`fit`), or kept in reference seconds (`identity`); the person chooses.
* **Placeholders:** an item that lands on a blueprint placeholder is blocked until the person decides. "Replace" removes that placeholder and the new layer **inherits its scene link**, so the Stage-3 export guard (placeholders + gap check) still applies to the draft.
* **Duplicates:** within the batch, against layers already in the draft (by id), and against any other overlay with the same wording at the same place and time.

## Known limits (M2.1a)

* Export draws text in the exporter's font, upright; stroke / shadow / box / alignment / width set in the editor are **not sent** by the current export button (see M2.1b).
* Font size is in real pixels on export but scaled by canvas width ÷ 1080 in the preview: exact only on 1080-wide canvases.
* Word-by-word caption reveals produce several short layers per caption; wording edits are manual.
* Layout is faithful on the reference's own aspect ratio (9:16 for VA5368). Positions are percentages of the canvas but font size is in pixels by canvas width, so on a much shorter canvas (for example Landscape 1080x566) lines that were stacked in the reference sit closer together and can collide. Measured: a 1080x566 export collided at about 7.6 s; the same project exported at 1080x1920 had no collision.
* Real-data note: of the 31 text groups in VA5368, 11 are left out by default as branding; 5 of those are a repeated caption word ("Aap") that the upstream analysis linked as a recurring element. They are included with one click.
* Logos and graphics are not text and are out of scope (M2.2).

## M2.1b (needs approval — protected file)

`ReviewTab.tsx` builds the export request from seven text fields only. The backend (`ExportTextOverlay`) already accepts `align`, `bold`, `underline`, `letter_spacing`, `line_spacing`, `width_pct`, `opacity`, `stroke_*`, `shadow_*`, `gradient_*`, `bg_*`. M2.1b would add those fields to the request mapping (additive) so styling set in the editor reaches the MP4, and would settle the font-size scale question for non-1080 canvases.

## Tests

Frontend (`textlayers/*.test.ts(x)`): evidence, timing, colour, geometry, candidates, corrections, materialisation/merge/export guard, I/O with fakes, render and page wiring. A local-only real-data spec (`realEvidence.local.test.ts`, skipped unless `M2_REAL_EVIDENCE` points at an evidence JSON) validates the engine on the real VA5368 analysis. Backend: `tests/test_text_layers_draft_compat.py` pushes a draft carrying layers through the existing drafts API and export schema.
