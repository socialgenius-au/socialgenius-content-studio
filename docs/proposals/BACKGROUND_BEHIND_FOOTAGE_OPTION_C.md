# Option C (mask overlay): behind-footage shapes. Design and exact patch. PENDING AYUB APPROVAL

Status: **proposal with a working, tested implementation in a scratch worktree** (`scratch/option-c-mask-overlay`, local). Nothing here is applied to `integration/m4-m5-batch2`, `integration/m3-rc1`, `main` or any deployed branch, and no protected file changes until you approve this patch. Builds on `integration/m4-m5-batch2` (`364c036`). Follows `BACKGROUND_BEHIND_FOOTAGE.md` (Option C was selected in "M4/M5 BATCH 2 APPROVAL").

## What it delivers
A shape can be marked **Behind footage**. It then shows only where no picture is on screen, in the editor's preview and in the exported MP4, and never covers visible footage. Default is off for every existing and every Reconstructor-written shape, so existing projects, drafts and exports are byte-for-byte unchanged.

## The rule (identical in preview and MP4)
| Situation | Where the shape is visible |
|---|---|
| Fit clip, any source and canvas shape (landscape, portrait, square) | the bars around the picture |
| Fill clip (with any crop position) | nowhere: the picture covers the canvas |
| Trim, speed, colour grade, volume | no effect on geometry |
| A different clip with a different shape later | follows each clip's own picture rectangle |
| Dissolve / wipe / zoom (blend window around the join) | outside the **union** of both pictures (both are on screen) |
| Fade through black | outside the clip's rectangle (fading footage is still footage, not canvas) |
| Timeline gap (no clip) | the whole shape |
| Clip whose size is not known yet (preview loading) | treated as covering the canvas, so nothing is drawn over a picture that may be there |
| V2 inserts, images, text, lower thirds, subtitles, ordinary shapes | always above, unchanged |

The picture rectangle is exactly what `build_clip_segment` draws: scale to fit with ffmpeg's rounding (sizes are drawn even), centred pad aligned to an even pixel. It is **measured against real renders** for 11 canvas/source combinations (landscape/portrait/square/odd ratios), not assumed.

