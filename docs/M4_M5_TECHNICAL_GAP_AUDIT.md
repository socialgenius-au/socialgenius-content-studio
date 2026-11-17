# M4 / M5 technical gap audit

Baseline: `integration/m3-rc1` at `fc13e4b` (remote verified). Written from the code in the M4 worktree (`socialgenius-content-studio-m4`), not from memory of earlier reports.
How to read "verified": **E2E** = exercised end to end in a real browser against the real local backend and the real VA5368 evidence (local only); **UNIT** = unit or render tests only; **READ** = I read the code and its docstring this session but did not execute it; **HOSTED** = nothing in this audit is verified on Railway by me (Ayub owns hosted acceptance).

Repository facts used throughout
- Backend: FastAPI + SQLAlchemy async, `backend/app`. Frontend: React + Vite, `frontend/src`. No database migrations are introduced here: `create_all` plus `schema_patches.py` at startup.
- Evidence vocabulary (backend, `models/certainty.py`): `OBSERVED, MEASURED, INFERRED, RESEARCH_SUPPORTED, RECOMMENDED`, stored as `certainty` on Scene, Shot, TextElement, VisualObject, AnalysisAnnotation, StrategicInsight, with an optional 0–1 `confidence_score`. The frontend reconstruction layer has its own lower-case vocabulary on every layer property: `measured | inferred | user | default` (`pages/deconstructor/textlayers/contract.ts`, re-exported by every panel). M4 must map between the two; it must not invent a third.
- Protected files (actual paths): `frontend/src/pages/video-studio-v2/components/CreateEditTab.tsx`, `frontend/src/contexts/StudioContext.tsx`, `frontend/src/types/index.ts`, `frontend/src/pages/video-studio-v2/VideoStudioV2.css`, `frontend/src/components/studio/videoPreviewUtils.ts`.
- Local `main` and local `preview/unified-v1` are stale (`a0398b0`, `40b6458`); the remote tips are `09e1482` and `fdfca26` as stated. Nothing here touches them. The session's own checkout (`integration/visual-editor-v1-ux-correction`) has unrelated uncommitted work and was left alone.

## 1. Reference-video ingestion
- **Status:** implemented. `POST /reference-videos/` ingests an uploaded asset (`routers/reference_videos.py` line ~758); technical details are probed with ffmpeg. READ + E2E (VA5368 was ingested and analysed on the preview earlier; the local copy is an imported package).
- **Reusable:** `referenceVideosApi.ingest/get/list` (`api/client.ts`).
- **Required:** nothing for M4/M5.
- **Dependencies / tests / approvals:** none new.

## 2. Scene, shot and frame analysis
- **Status:** implemented. Stage 4 shot detection (`analyze-structure`), Stage 5 frame sampling (`analyze-frames`, about one still per few seconds: 9 stills for the 43 s VA5368), scene construction (`scene_construction_svc.py`, semantic). READ; E2E only through the stored VA5368 data.
- **Gap:** stills are sparse (about 5 s apart), so any per-object timing is a guess between samples. Already encoded as `estimateFrameTiming` (`imagelayers/timing.ts`).
- **Required:** M4 timing must keep that uncertainty explicit and never present a visibility interval as observed continuity.

## 3. OCR extraction and grouping
- **Status:** implemented and used. `ocr_svc.py`: EasyOCR (local, no paid service), `group_occurrences` (same frame IoU ≥ 0.85; cross-frame IoU ≥ 0.5, text similarity ≥ 0.5, gap ≤ 5 s) and `link_recurring_elements` (text similarity ≥ 0.85, position IoU ≥ 0.5 **or** size similarity ≥ 0.7). Output: `TextElement` occurrence groups with `observations[]`; `RecurringElement` annotations (`certainty INFERRED`, `produced_by_pass recurring_text_linkage_v1`). UNIT (backend) + E2E (frontend consumption on VA5368).
- **Observed on real data (VA5368):** 31 text groups; 2 recurring elements: a creator handle that OCR reads as `GTANUCREATES_O / GTANUCREATESO / GTANUGREATES_O / @TANUCREATES_0` at three fixed spots over 3–43 s, and the caption word "Aap" sliding along one text line over 6–25 s.
- **Gap:** recurring linkage accepts size similarity **or** position agreement, so a caption word that slides along a line is linked as "recurring". It carries no class (handle / caption / subtitle). OCR confidence is a raw engine score.
- **Reusable:** `readTextEvidence` (`textlayers/evidence.ts`), `buildTextCandidates`.
- **Required:** a classifier over this evidence (M4.1). No backend change needed.

