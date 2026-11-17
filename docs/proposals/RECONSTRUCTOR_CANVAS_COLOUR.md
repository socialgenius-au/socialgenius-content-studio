# Reconstructor: use a measured bar colour as the canvas colour (optional)

Branch `feature/m3-reconstructor-canvas-colour` (based on the D1 tip `89b61a5`). Not pushed, not merged.

## What a user can do
In the Background panel (`?m2=background`) a new **Canvas colour (optional)** control lists the distinct colours of the bars measured on the reference's stills (including bars you left out as layers, and any colour you set on a bar). It defaults to "Don't change the canvas colour". Choosing one shows, before anything is applied:
- **What will change:** "When you open this draft, the editor's canvas background colour becomes #xxxxxx" (changeable or resettable in the editor's canvas toolbar).
- **What stays as it is:** the canvas format (platform, placement, size, aspect ratio), your footage, every layer, subtitles and transitions.
The reconstruction manifest lists it ("Canvas background colour #xxxxxx (the canvas format is not changed)", set by you). A bar left included as a layer is still added on top of footage; untick it if you only want the colour behind.

## Rules kept
- Written only when a colour is chosen. A draft saved with no choice is byte-for-byte what it was before (test).
- The draft gets `canvasBackground: "#rrggbb"` and **never a canvas format**. Invalid values are ignored.
- If the chosen colour stops being carried by any bar (you recoloured them), the choice is dropped, not kept silently.

## Exact changes
Non-protected (committed on the branch): `background/canvasColour.ts` (options, change text, `withCanvasColour`), `BackgroundReview.tsx` / `BackgroundReviewView.tsx` (control), `DeconstructorPage.tsx` and `FootageAssignment.tsx` (state and draft signature), `footage/assembledDraft.ts` (writes the key), `manifest/*` (entry). Tests: `canvasColour.test.ts`, one save test in `footageIO.test.ts`.

**Protected (NOT on the branch; needs approval): `CreateEditTab.tsx`, +4 lines** (`protected-patches/canvas-colour-editor.patch`): `DraftProjectSnapshot.canvasBackground?: string`, and in `applyDraftSnapshot`, after the existing `setCanvasFormat(snap.canvasFormat)`, `setCanvasFormat({ ...(snap.canvasFormat ?? canvasFormat), background })` using the already imported `validCanvasBackground`. It only adds the background to the format the editor already has (or just applied); with no `canvasBackground` nothing changes. Until it is applied, the key in a saved draft is simply ignored by the editor.

## Verified (local, real browser, real backend, VA5368 evidence, patch applied in a scratch build)
14 checks: control offered, defaults to no change and says so; measured colour offered; choosing shows what changes / stays; manifest entry; saved draft without choice has no `canvasBackground`/`canvasFormat`; with choice only `canvasBackground` was added (everything else identical); changing one bar keeps the choice while another bar still carries it, and dropping the last carrier drops the choice; a user-set colour can be chosen; in the editor, opening the Reconstructor draft after a LANDSCAPE draft kept the landscape format and ratio and set only the colour (stage shows it); opening a draft without a colour leaves the editor's colour alone. Deconstructor frontend suite 604 pass / 18 skipped; `tsc` clean.

## Limits
One canvas colour per draft (bars of different colours cannot be represented by it). It does not recover or remove anything: the claims all stay false.
