import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { assertValidPostDocument, type PostDocument } from '../../lib/postDocument'
import type { OpContext } from '../../lib/carousel/ops'
import { addElement, makeImage, makeText } from '../../lib/carousel/ops'
import type { CarouselServer } from '../../lib/carousel/serverStore'
import type { BrandKitStore } from '../../lib/carousel/assetsStore'
import type { LibraryStore } from '../../lib/carousel/libraryStore'
import type { RasterBackend } from '../../lib/carousel/exporter'
import { PostFormatProvider } from './format/PostFormatContext'
import { PostSessionProvider } from './session'
import BriefTab from './tabs/BriefTab'
import IntelligenceTab from './tabs/IntelligenceTab'
import ReferencesTab from './tabs/ReferencesTab'
import CreateTab from './tabs/CreateTab'
import ReviewTab from './tabs/ReviewTab'
import PostCreatorV2 from './PostCreatorV2'
import { exportForPlatforms, platformExports, targetFormatFor } from './postExport'
import { checkSummary, createPostDocument, emptyBrief, emptyInsights, reviewChecks, withWorkflow, workflowOf, type PostBrief } from './workflow'

vi.mock('../../api/client', () => ({
  assetsApi: { list: async () => ({ data: [] }), previewUrl: (p: string) => p },
  uploadApi: { upload: async () => ({ data: {} }) },
  carouselsApi: {}, brandKitsApi: {}, libraryItemsApi: {}, referenceVideosApi: { list: async () => ({ data: [] }) }, deconstructorApi: { blueprint: async () => ({ data: {} }) },
}))

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-21T09:00:00Z') } }
const FEED = { platformKey: 'instagram', formatKey: 'feed_portrait', width: 1080, height: 1350, ratio: '4:5' }
const brief = (over: Partial<PostBrief> = {}): PostBrief => ({ ...emptyBrief(), title: 'Autumn sale', audience: 'Home renovators', product: 'Porcelain tiles 20% off', keyMessage: 'Tiles that last', cta: 'Get a quote', ...over })
const texts = (d: PostDocument) => d.pages[0].elements.flatMap(e => (e.type === 'text' ? [e.content] : []))
const MOCK_STRINGS = ['ABC Tiles', 'ABC Motors', 'Metro Grey', 'Western Sydney', 'Riverstone', 'Coastal Oak', 'Send Your Tile Schedule', 'Builders', 'Variation 1', 'Generate (3 Variations)', 'Excellent']

const session = (doc: PostDocument, node: ReactNode) => renderToStaticMarkup(
  <PostFormatProvider>
    <PostSessionProvider opened={{ id: doc.id, doc, themeId: 'forest', version: 1, nonce: 1 }} server={{} as CarouselServer} buffer={null} brandStore={{ list: async () => [], get: async () => { throw new Error('none') } } as unknown as BrandKitStore} libraryStore={{} as LibraryStore} onReload={() => undefined}>
      {node}
    </PostSessionProvider>
  </PostFormatProvider>,
)

describe('a post is created from the brief and is a real, valid, editable document', () => {
  it('builds a one-page document in the chosen format with the brief on it as editable text', () => {
    const d = createPostDocument(brief(), FEED, ids())
    assertValidPostDocument(d)
    expect(d.pages).toHaveLength(1)
    expect(d.format).toMatchObject({ platformKey: 'instagram', formatKey: 'feed_portrait', width: 1080, height: 1350 })
    expect(d.title).toBe('Autumn sale')
    expect(texts(d)).toEqual(expect.arrayContaining(['Tiles that last', 'Porcelain tiles 20% off', 'Get a quote']))
    expect(d.context.message).toMatchObject({ keyMessage: 'Tiles that last', audience: 'Home renovators', cta: 'Get a quote', objective: 'Generate enquiries' })
  })
  it('a blank brief gives honest, editable starter wording (no invented claims) and a usable title', () => {
    const d = createPostDocument(emptyBrief(), FEED, ids())
    assertValidPostDocument(d)
    expect(d.title).toBe('Untitled post'); expect(texts(d)).toContain('Add a short supporting line'); expect(texts(d)).toContain('Learn more')
  })
  it('a custom size keeps the exact pixels', () => {
    const d = createPostDocument(brief(), { platformKey: 'website', formatKey: 'custom', width: 1600, height: 900, ratio: '16:9' }, ids())
    assertValidPostDocument(d)
    expect(d.format).toMatchObject({ formatKey: 'custom', width: 1600, height: 900 })
  })
  it('the workflow round-trips through the document and survives malformed saved data', () => {
    let d = createPostDocument(brief({ brandKitId: 7 }), FEED, ids())
    d = withWorkflow(d, { ...workflowOf(d), insights: { ...emptyInsights(), painPoints: 'slow quotes' }, references: [{ id: 'ref_5', assetId: 5, url: '/uploads/1/a.png', name: 'a.png', note: 'mood' }] })
    const w = workflowOf(JSON.parse(JSON.stringify(d)))
    expect(w.brief.brandKitId).toBe(7); expect(w.insights.painPoints).toBe('slow quotes'); expect(w.references).toEqual([{ id: 'ref_5', assetId: 5, url: '/uploads/1/a.png', name: 'a.png', note: 'mood' }])
    expect(d.revision).toBeGreaterThan(0)
    const broken = { ...d, context: { workflow: { brief: 5, insights: null, references: [{ assetId: 'x' }, { assetId: 9, url: '/u/b.png' }, 7] } } } as unknown as PostDocument
    const b = workflowOf(broken)
    expect(b.brief.goal).toBe('Generate enquiries'); expect(b.insights).toEqual(emptyInsights()); expect(b.references.map(r => r.assetId)).toEqual([9])
    expect(workflowOf({ ...d, context: {} } as PostDocument).references).toEqual([])
  })
})

