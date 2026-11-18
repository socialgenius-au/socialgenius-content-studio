# Real source-duration correction (separate patch on the D1 tip)

Branch `feature/m3-real-duration` (based on `feature/m3-d1-dissolve-preview` at `89b61a5`). Independent of C3. Not pushed, not merged.

## Problem
`VideoClip.duration` is the length of the clip's source file. The editor records the browser's metadata value when a clip is added, but with a 10 s fallback when the metadata does not load within 4 s, and a draft can carry a stale one. The D1 dissolve window and speed changes read it, so a wrong value invents footage the file does not have. Shown with a control run: a clip recorded as 10 s whose real file is 6 s, ending exactly at the file's end. On the D1 build alone the preview draws an outgoing "post-roll" frozen at the last frame (source 6.0 s) after the join, while the MP4 correctly has none.

## Change (`CreateEditTab.tsx`, +25 lines; new pure `export/measuredDuration.ts`)
When a clip's own `<video>` (the active clip's, and the dissolve overlay's) has loaded valid metadata, a recorded duration that differs by more than 0.02 s is replaced by the measured one (`rawUpdateVideoClip`: no undo entry).
- Never used: 0, negative, NaN, Infinity (live streams), non-numbers, or anything over a day. A matching value is left alone. A recorded duration that is itself invalid is repaired.
- `trimOut` moves by the same amount (never below 0), so the clip's span (`duration - trimIn - trimOut`) and everything on the timeline stay exactly as they were. `startTime`, `endTime`, `trimIn`, `speed`, `transition` are never touched.
- Reads metadata only: no seeking, no playback, no master clock.

## Verified
- Unit: invalid measurements, tolerance, span preserved, trimOut clamp, invalid recorded value (5 tests).
- Browser + real MP4 on the control draft (A recorded 10 s, real 6 s; B recorded 10 s, real 10 s; 1.0 s dissolve): the corrected build shows the pre-roll-only window (overlay 0.79 before the join, none after); playing through it carries on into B; saving stores A = 6 s with trimOut 0 and leaves B (valid) at 10 s / 3.0 s, with every timeline field unchanged; reload and reopen behaves the same; the MP4 is 8.00 s and 7 sampled frames match the window within 10/255. The same scenario fails on the D1 build without the patch (post-roll overlay at source 6.0 s; stored duration stays 10 s).

## Limits
- It corrects the editor's record; it cannot know about a container whose video stream is shorter than its audio (the browser reports the container length, as ffprobe does).
- The correction is applied when the clip's metadata loads in the editor, so a dissolve window is only exact once the outgoing clip has been active (or overlaid) in that session.
- A saved draft keeps the corrected values only if it is saved afterwards.
