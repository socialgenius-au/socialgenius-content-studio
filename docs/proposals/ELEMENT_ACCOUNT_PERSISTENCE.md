# Keeping the reconstruction account through the editor (APPLIED on `integration/m4-m5-batch2`, conditional approval)

Status: approved conditionally ("M4/M5 BATCH 2 APPROVAL", item 2). Applied to `integration/m4-m5-batch2` only: not merged to `main`, not deployed. The exact protected-file diff is `docs/proposals/protected-patches/element-account-persistence.patch`.

## The problem
`CreateEditTab.tsx` builds the draft it saves in one place, `buildProjectSnapshot()`, from the keys the editor models, and a save replaces the whole `project_json`. Any other key the draft carried was deleted by the first editor save. Control run (real browser, real VA5368 evidence, build without the change): `elementReconstruction` (31 elements) is dropped by an editor save, as are `textReconstruction`, `imageReconstruction`, `backgroundReconstruction`, `transitionReconstruction`, `speechReconstruction`, `compositionReconstruction` and `assembly`. Layers keep their own per-layer provenance; the draft-level accounts did not survive.

## The change: 5 code lines in `CreateEditTab.tsx` (plus 2 comment lines); one new non-protected helper
1. import `draftExtrasForSave, emptyExtras, pickDraftExtras` from `../export/draftExtras`.
2. `const draftExtrasRef = useRef<DraftExtras>(emptyExtras());`
3. `buildProjectSnapshot`: `...draftExtrasForSave(draftExtrasRef.current, { textOverlays, mediaOverlays, shapes }),` as the FIRST entry, so every named key the editor models is written after it and always wins.
4. `applyDraftSnapshot`, first line: `draftExtrasRef.current = pickDraftExtras(snap);`
5. `handleNewDraft`, after the confirmation: `draftExtrasRef.current = emptyExtras();` (a genuinely new project inherits nothing).

No change to `types/index.ts`, `StudioContext`, playback, layers, timeline, preview or export.

## The safeguards required by the approval, and where each lives (`video-studio-v2/export/draftExtras.ts`)
| Requirement | How it is met |
|---|---|
| Preserve the named records and assembly metadata through save/reopen | every key named `assembly` or `<lowerCamel>Reconstruction` is carried as a deep copy |
| Editor-owned keys stay authoritative | the carried keys are spread FIRST; every named editor key follows |
| Clear on a genuinely new project | `handleNewDraft` resets the carried state |
| No playback / layer / timeline / export regressions | nothing in those paths is touched; verified (below) |
| Do not silently discard records over 512 KB or failing validation | **nothing is discarded.** The earlier proposal dropped such records; this version carries every matching record in full (a 600 KB record and a malformed non-object record survive an editor save) and REPORTS them: `console.warn`, and an `extrasPreservation` list written into the saved draft (`large`, `not_an_object`, `copy_failed`, `unrecognised_account`). The list is regenerated on every open, so it never accumulates and disappears once nothing is unusual |
| Report any preservation failure explicitly | as above; a failure to reconcile keeps the account exactly as stored and says so in the list |
| Keep the account consistent with the actual layers | on every save the element account is passed through the existing `reconcileElementReconstruction` against the current text/image/shape layers (static parts kept; layers and statuses recomputed from layer provenance). Elements are never invented or dropped |
| Old-draft compatibility | a draft with none of these keys is saved exactly as before (`{}` is spread) |

What is NOT done: there is no visible in-editor banner for a preservation note, because that needs UI changes inside the protected file beyond this patch. The note is in the draft (`extrasPreservation`), in the console, and surfaced by the Reconstructor manifest when it next reads the draft. If you want a banner, that is a separate small patch to submit.

## Verification (local; real browser, real backend, real VA5368 evidence, real MP4)
- Unit: `draftExtras.test.ts` 7 tests (selection and copies; oversized and malformed records kept and reported; no-records no-op; reconcile against deleted layers; foreign account kept as stored; report not accumulating; wiring source check). `assembleDraft.test.ts` still passes: the editor source does not mention the assembly table.
- Browser persistence scenario `cdp_persist2`: **14 of 14**:
  P0 Reconstructor draft carries the account (31 elements);
  P1 the edit is saved and every layer and its provenance survive;
  P2 the account survives the first editor save with its static parts unchanged;
  P3 it survives a full reload, reopen and second editor save;
  P3b it survives an API-side placeholder replacement;
  P4 a real MP4 exports from the reopened draft, and the draft still carries the account afterwards;
  P5 an older draft with no record is saved with none;
  P6/P6b/P6c a 600 KB record and a malformed record are not discarded, the draft reports them, and saving again neither loses nor grows anything;
  P7/P7b after a linked layer is removed the saved account no longer claims it, and no element is invented or dropped;
  P8 after "Start a new project" the next saved draft carries none of the previous draft's records.
- Control without the change: the account is dropped (3 of 3 checks confirm the problem).
- Protected editor-flow regression (`cdp_int_prot`, 32 checks) on the patched build: **32 of 32**. Earlier attempts on the same build were cut short by machine memory exhaustion (a 420 s MP4 download timeout, and page loads slower than the scenario's 20 s wait); the passing run used the same build with longer page waits, and no product assertion ever failed.

## Alternatives considered (unchanged)
Per-layer provenance only (no home for elements without a layer); a backend column or table (schema change, second source of truth); hiding the data in an existing round-tripped key (fragile); modelling the records as typed editor state (larger protected change, no benefit since the editor never uses them); re-deriving on reopen (impossible without the reference's evidence).
