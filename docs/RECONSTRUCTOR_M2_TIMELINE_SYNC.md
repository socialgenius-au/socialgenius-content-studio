# Timeline synchronisation: the contract, the defect, the correction

Branch `fix/m2-timeline-sync` (from the integration checkpoint `6d5366b`). **Not pushed to `preview/unified-v1`, not deployed.**

## 1. The timeline contract

What the editor does (read from `CreateEditTab.tsx`, `ReviewTab.tsx`, `StudioContext`; nothing there was changed) and what the exporter did before this change.

| Element | Editor | Exporter before | Exporter now |
|---|---|---|---|
| Clip position | clip k occupies `[startTime_k, endTime_k)`; clips are back to back and never overlap | clips are laid out by their summed durations, then each join **overlapped** the two segments (`xfade`/`acrossfade`) | each clip's footage sits at its own start time; a join never overlaps anything |
| Timeline length | last clip's end | `Σ durations − Σ overlap` (cut = 0.05 s, dissolve/fade = its duration) | exactly the last clip's end, in whole frames |
| Transition | no dissolve preview at all (a switch at the join); “Fade” fades the clip's own first and last frames over its `transitionDuration` | `xfade` overlap centred on nothing: it ate into both clips and pulled everything after it earlier | see §3 |
| Scene boundaries (blueprint joins) | the clip joins | the same joins, but footage after the first join arrived early | unchanged by the planner; footage sits on them |
| Text, image, shape, lower third, subtitle | visible for `start <= t < end` | at absolute times (correct) but **end-inclusive** (`between(t,s,e)`): one frame too long | absolute times, end-exclusive like the editor |
| V2 B-roll inserts | absolute times | absolute times, one frame too long | absolute times, end-exclusive |
| Narration / music (A1) | absolute times | absolute times (correct), but footage after a join drifted away from them | absolute times; footage no longer drifts |
| Exported duration | timeline length | shorter by every overlap | equals the timeline |

Everything laid at absolute times was right; the footage was wrong. After the first join the footage arrived early against every layer, subtitle and voice-over.

## 2. Measured defect (real MP4s, real `render_project`)

Synthetic clips: every frame carries a frame-index barcode, each clip its own colour and tone; layers are shapes; narration and music are tones on A1. Decoded back from the MP4. 540×960; 960×540 gave the same numbers.

| Scenario | Timeline | Old export | Footage after the join vs the editor (old) | New export | New offset |
|---|---|---|---|---|---|
| 3 clips, 2 hard cuts | 9.00 s | 8.90 s | clip C **+100 ms** early | 9.00 s | 0 ms |
| 1.0 s dissolve | 8.00 s | 7.00 s | clip B **+1000 ms** early | 8.00 s | 0 ms |
| 1.0 s fade through black | 8.00 s | 7.00 s | clip B **+1000 ms** early | 8.00 s | 0 ms |
| dissolve + fade + cut, one 1.0 s clip | 10.00 s | 8.87 s | C **+1100 ms**, D **+1133 ms**; the 1.0 s clip never appeared on its own (“never pure”) | 10.00 s | 0 ms |
| dissolve, silent clip, separated clip, narration | 9.00 s | 8.37 s | B **+600 ms**, C **+633 ms**; narration cut off at 8.34 s | 9.00 s | 0 ms |
| dissolve with speed 2× / 0.5× | 6.00 s | 5.37 s | B **+308 ms** | 6.00 s | +8 ms (see §5) |
| a 0.4 s clip between two 1.0 s dissolves | 5.00 s | the old exporter did not finish (stopped after more than ten minutes) | | 5.00 s | 0 ms |
| layer end | | one frame late (+33 ms) | | | 0 ms |

Audio: with hard cuts every clip tone and the narration/music tones start and end within 0.1 s of the contract (the remainder is the 40 ms analysis window and AAC priming); across a blend the two clips' audio cross-fades centred on the join; a silent clip (no audio stream, muted or separated to A1) contributes no tone while the narration on A1 stays at its absolute times (6.0–9.0 s measured 6.0–8.97 s).

## 3. The correction

