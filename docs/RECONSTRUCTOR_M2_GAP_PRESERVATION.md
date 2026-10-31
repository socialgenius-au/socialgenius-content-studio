# Preserving explicit clip gaps in the export

Branch `feature/m2-gap-preservation` (from the released `d46bfa8`). **Local only, not pushed, not deployed: needs review.** Touches the protected `backend/app/services/ffmpeg_svc.py` (as approved for this fix) and the pure `timeline_plan.py`.

## What changed

The exporter used to collapse a gap between V1 clips (the M1 draft's “gap” option leaves them), so everything after a gap arrived early against layers, subtitles and A1 audio laid at absolute times, and the file was shorter than the editor's timeline. Now:

* `timeline_plan.split_runs` groups the clips into contiguous runs; a new run starts where the next clip begins at least one whole frame after the previous one ends (a sub-frame difference or an overlap is not a gap).
* Each run is rendered by the existing, verified logic (moved unchanged into `_render_clip_run`); a project **without** a gap is one run and takes exactly the old path.
* Runs are joined by `concat_runs_with_gaps`: black video and silence of the exact gap length (a leading gap before the first clip too), every part forced to its exact frame and sample count. Nothing after a gap moves.
* Transitions work inside a run as before. A transition cannot reach across a gap (the neighbour is black): the join is a hard cut.

## Tests (real ffmpeg, barcoded synthetic clips)

`tests/test_timeline_gaps.py`, 6 tests: run splitting; graph exactness; a 1 s gap exports as 150 frames for a 5 s timeline with the gap frames black and silent, B's footage at its own 3.0 s (0 offset), a layer laid at 3.5–4.5 s on exactly frames 105–134, B's tone starting at 3.0 s, A's tone absent in the gap, and an A1 track playing straight through at its absolute times; a leading gap; a dissolve inside a run next to a gap; a gap-free project unchanged. All other backend export suites: 106 passed, plus the one known pre-existing failure.

## Needs review: an approved expectation changes

The M1 Stage 3 browser suite has a check that encodes the old behaviour, “the gap is collapsed, so it is shorter than 14 s”. With this fix that export is the full length. That check must be updated when this is accepted. Not deployed.
