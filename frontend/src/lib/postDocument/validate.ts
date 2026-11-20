// Post Document — validation. Returns every problem found (with a path), never throws.
import { walkElements } from './helpers'
import { isPostElementRole } from './roles'
import { isSafeLinkUrl } from './links'
import { POST_DOCUMENT_SCHEMA_VERSION, type PostDocument, type PostElement } from './types'

export interface ValidationResult { ok: boolean; errors: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']
const PRIORITIES = ['must', 'high', 'normal', 'low']
const ORIGINS = ['manual', 'template', 'ai_generated', 'imported', 'adapted']

function colorOk(v: unknown): boolean {
  if (isStr(v)) return HEX.test(v)
  return isObj(v) && isStr(v.token) && v.token.length > 0 && isStr(v.fallback) && HEX.test(v.fallback)
}

function gradientOk(v: unknown): boolean {
  return isObj(v) && v.kind === 'gradient' && isNum(v.angle) && Array.isArray(v.stops) && v.stops.length >= 2
    && v.stops.every(s => isObj(s) && isNum(s.offset) && s.offset >= 0 && s.offset <= 1 && colorOk(s.color))
}

const paintOk = (v: unknown) => colorOk(v) || gradientOk(v)

function sourceOk(v: unknown): boolean {
  if (!isObj(v)) return false
  if (v.kind === 'asset') return isStr(v.url) || isNum(v.assetId)
  if (v.kind === 'brand') return v.slot === 'logo' || v.slot === 'mark'
  if (v.kind === 'qr') return isStr(v.data) && v.data.length > 0 && isSafeLinkUrl(v.data) && (v.fg === undefined || (isStr(v.fg) && HEX.test(v.fg))) && (v.bg === undefined || (isStr(v.bg) && HEX.test(v.bg)))
  if (v.kind === 'placeholder') return isStr(v.label) && (v.glyph === undefined || v.glyph === 'sparkles' || v.glyph === 'none')
  return false
}

const PATTERN_KINDS = ['dots', 'dots-fine', 'stripes', 'diagonal', 'grid', 'checker', 'zigzag', 'plus', 'crosshatch', 'grain']
const POLYGON_SHAPES = ['triangle', 'right-triangle', 'diamond', 'parallelogram', 'trapezoid', 'cross', 'heart', 'pentagon', 'hexagon', 'octagon', 'star-4', 'star-5', 'star-6', 'burst', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-double', 'chevron', 'bubble', 'bubble-round', 'line-arrow', 'line-arrow-double']
const unitNum = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1
function trimOk(t: unknown): boolean {
  if (!isObj(t)) return false
  const v = (k: string) => (isNum(t[k]) && (t[k] as number) >= 0 && (t[k] as number) <= 0.9 ? (t[k] as number) : NaN)
  const [a, b, c, d] = [v('top'), v('right'), v('bottom'), v('left')]
  return [a, b, c, d].every(n => !Number.isNaN(n)) && d + b < 0.95 && a + c < 0.95
}
function adjustOk(a: unknown): boolean {
  if (!isObj(a)) return false
  const rng = (k: string, lo: number, hi: number) => a[k] === undefined || (isNum(a[k]) && (a[k] as number) >= lo && (a[k] as number) <= hi)
  return rng('brightness', 0, 300) && rng('contrast', 0, 300) && rng('saturation', 0, 300) && rng('blur', 0, 0.1) && rng('grayscale', 0, 100) && rng('sepia', 0, 100) && rng('hue', -360, 360)
}

function backgroundOk(v: unknown): boolean {
  if (!isObj(v)) return false
  if (v.kind === 'solid') return colorOk(v.color)
  if (v.kind === 'gradient') return gradientOk(v)
  if (v.kind === 'image') return sourceOk(v.source) && (v.fit === 'cover' || v.fit === 'contain') && (v.adjust === undefined || adjustOk(v.adjust)) && (v.overlay === undefined || (isObj(v.overlay) && colorOk(v.overlay.color) && unitNum(v.overlay.opacity)))
  if (v.kind === 'pattern') return PATTERN_KINDS.includes(v.pattern as string) && colorOk(v.color) && colorOk(v.background) && isNum(v.scale) && v.scale >= 0.25 && v.scale <= 6
  return false
}

const unit = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1

const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'back', 'bounce']
const DIRECTIONS = ['left', 'right', 'up', 'down']
const ANIM_KINDS: Record<string, string[]> = { entrance: ['fade', 'slide', 'pop', 'zoom', 'bounce', 'rotate', 'typewriter'], exit: ['fade', 'slide', 'pop', 'zoom', 'bounce', 'rotate'], emphasis: ['pulse', 'bounce', 'rotate', 'zoom', 'fade'] }
const TRANSITIONS = ['none', 'fade', 'dissolve', 'slide', 'push', 'wipe', 'zoom', 'flip']
export const MAX_MOTION_MS = 60_000

function validateAnimations(v: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(v)) { errors.push(`${path}.animations: must be a list`); return }
  if (v.length > 3) errors.push(`${path}.animations: at most one entrance, one exit and one emphasis`)
  const seen = new Set<string>()
  v.forEach((a, i) => {
    const p = `${path}.animations[${i}]`
    if (!isObj(a)) { errors.push(`${p}: not an object`); return }
    if (!isStr(a.id) || !a.id) errors.push(`${p}.id: missing`)
    if (!isStr(a.phase) || !(a.phase in ANIM_KINDS)) { errors.push(`${p}.phase: must be entrance, exit or emphasis`); return }
    if (seen.has(a.phase)) errors.push(`${p}.phase: only one ${a.phase} per element`)
    seen.add(a.phase)
    if (!isStr(a.kind) || !ANIM_KINDS[a.phase].includes(a.kind)) errors.push(`${p}.kind: not available for ${a.phase}`)
    if (!(isNum(a.durationMs) && a.durationMs >= 50 && a.durationMs <= MAX_MOTION_MS)) errors.push(`${p}.durationMs: 50..${MAX_MOTION_MS}`)
    if (!(isNum(a.delayMs) && a.delayMs >= 0 && a.delayMs <= MAX_MOTION_MS)) errors.push(`${p}.delayMs: 0..${MAX_MOTION_MS}`)
    if (!EASINGS.includes(a.easing as string)) errors.push(`${p}.easing: unknown`)
    if (a.direction !== undefined && !DIRECTIONS.includes(a.direction as string)) errors.push(`${p}.direction: unknown`)
    if (a.repeat !== undefined && !(isNum(a.repeat) && Number.isInteger(a.repeat) && a.repeat >= 1 && a.repeat <= 20)) errors.push(`${p}.repeat: 1..20`)
  })
}

