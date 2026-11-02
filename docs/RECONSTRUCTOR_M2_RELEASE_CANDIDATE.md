# Reconstructor M2: release candidate for authenticated testing

**Not deployed.** Railway stays at `fdfca26` (the accepted checkpoint) until a release is approved. `main` is untouched.
Branch: `integration/m2-fast-track-2` (code identical from `6aaefd0`; later commits add documents only). Base: `fdfca26`. `main` has since gained one CSS-only commit (`09e1482`); a trial merge is conflict-free and the integrated flow passes on a build that includes it.

## What this candidate adds to `fdfca26`
All of it sits behind the `?m2=` preview flags: with no flag the Deconstructor page is exactly as at `fdfca26`. Use `…/deconstructor/<reference id>?m2=all` (or a comma list: `text-layers,image-layers,transitions,transcript,background,manifest`).

| Area | What a user can now do |
|---|---|
| Background | See which background bars would cover their own footage (measured from the clip's real size and Fit/Fill) and have those left out by default; change a bar's size (marked "set by you"); a smooth gradient along an edge is rebuilt as two flat steps; see every generated layer per scene |
| Subtitles | Choose Top / Middle / Bottom, a text size and a maximum line length; Arabic-script lines carry an accurate note (drawn in Noto Naskh Arabic, not Nastaliq) instead of a false failure warning |
| Transitions | White flash / fade through white noticed and offered as the nearest cut or dissolve, with a plain statement that the white is not recreated; whip pan / zoom punch offered as an estimate from stored motion measurements, never pre-selected |
| Manifest | One read-only list of everything that will be written to the draft, by scene, with how each element was found and what is not recovered |
| Export (already at `fdfca26`, re-verified) | Layers, audio and timing exported to the frame; Urdu subtitles drawn correctly |

## Demonstrated, and with what
**With real reference data (the VA5368 reference imported into the local test database):** reading its real stills and measuring its real flat bars (about 12 % of the height, one colour); its real 15-segment Urdu transcript becoming subtitles with the chosen position, size and line breaks, and exporting into a real MP4 with Urdu drawn in the top band; its OCR text layers; its one real hard cut classified as a hard cut at high confidence.
**With synthetic inputs (constructed, not real reference footage):** the user's footage in the flows (a generated test clip); all gradient bars (synthetic pixels, plus a real MP4 of the two steps); white flashes and fades; whip pan and zoom punch (invented profiles, and real measuring code run on two constructed clips); the `hold_incoming` behaviour (barcoded clips); everything in the C2 canvas colour check. No real reference with a gradient, a white flash, a whip pan or a zoom punch was available.
**Real MP4 checks on this candidate:** edited bar colour at the right place and across the full width; footage visible in the middle; subtitles in the band the edited draft chose; a dissolve carried in the export request; saved draft reopened with its layers and unchanged; Urdu subtitle at the top.
**Still needing user acceptance (authenticated, hosted):** every item in the checklist below. None of the hosted, logged-in paths has been run by me.

## Checks run on the final code
| Check | Result |
|---|---|
| TypeScript | clean |
| Frontend suite (vitest) | 1027 passed, 18 skipped (need local reference data) |
| Browser: background plates, save, reopen, export (41 checks) | 41 pass |
| Browser: subtitle position/size/breaks, manifest, export frame (19 checks) | 19 pass |
| Browser: integrated flow — bars + subtitles + dissolve + stacking order, save, reopen, edit the stored draft, export and read the MP4 (22 checks) | 22 pass |
| Backend: whole suite (1,767 tests, local Postgres) | 1,756 passed, 2 skipped, **9 failed**. The same 9 fail identically on `fdfca26`, so this candidate adds no failure: 8 are `test_semantic_boundary_assembly_svc` `test_real_rv…` tests (named for real references RV5127/RV146, not in the local database) and 1 is `test_timeline_render::test_render_project_single_clip_with_text_and_audio` (a text overlay in its fixture has no `start_time`). Their causes were not investigated further. |
| Backend: export accuracy, timeline, edge policy, Arabic/Urdu, subtitle line breaks | all pass (included in the above) |

The browser scripts are scratch harnesses, not part of the repository.

## Checklist for Mr. Ayub (hosted, logged in)
1. Open a reference, go to Create with `?m2=all`; confirm the old page without a flag is unchanged.
2. Background panel: bars appear; assign footage that covers a bar and confirm the warning and the "left out by default" state; change a bar's size and colour; use Recommended stacking.
3. Transcript panel: include lines, pick Top/Middle/Bottom, a size and a line length; read the Arabic-script note on an Urdu reference.
4. Transitions panel: look at the estimates; include one yourself, change its type.
5. Manifest: counts match what you approved; "what is not recovered" reads honestly.
6. Save the draft, reopen it from My Drafts, check the layers, edit something, export, and play the MP4.
7. Note anything that looks different between the editor and the MP4.

## Known limitations
- Bars are drawn **above** footage; only the reach check and the default-off keep them from covering it. The clean fix (canvas colour, C2) is presented but not applied.
- Whip pan and zoom punch thresholds are provisional; real-footage accuracy is unknown. The export always uses the editor's own effect, not the measured direction.
- The editor shows a Reconstructor dissolve / whip pan / zoom punch as "None" in its Transition selector and cannot preview dissolves (D3, D1 presented/pending). The export is correct.
- Editor fade preview differs from the export's (D2 presented, pending).
- A dissolve at a join where a clip has no spare footage is shortened or becomes a cut by default; the opt-in fix (C1) is presented, not applied.
- Arabic script is Naskh only; Hebrew, Indic, Thai and CJK subtitles still export wrongly (warned).
- Audio streams are about 5 ms longer than video; ±1 source frame at non-integer speeds; odd-offset layers can sit up to 1 px high/left. Unchanged from `fdfca26`.
- The draft does not remember a transcript layout choice other than by the subtitles it wrote.

## Decisions still needed before release
1. Apply the protected-file patches (`docs/proposals/protected-patches/`): **D3** (approved as a narrow correction, diff to review), **C1** (approved in principle, diff to review), **C2** (approved in principle, diff to review), **D2** (pending).
2. D1 dissolve preview direction, C3 blurred backdrop (design only).
3. Whether to include any of those patches in the candidate that goes to Railway, or ship this candidate as is and the patches afterwards.
4. Deployment itself: fast-forward `preview/unified-v1` from `fdfca26` to the approved commit; rollback is a non-force revert commit.
