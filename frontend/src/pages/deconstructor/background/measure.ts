// M2.3a -- MEASURE one still. Pure: pixels in, numbers out. No network, no canvas, no randomness, no new library. The same pixels always give the same answer.
// It finds flat bands along the four edges (bars), the colours of the outer border, and whether that border is plain, a smooth gradient or busy.
import type { PixelImage } from '../textlayers/appearance'
import { BAR_COLOUR_TOLERANCE, BAR_EDGE_STEP, GRADIENT_MIN_DRIFT, GRADIENT_STEP, GRADIENT_WANDER, MAX_BAR, MIN_BAR, MIN_GRADIENT, RING, SIDES, UNIFORM_SHARE, UNIFORM_TOLERANCE, round3, type Side, type VarianceClass } from './contract'

export interface BarMeasure { side: Side; size: number; color: string; uniformity: number }          // size: share of that dimension, 0..1
/** A smooth gradient along one edge: flat lines whose colour drifts steadily inwards. `halves`: the average colour of the half nearer the edge, then of the half nearer the picture. */
export interface GradientMeasure { side: Side; size: number; halves: [string, string]; uniformity: number }
export interface PaletteEntry { color: string; share: number }
export interface FrameBackground {
  width: number
  height: number
  bars: BarMeasure[]
  gradients?: GradientMeasure[]
  palette: PaletteEntry[]                       // the border's most common colours, most common first
  variance: VarianceClass
  /** The whole frame is one flat colour: there is no "bar", only a blank still. */
  uniformFrame: boolean
}

type RGB = [number, number, number]
const hex = (c: RGB) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
const dist = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

interface Line { mean: RGB; share: number }

/** One row (axis 'row') or column (axis 'col') of the picture: its mean colour and the share of its sampled pixels within tolerance of that mean. */
function lineAt(img: PixelImage, axis: 'row' | 'col', index: number): Line {
  const n = axis === 'row' ? img.width : img.height
  const step = Math.max(1, Math.floor(n / 160))
  let r = 0, g = 0, b = 0, count = 0
  const px = (k: number): RGB => {
    const i = (axis === 'row' ? index * img.width + k : k * img.width + index) * 4
    return [img.data[i], img.data[i + 1], img.data[i + 2]]
  }
  for (let k = 0; k < n; k += step) { const p = px(k); r += p[0]; g += p[1]; b += p[2]; count++ }
  const mean: RGB = [r / count, g / count, b / count]
  let within = 0
  for (let k = 0; k < n; k += step) if (dist(px(k), mean) <= UNIFORM_TOLERANCE) within++
  return { mean, share: within / count }
}

/** Scan from one edge inwards while the lines stay flat and the same colour. Returns the bar, or null when there is none worth calling one. */
function scanBar(img: PixelImage, side: Side): { bar: BarMeasure | null; wholeFrame: boolean } {
  const axis = side === 'top' || side === 'bottom' ? 'row' : 'col'
  const total = axis === 'row' ? img.height : img.width
  const at = (i: number) => lineAt(img, axis, side === 'top' || side === 'left' ? i : total - 1 - i)
  const first = at(0)
  if (first.share < UNIFORM_SHARE) return { bar: null, wholeFrame: false }
  let count = 0, rs = 0, gs = 0, bs = 0, shares = 0
  for (let i = 0; i < total; i++) {
    const l = i === 0 ? first : at(i)
    if (l.share < UNIFORM_SHARE || dist(l.mean, first.mean) > BAR_COLOUR_TOLERANCE) break
    count++; rs += l.mean[0]; gs += l.mean[1]; bs += l.mean[2]; shares += l.share
  }
  if (count >= total) return { bar: null, wholeFrame: true }
  const barMean: RGB = [rs / count, gs / count, bs / count]
  const next = at(count)
  if (next.share >= UNIFORM_SHARE && dist(next.mean, barMean) < BAR_EDGE_STEP) return { bar: null, wholeFrame: false }          // no edge where it ends: a smooth gradient, not a bar
  const size = count / total
  if (size < MIN_BAR || size > MAX_BAR) return { bar: null, wholeFrame: false }
  return { bar: { side, size: round3(size), color: hex([rs / count, gs / count, bs / count]), uniformity: round3(shares / count) }, wholeFrame: false }
}

/** A smooth gradient along an edge (where no flat bar was found): lines that stay flat across their length while the colour drifts steadily inwards, until the lines stop being flat (the picture begins). */
function scanGradient(img: PixelImage, side: Side): GradientMeasure | null {
  const axis = side === 'top' || side === 'bottom' ? 'row' : 'col'
  const total = axis === 'row' ? img.height : img.width
  const at = (i: number) => lineAt(img, axis, side === 'top' || side === 'left' ? i : total - 1 - i)
  const lines: Line[] = []
  for (let i = 0; i < total; i++) {
    const l = at(i)
    if (l.share < UNIFORM_SHARE || (lines.length > 0 && dist(l.mean, lines[lines.length - 1].mean) > GRADIENT_STEP)) break
    lines.push(l)
  }
  const count = lines.length
  if (count >= total || count / total < MIN_GRADIENT || count / total > MAX_BAR) return null
  const drift = dist(lines[0].mean, lines[count - 1].mean)
  const path = lines.slice(1).reduce((n, l, i) => n + dist(l.mean, lines[i].mean), 0)
  if (drift < GRADIENT_MIN_DRIFT || path > GRADIENT_WANDER * drift + 10) return null
  const avg = (part: Line[]): RGB => [0, 1, 2].map(k => part.reduce((n, l) => n + l.mean[k], 0) / part.length) as RGB
  const h = count >> 1
  return { side, size: round3(count / total), halves: [hex(avg(lines.slice(0, h))), hex(avg(lines.slice(h)))], uniformity: round3(lines.reduce((n, l) => n + l.share, 0) / count) }
}