function validatePageMotion(p: Record<string, unknown>, path: string, errors: string[]): void {
  if (p.durationMs !== undefined && !(isNum(p.durationMs) && p.durationMs >= 500 && p.durationMs <= MAX_MOTION_MS)) errors.push(`${path}.durationMs: 500..${MAX_MOTION_MS}`)
  if (p.transition !== undefined) {
    const t = p.transition
    if (!isObj(t) || !TRANSITIONS.includes(t.kind as string)) errors.push(`${path}.transition.kind: unknown`)
    else {
      if (!(isNum(t.durationMs) && t.durationMs >= 0 && t.durationMs <= 10_000)) errors.push(`${path}.transition.durationMs: 0..10000`)
      if (!EASINGS.includes(t.easing as string)) errors.push(`${path}.transition.easing: unknown`)
      if (t.direction !== undefined && !DIRECTIONS.includes(t.direction as string)) errors.push(`${path}.transition.direction: unknown`)
    }
  }
  if (p.sequence !== undefined) {
    const s = p.sequence
    if (!isObj(s) || !['together', 'stagger', 'one-by-one'].includes(s.mode as string) || !(isNum(s.staggerMs) && s.staggerMs >= 0 && s.staggerMs <= 10_000)) errors.push(`${path}.sequence: invalid`)
  }
}

