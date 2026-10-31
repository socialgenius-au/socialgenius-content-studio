// Post Document — validation. Returns every problem found (with a path), never throws.
import { walkElements } from './helpers'
import { isPostElementRole } from './roles'
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
  if (v.kind === 'placeholder') return isStr(v.label) && (v.glyph === undefined || v.glyph === 'sparkles' || v.glyph === 'none')
  return false
}

function backgroundOk(v: unknown): boolean {
  if (!isObj(v)) return false
  if (v.kind === 'solid') return colorOk(v.color)
  if (v.kind === 'gradient') return gradientOk(v)
  if (v.kind === 'image') return sourceOk(v.source) && (v.fit === 'cover' || v.fit === 'contain')
  return false
}

const unit = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1

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
      if (e.action !== undefined && !(isObj(e.action) && ['link', 'call', 'message', 'none'].includes(e.action.kind as string))) errors.push(`${path}.action: invalid`)
      break
    }
    case 'image': {
      if (!sourceOk(e.source)) errors.push(`${path}.source: invalid image source`)
      if (e.fit !== 'cover' && e.fit !== 'contain') errors.push(`${path}.fit: must be 'cover' or 'contain' (images are never stretched)`)
      if (typeof e.lockAspect !== 'boolean') errors.push(`${path}.lockAspect: must be boolean`)
      if (e.role === 'brand_logo' && e.lockAspect !== true) errors.push(`${path}: a brand_logo must preserve its aspect ratio (lockAspect: true)`)
      if (e.focal !== undefined && !(isObj(e.focal) && unit(e.focal.x) && unit(e.focal.y))) errors.push(`${path}.focal: x/y must be 0..1`)
      if (e.crop !== undefined && !(isObj(e.crop) && unit(e.crop.x) && unit(e.crop.y) && unit(e.crop.width) && unit(e.crop.height))) errors.push(`${path}.crop: normalized rectangle required`)
      break
    }
    case 'shape': {
      if (!['rect', 'ellipse', 'line'].includes(e.shape as string)) errors.push(`${path}.shape: invalid`)
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
    if (!Array.isArray(p.elements)) errors.push(`${path}.elements: must be an array`)
    else p.elements.forEach((el, j) => validateElement(el, `${path}.elements[${j}]`, errors, elementIds))
  })

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