## 4. Text-element detection → editable text
- **Status:** implemented and verified E2E (M2.1a, M2.1b): OCR groups become native `TextOverlay` layers with provenance, time mapping, duplicates and placeholder conflicts handled (`textlayers/materialize.ts`), exported to MP4 with style parity (`export/textOverlayExport.ts`).
- **Gap:** colours and font size are heuristics from still pixels (`appearance.ts`); font family is never claimed. Lines are grouped by OCR group, not by paragraph. No rotation (editor type has none).
- **Reusable:** all of it.

## 5. Visual-object detection
- **Status:** implemented but narrow. `visual_object_svc.py` runs a local torchvision COCO detector; it writes only `category person` or the neutral `object` (the DB CHECK also allows `product, logo, background, prop`, which no code path ever writes). Per-frame boxes with a label, class id and score; transform columns (rotation, scale, opacity) are defaults, not measurements (documented in the model).
- **Observed on real data:** 9 detections, all `person`; 0 logos, products or graphics. A general object detector is not a logo finder.
- **Required:** M4 must not claim graphical identity from this. A grounded graphical class needs either detector evidence that actually says so (none today) or a user correction.

## 6. Recurring-element classification and image-slot inference
- **Status:** implemented in two layers. (a) Backend: recurring text linkage (above) and `visual_persistence_svc.py` (same-shot, near-static persistence of detector boxes: IoU ≥ 0.80, height similarity ≥ 0.85, stored as `persistent_visual_element` annotations and returned per shot as `persistent_visual_elements`). (b) Frontend M3: inferred image slots from recurring elements (`imagelayers/evidence.ts` + `candidates.ts`) and the classifier on branch `feature/m3-image-slot-classification` (`b3659a5`, `imagelayers/recurring.ts`): probable mark / unclear / caption-like with reasons, calibrated on VA5368. UNIT + E2E (browser 13/13 on the real evidence).
- **Gap 1:** the frontend type `ShotSummary` (`types/index.ts`) does not declare `persistent_visual_elements`, so the API's persistence evidence is never read by any panel. It is present in the response. (`types/index.ts` is protected: M4 reads it through its own module-local type instead.)
- **Gap 2:** the M3 classifier outputs three coarse kinds for recurring text only. It does not separate handle from caption from subtitle, and it has no notion of graphical classes. Its thresholds were fitted to one reference.
- **Compatibility check of the classifier branch:** it depends on `RecurringMarkEvidence.sightings` added in the same branch and on `ImageCandidate.classification`. Reusing the logic in M4 means porting `looksLikeHandle`, `looksLikeWords`, `distinctSpots` and the score weights into a new module with a wider output (M4.1), not merging the branch.

## 7. Evidence and confidence tracking
- **Status:** implemented. Backend `certainty` + `confidence_score` on every analytical row; frontend `Prop<T>{value,basis,confidence?,note?}` on every layer property, `claims` objects whose values are all `false`.
- **Gap:** no single object ties one visual element's class, confidence, evidence list and readiness together; evidence is spread over text groups, recurring elements, detections and persistent elements.
- **Required:** the M4 `VisualElement` contract (new, versioned).

## 8. Blueprint generation
- **Status:** implemented, **paid AI path**: `reconstruction_blueprint_svc.py`, `content_anatomy_svc.py`, `transferable_mechanism_svc.py` and reasoners under `services/*_reasoner`. Anatomy is deterministic; mechanisms and blueprint call a provider. Not touched by M4/M5. On the acceptance environments no provider key exists, so blueprints come from stored data.
- **Required:** nothing; M4/M5 consume the stored evidence and the stored blueprint plan only.

## 9. Reconstructor assembly engine, footage assignment, draft persistence
- **Status:** implemented and verified E2E locally: `assembly/assembleDraft.ts`, `footage/*`, `footage/assembledDraft.ts` (`saveAssembledDraft` composes `withCanvasColour(applyComposition(mergeBackground(mergeSpeech(mergeTransitions(mergeImageLayers(mergeTextLayers(snapshot))))))`) and PUTs/POSTs through the existing `video-studio-drafts` API (`models/video_studio_draft.py`: `project_json` JSON column; no schema change ever needed for new keys). Integrated scenario 32/32 on `fc13e4b`.
- **Stale statement found:** `assembly/elementClasses.ts` still lists `reference_burned_in_text` as "not copied or re-created as editable text", which M2.1a contradicts (OCR text is re-created as editable text). This table is stored on every assembled draft. Wording should be corrected (non-protected).
- **Existing vocabulary clash to avoid:** `ELEMENT_CLASSES` (`scene_structure, clip_placement, …, reference_graphics`) is "what assembly can rebuild" (automatic/partial/unsupported). It is not the M4 visual-class vocabulary and must not be overloaded.
- **Reusable:** the `merge*` chain pattern: each returns the same snapshot when it has nothing to add and writes its own top-level record (`textReconstruction`, `imageReconstruction`, `backgroundReconstruction`, `transitionReconstruction`, `speechReconstruction`, `compositionReconstruction`). M5 adds one more record the same way.