describe('the review checks are facts about the post, not scores', () => {
  const find = (cs: ReturnType<typeof reviewChecks>, id: string) => cs.find(c => c.id === id)!
  it('a post that matches its brief passes the content checks', () => {
    const cs = reviewChecks(createPostDocument(brief(), FEED, ids()))
    for (const id of ['text', 'message', 'cta', 'size', 'images', 'placeholder']) expect(find(cs, id).status, id).toBe('pass')
    expect(JSON.stringify(cs)).not.toMatch(/score|excellent|\/100/i)
  })
  it('says so when the key message or call to action is not on the post', () => {
    let d = createPostDocument(brief(), FEED, ids())
    d = { ...d, pages: [{ ...d.pages[0], elements: d.pages[0].elements.map(e => (e.type === 'text' ? { ...e, content: 'Something else' } : e)) }] }
    const cs = reviewChecks(d)
    expect(find(cs, 'message').status).toBe('warn'); expect(find(cs, 'cta').status).toBe('warn')
    expect(checkSummary(cs).warnings).toBeGreaterThanOrEqual(2)
  })
  it('flags tiny text, empty picture slots, placeholder text, no text at all', () => {
    const c = ids()
    let d = createPostDocument(brief(), FEED, c)
    d = addElement(d, d.pages[0].id, makeText(d.format, { content: 'fine print', style: { ...makeText(d.format).style, fontSize: 0.012 } }, c), c)
    d = addElement(d, d.pages[0].id, makeImage({}, c), c)                                    // an empty picture slot
    d = addElement(d, d.pages[0].id, makeText(d.format, { content: 'PLACEHOLDER copy' }, c), c)
    const cs = reviewChecks(d)
    expect(find(cs, 'size').status).toBe('warn'); expect(find(cs, 'images').status).toBe('warn'); expect(find(cs, 'placeholder').status).toBe('warn')
    const none = reviewChecks({ ...d, pages: [{ ...d.pages[0], elements: [] }] })
    expect(find(none, 'text').status).toBe('warn')
  })
  it('a Brand Kit is noted as applied; without one it is information, not a warning', () => {
    const d = createPostDocument(brief(), FEED, ids())
    expect(find(reviewChecks(d), 'brand').status).toBe('info')
    expect(find(reviewChecks({ ...d, context: { ...d.context, brand: { brandKitId: '3' } } }), 'brand').status).toBe('pass')
  })
})

describe('export for other platforms', () => {
  it('picks a sensible fixed size per platform, never the primary, and skips unknown platforms', () => {
    const d = createPostDocument(brief(), FEED, ids())
    const t = platformExports(d, ['instagram', 'facebook', 'linkedin', 'nonsense'])
    expect(t.map(x => x.platformKey)).toEqual(['facebook', 'linkedin'])
    for (const x of t) expect(x.format.width).toBeGreaterThan(0)
    expect(targetFormatFor('facebook', 'feed_portrait')?.formatKey).toBeTruthy()
  })
  it('makes one ZIP holding the post as designed plus one PNG per selected platform', async () => {
    const d = createPostDocument(brief(), FEED, ids())
    const backend: RasterBackend = { createSurface: () => ({ ctx: new Proxy({ globalAlpha: 1, font: '10px sans-serif' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : k === 'measureText' ? (x: string) => ({ width: x.length * 4 }) : () => ({ addColorStop: () => undefined })), set: (t, k: string, v) => { t[k] = v; return true } }) as never, toBytes: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }), loadImage: async () => null }
    const f = await exportForPlatforms(d, ['facebook', 'linkedin'], backend, { scale: 0.05 })
    expect(f).toMatchObject({ name: 'autumn-sale-platforms.zip', mime: 'application/zip' })
    const text = new TextDecoder('latin1').decode(f.bytes)
    for (const n of ['autumn-sale-instagram-feed_portrait.png', 'autumn-sale-facebook-', 'autumn-sale-linkedin-']) expect(text).toContain(n)
  })
})

