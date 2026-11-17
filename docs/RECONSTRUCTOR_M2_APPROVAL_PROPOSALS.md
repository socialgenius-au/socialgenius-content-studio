# Reconstructor M2: decisions and exact proposals

Status after your decision of 2026-11-02. Items marked **done** are implemented on `integration/m2-fast-track-2` behind the `?m2=` preview flags. Items marked **proposal** are not implemented: each gives the exact change, what it does to the workflow and the export, and what it leaves alone, taken from the current code.

| Item | Decision | State |
|---|---|---|
| A1 Arabic-script wording | Approved | **done** (`9c17b08`) |
| A2 White-flash wording | Approved in principle | **done**, wording below for a last look |
| B1 Motion evidence | Conditional: existing structures only | **done**, frontend only; no new rows or schema needed |
| C1 `hold_incoming` | Approved in principle, opt-in | behaviour **verified**; protected patch **presented** (not applied) |
| C2 / C3 Canvas background | Approved in principle | C2 patch **presented** and backend-verified (not applied); C3 design only |
| D1 / D2 Editor transitions | Pending | D2 patch **presented**; D1 design only |
| D3 Editor shows Reconstructor transitions as "None" | Approved as a narrow correction | patch **presented** (not applied) |
| E1 / E2 Other scripts, Nastaliq | Deferred | not started |

## A1 (done). Arabic-script note
Arabic-script lines (Arabic, Urdu, Persian, Pashto) now carry an information note, not a warning, and the summary counts them as "N in Arabic script (exported in Noto Naskh Arabic)". The note reads: "This text is in Arabic script. The exporter draws Arabic script in Noto Naskh Arabic, the standard Arabic style; it does not have the Nastaliq style often used for Urdu. Letters join and run right to left, and it was checked on sample Urdu lines, but not on every dialect or rare character, so look at the exported frame." Hebrew, Indic, Thai and CJK keep the amber warning because the exporter still has no font or layout for them; where a line mixes Arabic with one of those scripts, the warning wins. The record saved with the draft now says the same in its `limitations`, and counts Arabic-script lines separately (`arabicScript`).

## A2 (done). White flash and fade through white
The brightness profile of a cut is read for a climb toward white and back. The editor has no white transition, so the panel proposes the nearest one and says so:
- badge: "White transition detected" (information, not a warning);
- hover/note, flash: "A white flash was detected here. The editor cannot recreate it, so a hard cut is proposed as the nearest approximation; the flash itself will not appear.";
- hover/note, fade: "A fade through white was detected here. The editor cannot recreate it, so a dissolve is proposed as the nearest approximation; the white itself will not appear.";
- confidence is never above medium, and the person can change the type like any other estimate.

## B1 (done, frontend only). Whip pan and zoom punch, estimated from measurements that are already stored
**Finding that changed the plan:** the stored `transition_evidence` rows already carry, per frame pair, an ORB+RANSAC affine fit (translation x/y, scale, rotation, inlier ratio) and a phase-correlation shift (dx, dy, response), and the existing API response already returns them. So **no new annotation rows, category, table, column or backend pass is needed**; the `motion_evidence` row design in the earlier version of this document is withdrawn.

