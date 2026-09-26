import { describe, expect, it } from 'vitest'
import { CANVAS_PLATFORMS, fitCanvasBox as v2FitCanvasBox, findPlacement as v2FindPlacement } from '../../pages/video-studio-v2/data/canvasFormats'
import {
  defaultFormatKeyFor, defaultSelection, findByLegacyKey, findPlacement, findPlatform, fitCanvasBox, isApplicable, MAX_CUSTOM_SIZE, MIN_CUSTOM_SIZE,
  normalizeSelection, PLATFORM_FORMATS, placementsFor, platformsFor, POST_MEDIA_TYPES, postLabel, ratioLabelFor, resolveCanvas, sanitizeCustomSize,
  selectFormat, selectPlatform, setCustomSize,
} from './index'

const ADDITIONS = ['instagram/carousel', 'facebook/link_post', 'linkedin/link_post']

describe('parity with Video Studio V2 placements (Video Studio does not consume the registry yet)', () => {
  it('has every V2 platform, in the same order', () => {
    const v2Keys = CANVAS_PLATFORMS.map(p => p.key)
    expect(PLATFORM_FORMATS.map(p => p.key)).toEqual(v2Keys)
    for (const v2 of CANVAS_PLATFORMS) expect(findPlatform(v2.key)?.label).toBe(v2.label)
  })

  it('copies every V2 placement exactly (key, label, ratio, width, height) and in the same relative order', () => {
    let count = 0
    for (const v2 of CANVAS_PLATFORMS) {
      const reg = findPlatform(v2.key)!
      const regCommon = reg.placements.filter(pl => !ADDITIONS.includes(`${v2.key}/${pl.key}`))
      expect(regCommon.map(pl => pl.key)).toEqual(v2.placements.map(pl => pl.key))
      for (const p of v2.placements) {
        const r = findPlacement(v2.key, p.key)!
        expect({ key: r.key, label: r.label, ratio: r.ratio, width: r.width, height: r.height }).toEqual({ key: p.key, label: p.label, ratio: p.ratio, width: p.width, height: p.height })
        expect(v2FindPlacement(v2.key, p.key)).toBeTruthy()
        count++
      }
    }
    expect(count).toBe(31)
  })

  it('the only additions are the three approved post formats, appended after the copied ones', () => {
    const added = PLATFORM_FORMATS.flatMap(p => p.placements.filter(pl => !v2FindPlacement(p.key, pl.key)).map(pl => `${p.key}/${pl.key}`))
    expect(added.sort()).toEqual([...ADDITIONS].sort())
    for (const p of PLATFORM_FORMATS) {
      const keys = p.placements.map(pl => `${p.key}/${pl.key}`)
      const firstAdded = keys.findIndex(k => ADDITIONS.includes(k))
      if (firstAdded >= 0) expect(keys.slice(firstAdded).every(k => ADDITIONS.includes(k))).toBe(true)
    }
  })

  it('the approved additions have the right shape', () => {
    expect(findPlacement('instagram', 'carousel')).toMatchObject({ ratio: '4:5', width: 1080, height: 1350, kind: 'carousel' })
    expect(findPlacement('instagram', 'carousel')!.mediaTypes).toContain('carousel')
    expect(findPlacement('facebook', 'link_post')).toMatchObject({ ratio: '1.91:1', width: 1200, height: 630, kind: 'link_post', mediaTypes: ['image'] })
    expect(findPlacement('linkedin', 'link_post')).toMatchObject({ ratio: '1.91:1', width: 1200, height: 627, kind: 'link_post', mediaTypes: ['image'] })
  })

  it('fitCanvasBox is identical to Video Studio V2 maths', () => {
    for (const [w, h] of [[1080, 1920], [1920, 1080], [1080, 1080], [1080, 1350], [1080, 566], [1000, 1500], [1200, 900], [1200, 630]]) {
      for (const [mw, mh] of [[500, 500], [300, 700], [900, 300], [80, 80], [1234, 567]]) expect(fitCanvasBox(w, h, mw, mh)).toEqual(v2FitCanvasBox(w, h, mw, mh))
    }
  })
})

