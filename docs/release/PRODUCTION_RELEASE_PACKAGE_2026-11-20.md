# Production release package — Carousel Creator V2 (+ Deconstructor/Reconstructor release lineage)

Revision 2, 2026-11-20 (supersedes revision 1). **Nothing in this package has been executed against production except read-only checks and backups.** Production deployment requires explicit approval.

## 0. What changed since revision 1 (read this first)

Revision 1 assumed `feature/carousel-creator-v2` (`276e415`) could be deployed as it was. Read-only checks of production showed that is **unsafe**:

1. **Production is built from `origin/main` (`2d7a33b`), not from the release branch.** `main` contains 17 commits the release/V2 lineage does not have (PRs #8–#21, 18–19 Nov: server-side A1 audio probe, additional-video routing, text colours/presets, undo fix, login-rejection fixes, sidebar Open/Save fix). Hashing every backend file in the production container showed 197 of 200 identical to `78d380e`, and the other three include `assets.py`, which carries the 18 Nov audio fix that exists only on `main`. Deploying `276e415` would **revert those fixes**.
2. **Production appears to deploy from `main`** (deployments appear on each PR merge: 18 Nov ×2, 19 Nov ×4). Merging into `main` is therefore most likely the production deployment. Confirm (decision D2).
3. Production already contains the Deconstructor/Reconstructor code (it has `startup_security`, `ai_metering`, `schema_patches`, `reference_videos`) but **not** the carousel code.

**Release candidate (use this, not `276e415`):** branch `integration/carousel-v2-on-main`, built as `origin/main` + `feature/carousel-creator-v2` merged with **no conflicts** (merge `24610bf`, plus test-timeout fix `c1b000e`). It keeps all 17 newer `main` commits.

## 1. Facts about production (read-only, 2026-11-20)

| Item | Value |
|---|---|
| Railway project / env | `SG-Content-Studio` (`7adba4dc-6fd7-47f4-b6ad-901bdcbca9d8`) / `production` (`98eebde0-2b55-4f01-9a30-6b73c63b1794`) |
| Backend service | `socialgenius-content-studio` — https://socialgenius-content-studio-production.up.railway.app — current deployment `64b942ff-31d2-4a41-b82b-81d28d18bdb1` (SUCCESS, 19 Nov 09:16 IST) |
| Frontend service | `content-studio / frontend` — https://content-studio-frontend-production-84fe.up.railway.app — current deployment `b6aa693a-be05-418f-8534-57b20daaaa53` (SUCCESS, 19 Nov 09:16 IST) |
| Database | Railway Postgres service `Postgres`: 20 tables, 554 rows. **No `carousel_documents` table yet.** |
| Media | volume `content-studio-uploads` at `/app/uploads`: 852.7 MB, 48 files (45 user files = 362.6 MB; 3 are the re-downloadable `.model-cache/easyocr` model files) |
| Startup safety | SECRET_KEY is set, 32+ chars, not the default; `SEED_USERS_MODE` unset with no seed passwords (nothing is seeded); the production frontend origin is in the built-in CORS allow-list; `RESET_DB` unset |
| **AI spending** | **`AI_SPEND_ENABLED=true`, `ANTHROPIC_API_KEY` set and all seven `*_REASONER_PROVIDER` variables set in production.** This release adds no AI call and I did not change anything. It contradicts the "keep paid AI disabled" rule applied to acceptance. Decide before deploy (D1). |

## 2. Backups taken (read-only; nothing on the server was changed)

Location: `C:\Users\samee\Documents\socialgenius-backups\production-pre-v2-2026-11-20\`

- **Database**: `production-db-prod-pre-v2-20261120.sql.gz` (+ `.meta.json` with per-table row counts and data hashes). One repeatable-read **read-only** transaction. **Restore-verified** into a scratch database: 20 tables, **0 row-count or data-hash mismatches**, 97/97 constraints restored. The scratch copy was dropped afterwards.
- **Media**: `uploads\` — every user file copied in 6 MB chunks and verified against a SHA-256 computed on the server (`MANIFEST.json`, `progress.txt`). The re-downloadable OCR model cache is excluded.
- **Warning:** the older file `SG-Content-Studio-Production-2026-11-17.dump` in the same folder is **0 bytes**. It is not a usable backup.
- Railway's own volume/database snapshots (dashboard) are a recommended extra copy; they are not available to the CLI.

## 3. Migration review (the app creates tables at startup; no manual SQL is required)

A **rehearsal** ran the candidate's real startup code (`create_all` + `apply_additive_schema_patches`) against the restored production copy:
- It created exactly **4 new tables**: `carousel_documents`, `brand_kits`, `carousel_templates`, `library_items`.
- **0 columns added to, removed from or changed on any existing table.**
- All 20 existing tables are **identical by data hash** afterwards. Constraints went 97 → 106 (the new tables' keys).

The SQL files in `backend/migrations/` match the models (a test compares them), are idempotent (`IF NOT EXISTS`), add only a foreign key to `users(id) ON DELETE CASCADE`, and backfill nothing. They are optional pre-checks; the application creates the same tables itself. **Safe for production.**

## 4. Verification evidence

- Candidate (`integration/carousel-v2-on-main`): tsc clean; frontend 1632 tests pass (one timing-sensitive 300-slide test hit its 5 s default under full parallel load and passes alone in ~3 s; fixed with an explicit 30 s timeout in `c1b000e`); full backend suite result: see section 7.
- Hosted acceptance (earlier revision `276e415`, new test data only): Carousel V2 PASS; Deconstructor/Reconstructor PASS for the flows that need no paid AI, including the footage-assignment check (new draft 12 with 6 clips and 9 text layers; an unreadable file is flagged and blocks saving until fixed; reference videos cannot be used as footage); drafts 9, 10 and 11 unchanged.
- **Not yet done:** the merged candidate (with `main`'s 17 commits) has **not** been deployed to acceptance. An acceptance deploy was blocked this session. Do it before production (section 5, step 1).

## 5. Deployment sequence (production) — only after approval

Stop at any failed check and roll back (section 8).

1. **Validate on acceptance first**: deploy `integration/carousel-v2-on-main` (backend, then frontend) to the acceptance environment; spot-check sign-in, `/carousel-creator`, `/video-studio-v2` (the new `main` editor features) and `/deconstructor`; confirm drafts 9–12 are intact.
2. Take a fresh production database dump immediately before deploying if the backup is more than a few hours old (same read-only script).
3. Decide D1–D3 (section 6) and set production variables accordingly.
4. Open a pull request `integration/carousel-v2-on-main` → `main`, review the diff (131 files; non-carousel areas: shell/mobile navigation, Deconstructor intelligence panel, two backend scoring files, mobile header CSS), get CI green.
5. **Merge the PR.** This is the production deployment trigger (backend and frontend). *Checkpoint A: note the new deployment ids.*
6. Watch the backend deploy to SUCCESS; verify `/health` = 200; `/carousels/`, `/brand-kits/`, `/carousel-templates/`, `/library-items/` = 401 signed out; the 4 new tables exist and are empty.
7. Re-dump the production database and compare with the backup: all 20 existing tables identical by data hash; only the 4 new empty tables may appear. *Checkpoint B.*
8. Verify the frontend deploys; smoke test signed in: open an existing project and draft (including draft 9), save and reopen a carousel, export a PNG, a PDF and an MP4; confirm the A1-audio fix and earlier Video Studio work still behave.
9. Watch logs for an hour. *Checkpoint C: release accepted.*

## 6. Decisions needed from you

- **D1 — AI spending in production.** Currently `true`. This release neither enables nor needs it. Choose: leave as is, or set `AI_SPEND_ENABLED=false` before the deploy (a variable change I will not make without approval).
- **D2 — Production deploy trigger.** Confirm that merging into `main` is the intended trigger.
- **D3 — Stale-blueprint behaviour** (acceptance finding): a blueprint whose analysis changed cannot be used until rebuilt, and rebuilding needs a paid AI call. Confirm this is acceptable.

## 7. Remaining risks

1. The merged candidate has not yet run on acceptance (blocked this session). Mitigated by a conflict-free merge, tsc and the full frontend suite; closed by section 5, step 1.
2. Production AI spending is on (D1).
3. The media backup excludes the OCR model cache (it re-downloads on first use).
4. The earlier 17 Nov dump is empty; only the new backup is valid.
5. Pre-existing local-test failures unrelated to this release (one `test_blueprint_reasoner` case that already fails at `78d380e`; real-video and OCR fixture tests that only run on the original machine).
6. Hosted checks used one acceptance account and new test data; second-account isolation is covered by backend tests and the rolled-back probe, not a hosted two-account test.

## 8. Rollback checkpoints

- **Before the merge:** nothing has changed. Stop = do not merge.
- **After the merge (code rollback, fast, no data loss):** redeploy the previous production deployments — backend `64b942ff-31d2-4a41-b82b-81d28d18bdb1`, frontend `b6aa693a-be05-418f-8534-57b20daaaa53` — from the Railway dashboard, or revert the merge commit on `main`. The old code ignores the new tables.
- **Optional data rollback** (only if the new tables themselves cause a problem; they hold only data created after the release):
  ```
  DROP TABLE IF EXISTS library_items;
  DROP TABLE IF EXISTS carousel_templates;
  DROP TABLE IF EXISTS brand_kits;
  DROP TABLE IF EXISTS carousel_documents;
  ```
  `carousel_documents` is new to production, so dropping it loses any carousels users made after the release: export or snapshot first.
- **Full restore** from `production-db-prod-pre-v2-20261120.sql.gz` is a last resort (it discards everything written after the backup). Restore into a scratch database first and compare, as was done to verify it.
- **Media**: the release only adds files; nothing existing is modified or deleted. The `uploads\` backup (SHA-256 verified) is the reference.
