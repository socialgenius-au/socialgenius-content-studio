import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AxiosError } from 'axios'
import api from '../api/client'
import type { Asset } from '../types'
import './VirtualAssetLibrary.css'

type Kind = 'image' | 'video'
type Provider = 'pexels' | 'pixabay' | 'unsplash'
export type StockAsset = {
  key: string
  kind: Kind
  provider: Provider
  title: string
  creator?: string
  creator_url?: string
  source: string
  preview?: string
  poster?: string
  duration?: number
  tags: string[]
  niches: string[]
  licence: string
  licence_url: string
}
type Collection = { name: string; phase_one_target: number | null; final_target: number | null; items: StockAsset[] }
type Workspace = { workspace: string; collections: Collection[] }
type Props = {
  kind?: Kind
  onMedia?: (asset: Asset, result: StockAsset) => void | Promise<void>
  onReference?: (result: StockAsset) => void | Promise<void>
  onClose?: () => void
}
const providers = { pexels: 'Pexels', pixabay: 'Pixabay', unsplash: 'Unsplash' }
const names: Record<string, string> = { personal: 'My references', sameena: 'Sameena', khudsia: 'Khudsia' }

function messageFor(error: unknown) {
  if (error instanceof AxiosError && typeof error.response?.data?.detail === 'string') return error.response.data.detail
  return 'The request could not be completed. Try again.'
}

function AssetCard({ row, action, checking, reuse }: {
  row: StockAsset
  action: (action: 'check' | 'save' | 'similar') => void
  checking: boolean
  reuse?: { label: string; disabled: boolean; onClick: () => void }
}) {
  return <article className="sg-stock-card">
    <div className="sg-stock-preview">
      {row.preview ? row.kind === 'video'
        ? <video controls playsInline preload="none" poster={row.poster} src={row.preview} aria-label={row.title} />
        : <img src={row.preview} alt={row.title} loading="lazy" />
        : <button type="button" disabled={checking} onClick={() => action('check')}>Load preview</button>}
    </div>
    <div className="sg-stock-details">
      <h3>{row.title}</h3>
      <p>{row.creator && (row.creator_url
        ? <a href={row.creator_url} target="_blank" rel="noreferrer">{row.creator}</a>
        : row.creator)}{row.creator && ' · '}
        <a href={row.source} target="_blank" rel="noreferrer">{providers[row.provider]}</a>{row.duration ? ` · ${row.duration}s` : ''}
      </p>
      <a href={row.licence_url} target="_blank" rel="noreferrer">{row.licence}</a>
      {(row.niches.length > 0 || row.tags.length > 0) && <p>{[...row.niches, ...row.tags.slice(0, 4)].join(' · ')}</p>}
      <div className="sg-stock-actions">
        <button type="button" disabled={checking} onClick={() => action('save')}>Bookmark</button>
        <button type="button" disabled={checking} onClick={() => action('check')}>Check availability</button>
        <button type="button" disabled={checking} onClick={() => action('similar')}>Find alternatives</button>
        {reuse && <button type="button" disabled={reuse.disabled} onClick={reuse.onClick}>{reuse.label}</button>}
      </div>
    </div>
  </article>
}

