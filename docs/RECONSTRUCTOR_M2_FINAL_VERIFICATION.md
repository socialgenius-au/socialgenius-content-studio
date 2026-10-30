# M2 fast-track: final verification record

Branch `integration/m2-fast-track-final` = the pushed checkpoint `6d5366b` + the timeline fix (`56f3a79`) + M2.3a–c,f (`0d1954d`, merged `5d31a56`) + combinable preview flags (`ee36481`) + Arabic/Urdu runtime findings (`9496019`) + the M2.3 reload fix and its regression tests (`b02235f`) + the clip-gap fix (`4311478`). **Local only: not pushed, not deployed.** `preview/unified-v1` is still `9c26489`; `main` is `a0398b0`.

## Protected files changed since the pushed checkpoint

Only `backend/app/services/ffmpeg_svc.py` (join graph built from the new pure `timeline_plan.py`; layer windows end-exclusive). No Dockerfile, dependency, Railway, migration or environment file. Against the deployed `9c26489` the protected set is that file plus the four approved earlier ones (`video_export.py`, `ReviewTab.tsx`, `CreateEditTab.tsx`, `VideoStudioV2.css`).

## Results on the final build

| Check | Result |
|---|---|
| TypeScript | clean |
| Frontend suite | **964 passed**, 18 skipped (local-only real-data tests) |
| Production build | OK |
| Backend export / render / draft-compat / timeline / plate tests | **100 passed**, 1 failed: `test_timeline_render.py::test_render_project_single_clip_with_text_and_audio` (`KeyError: 'start_time'`), identical on the deployed commit |
| Browser: M1 Stage 3 | **34/34** |
| Browser: M2.1a text | **42/42** |
| Browser: M2.1b fidelity | **37/37** |
| Browser: M2.2a images | **80/80** |
| Browser: M2.2b export parity | **63/63** |
| Browser: M2.4a transitions | **24/24** (old-overlap expectations updated to the timeline contract) |
| Browser: M2.5a transcript | **25/25** |
| Browser: M2.3 background (new) | **35/35** |
| Integrated MP4 export, portrait 1080×1920 and landscape 1920×1080 | **78/78** |

## Real MP4 results

* **Timeline fix** (synthetic clips with frame-index barcodes, real `render_project`): every scenario exports at the exact timeline length with 0 ms footage offset; layers start and end on their frames; tones align. See `RECONSTRUCTOR_M2_TIMELINE_SYNC.md`.
* **Integrated scenario** (two clips with a 1.0 s dissolve, voice-over, four pictures, five shapes, text, lower third, two subtitles, B-roll insert): the dissolve is measured at 6.05–6.95 s around the join at 6.00 s (it was 5.0–6.0 s with everything after it 1.0 s early); portrait and landscape files are 11.87 s for a 12 s timeline (see remaining defect 2).
* **M2.3 plates**: five plates saved with footage reassigned mid-review, reopened through My Drafts → Open, shown on the editor canvas, exported; each plate's pixels were read from the MP4 in its bar across the full width, in the colour on the layer (one the person chose), the middle of the picture is footage, and a plate is gone one window after its scene.
* Export validation is unchanged: the blueprint's placeholder texts were replaced with real text in the saved draft, not bypassed.

## M2.3 reload bug

Cause: the panel's load effect depended on the whole plan object. Assigning footage re-renders the page with a rebuilt plan (same ids), which reloaded the stills, reset the review and handed the save a null plan, so no plates were saved. Fix: the effect depends on `evidenceKey(plan)` (reference id + analysis id). Coverage: key stability and difference; the reset lives only inside the keyed effect; evidence loaded per reference (own ids, colours; a stale analysis refused; unreadable stills counted); identical plan signature across a rebuilt plan; assign / reassign / save / re-save through `saveAssembledDraft`; real-ffmpeg export of banners, side rectangles, exact window and stacking; and the browser check (reassign keeps the plates, colour and exclusion and does not re-read the stills; save; reopen; export). This project has no DOM component-test library, so the container is covered through the pure key and the browser check; adding jsdom / testing-library needs approval. Switching to a genuinely different blueprint cannot be driven in the browser here without a paid AI call, so that is covered at the evidence-loading level.

## Remaining defects

1. **A gap between clips is collapsed** by the exporter (as before; the M1 “gap” option leaves gaps). Layers laid at absolute times after a gap are early against the footage. Preserving the gap as black is a behaviour change that needs a decision.
2. The integrated export is about 0.13 s shorter than the timeline (same loss as on the old exporter, on top of its overlap); cause not isolated.
3. A clip at 2× shows its source about two source frames early (−67 ms): identical on the old exporter, from the speed filter.
4. The editor's own localStorage restore does not keep shapes, lower thirds, subtitles or inserts, so a reload before saving drops them (saved drafts are fine). Pre-existing, protected.
5. A dissolve with no spare source frames is shortened or becomes a hard cut; `hold_incoming` (off) would keep it at full length by repeating the incoming clip's first frame.
6. Editor vs export differences, unchanged: the editor's “Fade” fades a clip at both its start and end and has no dissolve preview; the exporter's `dissolve` is ffmpeg's pixel-wise blend.
7. Arabic/Urdu subtitles: production already lays out with Raqm; two letters are missing from the bundled font (about 11 % of the real transcript). Needs a font, not a Dockerfile change. Warnings are preserved.
8. M2.3 rebuilds only flat bars it measured (on the real VA5368 stills: 20 of 22 have none, two show an 18.9 % near-black top band). Plates sit above the footage. M2.3d/e (canvas background colour, blurred backdrop) remain proposals.
9. Nothing has run on Railway.

## Readiness

Code-ready for review. Before any preview update: approve pushing the three local branches (or only the final one), run one portrait and one landscape export on a Railway preview branch, and decide the items above (gap handling, `hold_incoming`, Arabic/Urdu font).
