# Production release package — Carousel Creator V2 + Deconstructor/Reconstructor

Prepared 2026-11-20. **Nothing in this package has been executed against production.** Production deployment requires explicit approval.

## 1. What would be released

| Item | Commit | Branch |
|---|---|---|
| Carousel Creator V2 (includes everything below) | `276e415` | `feature/carousel-creator-v2` = `integration/carousel-acceptance` |
| Deconstructor/Reconstructor release candidate | `78d380e` | `release/deconstructor-reconstructor-20261117` (an ancestor of `276e415`; unchanged) |

Deploying `276e415` therefore ships both modules. If only the Deconstructor/Reconstructor should go first, deploy `78d380e` (no new tables, no new migrations).

Acceptance deployments of `276e415` (Railway project `67f34f55-ea24-478b-8e73-73207b4c559f`, environment `deconstructor-acceptance`): backend `be398963-90d9-4f08-99eb-36d72d29570a`, frontend `ddaba053-f9c3-4c99-b56b-8b08a99a9862`. Previous acceptance deployments (for reference): backend `71886f23` / `6dd6e73`, frontend `cb3c18b2`.

## 2. Release gates (all must be ticked before production)

- [ ] **Hosted authenticated acceptance of Carousel Creator V2 passed** (checklist in section 6). *Not yet run: needs a signed-in browser session.*
- [ ] **Hosted authenticated acceptance of the Deconstructor/Reconstructor passed** (the outstanding checks recorded for the release candidate). *Not yet run: needs a signed-in browser session.*
- [ ] Production database backup taken, restore-verified, and stored outside the server (section 3).
- [ ] Production environment variables reviewed (section 4).
- [ ] The person approving has read section 7 (rollback).
- [ ] Explicit written approval to deploy to production.

## 3. Backup (before any change)

1. Take a full logical backup of the **production** PostgreSQL database. Use `pg_dump -Fc` through the Railway database connection if available. If the app container has no `pg_dump` (as on acceptance), use the in-container asyncpg logical dump approach used for acceptance (script: `acc_db_dump.py`, which writes a SQL dump plus a per-table row count and data-hash file).
2. Back up the uploads volume contents list (file names and sizes) so media can be reconciled after deploy. Do not copy or alter the files themselves.
3. **Restore-verify**: restore the dump into a scratch local database and compare every table's row count and data hash with the source. On acceptance this was done: 21 tables, 829 rows, zero mismatches, 100/100 constraints restored.
4. Record the current production deployment ids and commit for both services (needed for rollback).
5. Store the backup and the hash file somewhere other than the server, and note its location in the release record.

Existing records that must be unchanged after deploy: all existing tables' data hashes, reference 5131, draft 9, existing drafts, media, the AI-call ledger, and the known 40 records with missing media (these predate this release).

## 4. Environment checks

- `AI_SPEND_ENABLED` must be `false` (or unset) unless a separate decision enables it. The release adds **no** feature that makes a paid AI call.
- Do not change `SECRET_KEY`, database credentials, or any API key as part of this release.
- Backend needs FFmpeg for animated MP4/GIF export. It is bundled (`imageio-ffmpeg`); on acceptance the container probe confirmed H.264, AAC and GIF encoders.
- Frontend `VITE_API_URL` must point at the production backend.
- CORS: `/uploads` responses must allow the frontend origin (canvas export of pictures needs it). Confirm after deploy (section 5).

## 5. Deployment checklist (production, only after approval)

Order matters: **backend first, then frontend.**

1. Confirm the gates in section 2.
2. Apply the migrations (additive only; each is idempotent with `IF NOT EXISTS`). The application also creates missing tables at start-up, so this step is the "pre-check" route:
   - `backend/migrations/2026-11-19_carousel_documents.sql` (already part of the acceptance baseline; production only if not yet applied)
   - `backend/migrations/2026-11-20_brand_kits_and_carousel_templates.sql` (new: `brand_kits`, `carousel_templates`)
   - `backend/migrations/2026-11-21_library_items.sql` (new: `library_items`)
   No existing table is altered, dropped or rewritten. New tables reference `users(id)` with `ON DELETE CASCADE`. Nothing is backfilled.
