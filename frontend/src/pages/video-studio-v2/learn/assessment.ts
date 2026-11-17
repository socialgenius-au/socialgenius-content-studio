// B. CONTENT ASSESSMENT. Checks computed from THIS project's own timeline, text and blueprint. They are NOT AI judgements and NOT audience data, and none of them predicts performance.
// Each finding says what was measured (evidence), how sure we are (confidence) and why it matters (reasoning). A "heuristic" is a rule of thumb, shown as such.
// The blueprint's own AI-inferred creative structure is passed through separately (aiStructure) and labelled as AI output.
import type { BlueprintPlan } from '../blueprint/blueprintPlan'

export const LEARN_RULE_VERSION = 'learn-v1'
export const READING_WPS_LIMIT = 3          // heuristic: more than about 3 words per second is hard to read on a short video
export const TEXT_HEIGHT_PCT_MIN = 3        // heuristic: text shorter than about 3% of the frame height can be hard to read on a phone
export const CONTRAST_MIN = 4.5             // WCAG AA contrast ratio for normal text

export interface AssessInput {
  canvas: { width: number; height: number }
  clips: { startTime: number; endTime: number; assetId?: number | null; muted?: boolean }[]
  texts: { text: string; startTime: number; endTime: number; fontSize: number; color: string; bgColor?: string; bgOpacity?: number }[]
  audioTrackCount: number
  plan: BlueprintPlan | null
}

export interface Finding {
  id: string
  title: string
  finding: string
  evidence: string[]
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
  kind: 'measured' | 'heuristic'
  /** structured values the recommendation rules use (never shown as results) */
  data?: Record<string, unknown>
}

export interface AssessmentFacts { durationSeconds: number; clipCount: number; distinctSources: number; textCount: number; audioTrackCount: number; frameHeight: number }
export interface Assessment { facts: AssessmentFacts; findings: Finding[] }

const r1 = (n: number) => Math.round(n * 10) / 10
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length

function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a), lb = luminance(b)
  if (la == null || lb == null) return null
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Which scene (1-based) a moment falls in: the blueprint's scene when there is one, else the clip it falls in. */
function sceneAt(input: AssessInput, t: number): number | null {
  if (input.plan) {
    const s = input.plan.scenes.find(sc => t >= sc.startTime - 1e-6 && t < sc.endTime - 1e-6)
    if (s) return s.sceneNumber
  }
  const idx = [...input.clips].sort((a, b) => a.startTime - b.startTime).findIndex(c => t >= c.startTime - 1e-6 && t < c.endTime - 1e-6)
  return idx >= 0 ? idx + 1 : null
}