## 10. Video Studio V2 layer model, timeline, keyframes
- **Status:** implemented. Layers: `TextOverlay`, `MediaOverlay` (image or video), `Shape` (`rectangle|circle|line|banner|highlight`), `LowerThird`, `SubtitleSegment`, `VideoClip`, `AudioTrack`; shared paint order via `order`. All persist in `project_json` (`CreateEditTab.buildProjectSnapshot`).
- **Missing (verified by search):** **no keyframe system** in V2 (the only matches for "keyframe" are in the legacy `StudioPage.tsx`); **no rotation** on `Shape` or `MediaOverlay`; no per-layer animation. "Rotation" and "motion over time" therefore cannot be a native M5 target without a protected types/editor change.
- **Approval-sensitive:** any new layer field goes through `types/index.ts` (protected). M5 avoids this by writing links in a draft-level record instead.

## 11. Overlay rendering, preview composition, FFmpeg export
- **Status:** implemented and verified E2E for text, images, shapes, subtitles, lower thirds, V2 inserts, transitions (cut, fade through black, dissolve incl. D1 preview), canvas colour and blurred backdrop: `ffmpeg_svc.render_project`, `canvas_render_svc.py` (Pillow PNGs composited with `overlay`), `timeline_plan.py`. Real MP4 produced from the integrated build (32/32) and inside the Railway M3 container (8 s project, 3.3 s plain / 7.1 s blur).
- **Gap:** shapes and everything above are painted over the footage; nothing can sit behind it (proposal `docs/proposals/BACKGROUND_BEHIND_FOOTAGE.md`, branch `docs/m3-background-behind-footage-proposal`, awaiting Ayub's decision). Dissolve window and blur backdrop have documented preview/export limits.

## 12. Save / reopen compatibility
- **Status:** verified E2E: draft save from the Reconstructor, reopen from My Drafts, edit and re-save, export. Backend compatibility tests push fixtures through the real drafts API (`test_assembled_draft_compat.py` etc.; they need the local Postgres).
- **Rule:** unknown top-level keys in `project_json` are ignored by the editor (`applyDraftSnapshot` reads named keys only); an editor-key test guards this (`assembleDraft.test.ts`).

## 13. What does NOT exist (the M4/M5 gap)
| Needed | Today | Plan |
|---|---|---|
| One class per visual element (caption, subtitle, handle, other text, logo, icon, image region, shape graphic, background element, unknown) | Only text grouping, recurring flag, a 3-way recurring-mark score | M4.1 classifier + `VisualElement` contract |
| Distinguish OCR text from graphical identity | Implicit: nothing is promoted to a logo automatically, but nothing says so either | M4.1 rule: graphical classes need non-OCR evidence or a user correction |
| Stable temporal identity across frames/shots, visibility intervals, movement | Occurrence groups (same shot), recurring links (cross shot), persistent visual elements (same shot, API only, unread by the frontend) | M4.2 tracks built from those, never re-deriving what the backend already decided |
| Readiness per element | Per-panel statuses only | M4.3 explicit states |
| Reconstruction status per element (faithful / approximate / user-supplied / placeholder / unsupported / missing asset) | Per-layer provenance bases only | M5 plan + draft-level record |

## 14. Approval-sensitive items (nothing below is applied)
1. **PENDING AYUB APPROVAL, not needed for batch 1:** behind-footage stacking (`BACKGROUND_BEHIND_FOOTAGE.md`): `CreateEditTab.tsx` (+~25 lines, one Properties checkbox), `ffmpeg_svc.py`, `types/index.ts` (`Shape.behindFootage?`).
2. **PENDING AYUB APPROVAL, not requested yet:** rotation and keyframes need new fields in `types/index.ts` and editor/export support. Batch 1 does not touch them and reports them as unsupported.
3. A layer-level link from a generated layer to its visual element would need `types/index.ts`. Batch 1 uses a draft-level `elementReconstruction` record keyed by layer id instead (no protected file, no API change, ignored by older editors).
4. `persistent_visual_elements` on the frontend `ShotSummary` type: declared locally in the M4 module instead of editing `types/index.ts`.

## 15. Test posture (honest)
- Frontend suite on the baseline: 1082 passed, 19 skipped (skips need local real data). Backend targeted: 42 passed. These are unit/render tests plus the browser scenarios listed above.
- Passing unit tests do not demonstrate hosted capability, real logo detection or multi-reference generality: only one real reference (VA5368) is available.