What was built (`transitions/motion.ts`, `classify.ts`, `evidence.ts`, `candidates.ts`; nothing protected, no backend):
- **Distinctions kept.** The per-pair numbers stay MEASURED (shown in the panel's reasons exactly as stored). The type "whip pan" / "zoom punch" is INFERRED here from provisional thresholds and is labelled "Estimated". Confidence is `low` for 2 agreeing pairs and `medium` for 3 or more, never higher.
- **Thresholds (provisional, in `MOTION_THRESHOLDS`).** Whip pan: the picture shifts at least 12 % of the frame width (or height) between two samples, the same way, on at least 2 consecutive pairs, from a feature fit with at least 50 % inliers, or from phase correlation with response of at least 0.15 where the fit failed. Zoom punch: scale of at least 1.08 (or at most 1/1.08) on at least 2 consecutive pairs with under 5 % sideways shift.
- **Never default-included.** A motion estimate is left out until the person includes it, carries an information badge "Motion estimate", and says: "Estimated from measured motion; it is not the original effect… The export uses the editor's own effect, not the measured direction." (The exporter maps whip pan to a right wipe and zoom punch to a zoom-in, whatever the measured direction.)
- **Not claimed:** the original effect, its direction as an instruction, or its settings.
- **Demonstrated with:** invented profiles (unit tests) and **numbers measured by the backend's real measuring code on two constructed synthetic clips** (a fast pan across a cut, a punch-in across a cut): the pan was read as a whip pan, the picture moving left 16–24 % of the width over 4 pairs; the zoom as a punch-in of 1.2–1.3x over 4 pairs; the failed fit on the cut pair left a gap and was not turned into a movement. **Not yet demonstrated on real reference footage:** the reference in our test data has one hard cut and its stored copy here has no motion fields; whether real whip pans are caught, and at what rate they are wrongly caught, needs a real reference with such a transition (hosted, authenticated).

## C1 (backend behaviour verified; protected change presented). Hold the incoming clip's first frame
**Verified with real ffmpeg on barcoded synthetic clips, no product code changed** (`backend/tests/test_transition_edge_policy.py`, 4 tests): the default and an explicit `shorten` are frame-identical (the dissolve collapses to a hard cut at the join); with `hold_incoming` the total length is the same 120 frames, the join stays at frame 60, the incoming clip is on its frame 0 at the join and plays its own footage unshifted after it, frames before the 15-frame window are byte-identical and frames after it equal the default to the encoder's rounding; inside the window every barcode pixel is the outgoing frame or the incoming frame 0 (no pixel shows the incoming clip moving on); the incoming clip's sound is silent until the join; the outgoing sound fades out across the window; the audio length is unchanged. One property worth knowing: ffmpeg's `dissolve` switches pixels at random times, so the picture is a dither between the two frames, not a smooth mix, and it reaches about 96 % on the join frame and 100 % on the next.

**Exact file-level change** (`protected-patches/c1.patch`, applies cleanly to this branch, type-checks):
- `backend/app/schemas/video_export.py`: `transition_edge_policy: Literal["shorten", "hold_incoming"] = "shorten"` on `ExportProjectRequest` (+ `from typing import Literal`).
- `backend/app/routers/video_export.py`: pass `"transition_edge_policy": body.transition_edge_policy` into the project dict (the exporter already reads this key).
- `frontend/src/pages/video-studio-v2/components/ReviewTab.tsx`: a `useState` defaulting to `"shorten"`, one select shown only when some clip has a dissolve ("Dissolves where a clip has no spare footage: Shorten the dissolve (default) / Hold the incoming clip's first frame while it fades in"), and `transition_edge_policy` in the export body. It applies to the next export and is **not** saved in the draft in this version.
- `backend/tests/test_edge_policy_request.py`: the request accepts only the two values and defaults to `shorten`.
**Effect on the user:** none unless the select is changed; the default output is byte-identical to today.

## C2 (patch ready and backend-verified). Canvas background colour — `protected-patches/c2.patch`
**Controls.** One colour input "Canvas background" with "Reset to black", in the canvas toolbar beside the zoom readout (`CreateEditTab.tsx`). **Default:** unset = black, exactly as today. The colour lives in `canvasFormat.background` (an optional `"#rrggbb"` on `CanvasFormatState`), so it is saved in the draft and restored on reopen through the existing `canvasFormat` path with no new persistence key; choosing another format keeps it.
**Preview.** The preview stage (`.video-preview.real`, black today) takes the colour as an inline background. Nothing else in the preview changes.
**Export.** `ExportProjectRequest.canvas_background` (optional, validated `#rrggbb`, anything else rejected) → project dict → `render_project` → `build_clip_segment(pad_color=…)` for the "fit" padding and `build_gap_graph(color=…)` for timeline gaps, so preview and export agree. "Fill" clips have no padding and are unaffected; V2 inserts and media overlays are unchanged.
**Verified (real ffmpeg, backend half applied in a scratch tree, 5 new tests):** a wide clip on a portrait canvas gets bars of the chosen colour (YUV within tolerance) and black by default, the picture itself is unchanged, a timeline gap uses the same colour, an absent field renders frame-identical to before, and malformed colours are rejected. The 37 existing export/timeline tests still pass with the patch applied. The frontend half type-checks but has not been exercised in a browser (it is not applied anywhere).
**Files:** `backend/app/schemas/video_export.py`, `backend/app/routers/video_export.py`, `backend/app/services/ffmpeg_svc.py` (pad colour, gap colour, one project key), `frontend/src/contexts/StudioContext.tsx` (type only), `frontend/src/pages/video-studio-v2/components/CreateEditTab.tsx`, `…/ReviewTab.tsx`, `backend/tests/test_canvas_background.py`. (`VideoStudioV2.css` is not needed.)
**Not included:** the Reconstructor-side "Use as canvas background" button for a flat bar; it is a small non-protected addition once this lands.
**C1 and C2 overlap textually** (same two request files), so each applies alone; if both are approved a combined patch will be produced.

## C3 (design only, not patched). Blurred-fill backdrop
Only if C2 is not enough. **Export:** for a "fit" clip, `split` the stream; one copy `scale=…:force_original_aspect_ratio=increase,crop=W:H,boxblur=20:2`, the other the normal fit scale, `overlay` centred. **Control:** "Backdrop: Colour (default) / Blurred video" next to the colour input, stored as `canvasFormat.backdrop`. **Preview:** a second muted `<video>` behind the real one with CSS `filter: blur(…)` and `object-fit: cover`, slaved to the master clock. Encode time for affected clips rises (not measured); the preview adds a decoder. An exact diff will follow a decision on C2.

## D1 (design only, not patched). Dissolve preview in the editor
**Today:** one `<video ref={videoRef}>` shows the current clip and switches source at a cut; `getClipTransitionOpacity` can only ramp opacity for `fade_black` (`CreateEditTab.tsx`, around line 2029).
**Proposed:** a second muted `<video>` for the incoming clip, mounted only while a join with `transition = dissolve` is inside its window `[J − x, J + y]`; its `currentTime` is set from the master clock each tick (never the other way round) to the incoming clip's source frame for that timeline time (pre-roll from its trim-in, held first frame where there is no spare, exactly as `timeline_plan.py` decides); its opacity ramps 0→1 over the window and the outgoing element is not faded. A small TypeScript mirror of the window rules (`dissolveWindow(clips, i)`), unit-tested against the Python plan for the same clips, supplies `x` and `y`. Whip pan and zoom punch stay unpreviewed.
**Why it needs approval:** it sits beside the approved master-clock playback; a re-run of manual Test 7.3 would be required before release. **A compiled diff is not offered yet** because it is only meaningful once the direction is chosen (and the C1 policy decides what the window shows).

## D2 (patch ready, type-checks) — `protected-patches/d2.patch`
Replaces `getClipTransitionOpacity` so the editor fades **at the join, as the exporter does**: a clip with `fade_black` fades out over the first `⌊total/2⌋` frames of the window (`total = max(2, round(d·30))`) at its own end, the next clip fades in over the remaining frames of the window at its own start, and the very start and very end of the project are not faded. Export is unchanged. **Effect:** an existing draft that uses Fade shows one dip per join in the editor instead of a dip at both ends of every faded clip; its exported video is identical to before. **Not yet exercised in a browser.** The alternative (change the export to fade both ends of every clip) is not patched because it changes every existing export.

## D3 (patch ready, type-checks) — `protected-patches/d3.patch`
`CreateEditTab.tsx`, Transition selector only. A stored value the selector has no option for (dissolve, whip pan, zoom punch) is shown as itself — "Dissolve (exported, not previewed)" — instead of "None", and the Transition Duration field is shown for any non-cut value (it was shown only for Fade). Opening, focusing or leaving the selector changes nothing; only an explicit pick calls `updateVideoClip`, so a stored dissolve is never overwritten by interaction. The exporter reads the stored value as before; preview behaviour is unchanged. 7 lines added, 2 changed. **Not yet exercised in a browser.**

## E. Deferred
- **E1** fonts for further scripts and **E2** Nastaliq for Urdu stay deferred until core reconstruction is accepted.

## F. Added without needing approval (for completeness)
- `?m2=all` turns on every preview panel at once; `?m2=manifest` shows the read-only manifest (task 3.5). Preview flags, off by default, read only.
- Subtitle position, size and line length (task 5.x): ordinary subtitle properties; defaults leave output unchanged.
- Gradient bars (task 3.4): a smooth gradient along an edge is rebuilt as two flat steps (the average colour of each half), with a note that this approximates the gradient. Native shapes, no stored-schema, editor or exporter change.
