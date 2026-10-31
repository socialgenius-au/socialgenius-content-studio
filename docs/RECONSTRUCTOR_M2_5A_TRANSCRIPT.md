# Reconstructor M2.5a — transcript to script and subtitles

Status: implemented and verified locally on `feature/m2-5a-transcript`. Not pushed, not deployed. **Based on `feature/m2-2b-export-parity`** (local, awaiting review), because subtitles only reach the MP4 through that branch's export mapping. No protected file is changed by this branch.

Goal: reference speech → machine transcript → review → editable subtitles in Video Studio plus a per-scene script to rewrite or record over → save → editor → MP4.

## What it is, and what it is not

The analysis stores a **machine transcript**: a local speech recogniser's segments with times and its own quality diagnostics. It is not a script, its words can be wrong, and it holds nothing of the speaker's voice, music or sound effects. This path therefore:

* shows every segment with when it was heard, the recogniser's rating and language, and the words **as transcribed** (editable);
* flags poorly rated lines (average log-probability < −1.0), possible non-speech (> 60 %), looping text (compression ratio > 2.4), very short and very long lines — the recogniser's own diagnostics, never shown as a probability;
* leaves **every line out by default when the reference is somebody else's** (`unknown_third_party`) and says so; the person includes lines with their own choice ("Include all" / per line). For an owned or licensed reference, ordinary lines are included by default;
* turns the kept lines into native `SubtitleSegment`s in the editor's own default box and ordering convention, each with provenance that keeps the **transcribed words even after rewording**;
* groups the kept lines by blueprint scene (by the middle of each line) into a **script**, using the person's wording, recorded in the draft beside the subtitles;
* never claims the words were verified, the voice recovered or the script original (`claims` typed `false`).

## The exporter's script limit, measured on the real transcript

The VA5368 transcript is in Arabic script (Urdu; the recogniser tagged it `hi`). The exporter has one font (DejaVu Sans) and no right-to-left or complex-text layout (`raqm` and `fribidi` are not available to Pillow). In the real export, 35 of the 328 letters (11 %) — the Urdu letters U+06C1 and U+06D2, which that font lacks — appear as **empty boxes**, and no right-to-left ordering is applied; the same text looks right in the editor. The panel therefore warns on every such line ("the exported subtitle would be wrong"), counts them in the summary, and judges the warning on the wording the person keeps: rewording into a supported script clears it. **Missing backend capability, reported rather than worked around:** a font covering the script plus a complex-layout engine (libraqm). Not added here (new dependency, protected renderer).

## Files

New: `frontend/src/pages/deconstructor/transcript/` (`contract`, `evidence`, `candidates`, `corrections`, `materialize`, `loadEvidence`, `TranscriptReview`, `TranscriptReviewView`, `index`, tests, `testkit`, a local-only real-data test). Additive edits: `types/index.ts` (optional `ReferenceVideo.speech_segments`, optional `SubtitleSegment.reconstruction`), `footage/assembledDraft.ts`, `footage/FootageAssignment.tsx`, `DeconstructorPage.tsx` (panel only with `?m2=transcript`). No backend change, no endpoint, no migration, no speech recognition, no AI call, no new dependency.

## Verification (local; throwaway database; real build and backend)

* `tsc` clean. Frontend suite: 864 passed, 14 skipped (820 on the export-parity base). 44 new tests; with the real VA5368 transcript locally (`M2_REAL_SPEECH_EVIDENCE`): 3 more (15 segments, none included by default for a third party's video, every one flagged for the exporter, "include all" gives 15 subtitles inside the 30 s draft with a script of 2, 3, 3, 4, 2, 1, 0 lines per scene).
* Real browser (25 checks) on the real transcript: flag gating; the panel (15 segments, rights banner, all left out by default, the recogniser's rating and language, the script warning on every line); "Include all"; rewording two lines (shown as the person's own, with a way back, script by scene updated); save; the saved draft holds 15 subtitles with provenance, the two rewordings keep their transcribed words, the record carries the 7-scene script and 13 remaining exporter-script warnings; export.
* **Real MP4:** the person's Latin line is drawn white, centred, at the width the exporter's own font gives; an Arabic-script line is drawn (with the limits above); nothing in the subtitle box where no subtitle is active.

## Remaining gaps

* Script support in the exporter (above). Whisper timing is approximate and subtitle text is not checked against the audio.
* The recogniser's diagnostics are per audio window in this analysis, so every segment in a window shares the same rating.
* Narration (the person's own voice), music and sound effects are not part of this stage (M2.5b+).
* Not run on Railway. Branch dependency on the export-parity branch; touches the same three host files as M2.2a/M2.4a (trivial additive merge).

## Rollback

Revert the commit (no force-push). Old code ignores the extra `speechReconstruction` field and `reconstruction` on subtitles in saved drafts.
