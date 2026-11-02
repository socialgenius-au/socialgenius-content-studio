# Reconstructor M2: changes that need your approval first

Nothing below is implemented. Each item gives the exact change, what it does to the user's workflow, and what it leaves alone. Everything already built in this stage is behind a `?m2=` preview flag and touches no protected file.

## A. Wording and small visible choices

### A1. Arabic / Urdu note in the transcript panel (visible wording)
- **Today** (per line and in the summary): "This text is in Arabic script. It looks right in the editor, but the exporter cannot lay it out correctly yet, so the exported subtitle would be wrong." and "N in a script the exporter cannot draw correctly yet".
- **Why it is now out of date:** since `fdfca26` the exporter draws Arabic-script lines with the bundled Noto Naskh Arabic (verified on Urdu sample lines, with joined letters and right-to-left order).
- **Proposed:** keep the amber flag but change the text to an information note: "This text is in Arabic script. The exporter draws it in Noto Naskh Arabic (the standard Arabic style, not the Nastaliq style often used for Urdu). Check the exported frame." The summary count becomes "N in Arabic script (exported in Noto Naskh Arabic)". Hebrew, Indic, Thai and CJK keep the current warning, because they are still unsupported.
- **Effect on the user:** an Urdu or Arabic transcript is no longer presented as a failure. Nothing is added or removed automatically.

### A2. Flash / fade-through-white (already built, flag-gated; wording for you to confirm)
- Brightness that climbs toward white and returns is now recognised. The editor has no white transition, so the panel proposes the nearest thing (a hard cut for a blink of white; a dissolve for a gradual fade through white), shows an information badge "Looks like white" and says the white itself is not recreated.
- Confirm or change the badge and note wording. No stored data or protected file is involved.

## B. Stored evidence (needs a data change)

### B1. Motion direction at cuts (task 4.1: whip pan, zoom punch)
- **Today:** the transition path never proposes whip pan or zoom punch, because the stored measurements are only frame differences and brightness.
- **Proposed change:** a new analysis step on the backend that measures, around each cut, the dominant motion direction and size with ffmpeg (no AI, no paid service) and stores it as new `AnalysisAnnotation` rows with `category = "motion_evidence"` (the column is a free string of up to 32 characters and `details` is JSON, so this is **new rows, no table migration**). Existing rows are not changed. The step runs only when a person starts it on a reference, like the existing transition-evidence pass.
- **Frontend effect:** the transitions panel reads those rows when they exist and may then propose whip pan or zoom punch **with the measured numbers shown**; with no rows it behaves exactly as now.
- **Needs approval because:** it is a new stored evidence schema and a change to the analysis pipeline.

## C. Visible creative choices

### C1. Keeping the incoming clip's first frame during a dissolve (task 4.3)
- **Today:** when a clip has no spare frames beyond the join, its dissolve shortens or becomes a hard cut (policy `shorten`). The exporter already supports `hold_incoming` (the incoming clip's first frame is held while it dissolves in) but nothing can switch it on: `transition_edge_policy` is read from the export project dictionary in `ffmpeg_svc.py` and is not part of the export request.
- **Proposed change:** (1) add an optional `transition_edge_policy` field to the export request schema (default `shorten`, allowed values `shorten`, `hold_incoming`); (2) add one control in the review step: "When a clip has no spare footage for a dissolve: shorten the dissolve (default) / hold the incoming clip's first frame while it fades in"; (3) store it in the draft so reopening keeps it.
- **Effect on the user:** default output is byte-for-byte what it is now. Choosing the second option makes the dissolve keep its full length and shows a short still at the start of the incoming clip. Touches the export request builder, which is a protected area.

### C2. Canvas background colour behind a letterboxed clip (task 3.6)
- **Today:** background bars are rebuilt as shapes that sit **on top of** the footage, so a bar can cover footage (the panel now measures and warns about this).
- **Proposed change:** one draft field `canvasBackground` (a colour), used by the exporter's `pad` colour in `ffmpeg_svc.build_clip_segment` and by the preview's letterbox area (`CreateEditTab`, `VideoStudioV2.css`). Bars whose colour is uniform and whose area is not covered by footage would be offered as "set the canvas colour" instead of a plate.
- **Effect on the user:** a letterboxed clip gets the right colour behind it in both preview and export, and nothing is drawn over footage. Default (unset) is the current black. Exact diff to be shown before any edit.

### C3. Blurred-fill backdrop (task 3.7)
Only if C2 is not enough. A matching preview and exporter filter chain. Not proposed further until C2 is decided.

## D. Protected editor behaviour

### D1. Dissolve preview in the editor (task 4.4)
The editor switches clips at the join, so a dissolve cannot be seen before exporting. Proposed: a second video layer during the overlap in `CreateEditTab`. Effect: what you preview matches the export for dissolves. Needs your approval because it changes the preview engine, including the approved master-clock playback.

### D2. Which side moves: editor fades vs export transition (task 4.5)
The editor fades a clip at both ends; the export applies a transition at the join. Option 1: change the editor to match the export (preferred; the export is what people publish). Option 2: change the export to match the editor. A design decision with a visible effect on every existing fade.

## E. Other scripts (task 5.x)
- **E1. Fonts for further scripts** (Hebrew, Devanagari/Hindi, Thai, CJK). Each needs a licence-checked bundled font and a real-text test like the Arabic one. No new system dependency. Say which scripts matter and they are done in that order.
- **E2. Nastaliq for Urdu.** A different font and shaping behaviour from Naskh; a larger piece of work with its own font review. Naskh remains the default until then.

## F. Added without needing approval (reported for completeness)
- `?m2=all` turns on every preview panel at once; `?m2=manifest` shows the read-only manifest (task 3.5). Both are preview flags, off by default, and read only.
- Subtitle position, size and line length (task 5.x). They only set ordinary subtitle properties (box position, per-subtitle size, line breaks); defaults leave the output unchanged.
