// Carousel Creator - QR code generation (no external service, no dependency). Encodes text in byte mode at error-correction level M, QR versions 1 to 10 (up to 213 bytes of text, which is
// far more than any link needs). The result is a plain matrix of dark / light modules that the screen renderer draws as SVG and the export rasterizer draws as rectangles.
export class QrError extends Error {}
export interface QrMatrix { size: number; version: number; mask: number; modules: boolean[][] }

/** Per version (index 0 = v1): data codewords, error-correction codewords per block, and the blocks as [count, data codewords each]. Level M. */
const BLOCKS: { data: number; ec: number; blocks: [number, number][] }[] = [
  { data: 16, ec: 10, blocks: [[1, 16]] }, { data: 28, ec: 16, blocks: [[1, 28]] }, { data: 44, ec: 26, blocks: [[1, 44]] }, { data: 64, ec: 18, blocks: [[2, 32]] },
  { data: 86, ec: 24, blocks: [[2, 43]] }, { data: 108, ec: 16, blocks: [[4, 27]] }, { data: 124, ec: 18, blocks: [[4, 31]] }, { data: 154, ec: 22, blocks: [[2, 38], [2, 39]] },
  { data: 182, ec: 22, blocks: [[3, 36], [2, 37]] }, { data: 216, ec: 26, blocks: [[4, 43], [1, 44]] },
]
export const QR_MAX_BYTES = 213

// ── Reed-Solomon over GF(256) ────────────────────────────────────────────────────────────────
const EXP = new Array<number>(512)
const LOG = new Array<number>(256)
;(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] })()
const gmul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

function generator(degree: number): number[] {
  let g = [1]
  for (let i = 0; i < degree; i++) { const next = new Array<number>(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]) } g = next }
  return g
}

function remainder(data: number[], degree: number): number[] {
  const gen = generator(degree)
  const rem = new Array<number>(degree).fill(0)
  for (const b of data) {
    const factor = b ^ rem.shift()!
    rem.push(0)
    for (let i = 0; i < degree; i++) rem[i] ^= gmul(gen[i + 1], factor)
  }
  return rem
}

// ── bits ─────────────────────────────────────────────────────────────────────────────────────
const utf8 = (s: string): number[] => Array.from(new TextEncoder().encode(s))

function dataCodewords(bytes: number[], version: number): number[] {
  const cap = BLOCKS[version - 1].data
  const bits: number[] = []
  const push = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  push(0b0100, 4)
  push(bytes.length, version >= 10 ? 16 : 8)
  for (const b of bytes) push(b, 8)
  const capacityBits = cap * 8
  push(0, Math.min(4, capacityBits - bits.length))
  while (bits.length % 8) bits.push(0)
  const out: number[] = []
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  for (let pad = 0xec; out.length < cap; pad = pad === 0xec ? 0x11 : 0xec) out.push(pad)
  return out
}

function interleave(data: number[], version: number): number[] {
  const { ec, blocks } = BLOCKS[version - 1]
  const dataBlocks: number[][] = []
  let pos = 0
  for (const [count, size] of blocks) for (let i = 0; i < count; i++) { dataBlocks.push(data.slice(pos, pos + size)); pos += size }
  const ecBlocks = dataBlocks.map(b => remainder(b, ec))
  const out: number[] = []
  const longest = Math.max(...dataBlocks.map(b => b.length))
  for (let i = 0; i < longest; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i])
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) out.push(b[i])
  return out
}

