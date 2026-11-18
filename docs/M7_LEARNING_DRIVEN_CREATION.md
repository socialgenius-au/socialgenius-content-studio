# M7 — Learning-driven creation

## Where this lives
Video Studio's **Brief** and **Creative Lab** tabs are static demonstration forms (no data connection, ABC Tiles content). The real "new video" brief and AI generation path is **Deconstructor → New Content → Blueprint** (the C4 reasoner), which produces the blueprint that "Use blueprint" turns into the editable Video Studio draft. Lessons are connected there. The two static tabs were not changed.

## The loop
1. **Learn screen (earlier video):** the person *accepts* a recommendation → `learning_records` (unchanged storage).
2. **New Content (new brief):** a new panel, **Learning from Previous Videos**, calls `POST /learning/relevant` with the brief as typed. It returns the person's accepted lessons only, ranked, each with:
   - classification (measured production observation / rule of thumb / AI-inferred suggestion / untested hypothesis / verified audience finding — the last is never produced today),
   - confidence (the documented confidence of the rule that produced it, labelled as such: it is not stored on the record),
   - source (earlier video's name, blueprint, platform, date accepted), evidence and caveat,
   - why it is or is not relevant, and any **hard conflict** with the brief (e.g. the brief prohibits on-screen text, has no call to action, or already targets ≤10 s).
   Nothing is selected by default. The person includes lessons one by one ("Select suggested" is optional) or switches lessons off entirely.
3. **Build:** the confirmation says how many lessons will be sent. The request carries only lesson *ids*; the server loads them (accepted, owned by the caller; any other id gives the same generic error).
4. **Blueprint reasoner:** receives `learning_guidance` (guidance wording, kind, confidence, measured basis, caveat, conflicts — not the earlier video's name) and an addendum to the prompt. For **each** lesson it must answer `APPLIED` (naming the new scenes it shapes and how) or `NOT_APPLIED` (and why). Server-side checks: every lesson accounted for exactly once; sections must exist; a lesson with a hard conflict can never be `APPLIED`; explanations pass the existing no-performance-claims and no-source-copy guards.
5. **Stored blueprint:** `lessons[]` with the lesson's original source, classification, confidence, evidence, caveat, the decision and the explanation; each section lists `lessons_applied`. The reuse key and blueprint id include the selection, so a different selection is a different blueprint; every earlier attempt is preserved; no existing draft is changed.
6. **Use blueprint → Video Studio:** the plan (and so the saved draft) carries the lessons per scene. Scenes stay fully editable. The video's **Learn** screen shows "Lessons this video was built with".

A request made without lessons is byte-for-byte what it was before (same prompt, same input, same blueprint ids).

## Safety
- Lessons are never described as verified improvements anywhere (UI notice, blueprint notice, prompt).
- No AI call is made by browsing, ranking or selecting lessons. Only *Build blueprint* calls the AI, as before, after the usual confirmation.
- `AI_SPEND_ENABLED` unchanged (off).

## Deferred
Brief/Creative Lab tabs inside Video Studio (static), AI-inferred suggestions as a lesson source, importing measured audience data (the "verified audience finding" class stays empty), automatic lesson capture from edits.
