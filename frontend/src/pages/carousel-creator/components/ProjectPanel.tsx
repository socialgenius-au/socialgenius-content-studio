import { useRef, useState, type Dispatch } from 'react'
import { AlertTriangle, FileDown, FilePlus2, FileUp, FolderOpen, Loader2, Save, Shapes } from 'lucide-react'
import { assetsApi, uploadApi } from '../../../api/client'
import { withMediaToken } from '../../../api/mediaAccess'
import type { Asset } from '../../../types'
import type { PostDocument } from '../../../lib/postDocument'
import { downloadBytes } from '../../../lib/carousel/browserBackend'
import { svgFileToPng } from '../../../lib/carousel/importersBrowser'
import { addPicturesAsSlides, extractPdfPictures, importKindOf, validateImportFile, type UploadedPicture } from '../../../lib/carousel/importers'
import { buildProjectFile, parseProjectFile, prepareImportedProject, projectFileName, MAX_PROJECT_BYTES, type FetchedMedia, type MediaTarget } from '../../../lib/carousel/projectFile'
import type { EditorAction } from '../editorState'
import { storedUrlFor } from './ImagePicker'

export type UploadFn = (file: File) => Promise<UploadedPicture>
export type FetchMediaFn = (url: string) => Promise<FetchedMedia | null>

const defaultUpload: UploadFn = async file => { const a = (await uploadApi.upload(file)).data as Asset; return { assetId: a.id, url: storedUrlFor(a), name: a.original_filename } }
const defaultFetch: FetchMediaFn = async url => {
  const res = await fetch(withMediaToken(url), { credentials: 'omit' })
  if (!res.ok) return null
  const blob = await res.blob()
  const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob) })
  return { name: decodeURIComponent(url.split('?')[0].split('/').pop() ?? 'media'), mime: blob.type || 'application/octet-stream', dataUrl, bytes: blob.size }
}
void assetsApi

const btn = 'inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
const heading = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground'

export interface ProjectPanelProps {
  doc: PostDocument
  themeId: string
  dispatch: Dispatch<EditorAction>
  /** Sends every change to the account now. Resolves true when nothing is left unsaved. */
  onSaveNow: () => Promise<boolean>
  /** Opens a new carousel made from this document (Save As, opening a project file). Notices are shown once it is open. */
  onCreateFrom: (doc: PostDocument, themeId: string, notices: string[]) => Promise<string | null>
  onGoTemplates: () => void
  upload?: UploadFn
  fetchMedia?: FetchMediaFn
}