/** The border's most common colours (4 bits per channel), with each colour averaged over the pixels that fell in its bin. */
function borderPalette(img: PixelImage): { palette: PaletteEntry[]; ringPixels: number; lumStd: number } {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  const rx = Math.max(1, Math.round(img.width * RING)), ry = Math.max(1, Math.round(img.height * RING))
  const sx = Math.max(1, Math.floor(img.width / 200)), sy = Math.max(1, Math.floor(img.height / 200))
  let total = 0, ls = 0, lq = 0
  for (let y = 0; y < img.height; y += sy) {
    const edgeRow = y < ry || y >= img.height - ry
    for (let x = 0; x < img.width; x += sx) {
      if (!edgeRow && x >= rx && x < img.width - rx) continue
      const i = (y * img.width + x) * 4
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2]
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
      e.n++; e.r += r; e.g += g; e.b += b; bins.set(key, e); total++
      const l = lum([r, g, b]); ls += l; lq += l * l
    }
  }
  const lumStd = total > 0 ? Math.sqrt(Math.max(0, lq / total - (ls / total) ** 2)) : 0
  const palette = [...bins.entries()].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]).slice(0, 3).map(([, e]) => ({ color: hex([e.r / e.n, e.g / e.n, e.b / e.n]), share: round3(e.n / total) }))
  return { palette, ringPixels: total, lumStd }
}

/** Plain / smooth gradient / busy, from the border alone. Deterministic thresholds, stated here: plain = one colour holds 85% of the border, or the border's brightness spread is 12 levels or less (a dark, almost-flat background); gradient = each of two opposite
 *  edges is flat along its length (spread under 14 levels) but the two edges differ in brightness by 24 levels or more; anything else is busy. */
function classify(img: PixelImage, palette: PaletteEntry[], lumStd: number): VarianceClass {
  if (palette.length > 0 && (palette[0].share >= 0.85 || lumStd <= 12)) return 'solid'
  const strip = (axis: 'row' | 'col', from: number, to: number) => {
    // mean brightness of the strip, and the average spread of brightness ALONG each line in it
    let sum = 0, spread = 0, lines = 0
    for (let i = from; i < to; i++) {
      const n = axis === 'row' ? img.width : img.height
      const stp = Math.max(1, Math.floor(n / 80))
      const vals: number[] = []
      for (let k = 0; k < n; k += stp) {
        const j = (axis === 'row' ? i * img.width + k : k * img.width + i) * 4
        vals.push(lum([img.data[j], img.data[j + 1], img.data[j + 2]]))
      }
      const m = vals.reduce((a, b) => a + b, 0) / vals.length
      sum += m; spread += Math.sqrt(vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length); lines++
    }
    return { mean: sum / lines, spread: spread / lines }
  }
  const ry = Math.max(1, Math.round(img.height * RING)), rx = Math.max(1, Math.round(img.width * RING))
  const t = strip('row', 0, ry), b = strip('row', img.height - ry, img.height), l = strip('col', 0, rx), r = strip('col', img.width - rx, img.width)
  if (t.spread <= 14 && b.spread <= 14 && Math.abs(t.mean - b.mean) >= 24) return 'gradient'
  if (l.spread <= 14 && r.spread <= 14 && Math.abs(l.mean - r.mean) >= 24) return 'gradient'
  return 'busy'
}

export function measureFrame(img: PixelImage): FrameBackground {
  const empty: FrameBackground = { width: img.width, height: img.height, bars: [], palette: [], variance: 'busy', uniformFrame: false }
  if (img.width < 8 || img.height < 8 || img.data.length < img.width * img.height * 4) return empty
  const bars: BarMeasure[] = []
  let wholeFrame = false
  for (const side of SIDES) {
    const r = scanBar(img, side)
    if (r.bar) bars.push(r.bar)
    if (r.wholeFrame) wholeFrame = true
  }
  const { palette, lumStd } = borderPalette(img)
  const found = wholeFrame ? [] : bars
  const gradients = wholeFrame ? [] : SIDES.filter(s => !bars.some(b => b.side === s)).flatMap(s => { const g = scanGradient(img, s); return g ? [g] : [] })
  // Where flat bars were measured the background IS those flat bands (a letterboxed frame's picture at its sides says nothing about it); otherwise judge the border.
  return { width: img.width, height: img.height, bars: found, palette, variance: found.length > 0 ? 'solid' : gradients.length > 0 ? 'gradient' : classify(img, palette, lumStd), uniformFrame: wholeFrame, gradients }
}
