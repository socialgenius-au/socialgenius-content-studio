# Content Studio V3 development progress

## 24 November 2026

Starting branch `feature/content-studio-ui-v3` at `df44dace09c753debac8b9f9905db9b203339d24`.

### Implemented in this checkpoint

- Fixed the React build's implicit TypeScript types in the V3 export adapter.
- Fixed the media-library message target for the authenticated editor's embedded document. The backend returns asset names in `original_filename`.
- Connected authenticated uploads to the existing asset upload API. Newly assigned server assets use stable IDs in cloud drafts. Cloud reopen downloads the assigned media through the authenticated assets API before restoring the editor. Restoring a draft preserves saved clip durations when media metadata becomes available.
- Added an editor-version check in the draft update API and prevented the V2 editor from opening V3 draft records.
- Added an acceptance frontend Dockerfile that builds from the repository root, where both the React application and V3 editor HTML are available.

### Follow-up changes

- Added saved-project listing and renaming in the authenticated editor. The home dashboard now opens V3 for video creation and links to the existing Reconstructor, asset library and Brand Kit.
- New authenticated projects start without example media, scenes, text or simulated waveforms. The editor loads the same Social Genius logo asset used on the home screen. Both text tracks retain their own styling.
- Acceptance frontend: https://v3-acceptance-web-preview.up.railway.app/video-studio-v3
- Acceptance API: https://v3-acceptance-api-preview.up.railway.app/health/live

### Verification

- `npm run build` passed. The V3 editor inline JavaScript passed `node --check`.
- `npm test` reported 1,637 passing, 25 skipped and 7 failing. The same seven failures reproduced on the starting commit in the shell responsive, carousel route wiring and carousel scroll layout checks.
- A local Chromium regression attempt could not launch because the environment denied a socket operation. Authenticated browser workflows and real FFmpeg output still require acceptance testing.

### Deployment and remaining work

- The existing `SG-Content-Studio-V3-Preview / preview` environment contains only `v3-ui-preview`. Static deployment `ad61c396-7a5e-44f6-bd7d-c81dfb6f44a4` succeeded at the starting branch revision. Separate acceptance frontend, backend and PostgreSQL services were provisioned in this project. The frontend and PostgreSQL reached SUCCESS. The backend was building at the time of this checkpoint. PostgreSQL and media use their own volumes.
- The authenticated route still embeds the approved layout. Remaining work includes native React editor integration, project management and autosave, full timeline editing and preview parity, approved home and branding, AI and Brand Kit, and complete Deconstructor and Reconstructor handoffs.
- The V3 export adapter forwards timeline gaps to the existing renderer and uses the selected portrait, landscape or square format. Full track compositing and unsupported effects remain open. No V3 MP4 has been inspected or played for this checkpoint.
- Acceptance workflows A–F and production merge readiness remain open. This work made no production infrastructure or data changes.

## Acceptance deployment and Deconstructor V3

