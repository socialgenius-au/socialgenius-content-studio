# Unified preview deployment (`preview/unified-v1`)

A fully isolated Railway stack for hands-on testing of the unified build (Video Studio V2, Deconstructor C1–C6, Reconstruction Blueprint,
Post Creator P0–P2, Positioning). It shares **nothing** with the existing test or production services: its own backend, its own PostgreSQL
database, its own upload volume and its own frontend.

> Never put real values for the variables below in git, chat or screenshots. Generate secrets in a password manager and paste them into
> Railway's Variables tab only.

## Safety behaviour built into this branch

| Concern | Behaviour |
|---|---|
| Predictable seeded logins (`<name>123`) | **Refused on Railway.** The backend only creates a seeded user when `SEED_PASSWORD_<NAME>` holds a password of 12+ characters. No fallback password exists. `SEED_USERS_MODE=dev` aborts startup on Railway. |
| Login page hint | The `username123` hint is only rendered by the Vite dev server; it is not in any production bundle. |
| JWT signing key | On Railway the backend refuses to start if `SECRET_KEY` is the public default or shorter than 32 characters. |
| CORS | The five original origins stay fixed in code. `CORS_ALLOWED_ORIGINS` can only **add** origins. Wildcards and malformed values stop startup. |
| AI cost | All AI reasoners default **off**. Nothing paid runs unless `ANTHROPIC_API_KEY` *and* a `*_REASONER_PROVIDER` are set. |

## Environment variables

### Backend service
| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | yes | Reference the NEW Postgres service: `${{Postgres.DATABASE_URL}}` (the `postgres://` scheme is converted to asyncpg automatically). |
| `SECRET_KEY` | yes | New random string, 48+ chars. Not shared with any other service. |
| `SEED_PASSWORD_AYUB` | yes | Password for the `ayub` admin account, 12+ chars. |
| `SEED_PASSWORD_PRIYA`, `SEED_PASSWORD_IQRA` | optional | 12+ chars each. A user whose variable is missing is simply not created. |
| `CORS_ALLOWED_ORIGINS` | yes | The preview frontend's public URL, e.g. `https://<frontend>.up.railway.app` (comma-separate for several; no wildcards). |
| `UPLOAD_DIR` | yes | `/data/uploads` (on the mounted volume). |
| `ANTHROPIC_API_KEY`, `*_REASONER_PROVIDER`, `*_REASONER_MODEL` | **leave unset** | Paid AI. Enable only with explicit approval. |
| `REDIS_URL` | leave unset | Without it, background work runs in-process (fine for a preview). |

Do not set `RESET_DB`.

### Frontend service
| Variable | Required | Value |
|---|---|---|
| `VITE_API_URL` | yes | The preview backend's public URL, `https://<backend>.up.railway.app` (no trailing slash). It is baked in at **build** time; changing it needs a redeploy. |

## Railway setup (nothing here touches existing services)

Use a **new Railway project** (e.g. `socialgenius-unified-preview`) so no variable reference or setting can reach the existing stack.

1. **Project** → New Project → Empty project.
2. **Database** → New → Database → PostgreSQL. Do not link it to any other project.
3. **Backend service** → New → GitHub Repo → `socialgenius-au/socialgenius-content-studio`.
   - Settings → Source: branch **`preview/unified-v1`**, Root Directory **`backend`**.
   - Builder: Dockerfile (picked up from `backend/railway.toml`; health check `/health/live`).
   - Settings → Networking → Generate Domain (note the URL).
   - Variables: set the backend variables above (leave `CORS_ALLOWED_ORIGINS` for step 6).
4. **Volume** → on the backend service: New → Volume → mount path **`/data`**. Uploaded reference videos, frames and exports live there; without
   it they vanish at each redeploy.
5. **Frontend service** → New → GitHub Repo → same repo.
   - Source: branch **`preview/unified-v1`**, Root Directory **`frontend`**.
   - Variables: `VITE_API_URL` = the backend URL from step 3.
   - Networking → Generate Domain (note the URL).
6. Back on the backend: set `CORS_ALLOWED_ORIGINS` = the frontend URL from step 5 → it redeploys.
7. Verify: `https://<backend>/health/ready` returns OK; open the frontend, sign in as `ayub` with the password you set; open Video Studio,
   Deconstructor and Post Creator from the sidebar.

Both services redeploy automatically on every push to `preview/unified-v1` and on nothing else.

## What to expect
- A fresh database: no clients, no videos. Upload a reference video in the Deconstructor to try it; the first analysis downloads OCR/speech models
  and is slow.
- With AI off, structural analysis and the UI work, but the AI-reasoned outputs (semantic boundaries, hooks, mechanisms, Blueprint
  narrative) are not generated.
- Reset: deleting the preview project removes everything; nothing else is affected.
