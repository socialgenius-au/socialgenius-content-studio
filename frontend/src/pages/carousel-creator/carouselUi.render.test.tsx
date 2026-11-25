import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { MemoryRouter } from 'react-router-dom'
import { createCarouselDocument } from '../../lib/carousel/document'
import { addElement, insertSlide, makeImage, makeShape, makeText, newSlide, setElementAnimation, type OpContext } from '../../lib/carousel/ops'
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
import { ConflictBanner, RecoveryPrompt, SaveBadge } from './components/SyncStatus'
import AnimatePanel from './components/AnimatePanel'
import DesignPanel from './components/DesignPanel'
import { PLAIN_SHAPES, SHAPES } from '../../lib/carousel/shapes'
import { themeById } from '../../lib/carousel/layouts'
import { defaultAnimation } from '../../lib/carousel/animation'
import BrandPanel from './components/BrandPanel'
import TemplatesPanel from './components/TemplatesPanel'
import BrandKitManager, { validateFontFile } from './components/BrandKitManager'
import type { SyncState } from '../../lib/carousel/syncEngine'

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
    expect(h).toContain('Slides <span data-testid="slide-count">3</span>')
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

  it('cannot delete the only slide, cannot move past the ends, and never blocks adding slides', () => {
    const one = doc(['cover'])
    const h1 = strip(one)
    expect(h1).toMatch(/data-testid="slide-delete"[^>]*disabled|disabled=""[^>]*data-testid="slide-delete"/)
    expect(h1).toMatch(/disabled=""[^>]*data-testid="slide-move-earlier"|data-testid="slide-move-earlier"[^>]*disabled/)
    const c = ctx()
    let d = doc(['cover'], c)
    while (d.pages.length < 40) d = insertSlide(d, newSlide({ kind: 'solid', color: '#fff' }, [], undefined, c), undefined, c)
    const h = strip(d)
    expect(h).not.toMatch(/disabled=""[^>]*data-testid="slide-add"|data-testid="slide-add"[^>]*disabled/)    // adding is never blocked by a slide count
    expect(h).not.toMatch(/disabled=""[^>]*data-testid="slide-duplicate"|data-testid="slide-duplicate"[^>]*disabled/)
    expect(h).not.toContain('Instagram allows at most')
    expect(h).toContain('<span data-testid="slide-count">40</span>')
    expect(h.match(/data-testid="slide-item"/g)).toHaveLength(40)
  })

  it('is a horizontal scroller on phones and tablets and a vertical column at xl', () => {
    const h = strip(doc())
    expect(h).toContain('overflow-x-auto')
    expect(h).toContain('xl:flex-col')
    expect(h).toContain('xl:w-full')
  })
})

