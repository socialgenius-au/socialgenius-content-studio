// PROPOSAL (not wired in, not under src/): pure export guard for reconstruction projects.
// Target path if approved: frontend/src/pages/video-studio-v2/blueprint/exportGuard.ts   (a NEW, unprotected file next to blueprintPlan.ts)
//
// A "genuine reconstruction placeholder" is a text overlay that (1) carries the `blueprint` provenance tag that "Use blueprint" / Stage-2 assembly set on it AND
// (2) still starts with the placeholder prefix those flows wrote. Both are needed:
//   * the tag alone is not enough -- the editor updates text with partial patches, so the tag survives after a person has replaced the wording;
//   * the prefix alone is not enough -- ordinary text may legitimately start with "TEXT PLACEHOLDER" (a tutorial about placeholders, say).
// Projects with no blueprint-tagged overlay are not reconstruction projects: this guard returns ok and never looks at them again.
import type { TextOverlay, VideoClip } from '../../../types'
import { PLACEHOLDER_CTA_PREFIX, PLACEHOLDER_TEXT_PREFIX } from './blueprintPlan'

export type ExportCheck = { ok: true } | { ok: false; code: 'placeholders' | 'gaps'; message: string }

/** Seconds. The exporter itself overlaps junctions by 0.05 s, so anything inside that is not a gap worth reporting. */
export const GAP_TOLERANCE = 0.05

const PREFIXES = [PLACEHOLDER_TEXT_PREFIX, PLACEHOLDER_CTA_PREFIX].map(p => p.trimEnd())   // tolerate the space after the dash being edited / turned into a non-breaking space
const NBSP = new RegExp(String.fromCharCode(160), 'g')                      // contentEditable turns some spaces into non-breaking ones
const normalise = (s: string) => s.replace(NBSP, ' ').trimStart()

type Tagged = Pick<TextOverlay, 'text' | 'blueprint'>
const hasTag = (o: Tagged) => !!o.blueprint && (o.blueprint.kind === 'text' || o.blueprint.kind === 'cta')

export function isUnreplacedPlaceholder(o: Tagged): boolean {
  if (!hasTag(o) || typeof o.text !== 'string') return false
  const t = normalise(o.text)
  return PREFIXES.some(p => t.startsWith(p))
}

const fmt = (n: number) => `${Math.round(n * 10) / 10}s`

/** Run immediately before the export request is built. Pure: no I/O, no mutation. */
export function checkReconstructionExport(textOverlays: readonly Tagged[], videoClips: readonly Pick<VideoClip, 'startTime' | 'endTime'>[]): ExportCheck {
  const all = textOverlays ?? []
  if (!all.some(hasTag)) return { ok: true }                                  // not a reconstruction project: nothing here applies

  const left = all.filter(isUnreplacedPlaceholder)
  if (left.length > 0) {
    const where = left.map(o => (o.blueprint!.kind === 'cta' ? `call to action, scene ${o.blueprint!.sectionNumber}` : `scene ${o.blueprint!.sectionNumber}`))
    const n = left.length
    return {
      ok: false, code: 'placeholders',
      message: `${n} placeholder ${n === 1 ? 'text' : 'texts'} from the reconstruction blueprint ${n === 1 ? 'is' : 'are'} still in this video (${where.join('; ')}). Replace or delete ${n === 1 ? 'it' : 'them'} in Create / Edit, then export again.`,
    }
  }

  const clips = [...(videoClips ?? [])].sort((a, b) => a.startTime - b.startTime)
  let cursor = 0
  for (const c of clips) {
    if (c.startTime - cursor > GAP_TOLERANCE) {
      return {
        ok: false, code: 'gaps',
        message: `The video track has a gap from ${fmt(cursor)} to ${fmt(c.startTime)}. Export joins clips end to end, so everything after the gap would play earlier than planned and the on-screen text would be out of step. Fill the gap with footage in Create / Edit, or move the clips together.`,
      }
    }
    cursor = Math.max(cursor, c.endTime)
  }
  return { ok: true }
}
