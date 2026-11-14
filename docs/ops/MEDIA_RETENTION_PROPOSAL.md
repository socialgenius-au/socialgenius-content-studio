# Export file retention — proposal (nothing is deleted automatically)

## What happens today
- `POST /video-export/export` renders into `uploads/<user>/<uuid>.mp4` (`ffmpeg_svc._out`), the same folder and naming as uploads, and returns the file with `FileResponse`. **Nothing deletes the finished MP4.** Intermediate render files are removed at the end of a *successful* render; a render that fails part-way skips that cleanup, so its intermediates also stay.
- Because exports use the same folder and naming as uploads, a file cannot be recognised as an export by its name. The database is the only way to tell: uploads and extracted frames have an `assets` row, saved drafts reference files by name, and finished exports have neither.

## Measured on the acceptance volume (read-only report, 2026-11-14)
`python scripts/media_retention_report.py` — 35 files, 337.8 MB of 5 GB. **Protected:** 30 files, 326.3 MB (all referenced by `assets`). **Unreferenced:** 5 MP4s, 11.5 MB (four 2.8 MB exports from about 7.8 days ago, one 0.3 MB export from the latest successful test). So the accumulation is real but small: about 2.8 MB for a 12-second test video. With full-length 1080p footage a single export can be tens of MB, so it will matter eventually.

## Proposed policy
A file is **never** a deletion candidate if any of these is true:
1. It has an `assets` row (source footage, reference videos, images, extracted keyframes, anything the Library lists).
2. Its file name appears in any saved draft, job or template.
3. It is younger than the retention window (default **24 hours**: covers a download in progress and a render that has just finished), or was modified in the last 10 minutes.
4. It lives outside `uploads/<numeric user id>/`, or inside the quarantine folder.

Everything else (unreferenced and older than the window) is a **candidate**. Candidates are handled in two reversible steps, each needing an explicit command and approval:
- **Quarantine, not delete:** move to `uploads/.quarantine/<date>/` (keeps the user folder tidy and lets any mistake be undone by moving the file back).
- **Purge** quarantined files after **14 days**, as a separate explicit command.

Safeguards for any tool that moves or deletes: dry-run by default and prints exactly what it would do; a separate `--apply` flag; refuses to run if the database cannot be read or the `assets` table is empty; refuses if candidates exceed 25% of the files or 1 GB unless a second `--allow-large` flag is given; logs every action; never follows symlinks.

## Root-cause fixes (need approval; the export pipeline is not touched by this proposal)
1. Write exports to `uploads/<user>/exports/` so they are identifiable by location, which removes the guesswork.
2. Delete the finished file after it has been sent (a background task on the response), or keep it only for the retention window.
3. Wrap the render in `try/finally` so intermediates are removed when a render fails.

## What has been done now
Only the read-only report script (`backend/scripts/media_retention_report.py`) and this document. No automatic deletion exists or is enabled, and no files on the volume were changed.
