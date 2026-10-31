# Reconstructor — Assembly Engine (M1, Stage 1)

> **Status: intermediate milestone.** Stage 1 is a pure, local engine. It is **not** the full editable Reconstructor.
> There is no UI for it yet, nothing calls it from the app, it has not been deployed, and no footage-assignment
> workspace exists. Nothing here changes Video Studio V2, the Deconstructor, or any stored draft.

## What it does

`assembleDraft(input)` converts an existing **reconstruction blueprint plan** (`BlueprintPlan`, from
`video-studio-v2/blueprint/blueprintPlan.ts`) plus **user-selected footage** and a **scene → clip assignment** into a
**Video Studio V2 draft snapshot** that the existing drafts API stores and the existing editor opens.

Location: `frontend/src/pages/deconstructor/assembly/`

| File | Purpose |
|---|---|
| `types.ts` | All types and constants (`assembly-v1`, engine `1.0.0`, speeds, tolerances) |
| `elementClasses.ts` | The automatic / partial / unsupported table |
| `assembleDraft.ts` | `assembleDraft`, `suggestAssignments`, `summarizeIssues` |
| `index.ts` | Public exports |
| `assembleDraft.test.ts` | 69 tests (real VA5368 blueprint, property test, edge cases, draft compatibility, purity) |
| `__fixtures__/va5368.assembled.snapshot.json` | Engine output for the real blueprint, shared with the backend test |
| `backend/tests/test_assembled_draft_compat.py` | 9 tests: the existing drafts API and export schema accept the snapshot |

It is **pure**: no clock, no randomness, no network, no storage. `createdAt` is supplied by the caller. The same input
always produces the same output, including the same ids and `inputDigest`. Inputs are never mutated.

## Input

```ts
assembleDraft({
  plan,                 // BlueprintPlan (unchanged, as built by buildBlueprintPlan)
  footage,              // FootageClip[]: { key, assetId, url, name, duration, hasAudio? , asset? }
  assignments,          // SceneAssignment[]: { sceneNumber, clips: ClipUse[] }
  createdAt,            // ISO string, supplied by the caller
  options?: { underfilled?: 'gap' | 'stretch', requireAllScenes?, referenceAssetIds?, requestedElements?, identity? },
})
// ClipUse: { footageKey, trimIn?, useDuration?, speed?, fit?, muted?, volume? }
```

`suggestAssignments(plan, footage, { reuse })` proposes a deterministic first assignment (one clip per scene, footage in the order supplied; scenes beyond the footage stay empty unless `reuse` is set) that the person is expected to edit.

## Time model (identical to the editor and the exporter)

* Scenes keep the blueprint order and start/end times; the timeline is gapless and `timeline.duration` = last scene end.
* Several clips in one scene share the scene's slot equally unless `useDuration` is given; the last share absorbs rounding.
* The exporter reads source `[trimIn, trimIn + (endTime − startTime) × speed)`. The editor stores
  `trimOut = duration − trimIn − sourceSpan`. The engine produces exactly this, so a clip never reads past its file.
* A clip never crosses its scene boundary (exact, no tolerance; covered by a targeted test and a mutation check).
* Footage shorter than its slot: `underfilled: 'gap'` (default) leaves a visible gap and reports `scene_underfilled`;
  `'stretch'` slows the clip to the nearest allowed speed (0.25–2) if that fully covers the slot, else leaves a gap.
* Times are rounded to 3 decimals (`trimOut` to 6) so rounding never produces drift or a read past the source end.

## Output: draft structure

`result.ok === true` gives `{ name, snapshot, issues }`. `snapshot` is the **existing blueprint draft snapshot**
(`buildDraftSnapshot`) with real clips, plus one extra key:

```
videoClips            real clips, ids asm:{blueprintId}:s{n}:c{i}; standard VideoClip fields
                      (assetId,url,name,duration,startTime,endTime,trimIn,trimOut,speed,colorGrade 'none',
                       brightness/contrast/saturation 0, transition 'cut', transitionDuration 0.5; fitMode/muted/volume only if given)
additionalVideoClips  [] (unchanged)
textOverlays          one TEXT PLACEHOLDER per scene (+ CTA PLACEHOLDER), ids bp:{blueprintId}:s{n}:text, carry a `blueprint` tag
mediaOverlays/audioTracks/lowerThirds/shapes/subtitles  [] (unchanged)
mediaAssets           the Asset records for the footage used (sorted by key, so order never changes the result)
timeline, canvasItemPositions, clientIdentity           as the existing blueprint snapshot
blueprintPlan         the plan the draft was built from (unchanged)
assembly              NEW. Ignored by the editor's open-draft path; carries the provenance below
```

