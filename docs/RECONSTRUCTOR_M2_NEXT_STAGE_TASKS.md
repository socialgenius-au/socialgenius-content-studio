# M2 next stage: independent tasks

Planning only. Each card stands alone (own worktree and branch off the stabilised line, own tests, own rollback). **No paid AI service is used by any card, and none redesigns the editor.** “Protected” means it needs the editor or exporter files that need an explicit approval; cards without it can start immediately.

## M2.3 remainder: background and composition

| # | Task | Why | Touches | Needs approval? |
|---|---|---|---|---|
| 3.1 | **Footage-reach warning on plates.** From each assigned clip's real size and its Fit/Fill mode, compute the box the footage will occupy on the canvas, and flag a plate that would sit on top of footage (plates are drawn above footage). Default such plates to excluded with the reason. | Today the panel only says “check that your footage does not reach this area”. This turns the caveat into a measurement. | frontend: `background/` (pure geometry + panel text) and the footage panel's existing clip metadata | no |
| 3.2 | **Per-scene composition table.** For each scene list every generated layer (text, picture, plate, subtitle, transition) with its bucket (measured / estimated / set by you) and its stacking position, before saving. | The policy and counts exist; the scene-by-scene view that M2.3c describes does not. | frontend: `background/composition.ts` (already has `generatedLayers` with times) + panel | no |
| 3.3 | **Editable plate geometry** in the review panel (nudge the measured size and edge) with the change recorded as “set by you”. | A measured bar from a few small stills can be a few percent off. | frontend: `background/corrections.ts`, materialize, view | no |
| 3.4 | **Two-colour gradient background** as two plates split at the measured midpoint, only where the stills show a smooth gradient between bars. | The stage plan lists it; today a gradient is reported but not rebuilt. | frontend: `background/` | no |
| 3.5 | **M2.6 manifest consumer.** A read-only view that gathers `backgroundManifest`, `compositionManifest` and the other families' records into one list. | The hooks exist; nothing reads them. | frontend: new module | no |
| 3.6 | **M2.3d canvas background colour** (a colour behind a letterboxed clip, in preview and export). | The clean form of a plate: always under footage, never covering it. | **protected**: `ffmpeg_svc.build_clip_segment` (`pad` colour), `CreateEditTab`, `VideoStudioV2.css`, a draft field | **yes**: exact diff to be shown first |
| 3.7 | **M2.3e blurred-fill backdrop.** | The common vertical-video look. | **protected**: exporter filter chain + a matching preview | **yes**, only if 3.6 is not enough |

## M2.4 transitions: capability gaps

| # | Task | Why | Touches | Needs approval? |
|---|---|---|---|---|
| 4.1 | **Direction / motion evidence at cuts** (deterministic ffmpeg measurement of dominant motion direction and magnitude across each cut window) so whip pan and zoom punch can be *suggested with their measured evidence*. They are never guessed today. | Closes the largest capability gap without AI. | backend analysis step + schema field (a migration if stored) and the transitions classifier | **yes**: new stored evidence field (a database change) |
| 4.2 | **Flash and fade-through-white** detection from the existing luminance windows. | The classifier knows black dips only. | frontend: `transitions/classify.ts` + tests | no |
| 4.3 | **Offer the no-spare-frames policy** (`hold_incoming`) as a per-draft choice with an honest label (“the incoming clip's first frame is held while it dissolves in”). | A whole-file clip's dissolve shortens or becomes a cut. | request field + a small control | **yes**: it is a visible creative choice |
| 4.4 | **Editor dissolve preview** (a second video layer during the overlap). | The editor switches clips at the join. | **protected**: `CreateEditTab` | **yes**: editor change |
| 4.5 | **Reconcile editor and export fade semantics** (the editor fades a clip at both ends; the export's transition belongs to the join). | They differ in look today. | **protected**: editor and exporter | **yes**: which side moves is a design decision |

## M2.5 transcript: capability gaps

| # | Task | Why | Touches | Needs approval? |
|---|---|---|---|---|
| 5.1 | **Script routing beyond Arabic**: generalise the new font routing to Hebrew, Devanagari, Thai and others with one OFL Noto font per script (Raqm already shapes them), each verified like the Arabic one, keeping the existing warning until its script is verified. | Today these export as empty boxes and the panel warns. | `canvas_render_svc`, one font + licence per script | **yes**: protected renderer and each font's licence |
| 5.2 | **RTL-aware default alignment** for transcript subtitles (right-aligned or centred by script). | A left-aligned Urdu line reads oddly in a wide box. | frontend: `transcript/materialize.ts` defaults | no |
| 5.3 | **Line breaking for long segments** (maximum characters per line and lines per subtitle) with a visible preview. | Whisper segments can be long. | frontend: `transcript/` | no |
| 5.4 | **Subtitle timing across clip gaps and transitions** (re-map to the exported timeline now that gaps and transitions no longer shift it) and an explicit test. | Confirms the contract end to end. | tests + `transcript` mapping | no |
| 5.5 | **Word-level timing** if the stored transcript carries it (it stores segments only today); otherwise record it as unavailable. | Enables word highlight styles later. | analysis output inspection first | decision only if new analysis would be needed |
| 5.6 | **Nastaliq option for Urdu** (a second font, a style choice per project). | The current Naskh is correct but not the calligraphic style Urdu readers expect in print. | font file + routing + a style field | **yes**: licence, size and a visible style choice |

## Cross-cutting, small, independent

* **Export accuracy** (already measured, fix ready to branch on request): audio copied in passes that do not change it and one `fps=30` token for sped-up clips, with the measured before/after in the stabilisation report. Protected `ffmpeg_svc`.
* **Hosted authenticated checks** after the next preview update: portrait and landscape exports, a drafts reopen, the three M2 panels, a gap export and a real Urdu subtitle export.

## Genuine decisions needed (everything else can start)

1. Protected-file work: 3.6/3.7 (canvas background), 4.4/4.5 (editor transitions), 5.1 (other scripts), the export-accuracy fix.
2. 4.1: a new stored evidence field (database change).
3. 4.3 and 5.6: visible creative choices (held first frame; Nastaliq).