describe('start screen', () => {
  const props = { items: [], listState: 'ready' as const, onRetryList: noop, busy: false, onOpen: noop, onDuplicate: noop, onDelete: noop, onCreate: noop }
  it('offers a new carousel with the registry carousel formats and the themes, Instagram 4:5 first', () => {
    const h = html(<StartScreen {...props} />)
    expect(h).toContain('Carousel Creator')
    expect(h).toContain('data-testid="new-form"')
    expect(h).toMatch(/<option value="instagram\/carousel"[^>]*>Instagram · Carousel \(4:5\)<\/option>/)
    for (const t of ['Forest', 'Ivory', 'Ink', 'Sunrise']) expect(h).toContain(`>${t}</option>`)
    expect(h).toContain('Plan from a blueprint')
    expect(h).toContain('Nothing saved yet')
    expect(h).toContain('saved to your account')
    expect(h).not.toContain('data-testid="browser-copies"')
  })

  const item = { id: 'a', title: 'Tile tips', slideCount: 5, updatedAt: '2026-11-19T09:00:00Z', createdAt: '2026-11-19T09:00:00Z', platformKey: 'instagram', formatKey: 'carousel', themeId: 'forest', origin: 'server', version: 3 }

  it('lists your account carousels with slide counts and open / duplicate / delete actions', () => {
    const h = html(<StartScreen {...props} items={[item]} />)
    expect(h).toContain('Tile tips')
    expect(h).toContain('5 slides')
    expect(h).toContain('aria-label="Open Tile tips"')
    expect(h).toContain('aria-label="Duplicate Tile tips"')
    expect(h).toContain('aria-label="Delete Tile tips"')
    expect(h).not.toContain('blocking site storage')
  })

  it('says when the list is loading or could not be loaded, with a way to try again', () => {
    expect(html(<StartScreen {...props} listState="loading" />)).toContain('Loading your carousels')
    const h = html(<StartScreen {...props} listState="error" listError="Could not reach the server." />)
    expect(h).toContain('data-testid="list-error"')
    expect(h).toContain('Could not reach the server.')
    expect(h).toContain('data-testid="retry-list"')
    expect(h).not.toContain('Nothing saved yet')
  })

  it('offers browser-only carousels for an explicit copy to the account, and only offers removal after they are in the account', () => {
    const local = [
      { id: 'l1', title: 'Old one', slideCount: 3, updatedAt: '2026-11-01T09:00:00Z', platformKey: 'instagram', formatKey: 'carousel' },
      { id: 'l2', title: 'Old two', slideCount: 4, updatedAt: '2026-11-02T09:00:00Z', platformKey: 'instagram', formatKey: 'carousel', imported: { serverId: 'l2', at: '2026-11-19T00:00:00Z', asCopy: false } },
    ]
    const h = html(<StartScreen {...props} local={local} />)
    expect(h).toContain('Saved only in this browser')
    expect(h).toContain('Nothing is deleted from this browser')
    expect(h).toContain('aria-label="Copy Old one to my account"')
    expect(h).not.toContain('aria-label="Remove Old one from this browser"')
    expect(h).toContain('aria-label="Remove Old two from this browser"')
    expect(h).not.toContain('data-testid="import-all"')                          // only one is waiting: no bulk button
    const many = html(<StartScreen {...props} local={[local[0], { ...local[0], id: 'l3', title: 'Old three' }]} />)
    expect(many).toContain('Copy all 2 to my account')
  })

  it('shows the result of an import in words, with an escape hatch when the id is taken by a different carousel', () => {
    const local = [{ id: 'l1', title: 'Old one', slideCount: 3, updatedAt: '2026-11-01T09:00:00Z', platformKey: 'instagram', formatKey: 'carousel' }]
    const h = html(<StartScreen {...props} local={local} importResults={{ l1: { id: 'l1', status: 'exists-different', message: 'A different carousel with this id is already in your account. It was not changed.' } }} />)
    expect(h).toContain('It was not changed')
    expect(h).toContain('data-testid="import-as-copy"')
  })
})