3. Deploy the backend at `276e415`. Wait for SUCCESS.
4. Verify the backend: `/health` = 200; `/carousels/`, `/brand-kits/`, `/carousel-templates/`, `/library-items/` = 401 when signed out; the new tables exist and are empty.
5. Re-dump the database and compare table hashes with the pre-deploy backup: every pre-existing table must be identical; only the new empty tables may be added.
6. Deploy the frontend at `276e415`. Wait for SUCCESS.
7. Smoke test signed in (section 6, shortened): open an existing carousel, edit and reopen it; export one PNG, one PDF and one MP4; open Video Studio V2 and the Deconstructor and confirm existing drafts (including draft 9) and reference 5131 open unchanged.
8. Watch the logs for errors for the first hour.

## 6. Hosted acceptance checklist (to run signed in, on acceptance first)

Carousel Creator V2:
- [ ] Create, edit text and pictures, refresh, reopen: edits persist; save badge reaches "Saved".
- [ ] Add/remove/reorder slides beyond 20; export range works; progress and cancel work.
- [ ] Design tab: backgrounds, patterns, shapes (polygons, arrows, stars, bubbles), text inside shapes, opacity, picture adjustments, multiple overlapping pictures, layer order.
- [ ] Format tab: switch platform presets/orientation/custom size; layers stay editable; limit warnings appear.
- [ ] Brand Kit: create with a logo and a font upload, apply, detach; another account cannot see it.
- [ ] Templates: save a carousel and a slide template, start from one.
- [ ] Animate: transitions and element animations; timeline; add music (MP3/WAV/M4A/AAC), trim/fade/mute/remove; MP4 has audio, GIF is silent.
- [ ] Export: PNG, JPEG, SVG (one slide and ZIP), PDF (links clickable), ZIP, GIF, MP4; custom width, JPEG quality, file name.
- [ ] File tab: Save now, Save As, Save as template, download and re-open a project file, import picture/SVG/PDF.
- [ ] Phone (about 390 px), tablet and desktop layouts: no horizontal overflow.
- [ ] Existing carousels from before V2 open unchanged.

Deconstructor/Reconstructor: run the outstanding hosted checks recorded for the release candidate; confirm reference 5131 and draft 9 are unchanged; confirm no paid AI call is possible (`AI_SPEND_ENABLED=false`).

## 7. Rollback

Code rollback (fast, no data loss): redeploy the previous production commit to both services (record it in step 4 of section 3). New tables are not used by the old code, so leaving them in place is harmless.

Data rollback (only if a new-table problem must be removed; the tables are empty or hold only new-feature data):
```
DROP TABLE IF EXISTS library_items;
DROP TABLE IF EXISTS carousel_templates;
DROP TABLE IF EXISTS brand_kits;
```
(`carousel_documents` holds users' carousels from the earlier release: do not drop it.) Do **not** restore the whole database from the backup unless data corruption is proven, because that would discard anything created after the backup; if it is ever needed, restore into a scratch database first and compare.

## 8. Known limitations (unchanged by this release)

- Crop is an edge trim, not a free rectangle.
- Picture adjustments are skipped in the few browsers without canvas `filter` (the export panel warns).
- Map image is an upload slot; no map service is called.
- PDF import reads only pages that are JPEG pictures; SVG import is flattened.
- Platform slide-count/duration/size limits are advisory.
- Links are clickable in PDF (and in a browser for SVG), never in PNG/JPEG/MP4/GIF.
- Pre-existing test failure at `78d380e` itself: `test_blueprint_reasoner.py::test_a_disposition_that_names_a_nonexistent_section_or_no_matching_section_is_also_only_a_note`; 10 more backend tests need real-video/OCR fixtures and fail only on the local machine.

## 9. Evidence summary

Local (not hosted): frontend 1627 tests + tsc clean; carousel backend 104 tests; full backend suite 2151 pass, 11 environment-only failures; real-browser runs of editing, snapping, groups, Brand Kit with real upload and font, templates, preview, PNG, JPEG, ZIP, SVG, PDF, GIF, MP4 with audio (decoded: tone for the first 4 s, then silence), project-file round trip, picture/SVG/PDF import, and a 375 px layout with no overflow on all nine tabs.

Hosted (acceptance, signed out): backend and frontend deployed; in-container probe 20/20 with everything rolled back; 21 pre-existing tables identical by data hash after deploy, 3 new empty tables; new bundle served; APIs return 401 when signed out; AI spend off.
