# Forgot Password: preview deployment checklist

Status: **prepared, not executed.** Nothing below has been pushed, deployed or changed in Railway or any live database.
Branch `feature/forgot-password` (2 feature commits on top of `preview/unified-v1` @ `40b6458`; a strict descendant, so it fast-forwards).
Railway project `angelic-insight`, environment `production`: services `socialgenius-unified-preview` (backend), `socialgenius-content-studio`
(frontend), `Postgres`. **Both app services track `preview/unified-v1` and redeploy automatically on every push to it.**

Every step that changes something says who does it and needs its own approval.

---

## 0. Before anything is touched

| # | Item | Who |
|---|------|-----|
| 0.1 | Approve: the GitHub push, the Railway variable changes, the deploy, and (later, separately) the `ayub` email change | You |
| 0.2 | Resend account + API key (kept in a password manager; never pasted into chat, git or screenshots) | You |
| 0.3 | Choose the sender for the first test (see §2): Resend's test sender (no DNS) or a verified `socialgenius.com.au` sender | You |
| 0.4 | Confirm you can open the inbox for `socialgenius.au@gmail.com` (it receives the reset and confirmation emails) | You |
| 0.5 | Note the rollback anchors: the current deployment of each service (Railway → service → Deployments) and the current branch tip `40b6458` | You / me |
| 0.6 | Optional safety copy of the preview database (Railway Postgres → Backups, if your plan has it). Not required: the changes are additive and rehearsed (see §6) | You |
| 0.7 | Go/no-go: local results are green (below) | Me |

Local results at the point of writing: frontend 327/327 tests, TypeScript clean, production build OK; backend regression 1620 passed / 9 known baseline
failures (identical by name); 53 forgot-password + 11 recovery-email backend tests; 43 + 21 end-to-end checks in a real browser against a real backend;
Video Studio V2 master clock byte-identical. No dependency manifest, Dockerfile or railway.toml changed (so no new package can break the build).

---

## 1. GitHub push and branch selection

Recommended: **fast-forward `preview/unified-v1`** to the feature branch. It is a plain descendant, so there is no merge commit and no force-push.

```
git push origin feature/forgot-password                      # 1) review/backup copy; no service tracks this branch, so nothing deploys
git push origin feature/forgot-password:preview/unified-v1   # 2) fast-forward; THIS triggers both services to redeploy
git ls-remote origin refs/heads/preview/unified-v1           # 3) confirm the remote tip equals the feature tip
```

Do step 2 only after §2 (variables) is finished. Do not push `main` or `staging`. Do not force-push.

Alternative if you want to look at it first without touching the services' branch: leave step 2 out and run the app locally; or point a *new* Railway
service at `feature/forgot-password` (not recommended: it needs its own database and variables).

---

## 2. Environment variables (backend service only; the frontend needs none)

Set on **`socialgenius-unified-preview`**, then let the resulting redeploy finish **before** pushing code. The current code ignores them, so this is safe.

| Variable | Value | Notes |
|---|---|---|
| `RESEND_API_KEY` | your Resend key | Secret. Enter it only in Railway's Variables tab. |
| `AUTH_FROM_EMAIL` | `SocialGenius <onboarding@resend.dev>` for the first test, later `SocialGenius <no-reply@socialgenius.com.au>` | The test sender only delivers to the email address the Resend account was created with, so create that account with `socialgenius.au@gmail.com`. A verified domain needs DNS records added in Cloudflare exactly as Resend's dashboard lists them (normally a DKIM TXT at `resend._domainkey` and records on a `send` subdomain; the root SPF record usually stays as is). Turn Resend's **click tracking off** for this domain: tracking rewrites links and can break `#token=` fragments. |
| `FRONTEND_BASE_URL` | `https://socialgenius-content-studio-production-b423.up.railway.app` | Exact public origin of the frontend. Used only to build email links. While empty, no link is ever sent. |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | (optional) default `30` | |
| `EMAIL_VERIFY_TOKEN_TTL_HOURS` | (optional) default `24` | |

Already set and unchanged: `DATABASE_URL`, `SECRET_KEY`, `SEED_PASSWORD_AYUB`, `UPLOAD_DIR`, `CORS_ALLOWED_ORIGINS` (already allows the frontend origin).
Frontend service: `VITE_API_URL` stays as it is.

---

## 3. Railway services: what happens on push

1. Both services detect the new commit on `preview/unified-v1` and start building. The frontend (small) normally finishes first; the backend image (Python +
   ML libraries) takes longer. Railway keeps the old instance serving until the new one passes its health check (`/health/live`).
2. While the frontend is new and the backend still old, sign-in still works; the new pages show "Could not reach the server" if used. **Do not test until the backend
   deployment is SUCCESS.**
3. On startup the new backend runs its additive schema changes automatically (§4).
4. Post-deploy checks (all read-only):
   - `GET <backend>/health/ready` returns `{"status":"ok","db":"ok",...}`.
   - `GET <backend>/openapi.json` lists the five new `/auth/password-reset/*` and `/auth/email/verification/*` paths.
   - `<frontend>/login` shows the plain "Forgot password?" link; `<frontend>/forgot-password` loads directly (deep link).
   - Backend logs show no startup errors.

If a new deployment fails its health check, Railway keeps the previous deployment running; nothing is lost.

---

## 4. Additive database changes (applied automatically at backend startup)

| Change | Effect on existing data |
|---|---|
| New table `auth_tokens` (created by `create_all`) | None: new and empty. |
| `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ` | Existing users get NULL = "not verified". |
| `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0` | Existing users get 0. Existing logins keep working (tokens without a version read as 0). |

