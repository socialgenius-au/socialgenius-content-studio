// M2.1a -- what colour the text was, estimated from the PIXELS of the frame it was read from. Pure: takes decoded pixels, returns an estimate.
//
// WHY THIS EXISTS INSTEAD OF USING THE STORED COLOURS: the analysis stores two colours per text region, "dominant_text_color_rgb" and
// "dominant_background_color_rgb", but they are simply the darkest and lightest quarter of the region's pixels -- the first is ALWAYS the darker one.
// Light text on a dark picture (the common caption look; and exactly what the VA5368 captions are) therefore comes out with the colours swapped.
// They are kept as evidence, never applied.
//
// METHOD (cheap, explainable, and honest about doubt): split the region's pixels into two groups by brightness (Otsu). Decide which group is the
// text with two independent cues -- (a) the text group is the one that stands out MORE from the ring of picture around the region, (b) the text group
// is usually the smaller one (strokes cover less area than the space around them). When the cues agree, confidence is high or medium; when they
// disagree, or the two groups are barely different, confidence is low and the caller falls back to a plain default. Outline / shadow / font
// are NOT estimated: they cannot be read reliably from a compressed frame.
import type { Level } from './contract'
import { clamp } from './contract'

export interface PixelImage { width: number; height: number; data: ArrayLike<number> }          // RGBA, row-major (the shape canvas getImageData returns)
export interface PixelRect { x: number; y: number; w: number; h: number }                        // in the image's own pixels

export interface Appearance {
  textColor: string | null            // "#rrggbb", or null when nothing reliable could be read
  backdropColor: string | null        // the other group's colour: kept as evidence, never applied
  confidence: Level
  separation: number                  // brightness gap between the two groups, 0..255
  notes: string[]
}

const MIN_PIXELS = 16
/** Below this brightness gap there is no distinct text and background to tell apart. */
export const MIN_SEPARATION = 40
const hex = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
export const toHex = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

const none = (note: string): Appearance => ({ textColor: null, backdropColor: null, confidence: 'low', separation: 0, notes: [note] })

export function estimateAppearance(img: PixelImage, inner: PixelRect): Appearance {
  const { width, height, data } = img
  if (!(width > 0 && height > 0) || data.length < width * height * 4) return none('No pixels were available for this region.')
  const x0 = clamp(Math.floor(inner.x), 0, width), y0 = clamp(Math.floor(inner.y), 0, height)
  const x1 = clamp(Math.ceil(inner.x + inner.w), 0, width), y1 = clamp(Math.ceil(inner.y + inner.h), 0, height)

  const px: { r: number; g: number; b: number; l: number }[] = []
  const ring: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      const r = data[i], g = data[i + 1], b = data[i + 2], l = lum(r, g, b)
      if (x >= x0 && x < x1 && y >= y0 && y < y1) px.push({ r, g, b, l })
      else if (x < x0 - 1 || x >= x1 + 1 || y < y0 - 1 || y >= y1 + 1) ring.push(l)          // one pixel of gutter so anti-aliased edges are not read as picture
    }
  }
  if (px.length < MIN_PIXELS || ring.length < MIN_PIXELS) return none('Too few pixels around this region to read its colour.')

  // Otsu threshold on brightness
  const hist = new Array<number>(256).fill(0)
  for (const p of px) hist[Math.round(p.l)]++
  let sumAll = 0
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]
  let wB = 0, sumB = 0, best = -1, thr = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = px.length - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2
    if (between > best) { best = between; thr = t }
  }
  const lo = px.filter(p => Math.round(p.l) <= thr), hi = px.filter(p => Math.round(p.l) > thr)      // classify on the same rounded brightness the threshold was computed from
  if (lo.length === 0 || hi.length === 0) return none('The region is a single flat colour: no text could be told apart.')
  const mean = (a: typeof px) => a.reduce((s, p) => s + p.l, 0) / a.length
  const lLo = mean(lo), lHi = mean(hi)
  const separation = lHi - lLo
  if (separation < MIN_SEPARATION) return { ...none('Text and background are too close in brightness to tell apart.'), separation: Math.round(separation) }

  const sortedRing = [...ring].sort((a, b) => a - b)
  const ringL = sortedRing[Math.floor(sortedRing.length / 2)]
  const dHi = Math.abs(lHi - ringL), dLo = Math.abs(lLo - ringL)
  const farther: 'hi' | 'lo' = dHi >= dLo ? 'hi' : 'lo'                    // cue (a): the group that stands out from the surrounding picture
  const margin = Math.abs(dHi - dLo)
  const smaller: 'hi' | 'lo' = hi.length <= lo.length ? 'hi' : 'lo'         // cue (b): strokes cover less area than what is around them
  const notes: string[] = []
  let pick: 'hi' | 'lo', confidence: Level
  if (farther === smaller) {
    pick = farther
    confidence = separation >= 80 && margin >= 30 ? 'high' : 'medium'
    notes.push(`The ${pick === 'hi' ? 'lighter' : 'darker'} pixels stand out from the picture around them and cover the smaller area, so they are read as the text.`)
  } else {
    pick = margin >= 60 ? farther : smaller
    confidence = 'low'
    notes.push('The two ways of telling text from background disagree, so this colour is a weak guess.')
  }

  // take the half of the text group that is most different from the other group: edge pixels are blends of both
  const group = pick === 'hi' ? hi : lo
  const other = pick === 'hi' ? lLo : lHi
  const core = [...group].sort((a, b) => Math.abs(b.l - other) - Math.abs(a.l - other)).slice(0, Math.max(8, Math.ceil(group.length / 2)))
  const avg = (a: typeof px, k: 'r' | 'g' | 'b') => a.reduce((s, p) => s + p[k], 0) / a.length
  const otherGroup = pick === 'hi' ? lo : hi
  return {
    textColor: toHex(avg(core, 'r'), avg(core, 'g'), avg(core, 'b')),
    backdropColor: toHex(avg(otherGroup, 'r'), avg(otherGroup, 'g'), avg(otherGroup, 'b')),
    confidence, separation: Math.round(separation), notes,
  }
}