- The isolated PostgreSQL service reached SUCCESS on deployment `60c34d5c-cc4c-40dc-8879-16599b729a82`. The API reached SUCCESS on `c47e27fc-2a78-48f0-a2b2-2bb6f616c715`. The database is private, and media is stored on a separate acceptance volume.
- Acceptance login, origin checks, multipart upload, draft creation, fresh login, saved draft retrieval and exact media byte retrieval passed against the API. The web editor redirected an unauthenticated browser to the sign-in screen.
- Existing FFmpeg API smoke renders passed for 1080 × 1920 portrait, 1080 × 1080 square and 1920 × 1080 landscape. The portrait test rendered for 2.0 seconds. The two gap tests rendered for 2.5 seconds and showed black at 0.2 seconds and the source picture at 0.8 seconds. Each output contained H.264 and AAC and passed complete FFmpeg decoding.
- The layered 2.5-second test exercised sequential base footage, a simultaneous upper video layer, the upper-only tail, two text overlays, two independent audio clips and music. Inspected pixels confirmed the lower and upper footage at the expected times and sampled audio contained all five expected tones. These tests exercised the real backend API. Browser export and on-device playback remain to be checked.
- V3 export now sends clip trim offsets, track placement and canvas dimensions to the existing renderer. The adapter maps the upper track to the compositor and preserves its source audio where present. Video-only gaps can render. Images and some styling remain unsupported in the V3 export adapter.
- Added Reference Import & Context, Quick, Deep, Selective, Messaging and Technical screens at `/deconstructor-v3`, with a separate Discoverability tab. These are authenticated React views. They use the approved designs as the visual reference and link from the V3 dashboard and editor. The original workflow remains accessible for reconstruction.
- Quick runs the metadata and shot analysis endpoints. Deep starts and follows the existing pipeline. Selective runs the selected passes and their prerequisites. A custom time range creates an independent excerpt before applying the requested passes, so the source bytes stay intact. Verified the Quick endpoints and a metadata-only 0.75-second excerpt on Railway.
- Technical playback, seeking, extracted frames and detected shot boundaries are read-only. The waveform is decoded from source media in browsers that support the source format, with a 32 MB file cap. The Reconstructor receives the analysis, scene boundaries, evidence and any stored mechanisms in the current browser session.
- Published-page imports and platform metadata, researched SEO/GEO/AEO, comprehensive per-shot technical labels, multi-range selection, persistent handoff and complete browser acceptance remain open. Unavailable evidence is labelled on screen. The representative imagery and illustrative metrics in the approved mockups are absent from the implementation.
- The Deep Analysis API completed its acceptance run. Sixteen stages completed and three were skipped because the acceptance semantic, hook and retention reasoners have no configured provider. The UI now exposes per-stage status and skip reasons.
- The Technical screen uses a shared playback clock for scenes, shots, detected text, speech, transition evidence and decoded waveform. Selective Analysis can use either a scene or a shot boundary as the excerpt range. Added desktop and narrow layout styles.

## Video Studio V3 browser acceptance follow-up

Acceptance web deployment `f9f7e54c-cd21-434f-92a6-f6dfe8920736` reached SUCCESS on frontend commit `c5b9f126955fbac862b219f951d6fd7dd2d64f55`. The frontend used the isolated acceptance API.

| Check | Browser result |
| --- | --- |
| Authenticated workflow on Railway | Signed in with an isolated QA account, uploaded WebM footage, assigned Video Track 1, observed real video time advance, paused, compared the preview and timeline timestamps, and sought to an edit point. |
| Editing on Railway | Split at the playhead, trimmed with the Motion inspector, created visible text on both text tracks, selected Color and Effects, toggled text shadow, uploaded an independent WAV, and opened the media library. |
| Draft on Railway | Renamed and saved to the cloud, refreshed the browser, reopened the named draft, and confirmed clips, text and audio returned. |
| Render on Railway | Downloaded the MP4 using the editor and played it in Chromium. Measured 3.5 seconds, 1080 × 1920, H.264 and AAC. Full decode succeeded. A frame at 2.3 seconds showed both text overlays. Audio peaked at −20.8 dBFS. |
| Additional interaction checks | Verified Video Track 2 assignment and the palette action on Railway. Local Chromium verified undo and redo of a split, independent Audio 1, Audio 2 and Music assignment, scene creation and selection, navigation/tools/AI/timeline collapse, reversible Focus Mode, the Elements entry point, an AI suggestion handoff to Chat, and the Brand Kit link. |
| AI | The editor submitted the request to the existing chat API and displayed the unavailable response. The acceptance service lacks an AI provider credential. |

The preview transport and timeline now use one time source. The browser tests also found and fixed an inspector binding order error, a grid collapse that caused the navigation rail to intercept pointer events, and a remaining hardcoded Text 2 start that put new text outside short exports.

