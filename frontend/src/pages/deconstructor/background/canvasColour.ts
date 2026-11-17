// Reconstructor -> canvas colour (optional, explicit). A flat bar measured on the reference's stills is offered as the editor's CANVAS background colour (the colour behind a letterboxed video and in timeline
// gaps; see video-studio-v2/export/canvasBackground.ts) instead of, or as well as, a bar layer. It is written into the draft ONLY when the person picks a colour here, as `canvasBackground: "#rrggbb"`.
// Nothing about the canvas FORMAT (platform, placement, size, ratio) is ever written: when the editor opens the draft it applies this one colour to whatever canvas format the editor already has.
import { resolvePlate, type PlateCorrections } from './corrections'
import type { PlateCandidate } from './candidates'

export interface CanvasColourOption { colour: string; bars: string[] }

const HEX = /^#[0-9a-f]{6}$/i
export const validCanvasColour = (v: unknown): string | null => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null)

const barLabel = (c: PlateCandidate) => `scene ${c.sceneNumber} ${c.side}${c.part ? ` ${c.part} step` : ' bar'}`

/** The distinct colours of the measured bars (with any colour you set on one), each with the bars that carry it, in the order they were measured. Includes bars you left out as layers: the colour is still yours to pick. */
export function canvasColourOptions(candidates: readonly PlateCandidate[], corrections: PlateCorrections): CanvasColourOption[] {
  const out = new Map<string, CanvasColourOption>()
  for (const cd of candidates) {
    const colour = validCanvasColour(resolvePlate(cd, corrections[cd.id]).color.value)
    if (!colour) continue
    const hit = out.get(colour)
    if (hit) hit.bars.push(barLabel(cd)); else out.set(colour, { colour, bars: [barLabel(cd)] })
  }
  return [...out.values()]
}

/** What picking `colour` will do, in plain words, for the panel to show BEFORE it is applied. */
export function canvasColourChange(colour: string | null): { changes: string[]; unchanged: string[] } {
  const c = validCanvasColour(colour)
  const unchanged = ['The canvas format: platform, placement, size and aspect ratio stay whatever the editor has.', 'Your footage, every layer, subtitles and transitions.']
  if (!c) return { changes: [], unchanged: ['The canvas colour and the canvas format stay as they are in the editor.'] }
  return { changes: [`When you open this draft, the editor's canvas background colour becomes ${c} (you can change or reset it in the editor's canvas toolbar).`], unchanged }
}

/** Pure: the snapshot with `canvasBackground` set, or the SAME snapshot when no valid colour was chosen. Never touches `canvasFormat`. */
export function withCanvasColour<S extends object>(snapshot: S, colour: string | null | undefined): S | (S & { canvasBackground: string }) {
  const c = validCanvasColour(colour)
  return c ? { ...snapshot, canvasBackground: c } : snapshot
}
