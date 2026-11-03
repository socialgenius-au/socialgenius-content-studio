# What the Reconstructor rebuilds, what it approximates, and what it cannot

This replaces the older wording that said text burned into a reference is "not re-created as editable text". That was true of the first assembly stage and has not been true since M2.1a. The stored table is `pages/deconstructor/assembly/elementClasses.ts` (copied into every assembled draft).

The reconstruction applies a reference's *look and structure* to **your own footage**. It never inserts the reference's footage, and it never recovers the reference's own pixels, fonts, effects or layers. Everything below is an account of what can be put back as native Video Studio V2 layers.

## Rebuilt as an editable native layer
| What the analysis found | Becomes | Evidence it rests on |
|---|---|---|
| Text it READ with OCR (captions, titles, labels, handles, price tags) | An editable text layer (Text panel) | The reading's wording and box (measured), its timing (inferred between sampled stills) |
| Subtitle lines read from the picture | A text layer per line, or better the Transcript panel's subtitle segments | As above; a subtitle *pattern* is a judgment, not checked against speech |
| A flat band along a frame edge (letterbox bar) | A native rectangle or banner shape (Background panel) | Measured colour and size on the stills |
| A smooth gradient along an edge | Two flat steps, at most | Average colour of each half |
| A scene's order and length | Clips, trims and placeholders from the blueprint | The blueprint plan |

## Approximated (a native layer exists, with estimated properties)
- **Text:** font size and colour are estimated from a small still; alignment is as read; the font family, weight, effects and animation are not recovered and are never claimed. Timing is a guess between sampled frames (stills are a few seconds apart).
- **A watermark or handle:** rebuilt as text. Whether it was the reference's own handle or one you should replace is your call. It is *text*; it is never turned into a logo.
- **Shapes:** drawn above your footage; they only make sense where your footage does not reach (see `proposals/BACKGROUND_BEHIND_FOOTAGE.md` for the proposal to place them behind).
- **A crop of the reference** (image slots only, opt-in, with your confirmation of rights): a plain rectangle of a low-resolution still, background included, enlarged, so soft.

## Filled only by your own content
- **Image slots** (a labelled box the detector found, a mark the analysis inferred from repeated text, a region you mark, or an element you classify as a logo or graphic): the slot keeps the analysis's box and timing, and **you supply the image**. For an element you classified as a logo, no crop of the reference is offered at all. Nothing in the analysis says what a mark looks like.
- **Text you reword**, and **footage**.

## Not rebuilt (unsupported)
- The reference's footage, picture, colour grade, effects and audio mix (flattened).
- People in the reference's footage (a detected person is the reference's own picture, not a graphic).
- Text OCR could not read, or read too unsurely; one- and two-character fragments.
- A text-free logo or graphic the detector did not box: it is invisible to the analysis. You can mark its region by hand and supply your image.
- Textures and true gradients; anything behind overlays or text (no inpainting or background restoration).
- Rotation, keyframed motion and animation (the editor's layer types have none).

## How you can see this in the product
Add `?m2=visual` (with `text-layers`, `image-layers` and `background` to see the layers they make) on the Create step. "What was found on screen" lists every element with its class, confidence, reasons, evidence and what could be rebuilt; the Reconstruction manifest then lists, for each element, whether it was rebuilt, approximated, replaced by your content, needs your image, was not included, or is unsupported.
