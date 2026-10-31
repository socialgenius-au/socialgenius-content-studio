// The ABC Tiles MOCK post, expressed as a real PostDocument. This is placeholder client content (Post Creator has no real documents yet).
//
// The layout below reproduces what the old hard-coded CSS did: a stack of headline / supporting text / CTA anchored to the bottom-left
// with a 7% padding, and the logo at the top-left. It is expressed as EXPLICIT canvas-relative numbers computed for the document's own canvas.
// Nothing edits the document in P2, so changing format simply builds a fresh mock document for that format (the same look P1 showed).
// Real "Adapt to Platform" will replace this later; it is not attempted here.
import {
  POST_DOCUMENT_SCHEMA_VERSION, type DocumentFormat, type ImageElement, type PostDocument, type TextElement,
} from '../../../lib/postDocument'

const round = (n: number) => Math.round(n * 100000) / 100000

// Design values, in shorter-side units (1 = the canvas's shorter side).
const PAD = 0.07
const GAP = 0.026
const HEADLINE = { size: 0.07, lineHeight: 1.1, lines: 2 }
const SUPPORT = { size: 0.032, lineHeight: 1.2 }
const CTA = { size: 0.032, lineHeight: 1.2, padX: 0.037, padY: 0.021, radius: 0.016, extraTopGap: 0.016 }
const LOGO = { inset: 0.054, width: 0.27, height: 0.045 }

const FONT = { token: 'brand.font.body', fallback: 'Inter, ui-sans-serif, system-ui, sans-serif' }
const WHITE = '#FFFFFF'
/** The creative's own accent (a document/brand colour). It never follows the app's Light/Dark theme. */
const ACCENT = { token: 'brand.accent', fallback: '#1E8A55' }

export function createAbcTilesMockDocument(format: DocumentFormat, now: Date = new Date()): PostDocument {
  const s = Math.min(format.width, format.height)
  const cw = format.width / s      // canvas width in shorter-side units
  const ch = format.height / s     // canvas height in shorter-side units
  const stackX = round(PAD / cw)
  const stackW = round((cw - 2 * PAD) / cw)

  // Bottom-up stack (matches the old flex column: justify-content: flex-end).
  const ctaH = CTA.size * CTA.lineHeight + 2 * CTA.padY
  const ctaY = ch - PAD - ctaH
  const supportH = SUPPORT.size * SUPPORT.lineHeight
  const supportY = ctaY - (GAP + CTA.extraTopGap) - supportH
  const headlineH = HEADLINE.size * HEADLINE.lineHeight * HEADLINE.lines
  const headlineY = supportY - GAP - headlineH

  const iso = now.toISOString()

  const logo: ImageElement = {
    id: 'el-logo', role: 'brand_logo', name: 'Logo', type: 'image',
    x: round(LOGO.inset / cw), y: round(LOGO.inset / ch), width: round(LOGO.width / cw), height: round(LOGO.height / ch),
    rotation: 0, opacity: 1, visible: true, locked: false,
    source: { kind: 'placeholder', label: 'ABC TILES', glyph: 'sparkles' },   // wordmark placeholder; Brand Kit / asset source comes later
    fit: 'contain', lockAspect: true, alt: 'ABC Tiles logo',
  }

  const headline: TextElement = {
    id: 'el-headline', role: 'primary_headline', name: 'Headline', type: 'text',
    x: stackX, y: round(headlineY / ch), width: stackW, height: 'auto',
    rotation: 0, opacity: 1, visible: true, locked: false,
    content: 'LARGE FORMAT.\nPREMIUM FINISH.',
    style: { fontFamily: FONT, fontSize: HEADLINE.size, fontWeight: 800, lineHeight: HEADLINE.lineHeight, align: 'left', color: WHITE },
    autoSize: 'auto-height',
  }

  const supporting: TextElement = {
    id: 'el-supporting', role: 'supporting_text', name: 'Supporting text', type: 'text',
    x: stackX, y: round(supportY / ch), width: stackW, height: 'auto',
    rotation: 0, opacity: 0.85, visible: true, locked: false,
    content: 'BUILT FOR QUALITY. MADE FOR BUILDERS.',
    style: { fontFamily: FONT, fontSize: SUPPORT.size, fontWeight: 400, lineHeight: SUPPORT.lineHeight, align: 'left', color: WHITE },
    autoSize: 'auto-height',
  }

  const cta: TextElement = {
    id: 'el-cta', role: 'primary_cta', name: 'Call to action', type: 'text',
    x: stackX, y: round(ctaY / ch), width: stackW, height: 'auto',
    rotation: 0, opacity: 1, visible: true, locked: false,
    content: 'SEND YOUR TILE SCHEDULE →',
    style: { fontFamily: FONT, fontSize: CTA.size, fontWeight: 700, lineHeight: CTA.lineHeight, align: 'left', color: WHITE },
    autoSize: 'auto-width', maxLines: 1,
    box: { fill: ACCENT, radius: CTA.radius, paddingX: CTA.padX, paddingY: CTA.padY },
    action: { kind: 'none' },
  }

  return {
    kind: 'post',
    schemaVersion: POST_DOCUMENT_SCHEMA_VERSION,
    id: 'mock-abc-tiles-post',
    title: 'ABC Tiles - Large Format (mock)',
    revision: 0,
    format,
    pages: [{
      id: 'page-1',
      name: 'Page 1',
      background: { kind: 'gradient', angle: 155, stops: [{ offset: 0, color: '#2C3532' }, { offset: 0.6, color: '#1A201D' }, { offset: 1, color: '#1A201D' }] },
      // PAINT ORDER, back -> front.
      elements: [headline, supporting, cta, logo],
    }],
    context: {
      brand: { clientName: 'ABC Tiles' },
      message: { keyMessage: 'Large format. Premium finish.', cta: 'Send your tile schedule' },
    },
    provenance: { origin: 'manual', note: 'Post Creator P2 mock seed - placeholder content, not a real client document.' },
    createdAt: iso,
    updatedAt: iso,
  }
}
