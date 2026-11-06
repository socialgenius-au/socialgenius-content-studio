# First controlled AI test — your steps (about 15 minutes)

State right now: AI spending is **OFF**, no AI key exists anywhere, the limits are **$1 per reference / $20 for the phase** and are enforced on the server. The AI settings (which steps use AI and which models) are already set on the acceptance backend. Only the key and your approval are missing.

## 1. Upload the original video again (free)
App → **Reconstruct** → **Add a reference video** → choose the original `gemini_generated_video_5af9cd3c.mp4` → open the new reference → press **Deconstruct**. It takes about 80 seconds and costs nothing; the three AI steps will show as skipped. Note the **reference number** shown in the page address (`/deconstructor/<number>`).

## 2. Create the key (Anthropic)
1. Sign in at console.anthropic.com → **API keys** → **Create key**; name it `socialgenius-acceptance`. Copy it once.
2. Recommended second safety layer: **Settings → Limits** → set a monthly spend limit of **$20** (our software already stops at $20, this is a backstop at Anthropic's side).

## 3. Put the key on the server (only you ever see it)
1. railway.com → project **ayub-test-contentstudio** → at the top-left make sure the environment is **deconstructor-acceptance**.
2. Click the service **pleasing-presence** → **Variables** → **New Variable**.
3. Name: `ANTHROPIC_API_KEY`   Value: paste the key → **Add**.
4. Click **Deploy** when Railway shows the staged change. Wait until it says Active.
Do **not** paste the key into this chat or anywhere else. Do **not** add `AI_SPEND_ENABLED`.

## 4. Approve the test (a message to me)
Send exactly: `APPROVED: first AI test on reference <number>, limit $1.`
Then I will, in this order: run the safety check (it sends nothing), switch AI spending ON, run the test on that one reference (AI deconstruction steps, then the Creative Read), switch spending OFF again, and report what was found, what it cost (also visible under **Admin / Settings → AI spending**) and anything that was refused.

## If something looks wrong
- To stop everything at any time: Railway → pleasing-presence → Variables → make sure `AI_SPEND_ENABLED` is absent or `false` (or delete `ANTHROPIC_API_KEY`). The server refuses every AI request while spending is off.
- To cancel a key: Anthropic console → API keys → delete it.
