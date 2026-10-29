# Reconstructor M1, Stage 3 preparation — export guard proposal

Baseline: `feature/m1-assembly-engine` @ `abe261a`. **Investigation and proposal only.** No protected file, backend source, database, Railway
setting or deployment was touched. The only additions are the files in this folder (not under `src/`, so not part of any build).

## 1. Where placeholders enter the export (exact path)

There is **one** export path in the app:

1. `frontend/src/pages/video-studio-v2/components/ReviewTab.tsx` — `handleExportVideo` (line 52) builds the request body.
   `text_overlays: textOverlays.map(...)` (line 86) sends **every** text overlay in the editor's state, with no filtering.
2. `frontend/src/api/client.ts` — `videoExportApi.exportProject` → `POST /video-export/export`.
3. `backend/app/routers/video_export.py` — copies every `text_overlays` entry into the render dict. No content checks.
4. `backend/app/services/ffmpeg_svc.py` — `render_project` → `_build_text_overlay_pngs` → composited onto the video.

**Confirmed by running the real exporter** (`render_project`) on the Stage-2 assembled draft (fixture): the placeholder wording is burned into the MP4
(frame captured at 1.5 s shows "TEXT PLACEHOLDER — Short on-screen phrase mirroring the…"; evidence file
`…/scratchpad/ui_review/m1_stage2/export_frame_placeholder.png`). Nothing in the editor, the router or the renderer stops it. The only other way text
reaches an export is the same list, so ReviewTab is the single choke point. ("Save as Draft" on that tab only shows a toast; no other button exports.)

## 2. The smallest guard

**Rule.** An overlay is a genuine reconstruction placeholder only if **both** hold:

* it carries the `blueprint` provenance tag (`kind` `text` or `cta`) that "Use blueprint" / Stage-2 assembly set; **and**
* its text still starts with `TEXT PLACEHOLDER —` or `CTA PLACEHOLDER —` (after leading whitespace; non-breaking spaces from the editor normalised).

Why both: the editor edits text with partial patches (`updateTextOverlay(id, { text })`, `StudioContext.tsx:337`), so the tag **survives** after a person
replaces the wording — the tag alone would block finished videos. The prefix alone would block ordinary text such as a title that starts with "TEXT
PLACEHOLDER". A project with **no** tagged overlay is not a reconstruction project and is never examined.

**Behaviour.** If any genuine placeholder remains, the export button does not send the request; it shows the existing red inline error:

> 2 placeholder texts from the reconstruction blueprint are still in this video (scene 2; call to action, scene 7). Replace or delete them in Create / Edit, then export again.

No override button (an intentional export of instruction text has no legitimate use). If you prefer an "Export anyway" confirm, say so.

**Optional second check (recommended, same function, same call site) — video-track gaps.** The exporter joins clips end to end and ignores `startTime`
(measured: clips at 0–4 s and 9–14 s export as 8.98 s, not 14 s). A reconstruction draft with an empty or under-filled scene therefore exports shorter
than planned, and every later clip *and all on-screen text* shift earlier. For reconstruction projects only, the guard also blocks when the video track
has a gap larger than 0.05 s. Existing projects keep today's behaviour exactly.

**Files (new, unprotected):** `frontend/src/pages/video-studio-v2/blueprint/exportGuard.ts` (+ `.test.ts`) — drafts in this folder, validated by
copying into `src/`, running, and removing. Pure function `checkReconstructionExport(textOverlays, videoClips)`; imports only the existing placeholder
prefix constants from `blueprintPlan.ts`.

**The only edit to an existing frontend file** — `ReviewTab.tsx`, 1 import + 5 lines, placed after the two existing checks and before
`setExportState("exporting")` (current line 65):

```ts
import { checkReconstructionExport } from "../blueprint/exportGuard";
// …inside handleExportVideo, after the clipsWithoutAsset check:
const blocked = checkReconstructionExport(textOverlays, videoClips);
if (!blocked.ok) {
  setExportState("error");
  setExportError(blocked.message);
  return;
}
```

`textOverlays` and `videoClips` are already destructured from `useStudio()` at the top of the component. No request-building code, state, markup or style
changes.

## 3. Protected / approval-needed files — exact list

