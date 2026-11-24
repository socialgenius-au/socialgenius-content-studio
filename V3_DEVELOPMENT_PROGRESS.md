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
- The V3 export adapter now forwards timeline gaps to the existing renderer and uses the selected portrait, landscape or square format. It still rejects overlapping video. Full track compositing and unsupported effects remain open. No V3 MP4 has been inspected or played for this checkpoint.
- Acceptance workflows A–F and production merge readiness remain open. This work made no production infrastructure or data changes.
