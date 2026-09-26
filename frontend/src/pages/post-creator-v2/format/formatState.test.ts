import { describe, expect, it } from 'vitest'
import { canvasOf, initialPostFormatState, postCreatorFormats, postCreatorPlatforms, postFormatReducer, type PostFormatState } from './formatState'

const run = (s: PostFormatState, ...actions: Parameters<typeof postFormatReducer>[1][]) => actions.reduce(postFormatReducer, s)

describe('Post Creator shared format state', () => {
  it('starts on Instagram Feed Portrait 4:5', () => {
    const s = initialPostFormatState()
    expect(s.selection).toMatchObject({ platformKey: 'instagram', formatKey: 'feed_portrait' })
    expect(canvasOf(s)).toMatchObject({ width: 1080, height: 1350, ratioLabel: '4:5' })
    expect(s.extraPlatformKeys).toEqual([])
  })

  it('offers all nine platforms and only post-applicable formats', () => {
    expect(postCreatorPlatforms().map(p => p.label)).toEqual(['Instagram', 'Facebook', 'TikTok', 'YouTube', 'LinkedIn', 'Pinterest', 'X', 'Google Business Profile', 'Website / General'])
    expect(postCreatorFormats('tiktok').map(f => f.key)).toEqual(['vertical'])
    expect(postCreatorFormats('instagram').map(f => f.key)).toContain('carousel')
  })

  it('one selection: switching platform then format keeps a valid, resolvable canvas each time', () => {
    let s = initialPostFormatState()
    for (const p of postCreatorPlatforms()) {
      s = run(s, { type: 'platform', platformKey: p.key })
      expect(s.selection.platformKey).toBe(p.key)
      for (const f of postCreatorFormats(p.key)) {
        s = run(s, { type: 'format', formatKey: f.key })
        expect(canvasOf(s)).toMatchObject({ platformKey: p.key, formatKey: f.key })
      }
    }
  })

  it('an unknown format is ignored (state stays valid)', () => {
    const s = run(initialPostFormatState(), { type: 'format', formatKey: 'does_not_exist' })
    expect(s.selection.formatKey).toBe('feed_portrait')
  })

  it('Review publish targets can never contradict the primary platform', () => {
    let s = run(initialPostFormatState(), { type: 'toggleExtraPlatform', platformKey: 'linkedin' }, { type: 'toggleExtraPlatform', platformKey: 'facebook' })
    expect(s.extraPlatformKeys).toEqual(['linkedin', 'facebook'])
    s = run(s, { type: 'toggleExtraPlatform', platformKey: 'instagram' })       // primary: not toggleable
    expect(s.extraPlatformKeys).toEqual(['linkedin', 'facebook'])
    s = run(s, { type: 'platform', platformKey: 'linkedin' })                    // becomes primary -> removed from extras
    expect(s.selection.platformKey).toBe('linkedin')
    expect(s.extraPlatformKeys).toEqual(['facebook'])
    s = run(s, { type: 'toggleExtraPlatform', platformKey: 'facebook' })
    expect(s.extraPlatformKeys).toEqual([])
    expect(run(s, { type: 'toggleExtraPlatform', platformKey: 'not_a_platform' })).toEqual(s)
  })

  it('Custom size is stored on the shared selection and survives switching away and back', () => {
    let s = run(initialPostFormatState(), { type: 'platform', platformKey: 'website' }, { type: 'format', formatKey: 'custom' }, { type: 'custom', size: { width: 1500, height: 600 } })
    expect(canvasOf(s)).toMatchObject({ isCustom: true, width: 1500, height: 600, ratioLabel: '5:2' })
    s = run(s, { type: 'format', formatKey: 'square' }, { type: 'format', formatKey: 'custom' })
    expect(canvasOf(s)).toMatchObject({ width: 1500, height: 600 })
  })
})
