# Proposal: keep the reconstruction account through the editor (PENDING AYUB APPROVAL, protected file)

Status: **prepared and verified in a scratch worktree only** (`scratch/m5-account-persistence`, local). Nothing in this proposal is applied to `feature/m4m5-batch2`, `integration/m4-m5-batch1` or any deployed branch.

## The problem, demonstrated
`CreateEditTab.tsx` builds the draft it saves in one place, `buildProjectSnapshot()` (the only call site is `performSaveDraft`), from the keys the editor models. A save replaces the whole `project_json`. So any other key the draft carried is deleted by the first editor save. Control run in a real browser on the real VA5368 evidence (build without the patch): the Reconstructor draft carries `elementReconstruction` (31 elements); the person changes the canvas colour and saves; the edit is saved, every text layer and its own provenance survive, and **`elementReconstruction` is gone**. The same silently happens today to `textReconstruction`, `imageReconstruction`, `backgroundReconstruction`, `transitionReconstruction`, `speechReconstruction`, `compositionReconstruction` and `assembly`. The layers keep their own per-layer provenance; the draft-level accounts do not survive.

## The change (7 added lines in `CreateEditTab.tsx`; one new non-protected helper)
Exact diff: `docs/proposals/protected-patches/element-account-persistence.patch`.
1. `import { pickDraftExtras } from "../export/draftExtras";`
2. `const draftExtrasRef = useRef<Record<string, unknown>>({});` beside `buildProjectSnapshot`.
3. In `buildProjectSnapshot`, `...draftExtrasRef.current,` as the FIRST entry, so every named key the editor models always wins.
4. In `applyDraftSnapshot`, first line: `draftExtrasRef.current = pickDraftExtras(snap);`.
5. In `handleNewDraft` (after confirmation): `draftExtrasRef.current = {};` so a new project never inherits another draft's records.
New file `video-studio-v2/export/draftExtras.ts`: `pickDraftExtras(snapshot)` takes ONLY keys named `assembly` or `<lowerCamel>Reconstruction`, only plain objects, at most 512 KB each, as deep copies (a later edit can never reach them); anything else, anything non-serialisable, and anything oversized is ignored. It never reads or interprets a record.

## Behavioural impact
- A draft with none of those records: `pickDraftExtras` returns `{}`; the saved JSON is byte-for-byte what it was. Verified: an older draft (no record) was opened, saved from the editor, and gained none.
- A draft with records: they are written back unchanged on every save, whatever else is edited. Verified through reopen and a second save.
- No layer, timeline, playback, preview, export or API behaviour changes. No new editor UI. No schema or API change (project JSON already accepts any keys; older editors ignore these).
- The record is a SAVE-TIME account; after layer edits its statuses can go stale. `reconcileElementReconstruction` (in `feature/m4m5-batch2`, non-protected, unit-tested) recomputes statuses from the current layers' provenance whenever the account is read; the static part (element, class, evidence, readiness, candidate ids) is what is persisted.

## Verified (local; real browser, real backend, real VA5368 evidence, real MP4)
With the patch: the account survives the first editor save unchanged (deep equal); survives a full reload, reopening and a second editor save; a real MP4 exports from the reopened draft and the draft still carries the account afterwards; an older draft is saved with none and unchanged layers. 8 of 8. Without the patch (control): dropped, as above. Unit: 4 tests (`draftExtras.test.ts`: key selection, copies, size and type limits, no-records no-op, and a source check of the three wiring points).

## Alternatives considered
1. **Write the account into per-layer provenance only.** Works for elements that have a layer; elements with no layer (people, missing assets, unsupported, not included) would have nowhere to live, and the account's purpose is to say what was NOT rebuilt.
2. **Store the account outside `project_json`** (a new API field or table): a backend schema change and a migration, both excluded without approval, and a second source of truth that can disagree with the draft.
3. **Hide it in an existing round-tripped key** (`canvasItemPositions`, `blueprintPlan`): abuses types that other code validates and renders from. Rejected as fragile.
4. **Make the editor model the records as typed fields** (add to `types/index.ts`, `StudioContext`): larger protected change, buys nothing over carry-through, since the editor never uses the records.
5. **Do nothing and re-derive the account on reopen:** impossible in the editor, which has no access to the reference's evidence.

## Regression risks and how they are covered
- A stale record outliving the layers it describes: covered by `reconcile` (and the record states it is a save-time account).
- A foreign or huge key being carried: limited by the key pattern, plain-object check and size cap.
- Key collision with a named key: named keys come last in the object literal and win.
- Undo/redo: extras are not part of the undo stack and are not changed by editing.

## Test plan when approved
Apply on a branch from `integration/m4-m5-batch1` (or its successor), rerun `draftExtras.test.ts`, the persistence scenario (8 checks), and the integrated protected-flow scenario (32 checks); ask Ayub for the manual save/reopen check.
