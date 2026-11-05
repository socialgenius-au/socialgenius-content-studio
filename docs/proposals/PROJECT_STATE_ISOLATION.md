# Blueprint-to-editor state: investigation, what is fixed, and one protected patch awaiting approval

Reported during the hosted browser test of reference 5127: the seven-scene, 30-second blueprint opens in Video Studio and its first placeholder is editable, but the canvas still shows the ABC Tiles design (headline, icons, showroom call to action). Question: is the hand-off retaining unrelated editor state, templates, background elements or branding?

## Findings (real browser, the deployed commit's code, an existing project opened first)
Scenario: an existing project X (1:1 canvas, green background, 77 px magenta subtitle style, one library asset, one dragged canvas item, one footage clip, one shape) is opened; reference 5127 is then handed over with "Use blueprint"; X is reopened; the reconstruction is reopened and saved.

| # | Finding | Cause | Status |
|---|---|---|---|
| 1 | The new reconstruction shows the **ABC Tiles demo canvas** (logo, headline, badge, icons, CTA). | Not inherited data. When no footage clip is at the playhead the editor draws a **hard-coded prototype mock** (`ph-logo`, `ph-headline`, `ph-badge`, `ph-icons`, `ph-cta` in `CreateEditTab.tsx`, the `hasRealSrc` false branch). A blueprint draft has placeholders but no footage yet, so it always lands on it. | **Fixed** in this commit, outside protected files. |
| 2 | The hand-off itself is clean. Arriving from the Deconstructor, the reconstruction has 0 clips, 8 text placeholders (7 scenes, 30 s), no shapes, an empty library, default canvas and subtitle style, no positions. The existing draft X is byte-identical before and after. | n/a | Verified, no change needed. |
| 3 | **Switching drafts inside one editor session** (My Drafts, Open) leaks the previous project's **canvas format and background, subtitle style, media library and dragged canvas positions** into a draft that does not define them (blueprint and Reconstructor drafts define none of these), and the next save **writes the leaked values into that draft**. Saved drafts are never altered by the switch itself (X stayed identical). | `applyDraftSnapshot` (protected) only SETS what a snapshot contains: canvas format and subtitle style only `if (snap.x)`, media assets only ADDED, positions only SET. The note on `clearLiveProject` assumes every draft carries them; drafts made by the Reconstructor do not (and must not: a test pins "never a canvas format", and the assembled-draft fixture is shared with the backend). | **Proposed patch below (protected file: needs your approval).** |

## Fixed now (non-protected, committed)
- `blueprint/BlueprintPlanPanel.tsx` (the shell's blueprint panel) sets `data-sg-blueprint-draft` on `<html>` only while a blueprint plan is active and clears it afterwards; `blueprint/blueprintCanvas.css` then hides **only** those five demo elements, only inside the no-footage preview. Footage, text layers, shapes and every other project are untouched; a project that is not a blueprint draft behaves exactly as before.
- `blueprint/projectDefaults.ts`: the editor's own starting canvas format and subtitle style, mirrored with a test that fails if `StudioContext` ever changes them (StudioContext is protected, so it cannot export them).
- Snapshot contracts are deliberately **unchanged**.

## The protected patch (exact diff: `docs/proposals/protected-patches/project-state-isolation.patch`; verified on `scratch/clean-project-state`)
Opening a draft starts from a clean project state. `CreateEditTab.tsx` `applyDraftSnapshot` + `StudioContext.tsx` (+5 and 1 changed, one new reset action):
1. subtitle style: `setSubtitleStyle(snap.subtitleStyle ?? default)` (was: only if present);
2. canvas format: `setCanvasFormat(snap.canvasFormat ?? default)`, and the Reconstructor canvas colour is applied on that default rather than on the previous project's format;
3. media library: assets not in the snapshot are removed (`removeMediaAsset`, already provided);
4. canvas positions: `resetCanvasItemPositions()` (new 1-line action in the context) before the snapshot's positions are set.

Impact: a draft that carries these settings opens exactly as before. Only a draft that omits them changes, and only toward the editor's defaults instead of the previous project's values. "New project" (`handleNewDraft`) is untouched and still keeps the current canvas format on purpose. No playback, timeline, layer, export or save logic changes.

## Evidence
- Before (deployed commit, real browser): the in-session switch left the previous project's canvas, background, subtitle style, library asset and position in the reopened reconstruction and in its next save (4 settings checks + the save check failed).
- With the in-boundary fix only: demo canvas hidden after the hand-off and on reopen; the 4 settings checks still fail (they need the patch).
- With the patch on the scratch branch: all behavioural checks pass (hand-off clean, X byte-identical, switch back to X shows only X, reopened reconstruction clean, save contains only its own content).
- Regression on the patched build: see the report (persistence, Reconstructor flow, protected editor flow).

## Decision requested
Approve the patch for the development branch (acceptance only) or tell me what to change. Nothing protected has been modified on any shared branch.
