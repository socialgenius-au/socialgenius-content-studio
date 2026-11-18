# Learn stage correction and project identity (2026-11-14)

## 1. What the Learn screen used to show — source of every item

All of it was **hard-coded demonstration data** in `LearnTab.tsx`. The screen made no API call, read no project state and had no connection to any analytics source.

| Displayed | Source | Category |
|---|---|---|
| Reach 28.4K (+24%), Engagement 4.2K (+18%), Shares 1.3K (+32%), Watch Time 12.6K (+20%) | constants `METRICS` | 4 — hard-coded demonstration data |
| "Performance Over Time" chart (Reach / Engagement / Watch Time, dated 14–20 Aug) | constants `DATES`, `SERIES` ("sample points … a believable trend line") | 4 — hard-coded |
| "Strong interest in 'Stock Availability'", "CTA 'Visit our showroom today' performed best", "Most viewers dropped off after 10 seconds", "Mobile retention could be improved" | constant `TOP_INSIGHTS` (about the demo client ABC Tiles) | 4 — hard-coded; reads as audience data |
| "Try a shorter 10-second version", "Add testimonial in opening", "Test new hook options" | constant `WHAT_TO_TRY` | 4 — hard-coded; not derived from the video |
| "AI Learn Mode … Create New Video →" | a button that only changed its own label | 4 — fake action |

Nothing was real data (1), calculated from verified data (2) or an AI estimate (3). No analytics integration exists anywhere in the backend: no view, reach, watch-time or retention ingestion, and no platform connection. The Review tab's "AI Quality Score 92/100" is the same kind of constant; it was **not** changed here (see limitations).

## 2. What the Learn stage shows now
- **A. Verified performance.** Only data that passes a strict parser (known metric, finite value, named source, valid measurement period) can appear, with its source and period. There is none, so the screen shows exactly: *"Not available — connect or import performance data after publishing."*
- **B. Content assessment — never audience performance.**
  - *AI Content Assessment — Not Actual Audience Performance.* The creative structure the AI inferred when it built the blueprint (scene roles, mechanisms and principles, the AI's own confidence and stated limits). It is existing AI output; no new AI call is made.
  - *Project checks.* Calculated from this project's timeline and text (length, opening, reading speed, text size, contrast, footage variety, audio, call to action). Each has evidence, a confidence level and reasoning, and is marked "Measured" or "Rule of thumb".
- **C. Recommendations.** Built only from those findings. Each is *Measured in this project* (the problem itself is measured) or *Hypothesis — needs testing* (no audience data behind it), with a caveat. A list states what cannot be concluded yet.

## 3. The reusable learning mechanism (smallest safe one)
- A new table `learning_records` (created automatically at startup; no existing table is altered) stores, per user and per saved draft, each recommendation the person acted on: **accepted / dismissed / tested / open**, with an optional note.
- Provenance is kept: the recommendation text, basis, evidence, caveat and rule version are written once and never rewritten; only the status and note change. The draft name, blueprint id and reference video are snapshotted **server-side** from the owner's own draft, and survive the draft being renamed or deleted.
- Everything is scoped to the user (another user gets 404). No audience statistic is stored anywhere.
- Reuse: accepted recommendations from the person's other videos are shown on the Learn screen as "Lessons you kept from earlier videos" (`GET /learning/accepted`).
- **Deferred (needs approval):** feeding lessons into the Brief, Strategy or New Content steps; importing platform analytics; an AI-written assessment of the script and visuals; comparing videos.

## 4. Project identity
Root cause: `PROJECT_CLIENT_IDENTITY = { "ABC Tiles", "Builders Footfall Campaign" }` in `CreateEditTab.tsx` and a hard-coded card in `VideoStudioV2.tsx`. It was shown for every project, written into every saved draft, used as the default draft name, and sent to the AI prompt generator as the client.

Now (`video-studio-v2/identity/`): an existing non-default identity on the draft is kept exactly; otherwise the blueprint's business and topic are used; otherwise a legacy draft keeps its recorded identity; otherwise "No project selected". Saving a project with no identity records it under its draft name, never a demo client. Nothing is rewritten in bulk: a stored draft changes only when the person saves it. Draft 9 (stored identity ABC Tiles, built from a blueprint) now shows "SocialGenius — SocialGenius Content Studio".

Files changed in the previously protected editor, identity only: `VideoStudioV2.tsx` (sidebar card → `ProjectIdentityCard`), `CreateEditTab.tsx` (saved identity, default draft name, AI prompt context, publishing which draft is open). `LearnTab.tsx` was rewritten because it is the subject of the task.

## 5. Limitations
- No performance data can be shown until an import or platform connection is built (not started).
- The Brief tab and the Review tab's "AI Quality Score 92/100" are still static demonstration content (Brief is filled with the ABC Tiles brief). Same class of problem; not changed because they are outside this task.
- The heuristics (3 words/second, 3% text height) are rules of thumb and are labelled so.
- Existing drafts are not migrated; draft 9's stored identity stays ABC Tiles until it is next saved.
