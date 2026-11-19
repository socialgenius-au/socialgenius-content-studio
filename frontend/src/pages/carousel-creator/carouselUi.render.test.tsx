import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { MemoryRouter } from 'react-router-dom'
import { createCarouselDocument } from '../../lib/carousel/document'
import { MAX_SLIDES, addElement, insertSlide, makeImage, makeText, newSlide, type OpContext } from '../../lib/carousel/ops'
import type { PostDocument } from '../../lib/postDocument'

vi.mock('../../api/client', () => ({
  assetsApi: { list: async () => ({ data: [] }), previewUrl: (p: string) => p },
  uploadApi: { upload: async () => ({ data: {} }) },
  referenceVideosApi: { list: async () => ({ data: [] }) },
  deconstructorApi: { blueprint: async () => ({ data: {} }) },
}))

import Filmstrip from './components/Filmstrip'
import StartScreen from './components/StartScreen'
import Inspector from './components/Inspector'
import LayersPanel from './components/LayersPanel'
import ExportPanel from './components/ExportPanel'
import SlideView from './components/SlideView'

function ctx(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-19T09:00:00Z') } }
const doc = (layouts: Parameters<typeof createCarouselDocument>[0] extends infer O ? (O extends { layouts?: infer L } ? L : never) : never = ['cover', 'title_body', 'cta'], c = ctx()) => createCarouselDocument({ title: 'Tile tips', layouts }, c)
const noop = () => undefined
const html = (el: JSX.Element) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)

const strip = (d: PostDocument, active = d.pages[0].id) => html(<Filmstrip doc={d} activeId={active} onSelect={noop} onAdd={noop} onDuplicate={noop} onDelete={noop} onMove={noop} />)

describe('slide filmstrip', () => {
  it('lists every slide in order with its number, marks the open one, and draws a real thumbnail of each', () => {
    const d = doc()
    const h = strip(d, d.pages[1].id)
    expect(h.match(/data-testid="slide-item"/g)).toHaveLength(3)
    expect([...h.matchAll(/data-testid="slide-number">(\d+)</g)].map(m => m[1])).toEqual(['1', '2', '3'])
    expect(h).toContain('Slides <span data-testid="slide-count">3</span>/20')
    for (const p of d.pages) expect(h).toContain(`data-slide-id="${p.id}"`)
    expect(h).toMatch(/data-slide-id="slide_\d+" data-active="true"/)
    expect(h.match(/data-active="true"/g)).toHaveLength(1)
    expect(h).toContain('aria-current="true"')
    expect(h).toContain('Your big idea in one bold line')                         // the thumbnail renders the slide's own content
  })

  it('offers add, duplicate, delete and move controls with accessible names, and every thumbnail is draggable for reordering', () => {
    const h = strip(doc())
    for (const label of ['Move slide earlier', 'Move slide later', 'Duplicate slide', 'Delete slide', 'Layout for the new slide']) expect(h).toContain(`aria-label="${label}"`)
    expect(h.match(/draggable="true"/g)).toHaveLength(3)
    expect(h).toContain('data-testid="slide-add"')
    for (const l of ['Cover', 'Title + text', 'Big statement', 'List', 'Image + caption', 'Quote', 'Call to action']) expect(h).toContain(`>${l}</option>`)
  })

  it('cannot delete the only slide, cannot move past the ends, and stops adding at the Instagram limit', () => {
    const one = doc(['cover'])
    const h1 = strip(one)
    expect(h1).toMatch(/data-testid="slide-delete"[^>]*disabled|disabled=""[^>]*data-testid="slide-delete"/)
    expect(h1).toMatch(/disabled=""[^>]*data-testid="slide-move-earlier"|data-testid="slide-move-earlier"[^>]*disabled/)
    const c = ctx()
    let d = doc(['cover'], c)
    while (d.pages.length < MAX_SLIDES) d = insertSlide(d, newSlide({ kind: 'solid', color: '#fff' }, [], undefined, c), undefined, c)
    const h = strip(d)
    expect(h).toMatch(/disabled=""[^>]*data-testid="slide-add"|data-testid="slide-add"[^>]*disabled/)
    expect(h).toMatch(/disabled=""[^>]*data-testid="slide-duplicate"|data-testid="slide-duplicate"[^>]*disabled/)
    expect(h).toContain('Instagram allows at most 20 slides.')
  })

  it('is a horizontal scroller on phones and tablets and a vertical column at xl', () => {
    const h = strip(doc())
    expect(h).toContain('overflow-x-auto')
    expect(h).toContain('xl:flex-col')
    expect(h).toContain('xl:w-full')
  })
})

describe('start screen', () => {
  const props = { saved: [], storageAvailable: true, onOpen: noop, onDelete: noop, onCreate: noop }
  it('offers a new carousel with the registry carousel formats and the themes, Instagram 4:5 first', () => {
    const h = html(<StartScreen {...props} />)
    expect(h).toContain('Carousel Creator')
    expect(h).toContain('data-testid="new-form"')
    expect(h).toMatch(/<option value="instagram\/carousel"[^>]*>Instagram · Carousel \(4:5\)<\/option>/)
    for (const t of ['Forest', 'Ivory', 'Ink', 'Sunrise']) expect(h).toContain(`>${t}</option>`)
    expect(h).toContain('Plan from a blueprint')
    expect(h).toContain('Nothing saved yet')
  })

  it('lists saved carousels with slide counts and warns when browser storage is blocked', () => {
    const saved = [{ id: 'a', title: 'Tile tips', slideCount: 5, updatedAt: '2026-11-19T09:00:00Z', platformKey: 'instagram', formatKey: 'carousel' }]
    const h = html(<StartScreen {...props} saved={saved} storageAvailable={false} />)
    expect(h).toContain('Tile tips')
    expect(h).toContain('5 slides')
    expect(h).toContain('aria-label="Open Tile tips"')
    expect(h).toContain('aria-label="Delete Tile tips"')
    expect(h).toContain('data-testid="no-storage"')
    expect(h).toContain('blocking site storage')
  })
})

