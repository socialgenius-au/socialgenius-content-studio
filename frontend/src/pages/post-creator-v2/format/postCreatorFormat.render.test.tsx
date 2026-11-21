// Server-side render tests (no DOM). Before a post exists, the Brief stage's platform/format selects drive the ONE shared selection that sizes the new post.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { PostFormatProvider } from './PostFormatContext'
import { initialPostFormatState, postCreatorFormats, postCreatorPlatforms, postFormatReducer, type PostFormatState } from './formatState'
import BriefTab, { type BriefTabProps } from '../tabs/BriefTab'
import PostCreatorV2 from '../PostCreatorV2'
import { emptyBrief } from '../workflow'

const noop = () => {}
const withState = (node: ReactNode, state?: PostFormatState) => renderToStaticMarkup(<PostFormatProvider initialState={state}>{node}</PostFormatProvider>)
const stateFor = (platformKey: string, formatKey?: string, custom?: { width: number; height: number }): PostFormatState => {
  let s = postFormatReducer(initialPostFormatState(), { type: 'platform', platformKey })
  if (formatKey) s = postFormatReducer(s, { type: 'format', formatKey })
  if (custom) s = postFormatReducer(s, { type: 'custom', size: custom })
  return s
}
const selectedOption = (html: string, testId: string) => {
  const sel = html.match(new RegExp(`<select[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</select>`))?.[1] ?? ''
  return sel.match(/<option value="([^"]*)" selected=""/)?.[1]
}
const brief = (over: Partial<BriefTabProps> = {}): BriefTabProps => ({ draftBrief: emptyBrief(), onDraftBrief: noop, kits: [], onStart: noop, starting: false, startError: null, drafts: [], draftsError: null, onOpenDraft: noop, openingId: null, onNext: noop, ...over })

describe('the Brief stage drives the shared platform / format selection', () => {
  it('shows the selected platform and format with the exact canvas size', () => {
    const html = withState(<BriefTab {...brief()} />, stateFor('linkedin', 'link_post'))
    expect(selectedOption(html, 'pcv2-brief-platform')).toBe('linkedin')
    expect(selectedOption(html, 'pcv2-brief-format')).toBe('link_post')
    expect(html).toContain('1200 × 627 · 1.91:1')
  })

  it('every platform loads and lists ONLY its applicable formats', () => {
    for (const p of postCreatorPlatforms()) {
      const html = withState(<BriefTab {...brief()} />, stateFor(p.key))
      expect(selectedOption(html, 'pcv2-brief-platform')).toBe(p.key)
      const formatSelect = html.match(/<select[^>]*data-testid="pcv2-brief-format"[^>]*>([\s\S]*?)<\/select>/)![1]
      const options = [...formatSelect.matchAll(/<option value="([^"]*)"/g)].map(m => m[1])
      expect(options).toEqual(postCreatorFormats(p.key).map(f => f.key))
    }
  })

  it('Custom shows editable width × height and the ratio readout; a fixed format hides them', () => {
    const html = withState(<BriefTab {...brief()} />, stateFor('website', 'custom', { width: 1600, height: 900 }))
    expect(html).toContain('data-testid="pcv2-custom-width"')
    expect(html).toContain('value="1600"')
    expect(html).toContain('1600 × 900 · 16:9')
    expect(withState(<BriefTab {...brief()} />)).not.toContain('pcv2-custom-width')
  })

  it('the full Post Creator loads on Brief with the default selection and the five-stage stepper', () => {
    const html = renderToStaticMarkup(<PostCreatorV2 storage={null} />)
    expect(selectedOption(html, 'pcv2-brief-platform')).toBe('instagram')
    expect(selectedOption(html, 'pcv2-brief-format')).toBe('feed_portrait')
    for (const label of ['BRIEF', 'INTELLIGENCE', 'REFERENCES', 'CREATE', 'REVIEW']) expect(html).toContain(label)
  })
})
