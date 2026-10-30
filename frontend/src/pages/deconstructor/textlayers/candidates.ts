// M2.1a -- the text reconstruction CANDIDATE ENGINE. Pure and deterministic: frozen evidence (+ optional pixel-derived appearance) in, candidates out.
// A candidate is a PROPOSAL. It keeps a reference to the evidence it came from, labels every suggested value as measured / inferred / default, and
// carries flags for everything a reviewer should look at. Nothing here creates an editor element -- that happens only after a person approves.
import { comparable, defaulted, inferred, iou, measured, TEXT_ENGINE_VERSION, type EvidenceRef, type Flag, type Level, type Prop } from './contract'
import type { Appearance } from './appearance'
import { BRANDING_REASON_TEXT, classifyBranding, type BrandingReason } from './branding'
import type { TextEvidence, TextEvidenceGroup } from './evidence'
import { DEFAULT_CANVAS, estimateGeometry, type GeometryEstimate } from './geometry'
import { estimateTiming, isTimingUncertain, type TimingEstimate } from './timing'

/** Below this OCR confidence a reading is not trusted enough to be included without a person choosing to. */
export const LOW_CONFIDENCE = 0.5
export const DEFAULT_TEXT_COLOR = '#FFFFFF'

export interface AlternativeReading { text: string; observationId: number; confidence: number | null }

export interface TextCandidate {
  id: string                                  // "text:<group id>" -- stable across reloads because it is the evidence group's own id
  group: TextEvidenceGroup                    // the frozen evidence (referenced, never copied or edited)
  evidence: EvidenceRef[]
  sourceText: string                          // MEASURED: exactly what the OCR read
  sourceConfidence: number | null
  alternatives: AlternativeReading[]          // other distinct readings of the same text (progressive reveals, misreads), best first
  timing: TimingEstimate                      // reference-video seconds
  geometry: GeometryEstimate
  appearance: Appearance | null
  suggested: { text: Prop<string>; color: Prop<string> }
  flags: Flag[]
  branding: BrandingReason[]
  defaultInclude: boolean
}

export interface CandidateOptions {
  appearances?: ReadonlyMap<number, Appearance>        // by evidence group id; produced by sampling the frame's pixels (browser) -- optional
  canvas?: { width: number; height: number }
}

const warn = (code: Flag['code'], message: string): Flag => ({ code, severity: 'warning', message })
const info = (code: Flag['code'], message: string): Flag => ({ code, severity: 'info', message })
const lettersOrDigits = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length

function alternativesOf(g: TextEvidenceGroup): AlternativeReading[] {
  const seen = new Set<string>([comparable(g.text)])
  const out: AlternativeReading[] = []
  for (const o of [...g.observations].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.id - b.id)) {
    const k = comparable(o.text)
    if (k === '' || seen.has(k)) continue
    seen.add(k)
    out.push({ text: o.text, observationId: o.id, confidence: o.confidence })
  }
  return out
}

export function buildTextCandidates(evidence: TextEvidence, options: CandidateOptions = {}): TextCandidate[] {
  const canvas = options.canvas ?? DEFAULT_CANVAS
  const candidates: TextCandidate[] = evidence.groups.map(g => {
    const flags: Flag[] = []
    const timing = estimateTiming(g, evidence.sampleTimes)
    const geometry = estimateGeometry(g, g.text, canvas)
    const appearance = options.appearances?.get(g.id) ?? null
    const alternatives = alternativesOf(g)
    const branding = classifyBranding(g)

    if (g.confidence !== null && g.confidence < LOW_CONFIDENCE) flags.push(warn('low_confidence', `The OCR was only ${Math.round(g.confidence * 100)}% sure of this reading.`))
    if (g.confidence === null) flags.push(warn('low_confidence', 'The OCR reported no confidence for this reading.'))
    if (lettersOrDigits(g.text) <= 1) flags.push(warn('fragment', 'This is a single character or symbol: probably a piece of a logo or a misread.'))
    if (branding.length) flags.push(warn('third_party_branding', `Left out by default because ${branding.map(r => BRANDING_REASON_TEXT[r]).join(' and ')}. Handles, watermarks and similar branding are not rebuilt unless you choose to include them.`))
    if (isTimingUncertain(timing)) {
      const u = Math.max(timing.startUncertainty, timing.endUncertainty)
      flags.push(warn('timing_uncertain', `The text was only checked at sampled moments, so when it appeared and disappeared is uncertain by up to about ${u.toFixed(1)} s.`))
    }
    if (g.observations.length <= 1) flags.push(info('single_observation', 'Read in a single sampled frame, so how long it stayed on screen is a rough estimate.'))
    if (alternatives.length) flags.push(warn('alternate_readings', `Other readings of this text exist (${alternatives.length}). The chosen reading may be incomplete or misread.`))
    if (geometry.frameAssumed) flags.push(info('frame_size_assumed', 'The source frame size was not available, so a 9:16 frame was assumed for size and position.'))

    // colour: measured from pixels when the frame could be sampled with confidence; otherwise an honest default
    let color: Prop<string>
    if (appearance?.textColor && appearance.confidence !== 'low') {
      color = inferred(appearance.textColor, appearance.confidence as Level, `Estimated from the frame's pixels: ${appearance.notes.join(' ')}`)
    } else {
      color = defaulted(DEFAULT_TEXT_COLOR, appearance ? `Not reliably readable from the frame (${appearance.notes.join(' ')}); plain white used.` : 'The frame pixels were not read; plain white used.')
      flags.push(info('colour_unknown', 'The text colour could not be read reliably, so white was used. Change it if the original was a different colour.'))
    }

    const excludedByRule = branding.length > 0 || lettersOrDigits(g.text) <= 1 || g.confidence === null || g.confidence < LOW_CONFIDENCE
    return {
      id: `text:${g.id}`, group: g,
      evidence: [{ kind: 'ocr_group', id: g.id }, ...g.observations.map(o => ({ kind: 'ocr_observation' as const, id: o.id }))],
      sourceText: g.text, sourceConfidence: g.confidence, alternatives, timing, geometry, appearance,
      suggested: { text: measured(g.text, `Read by OCR (engine ${TEXT_ENGINE_VERSION} does not edit it).`), color },
      flags, branding, defaultInclude: !excludedByRule,
    }
  })

  // The same wording read twice at the same place and time is one item, not two: keep the better reading, flag the other.
  const rect = (c: TextCandidate) => ({ x: c.group.box.x, y: c.group.box.y, w: c.group.box.w, h: c.group.box.h })
  const better = (a: TextCandidate, b: TextCandidate) => ((b.sourceConfidence ?? -1) > (a.sourceConfidence ?? -1) ? b : a)
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j]
      if (comparable(a.sourceText) !== comparable(b.sourceText)) continue
      if (Math.min(a.timing.end, b.timing.end) <= Math.max(a.timing.start, b.timing.start)) continue
      if (iou(rect(a), rect(b)) <= 0.5) continue
      const loser = better(a, b) === a ? b : a
      const keeper = loser === a ? b : a
      if (!loser.flags.some(f => f.code === 'duplicate_candidate')) loser.flags.push(warn('duplicate_candidate', `The same text at the same place and time was read as another item (${keeper.id}); this copy is left out by default.`))
      loser.defaultInclude = false
    }
  }

  return candidates
}
