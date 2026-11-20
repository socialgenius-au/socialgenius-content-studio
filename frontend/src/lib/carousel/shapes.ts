// Carousel Creator - the shape library. Every shape except the plain rectangle, ellipse and line is a POLYGON in the unit square (x right, y down), stretched to fill the element's box.
// One definition serves everything that draws a shape: the on-screen renderer (CSS clip-path), the export rasterizer (canvas paths), SVG export, and image masks (a picture can be clipped
// to any polygon shape), so a shape looks the same everywhere.
import type { PolygonShapeKind } from '../postDocument'

export type ShapeCategory = 'Basic' | 'Polygons' | 'Stars' | 'Arrows' | 'Callouts' | 'Lines'
export interface ShapeDef { id: PolygonShapeKind; label: string; category: ShapeCategory; points: [number, number][] }

const r4 = (n: number) => Math.round(n * 1e4) / 1e4

/** A regular polygon inscribed in the unit square. */
function regular(n: number, rotationDeg = -90): [number, number][] {
  return Array.from({ length: n }, (_, i) => { const a = ((rotationDeg + (360 / n) * i) * Math.PI) / 180; return [r4(0.5 + 0.5 * Math.cos(a)), r4(0.5 + 0.5 * Math.sin(a))] as [number, number] })
}

/** A star (or burst) with `n` points; `inner` is the inner radius as a fraction of the outer. */
function star(n: number, inner: number): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < n * 2; i++) { const a = ((-90 + (180 / n) * i) * Math.PI) / 180; const r = i % 2 === 0 ? 0.5 : 0.5 * inner; pts.push([r4(0.5 + r * Math.cos(a)), r4(0.5 + r * Math.sin(a))]) }
  return pts
}

function heart(): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < 72; i++) { const t = (i / 72) * Math.PI * 2; pts.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]) }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  return pts.map(([x, y]) => [r4((x - x0) / (x1 - x0)), r4(1 - (y - y0) / (y1 - y0))] as [number, number])
}

/** A speech bubble: an oval body (or a rounded box) with a tail at the bottom left. */
function bubble(round: boolean): [number, number][] {
  const body: [number, number][] = []
  if (round) { for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; body.push([0.5 + 0.5 * Math.cos(a), 0.4 * (1 + Math.sin(a))]) } }
  else { const r = 0.12; const corner = (cx: number, cy: number, a0: number) => Array.from({ length: 6 }, (_, k) => { const a = ((a0 + 15 * k) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number] }); body.push(...corner(0.88, 0.12, -90), ...corner(0.88, 0.68, 0), ...corner(0.12, 0.68, 90), ...corner(0.12, 0.12, 180)) }
  // insert the tail where the body crosses the bottom edge near x = 0.2..0.4
  const i = body.reduce((best, p, k) => (p[1] > body[best][1] - 1e-9 && Math.abs(p[0] - 0.3) < Math.abs(body[best][0] - 0.3) && p[1] > 0.6 ? k : best), 0)
  const tail: [number, number][] = [[0.38, body[i][1]], [0.2, 1], [0.24, body[i][1]]]
  return [...body.slice(0, i), ...tail, ...body.slice(i + 1)].map(([x, y]) => [r4(x), r4(y)] as [number, number])
}

const arrowRight: [number, number][] = [[0, 0.3], [0.6, 0.3], [0.6, 0.05], [1, 0.5], [0.6, 0.95], [0.6, 0.7], [0, 0.7]]
const flip = (pts: [number, number][], fx: boolean, fy: boolean, swap = false): [number, number][] => pts.map(([x, y]) => { const [a, b] = swap ? [y, x] : [x, y]; return [r4(fx ? 1 - a : a), r4(fy ? 1 - b : b)] as [number, number] })

