# C3: blurred backdrop behind a letterboxed clip (protected files: needs approval)

Prepared as an exact patch on top of the D1 branch (`feature/m3-d1-dissolve-preview` at `89b61a5`): `protected-patches/c3-blurred-fill.patch`. It was applied only in a scratch worktree (`socialgenius-content-studio-m3-c3`, local branch `scratch/m3-c3-blurred-fill`) to test it. Not pushed, not merged, not deployed.

## What a user sees
A new choice in the canvas toolbar beside the canvas colour: **Bars: colour** (default, exactly today) or **Bars: blurred video**. With blur, a clip that is letterboxed (Fit) keeps its whole frame in the middle and the bars above/below (or left/right) show a blurred, enlarged copy of the same clip, in both the preview and the MP4. Clips set to Fill are unaffected (they have no bars). The choice is saved with the draft; drafts written before it behave as before.

## Exact change
Backend (3 files + 1 test file, +28 / -5 lines in source):
- `schemas/video_export.py`: `canvas_backdrop: Literal["color","blur"] = "color"` on the export request (anything else is rejected).
- `routers/video_export.py`: passes it into the project dict.
- `services/ffmpeg_svc.py`: new pure `blurred_fit_filter(w, h)`; `build_clip_segment(..., backdrop="color")` uses it instead of the pad only for Fit clips when `backdrop == "blur"`; the value is threaded through `_render_clip_run` and `render_project`. The filter: split the (already graded and speed-adjusted) frame; one copy scaled to COVER the canvas, cropped, `boxblur=20:2`; the other scaled to FIT; overlay centred. With `backdrop="color"` the code path is byte-for-byte the previous one.
Frontend:
- `StudioContext.tsx`: `canvasFormat.backdrop?: 'blur'` (optional, so older drafts are untouched).
- `export/canvasBackdrop.ts` (new): validation and the preview-blur formula.
- `ReviewTab.tsx`: sends `canvas_backdrop: "blur"` only when chosen.
- `CreateEditTab.tsx` (protected, ~30 lines): the select in the toolbar; keeping `backdrop` when the canvas format changes (3 existing lines extended); one muted `<video>` behind the active clip, only when the backdrop is blur and the active clip is Fit; one reactive effect that follows `timeline.currentTime / playing` exactly like the D1 and V2-insert elements; `position: relative` on the main video only while the backdrop is shown. Master clock, the active element's sync effects and the fade/dissolve logic are untouched.

## Verified (local)
- Backend, real ffmpeg: default render identical to before; a wide detailed clip on a portrait canvas gets bars that are not black, vary, and are about 3x smoother than the sharp picture, while the foreground picture is identical; Fill clips unaffected; request validation. 30 backend tests across the touched areas pass (C3, canvas colour, timeline plan, sync render).
- Browser (real editor, real backend, real MP4): the control starts on colour with no extra element; choosing blur mounts the muted backdrop with a blur of the export's sigma scaled to the preview (16.7 px x preview width / 1080), covering the canvas; while playing it follows the main video within 0.4 s; saving from the editor stores `canvasFormat.backdrop = "blur"`; after reload and reopen the choice and backdrop are back; the export request carries it; the MP4's bar is a blurred, coloured copy of the clip (screenshot checked) and the file is 4.0 s.
- `tsc` clean; frontend export tests pass.

## Cost (measured, this 10-core Windows PC)
- Export: a 10 s 1280x720 clip on a 1080x1920 canvas takes 2.8-2.9 s with colour bars and 7.0 s with the blurred backdrop (about 2.4x, in two runs each); the output file is larger because the picture fills the whole frame (0.15 MB to 0.43 MB for a test pattern). Longer or higher-resolution clips scale roughly with length. Not measured on Railway's container.
- Preview: one extra muted `<video>` decoder runs only while blur is selected and the active clip is Fit. With the control on "colour" no extra element is created (verified: none in the DOM).

## Limits
- **Dissolve preview limitation (also in the control's tooltip):** during a D1 dissolve the preview draws the active clip's backdrop only; the other clip's backdrop is not drawn. The MP4 builds each clip's own backdrop and blends them.
- Preview and export blurs match in sigma, not pixel for pixel (CSS gaussian vs ffmpeg box blur x2; the preview scales the copy 12% to hide its soft edges).
- During a D1 dissolve the preview shows the active clip's backdrop only (the other clip's is not drawn); the export builds each clip's own backdrop and blends them.
- The extra decoder in the preview (one more `<video>`) costs CPU while the backdrop is on; export time for affected clips rises (not measured on a long clip).
- Not applied to V2 inserts or media overlays, and not to timeline gaps (those use the canvas colour).
- No darken/dim option (can be added as a parameter).

## Approval needed
Approve C3 (Y/N). If yes I will apply it on a branch from the D1 tip, rerun the targeted checks and ask for your manual playback re-check, as with D1.
