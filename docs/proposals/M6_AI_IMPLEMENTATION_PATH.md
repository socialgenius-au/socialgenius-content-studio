# M6 — shortest safe path to AI: cost controls first, then the existing reasoners, then Creative Read

Status: **design only. No paid AI is active and no provider key is configured.** Budgets below are planning limits ($1 per video, $20 per phase), not permission to spend. Builds on `M6_AI_CREATIVE_INTELLIGENCE.md` and the storage milestone (`docs/ops/ACCEPTANCE_STORAGE.md`, verified).

## 1. What the code does today that matters for cost
- **One chokepoint exists.** All six reasoners (and the older content features) get their client from `app/services/claude.get_client()` and call `messages.create` (10 call sites, 21 `get_client()` users). A metered wrapper there governs every Anthropic spend, including non-deconstructor features.
- **Hidden retries.** The client is `AsyncAnthropic(api_key=...)` with the SDK's default `max_retries=2`: a rate-limit or 5xx can silently make up to **3 requests for one logical call**, invisible to our code. Controls must set `max_retries=0` and do bounded retries ourselves, each one accounted.
- **No spend record, no cap, no estimate.** Today nothing counts tokens or money; only `max_tokens` bounds one call's output.
- **Good news:** each reasoner already persists its attempts and refuses to fabricate; unconfigured means "skipped"; the orchestrator never re-runs a paid stage automatically (`only_if_missing`, `force_ai`).

## 2. Backend-enforced cost controls (built and tested before any key exists)
One module, `app/services/ai_metering.py`, plus one table. Every Anthropic request goes through `metered_create(scope, request)`; there is no other path to the SDK.

| Control | How it is enforced (server-side, not UI) |
|---|---|
| **Kill switch** | `AI_SPEND_ENABLED` (default `false`). Off → the call raises before any network I/O. Turning on needs the key *and* this flag. |
| **Price table** | Versioned dict of $/MTok per model (in/out/cache). A model not in the table is **refused** (no guessing). Prices re-verified before enabling. |
| **Per-call ceiling (pre-flight)** | `ceiling = est_input_tokens × in_price + max_tokens × out_price`. Input tokens: text ≈ chars/4, images by the exact patch formula `⌈w/28⌉×⌈h/28⌉`. The ceiling is what is *reserved*, so a call can never cost more than reserved. |
| **Per-video cap** | `AI_PER_VIDEO_BUDGET_USD` (default 1.00). Check-and-reserve runs in one transaction under a row lock on the `video_analyses` row: `spent + reserved + ceiling > cap` → refused with a plain message (`status=refused_budget`, nothing sent). Concurrent calls cannot both pass. |
| **Phase cap** | `AI_PHASE_BUDGET_USD` (default 20.00) over all rows with the current `AI_PHASE_ID`, checked under a Postgres advisory lock. Reaching it blocks every video until raised by config. |
| **Duplicate-call accounting** | `request_hash = sha256(model, system, messages incl. image hashes, max_tokens)`. (a) An identical **succeeded** call for the same video is answered from the stored response at $0 (`cache_hit` row) unless the caller passes `force` (recorded as such). (b) An identical call **in flight** (double click, two workers) is refused (`duplicate_in_flight`). |
| **Retry accounting** | `max_retries=0` on the SDK client. We retry only 429/5xx/overloaded/connection errors, at most 2 times with backoff; **each attempt is its own ledger row** reserved against the caps; never retry a 4xx, a refusal, a budget block or a guard rejection; abort retries if the cap would be crossed. |
| **Actuals** | After each response the row is settled with real `usage` (input/output/cache tokens) and cost; the unused part of the reservation is released. Failed requests keep their reservation until the provider's response (or timeout) shows whether they were billed, then settle at actual or $0. |
| **Visibility** | `GET /ai/usage` (admin): spend per video, per reasoner, per phase, with remaining budget. The existing confirm dialog shows the **estimate** (ceiling and typical) before any run. |
| **Fail-safe** | A ledger/DB error blocks the call (fail closed). |

Ledger table `ai_call_ledger`: `id, created_at, phase_id, user_id, reference_video_id, video_analysis_id, reasoner, provider, model, request_hash, attempt_no, status (reserved|succeeded|failed|refused_budget|duplicate_in_flight|cache_hit), est_input_tokens, input_tokens, output_tokens, cache_read_tokens, reserved_usd, cost_usd, response_text (for exact-duplicate reuse), error`. Created by the same `create_all` path as the other models (the project has no migration tool beyond `schema.sql`).

**Tests (no key, no network):** a fake Anthropic client verifies: kill switch blocks; unknown model refused; reservation uses the ceiling; per-video and phase caps refuse at the boundary; two concurrent calls cannot both pass; an identical call is served from the ledger at $0 and `force` is recorded; an in-flight duplicate is refused; a transient error retries at most twice with each attempt accounted; a 4xx never retries; actual usage settles and releases the reservation; a DB error fails closed. **Effort ≈ 1–1.5 dev-days.**

## 3. Shortest path (each step stops for your approval where marked)
| # | Step | Effort | Gate |
|---|---|---|---|
| A | Cost controls above, merged to acceptance with the kill switch **off** | 1–1.5 d | none (no spend possible) |
| B | Keyframe readiness: re-extract keyframes from the (now persistent) source when missing; downscale to 480 px JPEG for prompts | 0.5 d | none |
| C | **Enable the existing reasoners for 5128 only**: set `ANTHROPIC_API_KEY` privately, `AI_SPEND_ENABLED=true`, `SEMANTIC/STORY_BEAT/HOOK/RETENTION_REASONER_PROVIDER=anthropic` (+ models: Haiku 5.5 for retention/hook/semantic/story, Sonnet 5.5 later). Re-run deconstruct on 5128 (the three skipped steps run; completed ones are skipped). Read results + `GET /ai/usage` | 0.5 d + review | **your approval + key** |
| D | Creative Read reasoner (contract, Anthropic provider with image blocks, validators/language guards, store as annotations, one orchestrator stage, skipped when unconfigured) | 4–5 d | after C review |
| E | Feed findings into anatomy + mechanism input; certainty/confidence/timestamp chips in the views | 3 d | after D |
| F | Blueprint input + asset checklist from sections | 1.5 d | after E |
Fast track to first real AI output on 5128: A + B + C ≈ **2–2.5 dev-days** after the approvals; Creative Read adds ≈ 4–5 dev-days.

## 4. Expected spend with these controls
5128 (10 s): steps C ≈ $0.01–0.05 (Haiku 5.5) or $0.10–0.20 (Sonnet 5.5); with Creative Read ≈ $0.20–0.31 typical, **hard ceiling ≈ $0.5**, always under the $1 per-video cap. A $20 phase pays for roughly 60–100 ten-second videos at typical cost, and the phase cap stops the 101st regardless of retries or double clicks.

## 5. Approvals still needed (nothing has been enabled)
1. Approve step A now (safe: it cannot spend).
2. Later, separately: provide `ANTHROPIC_API_KEY` privately on the acceptance service and approve step C.
3. Confirm Haiku 5.5 for the small calls and Sonnet 5.5 for Creative Read / mechanisms / blueprint.
