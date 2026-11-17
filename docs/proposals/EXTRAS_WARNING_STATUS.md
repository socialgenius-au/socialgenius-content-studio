# Proposal: show the preserved-record warning in the editor's status line (PENDING APPROVAL, protected file)

Why: invalid or oversized reconstruction records are kept without loss and reported in the draft (`extrasPreservation`) and the console. "Warnings must be visible and actionable" needs a place a person actually looks. The editor already shows a status line after Save and Open (`draftStatus`); the only protected change needed is to append one sentence to those two messages. The sentence is built by the non-protected, tested `extrasNote()` in `video-studio-v2/export/draftExtras.ts` (already committed) and is empty when nothing is unusual, so every ordinary save and open shows exactly what it shows today.

Exact change to `frontend/src/pages/video-studio-v2/components/CreateEditTab.tsx` (3 lines):
```
-import { draftExtrasForSave, emptyExtras, pickDraftExtras, type DraftExtras } from "../export/draftExtras";
+import { draftExtrasForSave, emptyExtras, extrasNote, pickDraftExtras, type DraftExtras } from "../export/draftExtras";
...
-      setDraftStatus(`Saved "${name}"`);
+      setDraftStatus(`Saved "${name}"${extrasNote(draftExtrasRef.current)}`);
...
-      setDraftStatus(`Opened "${full.name}"`);
+      setDraftStatus(`Opened "${full.name}"${extrasNote(draftExtrasRef.current)}`);
```
Example shown to the person: `Opened "My draft" — note: 1 saved reconstruction record is not valid and was kept unchanged but not used (your layers are unaffected; rebuild the draft from the Reconstructor to refresh it).`

Impact: text only; no layout, state, playback, layer or export change. On open, `applyDraftSnapshot` has already filled `draftExtrasRef` before the status line is set (it runs earlier in `handleOpenDraft`). Risk: none beyond a longer status string.
