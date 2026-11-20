// Carousel Creator - background patterns and textures. A pattern is a small TILE made of simple primitives, repeated across the slide. The same tile is drawn by the on-screen renderer
// (as an SVG image used as a repeating CSS background), the export rasterizer (canvas) and SVG export (<pattern>), so a pattern looks the same everywhere. Tile size is relative to the
// slide's shorter side, so it scales with the export size.
export type PatternId = 'dots' | 'dots-fine' | 'stripes' | 'diagonal' | 'grid' | 'checker' | 'zigzag' | 'plus' | 'crosshatch' | 'grain'
export type TileItem =
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number }

export interface Tile { w: number; h: number; items: TileItem[] }
export interface PatternDef { id: PatternId; label: string; category: 'Pattern' | 'Texture'; /** tile in a 100-unit box */ tile: Tile; /** default tile size as a fraction of the shorter side */ size: number }

function grain(): TileItem[] {
  let s = 12345
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
  return Array.from({ length: 70 }, () => ({ t: 'circle' as const, cx: Math.round(rnd() * 1000) / 10, cy: Math.round(rnd() * 1000) / 10, r: 0.6 + rnd() * 1.4 }))
}

export const PATTERNS: PatternDef[] = [
  { id: 'dots', label: 'Dots', category: 'Pattern', size: 0.06, tile: { w: 100, h: 100, items: [{ t: 'circle', cx: 50, cy: 50, r: 14 }] } },
  { id: 'dots-fine', label: 'Fine dots', category: 'Pattern', size: 0.025, tile: { w: 100, h: 100, items: [{ t: 'circle', cx: 50, cy: 50, r: 10 }] } },
  { id: 'stripes', label: 'Stripes', category: 'Pattern', size: 0.06, tile: { w: 100, h: 100, items: [{ t: 'rect', x: 0, y: 0, w: 50, h: 100 }] } },
  { id: 'diagonal', label: 'Diagonal lines', category: 'Pattern', size: 0.05, tile: { w: 100, h: 100, items: [{ t: 'line', x1: -10, y1: 110, x2: 110, y2: -10, w: 14 }] } },
  { id: 'grid', label: 'Grid', category: 'Pattern', size: 0.08, tile: { w: 100, h: 100, items: [{ t: 'rect', x: 0, y: 0, w: 100, h: 6 }, { t: 'rect', x: 0, y: 0, w: 6, h: 100 }] } },
  { id: 'checker', label: 'Checkerboard', category: 'Pattern', size: 0.08, tile: { w: 100, h: 100, items: [{ t: 'rect', x: 0, y: 0, w: 50, h: 50 }, { t: 'rect', x: 50, y: 50, w: 50, h: 50 }] } },
  { id: 'zigzag', label: 'Zigzag', category: 'Pattern', size: 0.07, tile: { w: 100, h: 100, items: [{ t: 'line', x1: 0, y1: 75, x2: 50, y2: 25, w: 10 }, { t: 'line', x1: 50, y1: 25, x2: 100, y2: 75, w: 10 }] } },
  { id: 'plus', label: 'Plus signs', category: 'Pattern', size: 0.07, tile: { w: 100, h: 100, items: [{ t: 'rect', x: 44, y: 28, w: 12, h: 44 }, { t: 'rect', x: 28, y: 44, w: 44, h: 12 }] } },
  { id: 'crosshatch', label: 'Crosshatch (linen)', category: 'Texture', size: 0.018, tile: { w: 100, h: 100, items: [{ t: 'rect', x: 0, y: 0, w: 100, h: 14 }, { t: 'rect', x: 0, y: 0, w: 14, h: 100 }] } },
  { id: 'grain', label: 'Grain (paper)', category: 'Texture', size: 0.12, tile: { w: 100, h: 100, items: grain() } },
]

export const PATTERN_BY_ID: Record<string, PatternDef> = Object.fromEntries(PATTERNS.map(p => [p.id, p]))
export const DEFAULT_PATTERN_ID: PatternId = 'dots'

/** Tile size in canvas pixels for a slide whose shorter side is `S` px and the pattern's `scale` setting (1 = the pattern's default size). */
export const tilePx = (def: PatternDef, scale: number, S: number): number => Math.max(2, def.size * scale * S)

const num = (n: number) => String(Math.round(n * 100) / 100)

/** The tile as the inner markup of an SVG (viewBox 0 0 100 100), drawn in `fg` over `bg`. */
export function tileSvgInner(def: PatternDef, fg: string, bg: string): string {
  const items = def.tile.items.map(i => {
    if (i.t === 'rect') return `<rect x="${num(i.x)}" y="${num(i.y)}" width="${num(i.w)}" height="${num(i.h)}" fill="${fg}"/>`
    if (i.t === 'circle') return `<circle cx="${num(i.cx)}" cy="${num(i.cy)}" r="${num(i.r)}" fill="${fg}"/>`
    return `<line x1="${num(i.x1)}" y1="${num(i.y1)}" x2="${num(i.x2)}" y2="${num(i.y2)}" stroke="${fg}" stroke-width="${num(i.w)}"/>`
  }).join('')
  return `<rect width="100" height="100" fill="${bg}"/>${items}`
}

/** A complete tiny SVG document for one tile, as a CSS `url(...)` value. Colours are plain hex (validated), so the markup cannot carry script. */
export function tileDataUrl(def: PatternDef, fg: string, bg: string): string {
  const safe = (c: string) => (/^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#000000')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${tileSvgInner(def, safe(fg), safe(bg))}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