`assembly` = `{ schema:'assembly-v1', engineVersion, blueprintId, referenceVideoId, videoAnalysisId, createdAt,
inputDigest, scenes[], summary, elementClasses[], unsupported[], issues[] }`.

`name` comes from the existing `draftNameFor` (≤ 255 characters, the drafts table limit).

Errors (`ok: false`) return `{ issues }` and produce **no snapshot**: invalid plan or timing, missing/duplicate/unknown
footage, trim outside the file, invalid duration or speed, reference-video media used as footage, scene overflow, a
scene with no usable clips when `requireAllScenes` is set. Warnings/notes accompany ok results (`scene_unassigned`,
`scene_underfilled`, `clip_too_short`, `no_video_clips`, `unsupported_element`, `partial_element`, `footage_reused`,
`footage_unused`, `placeholder_text_present`).

## Source evidence vs. inferred structure vs. supplied media

Every scene in `assembly.scenes[]` keeps four separately labelled parts:

| Part | `origin` | Meaning |
|---|---|---|
| `evidence` | `reference_evidence` | Measured from the reference video: anatomy sections, confidence, limitations |
| `structure` | `inferred_structure` | The blueprint's interpretation: purpose, role, mechanisms, instructions, mandatory points |
| `media` | `user_supplied` (or `none`) | The new footage actually placed, with trim, speed, coverage |
| `text` | `placeholder` | Placeholder text still present; `replaced:false` until the person edits it |

Reference footage is never copied into the draft; footage that is the reference video's own asset is rejected
(`reference_media_not_allowed`).

## Editable / partially editable / unsupported

| Class | Elements |
|---|---|
| **Automatic** | scene structure, clip placement, clip trim, clip speed, text placeholder, CTA placeholder |
| **Partial** (the person finishes it in the editor) | transition, voiceover, music, captions, lower third, shape |
| **Unsupported** (not recreated; a flattened source is never presented as editable elements) | reference footage, burned-in text, graphics, colour grade, effects, audio mix |

The table is stored in `assembly.elementClasses` so any future UI can show it without re-deriving it.

## Verification (Stage 1)

* 69 frontend tests + a 20,000-case property run; 8 engine mutations, all caught (the 8th, scene-boundary clamp, was
  initially uncaught and now has a targeted test).
