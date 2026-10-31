# Reconstructor M2 integration record

Branch `integration/m2-fast-track`, based on the deployed M2.2a commit `9c26489`. **Not pushed, not deployed.** Integrates, in dependency order: M2.2b export parity (`feature/m2-2b-export-parity`), M2.4a transitions (`feature/m2-4a-transitions`), M2.5a transcript (`feature/m2-5a-transcript`), then the approved subtitle preview correction.

## Contents

| Step | What |
|---|---|
| M2.2b | patches 01–03 (contain-fit and cross-type stacking; shapes and lower thirds in the export; shape border/radius preview scale), lower-third box-relative preview, subtitle + V2 insert export mappings |
| M2.4a | transition mapping (`?m2=transitions`) |
| M2.5a | transcript → subtitles and per-scene script (`?m2=transcript`) |
| merge | the four optional wiring points (page flags, footage panel props/signature, draft save, evidence types) keep both sides; chain `mergeSpeech(mergeTransitions(mergeImageLayers(mergeTextLayers(…))))`; an integration test proves the four families coexist in one draft |
| subtitle preview | font size, outline, shadow blur, padding and corner radius drawn at the canvas's displayed scale (`CreateEditTab`, +7/−3) |

## Protected files changed (vs `9c26489`), all approved

`backend/app/services/ffmpeg_svc.py`, `backend/app/routers/video_export.py`, `frontend/src/pages/video-studio-v2/components/ReviewTab.tsx`, `…/CreateEditTab.tsx`, `frontend/src/pages/video-studio-v2/VideoStudioV2.css`. No dependency, Dockerfile, Railway, migration or environment file changed. `StudioContext`, `videoPreviewUtils`, `canvas_render_svc`, `exportGuard` untouched.

## Verification (local; throwaway database; real production build and backend)

* TypeScript clean; production build OK; frontend **921 passed**, 17 skipped (the local-only real-data tests).
* Backend render/export/draft-compatibility: **90 passed**, plus 1 known failure identical on the deployed commit (`test_timeline_render.py::test_render_project_single_clip_with_text_and_audio`, `KeyError: 'start_time'`).
* Real-browser suites on the integrated build: M1 Stage 3 **34/34**, M2.1a **42/42**, M2.1b **37/37**, M2.2a **80/80**, M2.2b **63/63**, M2.4a **24/24**, M2.5a **25/25**.
* **Integrated real-MP4 export, 78/78 checks, portrait 1080×1920 and landscape 1920×1080:** two clips joined by a 1.0 s dissolve (440 Hz / 880 Hz tones), an A1 voice-over (220 Hz), four pictures (fit, transparency, order), five shapes, a lower third, two subtitles (one with a per-segment override) and a B-roll insert; saved through the real drafts API and opened with *My Drafts → Open*. Checked: image fit and transparency, shape geometry, stacking in all three directions, lower-third text size, subtitle chip and words, insert, timing in and out, the dissolve ramp, the audio of each clip and the voice-over, and the export's size and duration.
* **Subtitle preview scale:** across every canvas the editor offers × four viewport/zoom levels (124 combinations of the integrated scenario), the preview font is 36 canvas px at the displayed scale (within 0.7 px) and the padding follows.

## Remaining defects (reported, not hidden)

1. **A clip join shortens the exported timeline.** `concat_segments_with_transitions` overlaps clips by the transition's duration (0.05 s for a hard cut). Measured: with a 1.0 s dissolve the footage after the join arrives **1.0 s earlier** than the editor's timeline puts it (blend 5.05–5.90 s in the MP4, join at 6.00 s on the timeline; the file is 10.9 s for a 12 s timeline). Layers, subtitles and the A1 voice-over sit at absolute timeline times, so after a dissolve they run about one second **late** relative to the footage; across a draft of hard cuts up to 0.05 s per join accumulates (VA5368: 6 joins, 0.3 s). Pre-existing exporter behaviour that the transition mapping (M2.4a) makes visible. A proposed fix (hold the outgoing clip's last frame for the transition's length and start the blend at the join, so the timeline length is preserved) is in the report; it is a protected-file change and is **not applied**.
2. Arabic/Urdu (and other complex-script) subtitles export in the wrong direction with empty boxes for letters the font lacks; the panel warns. Proposal: `docs/proposals/arabic-urdu-export/PROPOSAL.md`.
3. The subtitle outline is bolder in the MP4 than in the editor (exporter draws it outward); no font family is exported; lower-third typeface differs; text and lower-third animations and B-roll speed are not exported; B-roll with its own audio set to "keep" was not exercised.
4. The editor's preview of a dissolve does not exist (the preview switches clips at the join).
5. Not run on Railway.

## Rollback

Revert the integration commits (no force-push) to return to `9c26489`, or revert any single family's merge/commit: each is additive and flag-gated.
