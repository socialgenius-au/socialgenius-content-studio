# Acceptance environment — persistent media storage (M6 Step 0)

Scope: Railway project `ayub-test-contentstudio`, environment `deconstructor-acceptance`, service `pleasing-presence` (backend). Production, `main` and protected editor files untouched.

## Configuration
| Item | Value |
|---|---|
| Volume | `pleasing-presence-volume`, 5,000 MB, status Ready, attached to `pleasing-presence` |
| Mount path | `/app/uploads` |
| Why there | The backend's `UPLOAD_DIR` defaults to the relative path `uploads` and the container's `WORKDIR` is `/app`, so every upload, thumbnail, reference-video keyframe and Video Studio footage is written under `/app/uploads/<user_id>/<uuid>.<ext>`. Every `assets.file_path` stored in the database is the relative form `uploads/<user_id>/<uuid>.<ext>`. Mounting the volume at that exact place needs **no variable change, no code change to paths and no database change**: existing records stay valid. |
| Container user | root (no `USER` in the Dockerfile), so the volume is writable (verified). |
| Reporting | `GET /health/storage` (public, booleans and free space only): `{"exists":true,"writable":true,"persistent_mount":true,"free_mb":4590}`. `persistent_mount:false` means uploads die with the container. |
| Missing-file reporting | `GET /assets/integrity` (authenticated, own assets only, read-only): lists records whose file is not on disk. Download and Video Studio export answer **410** with a message naming the file; a reference whose source is gone fails its first step with the same message and blocks the others. Nothing is deleted, recreated or substituted. |
| Not in scope | Backups of the volume (Railway volume backups are not configured), object storage, signed media URLs. |

## Evidence (2026-11-06, run inside the container with an in-process token; no password used)
Before the volume: `persistent_mount:false`; after redeploys, the source videos of references 5127 and 5128 and all of their keyframes were missing from disk while the database rows survived.
After attaching the volume and **redeploying into a new container** (container start 06:11:56 UTC):
- phase 1 (before redeploy), 8/8: uploads land on the volume; a 10 s reference deconstructed in 74 s (16 steps complete, 3 AI steps skipped); keyframes extracted; a reference whose file was deleted fails with a plain message; a draft saved; MP4 exported (1080x1920, audio, 10.0 s, 2.7 MB).
- phase 2 (after redeploy), 15/15: mount still a mount point; footage and reference source byte-identical (sha256); keyframes present and byte-identical; authenticated download 200, no token / forged token refused; draft reopens unchanged; analysis record intact; anatomy reads; the same export repeated gives the same duration, size and audio; the integrity report lists only files lost before the volume existed; exporting a lost file stops with `The uploaded file '<name>' is no longer on the server ... Nothing was replaced or recreated.`
- Local two-user tests (`tests/test_media_isolation.py`, 5/5 with the storage tests): user B cannot list, download, ingest as a reference or export user A's asset (404), sees none of A's files in the integrity report, and A's missing file is reported without being recreated.

## Findings
1. **Files uploaded before the volume are gone** (all 39 asset records that existed before the volume, including the source videos of references 5127 and 5128). The database rows were left as they are; the files must be uploaded again. They are not recreated.
2. **Media URLs are not authenticated.** `/uploads/...` is a static mount (so `<video src>` works). Names are unguessable 128-bit UUIDs in a per-user folder and there is no directory listing, but anyone holding a URL can fetch the file. The API paths (download, export, references, drafts) are authenticated and owner-scoped. Hardening (short-lived signed URLs) touches how the editor loads media, so it needs a separate approval.
3. Test objects were created for user `ayub` and named `M6-STORAGE-TEST`: the test draft and footage were removed through the API; the two test reference videos (and their source assets) remain because the API has no delete for references. Safe to ignore or remove later.

## Rollback
`railway volume` detach/delete the volume from `pleasing-presence`; the service reverts to the container's own (ephemeral) folder. The code added (`/health/storage`, `/assets/integrity`, clearer 410 messages) is additive and harmless without a volume. No data migration exists to undo.