Coverage remains partial for advanced editor controls. The editor still uses the V3 iframe and the existing upload, draft, AI and export APIs. Motion provides clip placement and duration controls. Elements can browse and preview image assets, while export of those image elements and broader style/render parity remain open. This is a desktop Chromium result. Full control-by-control acceptance and cross-browser coverage remain open.

## Timeline editing toolkit acceptance

Front-end revision `caa2d5c0219cee320082626d8c95362fcee06f9b` reached **SUCCESS** on isolated Railway acceptance deployment `ef0df125-c455-4a63-9559-3fdf886ec435`. The public UI preview of the same revision reached **SUCCESS** on `82ace059-f532-4f65-a369-eac749901a61`.

| Control | Evidence |
| --- | --- |
| Select | Chromium cleared selection and focused the tracks. |
| Cut | Chromium removed the selected clip and retained a pasteable clip. |
| Split at playhead | Chromium split a video at the chosen point. Undo and redo restored the expected clip counts. |
| Trim | Chromium opened the selected clip's inspector and set a shorter duration. Pointer tests also shortened the clip from both trim handles. |
| Copy and Paste | Chromium copied a clip and inserted it at the playhead. |
| Duplicate | Chromium added a second copy, including multiple clips on Text 1 in the iframe fixture. |
| Delete and Ripple delete | Chromium removed the selected clip. The context-menu Ripple delete closed the gap on the affected track. |
| Snap | Chromium toggled the snapping state. Precision snapping in a full authenticated drag was not covered. |
| Zoom in, Zoom out and Fit timeline | Chromium verified the track width changes and refreshed ruler labels. |
| Beginning, Rewind, Previous frame, Play/Pause, Next frame, Fast forward, End | Chromium verified the seek/play behaviour and equal preview/timeline time strings. Frame stepping uses 30 fps. |
| Playback speed | Chromium selected 2× and observed the video playback rate. This is a preview transport rate. |
| Fullscreen | Chromium entered and exited preview fullscreen. |
| Tracks and media | Chromium counted exactly seven lanes, inspected a decoded thumbnail and a decoded waveform, and confirmed no document-level overflow at 1024 px. |
| Context menu | Chromium opened the selected clip's menu and invoked Ripple delete. A pointer test moved footage to the second video track. Keyboard copy, paste and delete also passed. |
| Inspector | Chromium applied video framing and crop focus, image size and position, and clip volume. |
| Templates | Authenticated-shell fixture exercised search, category filtering, custom scene titles, storyboard append, optional editable title clips, and snapshot save/reopen. It uses the shared video preset definitions from the existing template library. |
| Export | The single Export control invokes the existing renderer. Image overlays, crop and volume are included in the payload. The new payload was not verified by rendering a new authenticated Railway MP4. |
| Brand and AI | Official logo asset is shown in the rail, saved brand kit primary colors are connected to the inspector, and the existing AI request remains wired. Provider credentials and a successful AI response remain unverified. |

The editing and media checks above ran in Chromium against the deployed public UI preview. Template and snapshot checks used a local authenticated-shell fixture. Full authenticated acceptance on the new revision remains open, including real cloud save/reopen, library-to-timeline drag, and an exported MP4 covering the new features. The prior browser export remains evidence for the earlier revision only.

Still open in the editor are full V2 property parity (including arbitrary rotation, advanced effects and animation, per-clip video speed and audio fades), full Brand Kit parity, and testing a configured acceptance AI provider. Production application and data were not changed.

## V3 inspector and compatible track movement

