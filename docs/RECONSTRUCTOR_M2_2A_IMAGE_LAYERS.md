# Reconstructor M2.2a — editable image layers from a reference

Status: implemented and verified locally on `feature/m2-2a-image-layers` (base `16bb00b`, the deployed M2.1b). Not pushed, not deployed.

Goal: reference frame → mark where an image stood → put your own picture there → review → editable Video Studio V2 image layer → save draft → editor → MP4.

## What it is, and what it is not

It is a **slot-and-replace** path. The reference is a flattened video: nothing in it is a separate, clean image. So this path never extracts, isolates or removes anything. A *slot* is a rectangle on one sampled reference frame (from the detector, or drawn by the person). What fills the slot is:

1. **The person's own picture** (PNG with transparency, JPG or WebP) — the normal case; or
2. **An opt-in rectangular crop of the reference frame**, only after the person ticks "I have the right to use this part of the reference video". It is a plain 1:1 rectangle with its background included, from a low-resolution still, enlarged to fit. It is labelled as exactly that everywhere.

Every layer carries `claims: { isolated, backgroundRemoved, burnedInContentRemoved, originalResolutionRecovered }`, all `false` (a type that cannot hold `true`).

## Data flow (`frontend/src/pages/deconstructor/imagelayers/`)

| Step | Module | Pure? |
|---|---|---|
| Read frames + detections from the existing response → frozen evidence | `evidence.ts`, `loadEvidence.ts` | yes (one GET) |
| Candidates: one per detection that has a still, one per region the person drew | `candidates.ts` | yes |
| Single-sighting timing, reported as inferred ± half-gap | `timing.ts` | yes |
| Region geometry; largest box of the picture's own proportions inside the region | `geometry.ts` | yes |
| A person's corrections, kept apart from the evidence | `corrections.ts` | yes |
| Approved slots + chosen pictures → `MediaOverlay[]`, record, idempotent merge | `materialize.ts` | yes |
| Validate / decode / crop / upload pictures | `imageFiles.ts` | browser I/O, injectable |
| Panel | `ImageLayersReview.tsx` (container), `ImageLayersReviewView.tsx`, `FramePreview.tsx` | I/O / view |

Changed outside this folder (all additive; with no layers the saved draft is byte-for-byte what it was):

* `types/index.ts` — optional `MediaOverlay.reconstruction` (`ImageReconstructionProvenance`), optional `ShotSummary.visual_objects`.
* `footage/assembledDraft.ts` — optional `imageLayers`, merged after the text layers.
* `footage/FootageAssignment.tsx` — optional `imageLayers` prop (included in the saved-vs-edited signature only when present).
* `DeconstructorPage.tsx` — renders the panel **only** when the address carries `?m2=image-layers`.

No protected editor file is changed (`CreateEditTab`, `ReviewTab`, `StudioContext`, `videoPreviewUtils`, `ffmpeg_svc`, `canvas_render_svc`, the export schema/router are untouched). No backend change, no database migration, no new endpoint, no AI call, no new dependency.

## Rules the code enforces

* **Evidence is immutable**: deep-frozen on read; corrections live in a separate record; tests assert the evidence is unchanged.
* **People are left out by default**, as are detections under 50 % confidence. A person can choose them on purpose.
* **Nothing is uploaded while candidates are shown.** Choosing a picture or drawing a region keeps it in memory. Only "Add images to the draft" uploads, through the existing `POST /upload/`, and only the pictures that are ready. The panel says plainly that unadded images will not be in the saved draft.
* **A crop needs the rights confirmation**, per item. Withdrawing it, or changing the region after cropping, puts the item back to "needs a decision".
* **Timing is inferred.** One sampled frame is a single instant: start/end are the midpoints of the gaps to the neighbouring frames of the same scene (±half-gap shown), minimum 0.5 s, mapped onto the draft timeline. "Show for the whole scene" is offered; every value the person sets is labelled `user`.
* **No stretching.** The layer's box is the largest box with the picture's own aspect ratio that fits inside the marked region, centred in it. The region itself is stored as marked. See "Preview/export parity" below.
* **Idempotent merge**: layer ids are `ri:<analysisId>:<candidateId>`; merging the same plan again adds nothing; a second save updates the same draft.

