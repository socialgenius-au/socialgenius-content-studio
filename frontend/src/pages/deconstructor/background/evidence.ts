// M2.3a -- from per-still measurements to per-SCENE background evidence. Pure; the evidence is DEEP-FROZEN so nothing later (candidates, corrections, layers) can alter it.
// Stills are assigned to the draft's scenes by the same reference-to-plan time map every other reconstruction path uses.
import type { PlanScene } from '../../video-studio-v2/blueprint/blueprintPlan'
import { readImageEvidence, type FrameEvidence, type ImageEvidenceInput } from '../imagelayers/evidence'
import { mapTime, type TimeMap } from '../textlayers/corrections'
import { SIDES, deepFreeze, round3, type Side, type VarianceClass } from './contract'
import type { FrameBackground, PaletteEntry } from './measure'

export interface SceneBar { side: Side; size: number; color: string; uniformity: number; framesSeen: number; frameIds: number[] }
export interface SceneGradient { side: Side; size: number; halves: [string, string]; uniformity: number; framesSeen: number; frameIds: number[] }
export interface SceneBackground {
  sceneNumber: number
  startTime: number
  endTime: number
  /** Stills of this scene whose pixels were read. */
  framesMeasured: number
  /** Stills of this scene that could not be read (network, a cross-origin refusal): they count for nothing. */
  framesUnreadable: number
  bars: SceneBar[]
  /** Smooth gradients along an edge, where no flat bar was found. */
  gradients: SceneGradient[]
  palette: PaletteEntry[]
  variance: VarianceClass | null
}
export interface BackgroundEvidence {
  referenceVideoId: number
  videoAnalysisId: number
  frameSize: { width: number; height: number } | null
  durationSeconds: number | null
  frameCount: number
  scenes: SceneBackground[]
}

type RGB = [number, number, number]
const toRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const toHex = (c: RGB) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length

function averageColour(colors: string[]): string {
  const rgb = colors.map(toRgb)
  return toHex([mean(rgb.map(c => c[0])), mean(rgb.map(c => c[1])), mean(rgb.map(c => c[2]))])
}

function mergePalettes(palettes: PaletteEntry[][]): PaletteEntry[] {
  const bins = new Map<number, { n: number; share: number; colors: string[] }>()
  for (const p of palettes) for (const e of p) {
    const [r, g, b] = toRgb(e.color)
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const cur = bins.get(key) ?? { n: 0, share: 0, colors: [] }
    cur.n++; cur.share += e.share; cur.colors.push(e.color); bins.set(key, cur)
  }
  return [...bins.entries()].sort((a, b) => b[1].share - a[1].share || a[0] - b[0]).slice(0, 3).map(([, e]) => ({ color: averageColour(e.colors), share: round3(e.share / palettes.length) }))
}

function majority(classes: VarianceClass[]): VarianceClass | null {
  if (classes.length === 0) return null
  const order: VarianceClass[] = ['busy', 'gradient', 'solid']                       // a tie goes to the more cautious reading
  const count = (c: VarianceClass) => classes.filter(x => x === c).length
  return order.reduce((best, c) => (count(c) > count(best) ? c : best), order[0])
}

/** `measurements`: frame id -> the measurement, or null when that still could not be read. */
export function buildBackgroundEvidence(
  ref: ImageEvidenceInput, videoAnalysisId: number, measurements: ReadonlyMap<number, FrameBackground | null>,
  scenes: readonly Pick<PlanScene, 'sceneNumber' | 'startTime' | 'endTime'>[], map: TimeMap,
): BackgroundEvidence {
  const base = readImageEvidence(ref, videoAnalysisId)
  const sceneOf = (f: FrameEvidence) => {
    const t = mapTime(map, f.timestamp)
    return scenes.find((s, i) => t >= s.startTime && (t < s.endTime || (i === scenes.length - 1 && t <= s.endTime)))
  }
  const byScene = new Map<number, { frames: FrameEvidence[]; measured: { id: number; m: FrameBackground }[]; unreadable: number }>()
  for (const s of scenes) byScene.set(s.sceneNumber, { frames: [], measured: [], unreadable: 0 })
  for (const f of base.frames) {
    const sc = sceneOf(f)
    if (!sc) continue
    const slot = byScene.get(sc.sceneNumber)!
    slot.frames.push(f)
    const m = measurements.get(f.id)
    if (m) slot.measured.push({ id: f.id, m }); else slot.unreadable++
  }
  const out: SceneBackground[] = scenes.map(s => {
    const slot = byScene.get(s.sceneNumber)!
    const bars: SceneBar[] = []
    for (const side of SIDES) {
      const seen = slot.measured.map(x => ({ id: x.id, b: x.m.bars.find(b => b.side === side) })).filter((x): x is { id: number; b: NonNullable<typeof x.b> } => !!x.b)
      if (seen.length === 0) continue
      bars.push({
        side, size: round3(median(seen.map(x => x.b.size))), color: averageColour(seen.map(x => x.b.color)), uniformity: round3(mean(seen.map(x => x.b.uniformity))),
        framesSeen: seen.length, frameIds: seen.map(x => x.id),
      })
    }
    const gradients: SceneGradient[] = []
    for (const side of SIDES) {
      if (bars.some(b => b.side === side)) continue                                // a flat bar on that edge wins
      const seen = slot.measured.map(x => ({ id: x.id, g: x.m.gradients?.find(g => g.side === side) })).filter((x): x is { id: number; g: NonNullable<typeof x.g> } => !!x.g)
      if (seen.length === 0) continue
      gradients.push({
        side, size: round3(median(seen.map(x => x.g.size))), halves: [averageColour(seen.map(x => x.g.halves[0])), averageColour(seen.map(x => x.g.halves[1]))], uniformity: round3(mean(seen.map(x => x.g.uniformity))),
        framesSeen: seen.length, frameIds: seen.map(x => x.id),
      })
    }
    return {
      sceneNumber: s.sceneNumber, startTime: s.startTime, endTime: s.endTime, framesMeasured: slot.measured.length, framesUnreadable: slot.unreadable, bars, gradients,
      palette: slot.measured.length ? mergePalettes(slot.measured.map(x => x.m.palette)) : [], variance: majority(slot.measured.map(x => x.m.variance)),
    }
  })
  return deepFreeze({ referenceVideoId: ref.id, videoAnalysisId, frameSize: base.frameSize, durationSeconds: base.durationSeconds, frameCount: base.frames.length, scenes: out })
}

/** Read every still through `readPixels` (injectable: the browser reader in the app, a fake in tests) and measure it. A still that cannot be read is null, never an error. */
export async function measureFrames(
  frames: readonly FrameEvidence[], readPixels: (path: string) => Promise<{ width: number; height: number; data: ArrayLike<number> } | null>,
  measure: (img: { width: number; height: number; data: ArrayLike<number> }) => FrameBackground, isCancelled: () => boolean = () => false,
): Promise<Map<number, FrameBackground | null>> {
  const out = new Map<number, FrameBackground | null>()
  for (const f of frames) {
    if (isCancelled()) break
    try { const img = await readPixels(f.path); out.set(f.id, img ? measure(img) : null) } catch { out.set(f.id, null) }
  }
  return out
}
