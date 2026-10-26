// Server-side render tests (no DOM): every stage renders from the ONE shared selection, and the canvas box has the registry's exact ratio.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { PostFormatProvider } from './PostFormatContext'
import { initialPostFormatState, postCreatorFormats, postCreatorPlatforms, postFormatReducer, type PostFormatState } from './formatState'
import FormatBar from '../components/FormatBar'
import PostCanvas from '../components/PostCanvas'
import BriefTab from '../tabs/BriefTab'
import CreateTab from '../tabs/CreateTab'
import ReferencesTab from '../tabs/ReferencesTab'
import ReviewTab from '../tabs/ReviewTab'
import PostCreatorV2 from '../PostCreatorV2'

const noop = () => {}
const withState = (node: ReactNode, state?: PostFormatState) => renderToStaticMarkup(<PostFormatProvider initialState={state}>{node}</PostFormatProvider>)
const stateFor = (platformKey: string, formatKey?: string, custom?: { width: number; height: number }): PostFormatState => {
  let s = postFormatReducer(initialPostFormatState(), { type: 'platform', platformKey })
  if (formatKey) s = postFormatReducer(s, { type: 'format', formatKey })
  if (custom) s = postFormatReducer(s, { type: 'custom', size: custom })
  return s
}
const attr = (html: string, name: string) => html.match(new RegExp(`${name}="([^"]*)"`))?.[1]
const selectedOption = (html: string, testId: string) => {
  const sel = html.match(new RegExp(`<select[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</select>`))?.[1] ?? ''
  return sel.match(/<option value="([^"]*)" selected=""/)?.[1]
}

describe('format bar', () => {
  it('shows PLATFORM | FORMAT | SIZE / RATIO — e.g. Instagram | Feed Portrait | 1080 × 1350 · 4:5', () => {
    const html = withState(<FormatBar />)
    expect(html).toContain('data-testid="pcv2-format-bar"')
    expect(selectedOption(html, 'pcv2-platform-select')).toBe('instagram')
    expect(selectedOption(html, 'pcv2-format-select')).toBe('feed_portrait')
    expect(html).toContain('1080 × 1350 · 4:5')
  })

  it('every platform loads and lists ONLY its applicable formats', () => {
    for (const p of postCreatorPlatforms()) {
      const html = withState(<FormatBar />, stateFor(p.key))
      expect(selectedOption(html, 'pcv2-platform-select')).toBe(p.key)
      const formatSelect = html.match(/<select[^>]*data-testid="pcv2-format-select"[^>]*>([\s\S]*?)<\/select>/)![1]
      const options = [...formatSelect.matchAll(/<option value="([^"]*)"/g)].map(m => m[1])
      expect(options).toEqual(postCreatorFormats(p.key).map(f => f.key))
    }
  })

  it('Custom shows editable width × height and the ratio readout', () => {
    const html = withState(<FormatBar />, stateFor('website', 'custom', { width: 1600, height: 900 }))
    expect(html).toContain('data-testid="pcv2-custom-width"')
    expect(html).toContain('value="1600"')
    expect(html).toContain('value="900"')
    expect(html).toContain('1600 × 900 · 16:9')
    // a non-custom format hides the inputs
    expect(withState(<FormatBar />)).not.toContain('pcv2-custom-width')
  })
})

describe('canvas follows the selection', () => {
  it('for EVERY platform x applicable format: canvas size matches the registry and the drawn box keeps the exact aspect ratio', () => {
    let n = 0
    for (const p of postCreatorPlatforms()) {
      for (const f of postCreatorFormats(p.key)) {
        const html = withState(<PostCanvas />, stateFor(p.key, f.key))
        const w = f.ratio === 'CUSTOM' ? 1080 : f.width, h = f.ratio === 'CUSTOM' ? 1080 : f.height
        expect(attr(html, 'data-canvas-width'), `${p.key}/${f.key}`).toBe(String(w))
        expect(attr(html, 'data-canvas-height')).toBe(String(h))
        expect(attr(html, 'data-platform')).toBe(p.key)
        expect(attr(html, 'data-format')).toBe(f.key)
        const bw = Number(attr(html, 'data-box-width')), bh = Number(attr(html, 'data-box-height'))
        expect(Math.abs(bw / bh - w / h) / (w / h), `${p.key}/${f.key} box ${bw}x${bh}`).toBeLessThan(0.02)   // rounding only — never stretched
        n++
      }
    }
    expect(n).toBeGreaterThanOrEqual(25)
  })

  it('switching format visibly changes the canvas shape (portrait vs square vs landscape vs 9:16)', () => {
    const shape = (platform: string, format: string) => {
      const html = withState(<PostCanvas />, stateFor(platform, format))
      return Number(attr(html, 'data-box-width')) / Number(attr(html, 'data-box-height'))
    }
    const feed = shape('instagram', 'feed_portrait'), square = shape('instagram', 'square'), story = shape('instagram', 'reel_story'), wide = shape('instagram', 'landscape')
    expect(feed).toBeCloseTo(0.8, 1)
    expect(square).toBeCloseTo(1, 1)
    expect(story).toBeCloseTo(0.5625, 1)
    expect(wide).toBeCloseTo(1.91, 1)
    expect(new Set([feed, square, story, wide].map(v => v.toFixed(2))).size).toBe(4)
  })

  it('the box always fits inside the available stage (never overflows) — checked via the shared fit maths on the fallback stage', () => {
    for (const p of postCreatorPlatforms()) for (const f of postCreatorFormats(p.key)) {
      const html = withState(<PostCanvas />, stateFor(p.key, f.key))
      expect(Number(attr(html, 'data-box-width'))).toBeLessThanOrEqual(520)
      expect(Number(attr(html, 'data-box-height'))).toBeLessThanOrEqual(480)
    }
  })

  it('the mock logo lives INSIDE the positioned canvas box (positioning defect fix) and content is not pixel-sized', () => {
    const html = withState(<PostCanvas />)
    const canvas = html.slice(html.indexOf('data-testid="pcv2-canvas"'))
    expect(canvas).toContain('pcv2-mock-post-logo')
    expect(canvas).toContain('pcv2-mock-post-content')
  })
})

