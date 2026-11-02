// M2.3b -- what a person can change on a plate candidate, kept APART from the evidence. Pure.
import { MAX_BAR, MAX_OFFSET, MIN_PLATE, fromUser, measured, round3, type Prop } from './contract'
import type { PlateCandidate } from './candidates'

/** include: your yes/no; color: "#rrggbb"; size: the bar's thickness as a share (0..1) of the canvas height (top/bottom) or width (left/right); offset: how far in from its edge the bar starts, as a share of the same dimension (0 = against the edge). */
export interface PlateCorrection { include?: boolean; color?: string; size?: number; offset?: number }
export type PlateCorrections = Readonly<Record<string, PlateCorrection>>

export const isHexColour = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

export function setPlateCorrection(all: PlateCorrections, id: string, patch: Partial<Record<keyof PlateCorrection, unknown>>): PlateCorrections {
  const next: PlateCorrection = { ...(all[id] ?? {}) }
  if ('include' in patch) { if (typeof patch.include === 'boolean') next.include = patch.include; else delete next.include }
  if ('color' in patch) { if (isHexColour(patch.color)) next.color = patch.color.toLowerCase(); else delete next.color }
  if ('offset' in patch) { if (typeof patch.offset === 'number' && Number.isFinite(patch.offset) && patch.offset >= 0 && patch.offset <= MAX_OFFSET) next.offset = round3(patch.offset); else delete next.offset }
  if ('size' in patch) { if (typeof patch.size === 'number' && Number.isFinite(patch.size) && patch.size >= MIN_PLATE && patch.size <= MAX_BAR) next.size = round3(patch.size); else delete next.size }
  const rest = { ...all }
  if (Object.keys(next).length === 0) delete rest[id]; else rest[id] = next
  return rest
}

export interface ResolvedPlate { candidate: PlateCandidate; include: boolean; color: Prop<string>; size: Prop<number>; offset: Prop<number>; corrected: ('include' | 'color' | 'size' | 'offset')[] }

export function resolvePlate(c: PlateCandidate, corr: PlateCorrection | undefined): ResolvedPlate {
  const corrected: ('include' | 'color' | 'size' | 'offset')[] = []
  const include = corr?.include ?? c.includeByDefault
  if (corr?.include !== undefined) corrected.push('include')
  const color = corr?.color && corr.color.toLowerCase() !== c.color.toLowerCase() ? (corrected.push('color'), fromUser(corr.color.toLowerCase())) : measured(c.color, `The average colour of the bar on ${c.framesSeen} still${c.framesSeen === 1 ? '' : 's'} of scene ${c.sceneNumber}.`)
  const size = corr?.size !== undefined && corr.size !== c.size ? (corrected.push('size'), fromUser(corr.size)) : measured(c.size, `Measured on ${c.framesSeen} still${c.framesSeen === 1 ? '' : 's'} of scene ${c.sceneNumber}.`)
  const measuredOffset = c.offset ?? 0
  const offset = corr?.offset !== undefined && Math.abs(corr.offset - measuredOffset) > 1e-9 ? (corrected.push('offset'), fromUser(corr.offset)) : measured(measuredOffset, measuredOffset > 0 ? 'The inner step of a measured gradient starts this far in from the edge.' : 'Against the edge of the frame, where it was measured.')
  return { candidate: c, include, color, size, offset, corrected }
}
