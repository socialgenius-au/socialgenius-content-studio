# Forgot Password and email verification

Branch: `feature/forgot-password` (based on `preview/unified-v1`). Backend is implemented and tested; the three screens (plus a verify-email page)
are awaiting design approval and are not built yet.

## How it works

1. A user enters their **username or email** on the Forgot Password page.
2. The API **always answers the same way** (HTTP 202, same message). If, and only if, the account exists, is active, and has a **verified**
   email address, a one-time link is emailed through Resend. The link works once and expires after 30 minutes.
3. The link opens `/reset-password#token=…`. The page POSTs the token and the new password; the token is in the URL *fragment*, so it is never
   sent to a server, written to an access log, or leaked in a Referer header.
4. On success the password is replaced, **every existing session is invalidated** (HTTP and WebSocket), other open links are cancelled, and a
   "password changed" notice is emailed.

### Endpoints (all under `/auth`)

| Endpoint | Auth | Limit (per IP) | Notes |
|---|---|---|---|
| `POST /password-reset/request` `{identifier}` | none | 5 / hour | Always 202. No database work before answering. |
| `POST /password-reset/validate` `{token}` | none | 20 / hour | `{valid: bool}`; never consumes the link. |
| `POST /password-reset/confirm` `{token, new_password}` | none | 10 / hour | 400 `invalid_token` or 400 `weak_password` (a weak password does **not** use up the link). Never 401. |
| `POST /email/verification/request` | signed in | 5 / hour | Emails a verification link to the account's address. |
| `POST /email/verification/confirm` `{token}` | none | 10 / hour | Marks the address verified. |

Per account there is also a hard cap of **3 links per hour per purpose**; extra requests are silently ignored (same response).

### Security properties
- Tokens: 256-bit random; only a SHA-256 hash is stored (`auth_tokens`); expiry and single use are decided atomically by the database clock.
- A newer link cancels older ones. A link stops working if the account's email changes or the account is disabled after it was sent.
- Email ownership: reset links are only sent to addresses with `users.email_verified_at` set, which happens only when someone opens a one-time link
  delivered to that address.
- Sessions: each JWT carries `tv` (the user's `token_version`). A reset increments it, so every older token is rejected by `current_user` and by the
  WebSocket endpoint. Tokens issued before this feature (no `tv`) count as version 0 and stay valid until the first reset.
- Passwords: at least 12 characters, at most 72 bytes (bcrypt's limit), no leading/trailing space, not equal to the username or email.
- Logs never contain tokens, links, passwords, hashes or email addresses (only user ids).

## Database changes (all additive, applied automatically at startup)
- New table `auth_tokens` (created by `create_all`).
- `users.email_verified_at TIMESTAMPTZ NULL` and `users.token_version INTEGER NOT NULL DEFAULT 0` (added by `app/schema_patches.py`).
- Every existing user starts **unverified**, so no reset email can be sent to anyone until their address has been verified.

## Environment variables (backend service)

| Variable | Required | Meaning |
|---|---|---|
| `RESEND_API_KEY` | yes (secret) | Existing Resend integration. Without it no email is sent. |
| `AUTH_FROM_EMAIL` | recommended | Sender, e.g. `SocialGenius <no-reply@your-verified-domain>`. Falls back to `NOTIFY_FROM_EMAIL`. Must be on a Resend-verified domain. |
| `FRONTEND_BASE_URL` | yes | Exact public origin of the frontend, e.g. `https://socialgenius-content-studio-production-b423.up.railway.app`. Used only to build email links. While empty, no link is ever sent. |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | optional | Default 30. |
| `EMAIL_VERIFY_TOKEN_TTL_HOURS` | optional | Default 24. |

No frontend environment variable is needed.

## Resend setup
Create a Resend account, add and verify the sending domain (DNS records), create an API key and set it as `RESEND_API_KEY`. Until a domain is
verified, Resend's shared test sender only delivers to the Resend account owner's own address, which is enough to test end to end.

## Proving ownership of the `ayub` recovery email (separate approval required)

Nothing here runs automatically and nothing is changed in any live database by merging or deploying this code, except the additive columns and table above.

Prerequisites: this branch deployed to the preview backend with `RESEND_API_KEY`, `AUTH_FROM_EMAIL` and `FRONTEND_BASE_URL` set.

1. **Dry run** (changes nothing, shows masked addresses and the plan):
   `railway ssh --service socialgenius-unified-preview -- python scripts/set_recovery_email.py --username ayub --email <address>`
2. After approval, **apply**:
   `… python scripts/set_recovery_email.py --username ayub --email <address> --apply --confirm-username ayub`
   It updates only `users.email` and clears `email_verified_at` for that one row, cancels open links, and emails a verification link to the new address.
3. The owner of that mailbox opens the link (`/verify-email#token=…`). Only then is the address marked verified and eligible for reset links.
4. Re-running with the same address only resends the verification link (limit 3 per hour).

The script refuses to proceed if email sending is not configured, if another account already uses the address, or if `--confirm-username` does not
match. It never prints a link, token, password or hash.

## Rollout order (nothing below has been done)
1. Approve the screens, build the frontend, test.
2. Set the backend variables above on the **preview** backend (no production variables are touched).
3. Deploy the branch to the preview services (restart applies the additive schema patches).
4. Run the ownership procedure for `ayub` (steps above).
5. Test the full flow with a real mailbox.

## Known limitations
- Rate limits are in memory per backend process (fine for one worker, reset on restart). A Redis-backed limiter would be the next step.
- The login endpoint itself still has only the existing 5 attempts per minute per IP limit and no per-account lockout.
- There is no self-service "change email" screen: changing an address is an operator action (the script above).
- Passwords are not checked against breach lists (that would need an outbound service call).