export function VirtualAssetLibrary({ kind, onMedia, onReference, onClose }: Props) {
  const [mediaKind, setKind] = useState<Kind>(kind || 'image')
  const [provider, setProvider] = useState<Provider>('pexels')
  const [query, setQuery] = useState('')
  const [searchPage, setSearchPage] = useState<{ query: string; page: number }>()
  const [rows, setRows] = useState<StockAsset[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspace, setWorkspace] = useState('personal')
  const [collection, setCollection] = useState('Saved references')
  const [tab, setTab] = useState<'search' | 'saved'>('search')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [refreshed, setRefreshed] = useState<Record<string, StockAsset>>({})
  const [rights, setRights] = useState(false)
  const activeWorkspace = workspaces.find(row => row.workspace === workspace)
  const selected = activeWorkspace?.collections.find(row => row.name === collection)
  const load = async () => setWorkspaces((await api.get<Workspace[]>('/virtual-assets/collections')).data)
  useEffect(() => { void load().catch(error => setStatus(messageFor(error))) }, [])

  async function run(task: () => Promise<void>) {
    setBusy(true)
    setStatus('')
    try { await task() }
    catch (error) { setStatus(messageFor(error)) }
    finally { setBusy(false) }
  }
  async function search(term: string, page = 1, alternative?: StockAsset) {
    const sources: Provider[] = alternative ? [provider, ...Object.keys(providers).filter(key => key !== provider) as Provider[]] : [provider]
    const type = alternative?.kind || mediaKind
    setKind(type)
    if (type === 'video' && provider === 'unsplash') setProvider('pexels')
    setQuery(term)
    setTab('search')
    setRows([])
    setSearchPage(undefined)
    const candidates = sources.filter(source => type === 'image' || source !== 'unsplash')
    let searched = false
    for (const source of candidates) {
      try {
        const { data } = await api.get<StockAsset[]>('/virtual-assets/search', { params: { provider: source, kind: type, q: term, page } })
        searched = true
        const matches = data.filter(row => row.key !== alternative?.key)
        if (!matches.length && alternative) continue
        setProvider(source)
        setRows(matches)
        setSearchPage({ query: term, page })
        if (!matches.length) setStatus('No matching assets.')
        return
      } catch (error) {
        if (!alternative) throw error
      }
    }
    setStatus(searched ? 'No matching alternatives.' : 'Asset providers are unavailable.')
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (query.trim().length >= 2) void run(() => search(query.trim()))
  }
  const display = tab === 'saved' ? (selected?.items ?? []).filter(row => !kind || row.kind === kind) : rows
  const choose = (row: StockAsset) => run(async () => {
    if (onMedia && row.provider !== 'unsplash') {
      const { data } = await api.post<Asset>('/virtual-assets/project-media', { key: row.key, rights_confirmed: rights })
      await onMedia(data, row)
    } else if (onReference) {
      const { data } = await api.post<StockAsset>('/virtual-assets/reference-use', { key: row.key })
      await onReference(data)
    }
    onClose?.()
  })
  return <section className="sg-stock" aria-label="Universal Asset Library">
    <header><h1>Universal Asset Library</h1>{onClose && <button type="button" onClick={onClose}>Close</button>}</header>
    <nav aria-label="Library views">
      <button type="button" aria-pressed={tab === 'search'} onClick={() => setTab('search')}>Discover assets</button>
      <button type="button" aria-pressed={tab === 'saved'} onClick={() => setTab('saved')}>Collections</button>
    </nav>
    <div className="sg-stock-controls">
      <label>Workspace<select value={workspace} disabled={busy} onChange={event => {
        const next = event.target.value
        setWorkspace(next)
        setCollection(workspaces.find(row => row.workspace === next)?.collections[0]?.name ?? 'Saved references')
      }}>{workspaces.length ? workspaces.map(row => <option key={row.workspace} value={row.workspace}>{names[row.workspace]}</option>) : <option value="personal">My references</option>}</select></label>
      <label>Collection<select value={collection} disabled={busy} onChange={event => setCollection(event.target.value)}>
        {(workspaces.find(row => row.workspace === workspace)?.collections ?? [{ name: 'Saved references' }]).map(row => <option key={row.name}>{row.name}</option>)}
      </select></label>
      {selected?.phase_one_target && <p>{selected.items.length} saved · Phase 1 target {selected.phase_one_target} · Final target {selected.final_target}</p>}
    </div>
    {tab === 'saved' && workspace !== 'personal' && activeWorkspace && <ul className="sg-stock-progress" aria-label="Collection progress">
      {activeWorkspace.collections.map(row => <li key={row.name}><button type="button" aria-pressed={collection === row.name} onClick={() => setCollection(row.name)}>{row.name} · {row.items.length} / {row.phase_one_target}</button></li>)}
    </ul>}
    {tab === 'search' && <form onSubmit={submit} className="sg-stock-controls">
      {!kind && <label>Media<select value={mediaKind} disabled={busy} onChange={event => {
        const next = event.target.value as Kind
        setKind(next)
        if (next === 'video' && provider === 'unsplash') setProvider('pexels')
        setSearchPage(undefined)
      }}><option value="image">Photos</option><option value="video">Videos</option></select></label>}
      <label>Provider<select value={provider} disabled={busy} onChange={event => { setProvider(event.target.value as Provider); setSearchPage(undefined) }}>
        {Object.entries(providers).filter(([key]) => mediaKind === 'image' || key !== 'unsplash').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label className="sg-stock-query">Search assets<input type="search" placeholder="e.g. healthy ageing" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} /></label>
      <button disabled={busy || query.trim().length < 2}>Search</button>
    </form>}
    {onMedia && <label className="sg-stock-rights"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} /> I’ve checked the licence and permissions for my intended use.</label>}
    <p role="status">{busy ? 'Working…' : status}</p>
    {tab === 'saved' && !display.length && <p>No bookmarks in this collection.</p>}
    <div className="sg-stock-grid">{display.map(row => {
      const item = refreshed[row.key] ?? row
      const materialise = Boolean(onMedia && row.provider !== 'unsplash')
      return <AssetCard key={row.key} row={item} checking={busy}
        reuse={materialise || onReference ? { disabled: busy || (materialise && !rights), onClick: () => void choose(item), label: materialise ? 'Add to project' : 'Attach reference' } : undefined}
        action={action => {
          if (action === 'similar') {
            const term = item.niches[0] || item.tags.slice(0, 3).join(' ') || item.title
            void run(() => search(term.slice(0, 100), 1, item))
          } else if (action === 'check') {
            void run(async () => {
              const { data } = await api.get<{ status: string; item: StockAsset }>(`/virtual-assets/availability/${row.key}`)
              if (data.status === 'available') setRefreshed(previous => ({ ...previous, [row.key]: data.item }))
              setStatus(`${row.title} · ${data.status}`)
            })
          } else if (action === 'save') {
            void run(async () => {
              const { data } = await api.put<{ duplicate: boolean }>('/virtual-assets/bookmarks', { key: row.key, workspace, collection })
              await load()
              setStatus(data.duplicate ? 'Already bookmarked in this collection.' : `Bookmarked in ${collection}.`)
            })
          }
        }} />
    })}</div>
    {tab === 'search' && searchPage && <nav aria-label="Search pages">
      <button type="button" disabled={busy || searchPage.page === 1} onClick={() => void run(() => search(searchPage.query, searchPage.page - 1))}>Previous</button>
      <span>Page {searchPage.page}</span>
      <button type="button" disabled={busy || rows.length === 0 || searchPage.page === 50} onClick={() => void run(() => search(searchPage.query, searchPage.page + 1))}>Next</button>
    </nav>}
  </section>
}
export default VirtualAssetLibrary

export function VirtualAssetPicker(props: Omit<Props, 'onClose'> & { label?: string }) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open) dialog.current?.showModal()
  }, [open])
  return <>
    <button type="button" className="sg-stock-launch" onClick={() => setOpen(true)}>{props.label ?? 'Universal Asset Library'}</button>
    {open && <dialog ref={dialog} className="sg-stock-dialog" onClose={() => setOpen(false)}>
      <VirtualAssetLibrary {...props} onClose={() => dialog.current?.close()} />
    </dialog>}
  </>
}
