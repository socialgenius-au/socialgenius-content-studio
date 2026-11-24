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