## Preview / export parity

The editor preview fits an image inside its box (`object-fit: contain`); the exporter scales the picture to exactly the box (`scale=w:h`). They agree only when the box has the picture's own aspect ratio, which is what this path always creates. Measured in the real MP4s (see below): solid edges land on the editor's box within 3 px on all four sides and the exported proportions equal the picture's.

**Where it does not hold:** if a person resizes an image layer in the editor so its box no longer has the picture's proportions, the preview letterboxes while the export stretches. That is existing editor/exporter behaviour for every overlay; fixing it needs a protected-file change (below).

## Verification (local; throwaway local database; real frontend build and backend)

* TypeScript clean; production build OK.
* Frontend suite: 794 passed + 11 skipped (the skipped ones are the local-only real-evidence tests). 95 new.
* Backend: 14 draft-compatibility tests pass (7 new); export/render suites 79 passed + 1 known failure that is identical on `16bb00b` (`test_timeline_render.py::test_render_project_single_clip_with_text_and_audio`, `KeyError: 'start_time'`).
* Real VA5368 evidence (local only; `M2_REAL_VISUAL_EVIDENCE`): 9 sampled stills (480×864), 9 detections, **all `person`** — no logo, product or graphic was detected — all left out by default; no persistent visual elements.
* Real browser (headless Chrome, 80 checks): flag gating; panel on the real evidence; drawing regions by dragging on real frames; uploads only on "Add"; transparent PNG; opt-in crop with rights gate; save → open in Video Studio V2; provenance in the editor and on the server; drag in the editor keeps provenance; delete removes exactly one layer; reload keeps the rest; placeholders still block export.
* Real MP4 (1080×1920, 29.7 s): per layer — solid edge on the editor's box (±3 px), proportions equal the picture's, transparent centre shows the video, half-transparent disc blends with the video, absent 0.5 s before start and after end; later-listed layer drawn on top where two layers' edges cross; the exported crop's colour matches that region of the reference frame (drawn 2.23× enlarged: soft, as warned).
* Regression in the real browser on this build: M1 Stage 3 34/34, M2.1a 42/42, M2.1b 37/37.

## Known limits

* A detector box is only a labelled rectangle from a general COCO detector. It does not find logos; for VA5368 the useful path is "draw where it stood, upload yours".
* Reference stills are 480×864 and about five seconds apart.
* No rotation, crop, flip, opacity control or mask for image layers in the editor.
* Export draws image layers beneath text (observed in the MP4: a text chip covers the top of a layer that sits under it) and beneath shapes/lower thirds; shapes and lower thirds are not in the export request at all today.
* The editor draws a 1 px dashed frame and a translucent backdrop around overlays in the preview only; they are not exported.
* Animated GIFs are refused (they would export as a single frame).

## Protected-file dependencies (none applied; separate approval needed)

1. **Contain-fit in the exporter** (`ffmpeg_svc.composite_media_overlays`, and `add_media_overlays` for symmetry): replace `scale={w}:{h}` with `scale={w}:{h}:force_original_aspect_ratio=decrease,format=rgba,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x00000000` so a resized overlay is letterboxed transparently like the preview. Proposed, untested.
2. **Shapes / lower thirds / inserts / subtitles export** (`ReviewTab`): not sent today; a narrow mapper like the M2.1b one.
3. **Rotation, crop, opacity control** (`CreateEditTab`, `StudioContext`).

## Rollback

All changes are additive and behind `?m2=image-layers`. Revert the commit (no force-push) to return to `16bb00b`. Older code ignores the extra `reconstruction` / `imageReconstruction` fields in saved drafts. Pictures already uploaded stay in the person's library until they delete them.
