# M6 — AI Visual & Creative Intelligence: assessment and decision document

Status: **assessment only.** No paid AI was called, nothing was enabled, no code or protected file was changed. Evidence was read from the live acceptance database (read-only), the repository, and the providers' official pricing pages (fetched 2026-11-06; prices change — re-verify before any spend).

## 0. Recommendation in one paragraph
Use **Anthropic (Claude)** as the single provider. The whole AI layer already exists and is built for it (six validated reasoners, guards, persistence, tests); today none of it can run, and none of it can *see* the video. The smallest safe path is: (1) fix storage and add a cost cap, (2) switch on the existing text reasoners for 5128 and look at the result, (3) add **one** new "Creative Read" stage that shows the existing keyframes to Claude and returns evidence-cited, hedged findings, (4) feed those findings into the existing anatomy → mechanisms → blueprint chain. Expected cost ≈ **$0.20–0.40 per 10–30 s video** (hard ceiling ≈ $0.5–0.75). Gemini is the better raw fit for native video/audio and cheaper per read, so it is kept as an optional second provider behind the same router, decided by a small bake-off (< $1) rather than by assumption.

## 1. What needs AI (the 19 steps for reference 5128)
| Group | Steps | Needs a paid AI API? | Today on acceptance |
|---|---|---|---|
| Measured / perception, run locally | technical probe, shot/cut detection, keyframes, speech (Whisper `base`), audio structure, on-screen text (EasyOCR), visual objects, persistence, composition, global motion, transitions, local motion, motion dynamics, transition similarity (**14**) | **No** (ffmpeg, Whisper, EasyOCR, a local detector; $0 API cost) | complete |
| Derived without AI | editing rhythm, hook window (**2**) | No | complete (hook window = first shot, 0–2.0 s, by fallback) |
| **AI reasoners** | **Scenes & Story Beats** (semantic + story-beat reasoners), **Hook classification**, **Retention devices** (**3** steps, 4 settings) | **Yes** | skipped: provider setting empty, no key |
| After the 19 (also AI) | Mechanisms, Blueprint | Yes | not run (needs the above + a key) |

Facts that shape the plan:
- Only provider `anthropic` is registered in all six reasoner routers (`semantic`, `story_beat`, `hook`, `retention`, `mechanism`, `blueprint`). The `google`/`openai` adapters in `services/ai/providers` are placeholders that raise "not implemented".
- **No reasoner sends an image.** They receive bounded text bundles (5128: hook ≈ 1.4k tokens, semantic candidates ≈ 3.6k, anatomy ≈ 3.9k). They reason about *text derived from* the video, never the pixels.
- Anatomy already lists what is missing: `narrative_role`, `messaging_role`, `emotional_function` are "not established / unsupported in v1". That is the slot M6 fills.

## 2. How "why it works" is found (and what 5128 gives us today)
5128 today: 4 shots (2.0 / 1.96 / 2.04 / 4.03 s, 17.9 cuts/min), hook window 0–2.0 s, objects (bottle, cup, bowl, donut, spoon, chair, person), speech = Roman-Urdu/Hindi mixed ("100% … bina-pani, bina-kemi-kul"), OCR = a legible product name ("BARAKAH FOODS … Ginger Garlic") next to garbled strings ("Realing", "Sloving", "Waites") typical of generated video. I did **not** view the frames (they are no longer on disk — see §8), so the visual claims below are about what the evidence can and cannot support.