describe('inspector', () => {
  const insp = (d: PostDocument, selectedId?: string) => html(<Inspector doc={d} page={d.pages[0]} selected={selectedId ? d.pages[0].elements.find(e => e.id === selectedId) : undefined} dispatch={noop} />)

  it('with nothing selected it edits the slide (name, background, layout) and lets you add elements', () => {
    const h = insp(doc())
    for (const t of ['slide-name', 'bg-color', 'bg-gradient', 'bg-image', 'apply-layout', 'add-text', 'add-image', 'add-shape', 'no-selection']) expect(h).toContain(`data-testid="${t}"`)
  })

  it('a selected text element shows its content, font, size, weight, alignment and colour controls', () => {
    const d = doc()
    const headline = d.pages[0].elements.find(e => e.name === 'Headline')!
    const h = insp(d, headline.id)
    expect(h).toContain('Your big idea in one bold line')
    for (const l of ['Text content', 'Font', 'Text size', 'Font weight', 'Align left', 'Align center', 'Align right', 'Text colour', 'Line height', 'Bring to front', 'Delete element', 'X position percent', 'Opacity']) expect(h).toContain(`aria-label="${l}"`)
    expect(h).toContain('aria-pressed="true"')                                        // the current alignment is pressed
  })

  it('a locked element is shown as locked and a selected image offers the picture picker', () => {
    const c = ctx()
    let d = doc(['cover'], c)
    d = addElement(d, d.pages[0].id, makeImage({ name: 'Photo' }, c), c)
    const photo = d.pages[0].elements.find(e => e.name === 'Photo')!
    const h = insp(d, photo.id)
    expect(h).toContain('data-testid="image-picker"')
    expect(h).toContain('Upload a picture')
    expect(h).toContain('aria-label="Image fit"')
    const base = doc(['cover'], c)
    const locked = addElement(base, base.pages[0].id, makeText(base.format, { name: 'L', locked: true }, c), c)
    expect(insp(locked, locked.pages[0].elements.find(e => e.name === 'L')!.id)).toContain('aria-label="Unlock element"')
  })
})

describe('layers panel', () => {
  it('lists layers front first and marks the selected one', () => {
    const d = doc(['cover'])
    const els = d.pages[0].elements
    const h = html(<LayersPanel page={d.pages[0]} selectedId={els[2].id} dispatch={noop} />)
    const order = [...h.matchAll(/data-testid="layer-item" data-element-id="([^"]+)"/g)].map(m => m[1])
    expect(order).toEqual([...els].reverse().map(e => e.id))
    expect(h).toMatch(new RegExp(`data-element-id="${els[2].id}" data-selected="true"`))
    expect(h).toContain('Layers (front first)')
  })
})

describe('export panel', () => {
  it('shows the export size, the three export actions, and warns about empty image slots before exporting', () => {
    const d = doc(['cover', 'image_caption'])
    const h = html(<ExportPanel doc={d} activeIndex={1} />)
    expect(h).toContain('Each slide exports at 1080 × 1350 px (4:5).')
    expect(h).toContain('This slide (2) as PNG')
    expect(h).toContain('All 2 slides (ZIP of PNG)')
    expect(h).toContain('PDF, one page per slide')
    expect(h).toContain('data-testid="export-warnings"')
    expect(h).toContain('Slide 2: the image &quot;Hero image&quot; is still empty')
    expect(html(<ExportPanel doc={doc(['cover'])} activeIndex={0} />)).not.toContain('export-warnings')
  })
})

describe('slide view', () => {
  it('is a size container with the slide aspect ratio, so thumbnails and the canvas draw identically', () => {
    const d = doc()
    const h = renderToStaticMarkup(<SlideView doc={d} pageId={d.pages[1].id} />)
    expect(h).toContain('container-type:size')
    expect(h).toContain('aspect-ratio:1080 / 1350')
    expect(h).toContain(`data-page-id="${d.pages[1].id}"`)
    expect(h).toContain('Make the point clearly')
  })
})

describe('wiring', () => {
  const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8')
  const nav = readFileSync(new URL('../../config/navigation.ts', import.meta.url), 'utf8')
  it('the carousel route lives inside the app shell (so phones get the navigation drawer) and has a Growth navigation entry', () => {
    expect(app).toContain("const CarouselCreatorPage = lazy(() => import('./pages/carousel-creator/CarouselCreatorPage'))")
    const shellEnd = app.indexOf('</Route>', app.indexOf('path="/carousel-creator"'))
    expect(app.indexOf('path="/carousel-creator"')).toBeGreaterThan(app.indexOf('<AppShell />'))
    expect(shellEnd).toBeGreaterThan(app.indexOf('path="/carousel-creator"'))
    expect(nav).toContain("id: 'carousel-creator', label: 'Carousel Creator'")
    expect(nav).toContain("path: '/carousel-creator'")
  })
})
