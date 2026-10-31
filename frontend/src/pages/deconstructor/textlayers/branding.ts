// M2.1a -- text that is the reference creator's own branding, not content to reconstruct: handles, watermarks, URLs, platform names.
// These are EXCLUDED BY DEFAULT (a person can still include one). Rules are deliberately plain and explainable; each reports why.
import type { TextEvidenceGroup } from './evidence'

export type BrandingReason = 'recurring_element' | 'handle' | 'url' | 'platform_name'

const PLATFORMS = /\b(instagram|insta|tiktok|youtube|facebook|snapchat|capcut|whatsapp|twitter|linkedin)\b/i
const URL = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|co|in|io|app|me|tv)\b/i

/** A single token that looks like an account name: has an @, an underscore, or letters mixed with digits ("TANUCREATES_0", "@name", "name99"). */
function looksLikeHandle(text: string): boolean {
  if (/\s/.test(text)) return false
  if (text.length < 4 || text.length > 40 || !/^[@＠]?[A-Za-z0-9._]+$/.test(text)) return false
  return /[@＠]/.test(text) || text.includes('_') || (/[A-Za-z]/.test(text) && /\d/.test(text) && text.length >= 6)
}

export function classifyBranding(g: Pick<TextEvidenceGroup, 'text' | 'recurringIds'>): BrandingReason[] {
  const reasons: BrandingReason[] = []
  if (g.recurringIds.length > 0) reasons.push('recurring_element')        // the analysis linked it to the same element reappearing: watermark-like (INFERRED upstream)
  if (looksLikeHandle(g.text)) reasons.push('handle')
  if (URL.test(g.text)) reasons.push('url')
  if (PLATFORMS.test(g.text)) reasons.push('platform_name')
  return reasons
}

export const BRANDING_REASON_TEXT: Record<BrandingReason, string> = {
  recurring_element: 'it reappears across the video, as a watermark would (it may also just be a repeated caption word)',
  handle: 'it looks like an account handle',
  url: 'it looks like a web address',
  platform_name: 'it names a platform',
}
