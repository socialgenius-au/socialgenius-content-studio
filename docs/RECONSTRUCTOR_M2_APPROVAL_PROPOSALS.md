# Reconstructor M2: decisions and exact proposals

Status after your decision of 2026-11-02. Items marked **done** are implemented on `integration/m2-fast-track-2` behind the `?m2=` preview flags. Items marked **proposal** are not implemented: each gives the exact change, what it does to the workflow and the export, and what it leaves alone, taken from the current code.

| Item | Decision | State |
|---|---|---|
| A1 Arabic-script wording | Approved | **done** (`9c17b08`) |
| A2 White-flash wording | Approved in principle | **done**, wording below for a last look |
| B1 Motion evidence | Conditional: existing annotation structures only | **proposal** (fields below) |
| C1 `hold_incoming` | Pending | **proposal** (timing, audio, export below) |
| C2 / C3 Canvas background | Approved in principle | **proposal** (controls, defaults, export below) |
| D1 / D2 Editor transitions | Pending | **proposal** (editor changes below) |
| D3 (new) Editor shows Reconstructor transitions as "None" | needs decision | **proposal** |
| E1 / E2 Other scripts, Nastaliq | Deferred | not started |

## A1 (done). Arabic-script note
Arabic-script lines (Arabic, Urdu, Persian, Pashto) now carry an information note, not a warning, and the summary counts them as "N in Arabic script (exported in Noto Naskh Arabic)". The note reads: "This text is in Arabic script. The exporter draws Arabic script in Noto Naskh Arabic, the standard Arabic style; it does not have the Nastaliq style often used for Urdu. Letters join and run right to left, and it was checked on sample Urdu lines, but not on every dialect or rare character, so look at the exported frame." Hebrew, Indic, Thai and CJK keep the amber warning because the exporter still has no font or layout for them; where a line mixes Arabic with one of those scripts, the warning wins. The record saved with the draft now says the same in its `limitations`, and counts Arabic-script lines separately (`arabicScript`).

## A2 (done). White flash and fade through white
The brightness profile of a cut is read for a climb toward white and back. The editor has no white transition, so the panel proposes the nearest one and says so:
- badge: "White transition detected" (information, not a warning);
- hover/note, flash: "A white flash was detected here. The editor cannot recreate it, so a hard cut is proposed as the nearest approximation; the flash itself will not appear.";
- hover/note, fade: "A fade through white was detected here. The editor cannot recreate it, so a dissolve is proposed as the nearest approximation; the white itself will not appear.";
- confidence is never above medium, and the person can change the type like any other estimate.

## B1 (proposal). Motion direction at cuts (whip pan, zoom punch)
Uses the existing `analysis_annotations` table only (columns `category` String(32), `start_time`, `end_time`, `details` JSON, `certainty`, `confidence_score`, `reasoning`, `evidence_summary`, `source`, `shot_id`). **No new table or column; only new rows** (the existing transition-evidence pass already writes `category = "transition_evidence"` rows this way), written only when a person runs the new pass on a reference. Existing rows are never changed.

One row per detected cut:

| Field | Value |
|---|---|
| `category` | `"motion_evidence"` |
| `shot_id` | the shot that follows the cut (same convention as the transition rows) |
| `start_time` / `end_time` | the same measurement window as that cut's transition-evidence row |
| `certainty` | always `"MEASURED"` for the numbers; never `"CONFIRMED"` |
| `confidence_score` | 0..1 from the agreement of the per-block vectors (see `details.agreement`), not a claim about the effect |
| `source` | `"ffmpeg_motion_v1"` |
| `reasoning` | plain text: "Dominant motion in the window, measured from frame blocks; it does not say what effect was used." |
| `evidence_summary` | one line, for example "Mostly leftward motion of 38 px/frame across 9 pairs" |
| `details.window` | `{ "fps": number, "frame_pairs": number, "sample_timestamps": number[] }` |
| `details.global_motion` | `{ "dx_px_per_frame": number[], "dy_px_per_frame": number[], "median_dx": number, "median_dy": number, "magnitude_px_per_frame": number }` |
| `details.zoom` | `{ "scale_per_frame": number[], "median": number }` (above 1 is zooming in) |
| `details.agreement` | share of blocks whose vector agrees with the median direction, 0..1 |
| `details.blur` | `{ "directional_blur": number }`, the motion-blur strength along the dominant direction |
| `details.method` | `"block_matching_16px_grid"` and the thresholds used, so the numbers can be reproduced |