describe('every stage shows real content and no mock data', () => {
  const doc = createPostDocument(brief(), FEED, ids())
  const stage = (n: ReactNode) => session(doc, n)
  const noop = () => undefined
  const props = { draftBrief: emptyBrief(), onDraftBrief: noop, kits: [], onStart: noop, starting: false, startError: null, drafts: [], draftsError: null, onOpenDraft: noop, openingId: null, onNext: noop }

  it('Brief (before a post exists) starts a post and lists drafts honestly; it has no mock client or product', () => {
    const html = renderToStaticMarkup(<PostFormatProvider><BriefTab {...props} /></PostFormatProvider>)
    expect(html).toContain('data-testid="pcv2-start"'); expect(html).toContain('data-testid="pcv2-no-drafts"'); expect(html).toContain('data-testid="pcv2-brief-message"')
    for (const m of MOCK_STRINGS) expect(html, m).not.toContain(m)
  })
  it('Brief (post open) shows the saved brief in editable fields', () => {
    const html = stage(<BriefTab {...props} />)
    expect(html).toContain('value="Autumn sale"'); expect(html).toContain('Tiles that last'); expect(html).toContain('data-testid="pcv2-next"'); expect(html).not.toContain('data-testid="pcv2-start"')
  })
  it('Intelligence is the user\'s own notes and says plainly that nothing is AI-generated', () => {
    const html = stage(<IntelligenceTab onNext={noop} onBack={noop} />)
    expect(html).toContain('data-testid="pcv2-intelligence-honesty"'); expect(html).toMatch(/nothing here is generated by AI/)
    for (const k of ['audience', 'painPoints', 'angles', 'proof', 'notes']) expect(html).toContain(`data-testid="pcv2-insight-${k}"`)
    for (const m of MOCK_STRINGS) expect(html, m).not.toContain(m)
  })
  it('References offers the real picture picker (upload / library) and an empty state', () => {
    const html = stage(<ReferencesTab onNext={noop} onBack={noop} onGoCreate={noop} />)
    expect(html).toContain('data-testid="image-picker"'); expect(html).toContain('data-testid="pcv2-no-references"'); expect(html).toContain('data-testid="pcv2-references-honesty"')
    for (const m of ['Popular Posts', 'Competitors', 'Eye', 'Deconstruct</button>', 'Adapt for Client']) expect(html, m).not.toContain(m)
  })
  it('Create is the real editor on the post: canvas, panels, layers, undo/redo, save state, and no AI or mock tools', () => {
    const html = stage(<CreateTab onNext={noop} onBack={noop} />)
    for (const id of ['pcv2-workspace', 'stage-canvas', 'pcv2-tab-edit', 'pcv2-tab-design', 'pcv2-tab-format', 'pcv2-tab-layers', 'pcv2-tab-brand', 'pcv2-undo', 'pcv2-redo', 'save-status', 'pcv2-create-honesty']) expect(html, id).toContain(`data-testid="${id}"`)
    expect(html).toContain('Tiles that last')                                        // the brief is drawn on the canvas
    for (const m of ['Generate (3 Variations)', 'AI Generated Variations', 'AI Select', 'Regenerate', 'populated once this workspace is wired', 'Modern bathroom']) expect(html, m).not.toContain(m)
  })
  it('Review has real checks, a real save and export, and no score, AI recommendations or fake publish buttons', () => {
    const html = stage(<ReviewTab onBack={noop} onGoCreate={noop} />)
    for (const id of ['pcv2-review-preview', 'pcv2-checks', 'pcv2-check-summary', 'pcv2-save-draft', 'pcv2-export-card', 'export-panel', 'pcv2-platforms-card', 'pcv2-export-platforms', 'pcv2-publishing-note']) expect(html, id).toContain(`data-testid="${id}"`)
    expect(html).toContain('There is no quality score')
    for (const m of ['Post Quality Score', 'AI Recommendations', 'Send to Publishing', 'Send for Approval', 'Approve &amp; Export', 'Scorecard', '/100']) expect(html, m).not.toContain(m)
    expect(html).toMatch(/data-testid="pcv2-publish-instagram"[^>]*aria-pressed="true"[^>]*disabled=""|disabled=""[^>]*data-testid="pcv2-publish-instagram"/)   // the post's own platform is shown selected and locked
  })
  it('the shell locks stages 2 to 5 until a post is started', () => {
    const html = renderToStaticMarkup(<PostCreatorV2 storage={null} />)
    for (const s of ['intelligence', 'references', 'create', 'review']) expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*data-testid="pcv2-step-${s}"|<button[^>]*data-testid="pcv2-step-${s}"[^>]*disabled=""`))
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="pcv2-step-brief"/)
  })
})
