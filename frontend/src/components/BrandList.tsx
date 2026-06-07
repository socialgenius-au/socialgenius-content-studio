import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Brand } from '../types'
import { brandsApi } from '../api/client'

export default function BrandList() {
  const navigate = useNavigate()
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    brandsApi.list().then((r) => setBrands(r.data as Brand[])).finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this brand?')) return
    await brandsApi.delete(id)
    setBrands((prev) => prev.filter((b) => b.id !== id))
  }

  return (
    <div>
      <div style={s.header}>
        <div>
          <h2 style={s.title}>Brands</h2>
          <p style={s.sub}>Manage your brand identities — applied to every Claude plan</p>
        </div>
        <button style={s.createBtn} onClick={() => navigate('/brands/new')}>+ New Brand</button>
      </div>

      {loading ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : brands.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyTitle}>No brands yet</p>
          <Link to="/brands/new" style={s.emptyLink}>Create your first brand →</Link>
        </div>
      ) : (
        <div style={s.grid}>
          {brands.map((b) => (
            <div key={b.id} style={s.card}>
              <div style={s.swatches}>
                {Object.entries(b.colors ?? {}).map(([k, v]) => (
                  <div key={k} title={`${k}: ${v}`} style={{ ...s.swatch, background: v as string }} />
                ))}
              </div>
              <h3 style={s.brandName}>{b.name}</h3>
              {b.tone_of_voice && <p style={s.tone}>{b.tone_of_voice.slice(0, 80)}{b.tone_of_voice.length > 80 ? '…' : ''}</p>}
              {b.logo_url && <img src={b.logo_url} alt="logo" style={s.logo} />}
              <div style={s.actions}>
                <button style={s.editBtn} onClick={() => navigate(`/brands/${b.id}`)}>Edit</button>
                <button style={s.deleteBtn} onClick={() => handleDelete(b.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  header:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 },
  title:      { margin: 0, fontSize: 28, fontWeight: 800, color: '#1E3D2A', letterSpacing: '-0.5px' },
  sub:        { margin: '6px 0 0', color: '#888', fontSize: 14 },
  createBtn:  { padding: '12px 24px', background: '#1E3D2A', color: '#F5F0E8', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  empty:      { textAlign: 'center', padding: '96px 0' },
  emptyTitle: { fontSize: 18, fontWeight: 600, color: '#555', margin: '0 0 12px' },
  emptyLink:  { color: '#C89A2E', textDecoration: 'none', fontWeight: 600, fontSize: 15 },
  grid:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 },
  card:       { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)', border: '1px solid #ede9e0' },
  swatches:   { display: 'flex', gap: 6, marginBottom: 16 },
  swatch:     { width: 28, height: 28, borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)' },
  brandName:  { margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: '#1E3D2A' },
  tone:       { margin: '0 0 12px', fontSize: 13, color: '#666', lineHeight: 1.5 },
  logo:       { maxWidth: 80, maxHeight: 40, objectFit: 'contain', marginBottom: 12, display: 'block' },
  actions:    { display: 'flex', gap: 8, marginTop: 16 },
  editBtn:    { flex: 1, padding: '8px', background: '#1E3D2A', color: '#F5F0E8', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  deleteBtn:  { padding: '8px 16px', background: 'transparent', color: '#c0392b', border: '1px solid #c0392b', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer' },
}