describe('Brief / Create / References / Review use ONE selection', () => {
  const s = stateFor('linkedin', 'link_post')

  it('Brief', () => {
    const html = withState(<BriefTab onNext={noop} />, s)
    expect(selectedOption(html, 'pcv2-brief-platform')).toBe('linkedin')
    expect(selectedOption(html, 'pcv2-brief-format')).toBe('link_post')
  })

  it('References', () => {
    expect(selectedOption(withState(<ReferencesTab onNext={noop} onBack={noop} />, s), 'pcv2-references-platform')).toBe('linkedin')
  })

  it('Create (bar + canvas)', () => {
    const html = withState(<CreateTab onNext={noop} onBack={noop} />, s)
    expect(selectedOption(html, 'pcv2-platform-select')).toBe('linkedin')
    expect(selectedOption(html, 'pcv2-format-select')).toBe('link_post')
    expect(html).toContain('1200 × 627 · 1.91:1')
    expect(attr(html, 'data-canvas-width')).toBe('1200')
    // the format bar sits immediately above the canvas stage
    expect(html.indexOf('data-testid="pcv2-format-bar"')).toBeLessThan(html.indexOf('data-testid="pcv2-canvas-stage"'))
    // existing Create-stage navigation is intact
    expect(html).toContain('← References')
    expect(html).toContain('Next: Review →')
  })

  it('Review: primary platform is pre-selected and locked; the platform list is the registry (no hard-coded list)', () => {
    const html = withState(<ReviewTab onBack={noop} />, s)
    expect(html).toMatch(/data-testid="pcv2-publish-linkedin"[^>]*aria-pressed="true"[^>]*disabled=""|disabled=""[^>]*data-testid="pcv2-publish-linkedin"/)
    for (const p of postCreatorPlatforms()) expect(html).toContain(`data-testid="pcv2-publish-${p.key}"`)
    expect(html).not.toContain('Instagram Story')          // the old hard-coded pill labels are gone
    const extra = postFormatReducer(s, { type: 'toggleExtraPlatform', platformKey: 'facebook' })
    const html2 = withState(<ReviewTab onBack={noop} />, extra)
    expect(html2).toMatch(/data-testid="pcv2-publish-facebook"[^>]*aria-pressed="true"/)
  })

  it('the full Post Creator loads with the default selection on Brief (navigation stepper intact)', () => {
    const html = renderToStaticMarkup(<PostCreatorV2 />)
    expect(selectedOption(html, 'pcv2-brief-platform')).toBe('instagram')
    expect(selectedOption(html, 'pcv2-brief-format')).toBe('feed_portrait')
    for (const label of ['BRIEF', 'INTELLIGENCE', 'REFERENCES', 'CREATE', 'REVIEW']) expect(html).toContain(label)
  })

  it('switching platform in one stage is reflected in every other stage (same state object)', () => {
    const next = postFormatReducer(initialPostFormatState(), { type: 'platform', platformKey: 'pinterest' })
    expect(selectedOption(withState(<BriefTab onNext={noop} />, next), 'pcv2-brief-platform')).toBe('pinterest')
    expect(selectedOption(withState(<BriefTab onNext={noop} />, next), 'pcv2-brief-format')).toBe('pin')
    expect(selectedOption(withState(<ReferencesTab onNext={noop} onBack={noop} />, next), 'pcv2-references-platform')).toBe('pinterest')
    expect(attr(withState(<CreateTab onNext={noop} onBack={noop} />, next), 'data-canvas-height')).toBe('1500')
  })
})
