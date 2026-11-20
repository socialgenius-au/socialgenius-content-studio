import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PostDocument } from '../postDocument'
import { assertValidPostDocument } from '../postDocument'
import { createCarouselDocument } from './document'
import { addElement, makeImage, setSlideBackground, type OpContext } from './ops'
import { buildPdf } from './pdf'
import { addPicturesAsSlides, extractPdfPictures, importKindOf, inspectSvg, svgRasterSize, validateImportFile } from './importers'
import { buildProjectFile, collectMediaUrls, parseProjectFile, prepareImportedProject, projectFileName, remapMedia, ProjectFileError, MAX_EMBEDDED_BYTES } from './projectFile'
import { newTrack } from './audio'

vi.mock('../../api/client', () => ({
  assetsApi: { list: async () => ({ data: [] }), previewUrl: (p: string) => p },
  uploadApi: { upload: async () => ({ data: {} }) },
}))
import ProjectPanel from '../../pages/carousel-creator/components/ProjectPanel'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-21T09:00:00Z') } }
const jpegBytes = (n: number, fill = 7) => { const b = new Uint8Array(n); b.fill(fill); b[0] = 0xff; b[1] = 0xd8; b[n - 2] = 0xff; b[n - 1] = 0xd9; return b }

function mediaDoc(): PostDocument {
  let d = createCarouselDocument({ title: 'My Post', layouts: ['statement', 'statement'] }, ids())
  const p0 = d.pages[0].id
  d = setSlideBackground(d, p0, { kind: 'image', source: { kind: 'asset', assetId: 1, url: '/uploads/9/bg.jpg' }, fit: 'cover' }, ids())
  d = addElement(d, p0, makeImage({ id: 'hero', source: { kind: 'asset', assetId: 2, url: '/uploads/9/hero.png' } }, ids()), ids())
  const group = { ...makeImage({ id: 'g' }, ids()), type: 'group', children: [makeImage({ id: 'inner', source: { kind: 'asset', assetId: 3, url: '/uploads/9/inner.png' } }, ids())] } as never
  d = addElement(d, d.pages[1].id, group, ids())
  return { ...d, audio: newTrack({ assetId: 4, url: '/uploads/9/song.mp3', name: 'song.mp3' }, 20000) }
}

describe('what can be imported', () => {
  it('sorts files by type and refuses the wrong ones with a reason', () => {
    expect(importKindOf({ name: 'a.PNG' })).toBe('image'); expect(importKindOf({ name: 'a.svg' })).toBe('svg'); expect(importKindOf({ name: 'a.pdf' })).toBe('pdf')
    expect(importKindOf({ name: 'x.sgcarousel.json' })).toBe('project'); expect(importKindOf({ name: 'a.mp3' })).toBe('audio'); expect(importKindOf({ name: 'a.exe' })).toBe('unsupported')
    expect(validateImportFile({ name: 'a.png', size: 1000 }).error).toBeNull()
    expect(validateImportFile({ name: 'a.exe', size: 10 }).error).toMatch(/not a type the editor can import/)
    expect(validateImportFile({ name: 'a.mp3', size: 10 }).error).toMatch(/Animate tab/)
    expect(validateImportFile({ name: 'a.png', size: 0 }).error).toMatch(/empty/)
    expect(validateImportFile({ name: 'a.png', size: 16 * 1024 * 1024 }).error).toMatch(/larger than 15 MB/)
    expect(validateImportFile({ name: 'a.svg', size: 6 * 1024 * 1024 }).error).toMatch(/larger than 5 MB/)
    expect(validateImportFile({ name: 'a.pdf', size: 51 * 1024 * 1024 }).error).toMatch(/larger than 50 MB/)
  })
})

