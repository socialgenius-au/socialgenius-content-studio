# M6 — Intelligence-to-Reconstruction pipeline: what changed, what is free, what costs money

Scope: acceptance environment only. Production and `main` are untouched. AI spending stays **OFF** (`AI_SPEND_ENABLED` unset). Nothing in this document is a paid call.

## 1. Scene / story-beat reliability

**Root cause (reference 5131).** The model wrote a label as `"label ("NET WT fLOZ (100g)") that recurs"`: unescaped quotation marks inside a JSON string. The parser rejected the reply, and the cost ledger had already stored it as a *successful* answer, so a plain retry would have been served the same broken text for free and failed again.

Three layers, none of which hides a paid result:

| Layer | What it does | Cost |
|---|---|---|
| Deterministic repair (`json_recovery.loads_lenient`) | Escapes stray inner quotation marks, drops trailing commas, extracts the object. It only inserts backslashes or deletes trailing commas, never rewrites content; unrepairable text re-raises the original error. Tested with the real 5131 reply as a saved fixture and a 200-case property test. | $0 |
| `invalid_output` ledger status | A reply the parser still rejects is kept in the ledger, **counted against the budget**, and **never served from the duplicate cache**. | $0 |
| One bounded fresh retry (`run_reasoner_call`) | After a rejected paid reply, exactly one forced new request is made (both replies are kept). A second rejection stops. Refusals, billing and budget errors are never retried. | one extra call, only when a reply is rejected |

## 2. Creative Read → Mechanisms → Blueprint

The mechanism step reads **only** the content anatomy, and the blueprint step reads the mechanisms' transferable principles. So the creative reading is joined at the anatomy, which carries it forward through the existing pins and with no new tables.

* **Anatomy** (deterministic, no AI): when a stored Creative Read exists, each section gets what the AI saw in its frames, its findings (ids you can cite), and a video-level `reconciliation`.
* **Reconciliation** (authority order, highest first): measured timing → what the frames visibly show (inferred) → OCR ≥ 0.9 → text-only AI conclusions and low-confidence recognition → speech-to-text without a recorded confidence, with mixed scripts or low engine log-probability (**unverified**). Disagreements are labelled `established`, `partly_corroborated`, `disputed` or `unverified`, not blended. Audience effects are always "not established" (no viewer data).
* **Mechanisms** (prompt `v3`): may cite `creative_findings`; a mechanism that rests only on unverified speech or low-confidence text cannot be `high`; emotional mechanisms are capped below `high`; a principle may not repeat what the AI said it saw.
* **Blueprint**: unchanged schema, so the Video Studio hand-off is untouched; it benefits because the principles it consumes now include visual ones.
* **Keyframe selection**: all 11 of 11 frames are now used (it was 9).
* A change to the anatomy changes its fingerprint, so older mechanisms show as **stale** (never hidden) until re-derived. That is intended.

## 3. Transcription

Free experiment on 5131's own audio, local Whisper, no provider:

| Model | Language | Result | Engine log-probability |
|---|---|---|---|
| `base` (current) | auto | `100% шود, bina-pani, bina-kemi-kul` (mixed scripts) | −0.68 |
| `base` | forced Urdu | Arabic script, different words | −0.51 |
| `small` | auto (detects Hindi) | `शुद, बिना पानी, बिना केमिकल` / `माओने बनाया, बरकासे सजाया` | **−0.27** |
| `small` | forced Hindi | identical to auto | −0.27 |
| `small` | forced Urdu | Arabic script, worse | −0.56 |

**Smallest reliable improvement: Whisper `small`, automatic language detection.** A language hint adds nothing. `medium` was deliberately not run on the live container (about 5 GB of memory).

How it is stored (`transcript_alt_svc`, endpoints `POST|GET /reference-videos/{id}/transcript-alternatives`):

* The **original is never modified**. The second reading is a separate record with model, language hint, detected language, raw engine diagnostics and the original segments it re-reads.
* Every alternative is `machine_transcript_unverified` and `quotable: false`. Better engine confidence makes a reading more plausible, not verified.
* Agreement with the original is reported only when both are in the same script; across scripts it says "not comparable".
* The preferred reading is one that is clearly more confident (≥ 0.15 log-probability) or better formed, and never a malformed one swapped for a well-formed one.
* The mechanism step sees it as `speech_reading`: an aid to understanding, with no id, so it cannot be cited or quoted.
* Cost: **$0**. About 1–4 minutes of server CPU the first time (the 461 MB model downloads once per deployment).

### Paid transcription options (proposal only — NOT activated)

Published prices, to be re-confirmed before any approval:

| Option | Price | 10-second reference | Note |
|---|---|---|---|
| OpenAI `gpt-4o-mini-transcribe` | about $0.003 / min | well under $0.001 | needs a new key and a new provider adapter |
| OpenAI `gpt-4o-transcribe` | about $0.006 / min | about $0.001 | same |
| Google Gemini transcription | about $0.003 / min | well under $0.001 | same |

Recommendation: do not add a provider yet. Local `small` fixes the 5131 defect for free. Revisit only if a real-user test shows `small` is still unreliable on a language mix that matters.

## 4. Estimated cost of the next real-user test (needs separate approval)

| Step | Model | Estimate |
|---|---|---|
| Story-beat retry (forced, with the repair now in place) | Haiku | about $0.01 |
| Mechanisms from the enriched anatomy | Sonnet | about $0.10–0.15 |
| Blueprint | Sonnet | about $0.05–0.10 |
| Creative Read refresh | not needed; the stored result is reused | $0 |
| **Total** | | **about $0.20–0.30**, well inside the $1 per-reference cap |

The free steps (speech re-read, rebuilding the anatomy, dry-run of the prompts) need no approval.
