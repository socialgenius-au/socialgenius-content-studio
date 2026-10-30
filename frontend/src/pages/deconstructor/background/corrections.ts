// M2.3b -- what a person can change on a plate candidate, kept APART from the evidence. Pure.
import { fromUser, measured, type Prop } from './contract'
import type { PlateCandidate } from './candidates'

export interface PlateCorrection { include?: boolean; color?: string }
export type PlateCorrections = Readonly<Record<string, PlateCorrection>>

export const isHexColour = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

export function setPlateCorrection(all: PlateCorrections, id: string, patch: Partial<Record<keyof PlateCorrection, unknown>>): PlateCorrections {
  const next: PlateCorrection = { ...(all[id] ?? {}) }
  if ('include' in patch) { if (typeof patch.include === 'boolean') next.include = patch.include; else delete next.include }
  if ('color' in patch) { if (isHexColour(patch.color)) next.color = patch.color.toLowerCase(); else delete next.color }
  const rest = { ...all }
  if (Object.keys(next).length === 0) delete rest[id]; else rest[id] = next
  return rest
}

export interface ResolvedPlate { candidate: PlateCandidate; include: boolean; color: Prop<string>; corrected: ('include' | 'color')[] }

export function resolvePlate(c: PlateCandidate, corr: PlateCorrection | undefined): ResolvedPlate {
  const corrected: ('include' | 'color')[] = []
  const include = corr?.include ?? c.includeByDefault
  if (corr?.include !== undefined) corrected.push('include')
  const color = corr?.color && corr.color.toLowerCase() !== c.color.toLowerCase() ? (corrected.push('color'), fromUser(corr.color.toLowerCase())) : measured(c.color, `The average colour of the bar on ${c.framesSeen} still${c.framesSeen === 1 ? '' : 's'} of scene ${c.sceneNumber}.`)
  return { candidate: c, include, color, corrected }
}