describe('SVG import', () => {
  it('reads the size (px, other units, viewBox only), and says it is flattened', () => {
    expect(inspectSvg('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"></svg>')).toMatchObject({ width: 200, height: 100 })
    expect(inspectSvg('<svg width="1in" height="2in"/>')).toMatchObject({ width: 96, height: 192 })
    expect(inspectSvg('<svg viewBox="0 0 50 25"/>')).toMatchObject({ width: 50, height: 25 })
    expect(inspectSvg('<svg viewBox="0 0 50 25" width="100"/>')).toMatchObject({ width: 100, height: 50 })
    expect(inspectSvg('<svg/>')).toMatchObject({ width: 1080, height: 1080 })
    expect(inspectSvg('<svg width="10" height="10"/>').warnings[0]).toMatch(/flattened/)
    expect(() => inspectSvg('<html>not an svg</html>')).toThrow(/does not look like an SVG/)
  })
  it('warns about scripts, embedded web content, remote pictures and text fonts', () => {
    const w = inspectSvg('<svg width="10" height="10" onload="x()"><script>1</script><foreignObject/><image href="https://e.com/a.png"/><text>Hi</text></svg>').warnings.join(' ')
    expect(w).toMatch(/Scripts inside the SVG were ignored/); expect(w).toMatch(/foreignObject/); expect(w).toMatch(/internet/); expect(w).toMatch(/fonts available in this browser/)
  })
  it('converts at a sensible size: big ones are capped, tiny ones are enlarged', () => {
    expect(svgRasterSize({ width: 10000, height: 5000 })).toEqual({ width: 2400, height: 1200 })
    expect(svgRasterSize({ width: 24, height: 24 })).toEqual({ width: 600, height: 600 }); expect(svgRasterSize({ width: 1000, height: 500 })).toEqual({ width: 1000, height: 500 })
  })
})