| File | Change | Needed for |
|---|---|---|
| `frontend/src/pages/video-studio-v2/components/ReviewTab.tsx` | +1 import, +5 lines (above) | placeholder guard (and gap check) |
| `backend/app/services/ffmpeg_svc.py` | 1 line in `render_project` (section 4) | silent-source export failure |

Not needed and **not** to be touched: `CreateEditTab.tsx`, `StudioContext.tsx`, `videoPreviewUtils.ts` (master clock), `VideoStudioV2.tsx`, the export
router and schema. `ffmpeg_svc.py` is not an editor file, but it is the approved export engine, so I am treating it as approval-required.

## 4. Audio: do assembled clips keep their source audio?

Method: real `render_project` on a project shaped exactly like the Stage-2 fixture (7 clips, 8 texts), sources generated with the bundled ffmpeg; the
router's mapping reproduced (`has_separated_audio` False, `muted` False, `volume` 1 — which is what ReviewTab sends for assembled clips, since the engine
sets no `muted`/`volume`). Volume measured with `volumedetect`.

| Case | Result |
|---|---|
| E1 7 clips, sources with audio, 8 placeholder texts | OK, audio present, mean −24.1 dB (the source's real sound) |
| E4 single clip with audio | OK, −24.1 dB |
| E6 same as E1 but `muted` | OK, −91 dB (silent) — mute still works |
| E8 trimIn 3 @0.5× and trimIn 10 @2×, audio sources | OK, audio present, duration 8.96 s for 9 s planned |
| **E2 7 clips, sources with NO audio stream** | **FAILS**: `acrossfade … matches no streams` |
| **E7 one silent source among audio sources** | **FAILS** (same error) |
| E3 single silent clip | OK (no audio stream) |
| E9 7 clips + 8 texts at 1080×1920 | OK, 29.84 s, wall time 34 s here |

**Conclusion.** Source audio **is** retained when every source has an audio stream. Assembled clips carry their audio on the V1 clip itself (no separate
A1 lane — the editor's Media-panel flow mirrors audio onto A1, assembly does not); export treats both the same. **But any silent source (screen
recordings, most stock B-roll) breaks a multi-clip export** — a pre-existing exporter bug that assembly makes much more likely to be hit.

**Proposed fix (1 line, `ffmpeg_svc.py` `render_project`, after `keep_audio = …`, line 969):**

```python
keep_audio = keep_audio and await _has_audio_stream(c["path"])   # a source with no audio stream is treated like a muted clip
```

`_has_audio_stream` already exists in the same file. A silent source then gets the same generated silent track a muted clip gets, so every segment has a
uniform audio shape. Validated in memory (repo file untouched): E2, E7 and E1 all succeed with the fix; E1's audio level is unchanged (−24.1 dB).
Draft test: `test_export_silent_source.py` — **red today (2 failures), green with the fix (5/5)**.

## 5. Other blockers to a valid MP4 from an assembled draft

| # | Blocker | Severity | Fix / owner |
|---|---|---|---|
| 1 | Placeholder text burned in | High | Guard above (ReviewTab) |
| 2 | Silent source in a multi-clip export fails | High | 1-line fix above (ffmpeg_svc) |
| 3 | Gaps / empty scenes are collapsed, so later clips and text shift | High for partly-filled drafts | Gap check above; Stage-2 panel can also show "export-ready" (unprotected) |
| 4 | Junction overlap: each cut shortens the video by ~0.03–0.05 s (7 clips: 29.84 s vs 30 s), so text timings drift up to ~0.2 s by the end | Low, cosmetic | Pre-existing; document, accept for the first test |
| 5 | Synchronous export: one HTTP request renders the whole video; hosted CPU/timeouts unmeasured (34 s locally for 30 s at 1080×1920 with tiny sources) | Medium | Measure on preview; real phone footage (1080p, larger files) will be slower |
| 6 | Footage must persist on the host | Checked | `UPLOAD_DIR=/data/uploads` on the mounted volume (read-only Railway check, nothing changed) |
| 7 | Export button still omits shapes, lower thirds, subtitles, rich text | Not blocking the M1 test | Do not use those elements in the test; wiring is a separate approval |
| 8 | Text styling/fonts | OK | Fonts are bundled in the repo (DejaVu), no system font needed |
| 9 | Paid AI | None | Neither assembly nor export calls a provider |

## 6. Regression risks

* **Guard (ReviewTab):** limited to projects with a `blueprint`-tagged overlay; every other project gets `{ ok: true }` before any other work (tested:
  no tag → ok for any text/clips). Risk of a false block: a tagged overlay whose text a person deliberately left starting with the prefix — intended.
  Risk of a false pass: someone deletes the `blueprint` tag — not possible from the UI.
* **Gap check:** could block a reconstruction draft that a person deliberately left with a gap — but the export would silently mis-time it, so blocking
  is the safer default. Remove it from the proposal if you prefer a warning only.
* **ffmpeg_svc one-liner:** adds one `ffmpeg -i` probe per clip (the same call `_has_audio_stream` already makes elsewhere); behaviour changes only for
  sources with no audio stream, which currently crash multi-clip exports and produce an audio-less file for single clips (after the fix: a silent
  track). A single silent clip's output now contains a silent audio stream instead of none — harmless, and consistent with muted clips.
* **Nothing else changes:** no schema, route, state, or editor logic.

## 7. Acceptance tests (prepared, validated)

Frontend — `exportGuard.test.ts`, **21 tests**, all pass against the draft; `tsc` clean; 9 targeted mutations (tag not required, prefix not required,
prefix anywhere, non-reconstruction projects checked, tolerance removed, overlap cursor, unsorted clips, wrong precedence, NBSP not normalised, …) all
caught. Covers: tag+prefix = placeholder (text and CTA); similar text without tag = not; tag with replaced/empty text = not; mid-sentence mention = not;
whitespace/NBSP quirks; partly edited; malformed values never throw; message wording, scene numbers, singular/plural; the real Stage-2 draft is blocked
(8 placeholders) and passes after replacement; non-reconstruction projects always ok; inputs not mutated; gaps (contiguous, gap, late start, order,
overlap, nested clip, tolerance, precedence, real draft with a scene removed).

Backend — `test_export_silent_source.py`, 5 tests on real ffmpeg: audio kept; all-silent succeeds; one-silent-among-audio succeeds and keeps the others'
audio; muted still silent; single silent clip still exports. Red today, green with the fix.

Add on approval: (a) a static test that `ReviewTab.tsx` calls the guard before `setExportState("exporting")`; (b) a protected-file diff check (only the
two files above differ from `abe261a`; master-clock fingerprint unchanged); (c) the full suite (currently 480 frontend tests) and the Stage-2 browser run.

## 8. End-to-end test plan

**A. Local, before any deployment (no cost, throwaway database):**
1. Apply the approved changes on a new branch from `abe261a`; run tsc, the full frontend suite, production build, the new backend test.
2. Browser run (extends the Stage-2 harness): upload two real clips (one with audio, one silent) → assign to scenes → Save → Open in Video Studio →
   go to Review → **Export**: expect the guard message (placeholders). Replace all text in Create/Edit → Export → file downloads.
3. Verify the MP4 with ffmpeg: duration ≈ planned (within 0.3 s), audio stream present and audible from the audio clip, silent section silent, extracted
   frames show the replaced wording and **no** "PLACEHOLDER". Repeat with a deliberate gap → guard message; with an ordinary non-reconstruction project →
   export unchanged.
4. Regression: an existing non-reconstruction project exports exactly as before (byte-for-byte request body equality via a captured request).

**B. Preview (only after separate approval to push/deploy):** deploy to `preview/unified-v1`; the first run uses a reference that already has a blueprint
or needs the paid-AI approvals (decisions A/B from the audit); Mr. Ayub runs: pick reference → Create → upload his own 3–7 clips (including at least one
phone clip with sound) → assign → Save → Open → replace placeholder text → Review → Export. Record: success, wall time, file size, whether sound and
timing are right, any error text. Pass = a playable MP4 with his footage, his wording, correct sound, no placeholder text.

## 9. Decisions needed

1. Approve the `ReviewTab.tsx` guard (blocking, no override)? Include the gap check, or placeholders only?
2. Approve the 1-line `ffmpeg_svc.py` fix?
3. Local verification (plan A) first, then a separate approval for any push/deploy.