Rules on the panel side: a whip pan or zoom punch is **proposed only when** the measured magnitude and agreement clear stated thresholds, always labelled "Estimated from measured motion, not the original effect", always with the numbers shown, never above medium confidence, and never default-included when confidence is low. With no `motion_evidence` rows the panel behaves exactly as it does now. Inferred values are stored under `details` as measurements and are kept apart from any inference, which is made in the browser and shown as an estimate.

## C1 (proposal). Keep the incoming clip's first frame during a dissolve
Today a dissolve at a join where a clip has no spare source frames is shortened (policy `shorten`, the default) and may become a hard cut.

**Change:** an optional field `transition_edge_policy` (`"shorten"` default, or `"hold_incoming"`) on the export request, one control in the review step ("When a clip has no spare footage for a dissolve: shorten it (default) / hold the incoming clip's first frame while it fades in"), and the same value saved in the draft. The exporter already implements the policy (`timeline_plan.py`) and reads `project.get("transition_edge_policy", "shorten")`; the request schema does not carry it yet.

**Timing.** The join never moves and no clip's main footage moves; total length is identical under both policies. With `hold_incoming`, for a dissolve of length R frames: the outgoing clip continues past the join with real frames only, `y = min(R/2, spare frames after its trim-out)`, and the incoming clip supplies the rest, `x = R − y`: first its real pre-roll frames, then its first frame repeated. The repeated frames are the freeze: `freeze = x − spare frames before the incoming clip's trim-in`. Example with no spare footage anywhere and the default 0.5 s: the whole 15 frames are the incoming clip's first frame, held and fading in over the outgoing clip's last 0.5 s, then the incoming clip plays from its first frame at the join.
**Audio.** The held frames are silent for the incoming clip (its audio is delayed by the held duration), and the audio is cross-faded over the whole window (`acrossfade`), so the outgoing clip's sound dips toward silence during the window while the incoming sound enters only at the join. Audio length and sync are unchanged.
**Export.** Default output is byte-for-byte what it is now. Other timeline layers (text, pictures, bars, subtitles, audio tracks) stay at their absolute times. The planner has unit tests for this policy (`tests/test_timeline_plan.py`); a frame-exact export test with real clips has not been written for it yet and would be added with the change.
**Touches:** the export request schema and the request builder (protected), plus one control.

## C2 (proposal). Canvas background colour
**Controls.** One colour field, "Canvas background", with a "Reset to black" button, in the canvas settings next to the format selector (placement to be confirmed against the current editor layout, which `main` has just changed). In the background panel, a flat bar that is not covered by footage gets one extra choice: "Use as canvas background" (sets the draft field; no shape layer is written for that bar).
**Default.** Unset means black, exactly as today.
**Draft.** One optional key `canvasBackground: "#rrggbb"`; add it to the local-restore key list so Reload keeps it.
**Preview.** `CreateEditTab` sets the preview stage background (today `.video-preview.real { background:#000 }`) from `canvasBackground ?? '#000'` as an inline style. Nothing else in the preview changes.
**Export.** The export request gains an optional `canvas_background` (validated as `#rrggbb`, else rejected). `build_clip_segment` already pads with `pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black` in "fit" mode; the colour becomes `color=0xRRGGBB`. "Fill" mode has no padding and is unaffected. V2 inserts, media overlays (which pad with transparent) and every layer are unchanged. A frame-level test will compare the padded bars with the chosen colour.
**Effect.** Bars that belong under footage stop being plates on top of it: the footage-reach conflict disappears for them. Touches `ffmpeg_svc.build_clip_segment`, the request schema, `CreateEditTab`, `VideoStudioV2.css`.

## C3 (proposal, only if C2 is not enough). Blurred-fill backdrop
**Control.** Next to C2: "Backdrop: Colour (default) / Blurred video".
**Export.** For a clip in "fit" mode, the padding is replaced by: split the clip, scale one copy to fill and crop (the full canvas), blur it (`boxblur`), scale the other copy to fit, and overlay it centred. Encode time for affected clips rises; not measured yet, to be measured before release. **Preview** needs a matching second element or CSS `filter: blur()` copy behind the video, so this is a larger change than C2 and is not proposed further until C2 is decided.

## D1 (proposal). Dissolve preview in the editor
**Today** (`CreateEditTab.tsx`): one `<video ref={videoRef}>` shows the current clip, switched by source at a cut. `getClipTransitionOpacity` can ramp opacity only for `fade_black`. A dissolve, whip pan or zoom punch is not previewed at all.
**Proposed.** For a join whose outgoing clip has `transition = dissolve`, mount a second, muted `<video>` for the incoming clip, seeked to the same source frames the exporter uses and shown with an opacity ramp over the window `[J − x, J + y]` computed from the same rules as `timeline_plan.py` (a small TypeScript mirror, unit-tested against the Python plan for the same clips). The master clock stays the only clock: the second element is slaved to it and never drives playback, so the approved playback engine and audio are untouched. Whip pan and zoom punch stay unpreviewed.
**Workflow.** Scrubbing or playing through a dissolve shows the blend; outside dissolve windows nothing changes. Cost: one extra decoder only while a window is active.
**Risk.** It sits next to the approved master-clock code, so it needs your approval and a re-run of manual Test 7.3 before release.

## D2 (proposal). Which side moves: editor fades vs export transitions
**Today.**
- *Editor:* a clip with `transition = fade_black` fades **in over its own first d seconds and out over its own last d seconds** (`getClipTransitionOpacity`), so both ends of that clip dip, including the first and last clip.
- *Export:* `transition` on clip j describes the **join** between clip j and clip j+1: clip j fades out over `total // 2` frames of its end and clip j+1 fades in over the remaining frames; the first clip's start and the last clip's end are not faded.
**Proposed (recommended): move the editor to the export.** Apply the opacity ramp at the join only: outgoing clip over its last `d/2`, incoming over its first `d/2`, and none at the very start or end of the project. The export, which is what is published, does not change.
**Alternative:** change the export to fade both ends of every clip (matches the old editor look, adds dips at the start and end of every video, and changes every existing export).
**Effect.** Existing drafts that use Fade look different in the editor (one dip per join instead of two); their exports are unchanged under the recommended option.

## D3 (new finding, proposal). Reconstructor transitions look like "None" in the editor
The editor's Transition selector offers only "None" and "Fade", and its value is `selectedClip.transition === "fade_black" ? "fade_black" : "cut"`. A clip the Reconstructor saved with `dissolve`, `whip_pan` or `zoom_punch` therefore shows "None", and touching the selector silently overwrites it with `cut` or `fade_black`. The export does use the saved value, so the draft exports correctly (verified in the integrated check).
**Proposed.** Show the real value: add the missing options to the selector (Dissolve, Whip pan, Zoom punch; these exist in the `VideoClip` type) and show the duration field for every non-cut type. Label the ones the editor cannot preview "Exported only (no preview yet)". No new behaviour in the exporter. Needs your approval because it changes the protected editor panel.

## E. Deferred
- **E1** fonts for further scripts and **E2** Nastaliq for Urdu stay deferred until core reconstruction is accepted.

## F. Added without needing approval (for completeness)
- `?m2=all` turns on every preview panel at once; `?m2=manifest` shows the read-only manifest (task 3.5). Preview flags, off by default, read only.
- Subtitle position, size and line length (task 5.x): ordinary subtitle properties; defaults leave output unchanged.
- Gradient bars (task 3.4): a smooth gradient along an edge is rebuilt as two flat steps (the average colour of each half), with a note that this approximates the gradient. Native shapes, no stored-schema, editor or exporter change.