function validateElement(el: unknown, path: string, errors: string[], ids: Set<string>): void {
  if (!isObj(el)) { errors.push(`${path}: not an object`); return }
  const e = el as Record<string, unknown>
  if (!isStr(e.id) || !e.id) errors.push(`${path}.id: missing`)
  else if (ids.has(e.id)) errors.push(`${path}.id: duplicate id "${e.id}"`)
  else ids.add(e.id)
  if (!isPostElementRole(e.role)) errors.push(`${path}.role: unknown role "${String(e.role)}"`)
  if (!isStr(e.name)) errors.push(`${path}.name: missing`)

  // canvas-relative geometry
  if (!unit(e.x)) errors.push(`${path}.x: must be a fraction 0..1 of the canvas width`)
  if (!unit(e.y)) errors.push(`${path}.y: must be a fraction 0..1 of the canvas height`)
  if (!(isNum(e.width) && e.width > 0 && e.width <= 1)) errors.push(`${path}.width: must be a fraction in (0, 1] of the canvas width`)
  if (e.height === 'auto') { if (e.type !== 'text') errors.push(`${path}.height: 'auto' is only valid for text`) }
  else if (!(isNum(e.height) && e.height > 0 && e.height <= 1)) errors.push(`${path}.height: must be a fraction in (0, 1] of the canvas height`)
  if (!isNum(e.rotation)) errors.push(`${path}.rotation: must be a number (degrees)`)
  if (!(isNum(e.opacity) && e.opacity >= 0 && e.opacity <= 1)) errors.push(`${path}.opacity: must be 0..1`)
  if (typeof e.visible !== 'boolean') errors.push(`${path}.visible: must be boolean`)
  if (typeof e.locked !== 'boolean') errors.push(`${path}.locked: must be boolean`)
  if (e.origin !== undefined && !ORIGINS.includes(e.origin as string)) errors.push(`${path}.origin: unknown`)
  if (e.animations !== undefined) validateAnimations(e.animations, path, errors)
  if (e.link !== undefined && !(isObj(e.link) && isStr(e.link.url) && isSafeLinkUrl(e.link.url) && (e.link.label === undefined || (isStr(e.link.label) && e.link.label.length <= 200)))) errors.push(`${path}.link: not a valid, allowed link`)
  if (e.adapt !== undefined) {
    const a = e.adapt
    if (!isObj(a)) errors.push(`${path}.adapt: not an object`)
    else {
      if (a.anchor !== undefined && !ANCHORS.includes(a.anchor as string)) errors.push(`${path}.adapt.anchor: unknown`)
      if (a.priority !== undefined && !PRIORITIES.includes(a.priority as string)) errors.push(`${path}.adapt.priority: unknown`)
      if (a.minFontSize !== undefined && !(isNum(a.minFontSize) && a.minFontSize > 0 && a.minFontSize <= 1)) errors.push(`${path}.adapt.minFontSize: must be a fraction of the shorter side`)
    }
  }

  switch (e.type) {
    case 'text': {
      if (!isStr(e.content)) errors.push(`${path}.content: must be a string`)
      const s = e.style
      if (!isObj(s)) errors.push(`${path}.style: missing`)
      else {
        if (!(isStr(s.fontFamily) || (isObj(s.fontFamily) && isStr(s.fontFamily.token) && isStr(s.fontFamily.fallback)))) errors.push(`${path}.style.fontFamily: invalid`)
        if (!(isNum(s.fontSize) && s.fontSize > 0 && s.fontSize <= 1)) errors.push(`${path}.style.fontSize: must be a fraction (0, 1] of the shorter side`)
        if (!(isNum(s.fontWeight) && s.fontWeight >= 100 && s.fontWeight <= 900)) errors.push(`${path}.style.fontWeight: must be 100..900`)
        if (!(isNum(s.lineHeight) && s.lineHeight > 0)) errors.push(`${path}.style.lineHeight: must be > 0`)
        if (s.letterSpacing !== undefined && !isNum(s.letterSpacing)) errors.push(`${path}.style.letterSpacing: must be a number`)
        if (!['left', 'center', 'right'].includes(s.align as string)) errors.push(`${path}.style.align: invalid`)
        if (!colorOk(s.color)) errors.push(`${path}.style.color: must be a hex colour or a brand token with a hex fallback`)
        if (s.stroke !== undefined && !(isObj(s.stroke) && colorOk(s.stroke.color) && isNum(s.stroke.width) && s.stroke.width >= 0 && s.stroke.width <= 0.1)) errors.push(`${path}.style.stroke: invalid outline`)
        if (s.shadow !== undefined && !(isObj(s.shadow) && colorOk(s.shadow.color) && isNum(s.shadow.blur) && s.shadow.blur >= 0 && s.shadow.blur <= 0.2 && isNum(s.shadow.offsetX) && isNum(s.shadow.offsetY) && Math.abs(s.shadow.offsetX) <= 0.2 && Math.abs(s.shadow.offsetY) <= 0.2)) errors.push(`${path}.style.shadow: invalid shadow`)
      }
      if (!['fixed', 'auto-height', 'auto-width', 'shrink-to-fit'].includes(e.autoSize as string)) errors.push(`${path}.autoSize: invalid`)
      if (e.autoSize === 'fixed' && e.height === 'auto') errors.push(`${path}: a fixed text box needs a numeric height`)
      if (e.maxLines !== undefined && !(isNum(e.maxLines) && e.maxLines >= 1)) errors.push(`${path}.maxLines: must be >= 1`)
      if (e.box !== undefined) {
        const b = e.box
        if (!isObj(b)) errors.push(`${path}.box: not an object`)
        else {
          if (b.fill !== undefined && !paintOk(b.fill)) errors.push(`${path}.box.fill: invalid paint`)
          if (b.stroke !== undefined && !(isObj(b.stroke) && colorOk(b.stroke.color) && isNum(b.stroke.width) && b.stroke.width >= 0)) errors.push(`${path}.box.stroke: invalid`)
          for (const k of ['radius', 'paddingX', 'paddingY'] as const) if (b[k] !== undefined && !(isNum(b[k]) && (b[k] as number) >= 0)) errors.push(`${path}.box.${k}: must be >= 0 (shorter-side fraction)`)
        }
      }
      if (e.dynamic !== undefined) {
        const d = e.dynamic
        if (!isObj(d) || !['date', 'time', 'datetime', 'countdown', 'timer'].includes(d.kind as string)) errors.push(`${path}.dynamic.kind: unknown`)
        else {
          if (d.iso !== undefined && !(isStr(d.iso) && !Number.isNaN(Date.parse(d.iso)))) errors.push(`${path}.dynamic.iso: must be a date and time`)
          if (d.seconds !== undefined && !(isNum(d.seconds) && d.seconds >= 0 && d.seconds <= 359999)) errors.push(`${path}.dynamic.seconds: 0..359999`)
          if (d.direction !== undefined && d.direction !== 'down' && d.direction !== 'up') errors.push(`${path}.dynamic.direction: unknown`)
          if (d.style !== undefined && !['long', 'medium', 'short', 'numeric', '12h', '24h'].includes(d.style as string)) errors.push(`${path}.dynamic.style: unknown`)
          if (d.format !== undefined && !['auto', 'mm:ss', 'hh:mm:ss', 'ss'].includes(d.format as string)) errors.push(`${path}.dynamic.format: unknown`)
        }
      }
      if (e.action !== undefined && !(isObj(e.action) && ['link', 'call', 'message', 'none'].includes(e.action.kind as string))) errors.push(`${path}.action: invalid`)
      break
    }
    case 'image': {
      if (!sourceOk(e.source)) errors.push(`${path}.source: invalid image source`)
      if (e.fit !== 'cover' && e.fit !== 'contain') errors.push(`${path}.fit: must be 'cover' or 'contain' (images are never stretched)`)
      if (typeof e.lockAspect !== 'boolean') errors.push(`${path}.lockAspect: must be boolean`)
      if (e.role === 'brand_logo' && e.lockAspect !== true) errors.push(`${path}: a brand_logo must preserve its aspect ratio (lockAspect: true)`)
      if (e.focal !== undefined && !(isObj(e.focal) && unit(e.focal.x) && unit(e.focal.y))) errors.push(`${path}.focal: x/y must be 0..1`)
      if (e.zoom !== undefined && !(isNum(e.zoom) && e.zoom >= 1 && e.zoom <= 8)) errors.push(`${path}.zoom: must be 1..8`)
      if (e.mask !== undefined && !['none', 'circle', 'rounded', ...POLYGON_SHAPES].includes(e.mask as string)) errors.push(`${path}.mask: unknown`)
      if (e.adjust !== undefined && !adjustOk(e.adjust)) errors.push(`${path}.adjust: values out of range`)
      if (e.flipX !== undefined && typeof e.flipX !== 'boolean') errors.push(`${path}.flipX: must be boolean`)
      if (e.flipY !== undefined && typeof e.flipY !== 'boolean') errors.push(`${path}.flipY: must be boolean`)
      if (e.trim !== undefined && !(trimOk(e.trim))) errors.push(`${path}.trim: each edge 0..0.9 and the two opposite edges together under 0.95`)
      if (e.crop !== undefined && !(isObj(e.crop) && unit(e.crop.x) && unit(e.crop.y) && unit(e.crop.width) && unit(e.crop.height))) errors.push(`${path}.crop: normalized rectangle required`)
      break
    }
    case 'shape': {
      if (!['rect', 'ellipse', 'line', ...POLYGON_SHAPES].includes(e.shape as string)) errors.push(`${path}.shape: invalid`)
      if (e.text !== undefined && !(isObj(e.text) && isStr(e.text.content) && e.text.content.length <= 2000 && isObj(e.text.style) && isNum(e.text.style.fontSize) && e.text.style.fontSize > 0 && e.text.style.fontSize <= 1 && colorOk(e.text.style.color))) errors.push(`${path}.text: invalid text inside the shape`)
      if (e.fill !== undefined && !paintOk(e.fill)) errors.push(`${path}.fill: invalid paint`)
      if (e.stroke !== undefined && !(isObj(e.stroke) && colorOk(e.stroke.color) && isNum(e.stroke.width) && e.stroke.width >= 0)) errors.push(`${path}.stroke: invalid`)
      break
    }
    case 'group': {
      if (!Array.isArray(e.children)) errors.push(`${path}.children: must be an array`)
      else e.children.forEach((c, i) => validateElement(c, `${path}.children[${i}]`, errors, ids))
      break
    }
    default:
      errors.push(`${path}.type: unknown element type "${String(e.type)}"`)
  }
}

