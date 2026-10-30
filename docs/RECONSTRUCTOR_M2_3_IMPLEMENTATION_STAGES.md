# Reconstructor M2.3 — background and composition: implementation stages

Status: **planning only. No code, no editor change, no paid service.** Refines section M2.3 of `RECONSTRUCTOR_M2_3_TO_M2_6_PLAN.md` using what the export-parity work and the integrated tests showed about the editor and exporter.

## 1. Constraints the integration tests established

* **The footage is always the bottom layer.** In the editor and the exporter the main video is drawn first and every other layer (pictures, shapes, text, lower thirds, subtitles) is drawn above it. A "background" can therefore only be visible where the footage does not cover the canvas.
* **Where the footage does not cover the canvas is currently fixed black.** A clip in "fit" mode is letterboxed with black bars (exporter: `pad=…` with black; preview: black). There is no background colour setting for the canvas or a clip.
* **Shapes now export** (M2.2b), so a coloured shape placed *in the bar regions* is a working background today, with the limits below.
* **Stacking is by one shared `order`** across pictures, text, lower thirds, shapes and subtitles, with the editor's tie rule (M2.2b). Subtitles imported from a transcript carry negative `order`, so they sit beneath other layers unless the person reorders them (editor convention, unchanged).
* **A clip join shortens the timeline** (see the integration record): matters when layers are timed against footage after a dissolve.
* **What the analysis can supply:** ~one 480×864 still per five seconds per scene, detector boxes, OCR boxes and colours. Nothing recovers the pixels *behind* burned-in text or graphics.

## 2. What can be recovered, inferred and only recreated

| Element | Recovered (measured from the stills) | Inferred (with a stated rule) | Manual | Not recoverable |
|---|---|---|---|---|
| Letterbox / pillarbox bars | Their extent and colour per scene | Whether they are deliberate design or just the aspect mismatch | Whether to keep them | — |
| Dominant background colours | Palette of each still and its border strips | Which colour is "the background" | The final colour | The original gradient/texture if the stills are too sparse |
| Plain vs busy background | Colour variance across the border strips | "Solid", "two-colour gradient", "busy" | Replacement footage or image | The busy background itself |
| Composition (where things sit) | Boxes already read (text, detector, drawn regions) | Stacking order | The final order | The original layer structure |

Nothing in this stage claims a clean background behind text or graphics: **inpainting is not promised** and needs a model that is not approved.

## 3. Stages (each ends with tests, a real MP4, a recorded commit and a rollback point)

### M2.3a — Background evidence reader (frontend, no protected file)
Pure engine under `deconstructor/background/`. Reads the existing stills through the same read-only, CORS-mode frame reader the text and image paths use (the `?pixels=1` cache-safe load). Per scene: bar extent and colour, border-strip palette (quantised histogram, deterministic, no new library), variance class, with the evidence frozen and every figure labelled measured. Tests on synthetic stills with known bars and gradients, then on the nine real VA5368 stills (local only). **Acceptance:** the engine recovers a synthetic image's bars to the pixel and its palette within a stated tolerance; on VA5368 it reports what is there (including "no bars") without inventing any.

### M2.3b — Background plates as shape layers (frontend, no protected file)
Review panel (`?m2=background`, same pattern as the other panels): per scene a plate candidate (solid colour, or the two colours of a gradient as two shapes) positioned in the bar regions, default-included only when bars were measured; the person confirms the colour. Output: native `Shape` layers (full-width / banner kinds) with provenance, `order` below text and pictures, merged by the existing draft save. **Works only where the footage is letterboxed**, and only as solid blocks (shapes have one fill colour). **Acceptance:** real MP4 in portrait and landscape: plates fill the bars at the measured positions and colours (±3 px), nothing covers the footage, order is under text and pictures, timing follows the scenes.

### M2.3c — Composition ordering at save (frontend, no protected file)
A small panel that shows, per scene, every generated layer (text, pictures, plates, subtitles, transitions) with its bucket (recovered / inferred / manual) and lets the person choose an ordering policy. The policy is applied as `order` values when the draft is saved (bands: plates lowest, then pictures, then text, then lower thirds, then subtitles), so the editor and the exporter already agree. **Acceptance:** after save-reopen-export the stack matches the policy in both preview and MP4; a manual reorder in the editor still wins afterwards.

### M2.3d — Canvas background colour (needs approval: protected editor and exporter)
A background colour for the canvas or a clip: `pad` colour in `build_clip_segment`, the matching preview CSS, a field in the draft, a colour control. Cleaner than shapes (the plate becomes the real background, always under the footage, no covering of footage when the clip changes). **Why it needs you:** it touches `ffmpeg_svc` and `CreateEditTab`. Includes a before/after real MP4 test.

### M2.3e — Blurred-fill backdrop (needs approval: protected exporter and editor)
The common vertical-video look: the footage scaled to fill and blurred behind the fitted footage. An ffmpeg filter chain per clip (`split`, scale-to-fill, `boxblur`, overlay); preview needs a matching CSS rendering. Adds encode time per clip. Optional and last; only if M2.3d is not enough.

### M2.3f — Manifest hook
Each stage reports its elements and their bucket to the M2.6 manifest (no UI of its own).

## 4. Dependencies and order

`M2.2b (shapes export, stacking)` → `M2.3a` → `M2.3b` / `M2.3c` (parallel) → `M2.6 manifest`. `M2.3d` and `M2.3e` are independent of `a`–`c` and wait for approval. The transition timeline drift (integration record) should be settled before M2.3 is accepted end to end, because plates and layers are timed against footage.

## 5. Approvals this plan will need

1. M2.3d and M2.3e touch protected files (`ffmpeg_svc.build_clip_segment`, `CreateEditTab`, `VideoStudioV2.css`).
2. Anything that removes or paints over burned-in content (inpainting, vision models) is **not** in this plan and would be a separate, paid, explicitly approved item.

## 6. Risks

* The stills are small and sparse: gradients and textures are estimated from two or three samples per scene, so a plate is a hint, not a copy; the review panel says so.
* Plates as shapes are only meaningful with letterboxed footage; if the person uses "fill", there are no bars and the stage reports "nothing to rebuild".
* Colour from third-party stills is a measurement, not content; no pictures from the reference are copied by this stage.