| Dimension | Evidence it rests on | Method | Output (existing vocabulary) |
|---|---|---|---|
| Hook | opening window frames + first words + first text | Hook reasoner (exists) **+ Creative Read of the opening frames** | type (question, bold_claim, curiosity_gap, result_first, proof_first, pattern_interrupt, demonstration, offer_led…), elements, intent (create_curiosity, establish_credibility, promise_result…) |
| Storytelling | shots, speech, text, scene boundaries | Semantic + Story-beat reasoners (exist) | scenes, story beats, `narrative_role` |
| Persuasion | spoken/written claims ("100%… no water, no chemicals"), proof shown, offer/CTA | Creative Read + Mechanism reasoner | `proof_credibility`, `information_reveal`, `cta_next_step`; claim marked *as claimed by the source*, never verified |
| Emotional triggers | imagery (food, family, hands), music/voice tone cues, pacing | Creative Read (vision) | `emotional_function` ("appears designed to evoke warmth/appetite appeal"), `emotional_progression` |
| Visual attention | focal subject per shot, framing, contrast, motion, on-screen text placement | measured motion/layout **+** Creative Read | `visual_attention`, `text_attention`, `audio_attention` |
| Pacing | shot lengths, cuts/min | **measured — no AI needed** | `pacing_rhythm` (AI only names the pattern) |
| Retention devices | cut / text-appearance / transition candidates | Retention reasoner accepts or rejects each candidate with evidence (exists) | accepted devices + rejected candidates with reasons |

Guard rails already in code and kept: no effectiveness/virality claims, no audience-response claims, hedged "appears designed to…", no reproduction of source content, categorical confidence only.

## 3. Provider comparison (official pages, 2026-11-06)
| | **Anthropic (recommended)** | Google Gemini | OpenAI |
|---|---|---|---|
| Video / audio input | **No** — images only (28×28 px patches: 720×1280 = 1,196 tokens; 480×854 = 558) | **Native video + audio**: ≈100 tokens/s default (66/frame at 1 fps + 32/s audio), ≈300/s high-res; `MM:SS` timestamps; up to hours | Pricing page does not list native video input → frames, like Claude |
| Models & price per 1M tokens (in / out) | **Haiku 5.5 $0.10/$0.50** (≤100k prompt); **Sonnet 5.5 $2/$10**; Opus 5.5 $4/$20; Batch −50%; cache hits ≈ 0.1× | 3.5 Flash-Lite $0.30/$2.50 (all input types); 3.1 Flash-Lite $0.25/$1.50 (audio $0.50); 3 Flash Preview $0.50/$3; 3.1 Pro Preview $2/$12; Batch −50%. **Announced increases** (e.g. Flash 3.6/3.8 $0.75→$1.50 on 2027-01-01; Gemini 4 Argon $2→$4 on 2026-12-01); the 2.5 models are re-routed to newer ones on 2026-12-01 | gpt-6.1-terra $1/$5; gpt-6.1-sol $2/$10; gpt-6-luna $0.10/$0.50; transcription $0.003–0.006/min |
| Multimodal strength for this job | strong structured reasoning under strict JSON/guards; sees stills only; audio only via Whisper | best for motion, audio tone and multilingual speech in one call; JSON output not confirmed on the doc I read | strong text/vision; no advantage over Claude for this architecture except transcription |
| Reliability | stable GA models; existing code already handles truncation and retries | several "Preview" models and scheduled price/model changes → churn risk | stable; the pricing page refused one automated fetch and was read via its redirect, so re-verify figures before spend |
| Integration effort in **this** codebase | **Lowest**: SDK pinned (`anthropic>=0.44`), `get_client()`, six providers, contracts, validators, persistence, tests all exist; add image blocks | New SDK (`google-genai`) or REST, video upload, 6× provider + JSON validation; key slot `GOOGLE_AI_API_KEY` exists, adapter is a stub | New SDK, 6× providers; key slot exists, adapter is a stub |
| Fit | **Recommended single provider** | Optional second provider after a bake-off | Not recommended now |

Honest trade-off: choosing Claude means audio is understood only through Whisper (weak on code-switched Urdu/Hindi, as 5128 shows) and motion only through 1.1 fps stills. Gemini would close that gap at lower cost per read but costs a parallel integration. The router pattern lets us add it later without touching callers.

## 4. Cost estimates (per video, API only)
Assumptions: vertical short-form 720×1280; the existing extractor yields ≈1.1 keyframes/s (5128: 11 frames in 10 s); frames sent at 480×854 (558 tokens; 720×1280 ≈ +25–60%); evidence tokens follow the two real references (anatomy 3.9k tokens at 10 s, 12.3k at 44 s); retention candidates ≈ 0.45 per second; typical output per call: semantic 1k, story 1k, hook 0.9k, retention 0.7k each, mechanism 4k, blueprint 7k, Creative Read 2k + 0.15k/s (cap 6k). Prompts ≈ 1.5–2.5k tokens each. Output tokens can include model reasoning, so treat typical figures as ±2×; the **ceiling** below uses the code's own `max_tokens` caps (hook 1.5k, others 1k, mechanism 10k, blueprint 14k, Creative Read 6k).

