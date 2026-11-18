# D1: dissolve preview in the Video Studio editor (protected file, needs approval)

Branch `feature/m3-d1-dissolve-preview`, based on the acceptance release `8da63ac`. Nothing is merged or deployed. The exact protected change is `protected-patches/d1-dissolve-preview.patch` (40 added lines in `CreateEditTab.tsx`, nothing removed or changed).

## What a user sees
A Dissolve (stored by the Reconstructor or picked in the Transition selector) now plays in the editor the way the MP4 contains it: the two pictures blend across the join over the same window the exporter uses, using the real spare footage before the incoming clip's trim-in and after the outgoing clip's trim-out. When a source file has no spare footage the window is shorter (or a hard cut), exactly as the export decides. Whip pan and zoom punch are still not previewed. Audio in the preview is unchanged (the exporter's audio crossfade is not previewed).

## The change
1. `export/dissolveWindow.ts` (new, not protected): a port of `timeline_plan.plan_timeline`'s blend rules (window, spare frames, `shorten` / `hold_incoming` / `hold`, the shrink pass, contiguous runs). Guarded by a 160-case fixture generated from the Python planner (`backend/tests/test_dissolve_window_fixture.py`, `__fixtures__/dissolveWindow.cases.json`); the Python test fails if the planner changes without the fixture and port being regenerated.
2. `CreateEditTab.tsx` (protected, +40): one import, one ref, one reactive block, one conditional `<video data-testid="dissolve-blend">`.
   - It mounts only within one second of a dissolve window and while inside it. A project without a dissolve renders and plays exactly as before.
   - It is a second muted element laid ON TOP of the active clip: before the join it shows the incoming clip's pre-roll at opacity alpha; after the join it shows the outgoing clip's post-roll at opacity 1 - alpha. That is the same blend, with no change of stacking at the join.
   - It only reads `timeline.currentTime` / `playing` (like the V2 insert and A1 audio effects). It never drives or reads the master clock and never touches the active clip's element, `getClipTransitionOpacity`, the fade logic, hand-off or the watchdog.
3. Not persisted: nothing new is saved in drafts, so save/reopen and older drafts are unaffected.

## Verified (local, real browser, real backend, real MP4 of the same draft)
Two barcoded clips (A 0-4 s from 2.0 s, B 4-8 s from 3.0 s, 1.0 s dissolve, window frames 105-135, join 120): no extra element away from the dissolve; during the look-ahead the incoming clip is parked invisible on its first pre-roll frame; at 11 frames across the window the active clip's source time and the overlay's source time are within one frame of the model and the overlay opacity within 0.01 (0.475 before the join, 0.421 after: continuous); playing through the window the overlay runs and playback carries on into B; the exported MP4 is 8.00 s and 10 sampled frames across the window match the same model within 10/255. Frontend suite for Video Studio: 154 pass. `tsc` clean.

## Not done / limits
- The preview blends with a smooth opacity ramp; ffmpeg's `dissolve` is dithered pixel switching, so the exported picture is a noisier version of the same mix.
- The editor only knows `clip.duration`; the exporter probes the real file. They can differ by a frame or two on spare footage.
- The Review-step "hold the incoming clip's first frame" choice is not previewed (preview uses the default policy).
- The editor's paused scrubbing keeps the existing 0.35 s seek tolerance on the active clip (approved behaviour, untouched).

## Approval needed
Because this touches the approved playback file: manual Test 7.3 (master-clock playback) should be re-run by the user on this branch before it is merged. Decision requested: approve D1 for inclusion in the next acceptance build (Y/N).
