import { useEffect, useState, type FormEvent, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Brand } from '../types'
import { brandsApi, uploadApi } from '../api/client'

const DEFAULT_COLORS = { primary: '#1E3D2A', secondary: '#C89A2E', accent: '#F5F0E8' }
const DEFAULT_FONTS  = { heading: 'Inter', body: 'Inter' }

export default function BrandForm() {
  const { brandId } = useParams<{ brandId?: string }>()
  const navigate    = useNavigate()
  const isEdit      = Boolean(brandId)

  const [name, setName]               = useState('')
  const [colors, setColors]           = useState<Record<string, string>>(DEFAULT_COLORS)
  const [fonts, setFonts]             = useState<Record<string, string>>(DEFAULT_FONTS)
  const [logoUrl, setLogoUrl]         = useState('')
  const [tone, setTone]               = useState('')
  const [loading, setLoading]         = useState(isEdit)
  const [saving, setSaving]           = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    if (!isEdit || !brandId) return
    brandsApi.get(Number(brandId))
      .then((r) => {
        const b = r.data as Brand
        setName(b.name)
        setColors({ ...DEFAULT_COLORS, ...(b.colors as Record<string, string>) })
        setFonts({ ...DEFAULT_FONTS, ...(b.fonts as Record<string, string>) })
        setLogoUrl(b.logo_url ?? '')
        setTone(b.tone_of_voice ?? '')
      })
      .finally(() => setLoading(false))
  }, [brandId])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    try {
      const { data } = await uploadApi.upload(file)
      const apiBase = import.meta.env.VITE_API_URL as string ?? ''
      setLogoUrl(`${apiBase}/uploads/${(data as { user_id: number; stored_filename: string }).user_id}/${(data as { user_id: number; stored_filename: string }).stored_filename}`)
    } finally {
      setLogoUploading(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const body = { name, colors, fonts, logo_url: logoUrl || null, tone_of_voice: tone || null }
      if (isEdit && brandId) {
        await brandsApi.update(Number(brandId), body)
      } else {
        await brandsApi.create(body)
      }
      navigate('/brands')
    } catch {
      setError('Failed to save brand')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p style={{ color: '#888', padding: 48 }}>Loading…</p>

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={s.title}>{isEdit ? 'Edit Brand' : 'New Brand'}</h2>

      <form onSubmit={handleSubmit} style={s.form}>
        <label style={s.label}>Brand name *</label>
        <input style={s.input} type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. SocialGenius" />

        <label style={s.label}>Brand colours</label>
        <div style={s.colorRow}>
          {Object.entries(colors).map(([key, val]) => (
            <div key={key} style={s.colorItem}>
              <input type="color" value={val} onChange={(e) => setColors({ ...colors, [key]: e.target.value })} style={s.colorPicker} />
              <div>
                <p style={s.colorLabel}>{key}</p>
                <p style={s.colorHex}>{val}</p>
              </div>
            </div>
          ))}
        </div>

        <label style={s.label}>Fonts</label>
        <div style={s.twoCol}>
          {Object.entries(fonts).map(([key, val]) => (
            <div key={key}>
              <p style={s.subLabel}>{key}</p>
              <input style={s.input} type="text" value={val} onChange={(e) => setFonts({ ...fonts, [key]: e.target.value })} placeholder={`e.g. Inter`} />
            </div>
          ))}
        </div>

        <label style={s.label}>Logo</label>
        <div style={s.logoRow}>
          <label style={s.uploadLabel}>
            <input type="file" style={{ display: 'none' }} accept="image/*" onChange={handleLogoUpload} />
            {logoUploading ? 'Uploading…' : 'Upload logo'}
          </label>
          <input style={{ ...s.input, flex: 1 }} type="text" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="or paste URL" />
        </div>
        {logoUrl && <img src={logoUrl} alt="logo preview" style={s.logoPreview} />}

        <label style={s.label}>Tone of voice</label>
        <textarea
          style={s.textarea}
          rows={4}
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="e.g. Professional but approachable. Use contractions. Avoid jargon. Focus on outcomes, not features."
        />

        {error && <p style={s.error}>{error}</p>}

        <div style={s.btnRow}>
          <button type="button" style={s.cancelBtn} onClick={() => navigate('/brands')}>Cancel</button>
          <button type="submit" style={{ ...s.saveBtn, opacity: saving ? 0.65 : 1 }} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Brand'}
          </button>
        </div>
      </form>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  title:       { margin: '0 0 28px', fontSize: 26, fontWeight: 800, color: '#1E3D2A' },
  form:        { display: 'flex', flexDirection: 'column', gap: 18, background: '#fff', padding: 32, borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.06)', border: '1px solid #ede9e0' },
  label:       { fontSize: 13, fontWeight: 700, color: '#1E3D2A', marginBottom: -10 },
  subLabel:    { margin: '0 0 6px', fontSize: 12, color: '#888' },
  input:       { padding: '11px 14px', border: '2px solid #e8e3d8', borderRadius: 8, fontSize: 14, outline: 'none', background: '#faf9f5', color: '#1a1a1a' },
  textarea:    { padding: '11px 14px', border: '2px solid #e8e3d8', borderRadius: 8, fontSize: 14, outline: 'none', resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit', background: '#faf9f5', color: '#1a1a1a' },
  colorRow:    { display: 'flex', gap: 16, flexWrap: 'wrap' },
  colorItem:   { display: 'flex', alignItems: 'center', gap: 10 },
  colorPicker: { width: 44, height: 44, border: 'none', borderRadius: 8, cursor: 'pointer', padding: 2, background: 'transparent' },
  colorLabel:  { margin: 0, fontSize: 12, fontWeight: 600, color: '#555', textTransform: 'capitalize' },
  colorHex:    { margin: '2px 0 0', fontSize: 11, color: '#aaa', fontFamily: 'monospace' },
  twoCol:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  logoRow:     { display: 'flex', gap: 12, alignItems: 'center' },
  uploadLabel: { padding: '10px 18px', background: '#1E3D2A', color: '#F5F0E8', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  logoPreview: { maxWidth: 120, maxHeight: 48, objectFit: 'contain', borderRadius: 4 },
  error:       { margin: 0, color: '#c0392b', fontSize: 13 },
  btnRow:      { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 },
  cancelBtn:   { padding: '11px 22px', background: 'transparent', border: '2px solid #ddd', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#555' },
  saveBtn:     { padding: '11px 28px', background: '#1E3D2A', color: '#F5F0E8', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
}