Nothing is dropped, renamed or rewritten. Re-running is safe. The `users` table is tiny, so the change is instantaneous.
Read-only verification after deploy (Railway Postgres Query tab or the approved read-only SSH method):

```sql
SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('email_verified_at','token_version');   -- 2 rows
SELECT to_regclass('public.auth_tokens');                                                                                                -- auth_tokens
SELECT id, username, role, is_active, email_verified_at IS NOT NULL AS verified FROM users ORDER BY id;                                  -- never SELECT *
```

---

## 5. Administrator recovery email, `ayub` (separate approval; this one changes a live row)

Today `ayub` has the seeded address `ayub@socialgenius.au`. That domain does not exist, so no email could reach it, and it is unverified. Until this step, a reset
request for `ayub` sends nothing (the screen looks identical on purpose).

Run inside the backend container (the script ships in the image):

1. Dry run (changes nothing; shows masked addresses and the plan):
   `railway ssh --service socialgenius-unified-preview -- python scripts/set_recovery_email.py --username ayub --email socialgenius.au@gmail.com`
2. After approval, apply (changes only `ayub`'s `email`, clears `email_verified_at`, cancels open links, emails a confirmation link):
   `... --apply --confirm-username ayub`
3. Open the confirmation email in the Gmail inbox (check spam) and click the link. The page says **Email confirmed**.
4. Read-only check: `ayub` shows `verified = true` and the email ends in `@gmail.com` (use the masked output or the SELECT in §4).
5. If the email does not arrive: look in Resend's dashboard logs; re-run step 2 (it only resends; limit 3 per hour); if the link expired, use "Send a new confirmation email".

To undo: run the same script with another `--email` (a different address is always set unverified first). The old value is not secret; note it before applying.

---

## 6. Rollback

Rollback is fast and needs no database repair. Rehearsed on a throwaway database with the real code: old code on an empty database, then the new code on that
database (columns/table added, user kept, old session still valid), then the **old code again on the upgraded database**: sign-in and old and new sessions all still worked.

| Situation | Action |
|---|---|
| Something is wrong after deploy | Railway → each service → Deployments → pick the previous successful deployment → **Rollback**. Backend and frontend both, for consistency. Minutes. |
| You want the branch itself back | Do **not** force-push. Add two revert commits (`git revert b7f8d3a c2937cb`, newest first) and push; services redeploy the old behaviour. |
| Database | Nothing to undo. The extra table and columns are ignored by the old code (they have defaults / are nullable). Dropping them is possible but unnecessary and not recommended. |
| Variables | Leave them (harmless), or delete the three email variables. |
| `ayub` email change | Re-run the script with the desired address, or leave it. |
| Passwords reset during testing | A reset cannot be undone, but a new reset can set any password; the account is never locked out as long as its email is verified. |

---

## 7. Real end-to-end test (after §3 passes and §5 is done)

Use a private browser window.
1. `<frontend>/login` → click **Forgot password?** → enter `ayub` → neutral "Check your email" screen.
2. In the `socialgenius.au@gmail.com` inbox (check spam) the reset email arrives within about a minute. The link opens `/reset-password`; the address bar shows no token.
3. Enter a new password of 12+ characters; try **Show / Hide** on both fields; submit → "Password updated".
4. Sign in as `ayub` with the new password. The old password must fail.
5. Re-open the same email link → "This link has expired" (single use).
6. A "your password was changed" email arrives.
7. Negative checks: request a reset for a made-up name → the same neutral screen and **no email**; request more than 5 times within an hour → "Too many requests".
8. Another browser/device that was signed in before step 3 is signed out on its next action.
9. Spot-check an unrelated area (Video Studio V2 opens and plays) since the preview was redeployed.
Record the outcome (pass/fail per step) in the review notes.

---

## 8. Risks to the existing Content Studio preview

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Both services redeploy on the push (a few minutes of restart) | Certain; low: Railway swaps instances only after the health check passes | Deploy at a quiet time; watch both deployments |
| Startup schema change on the live preview database | Low; additive, instant, rehearsed | §4 verification; failure leaves the old deployment running |
| Existing sessions | None at deploy: tokens without a version stay valid. They end only when that user resets their password (intended) | Tell users who are signed in |
| `ayub` cannot sign in today (password mismatch) | Existing problem, not caused by this | Solved by §5 + §7 (the reset itself sets the password) |
| Email delivery: spam folder, Resend limits, test sender delivers only to the account owner | Medium for the first test | Use the Gmail inbox that owns the Resend account; check spam; verify a domain before real users |
| Resend click tracking rewriting links | Low | Disable click tracking for the domain |
| A mail scanner that runs JavaScript could open a **verification** link and use it up | Low; harmless to security | "Send a new confirmation email" recovery exists on that screen |
| Rate limits are per process and in memory (reset on restart); limits key on client IP | Low | Backend runs one worker and already trusts Railway's forwarded address; if it ever mis-identified clients, everyone would share one hourly bucket, so confirm in §7 step 7 that two networks are counted separately |
| Link host is configuration, not request data | None; but a wrong `FRONTEND_BASE_URL` breaks every link | Copy the exact origin; test in §7 |
| Secrets | Low | Only in Railway's masked variables; never in chat or screenshots |
| Other modules | None expected | No Video Studio V2, Post Creator or Deconstructor file changed; master clock byte-identical; no dependency changes |
| The dev-only sign-in credentials hint | None in production | Already absent from production builds (verified) |

---

## 9. Approvals needed, in order
1. Approve the checklist (this document).
2. You provide a Resend key and set the §2 variables (or approve me guiding you through them); backend redeploys.
3. Approve the push in §1 (steps 1 and 2).
4. Approve the live `ayub` email change in §5 (dry run first).
5. Run §7 together.