* 9 backend tests against a throwaway local Postgres: the existing drafts API stores/returns the snapshot byte-equal,
  existing drafts (including a legacy-format draft and another user's) are untouched, the table columns are unchanged,
  and the snapshot is valid input for `ExportProjectRequest`.
* Purity test: no fetch/storage/clock/random, import allow-list.
* No protected editor file, backend source, dependency or Railway setting was changed.

## Known limitations of Stage 1

* No UI. No draft is created from the app yet.
* Placeholder text is real `textOverlays`; **exporting without replacing it burns the placeholder text into the video.**
* The editor's export button sends only basic fields (no shapes, lower thirds, subtitles or rich text) even though the
  backend schema supports them — a protected-file gap (`ReviewTab`), unchanged here.
* Export requires at least one video clip; an assembly with none reports `no_video_clips`.
* Transitions, voiceover, music, captions are not generated — see the partial class above.

## Next: integration requirements for the Footage assignment workspace (Stage 2 — needs approval)

1. **Footage source.** List the user's existing assets (video type) and allow upload through the existing asset
   service. Build `FootageClip` from each: `key` (stable, e.g. `a{assetId}`), `assetId`, `url`, `name`, `asset`, and a
   real `duration` from the existing `probeVideoDuration`. Never accept a duration the file does not have.
2. **Reference exclusion.** Pass `referenceAssetIds` (the reference video's asset ids) so reference footage cannot be
   used as new media.
3. **Assignment UI.** One row per blueprint scene: planned duration, purpose, instructions (from `assembly`/plan),
   a clip picker with trim-in and optional use-duration/speed, coverage indicator (filled / gap seconds), reuse
   warning. Seed with `suggestAssignments`, always editable.
4. **Live validation.** Call `assembleDraft` on each change (it is cheap and pure); show `issues` by severity; block
   "Create draft" while any error exists; show `scene_underfilled` and `placeholder_text_present` prominently.
5. **Underfilled policy.** Expose `gap` vs `stretch` as an explicit choice; default `gap`.
6. **Creation.** Inject `createdAt = new Date().toISOString()` at the call site (the engine never reads the clock),
   save with the existing `videoStudioDraftsApi.create({ name, project_json: snapshot })`, and open it with the
   existing `openDraftHint` / `setBlueprintPlan` handoff used by `createStudioDraftFromBlueprint`.
7. **Existing flow untouched.** Keep today's "placeholders only" draft path as is; the workspace is an additional,
   opt-in route.
8. **Placeholder-export guard (decision needed).** Options: warn in the workspace only (no protected change), or add a
   guard in the export tab (protected file — requires explicit approval).
9. **Export wiring gap (decision needed).** Sending shapes/lower thirds/subtitles/rich text from the export button
   requires a change to protected `ReviewTab`; needs explicit approval.
10. **Tests to add with the UI.** Component/SSR tests for the workspace, an end-to-end browser pass on a throwaway
    local database with test footage, and a repeat of the protected-file diff and master-clock fingerprint check.

Do not describe M1 as the finished Reconstructor: after Stage 2 there is still hosted-run validation, copy
replacement guidance, and the deferred polish items.

## Stage 2: Footage Assignment workspace (local only)

Stage 2 connects the engine to the existing Deconstructor page. It adds **one panel inside the existing "Create" step** (below the
unchanged "Use blueprint in Video Studio" button). The six steps and their layout are unchanged.

`frontend/src/pages/deconstructor/footage/`

| File | Purpose |
|---|---|
| `footageModel.ts` | Pure model: what the person typed -> engine input; engine answer -> scene rows. No assembly logic of its own |
| `footageLibrary.ts` | List videos, upload (existing `/upload/`), read a video's real length (no fallback length) |
| `assembledDraft.ts` | Save through the existing drafts API (create, or update the same draft); open via the editor's existing hand-off |
| `FootageAssignmentView.tsx` / `FootageAssignment.tsx` | Presentational panel / container |
| `*.test.ts(x)` | 69 tests (model, I/O failures, saving/opening, render) |

Behaviour: choose or upload your own videos; assign them per scene with optional start point, length and speed; the engine re-runs on
every change and the panel shows coverage, uncovered seconds, warnings, blockers and the automatic / partial / unsupported table.
The reference video's own asset (and any other ingested reference) is disabled in the picker and refused by the engine.
**Save draft** creates one draft (saving again updates it); **Open in Video Studio** is enabled only for an up-to-date saved draft and asks
before replacing a project in progress. No AI provider is called.

Still not done: export-side changes (placeholder-text guard, sending shapes/lower thirds/subtitles/rich text), deployment, hosted validation.

## Stage 3: export safety (local only)

Three approved fixes, each verified in a real browser run with a real export (details in `docs/proposals/m1-stage3/PROPOSAL.md`):

1. **Placeholder guard** — `video-studio-v2/blueprint/exportGuard.ts`, called from `ReviewTab.tsx` before the export request is built. Blocks only overlays that carry
   the blueprint tag **and** still start with the placeholder prefix; names the scenes; no override.
2. **Gap guard** — same function. For reconstruction projects only, blocks a gap larger than 0.05 s on the video track (the exporter joins clips end to end and would shift
   later clips and text). Existing projects are never examined.
3. **Silent-source fix** — `backend/app/services/ffmpeg_svc.py` `render_project`: a clip whose source has no audio stream is treated like a muted clip (once per distinct file, and
   only probed when the clip would otherwise keep its audio).

Known limits after Stage 3: each cut shortens the export by ~0.03 s (29.84 s for a 30 s plan; text timings drift up to ~0.16 s by the end); the export is one synchronous request and
its ffmpeg join opens every clip at once — measured peak for 7 clips at 1080x1920 is ~1.6 GB working set / ~2.5 GB committed (720x1280: ~1.2 GB), so a small hosted container can
run out of memory; shapes, lower thirds, subtitles and rich text are still not sent by the export button.

## Stage 4A: uploaded-video URLs on the Railway volume (local only)

The preview stores `file_path` as `/data/uploads/<user>/<file>` (absolute `UPLOAD_DIR`), but `assetsApi.previewUrl` only understood the relative `uploads/...` layout, so the
browser asked for `/uploads//data/uploads/...` (404): clips could not be previewed or measured. `previewUrl` now maps the known `/data/uploads/` root to the public `/uploads/` route
(`frontend/src/api/uploadPaths.ts`), keeps the relative layout byte-identical, encodes each path segment, and returns '' for anything else (other absolute paths, drive letters, dot or empty
segments, control characters, non-strings). Verified in a real browser against a backend storing absolute paths: before the fix 5 of 14 checks passed, after 14 of 14.