/** Save, Save As, Save as Template, project files (download and open), and importing pictures, SVG files and PDFs. */
export default function ProjectPanel({ doc, themeId, dispatch, onSaveNow, onCreateFrom, onGoTemplates, upload = defaultUpload, fetchMedia = defaultFetch }: ProjectPanelProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [copyTitle, setCopyTitle] = useState('')
  const [includeMedia, setIncludeMedia] = useState(true)
  const pics = useRef<HTMLInputElement>(null)
  const pdf = useRef<HTMLInputElement>(null)
  const proj = useRef<HTMLInputElement>(null)

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label); setMessage(null); setNotes([])
    try { const m = await fn(); if (m) setMessage({ tone: 'ok', text: m }) }
    catch (e) { setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'That did not work. Please try again.' }) }
    finally { setBusy(null) }
  }
  const reset = (r: React.RefObject<HTMLInputElement>) => { if (r.current) r.current.value = '' }

  const saveNow = () => run('save', async () => ((await onSaveNow()) ? 'Saved to your account.' : 'Could not save yet. Your changes are kept in this browser and the editor keeps retrying.'))
  const saveAs = () => run('saveas', async () => {
    const title = (copyTitle.trim() || `${doc.title} copy`).slice(0, 120)
    const err = await onCreateFrom({ ...doc, title }, themeId, [`This is a new carousel, "${title}". The original is unchanged.`])
    if (err) throw new Error(err)
  })
  const download = () => run('download', async () => {
    const r = await buildProjectFile(doc, themeId, { includeMedia, fetchMedia })
    downloadBytes(projectFileName(doc), 'application/json', new TextEncoder().encode(r.text))
    setNotes(r.warnings)
    return `Downloaded ${projectFileName(doc)}${r.embedded ? ` with ${r.embedded} picture or music file${r.embedded === 1 ? '' : 's'} inside` : ''}.`
  })
  const openProject = (file: File | undefined) => {
    if (!file) return
    void run('open', async () => {
      const v = validateImportFile(file)
      if (v.kind !== 'project') throw new Error(`"${file.name}" is not a project file. Project files end in ${'.sgcarousel.json'}.`)
      if (v.error) throw new Error(v.error)
      if (file.size > MAX_PROJECT_BYTES) throw new Error('That file is too large.')
      const parsed = parseProjectFile(await file.text())
      const prepared = await prepareImportedProject(parsed, async (name, mime, bytes): Promise<MediaTarget> => { const u = await upload(new File([bytes as BlobPart], name, { type: mime })); return { assetId: u.assetId, url: u.url } })
      const err = await onCreateFrom(prepared.doc, prepared.themeId, [`Opened "${prepared.doc.title}" from a project file as a new carousel. Every layer is still editable.`, ...prepared.warnings])
      if (err) throw new Error(err)
    }).finally(() => reset(proj))
  }
  const importPictures = (files: FileList | undefined) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return
    void run('pictures', async () => {
      const added: UploadedPicture[] = []
      const warn: string[] = []
      for (const f of list) {
        const v = validateImportFile(f)
        if (v.error) throw new Error(v.error)
        if (v.kind !== 'image' && v.kind !== 'svg') throw new Error(`"${f.name}" is not a picture or SVG. Use the PDF or project file buttons for those.`)
        let file = f
        if (v.kind === 'svg') { const c = await svgFileToPng(f); file = c.file; warn.push(...c.warnings) }
        added.push(await upload(file))
      }
      dispatch({ type: 'addImages', items: added.map(a => ({ assetId: a.assetId, url: a.url, name: a.name })) })
      setNotes([...new Set(warn)])
      return `Added ${added.length} picture${added.length === 1 ? '' : 's'} to this slide. Each is its own layer.`
    }).finally(() => reset(pics))
  }
  const importPdf = (file: File | undefined) => {
    if (!file) return
    void run('pdf', async () => {
      const v = validateImportFile(file)
      if (v.error) throw new Error(v.error)
      if (v.kind !== 'pdf') throw new Error(`"${file.name}" is not a PDF.`)
      const r = extractPdfPictures(new Uint8Array(await file.arrayBuffer()))
      const base = file.name.replace(/\.pdf$/i, '').slice(0, 30) || 'Page'
      const ups: UploadedPicture[] = []
      for (const [i, p] of r.pictures.entries()) { const u = await upload(new File([p.jpeg as BlobPart], `${base}-page-${i + 1}.jpg`, { type: 'image/jpeg' })); ups.push({ ...u, name: `${base} page ${i + 1}` }) }
      const out = addPicturesAsSlides(doc, ups)
      dispatch({ type: 'commitDoc', doc: out.doc, activeSlideId: out.slideIds[0] })
      setNotes(r.warnings)
      return `Added ${ups.length} slide${ups.length === 1 ? '' : 's'} from the PDF.`
    }).finally(() => reset(pdf))
  }

  return (
    <section aria-label="File" className="space-y-4" data-testid="project-panel">
      <div className="space-y-2">
        <h3 className={heading}>Save</h3>
        <p className="text-xs text-muted-foreground">Changes are saved to your account automatically. Use these when you want to be sure, or to keep a copy.</p>
        <button type="button" className={btn} disabled={!!busy} onClick={() => void saveNow()} data-testid="project-save">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save project now</button>
        <div className="flex gap-1.5">
          <input type="text" maxLength={120} placeholder={`${doc.title} copy`} value={copyTitle} onChange={e => setCopyTitle(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm" aria-label="Name for the copy" data-testid="project-copy-title" />
          <button type="button" className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted disabled:opacity-50" disabled={!!busy} onClick={() => void saveAs()} data-testid="project-save-as"><FilePlus2 className="h-4 w-4" />Save as…</button>
        </div>
        <button type="button" className={btn} disabled={!!busy} onClick={onGoTemplates} data-testid="project-save-template"><Shapes className="h-4 w-4" />Save as template…</button>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <h3 className={heading}>Project file</h3>
        <p className="text-xs text-muted-foreground">A project file holds the whole carousel with every layer still editable. Open it later, or in another account, as a new carousel.</p>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeMedia} onChange={e => setIncludeMedia(e.target.checked)} data-testid="project-include-media" />Include pictures and music in the file (larger, but opens complete anywhere)</label>
        <button type="button" className={btn} disabled={!!busy} onClick={() => void download()} data-testid="project-download">{busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Download project file</button>
        <input ref={proj} type="file" accept=".json,.sgcarousel,application/json" className="hidden" onChange={e => openProject(e.target.files?.[0])} data-testid="project-open-input" />
        <button type="button" className={btn} disabled={!!busy} onClick={() => proj.current?.click()} data-testid="project-open">{busy === 'open' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}Open a project file…</button>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <h3 className={heading}>Import</h3>
        <p className="text-xs text-muted-foreground">Pictures (PNG, JPEG, WebP, GIF) and SVG files become picture layers on this slide. A PDF whose pages are pictures becomes one slide per page. SVG and PDF imports are flattened: you can move and resize them, but their inner shapes and text are not editable.</p>
        <input ref={pics} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg" className="hidden" onChange={e => importPictures(e.target.files ?? undefined)} data-testid="import-pictures-input" />
        <button type="button" className={btn} disabled={!!busy} onClick={() => pics.current?.click()} data-testid="import-pictures">{busy === 'pictures' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}Import pictures or SVG</button>
        <input ref={pdf} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => importPdf(e.target.files?.[0])} data-testid="import-pdf-input" />
        <button type="button" className={btn} disabled={!!busy} onClick={() => pdf.current?.click()} data-testid="import-pdf">{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}Import a PDF (pages as slides)</button>
        <p className="text-[11px] text-muted-foreground">Music is added in the Animate tab (MP3, WAV, M4A, AAC).</p>
      </div>

      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-xs text-destructive' : 'text-xs text-emerald-700 dark:text-emerald-400'} data-testid="project-message">{message.text}</p>}
      {notes.length > 0 && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="project-notes">
          <p className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Good to know</p>
          <ul className="list-disc space-y-0.5 pl-4">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
    </section>
  )
}

export { importKindOf }
