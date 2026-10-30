# Reconstructor M2.4a — transition mapping

Status: implemented and verified locally on `feature/m2-4a-transitions` (base `9c26489`, the deployed M2.2a). Not pushed, not deployed. No protected file is changed.

Goal: reference cut → estimated transition → review → the matching scene join of the draft gets that transition → editor → MP4.

## What it is, and what it is not

The analysis stores, for each detected cut, a short window of **measurements** (how much consecutive sampled frames differ, and how bright they are). It stores no transition name and no effect settings. This path therefore only **estimates** a type from those numbers, for the three signatures they can honestly tell apart, and never claims the original effect was recovered (`claims.originalEffectRecovered` / `originalSettingsRecovered` are typed `false`).

| Signature in the measurements | Estimate | Confidence |
|---|---|---|
| One frame pair changes ≥ 5× the typical pair and carries ≥ 40 % of all change (≥ 10× and ≥ 55 % = high) | Hard cut | high / medium |
| Several consecutive pairs change and none carries ≥ 40 % of the change | Dissolve (duration from the run length) | medium at best — fast motion or a flash looks the same, and it is flagged |
| Brightness dips to dark inside the window and comes back (a flagged black frame makes it high) | Fade through black | high / medium |
| Anything else | Hard cut, **low** confidence, left out by default | low |

Whip pan and zoom punch are **never guessed**; the person can choose them (the editor has exactly these five). Thresholds are a first documented baseline checked against one real boundary plus synthetic profiles — provisional, like the OCR and detector thresholds.

## Mapping onto the draft

A transition is set on a **scene join** (where one scene's footage ends and the next begins). Each measured cut is mapped onto the draft's timeline (fit-to-blueprint-length or the reference's own seconds), then to the nearest blueprint scene join within `max(0.75 s, 4 % of the draft)`, one boundary per join, nearest first. A cut with no join near it changes nothing (scene joins stay hard cuts). At save, the decision is applied to the clip whose end sits on that join (±0.06 s); a decision with no such clip is recorded as unmatched. The last clip is never changed.

Real VA5368: its one cut (39.87 s of the 43.9 s reference) lands at 27.2 s of the 30 s draft and matches the scene 6 → 7 join (0.24 s away). It is a high-confidence hard cut, so that join correctly stays a cut unless the person chooses otherwise.

## Files

New: `frontend/src/pages/deconstructor/transitions/` (`contract`, `evidence`, `classify`, `candidates`, `corrections`, `materialize`, `loadEvidence`, `TransitionsReview`, `TransitionsReviewView`, `index`, tests, `testkit`, a local-only real-data test). Additive edits: `types/index.ts` (optional `ReferenceVideo.transition_evidence`), `footage/assembledDraft.ts`, `footage/FootageAssignment.tsx`, `DeconstructorPage.tsx` (panel only with `?m2=transitions`). No backend change, no endpoint, no migration, no AI call.

## Verification (local; throwaway database; real build and backend)

* `tsc` clean. Frontend suite: 840 passed, 14 skipped (794 before). 46 new tests (engine, classifier profiles incl. the real boundary, mapping, corrections, merge, I/O, render, wiring); with the real VA5368 measurement locally (`M2_REAL_TRANSITION_EVIDENCE`): 3 more.
* Real browser (24 checks): flag gating; the panel on the real measurement (hard cut, high confidence, the real numbers, scene 6 → 7); the person chooses a 1.0 s dissolve; assign footage (grey scenes 1–6, magenta scene 7); save; open in the editor — only the clip ending on the 6 → 7 join is a 1.0 s dissolve and every other join is a hard cut; the saved draft carries the record (1 applied, 0 unmatched, basis `user`, nothing claimed); export.
* **Real MP4:** the join ramps smoothly from grey to magenta (3 % → 97 % in about 0.85 s for a requested 1.0 s), with plain grey before and plain magenta after, and frames well away from the join unchanged. The MP4 is 28.9 s because a dissolve overlaps the two clips by its duration (existing exporter behaviour).

## Remaining gaps

* One real reference with one cut: the classifier is validated on real data only for the hard cut; dissolve and fade signatures are validated on synthetic profiles (no real example exists yet in the analysed data).
* The reference's cuts and the blueprint's scene joins rarely coincide; most draft joins stay cuts. The panel says so.
* Camera motion (zoom/pan) and exported entrance animations need editor/exporter features (protected, separately approved).
* Branch is based on `9c26489`; it touches the same three host files as M2.2a/M2.2b and will need a trivial additive merge with them.
* Not run on Railway.

## Rollback

Revert the commit (no force-push). Old code ignores the extra `transitionReconstruction` field in saved drafts.
