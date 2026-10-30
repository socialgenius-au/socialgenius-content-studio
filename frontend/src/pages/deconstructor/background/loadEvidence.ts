// M2.3a -- the only I/O of the background path: ONE read of the existing reference-video endpoint (GET, no side effects) and a read-only load of each still already served by the app
// (to read its pixels). Nothing is analysed on the server, nothing is written, no AI provider is called. A still that cannot be loaded or read simply counts as "not read".
import type { ReferenceVideo } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { readImageEvidence } from '../imagelayers/evidence'
import type { PixelImage } from '../textlayers/appearance'
import { STALE_ANALYSIS_MESSAGE } from '../textlayers/loadEvidence'
import { errorMessage } from '../useDeconstructor'
import type { TimeMap } from '../textlayers/corrections'
import { buildBackgroundEvidence, measureFrames, type BackgroundEvidence } from './evidence'
import { measureFrame } from './measure'

/** What identifies the evidence a panel shows: the reference and the analysis (blueprint) it was built from. The panel reloads when, and only when, this changes. A page re-render, a footage
 *  assignment or a freshly built plan object with the same ids must NOT reload it (that would discard the person's unsaved choices). */
export const evidenceKey = (plan: Pick<BlueprintPlan, 'referenceVideoId' | 'videoAnalysisId'>) => `${plan.referenceVideoId}:${plan.videoAnalysisId}`

export type PixelReader = (framePath: string) => Promise<PixelImage | null>

/** Loads a still in CORS mode (a distinct query string, so a copy cached by a plain <img> without CORS headers cannot be handed back) and returns its pixels, or null when refused. */
export function browserPixelReader(frameUrl: (path: string) => string): PixelReader {
  const cache = new Map<string, Promise<PixelImage | null>>()
  const load = (url: string) => new Promise<PixelImage | null>(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx || !canvas.width || !canvas.height) return resolve(null)
        ctx.drawImage(img, 0, 0)
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height)
        resolve({ width: d.width, height: d.height, data: d.data })
      } catch { resolve(null) }                                                                  // a tainted canvas refuses pixel access
    }
    img.onerror = () => resolve(null)
    img.src = `${url}${url.includes('?') ? '&' : '?'}pixels=1`
  })
  return framePath => {
    const url = frameUrl(framePath)
    if (!url) return Promise.resolve(null)
    if (!cache.has(url)) cache.set(url, load(url))
    return cache.get(url)!
  }
}

export type LoadedBackgroundEvidence =
  | { kind: 'ready'; evidence: BackgroundEvidence }
  | { kind: 'no_frames' }
  | { kind: 'error'; message: string }

export async function loadBackgroundEvidence(
  plan: Pick<BlueprintPlan, 'referenceVideoId' | 'videoAnalysisId' | 'scenes'>, timeMapFor: (referenceSeconds: number | null) => TimeMap,
  getReference: (id: number) => Promise<ReferenceVideo>, readPixels: PixelReader, isCancelled: () => boolean = () => false,
): Promise<LoadedBackgroundEvidence> {
  try {
    const ref = await getReference(plan.referenceVideoId)
    if (ref.latest_analysis && ref.latest_analysis.id !== plan.videoAnalysisId) return { kind: 'error', message: STALE_ANALYSIS_MESSAGE.replace('its text no longer matches', 'its stills no longer match') }
    const base = readImageEvidence(ref, plan.videoAnalysisId)
    if (base.frames.length === 0) return { kind: 'no_frames' }
    const measurements = await measureFrames(base.frames, readPixels, measureFrame, isCancelled)
    return { kind: 'ready', evidence: buildBackgroundEvidence(ref, plan.videoAnalysisId, measurements, plan.scenes, timeMapFor(base.durationSeconds)) }
  } catch (e) {
    return { kind: 'error', message: `Could not read the reference’s stills. ${errorMessage(e, 'Please try again.')}` }
  }
}