describe('registry data integrity', () => {
  const all = PLATFORM_FORMATS.flatMap(p => p.placements.map(pl => ({ p, pl })))

  it('platform keys and placement keys are unique', () => {
    expect(new Set(PLATFORM_FORMATS.map(p => p.key)).size).toBe(PLATFORM_FORMATS.length)
    for (const p of PLATFORM_FORMATS) expect(new Set(p.placements.map(pl => pl.key)).size).toBe(p.placements.length)
  })

  it('every non-custom placement has a pixel size that matches its stated ratio', () => {
    const parse = (r: string) => { const [a, b] = r.split(':').map(Number); return a / b }
    for (const { pl } of all) {
      if (pl.ratio === 'CUSTOM') continue
      expect(Math.abs(pl.width / pl.height - parse(pl.ratio)) / parse(pl.ratio)).toBeLessThan(0.01)
    }
  })

  it('every placement declares a kind and at least one media type', () => {
    for (const { pl } of all) { expect(pl.kind).toBeTruthy(); expect(pl.mediaTypes.length).toBeGreaterThan(0) }
  })

  it('safe areas are approximate, within 0-50%, and only on placements that have data', () => {
    for (const { pl } of all) {
      if (!pl.safeArea) continue
      expect(pl.safeArea.approximate).toBe(true)
      for (const v of [pl.safeArea.top, pl.safeArea.bottom, pl.safeArea.left, pl.safeArea.right]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(50) }
    }
    expect(findPlacement('tiktok', 'vertical')!.safeArea).toMatchObject({ top: 10, bottom: 25, right: 8 })
  })

  it('has legacy aliases for every legacy /studio Platform key, each resolving to one placement', () => {
    const legacy = ['instagram_post', 'instagram_reel', 'instagram_story', 'tiktok', 'youtube_short', 'youtube_16_9', 'facebook_post', 'facebook_reel', 'linkedin_post', 'pinterest', 'twitter_x']
    for (const k of legacy) expect(findByLegacyKey(k), k).toBeTruthy()
    expect(findByLegacyKey('instagram_reel')).toMatchObject({ platformKey: 'instagram' })
    expect(findByLegacyKey('facebook_post')).toMatchObject({ platformKey: 'facebook', placement: { key: 'link_post' } })
    expect(findByLegacyKey('nope')).toBeUndefined()
    const seen = all.flatMap(({ pl }) => pl.legacyAliases ?? [])
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('every explicit default post format exists and is post-applicable', () => {
    for (const p of PLATFORM_FORMATS) {
      expect(p.defaultPostFormatKey, p.key).toBeTruthy()
      expect(isApplicable(p.key, p.defaultPostFormatKey!, POST_MEDIA_TYPES), p.key).toBe(true)
    }
  })
})

describe('helpers', () => {
  it('findPlacement / findPlatform handle unknown keys', () => {
    expect(findPlacement('instagram', 'nope')).toBeUndefined()
    expect(findPlacement('nope', 'square')).toBeUndefined()
  })

  it('every one of the nine platforms offers at least one post/image format', () => {
    const platforms = platformsFor(POST_MEDIA_TYPES)
    expect(platforms.map(p => p.key)).toEqual(['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'pinterest', 'x', 'google_business', 'website'])
    for (const p of platforms) expect(p.placements.length).toBeGreaterThan(0)
  })

  it('placementsFor shows only applicable formats for a platform', () => {
    expect(placementsFor('instagram', POST_MEDIA_TYPES).map(p => p.key)).toEqual(['reel_story', 'feed_portrait', 'square', 'landscape', 'carousel'])
    expect(placementsFor('tiktok', POST_MEDIA_TYPES).map(p => p.key)).toEqual(['vertical'])           // square / landscape are video-only
    expect(placementsFor('pinterest', POST_MEDIA_TYPES).map(p => p.key)).toEqual(['pin', 'square'])   // Video Pin excluded
    expect(placementsFor('x', POST_MEDIA_TYPES).map(p => p.key)).toEqual(['landscape', 'square'])
    expect(placementsFor('linkedin', POST_MEDIA_TYPES).map(p => p.key)).toEqual(['landscape_video', 'portrait_video', 'square', 'link_post'])
    expect(placementsFor('facebook', 'video').map(p => p.key)).not.toContain('link_post')
    expect(placementsFor('nope', 'image')).toEqual([])
  })

  it('post labels avoid video wording where the V2 label is video-only', () => {
    expect(postLabel(findPlacement('linkedin', 'landscape_video')!)).toBe('Landscape')
    expect(postLabel(findPlacement('instagram', 'feed_portrait')!)).toBe('Feed Portrait')
  })

  it('ratio labels', () => {
    expect(ratioLabelFor(1080, 1350)).toBe('4:5')
    expect(ratioLabelFor(1200, 900)).toBe('4:3')
    expect(ratioLabelFor(1080, 1080)).toBe('1:1')
    expect(ratioLabelFor(1000, 667)).toMatch(/^1\.5:1$/)
  })
})

describe('selection rules and resolveCanvas', () => {
  it('default selection is Instagram Feed Portrait 4:5 (the ratio the mock post already used)', () => {
    const c = resolveCanvas(defaultSelection())!
    expect(c).toMatchObject({ platformKey: 'instagram', formatKey: 'feed_portrait', width: 1080, height: 1350, ratioLabel: '4:5' })
  })

  it('resolved dimensions match the registry for EVERY platform x applicable format', () => {
    let n = 0
    for (const p of platformsFor(POST_MEDIA_TYPES)) {
      for (const f of p.placements) {
        const c = resolveCanvas({ ...defaultSelection(), platformKey: p.key, formatKey: f.key })!
        expect(c.width, `${p.key}/${f.key}`).toBe(f.ratio === 'CUSTOM' ? 1080 : f.width)
        expect(c.height, `${p.key}/${f.key}`).toBe(f.ratio === 'CUSTOM' ? 1080 : f.height)
        expect(c.ratio).toBe(f.ratio)
        n++
      }
    }
    expect(n).toBeGreaterThanOrEqual(25)
  })

  it('changing platform keeps the same ratio when possible (Instagram 4:5 -> Facebook 4:5), else uses the platform default', () => {
    const ig = defaultSelection()
    const fb = selectPlatform(ig, 'facebook')
    expect(fb).toMatchObject({ platformKey: 'facebook', formatKey: 'feed_portrait' })
    const tt = selectPlatform(ig, 'tiktok')
    expect(tt).toMatchObject({ platformKey: 'tiktok', formatKey: 'vertical' })
    const pin = selectPlatform(ig, 'pinterest')
    expect(pin).toMatchObject({ platformKey: 'pinterest', formatKey: 'pin' })
    // 1:1 stays 1:1
    const sq = selectFormat(ig, 'square')
    expect(selectPlatform(sq, 'linkedin')).toMatchObject({ platformKey: 'linkedin', formatKey: 'square' })
  })

  it('switching to a platform never leaves a dangling/inapplicable format', () => {
    for (const from of platformsFor(POST_MEDIA_TYPES)) {
      for (const ff of from.placements) {
        for (const to of platformsFor(POST_MEDIA_TYPES)) {
          const next = selectPlatform({ ...defaultSelection(), platformKey: from.key, formatKey: ff.key }, to.key)
          expect(isApplicable(next.platformKey, next.formatKey, POST_MEDIA_TYPES), `${from.key}/${ff.key} -> ${to.key}`).toBe(true)
          expect(resolveCanvas(next)).toBeTruthy()
        }
      }
    }
  })

  it('rejects an inapplicable format or unknown platform without breaking', () => {
    const ig = defaultSelection()
    expect(selectFormat(ig, 'nope')).toEqual(ig)
    expect(selectPlatform(ig, 'nope')).toEqual(ig)
    expect(normalizeSelection({ ...ig, platformKey: 'tiktok', formatKey: 'square' })).toMatchObject({ platformKey: 'tiktok', formatKey: 'vertical' })
    expect(normalizeSelection({ ...ig, platformKey: 'zzz' })).toMatchObject({ platformKey: 'instagram' })
    expect(defaultFormatKeyFor('nope', 'image')).toBeUndefined()
  })

  it('Custom size works and is clamped', () => {
    const custom = selectFormat(selectPlatform(defaultSelection(), 'website'), 'custom')
    expect(resolveCanvas(custom)).toMatchObject({ isCustom: true, width: 1080, height: 1080, ratioLabel: '1:1' })
    const sized = setCustomSize(custom, { width: 1600, height: 900 })
    expect(resolveCanvas(sized)).toMatchObject({ isCustom: true, width: 1600, height: 900, ratioLabel: '16:9' })
    expect(sanitizeCustomSize({ width: 1, height: 999999 })).toEqual({ width: MIN_CUSTOM_SIZE, height: MAX_CUSTOM_SIZE })
    expect(sanitizeCustomSize({ width: NaN, height: 300.6 })).toEqual({ width: MIN_CUSTOM_SIZE, height: 301 })
    // a non-custom placement ignores customSize
    expect(resolveCanvas({ ...sized, formatKey: 'square' })).toMatchObject({ isCustom: false, width: 1080, height: 1080 })
  })
})