describe('PDF import', () => {
  const stamp = () => new Date('2026-11-21T00:00:00Z')
  it('gets the pictures back out of a PDF made by this editor, in order and byte for byte, even if the data looks like PDF syntax', () => {
    const a = jpegBytes(300, 1)
    const tricky = jpegBytes(400, 2)
    tricky.set(new TextEncoder().encode('endstream endobj 9 0 obj << /Type /Page >> stream'), 40)          // bytes that imitate PDF keywords inside a picture
    const pdf = buildPdf([{ jpeg: a, width: 1080, height: 1350 }, { jpeg: tricky, width: 800, height: 600 }], { now: stamp })
    const r = extractPdfPictures(pdf)
    expect(r.pictures).toHaveLength(2)
    expect(Array.from(r.pictures[0].jpeg)).toEqual(Array.from(a)); expect(Array.from(r.pictures[1].jpeg)).toEqual(Array.from(tricky))
    expect(r.pictures[1]).toMatchObject({ width: 800, height: 600 })
    expect(r.warnings[0]).toMatch(/imported as pictures \(flattened\)/)
  })
  it('refuses what it cannot read, honestly: not a PDF, no pictures, password protected', () => {
    expect(() => extractPdfPictures(new TextEncoder().encode('hello'))).toThrow(/does not look like a PDF/)
    expect(() => extractPdfPictures(new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'))).toThrow(/No importable pictures/)
    expect(() => extractPdfPictures(new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Encrypt 5 0 R >>\n%%EOF'))).toThrow(/password protected/)
  })
  it('reports pages that had no picture, and pictures that are not JPEG', () => {
    const base = new TextDecoder('latin1').decode(buildPdf([{ jpeg: jpegBytes(100), width: 10, height: 10 }, { jpeg: jpegBytes(100), width: 10, height: 10 }], { now: stamp }))
    const extra = base.replace('/Type /Page /Parent 2 0 R', '/Type /Page /Parent 2 0 R /Rotate 0').replace('/Filter /DCTDecode', '/Filter /FlateDecode')   // the first picture is no longer a JPEG
    const bytes = Uint8Array.from(extra, c => c.charCodeAt(0))
    const r = extractPdfPictures(bytes)
    expect(r.pictures).toHaveLength(1); expect(r.warnings.join(' ')).toMatch(/1 other image/); expect(r.warnings.join(' ')).toMatch(/2 pages but 1 importable picture/)
  })
  it('turns each picture into a slide holding an editable, contained picture layer', () => {
    const c = ids()
    const d = createCarouselDocument({ title: 'T', layouts: ['statement'] }, c)
    const r = addPicturesAsSlides(d, [{ assetId: 5, url: '/uploads/1/a.jpg', name: 'Deck page 1' }, { assetId: 6, url: '/uploads/1/b.jpg', name: 'Deck page 2' }], c)
    assertValidPostDocument(r.doc)
    expect(r.doc.pages).toHaveLength(3); expect(r.slideIds).toEqual([r.doc.pages[1].id, r.doc.pages[2].id])
    const el = r.doc.pages[1].elements[0]
    expect(el).toMatchObject({ type: 'image', fit: 'contain', x: 0, y: 0, width: 1, height: 1, source: { kind: 'asset', assetId: 5 } })
  })
})

describe('project files', () => {
  const fetchMedia = async (url: string) => ({ name: url.split('/').pop()!, mime: url.endsWith('.mp3') ? 'audio/mpeg' : 'image/png', dataUrl: `data:${url.endsWith('.mp3') ? 'audio/mpeg' : 'image/png'};base64,QUJD`, bytes: 3 })
  const upload = async (name: string) => ({ assetId: 100 + name.length, url: `/uploads/77/${name}` })

  it('finds every picture and the music, including inside groups and backgrounds', () => {
    expect(collectMediaUrls(mediaDoc()).sort()).toEqual(['/uploads/9/bg.jpg', '/uploads/9/hero.png', '/uploads/9/inner.png', '/uploads/9/song.mp3'])
  })
  it('round-trips: a file made with media opens in another account with every layer re-pointed at the new uploads and still valid', async () => {
    const d = mediaDoc()
    const built = await buildProjectFile(d, 'forest', { includeMedia: true, fetchMedia, now: () => new Date('2026-11-21T00:00:00Z') })
    expect(built.embedded).toBe(4); expect(projectFileName(d)).toBe('my-post.sgcarousel.json')
    const parsed = parseProjectFile(built.text)
    const prepared = await prepareImportedProject(parsed, upload)
    assertValidPostDocument(prepared.doc)
    expect(prepared.warnings).toEqual([])
    expect(collectMediaUrls(prepared.doc).sort()).toEqual(['/uploads/77/bg.jpg', '/uploads/77/hero.png', '/uploads/77/inner.png', '/uploads/77/song.mp3'])
    expect(prepared.doc.audio).toMatchObject({ assetId: 100 + 'song.mp3'.length, volume: 1 })
    expect(prepared.doc.pages.map(p => p.elements.length)).toEqual(d.pages.map(p => p.elements.length))   // every layer survived
    expect(prepared.themeId).toBe('forest')
  })
  it('without media the pictures become empty slots, the music is removed, the background falls back to a solid colour, and the person is told', async () => {
    const built = await buildProjectFile(mediaDoc(), 'forest', { includeMedia: false, fetchMedia })
    expect(built.embedded).toBe(0); expect(built.warnings.join(' ')).toMatch(/not inside this project file/)
    const prepared = await prepareImportedProject(parseProjectFile(built.text), upload)
    assertValidPostDocument(prepared.doc)
    expect(collectMediaUrls(prepared.doc)).toEqual([])
    expect(prepared.doc.pages[0].background.kind).toBe('solid'); expect(prepared.doc.audio).toBeUndefined()
    expect(prepared.warnings.join(' ')).toMatch(/3 pictures could not be brought over/); expect(prepared.warnings.join(' ')).toMatch(/music was not included/)
  })
  it('leaves out media that cannot be read or would make the file too big, and says which', async () => {
    const big = async (url: string) => ({ ...(await fetchMedia(url)), bytes: MAX_EMBEDDED_BYTES - 1 })
    const r = await buildProjectFile(mediaDoc(), 'forest', { includeMedia: true, fetchMedia: big })
    expect(r.embedded).toBe(1); expect(r.warnings.filter(w => /too large/.test(w))).toHaveLength(3)
    const none = await buildProjectFile(mediaDoc(), 'forest', { includeMedia: true, fetchMedia: async () => null })
    expect(none.embedded).toBe(0); expect(none.warnings.filter(w => /could not be read/.test(w))).toHaveLength(4)
  })
  it('drops the Brand Kit link (kits belong to an account) and keeps the colours', async () => {
    const d = { ...mediaDoc(), context: { ...mediaDoc().context, brand: { brandKitId: '12' } } } as PostDocument
    const built = await buildProjectFile(d, 'forest', { includeMedia: false, fetchMedia })
    expect(built.warnings.join(' ')).toMatch(/Brand Kit itself is not inside the file/)
    const prepared = await prepareImportedProject(parseProjectFile(built.text), upload)
    expect(prepared.doc.context.brand?.brandKitId).toBeUndefined(); expect(prepared.warnings.join(' ')).toMatch(/Brand Kit link was removed/)
  })
  it('rejects files that are not project files, are damaged, or come from a newer editor, with plain messages', () => {
    expect(() => parseProjectFile('nope')).toThrow(/not valid JSON/)
    expect(() => parseProjectFile('{"format":"other"}')).toThrow(ProjectFileError)
    expect(() => parseProjectFile(JSON.stringify({ format: 'socialgenius-carousel', version: 99, document: {} }))).toThrow(/newer version/)
    expect(() => parseProjectFile(JSON.stringify({ format: 'socialgenius-carousel', version: 1, document: { pages: 3 } }))).toThrow(/damaged or incompatible/)
  })
  it('only accepts embedded media that is an image or audio data address', () => {
    const d = mediaDoc()
    const text = JSON.stringify({ format: 'socialgenius-carousel', version: 1, title: 'x', themeId: 'forest', document: d, assets: { '/a.png': { name: 'a.png', mime: 'image/png', dataUrl: 'data:image/png;base64,QUJD' }, '/b': { name: 'b', mime: 'text/html', dataUrl: 'data:text/html;base64,PGI+' }, '/c': { name: 'c', mime: 'x', dataUrl: 'javascript:alert(1)' } } })
    expect(Object.keys(parseProjectFile(text).assets)).toEqual(['/a.png'])
  })
  it('remapMedia leaves a document without media untouched', () => {
    const d = createCarouselDocument({ title: 'T', layouts: ['statement'] }, ids())
    const r = remapMedia(d, () => null)
    expect(r.missingPictures).toBe(0); expect(r.musicRemoved).toBe(false); expect(r.doc.pages).toEqual(d.pages)
  })
})

describe('file panel', () => {
  it('offers save, save as, save as template, project download and open, and imports, and explains what flattening means', () => {
    const d = mediaDoc()
    const h = renderToStaticMarkup(<ProjectPanel doc={d} themeId="forest" dispatch={() => undefined} onSaveNow={async () => true} onCreateFrom={async () => null} onGoTemplates={() => undefined} />)
    for (const id of ['project-panel', 'project-save', 'project-copy-title', 'project-save-as', 'project-save-template', 'project-include-media', 'project-download', 'project-open', 'project-open-input', 'import-pictures', 'import-pictures-input', 'import-pdf', 'import-pdf-input']) expect(h, id).toContain(`data-testid="${id}"`)
    expect(h).toContain('placeholder="My Post copy"'); expect(h).toContain('flattened'); expect(h).toContain('Music is added in the Animate tab')
    expect(h).toContain('multiple=""'); expect(h).toContain('image/svg+xml')
  })
})
