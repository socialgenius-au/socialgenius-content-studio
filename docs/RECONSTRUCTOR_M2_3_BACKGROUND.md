# Reconstructor M2.3a–c, f — background plates and composition order

Branch `feature/m2-3-background` (from the integration checkpoint `6d5366b`). **Frontend only. No protected file, no dependency, no backend, no paid service.** Flag-gated: `?m2=background`; without it the page is exactly as before.

## What it does

* **M2.3a measure.** Reads the pixels of the reference's stills (the same read-only, CORS-mode load the other panels use) and measures, per still: flat bands along the four edges (position, size, colour, flatness), the border's most common colours, and whether the border is plain, a smooth gradient or busy. Pure, deterministic, no new library. Per scene the stills are combined (median size, mean colour, the share of stills that showed the bar).
* **M2.3b plates.** One candidate per measured bar. It is included by default only when the bar is flat (≥ 97 %), seen on every readable still of its scene, at least 3 % thick, and the reference and canvas have the same proportions (±8 %). Approved plates become native `Shape` layers: `banner` (full width) for top/bottom bars, `rectangle` for side bars, placed exactly in the measured bar for the span of the scene, written at an explicit order beneath everything else. Each carries provenance (what was measured, on how many stills; colour is “measured” or “set by you”) and claims that are all `false`: no background recovered, no content behind overlays recovered, no inpainting. Merged into the draft by the existing save; merging twice adds nothing.
* **M2.3c composition.** A save-time stacking policy for the Reconstructor's **own** layers (ids `rb:` `ri:` `rc:` `rs:`): *Leave each as generated* (default) or *Recommended* (plates under pictures under text under subtitles; transcript subtitles lifted from below everything to the top). It moves only a generated layer that still carries its generated order, never your own layers, is idempotent, and the editor's own reordering wins afterwards.
* **M2.3f manifest hook.** `backgroundManifest()` and `compositionManifest()` return plain entries (element, scene, measured / estimated / set-by-you bucket, claims all false) for the M2.6 manifest to read. No UI.

## What it measures on the real VA5368 stills (22 stills, 480×864)

Run locally on the real pixels (not committed): **20 of 22 stills have no flat bar, and none is invented**; two show a near-black band across the top, **18.9 % of the height, `#080808`, flatness 1.00** (palette `#090909` 85 %). The other stills have a dark, near-plain border (`#1f1f1f`–`#373737`) with a lighter lower edge; they read as “busy” because of what is near the bottom, not as a bar. For this reference, M2.3 therefore offers at most the near-black top band and says that no other bar was found.

A smooth gradient used to read as two flat bars at its ends; a bar must now stay within 18 colour levels along its whole thickness *and* end at a visible edge (a step of 30 or more, or a non-flat line). A test pins it.

## What it does not do

It does not recover what is behind text or graphics, a gradient's curve or a texture, and it paints nothing over anything. Plates sit **above the footage** in the editor, so they only make sense where your footage does not reach the bar. Where the footage is “fit” and does not fill the canvas, the bars are visible and a plate is a clean, editable colour block; where the footage fills the canvas, leave the plate out (the panel says so). Canvas background colour and a blurred backdrop (M2.3d/e) are still proposals that need the editor and exporter, and are not part of this.

## Tests

`background/engine.test.ts` (22: exact bars to the pixel, colours, thin/thick bands, blank still, plain/gradient/busy, evidence aggregation and freezing, readers that fail, candidates and their default rule, geometry of all four sides, user colour provenance, duplicates, idempotent merge, composition policy, buckets, manifest), `background/review.render.test.tsx` (panel text, counts, states, policy, page wiring, no AI endpoint, no protected file), `integration.test.ts` (updated: five families in one saved draft chain), `background/realStills.local.test.ts` (local only, `BG_STILLS_DIR`).

Rollback: revert the branch; nothing else changed.
