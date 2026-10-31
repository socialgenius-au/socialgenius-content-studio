# Reconstructor M2.2b — export parity for the editor's existing layers

Status: implemented and verified locally on `feature/m2-2b-export-parity` (base `9c26489`, the deployed M2.2a). Not pushed, not deployed.

Goal: what the editor shows is what the MP4 contains, for every layer kind it can draw.

## What changed

| Commit | Change | Protected file |
|---|---|---|
| patch 01 | Overlays are fitted **inside** their box (aspect kept, transparent padding) like the preview's `object-fit: contain`; media overlays, text, lower thirds, shapes and subtitles are stacked by **one shared `order`** with the editor's own tie rule (media → text → lower third → shape → subtitle). Pure `_stack_runs` + the existing per-kind compositors; the router carries each layer's `order`. | `backend/app/services/ffmpeg_svc.py`, `backend/app/routers/video_export.py` |
| patch 02 | Shapes and lower thirds are sent in the export request (pure mappers `export/layerExport.ts`). | `ReviewTab.tsx` |
| patch 03 | Shape border width and corner radius are drawn at the canvas's displayed scale in the preview (same correction M2.1b made for text). | `CreateEditTab.tsx` (shapes only) |
| this stage | **Subtitles** (segment + project style, snake_case merge, CSS blur → sigma) and **V2 inserts / B-roll** (position, size, fit, crop, trim, grade, 0–100 → 0–1 opacity) are sent. An insert with no uploaded source stops the export with a plain message instead of vanishing; a notice says when the exporter cannot honour something (B-roll speed). **Lower thirds** are sized from their own box in the preview (CSS container units): bar 1.2 % of the box width, name 32 % and title 22 % of its height, 3 % padding — the exporter's own proportions, pinned to its source by a test. | `ReviewTab.tsx`, `VideoStudioV2.css` |

No database migration, no new endpoint, no dependency, no paid service, no saved-value change (everything is derived at preview/export time).

## Verification (local; throwaway database; real build and backend)

* `tsc` clean; production build OK. Frontend: **820 passed**, 11 skipped (794 before; 26 new). Backend: **90 passed** across the render, export, text-fidelity and draft-compatibility suites plus 1 known failure that is identical on `9c26489` (`test_timeline_render.py::test_render_project_single_clip_with_text_and_audio`, `KeyError: 'start_time'`).
* New backend tests render real MP4s with the bundled ffmpeg and read pixels back: 9 for fit and stacking (6 of them fail without patch 01) and 2 for shapes, lower thirds, subtitles and inserts.
* **Real-browser click-through, 63 checks:** a draft containing every layer kind (4 pictures, 5 shapes, text, lower third, 2 subtitles with a per-segment override, a B-roll insert) was saved through the real drafts API, opened with the editor's own *My Drafts → Open*, and exported with the Export button on two canvases (1080×1920 and 1920×1080). The same script against the unpatched backend failed 12 checks (stretched pictures, text over a shape that should cover it, a higher-order picture under a shape); with the patches it passes.
  * Image fitting: each picture sits inside its differently shaped box, at the editor's position (±4 px), with its own proportions.
  * Transparency: the picture's see-through centre shows the video; its half-transparent disc blends rather than going black or white.
  * Stacking: a higher-order shape over a lower-order picture; a higher-order picture over a lower-order shape; with no order set a shape covers the text beneath it, as in the editor.
  * Shapes: bordered rectangle (6 px border, 6 px measured), full-width banner, circle.
  * Lower thirds: preview text is 0.32 / 0.22 of the box at every canvas the editor offers and at three window sizes; the exported name sits on the exporter's own line and is the expected width.
  * Subtitles: chip at the segment's position, words drawn, the per-segment blue override applied. Inserts: the B-roll fills its box and only its box. Timing: nothing before 1 s or after 9 s.
* Regressions in the real browser on this build: M1 Stage 3 34/34, M2.1a 42/42, M2.1b 37/37, M2.2a 80/80.

## Remaining defects (reported, not hidden)

1. **Subtitle preview size.** The editor draws a subtitle's font size, outline and shadow at raw pixels inside the fitted preview, so at the default zoom it looks about 3.3× larger (relative to the canvas) than the export (36 px shown as 36 px on a canvas displayed at 31 %). The export is right (canvas pixels). The fix is the same one M2.1b and patch 03 made, in `CreateEditTab.tsx` for subtitles; **not applied: not in this approval.**
2. **Subtitle outline** is drawn outward by the exporter (legacy layout) but centred in the editor, so an outlined subtitle is slightly bolder in the MP4. Font family: the exporter has one font (DejaVu Sans), so a chosen family is not exported (text and lower thirds likewise).
3. **Lower thirds:** typeface differs (editor font vs DejaVu); the editor rounds the chip by 4 px and blurs the video behind it, the export is square and unblurred; `animation` and `showLogo` are not exported.
4. **B-roll:** speed is not supported by the exporter (a notice appears after export); B-roll with its own audio set to "keep" goes through the audio tracks as before and was **not** exercised in this run.
5. Text and lower-third entrance animations are not exported. Inserts are always the layer under every overlay (as in the editor).
6. A project that alternates layer kinds costs one extra encode pass per alternation.
7. Not checked on Railway (needs a deploy and a login).

## Protected files changed

`backend/app/services/ffmpeg_svc.py`, `backend/app/routers/video_export.py`, `frontend/src/pages/video-studio-v2/components/ReviewTab.tsx`, `.../CreateEditTab.tsx`, `.../VideoStudioV2.css` — all approved. `StudioContext`, `videoPreviewUtils`, `canvas_render_svc`, `exportGuard` are untouched.

## Rollback

Revert the five commits (no force-push) to return to `9c26489`.
