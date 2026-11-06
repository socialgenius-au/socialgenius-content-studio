# Project-state isolation — decision package (protected files: NOT modified on any shared branch)

Status: awaiting approval. Verified only on a local scratch branch (`scratch/state-isolation-on-c12093c`, commit 8029cbb, based on the accepted checkpoint `c12093c`). Nothing protected has been changed on `work/deconstructor-reconstructor-next`, `main` or the deployed acceptance environment.

## The defect (five failing real-browser checks: D2b-1, D2b-2, D2b-3, D2b-4, D3)
Opening a saved draft inside an editor session that already has another project open leaves that project's **canvas format + background, subtitle style, media list and dragged canvas positions** in place whenever the opened draft does not itself carry them (Reconstructor and blueprint drafts carry none, by design). The next save then writes the leaked values into the new draft. Saved drafts are never altered by the switch itself (verified byte-identical).

## Exact change (`docs/proposals/protected-patches/project-state-isolation.patch`, 2 files, +13 / −5 lines)
Applies cleanly to `c12093c` (`git apply --check` passes).

### 1. `frontend/src/contexts/StudioContext.tsx` (protected) — one new action
| Where | Change | Why |
|---|---|---|
| `StudioState` interface | `+ resetCanvasItemPositions: () => void` | There is no way to forget dragged positions today (`setCanvasItemPosition` only adds/overwrites one id). |
| `StudioProvider` | `+ const resetCanvasItemPositions = useCallback(() => setCanvasItemPositions({}), [])` | Empties only the `canvasItemPositions` map. |
| provider value | `+ resetCanvasItemPositions` | Exposes it. |
No existing action, state or default changes.

### 2. `frontend/src/pages/video-studio-v2/components/CreateEditTab.tsx` (protected) — `applyDraftSnapshot` only
`applyDraftSnapshot` has **one caller**: `handleOpenDraft` (My Drafts → Open). Changes inside it:
| Line (before → after) | Why |
|---|---|
| `if (snap.subtitleStyle) setSubtitleStyle(snap.subtitleStyle)` → `setSubtitleStyle(snap.subtitleStyle ?? {…EDITOR_DEFAULT_SUBTITLE_STYLE})` | A draft without a style must not inherit the previous project's. |
| new: drop media-list entries whose id is not in the snapshot (`removeMediaAsset`), then add the snapshot's | The list is the previous project's media; the snapshot's list replaces it. |
| `if (snap.canvasFormat) setCanvasFormat(snap.canvasFormat)` → `setCanvasFormat(snap.canvasFormat ?? {…EDITOR_DEFAULT_CANVAS_FORMAT})` | Same, for the canvas. |
| Reconstructor colour: `{…(snap.canvasFormat ?? canvasFormat), background}` → `{…(snap.canvasFormat ?? EDITOR_DEFAULT_CANVAS_FORMAT), background}` | The colour must be applied on the draft's own/default format, not the previous project's. |
| new: `resetCanvasItemPositions()` immediately before the snapshot's positions are set | Previous drags must not survive. |
| new import of `EDITOR_DEFAULT_CANVAS_FORMAT` / `EDITOR_DEFAULT_SUBTITLE_STYLE` from `../blueprint/projectDefaults` | Non-protected module that mirrors StudioContext's own defaults; `projectDefaults.test.ts` fails if they ever drift. |

**Not changed:** `clearLiveProject`, `handleNewDraft` ("+ New" still keeps the current canvas format on purpose), `buildProjectSnapshot` / the saved-draft shape, the page-refresh recovery path (`VideoStudioV2.tsx`), playback/master clock, timeline, layers, export, Review tab, backend.

## How existing projects and saved drafts stay protected
- A draft that carries these settings (every draft saved from the editor writes `canvasFormat`, `subtitleStyle`, `mediaAssets`, `canvasItemPositions`) opens exactly as before: the same values are set, from the draft.
- Saved drafts are read-only inputs here; nothing in the patch writes to the database or to a draft. Browser check D4/C1: draft X byte-identical before and after.
- Only a draft that **omits** a setting changes behaviour, and only toward the editor's starting defaults instead of the other project's values. One disclosed edge: a very old draft saved before canvas format existed would now open at the default 9:16 Instagram Reel/Story canvas rather than at whatever canvas happened to be active.
- `removeMediaAsset` filters the editor's in-memory list only (`setMediaAssets(p => p.filter(...))`). It deletes nothing on the server, so the Asset Library is unaffected. Visible effect: files uploaded in this session but not part of the opened draft disappear from the editor's Media panel (they remain in the Asset Library).

## Does it reset only project-specific state, leaving preferences alone?
Yes. Reset: canvas format/background, subtitle style, the editor media list, dragged canvas positions: all saved *inside* the draft, so they are project settings, not preferences. Untouched: the logged-in user, client/campaign identity, chat history, selected rail tool/panels, zoom, templates, upload progress, undo history handling (already cleared by `clearLiveProject`), `canvasVersions` (not stored in drafts; out of scope), and the "+ New" behaviour.

## Targeted regression tests
- New `projectStateIsolation.wiring.test.ts` (non-protected; copy at `docs/proposals/protected-patches/projectStateIsolation.wiring.test.ts.txt`): pins each changed line, the order (media drop before add; reset before set), the single caller, and that `clearLiveProject`, `handleNewDraft` and `removeMediaAsset` are unchanged. Negative control: **6 of 11 assertions fail on the unpatched `c12093c`**, all 11 pass with the patch.
- Existing `projectDefaults.test.ts` (defaults cannot drift), `footageIO.test.ts` and the assembled-draft fixture (snapshots still never carry a canvas format).
- Real browser (CDP): the contamination scenario covers the exact five failures. Unpatched `c12093c`: 19 pass / 5 fail. Patched: **24 pass / 0 fail**.
- Full frontend suite on the patched scratch branch: 1,227 passed, 25 skipped; `tsc --noEmit` clean.
- Planned after approval and before closing M4/M5: persistence, Reconstructor flow and protected editor-flow browser scenarios, then the hosted workflow test.

## Rollback
One commit touching two files. `git revert <sha>` on the branch restores the previous behaviour exactly; no data migration exists to undo (no saved-draft or schema change), so reverting loses nothing. To roll back on acceptance: revert, push, and Railway redeploys the previous behaviour.

## Decision requested
Approve this exact patch (2 files, +13/−5) plus the new wiring test for `work/deconstructor-reconstructor-next` (acceptance only). On approval I will apply it as one commit, run the targeted tests plus one regression pass, and redeploy acceptance.