// ── matrix ───────────────────────────────────────────────────────────────────────────────────
const alignmentPositions = (v: number, size: number): number[] => {
  if (v === 1) return []
  const n = Math.floor(v / 7) + 2
  const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2
  const out = [6]
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

function build(version: number, codewords: number[], mask: number): boolean[][] {
  const size = version * 4 + 17
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setFn = (x: number, y: number, dark: boolean) => { m[y][x] = dark; fn[y][x] = true }

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0) }
  const finder = (cx: number, cy: number) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4) } }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  const pos = alignmentPositions(version, size)
  pos.forEach((cy, i) => pos.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))

  // format information (level M = 00)
  const data5 = (0 << 3) | mask
  let rem = data5
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const fbits = ((data5 << 10) | rem) ^ 0x5412
  for (let i = 0; i <= 5; i++) setFn(8, i, bit(fbits, i))
  setFn(8, 7, bit(fbits, 6)); setFn(8, 8, bit(fbits, 7)); setFn(7, 8, bit(fbits, 8))
  for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(fbits, i))
  for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(fbits, i))
  for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(fbits, i))
  setFn(8, size - 8, true)

  if (version >= 7) {
    let r = version
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
    const vbits = (version << 12) | r
    for (let i = 0; i < 18; i++) { const b = bit(vbits, i); const a = size - 11 + (i % 3), c = Math.floor(i / 3); setFn(a, c, b); setFn(c, a, b) }
  }

  // data, zigzag from the bottom right
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j
      const upward = ((right + 1) & 2) === 0
      const y = upward ? size - 1 - vert : vert
      if (!fn[y][x] && i < codewords.length * 8) { m[y][x] = bit(codewords[i >>> 3], 7 - (i & 7)); i++ }
    }
  }

  const invert = (r: number, c: number): boolean => {
    switch (mask) {
      case 0: return (r + c) % 2 === 0
      case 1: return r % 2 === 0
      case 2: return c % 3 === 0
      case 3: return (r + c) % 3 === 0
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    }
  }
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && invert(r, c)) m[r][c] = !m[r][c]
  return m
}

/** The standard four penalty rules; the mask with the lowest total is used. */
function penalty(m: boolean[][]): number {
  const n = m.length
  let score = 0
  const line = (get: (i: number) => boolean) => {
    let run = 1
    for (let i = 1; i < n; i++) { if (get(i) === get(i - 1)) run++; else { if (run >= 5) score += 3 + (run - 5); run = 1 } }
    if (run >= 5) score += 3 + (run - 5)
    const s = Array.from({ length: n }, (_, i) => (get(i) ? '1' : '0')).join('')
    for (const pat of ['10111010000', '00001011101']) { let at = s.indexOf(pat); while (at !== -1) { score += 40; at = s.indexOf(pat, at + 1) } }
  }
  for (let k = 0; k < n; k++) { line(i => m[k][i]); line(i => m[i][k]) }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3
  const dark = m.reduce((t, row) => t + row.filter(Boolean).length, 0)
  score += (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10
  return score
}

export function encodeQr(text: string): QrMatrix {
  const bytes = utf8(text)
  if (bytes.length === 0) throw new QrError('Enter the web address or text the QR code should open.')
  let version = 0
  for (let v = 1; v <= BLOCKS.length; v++) {
    const header = 4 + (v >= 10 ? 16 : 8)
    if (header + bytes.length * 8 <= BLOCKS[v - 1].data * 8) { version = v; break }
  }
  if (!version) throw new QrError(`That is too long for a QR code here (${bytes.length} of ${QR_MAX_BYTES} characters). Use a shorter link.`)
  const codewords = interleave(dataCodewords(bytes, version), version)
  let best: { mask: number; m: boolean[][]; score: number } | null = null
  for (let mask = 0; mask < 8; mask++) { const m = build(version, codewords, mask); const score = penalty(m); if (!best || score < best.score) best = { mask, m, score } }
  return { size: version * 4 + 17, version, mask: best!.mask, modules: best!.m }
}

/** Dark modules as one SVG path (runs per row), in module units, shifted by the quiet zone. */
export function qrPath(q: QrMatrix, quiet = 2): string {
  const parts: string[] = []
  q.modules.forEach((row, y) => { let x = 0; while (x < q.size) { if (row[x]) { let end = x; while (end < q.size && row[end]) end++; parts.push(`M${x + quiet} ${y + quiet}h${end - x}v1h${-(end - x)}z`); x = end } else x++ } })
  return parts.join('')
}

/** A standalone SVG for the code (quiet zone included). */
export function qrSvg(q: QrMatrix, fg = '#000000', bg = '#FFFFFF', quiet = 2): string {
  const n = q.size + quiet * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${bg}"/><path d="${qrPath(q, quiet)}" fill="${fg}"/></svg>`
}

const cache = new Map<string, QrMatrix | QrError>()
/** Cached encode (the editor redraws constantly); returns the error instead of throwing so a renderer can show a placeholder. */
export function qrFor(text: string): QrMatrix | QrError {
  let hit = cache.get(text)
  if (!hit) { try { hit = encodeQr(text) } catch (e) { hit = e instanceof QrError ? e : new QrError('The QR code could not be made.') } if (cache.size > 200) cache.clear(); cache.set(text, hit) }
  return hit
}