`backend/app/services/timeline_plan.py` (new, pure) decides, in whole frames, where every clip sits and how each join is realised; `ffmpeg_svc.py` builds the join graph from that plan.

* **Frames, not seconds.** Boundaries are rounded cumulatively from the clips' end times, and every segment is forced to its planned frame and sample count in the graph, so no rounding accumulates across joins.
* **Hard cut:** the last frame of one clip is directly followed by the first frame of the next (`concat`); nothing overlaps.
* **Fade through black:** fades inside the two clips' own spans (outgoing fades out over the first half of the duration, incoming fades up over the second, audio fades with it). Nothing is borrowed, nothing moves.
* **Dissolve / wipe / zoom:** the blend window is centred on the join, `[J−x, J+y]`. The incoming clip supplies **real source frames from before its trim-in**, the outgoing clip **real frames after its trim-out**; both clips' main footage stays where the editor puts it. The window is as long as the transition asks for, **shortened to the frames the source file really has**. If a side has none, the other supplies the whole window; if neither does, the join is a hard cut. Frames are never invented, and **the outgoing clip is never frozen by default**.
* **Opt-in `hold_incoming`** (`transition_edge_policy` on the render project; not reachable from the editor): where the incoming clip has no frames before its trim-in, its first frame is repeated while it dissolves in, ending at the join. The outgoing clip still continues only with real frames. Measured: timeline exact, footage offsets 0. Whether this looks right is a creative decision; it is off.
* **Opt-in `hold`:** repeats the edge frame on both sides. Measured exact; not recommended (it freezes the outgoing clip).
* **Short clips:** the two windows touching one clip are shrunk proportionally so both fit inside it.
* **Layer windows:** `enable='gte(t,s)*lt(t,e)'` instead of `between(t,s,e)` for pictures, shapes, lower thirds, text, subtitles and V2 inserts.

## 4. Verification

* `tests/test_timeline_plan.py` (15, pure): cuts, cumulative rounding, real-frame blends, shortening, no spare frames, unknown source length, hold policies, fades, short clips, speed, **300 randomised projects × three policies keep the timeline length**, the graph's offsets.
* `tests/test_timeline_sync_render.py` (5, real ffmpeg): frame counts (180 / 150 / 150 / 120 / 150), per-clip content offset ≤ 1 frame, blend window centred on the join, darkest frame of a fade at the join, a muted clip, layer visible exactly `[1 s, 5 s)`, each clip's tone starting and ending on its own times.
* Harness scenarios above: 8 scenarios × portrait, 5 × landscape; contact sheets of the frames around a dissolve and around a `hold_incoming` join were inspected.

## 5. What is deliberately not changed, and notes

* **Editor vs export fade semantics.** The editor's “Fade” fades a clip in at its own start **and** out at its own end over `transitionDuration` each. The exporter's join semantics (transition *k* governs join *k→k+1*, total dip = the duration) are unchanged. They differ in look; changing the editor is a protected change nobody approved.
* **First/last clip fades.** The editor fades a first clip in from black; the exporter does not. Unchanged.
* **Dissolve look.** The editor's `dissolve` maps to ffmpeg's pixel-wise `dissolve` (grainy), not a smooth crossfade. Unchanged. The editor has no dissolve preview.
* **Speed changes.** A clip at 2× shows its source about two source frames early (−67 ms) and a 0.5× clip +8 ms. Identical on the old exporter; it comes from the speed filter's frame selection, not from the join. Unchanged.
* A clip whose source has **no spare frames** (the whole file is used) now gets a shorter blend or a hard cut where it used to get a blend that shifted everything. If you want the blend kept at full length in that case, `hold_incoming` is the option to approve.
* Clips are assumed back to back (as before); a gap between clips is still closed.

## 6. Files

`backend/app/services/timeline_plan.py` (new), `backend/app/services/ffmpeg_svc.py` (join graph, `render_project` call site, end-exclusive layer windows; `build_clip_segment` and the legacy `/process` path untouched), `backend/tests/test_timeline_plan.py`, `backend/tests/test_timeline_sync_render.py`. No dependency, Dockerfile, Railway, migration or frontend file.

Rollback: revert the commit; the old overlap behaviour returns.