| Pipeline (Claude, Sonnet 5.5 $2/$10) | 10 s | 30 s | 60 s |
|---|---|---|---|
| A. Existing 6 text reasoners (calls: 8 / 18 / 31) | $0.25 | $0.44 | $0.70 |
| B. New Creative Read (frames 11 / 33 / 66) | $0.06 | $0.12 | $0.17 |
| **A + B, all Sonnet 5.5** | **$0.31** | **$0.56** | **$0.87** |
| A + B, mixed (Haiku 5.5 for semantic/story/hook/retention; Sonnet for Creative Read, mechanisms, blueprint) | **$0.20** | **$0.29** | **$0.38** |
| A + B, all Haiku 5.5 | $0.015 | $0.03 | $0.04 |
| Same, Batch API (−50%, asynchronous) | $0.10–0.15 | $0.15–0.28 | $0.19–0.43 |
| **Hard ceiling at token caps (Sonnet 5.5)** | ≈ $0.5 | ≈ $0.75 | ≈ $1.1 |

Gemini alternative for the Creative Read only (native video + audio, default resolution): 3.5 Flash-Lite ≈ $0.011 / $0.019 / $0.022; 3.1 Pro Preview ≈ $0.056 / $0.10 / $0.12. Other costs: keyframes (ffmpeg) and Whisper/EasyOCR are local ($0 API); optional hosted transcription $0.003–0.006/min (≈ $0.0005–0.006 per video). Mechanism and blueprint calls are per *reference* and per *new brief*, not per scene.

## 5. Evidence quality: observed / measured / inferred / AI-supported
Reuse the existing `Certainty` enum (`MEASURED, OBSERVED, INFERRED, RESEARCH_SUPPORTED, RECOMMENDED`) and the existing `low/medium/high` confidence; add only a `basis` and citations inside the annotation's `details` JSON (no migration).

| Label | Meaning | Example on 5128 |
|---|---|---|
| **MEASURED** | computed by deterministic code | "4 shots; 17.9 cuts/min; hook window 0.0–2.0 s" |
| **OBSERVED** | a perception model read it, with its own confidence | OCR "BARAKAH FOODS"; transcript segment 0–2 s (marked low: mixed scripts); object "bowl" |
| **INFERRED** + `basis: ai_text` | AI conclusion from text evidence only | "opening appears designed to establish product credibility" |
| **INFERRED** + `basis: ai_vision` | AI conclusion that also looked at frames | "close product shot holds the viewer's focus in shot 1" — cites frame ids and `t=0.0–2.0 s` |
| RESEARCH_SUPPORTED | matches a curated, cited research playbook | reserved; none exists yet, so never emitted |
| RECOMMENDED | a suggested action for new content | blueprint instructions only |

Rules (enforced in code, not only in the prompt): every AI finding carries `certainty`, `confidence`, `start/end` seconds and the ids of the evidence it cites; a finding **cannot be more confident than its weakest cited evidence** (garbled OCR or mixed-script speech caps it at low); source claims ("100% pure") are recorded as *claims*, not facts; no performance, virality or audience-response statements (existing language guards).

## 6. How it drives reconstruction
`Creative Read + reasoners` → persisted annotations → **Content Anatomy** (fills `emotional_function`, narrative role, attention focus) → **Mechanisms** (existing types: `hook_curiosity`, `proof_credibility`, `visual_attention`, `emotional_progression`, `pattern_interruption`, `pacing_rhythm`, `cta_next_step`… each with a *transferable principle* and a non-transferable list so the source is not copied) → **New-content brief** → **Blueprint sections** (`mechanisms_applied`, duration, visual/text/speech/pacing/transition/CTA directions) → **Video Studio blueprint plan** (scenes, placeholders) → the readiness checklist and export guard already built. Effects: scene count and durations follow the measured pacing; each scene's instruction names the mechanism it must reproduce *in a new way*; the asset checklist (footage, text, voice) is generated from the sections. No editor or protected file changes.

