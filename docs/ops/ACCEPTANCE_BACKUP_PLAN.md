# Acceptance environment — backup and recovery plan (PLAN ONLY: nothing has been enabled, nothing paid has been added)

## Update 2026-11-06 — availability and charges CHECKED (read-only)
- This project is on Railway's **Hobby** plan (workspace plan `HOBBY`, project `subscriptionType: hobby`). Railway's own plan-limits record for this project says `volumes.maxBackupsCount: 0` and `maxBackupsUsagePercent: 0`: **built-in volume backups are not available on this plan.** No backup schedule or backup exists on any volume in the project (checked through Railway's API for all four volumes).
- Railway's community answers state that volume backups need the **Pro** plan ($20 per month per seat; I did not find an official page that lists backups against plans, so confirm on the Pricing page before buying). The incremental backup storage itself is billed at the volume rate ($0.15 per GB-month, i.e. cents at our size), so the real cost of Tier 1 is **the plan upgrade (about $20/month), not the backups**. Not worth it for an acceptance environment; **nothing was changed or purchased.**
- Recommended instead, at no cost: **Tier 0 — a copy on your own computer**, taken on request or on a weekly Windows scheduled task: a Postgres dump plus the uploads folder (about 170 MB today) pulled through the Railway CLI. I have not run it, because it would copy account data to your machine and needs your approval. Restore is the same steps in reverse (restore the dump, copy the folder back, run the integrity report).
- Tier 2 (a bucket you own) stays as below, optional.


Scope: Railway project `ayub-test-contentstudio`, environment `deconstructor-acceptance`. Two things must be recoverable together: the **uploads volume** (`pleasing-presence-volume`, mounted at `/app/uploads`: uploaded videos, keyframes, thumbnails, footage) and the **Postgres volume** (`postgres-volume-iKKA`: accounts, assets, references, analyses, drafts, AI ledger). A database row without its file, or a file without its row, is an inconsistent restore, so both are backed up on the same schedule and restored to the same point in time.

Current size (2026-11-06): uploads volume ≈ 6 MB used of 5,000 MB; Postgres volume ≈ 158 MB used of 5,000 MB.

## What Railway provides (read from the official docs, 2026-11-06)
- Per-volume **scheduled backups**, set in the service's *Backups* tab; several schedules can be selected for one volume: **daily** (every 24 h, kept **6 days**), **weekly** (every 7 days, kept **27 days**), **monthly** (every 30 days, kept **89 days**). Manual backups can also be taken, deleted and restored.
- Backups are **incremental / copy-on-write**: you pay only for data unique to a backup, at the **same rate as the volume ($0.15 per GB-month)**. Manual backups are limited to 50 % of the volume size.
- **Restore**: Backups tab → *Restore* on the dated backup → review the staged change under *Details* → *Deploy*. It creates a **new volume mounted at the same path**, named with the backup date; the original volume stays in the project, unmounted. Takes seconds to a few minutes plus a redeploy.
- Limits to design around: backups can only be restored **within the same project and environment**; **wiping or deleting a volume deletes its backups**; plan eligibility for backups is not stated on the pages I read (check the Backups tab on this project's plan before relying on it).

## Recommended approach (simplest reliable, no new service)
**Tier 1 — Railway scheduled backups on both volumes** (proposal: turn on from the dashboard, ~5 minutes, needs your go-ahead because it adds usage-based cost):
| | Uploads volume | Postgres volume |
|---|---|---|
| Frequency | daily + weekly | daily + weekly |
| Retention | 6 days / 27 days (Railway's fixed windows) | same |
| Destination | Railway's own backup storage in this project | same |
| Estimated cost | incremental data only. Today ≈ 0.01 GB → **well under $0.01/month**; even a worst case where the whole 5 GB changes weekly is ≈ **$0.75–1.50/month** | Postgres ≈ 0.16 GB → **≈ $0.03–0.10/month** |
Recovery point: up to 24 h of uploads/rows lost in the worst case (RPO 24 h). Recovery time: ≈ 15–30 min (restore both volumes, redeploy, run the checks below) (RTO).

**Tier 2 — an off-platform copy (optional; needs a new account, so it needs separate approval).** Tier 1 shares the project's fate: deleting the volume or project deletes its backups. If you want protection against that, add a weekly copy of a Postgres dump plus the uploads folder to an S3-compatible bucket you own (Cloudflare R2 has a free allowance of 10 GB; Backblaze B2 costs about $6 per TB-month; both are well under $1/month at this size). Implementation would be one small scheduled job in this project (a cron service running `pg_dump` and a sync of `/app/uploads`), about half a day. Not started.

## Restore procedure (Tier 1)
1. Stop uploads: tell users, or temporarily scale the backend to zero (so no new rows/files appear between the two restores).
2. Restore the **Postgres** volume to the chosen date (Backups tab → Restore → Details → Deploy). Note the date stamp.
3. Restore the **uploads** volume to the same date stamp the same way.
4. Redeploy the backend. Check `GET /health/storage` (`persistent_mount: true`) and `GET /health/ready`.
5. Run the integrity report (`GET /assets/integrity`, logged in): any record listed as missing is a file uploaded after the restore point; those must be uploaded again (nothing is recreated or substituted).
6. Open one saved draft, play its video, and export a short MP4 to confirm.
7. Keep the unmounted original volumes until step 6 passes; delete them afterwards to stop their cost.

## Restore drill (before relying on it)
Do **not** drill on the live volumes. Create a throwaway service with a small volume in this project, put a test file in it, take a manual backup, delete the file, restore, confirm the file is back, then delete the throwaway service and volumes. About 20 minutes and a few cents. Record the date and result in this file.

## Operational notes
- `GET /health/storage` shows free space; alert threshold proposal: below 1 GB free.
- Volume is 5 GB (Hobby limit); growing it is a plan change.
- Production is a separate environment and is not covered by this plan.

## Decisions needed
1. Approve Tier 1 (turn on daily + weekly backups for both volumes; cost estimate above).
2. Decide whether you want Tier 2 (off-platform copy) and, if so, which bucket provider you are happy to create an account with.
3. Approve the restore drill.