describe('save status, conflict and recovery messages', () => {
  const base = { version: 2, unsaved: false, attempts: 0 }
  it('names every state in words', () => {
    const t = (state: Partial<SyncState> & { status: SyncState['status'] }) => html(<SaveBadge state={{ ...base, ...state }} onRetry={noop} />)
    expect(t({ status: 'saving' })).toContain('Saving…')
    expect(t({ status: 'dirty', unsaved: true })).toContain('Saving…')
    expect(t({ status: 'saved', lastSavedAt: '2026-11-19T09:00:00Z' })).toMatch(/Saved \d/)
    expect(t({ status: 'clean' })).toContain('All changes saved')
    expect(t({ status: 'retrying', unsaved: true, attempts: 2 })).toMatch(/retrying. Your changes are kept/)
    expect(t({ status: 'failed', unsaved: true, error: 'slide 2 is broken' })).toContain('Save failed: slide 2 is broken')
    expect(t({ status: 'conflict', unsaved: true })).toContain('needs your decision')
    expect(t({ status: 'auth', unsaved: true })).toContain('signed out')
    expect(t({ status: 'saved' })).toContain('data-sync-status="saved"')
  })
  it('the conflict banner offers two explicit choices and appears only in conflict', () => {
    expect(html(<ConflictBanner state={{ ...base, status: 'saved' }} onKeepMine={noop} onUseServer={noop} />)).toBe('')
    const h = html(<ConflictBanner state={{ ...base, status: 'conflict', unsaved: true }} onKeepMine={noop} onUseServer={noop} />)
    expect(h).toContain('changed somewhere else')
    expect(h).toContain('nothing is overwritten until you do')
    expect(h).toContain('data-testid="keep-mine"')
    expect(h).toContain('data-testid="use-server"')
  })
  it('the recovery prompt explains what was found and offers restore or discard', () => {
    const h = html(<RecoveryPrompt title="Tile tips" serverNewer onRestore={noop} onDiscard={noop} />)
    expect(h).toContain('Unsaved edits found')
    expect(h).toContain('Tile tips')
    expect(h).toContain('choose which one to keep')
    expect(h).toContain('data-testid="recovery-restore"')
    expect(h).toContain('data-testid="recovery-discard"')
    expect(html(<RecoveryPrompt title="Tile tips" serverNewer={false} onRestore={noop} onDiscard={noop} />)).not.toContain('choose which one to keep')
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
  it('registers a protected full-width carousel workspace and a navigation entry', () => {
    expect(app).toContain("const CarouselCreatorPage = lazy(() => import('./pages/carousel-creator/CarouselCreatorPage'))")
    expect(app).toMatch(/<Route path="\/carousel-creator" element=\{<RequireAuth><ClientProvider><Suspense[^\n]*<CarouselCreatorPage \/>/)
    expect(app.indexOf('path="/carousel-creator"')).toBeLessThan(app.indexOf('<AppShell />'))
    expect(nav).toContain("id: 'carousel-creator', label: 'Carousel Creator'")
    expect(nav).toContain("path: '/carousel-creator'")
  })
})

describe('advanced layers UI', () => {
  const withImgs = () => {
    const c = ctx()
    let d = doc(['cover'], c)
    const page = d.pages[0].id
    const a = makeImage({ name: 'Pic A', source: { kind: 'asset', assetId: 1, url: '/uploads/1/a.png' }, mask: 'hexagon', zoom: 2, focal: { x: 0.25, y: 0.75 } }, c)
    const b = makeImage({ name: 'Pic B', source: { kind: 'asset', assetId: 2, url: '/uploads/1/b.png' }, mask: 'circle' }, c)
    const t = makeText(d.format, { name: 'Words' }, c)
    for (const e of [a, b, t]) d = addElement(d, page, e, c)
    return { d, page: d.pages[0], a, b, t }
  }

  it('the inspector offers align / distribute / group for two or more selected elements, distribute only from three', () => {
    const { d, page, a, b, t } = withImgs()
    const two = html(<Inspector doc={d} page={page} selected={b} selectedIds={[a.id, b.id]} dispatch={noop} />)
    expect(two).toContain('data-testid="multi-panel"')
    expect(two).toContain('2 elements selected')
    for (const m of ['left', 'center', 'right', 'top', 'middle', 'bottom']) expect(two).toContain(`data-testid="align-${m}"`)
    expect(two).toMatch(/disabled=""[^>]*data-testid="distribute-h"|data-testid="distribute-h"[^>]*disabled/)
    expect(two).not.toContain('data-testid="text-content"')                        // single-element settings are hidden while several are selected
    const three = html(<Inspector doc={d} page={page} selected={t} selectedIds={[a.id, b.id, t.id]} dispatch={noop} />)
    expect(three).not.toMatch(/disabled=""[^>]*data-testid="distribute-h"|data-testid="distribute-h"[^>]*disabled/)
    expect(html(<Inspector doc={d} page={page} selected={a} selectedIds={[a.id]} dispatch={noop} />)).not.toContain('data-testid="multi-panel"')
  })

  it('an image offers shape (mask), zoom, pan and replace, and the toolbar can add several pictures', () => {
    const { d, page, a } = withImgs()
    const h = html(<Inspector doc={d} page={page} selected={a} selectedIds={[a.id]} dispatch={noop} />)
    expect(h).toContain('data-testid="image-mask"')
    for (const m of ['Circle / oval', 'Diamond', 'Hexagon', 'Triangle', 'Rounded']) expect(h).toContain(m)
    expect(h).toContain('data-testid="image-zoom"')
    expect(h).toContain('data-testid="image-focus-x"')
    expect(h).toContain('Replace this picture')
    expect(h).toContain('data-testid="add-images"')
  })

  it('the layers panel has per-layer select, lock, visibility and order controls, plus Group / Ungroup and Select all', () => {
    const { page, a, b } = withImgs()
    const one = html(<LayersPanel page={page} selectedId={a.id} selectedIds={[a.id]} dispatch={noop} />)
    expect(one.match(/data-testid="layer-check"/g)).toHaveLength(page.elements.length)
    expect(one).toContain('aria-label="Lock Pic A"')
    expect(one).toContain('aria-label="Hide Pic A"')
    expect(one).toContain('aria-label="Bring Pic A forward"')
    expect(one).toMatch(/disabled=""[^>]*data-testid="group-btn"|data-testid="group-btn"[^>]*disabled/)
    expect(one).toContain('1 selected')
    const two = html(<LayersPanel page={page} selectedId={b.id} selectedIds={[a.id, b.id]} dispatch={noop} />)
    expect(two).not.toMatch(/disabled=""[^>]*data-testid="group-btn"|data-testid="group-btn"[^>]*disabled/)
    expect(two).toContain('2 selected')
    expect(two).toContain('data-testid="select-all-btn"')
  })

  it('on screen, masks clip the picture and zoom scales it about its focus', () => {
    const { d } = withImgs()
    const h = html(<SlideView doc={d} pageId={d.pages[0].id} />)
    expect(h).toContain('clip-path:polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)')
    expect(h).toContain('border-radius:50%')
    expect(h).toContain('transform:scale(2)')
    expect(h).toContain('transform-origin:25% 75%')
  })
})

describe('Brand Kit and template panels', () => {
  const kit = { id: 7, name: 'Acme', kit: { brand_names: [{ id: 'n1', label: 'Full', text: 'Acme Tiles' }], colors: { primary: '#C2185B', accent: '#00ACC1', extra: [{ name: 'Grout', hex: '#999999' }] }, logos: [{ id: 'l1', label: 'Main', asset_id: 9, url: '/uploads/1/logo.png' }], fonts: [], font_roles: {}, assets: [] } }
  const kits = [{ id: 7, name: 'Acme', primary: '#C2185B', logoCount: 1, fontCount: 0, updatedAt: 't' }]
  const base = { kit: null, kits, busy: false, onChooseKit: noop, onApply: noop, onDetach: noop, onAddLogo: noop, onAddName: noop, onManage: noop }

  it('with no kit it offers to choose or create one; with a kit it shows colours, apply (non-destructive), logos and names', () => {
    const none = html(<BrandPanel {...base} />)
    expect(none).toContain('data-testid="kit-select"')
    expect(none).toContain('data-testid="manage-kits"')
    expect(none).not.toContain('data-testid="apply-kit"')
    expect(html(<BrandPanel {...base} kits={[]} />)).toContain('You have no Brand Kits yet')
    const h = html(<BrandPanel {...base} kit={kit} report={{ recoloured: 12, refonted: 3, kept: 2 }} />)
    expect(h).toContain('data-testid="apply-kit"')
    expect(h).toContain('Anything you changed yourself is left alone')
    expect(h).toContain('Updated 12 colours and 3 fonts. Kept 2 custom colours as you set them.')
    expect(h).toContain('aria-label="Add logo Main to this slide"')
    expect(h).toContain('aria-label="Add brand name Full to this slide"')
    expect(h).toContain('data-testid="kit-swatches"')
    expect(html(<BrandPanel {...base} missingKitId={7} />)).toContain('no longer available')
  })

  it('the templates panel saves a carousel or a slide, and lists templates with apply / duplicate / rename / update / delete', () => {
    const tpls = [{ id: 1, name: 'Tile tips', description: 'Five slides', kind: 'carousel' as const, slideCount: 5, platformKey: 'instagram', formatKey: 'carousel', brandKitId: null, updatedAt: 't' }]
    const props = { busy: false, onSave: noop, onApply: noop, onDuplicate: noop, onRename: noop, onUpdateFrom: noop, onDelete: noop }
    const h = html(<TemplatesPanel {...props} templates={tpls} />)
    expect(h).toContain('data-testid="save-carousel-template"'); expect(h).toContain('data-testid="save-slide-template"')
    expect(h).toMatch(/disabled=""[^>]*data-testid="save-carousel-template"|data-testid="save-carousel-template"[^>]*disabled/)    // needs a name first
    expect(h).toContain('Tile tips'); expect(h).toContain('Carousel · 5 slides · Five slides')
    for (const t of ['template-apply-after', 'template-apply-end', 'template-apply-replace', 'template-duplicate', 'template-delete', 'template-update-carousel']) expect(h).toContain(`data-testid="${t}"`)
    expect(h).toContain('aria-label="Rename Tile tips"')
    expect(html(<TemplatesPanel {...props} templates={[]} />)).toContain('No templates yet')
    expect(html(<TemplatesPanel {...props} templates={null} />)).toContain('Loading your templates')
  })

  it('the start screen can start from a template, pick a Brand Kit for a new carousel and open the Brand Kit manager', () => {
    const sp = { items: [], listState: 'ready' as const, onRetryList: noop, busy: false, onOpen: noop, onDuplicate: noop, onDelete: noop, onCreate: noop }
    const tpl = { id: 1, name: 'Tile tips', description: '', kind: 'layout' as const, slideCount: 2, platformKey: 'instagram', formatKey: 'carousel', brandKitId: null, updatedAt: 't' }
    const h = html(<StartScreen {...sp} kits={kits} templates={[tpl]} onUseTemplate={noop} onOpenBrandKits={noop} />)
    expect(h).toContain('data-testid="tab-template"')
    expect(h).toContain('data-testid="new-kit"'); expect(h).toContain('>Acme</option>')
    expect(h).toContain('data-testid="open-brand-kits"')
  })

  it('only real font files are accepted for upload', () => {
    expect(validateFontFile({ name: 'Brand.TTF', size: 1000 })).toBeNull()
    for (const n of ['a.otf', 'b.woff', 'c.woff2']) expect(validateFontFile({ name: n, size: 10 })).toBeNull()
    expect(validateFontFile({ name: 'virus.exe', size: 10 })).toMatch(/not a font file/)
    expect(validateFontFile({ name: 'font.ttf.png', size: 10 })).toMatch(/not a font file/)
    expect(validateFontFile({ name: 'huge.ttf', size: 9 * 1024 * 1024 })).toMatch(/larger than 8 MB/)
  })

  it('the inspector offers brand colour swatches and the kit fonts, and the manager renders its empty state', () => {
    const { d, page, t } = (() => { const c = ctx(); let dd = doc(['cover'], c); const tx = makeText(dd.format, { name: 'Words' }, c); dd = addElement(dd, dd.pages[0].id, tx, c); return { d: dd, page: dd.pages[0], t: tx } })()
    const h = html(<Inspector doc={d} page={page} selected={t} selectedIds={[t.id]} swatches={[{ label: 'Primary', ref: { token: 'brand.primary', fallback: '#C2185B' }, hex: '#C2185B' }]} kitFonts={['Acme Sans']} dispatch={noop} />)
    expect(h).toContain('aria-label="Use brand colour Primary"')
    expect(h).not.toContain('<optgroup label="Brand Kit">')                                   // the Brand Kit font group needs a loaded kit (tokens)
    const none = html(<Inspector doc={d} page={page} selected={t} selectedIds={[t.id]} dispatch={noop} />)
    expect(none).not.toContain('data-testid="brand-swatches"')
    const mgr = html(<BrandKitManager store={{} as never} onClose={noop} />)
    expect(mgr).toContain('data-testid="brand-manager"'); expect(mgr).toContain('data-testid="new-kit"'); expect(mgr).toContain('Choose a Brand Kit to edit')
  })
})

describe('Animate panel', () => {
  const mk = (selectedIdx: number | null, pageIndex = 1) => {
    const c = ctx()
    const d = doc(['cover', 'title_body', 'cta'], c)
    const page = d.pages[pageIndex]
    const sel = selectedIdx === null ? undefined : page.elements[selectedIdx]
    return html(<AnimatePanel doc={d} page={page} pageIndex={pageIndex} selected={sel} dispatch={noop} videoSink={{} as never} />)
  }

  it('offers every transition and slide settings (duration, easing, direction, sequencing) and the animation controls for a selected element', () => {
    const h = mk(0)
    for (const t of ['None (cut)', 'Dissolve', 'Fade', 'Slide', 'Push', 'Wipe', 'Zoom', 'Flip']) expect(h).toContain(t)
    expect(h).toContain('data-testid="transition-kind"'); expect(h).toContain('data-testid="slide-duration"'); expect(h).toContain('data-testid="sequence-mode"')
    expect(h).toContain('data-testid="animate-all"'); expect(h).toContain('data-testid="clear-animations"')
    for (const ph of ['entrance', 'exit', 'emphasis']) expect(h).toContain(`data-testid="phase-${ph}"`)
    for (const k of ['Fade', 'Slide', 'Pop', 'Zoom', 'Bounce', 'Rotate', 'Typewriter', 'Pulse']) expect(h).toContain(`>${k}</option>`)
    expect(h).toContain('data-testid="motion-preview"'); expect(h).toContain('data-testid="preview-play"'); expect(h).toContain('data-testid="preview-scrub"')
  })

  it('an element with an animation shows its duration, delay, easing and direction; an exit says it leaves earlier', () => {
    const c = ctx()
    let d = doc(['cover', 'title_body', 'cta'], c)
    const page = d.pages[1]
    const el = page.elements[0]
    d = setElementAnimation(d, page.id, el.id, 'entrance', defaultAnimation('entrance', 'slide', 'a1'), c)
    d = setElementAnimation(d, page.id, el.id, 'exit', defaultAnimation('exit', 'fade', 'a2'), c)
    d = setElementAnimation(d, page.id, el.id, 'emphasis', defaultAnimation('emphasis', 'pulse', 'a3'), c)
    const h = html(<AnimatePanel doc={d} page={d.pages[1]} pageIndex={1} selected={d.pages[1].elements[0]} dispatch={noop} videoSink={{} as never} />)
    for (const t of ['entrance-duration', 'entrance-delay', 'exit-duration', 'exit-delay', 'emphasis-duration']) expect(h).toContain(`data-testid="${t}"`)
    expect(h).toContain('Leave earlier (s)'); expect(h).toContain('Comes from'); expect(h).toContain('Repeats'); expect(h).toContain('Overshoot')
    expect(h).not.toContain('data-testid="video-no-motion"')                                  // there is motion now
  })

  it('without a selection it asks for one; the first slide explains it has no transition', () => {
    expect(mk(null)).toContain('data-testid="no-motion-selection"')
    const first = mk(null, 0)
    expect(first).toContain('The first slide has nothing to arrive from')
    expect(first).toMatch(/disabled=""[^>]*data-testid="transition-kind"|data-testid="transition-kind"[^>]*disabled/)
  })

  it('the video export section reports length, size and frames, warns when nothing is animated, and says static exports are unaffected', () => {
    const h = mk(null)
    expect(h).toContain('data-testid="video-export"')
    expect(h).toContain('9.0 seconds'); expect(h).toContain('540 × 676 px'); expect(h).toContain('216 frames')
    expect(h).toContain('Static PNG, JPEG and PDF exports are not affected')
    expect(h).toContain('data-testid="video-no-motion"')
    expect(h).toContain('MP4 video'); expect(h).toContain('>GIF<'); expect(h).toContain('data-testid="export-video"')
  })
})

describe('Design panel and element controls', () => {
  const mkDoc = () => { const c = ctx(); let d = doc(['cover'], c); const page = d.pages[0].id; const t = makeText(d.format, { name: 'Words' }, c); const img = makeImage({ name: 'Code', source: { kind: 'qr', data: 'https://example.com' }, role: 'other' }, c); const sh = makeShape({ name: 'Star', shape: 'star-5' }, c); for (const e of [t, img, sh]) d = addElement(d, page, e, c); return { d, page: d.pages[0], t, img, sh } }

  it('the design panel offers colours, gradients, patterns, every shape, information elements and a personal library', () => {
    const { d, page } = mkDoc()
    const h = html(<DesignPanel doc={d} page={page} theme={themeById('forest')} selectedIds={[]} dispatch={noop} libraryStore={{ list: async () => [] } as never} />)
    expect(h.match(/aria-label="Gradient /g)).toHaveLength(12)
    expect(h.match(/aria-label="Pattern /g)!.length).toBeGreaterThanOrEqual(8)
    expect(h.match(/data-testid="add-shape-kind"/g)).toHaveLength(PLAIN_SHAPES.length + SHAPES.length)
    for (const k of ['Star', 'Speech bubble', 'Arrow right', 'Heart', 'Line with arrow', 'Hexagon']) expect(h).toContain(`aria-label="Add ${k}"`)
    for (const t of ['add-date', 'add-time', 'add-datetime', 'add-countdown', 'add-timer', 'add-location', 'add-address', 'add-map']) expect(h).toContain(`data-testid="${t}"`)
    expect(h).toMatch(/disabled=""[^>]*data-testid="add-qr-btn"|data-testid="add-qr-btn"[^>]*disabled/)           // needs a valid address first
    expect(h).toMatch(/disabled=""[^>]*data-testid="save-selection"|data-testid="save-selection"[^>]*disabled/)    // needs a name and a selection
    expect(h).toContain('Countdowns and timers tick only in an animated video')
  })

  it('a text element offers typography extras, dynamic values and a link with a clear note about where links work', () => {
    const { d, page, t } = mkDoc()
    const h = html(<Inspector doc={d} page={page} selected={t} selectedIds={[t.id]} dispatch={noop} />)
    for (const id of ['typography-extras', 'text-italic', 'text-spacing', 'text-outline', 'text-shadow', 'dynamic-controls', 'dynamic-kind', 'link-controls', 'link-to-map', 'opacity', 'rotation']) expect(h, id).toContain(`data-testid="${id}"`)
    expect(h).toContain('Links are clickable in a PDF export, and in an SVG export when it is opened in a web browser')
    expect(h).toContain('>900</option>')
  })

  it('a QR code edits its destination; a shape has a grouped shape list, outline and text inside; a picture has crop, flip and adjustments', () => {
    const { d, page, img, sh } = mkDoc()
    const qr = html(<Inspector doc={d} page={page} selected={img} selectedIds={[img.id]} dispatch={noop} />)
    expect(qr).toContain('data-testid="qr-controls"'); expect(qr).toContain('Where the QR code goes'); expect(qr).toContain('value="https://example.com"')
    const shape = html(<Inspector doc={d} page={page} selected={sh} selectedIds={[sh.id]} dispatch={noop} />)
    expect(shape).toContain('data-testid="shape-kind"'); expect(shape).toContain('<optgroup label="Stars">'); expect(shape).toContain('data-testid="shape-text"'); expect(shape).toContain('data-testid="shape-outline"')
    const pic = html(<Inspector doc={d} page={page} selected={{ ...img, source: { kind: 'asset', assetId: 1, url: '/uploads/1/a.png' } }} selectedIds={[img.id]} dispatch={noop} />)
    for (const id of ['image-extras', 'flip-x', 'flip-y', 'trim-top', 'trim-left', 'adjust-brightness', 'adjust-blur', 'adjust-reset']) expect(pic, id).toContain(`data-testid="${id}"`)
  })
})