export const SHAPES: ShapeDef[] = [
  { id: 'triangle', label: 'Triangle', category: 'Basic', points: [[0.5, 0], [1, 1], [0, 1]] },
  { id: 'right-triangle', label: 'Right triangle', category: 'Basic', points: [[0, 0], [1, 1], [0, 1]] },
  { id: 'diamond', label: 'Diamond', category: 'Basic', points: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
  { id: 'parallelogram', label: 'Parallelogram', category: 'Basic', points: [[0.2, 0], [1, 0], [0.8, 1], [0, 1]] },
  { id: 'trapezoid', label: 'Trapezoid', category: 'Basic', points: [[0.2, 0], [0.8, 0], [1, 1], [0, 1]] },
  { id: 'cross', label: 'Cross', category: 'Basic', points: [[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]] },
  { id: 'heart', label: 'Heart', category: 'Basic', points: heart() },
  { id: 'pentagon', label: 'Pentagon', category: 'Polygons', points: regular(5) },
  { id: 'hexagon', label: 'Hexagon', category: 'Polygons', points: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]] },
  { id: 'octagon', label: 'Octagon', category: 'Polygons', points: regular(8, -67.5) },
  { id: 'star-4', label: '4-point star', category: 'Stars', points: star(4, 0.38) },
  { id: 'star-5', label: 'Star', category: 'Stars', points: star(5, 0.4) },
  { id: 'star-6', label: '6-point star', category: 'Stars', points: star(6, 0.5) },
  { id: 'burst', label: 'Burst', category: 'Stars', points: star(12, 0.78) },
  { id: 'arrow-right', label: 'Arrow right', category: 'Arrows', points: arrowRight },
  { id: 'arrow-left', label: 'Arrow left', category: 'Arrows', points: flip(arrowRight, true, false) },
  { id: 'arrow-up', label: 'Arrow up', category: 'Arrows', points: flip(arrowRight, false, true, true) },
  { id: 'arrow-down', label: 'Arrow down', category: 'Arrows', points: flip(arrowRight, true, false, true) },
  { id: 'arrow-double', label: 'Double arrow', category: 'Arrows', points: [[0, 0.5], [0.2, 0.05], [0.2, 0.3], [0.8, 0.3], [0.8, 0.05], [1, 0.5], [0.8, 0.95], [0.8, 0.7], [0.2, 0.7], [0.2, 0.95]] },
  { id: 'chevron', label: 'Chevron', category: 'Arrows', points: [[0, 0], [0.6, 0], [1, 0.5], [0.6, 1], [0, 1], [0.4, 0.5]] },
  { id: 'bubble', label: 'Speech bubble', category: 'Callouts', points: bubble(false) },
  { id: 'bubble-round', label: 'Round speech bubble', category: 'Callouts', points: bubble(true) },
  { id: 'line-arrow', label: 'Line with arrow', category: 'Lines', points: [[0, 0.42], [0.82, 0.42], [0.82, 0.1], [1, 0.5], [0.82, 0.9], [0.82, 0.58], [0, 0.58]] },
  { id: 'line-arrow-double', label: 'Line, arrows both ends', category: 'Lines', points: [[0, 0.5], [0.18, 0.1], [0.18, 0.42], [0.82, 0.42], [0.82, 0.1], [1, 0.5], [0.82, 0.9], [0.82, 0.58], [0.18, 0.58], [0.18, 0.9]] },
]

export const SHAPE_BY_ID: Record<string, ShapeDef> = Object.fromEntries(SHAPES.map(s => [s.id, s]))
/** Plain shapes drawn without a polygon. */
export const PLAIN_SHAPES = [{ id: 'rect', label: 'Rectangle', category: 'Basic' as ShapeCategory }, { id: 'ellipse', label: 'Ellipse / circle', category: 'Basic' as ShapeCategory }, { id: 'line', label: 'Line', category: 'Lines' as ShapeCategory }]
export const SHAPE_CATEGORIES: ShapeCategory[] = ['Basic', 'Polygons', 'Stars', 'Arrows', 'Callouts', 'Lines']

export const polygonOf = (kind: string): [number, number][] | undefined => SHAPE_BY_ID[kind]?.points
export const clipPathOf = (kind: string): string | undefined => { const p = polygonOf(kind); return p ? `polygon(${p.map(([x, y]) => `${r4(x * 100)}% ${r4(y * 100)}%`).join(', ')})` : undefined }
/** SVG `points` attribute for a polygon scaled to w x h. */
export const svgPoints = (pts: [number, number][], w: number, h: number): string => pts.map(([x, y]) => `${r4(x * w)},${r4(y * h)}`).join(' ')