## How it works
**Export (Design C, no change to the V1 filter graph).** The exporter already composites shapes as positioned PNGs over the finished V1 base. For a behind shape: (1) the plan the V1 renderer already makes is captured (`plans_out`); (2) `behind_footage.py` derives, per frame range, which picture rectangles are on screen (each clip's main span plus the pre/post-roll a blend shows); (3) the shape's PNG is made transparent inside those rectangles (one PNG per distinct set, cached); (4) the overlays are composited right after the V1 base and **before** V2 inserts using the existing `composite_image_overlays`; (5) ordinary shapes keep their existing pass. With no behind shape the new block does not run and the pipeline is unchanged (a test counts the overlay passes).

**Preview (no change to the video element, master clock, D1 overlay or C3 backdrop).** Behind shapes are drawn in their own layer directly above the V1 picture and below V2 inserts, **clipped away from the picture rectangle(s) at the current time** with a CSS `clip-path` (an even-odd polygon with the rectangle as a hole; one nested wrapper per rectangle, so a dissolve clips the union). Hit-testing follows the clip, so clicks over the footage reach the footage as before. The same rectangles are computed by a TypeScript port of the exporter's rules.

**Agreement guard.** `backend/tests/test_footage_geometry_fixture.py` generates `footageGeometry.cases.json` from the Python rules (11 canvases-by-sources-by-fit rectangle cases, plus 120 random multi-clip projects with dissolves, wipes, zooms, fades, gaps and fills, sampled at the first, middle and last frame of every footage-on-screen span). `footageGeometry.test.ts` requires the TS to give identical rectangles for every sampled frame. If either side changes, a test fails until the fixture is regenerated and the port updated, the same mechanism that keeps D1's dissolve window equal to `timeline_plan.py`.

## Data model
`Shape.behindFootage?: boolean` (draft JSON, additive, optional). **`types/index.ts` is not changed**: it is read and written through the adapter `isBehindFootage()` / a typed partial, as with the shot adapter. Old editors ignore the field (they would draw such a shape above the footage, as they always have). Export: `ExportShape.behind_footage: bool = False`; the frontend sends it only when true, so every other request is identical.

## Exact patch: protected files touched (49 added, 6 changed lines)
| File | Lines | Change |
|---|---|---|
| `frontend/.../components/CreateEditTab.tsx` | +22 / -1 | 4 imports; `useVideoSizes(...)` beside `blendWindows` (loads nothing unless a shape is behind); `behind: isBehindFootage(sh)` on each shape entry; the ordinary stack uses `shapeEntries.filter(e => !e.behind)`; `behindLayer` const (6 lines); `{behindLayer}` before `{insertLayer}` in both preview branches; one "Behind footage" checkbox in the shape Properties |
| `frontend/.../export/layerExport.ts` | +4 | `behind_footage?: true` in the shape item only when set |
| `backend/app/services/ffmpeg_svc.py` | +26 / -5 | `plans_out` parameter on `_render_clip_run` (2 lines); the behind block in `render_project` after the V1 base and before V2 inserts (11 lines); the stacking pass receives the shapes without the behind ones; 1 import |
| `backend/app/schemas/video_export.py` | +2 | `behind_footage: bool = False` |
| `backend/app/routers/video_export.py` | +1 | passes it through |
| **New, non-protected** | | `behind_footage.py`; `footageGeometry.ts`, `BehindFootageLayer.tsx`, `behindFootagePreview.ts`, `useVideoSizes.ts`; tests and the shared fixture |

No change to: `types/index.ts`, `StudioContext`, the master clock and playback effects, the active clip's `<video>` element, D1's blend element, C3's backdrop, fades, hand-off, canvas sizing, `build_clip_segment`, the join graph, `timeline_plan.py`, or the default export path.

The full diff is `docs/proposals/protected-patches/option-c-behind-footage.patch`.

## Verification so far (local; real ffmpeg, real browser)
- Backend `test_behind_footage.py`: **22 of 22**. Geometry equals the real render for 11 canvas/source combinations and fill; sideways (rotated) files swap size; occupancy rules (main span, dissolve union, fade, gap, fill); PNG clearing; end to end through `render_project`: a landscape clip on a portrait canvas shows the banner in the bars and not over the picture (the same banner not behind covers it, unchanged); invisible under a Fill clip; fully visible in a gap; time-gated; ordinary shapes still over the footage; a dissolve between differently shaped pictures hides the shape under both pictures through the window and shows it outside both; **no extra overlay pass when nothing is behind the footage**.
- Existing export, timeline, stacking, canvas and dissolve backend tests: 93 pass; 1 fails, and it fails identically on the unpatched integration branch (`test_render_project_single_clip_with_text_and_audio` passes the pre-Phase-7 `start`/`end` text keys; a stale test, not touched here).
- Frontend: `footageGeometry.test.ts` (rectangles for 120 cases of both rule sets agree on every sampled frame), wiring test, full video-studio + deconstructor suites **872 pass**, `tsc` clean.
- Browser (preview vs MP4): see "Browser results" below.

## Known differences and limits (stated, not hidden)
1. **Whip-pan and zoom transitions**: the MP4 blends both pictures; the editor's preview only renders the dissolve's second picture. The shape's mask follows the MP4's rule (union), so with two differently shaped pictures the preview clips slightly more than it visibly needs to for a fraction of a second. For same-shaped neighbours (the common case) there is no difference.
2. **Edge antialiasing**: the preview clip edge is antialiased by the browser; the MP4 edge is pixel exact.
3. **Size not yet loaded**: until the browser has read a clip's size (typically milliseconds) the clip counts as covering the canvas, so the shape is briefly absent rather than ever over the picture.
4. **Pixel aspect ratio and unusual rotation**: pixel size comes from ffmpeg's probe (swapped for 90/270 degree display matrices); a clip with a non-square pixel aspect ratio is treated at its pixel size, as the scaler does.
5. **Fade through black**: the clip's rectangle stays masked while it fades; the preview's fading video lets the canvas colour show through, as it already does today.
6. **Selection**: a behind shape cannot be clicked on the canvas where footage covers it; it remains selectable where visible, and from the Layers list and timeline.
7. **Cost**: one extra overlay pass (an extra libx264 generation of the timeline) only when a behind shape exists; PNGs are canvas-sized, one per distinct picture-rectangle set. Measured below.

## Not in this patch (follow-ups after approval)
The Reconstructor's Background panel choice "Place behind footage" (non-protected; it only writes `behindFootage: true` on the background plate layer and records it as a person-set correction) and recommending it where a bar would otherwise cover the footage. Left out so this patch stays narrow.

## Rollback
Remove the five protected-file hunks; the new modules and fixture are inert without them. Drafts that already carry `behindFootage: true` simply draw the shape above the footage again, as every earlier editor does.

## Decision requested
Approve this exact patch (5 protected files, 49 added lines) for application on a new commit of `integration/m4-m5-batch2`, followed by the protected editor-flow regression and the persistence scenario, or tell me what to change.
