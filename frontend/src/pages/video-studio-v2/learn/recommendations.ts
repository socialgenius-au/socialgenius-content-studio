// C. RECOMMENDATIONS. Each one is built from the findings above and says which kind it is:
//   evidence   -> the problem itself is MEASURED in this project (a text overlay is too fast, contrast is too low). Whether it hurts results is still not shown by audience data.
//   hypothesis -> an idea worth testing. There is NO audience data behind it, and it is labelled so.
// `key` is stable so a decision the person makes survives re-opening the draft. `INSUFFICIENT` lists what cannot be concluded yet.
import { LEARN_RULE_VERSION, READING_WPS_LIMIT, type Assessment } from './assessment'

export interface Recommendation { key: string; text: string; basis: 'evidence' | 'hypothesis'; evidence: string[]; caveat: string; ruleVersion: string }

const NO_DATA = 'No viewer data exists for this video yet, so this has not been shown to affect results.'

export function buildRecommendations(a: Assessment): Recommendation[] {
  const f = (id: string) => a.findings.find(x => x.id === id)
  const out: Recommendation[] = []
  const rv = LEARN_RULE_VERSION

  const speed = f('reading_speed')
  for (const s of ((speed?.data?.fast as { scene: number | null; words: number; seconds: number; wps: number }[] | undefined) ?? [])) {
    out.push({
      key: `reading-speed-s${s.scene ?? 'x'}`, basis: 'evidence', ruleVersion: rv,
      text: `Give the text in ${s.scene ? `scene ${s.scene}` : 'one overlay'} more time on screen, or shorten it.`,
      evidence: [`${s.words} words in ${s.seconds} s (${s.wps} words/second; the rule of thumb is about ${READING_WPS_LIMIT})`],
      caveat: `The reading speed is measured; the ${READING_WPS_LIMIT} words/second limit is a rule of thumb, not your audience’s behaviour.`,
    })
  }

  const contrast = f('contrast')
  for (const c of ((contrast?.data?.low as { scene: number | null; ratio: number }[] | undefined) ?? [])) {
    out.push({
      key: `contrast-s${c.scene ?? 'x'}`, basis: 'evidence', ruleVersion: rv,
      text: `Increase the contrast between the text and its background in ${c.scene ? `scene ${c.scene}` : 'one overlay'}.`,
      evidence: [`Contrast ${c.ratio}:1 against its background chip (4.5:1 is the usual minimum)`],
      caveat: 'Calculated from the chosen colours; it ignores the footage behind a semi-transparent chip.',
    })
  }

  const size = f('text_size')
  const small = (size?.data?.small as { scene: number | null; px: number; pct: number }[] | undefined) ?? []
  if (small.length) {
    out.push({
      key: 'text-size-mobile', basis: 'hypothesis', ruleVersion: rv,
      text: 'Test larger on-screen text so it reads easily on a phone.',
      evidence: small.map(s => `${s.scene ? `Scene ${s.scene}` : 'Text'}: ${s.px}px is ${s.pct}% of the frame height`),
      caveat: `${NO_DATA} The size threshold is a rule of thumb that was not checked on real devices.`,
    })
  }

  const variety = f('source_variety')
  if (variety && variety.data?.distinctSources === 1 && (variety.data?.clips as number) > 1) {
    out.push({
      key: 'footage-variety', basis: 'hypothesis', ruleVersion: rv,
      text: 'Try footage from a second source recording for some scenes to add visual variety.',
      evidence: [variety.finding],
      caveat: `${NO_DATA} Using one source is not a fault; it only limits how different the scenes look.`,
    })
  }

  const len = f('length')
  if (len && (len.data?.duration as number) > 10) {
    out.push({
      key: 'shorter-cut', basis: 'hypothesis', ruleVersion: rv,
      text: 'Test a shorter cut (around 8–10 seconds) against this version.',
      evidence: [len.finding],
      caveat: `${NO_DATA} Whether viewers drop off, and when, is unknown; do not assume shorter is better.`,
    })
  }

  const open = f('opening_text')
  out.push({
    key: 'alt-opening-hook', basis: 'hypothesis', ruleVersion: rv,
    text: 'Compare this opening with an alternative first line or first shot.',
    evidence: open ? [open.finding] : ['No on-screen text is present in the opening.'],
    caveat: `${NO_DATA} Nothing shows that this opening is weak or strong.`,
  })

  const cta = f('cta')
  if (cta && cta.data?.hasCta) {
    out.push({
      key: 'alt-cta', basis: 'hypothesis', ruleVersion: rv,
      text: 'Test a second wording of the call to action.',
      evidence: [cta.finding],
      caveat: `${NO_DATA} Which call to action performs better cannot be known from one unpublished video.`,
    })
  }
  return out
}

export const INSUFFICIENT: string[] = [
  'Which scene viewers stop watching at, or whether they do.',
  'Which message, call to action or opening works better.',
  'Whether a shorter or longer version would perform better.',
  'How this video compares with your other videos or with competitors.',
]
