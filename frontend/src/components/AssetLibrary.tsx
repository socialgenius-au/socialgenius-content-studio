import { useEffect, useState, type CSSProperties } from 'react'
import type { Asset } from '../types'
import { assetsApi } from '../api/client'

const FILE_TYPES = ['all', 'video', 'audio', 'image', 'document', 'thumbnail', 'other']

const TYPE_ICON: Record<string, string> = {
  video:     '🎬',
  audio:     '🎵',
  image:     '🖼',
  document:  '📄',
  thumbnail: '🖼',
  other:     '📎',
}

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AssetLibrary() {
  const [assets, setAssets]       = useState<Asset[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('all')
  const [selected, setSelected]   = useState<Set<number>>(new Set())
  const [zipping, setZipping]     = useState(false)
  const [deleting, setDeleting]   = useState<number | null>(null)

  const load = (ft: string) => {
    setLoading(true)
    assetsApi.list(ft === 'all' ? {} : { file_type: ft })
      .then((r) => setAssets(r.data as Asset[]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(filter) }, [filter])

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === assets.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(assets.map((a) => a.id)))
    }
  }

  const handleDownload = async (asset: Asset) => {
    const { data } = await assetsApi.download(asset.id)
    const url = URL.createObjectURL(data as Blob)
    const link = document.createElement('a')
    link.href = url
    link.download = asset.original_filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleZip = async () => {
    if (selected.size === 0) return
    setZipping(true)
    try {
      const { data } = await assetsApi.zip(Array.from(selected))
      const url = URL.createObjectURL(data as Blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'socialgenius-assets.zip'
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setZipping(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this asset? This cannot be undone.')) return
    setDeleting(id)
    try {
      await assetsApi.delete(id)
      setAssets((prev) => prev.filter((a) => a.id !== id))
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      <div style={s.header}>
        <div>
          <h2 style={s.title}>Asset Library</h2>
          <p style={s.sub}>{assets.length} file{assets.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={s.headerActions}>
          {selected.size > 0 && (
            <button
              style={{ ...s.zipBtn, opacity: zipping ? 0.65 : 1 }}
              onClick={handleZip}
              disabled={zipping}
            >
              {zipping ? 'Zipping…' : `Download ZIP (${selected.size})`}
            </button>
          )}
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div style={s.tabs}>
        {FILE_TYPES.map((ft) => (
          <button
            key={ft}
            style={{ ...s.tab, ...(filter === ft ? s.tabActive : {}) }}
            onClick={() => { setFilter(ft); setSelected(new Set()) }}
          >
            {ft.charAt(0).toUpperCase() + ft.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : assets.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No {filter === 'all' ? '' : filter + ' '}assets yet.</p>
          <p style={s.emptyHint}>Upload files from a job to see them here.</p>
        </div>
      ) : (
        <>
          {/* ── Select all ── */}
          <div style={s.selectBar}>
            <label style={s.checkLabel}>
              <input
                type="checkbox"
                checked={selected.size === assets.length && assets.length > 0}
                onChange={toggleAll}
              />
              <span>Select all</span>
            </label>
            {selected.size > 0 && (
              <span style={s.selectedCount}>{selected.size} selected</span>
            )}
          </div>

          {/* ── Asset grid ── */}
          <div style={s.grid}>
            {assets.map((asset) => {
              const isThumb = asset.file_type === 'thumbnail'
              const isImg   = asset.file_type === 'image' || isThumb
              const imgSrc  = isImg ? assetsApi.previewUrl(asset.file_path) : null

              return (
                <div
                  key={asset.id}
                  style={{ ...s.card, ...(selected.has(asset.id) ? s.cardSelected : {}) }}
                >
                  <label style={s.checkOverlay}>
                    <input
                      type="checkbox"
                      checked={selected.has(asset.id)}
                      onChange={() => toggleSelect(asset.id)}
                      style={{ accentColor: '#C89A2E' }}
                    />
                  </label>

                  <div style={s.preview}>
                    {imgSrc ? (
                      <img
                        src={imgSrc}
                        alt={asset.original_filename}
                        style={s.previewImg}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <span style={s.previewIcon}>{TYPE_ICON[asset.file_type] ?? '📎'}</span>
                    )}
                  </div>

                  <div style={s.cardBody}>
                    <p style={s.filename} title={asset.original_filename}>
                      {asset.original_filename.length > 32
                        ? `${asset.original_filename.slice(0, 29)}…`
                        : asset.original_filename}
                    </p>
                    <p style={s.meta}>
                      <span style={{ ...s.typePill, background: TYPE_ICON[asset.file_type] ? '#e8f5e9' : '#eee', color: '#555' }}>
                        {asset.file_type}
                      </span>
                      {fmtSize(asset.file_size)} · {fmtDate(asset.created_at)}
                    </p>
                    <div style={s.actions}>
                      <button style={s.dlBtn} onClick={() => handleDownload(asset)}>
                        Download
                      </button>
                      <button
                        style={{ ...s.delBtn, opacity: deleting === asset.id ? 0.5 : 1 }}
                        onClick={() => handleDelete(asset.id)}
                        disabled={deleting === asset.id}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  header:        { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  title:         { margin: 0, fontSize: 28, fontWeight: 800, color: '#1E3D2A', letterSpacing: '-0.5px' },
  sub:           { margin: '6px 0 0', color: '#888', fontSize: 14 },
  headerActions: { display: 'flex', gap: 12, alignItems: 'center' },
  zipBtn: {
    padding: '10px 20px',
    background: '#C89A2E',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  tabs: { display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' },
  tab: {
    padding: '6px 16px',
    border: '2px solid #e8e3d8',
    borderRadius: 20,
    background: '#fff',
    color: '#888',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  tabActive: { borderColor: '#1E3D2A', background: '#1E3D2A', color: '#F5F0E8' },
  empty:    { textAlign: 'center', padding: '80px 0' },
  emptyText:{ fontSize: 16, fontWeight: 600, color: '#555', margin: '0 0 8px' },
  emptyHint:{ fontSize: 14, color: '#aaa', margin: 0 },
  selectBar:     { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
  checkLabel:    { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#555', cursor: 'pointer' },
  selectedCount: { fontSize: 13, color: '#C89A2E', fontWeight: 700 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 },
  card: {
    background: '#fff',
    borderRadius: 10,
    border: '2px solid #ede9e0',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
    position: 'relative',
    transition: 'border-color 0.15s',
  },
  cardSelected: { borderColor: '#C89A2E' },
  checkOverlay: { position: 'absolute', top: 10, left: 10, zIndex: 2, cursor: 'pointer' },
  preview: {
    height: 120,
    background: '#f5f2ea',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImg:  { width: '100%', height: '100%', objectFit: 'cover' },
  previewIcon: { fontSize: 40 },
  cardBody:    { padding: '12px 14px 14px' },
  filename:    { margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: '#1E3D2A', lineHeight: 1.4 },
  meta:        { margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#aaa', flexWrap: 'wrap' },
  typePill:    { padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700 },
  actions:     { display: 'flex', gap: 6 },
  dlBtn: {
    flex: 1,
    padding: '6px',
    background: '#1E3D2A',
    color: '#F5F0E8',
    border: 'none',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
  },
  delBtn: {
    padding: '6px 10px',
    background: 'transparent',
    color: '#c0392b',
    border: '1px solid #f5c6c6',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
