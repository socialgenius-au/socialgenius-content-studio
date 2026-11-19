# Deconstructor / Reconstructor release gate — 2026-11-19

Purpose: run the existing CI acceptance suite against current main without changing deployed application code or production data, then record the remaining authenticated checks before beginning Carousel.

## Automated gate (GitHub Actions)
Workflow: `.github/workflows/deconstructor-reconstructor-acceptance.yml`.
- Frontend TypeScript build and unit tests
- VA5368 reference anatomy contract
- Blueprint to editable draft reconstruction integration
- PostgreSQL assembled draft save/reopen/resave compatibility
- Real FFmpeg timeline MP4 regression
- Browser smoke for protected editor and Deconstructor routes

CI results apply to test fixtures and ephemeral environments; they do **not** constitute an authenticated live Deconstructor run, production export, or production backup.

## Live gate (must be checked separately)
- [ ] Authenticated real-reference six-step flow: Reference → Anatomy → Mechanisms → New Content → Blueprint → Create
- [ ] Generated blueprint opens editable Reconstructor / Video Studio V2 with all assigned assets and layer timings
- [ ] Save draft, refresh, reopen; verify media, audio, text, timeline and provenance
- [ ] Export MP4; inspect audio presence, sync, overlays, duration, scene boundaries and preview parity
- [ ] Mechanisms and narrative: confirm evidence citations, certainty labels, no invented visual claims
- [ ] Mobile: navigate workflow and edit safely at phone viewport
- [ ] Verify recoverable PostgreSQL backup AND uploads backup (with checksum/restore procedure) before release

## Production baseline
Railway project SG-Content-Studio, production services `content-studio / frontend` and `socialgenius-content-studio` at commit `c641a4cbe1dc9696246507faafa0a556dd409d78`, both SUCCESS at audit time. Postgres and uploads volumes mounted. Railway rollback eligible; this is **not** equivalent to a database backup.

Do not merge or deploy test-only changes solely to claim live acceptance. Any failed gate requires a targeted fix and focused retest.