## 7. Smallest safe implementation (dev-days, with tests; my estimate)
| # | Step | Effort | Needs approval |
|---|---|---|---|
| 0a | **Persistent storage** for `/app/uploads` (Railway volume) — see §8 | 0.5 | infra change on acceptance |
| 0b | **Cost guard**: per-video cap (default $1), usage logging per call, dry-run estimate shown in the existing confirm | 1 | – |
| 1 | Configure existing reasoners for 5128 (4 env settings + `ANTHROPIC_API_KEY`, acceptance only); read the results and cost | 0.5 + review | **paid AI + key** |
| 2 | New `creative_read` reasoner (contract, Anthropic provider with image blocks, parsing, validators, store as annotations, one orchestrator stage, skipped when unconfigured) | 4–5 | yes |
| 3 | Feed findings into anatomy and the mechanism reasoner input; show certainty/confidence/timestamp chips in the Anatomy and Mechanism views | 3 | yes |
| 4 | Pass findings into the blueprint input; asset checklist from sections | 1.5 | yes |
| 5 | *Optional:* Gemini provider behind the same router, after a bake-off on 5128 and 5127 (< $1) | 3 | later |
**Fast track to see 5128 end to end: steps 0–3 ≈ 9–10 dev-days; first real AI output after step 1 (≈ 1 day).**

Risks: ephemeral storage (below); cost runaway (mitigated by 0b and the token caps); OCR/ASR noise on generated video (mitigated by the confidence cap); prompt injection through on-screen text or speech (treated as data, existing guards); hallucinated claims (validators + guards, refusal over fabrication); frames leave our infrastructure to the provider (privacy note + rights status `unknown_third_party` already tracked); 1.1 fps stills can miss very fast details; provider/model churn (mitigated by the router and pinned model names).

**Acceptance criteria (5128):** (1) every AI finding has certainty, confidence, timestamps and cited evidence; (2) zero effectiveness/audience-response claims (guard test); (3) hook classified with ≥1 element cited to a frame or the transcript; (4) Creative Read covers all 4 shots; (5) full run costs ≤ $0.60 and stays under the cap, logged per call; (6) re-running makes no paid call unless forced; (7) with AI off the 19-step flow behaves exactly as today and the UI says which steps were skipped and why; (8) a blueprint built from the mechanisms names them per scene; (9) results and media survive a redeploy; (10) no protected editor file changed.

## 8. Prerequisite found during this assessment (affects more than M6)
On the acceptance server `/app/uploads` is **not** a mounted volume. After the last redeploys, the source videos for references 5127 and 5128 and **all** of their extracted keyframes (9 and 11) are missing from disk, while their analysis results survive in the database. Consequences: (a) any vision step needs the frames, so storage must be persistent (or frames re-extracted from a persistent source); (b) the same applies to footage Ayub uploads for Video Studio — after any redeploy those files disappear and export fails. Proposed fix: attach a Railway volume mounted at the upload path (step 0a). Until then, re-upload after each deploy.

## 9. Decisions requested
1. Approve **Anthropic** as the single provider (with Haiku 5.5 for per-candidate calls and Sonnet 5.5 for creative/mechanism/blueprint) — or choose Gemini/other.
2. Approve step 0 (volume + cost guard) for acceptance.
3. Approve a **per-video cap** (suggested $1) and a total acceptance budget for this phase (suggested $20).
4. Provide `ANTHROPIC_API_KEY` privately on the acceptance service only (I will never print or log it).
5. Approve steps 1–3 as the fast track; steps 4–5 follow your review of the 5128 output.

Sources (official, fetched 2026-11-06): Anthropic pricing and vision docs (platform.claude.com/docs/en/about-claude/pricing, /build-with-claude/vision); Google Gemini pricing and video-understanding docs (aistudio.google.com/docs/pricing, /video-understanding); OpenAI pricing (developers.openai.com/api/docs/pricing). Third-party summaries conflicted and were not used.