export function assessProject(input: AssessInput): Assessment {
  const clips = input.clips
  const duration = Math.max(0, ...clips.map(c => c.endTime), ...input.texts.map(t => t.endTime))
  const sources = new Set(clips.map(c => c.assetId).filter((x): x is number => typeof x === 'number'))
  const facts: AssessmentFacts = { durationSeconds: r1(duration), clipCount: clips.length, distinctSources: sources.size, textCount: input.texts.length, audioTrackCount: input.audioTrackCount, frameHeight: input.canvas.height }
  const findings: Finding[] = []

  if (clips.length) {
    findings.push({
      id: 'length', title: 'Length and pacing', kind: 'measured', confidence: 'high',
      finding: `The video runs ${r1(duration)} s across ${clips.length} ${clips.length === 1 ? 'clip' : 'clips'} (about ${r1(duration / clips.length)} s each).`,
      evidence: clips.map((c, i) => `Clip ${i + 1}: ${r1(c.startTime)}–${r1(c.endTime)} s`),
      reasoning: 'Read directly from the timeline. It says nothing about how viewers respond to the length.', data: { duration: r1(duration), clips: clips.length },
    })
  }

  const texts = [...input.texts].sort((a, b) => a.startTime - b.startTime)
  if (texts.length) {
    const first = texts[0]
    findings.push({
      id: 'opening_text', title: 'Opening', kind: 'measured', confidence: 'high',
      finding: first.startTime <= 0.05 ? `On-screen text is visible from the first frame (${words(first.text)} words, until ${r1(first.endTime)} s).` : `The first on-screen text appears at ${r1(first.startTime)} s; the opening is text-free until then.`,
      evidence: [`First text: ${r1(first.startTime)}–${r1(first.endTime)} s, ${words(first.text)} words`],
      reasoning: 'Read directly from the timeline. Whether this holds attention is not known without viewer data.', data: { firstTextStart: r1(first.startTime) },
    })

    const rates = texts.map(t => ({ scene: sceneAt(input, t.startTime), words: words(t.text), seconds: Math.max(0.1, t.endTime - t.startTime), wps: words(t.text) / Math.max(0.1, t.endTime - t.startTime) }))
    const fast = rates.filter(r => r.wps > READING_WPS_LIMIT)
    findings.push({
      id: 'reading_speed', title: 'Text reading speed', kind: 'heuristic', confidence: 'medium',
      finding: fast.length ? `${fast.length} of ${rates.length} text overlays show more than ${READING_WPS_LIMIT} words per second.` : `All ${rates.length} text overlays stay at or under ${READING_WPS_LIMIT} words per second.`,
      evidence: rates.map(r => `${r.scene ? `Scene ${r.scene}` : 'Text'}: ${r.words} words in ${r1(r.seconds)} s (${r1(r.wps)} words/second)`),
      reasoning: `Words and seconds are measured; the ${READING_WPS_LIMIT} words/second limit is a common rule of thumb, not a result from your audience.`,
      data: { fast: fast.map(f => ({ scene: f.scene, words: f.words, seconds: r1(f.seconds), wps: r1(f.wps) })) },
    })

    const sizes = texts.map(t => ({ scene: sceneAt(input, t.startTime), px: t.fontSize, pct: (t.fontSize / input.canvas.height) * 100 }))
    const small = sizes.filter(s => s.pct < TEXT_HEIGHT_PCT_MIN)
    findings.push({
      id: 'text_size', title: 'Text size on a phone', kind: 'heuristic', confidence: 'low',
      finding: small.length ? `${small.length} of ${sizes.length} text overlays are under ${TEXT_HEIGHT_PCT_MIN}% of the frame height.` : `All ${sizes.length} text overlays are at least ${TEXT_HEIGHT_PCT_MIN}% of the frame height.`,
      evidence: sizes.map(s => `${s.scene ? `Scene ${s.scene}` : 'Text'}: ${s.px}px on a ${input.canvas.width}×${input.canvas.height} canvas (${r1(s.pct)}% of height)`),
      reasoning: 'Sizes are measured. The threshold is a rule of thumb that was not checked on real devices, so confidence is low.', data: { small: small.map(s => ({ scene: s.scene, px: s.px, pct: r1(s.pct) })), canvasHeight: input.canvas.height },
    })

    const contrasts = texts.map(t => {
      const solid = (t.bgOpacity ?? 0) >= 0.5 && t.bgColor
      return { scene: sceneAt(input, t.startTime), ratio: solid ? contrastRatio(t.color, t.bgColor as string) : null }
    })
    const known = contrasts.filter(c => c.ratio != null) as { scene: number | null; ratio: number }[]
    const low = known.filter(c => c.ratio < CONTRAST_MIN)
    findings.push({
      id: 'contrast', title: 'Text contrast', kind: 'measured', confidence: known.length === contrasts.length ? 'medium' : 'low',
      finding: !known.length ? 'The text has no solid background, so its legibility depends on the footage behind it (not assessed).'
        : low.length ? `${low.length} text overlays have a contrast ratio below ${CONTRAST_MIN}:1 against their background chip.` : `Every text overlay with a solid background chip meets ${CONTRAST_MIN}:1 contrast (lowest ${r1(Math.min(...known.map(k => k.ratio)))}:1).`,
      evidence: contrasts.map(c => (c.ratio == null ? `${c.scene ? `Scene ${c.scene}` : 'Text'}: no solid background (depends on footage)` : `${c.scene ? `Scene ${c.scene}` : 'Text'}: ${r1(c.ratio)}:1`)),
      reasoning: 'Colour contrast is calculated (WCAG formula) from the chosen text and background colours; it ignores the footage behind a semi-transparent chip.', data: { low: low.map(l => ({ scene: l.scene, ratio: r1(l.ratio) })) },
    })
  }

  if (clips.length > 1) {
    findings.push({
      id: 'source_variety', title: 'Footage variety', kind: 'measured', confidence: 'high',
      finding: sources.size === 1 ? `All ${clips.length} clips are cut from the same source recording.` : `The ${clips.length} clips come from ${sources.size || 'unknown'} different source recordings.`,
      evidence: [`${sources.size} distinct source file${sources.size === 1 ? '' : 's'} used`],
      reasoning: 'Counted from the clips’ source files. A single source is not wrong by itself; it limits how different the scenes can look.', data: { distinctSources: sources.size, clips: clips.length },
    })
  }

  const muted = clips.filter(c => c.muted).length
  findings.push({
    id: 'audio', title: 'Audio', kind: 'measured', confidence: 'high',
    finding: `${input.audioTrackCount} separate audio ${input.audioTrackCount === 1 ? 'track' : 'tracks'}; ${muted} of ${clips.length} clips have their original sound muted.`,
    evidence: [`Audio tracks: ${input.audioTrackCount}`, `Muted clips: ${muted} of ${clips.length}`],
    reasoning: 'Read directly from the timeline. Whether the sound holds attention is not known without viewer data.',
  })

  const last = input.plan?.scenes[input.plan.scenes.length - 1]
  if (last) {
    const inLast = texts.filter(t => t.startTime >= last.startTime - 1e-6 && t.startTime < last.endTime + 1e-6)
    findings.push({
      id: 'cta', title: 'Call to action', kind: 'measured', confidence: 'high',
      finding: last.cta ? (inLast.length ? `The closing scene has a call-to-action instruction and ${inLast.length} text overlay${inLast.length === 1 ? '' : 's'} during ${r1(last.startTime)}–${r1(last.endTime)} s.` : 'The closing scene has a call-to-action instruction but no text overlay during it.') : 'The blueprint has no call-to-action instruction for the closing scene.',
      evidence: [`Closing scene: ${r1(last.startTime)}–${r1(last.endTime)} s`, ...inLast.map(t => `Text: “${t.text.slice(0, 80)}”`)],
      reasoning: 'Matched from the blueprint’s closing scene and the text overlays. Which call to action works better is not known without viewer data.', data: { hasCta: !!last.cta, ctaTexts: inLast.map(t => t.text.slice(0, 120)) },
    })
  }
  return { facts, findings }
}

// ── AI-derived creative structure (comes from the blueprint's AI analysis; passed through, not recomputed) ──
export interface AiSceneStructure { scene: number; role: string; seconds: number; confidence: string; mechanisms: { id: string; type: string; principle: string }[]; limitations: string[]; referenceSections: number[] }

export function aiStructure(plan: BlueprintPlan | null): AiSceneStructure[] {
  if (!plan) return []
  return plan.scenes.map(s => ({ scene: s.sceneNumber, role: s.structuralRole, seconds: s.duration, confidence: s.confidence, mechanisms: s.mechanisms.map(m => ({ id: m.id, type: m.type, principle: m.principle })), limitations: s.limitations, referenceSections: s.anatomySections }))
}