- Added per-clip mute, independent audio and music fade-in and fade-out, and video contrast and saturation. Clip properties flow through undo/redo, draft snapshots and the V2-derived MP4 renderer. Existing drafts default to neutral settings.
- Timeline clips can move between text tracks and among audio and music tracks. Pointer moves and trims that overlap another video on the same track revert to their original range. Cancelled pointer edits also revert.
- Frontend build, inline editor syntax, Python compilation and diff checks passed. A local synthetic FFmpeg render verified that a delayed tone fades in and out and is silent outside its placed interval.
- The isolated Railway editor route opened in Chrome and displayed sign-in. Control-level acceptance on this revision, cloud save/reopen and the authenticated editor-to-MP4 test are pending. The preceding toolkit table records the earlier browser checks and their scope.
- Remaining implementation includes complete video and image transforms, per-clip video speed, text animation and font export parity, full saved Brand Kit application, broader Elements export, and a successful AI response with an acceptance provider.

## Signed-in Railway browser follow-up

Chrome on the isolated acceptance deployment at `80e8c8b` exercised real library footage. Select cleared selection. Split, Undo and Redo produced 2, 1 and 2 video clips. Trim accepted numeric keyboard input. Duplicate, Copy/Paste, Cut, Delete and context-menu Ripple delete produced the expected clip counts. Snap toggled, zoom controls and Fit were exercised, and the editor showed seven lanes and a decoded clip thumbnail.

Beginning, Previous frame, Next frame, Rewind, Fast forward, End, Play/Pause and 2× playback were exercised. Preview and timeline time matched in the sampled checks. Fullscreen was invoked without a confirmed browser fullscreen transition. Deleting clips exposed an out-of-range playhead, corrected by clamping the shared playback clock during render.

The Product Demonstration template was found by search, customised and applied as editable titles. The existing main video remained present. An image was assigned to Video 2 and the inspector changed to image fields. Cloud save returned draft 5. After reload, cloud open restored the video, image and customised template title. The downloaded MP4 contained 1080 × 1920 H.264 and AAC with a measured audio peak of −0.3 dBFS. Its 5-second output exposed truncation at the end of the video footage when other tracks ran longer. The export now requests the full occupied timeline duration, and the renderer fills the tail with background and silence before compositing.

Independent audio fade controls, exact inspector value persistence, fullscreen, fine snapping, cross-track drag, and verification of the corrected full-length MP4 remain separate acceptance checks. No production deployment was made.

## Full-duration Railway export verification

The isolated acceptance web and API deployments for `e2b8993` reached SUCCESS. On that frontend, removing the longest clip at 19.50 seconds clamped both time displays to the new project end of 16.00 seconds. Zoom changed the lane width from 719 to 1080 CSS pixels and Zoom Out and Fit restored it. The tested 1363-pixel workspace had no horizontal page overflow. Selecting Education filtered the live template library.

After cloud save, reload and reopen, the draft restored the 5-second video with contrast 12 and saturation −20, the 2-second image at 40% width and 35% height, and the customised template titles. The new export downloaded and decoded successfully. It contained 16.00 seconds of 1080 × 1920 H.264 video and AAC audio, with a measured peak of −0.8 dBFS. Frame inspection confirmed the image overlay near the opening and the final template title at 13 seconds, eight seconds after the base footage ended.

A later frontend revision `c2fec1f` reached SUCCESS on the same URL. The full-duration export evidence above applies to `e2b8993`. Exact snapping, cross-track pointer movement, fullscreen, and an independent fade track in a browser export remain open. The synthetic audio file chooser timed out in the browser test. No production deployment was performed.

## V3 analysis follow-up from 66e2737

- Selective Analysis routes to the requested evidence view. Selecting external research reuses complete saved reports for the same reference, dimension and topic.
- Discoverability groups the existing citations by research purpose. Devanagari and Arabic-script combining marks are preserved when detecting terms and hashtags.
- Messaging Intelligence exposes the existing local Whisper small transcript alternative with optional language guidance. It preserves the original and reloads saved alternative readings.
- Baseline frontend verification at 66e2737 reported 1,637 passed, 25 skipped and 7 failed. The failures cover responsive shell wiring and carousel layout.
- Reference 4's three saved cited reports reopened on Railway acceptance. Full OCR and speech accuracy, approved design matching, and the complete current-build editor export workflow require further verification.