export function validatePostDocument(doc: unknown): ValidationResult {
  const errors: string[] = []
  if (!isObj(doc)) return { ok: false, errors: ['document: not an object'] }
  if (doc.kind !== 'post') errors.push('kind: must be "post"')
  if (doc.schemaVersion !== POST_DOCUMENT_SCHEMA_VERSION) errors.push(`schemaVersion: expected ${POST_DOCUMENT_SCHEMA_VERSION}, got ${String(doc.schemaVersion)}`)
  if (!isStr(doc.id) || !doc.id) errors.push('id: missing')
  if (!isStr(doc.title)) errors.push('title: missing')
  if (!(isNum(doc.revision) && Number.isInteger(doc.revision) && doc.revision >= 0)) errors.push('revision: must be a non-negative integer')
  if (!isStr(doc.createdAt) || Number.isNaN(Date.parse(doc.createdAt))) errors.push('createdAt: must be an ISO timestamp')
  if (!isStr(doc.updatedAt) || Number.isNaN(Date.parse(doc.updatedAt))) errors.push('updatedAt: must be an ISO timestamp')

  const f = doc.format
  if (!isObj(f)) errors.push('format: missing')
  else {
    if (!isStr(f.platformKey) || !isStr(f.formatKey)) errors.push('format: platformKey/formatKey required')
    if (!(isNum(f.width) && f.width > 0 && isNum(f.height) && f.height > 0)) errors.push('format: width/height must be positive')
    if (!isStr(f.ratio)) errors.push('format.ratio: required')
  }

  if (!isObj(doc.provenance) || !ORIGINS.includes(doc.provenance.origin as string)) errors.push('provenance.origin: missing or unknown')
  if (!isObj(doc.context)) errors.push('context: missing')

  const pageIds = new Set<string>()
  const elementIds = new Set<string>()
  if (!Array.isArray(doc.pages) || doc.pages.length < 1) errors.push('pages: at least one page is required')
  else doc.pages.forEach((p, i) => {
    const path = `pages[${i}]`
    if (!isObj(p)) { errors.push(`${path}: not an object`); return }
    if (!isStr(p.id) || !p.id) errors.push(`${path}.id: missing`)
    else if (pageIds.has(p.id)) errors.push(`${path}.id: duplicate page id "${p.id}"`)
    else pageIds.add(p.id)
    if (!backgroundOk(p.background)) errors.push(`${path}.background: invalid`)
    validatePageMotion(p, path, errors)
    if (!Array.isArray(p.elements)) errors.push(`${path}.elements: must be an array`)
    else p.elements.forEach((el, j) => validateElement(el, `${path}.elements[${j}]`, errors, elementIds))
  })

  if (doc.audio !== undefined) {
    const a = doc.audio
    const ms = (k: string, hi: number) => isObj(a) && isNum(a[k]) && (a[k] as number) >= 0 && (a[k] as number) <= hi
    if (!isObj(a) || !(isNum(a.assetId) && Number.isInteger(a.assetId) && a.assetId > 0) || !isStr(a.url) || !isStr(a.name) || !ms('sourceMs', 86_400_000) || !ms('trimStartMs', 86_400_000) || !ms('trimEndMs', 86_400_000) || !ms('offsetMs', 3_600_000) || !ms('fadeInMs', 600_000) || !ms('fadeOutMs', 600_000) || !(isNum(a.volume) && a.volume >= 0 && a.volume <= 2) || typeof a.muted !== 'boolean') errors.push('audio: invalid background music settings')
    else if ((a.trimEndMs as number) !== 0 && (a.trimEndMs as number) <= (a.trimStartMs as number)) errors.push('audio: the end of the trim must be after its start')
  }
  if (doc.variants !== undefined) {
    if (!isObj(doc.variants)) errors.push('variants: must be an object')
    else for (const [k, v] of Object.entries(doc.variants)) {
      if (!isObj(v) || v.key !== k || !isObj(v.overrides) || !isNum(v.basedOnRevision) || !['linked', 'detached'].includes(v.mode as string)) errors.push(`variants.${k}: invalid variant`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export function assertValidPostDocument(doc: unknown): asserts doc is PostDocument {
  const r = validatePostDocument(doc)
  if (!r.ok) throw new Error(`Invalid PostDocument:\n${r.errors.join('\n')}`)
}

/** Every element id in the document (test / tooling convenience). */
export function elementIds(doc: PostDocument): string[] {
  const ids: string[] = []
  for (const p of doc.pages) walkElements(p.elements, (e: PostElement) => ids.push(e.id))
  return ids
}
