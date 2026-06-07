import { useState, useEffect, type FormEvent, type CSSProperties, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Job, JobPlan } from '../types'
import { planApi, uploadApi, brandsApi } from '../api/client'

interface Brand {
  id: number
  name: string
  colors: { primary?: string; secondary?: string; accent?: string } | null
  tone_of_voice: string | null
}

export default function JobPlanner() {
  const navigate = useNavigate()
  const [prompt, setPrompt]           = useState('')
  const [title, setTitle]             = useState('')
  const [brandId, setBrandId]         = useState<number | ''>('')
  const [brands, setBrands]           = useState<Brand[]>([])
  const [loading, setLoading]         = useState(false)
  const [uploading, setUploading]     = useState(false)
  const [result, setResult]           = useState<Job | null>(null)
  const [error, setError]             = useState('')
  const [uploadFile, setUploadFile]   = useState<File | null>(null)
  const [dragOver, setDragOver]       = useState(false)

  const plan: JobPlan | null = result?.plan_json ?? null

  useEffect(() => {
    brandsApi.list()
      .then(({ data }) => setBrands(data as Brand[]))
      .catch(() => {/* brands are optional — silently ignore */})
  }, [])

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) setUploadFile(file)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) return
    setError('')
    setLoading(true)
    try {
      const { data } = await planApi.create(prompt, title || undefined, brandId !== '' ? brandId : undefined)
      const job = data as Job
      setResult(job)

      if (uploadFile) {
        setUploading(true)
        await uploadApi.upload(uploadFile, job.id)
        setUploading(false)
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg ?? 'Failed to generate plan — check your API key and try again')
    } finally {
      setLoading(false)
      setUploading(false)
    }
  }

  const selectedBrand = brands.find((b) => b.id === brandId)
  const btnLabel = uploading ? 'Uploading file…' : loading ? 'Generating plan…' : 'Generate Content Plan'

  return (
    <div>
      <h2 style={s.pageTitle}>Content Planner</h2>
      <p style={s.pageSub}>
        Describe your content idea in plain English — Claude will build a step-by-step production plan.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: plan ? '1fr 1fr' : '580px', gap: 28, alignItems: 'start' }}>
        {/* ── Input form ── */}
        <div style={s.panel}>
          <form onSubmit={handleSubmit} style={s.form}>
            <label style={s.label}>Job title (optional)</label>
            <input
              style={s.input}
              type="text"
              placeholder="e.g. April Product Launch Campaign"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            {/* ── Brand selector ── */}
            {brands.length > 0 && (
              <>
                <label style={s.label}>Brand (optional)</label>
                <div style={s.brandSelector}>
                  <select
                    style={s.select}
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value === '' ? '' : Number(e.target.value))}
                  >
                    <option value="">No brand — use default tone</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  {selectedBrand?.colors && (
                    <div style={s.colorPips}>
                      {Object.values(selectedBrand.colors)
                        .filter(Boolean)
                        .map((color, i) => (
                          <span
                            key={i}
                            title={color}
                            style={{ ...s.colorPip, background: color }}
                          />
                        ))}
                    </div>
                  )}
                </div>
                {selectedBrand && (
                  <p style={s.brandHint}>
                    Claude will tailor this plan to <strong>{selectedBrand.name}</strong>
                    {selectedBrand.tone_of_voice ? ` · ${selectedBrand.tone_of_voice} tone` : ''}
                  </p>
                )}
              </>
            )}

            <label style={s.label}>Content brief *</label>
            <textarea
              style={s.textarea}
              placeholder="e.g. Create a 60-second Instagram Reel for our new product launch, repurpose into a LinkedIn post and Beehiiv newsletter. Add subtitles, use brand colours, post to Google My Business..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
              rows={7}
            />

            <label style={s.label}>Attach file (optional)</label>
            <div
              style={{ ...s.dropzone, ...(dragOver ? s.dropzoneOver : {}) }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('fileInput')?.click()}
            >
              <input
                id="fileInput"
                type="file"
                style={{ display: 'none' }}
                accept="video/*,audio/*,image/*,.pdf"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
              {uploadFile
                ? <span style={s.fileName}>{uploadFile.name}</span>
                : <span style={s.dropzoneHint}>Drop video · audio · image here, or click to browse</span>
              }
            </div>

            {error && <p style={s.error}>{error}</p>}

            <button
              style={{ ...s.submitBtn, opacity: loading || !prompt.trim() ? 0.65 : 1 }}
              type="submit"
              disabled={loading || !prompt.trim()}
            >
              {btnLabel}
            </button>
          </form>
        </div>

        {/* ── Plan result ── */}
        {plan && (
          <div style={s.panel}>
            {plan.error ? (
              <p style={s.error}>Claude returned an unparseable response. Raw: {plan.error}</p>
            ) : (
              <>
                <div style={s.planHeader}>
                  {result?.brand_id && selectedBrand && (
                    <div style={s.brandBadge}>
                      {selectedBrand.colors?.primary && (
                        <span style={{ ...s.colorPip, background: selectedBrand.colors.primary }} />
                      )}
                      {selectedBrand.name}
                    </div>
                  )}
                  <h3 style={s.planTitle}>{plan.title}</h3>
                  <p style={s.planSummary}>{plan.summary}</p>
                  <div style={s.metaRow}>
                    <div style={s.tags}>
                      {plan.platforms?.map((p) => <span key={p} style={s.tag}>{p}</span>)}
                    </div>
                    <span style={s.totalTime}>{plan.estimated_total_time}</span>
                  </div>
                </div>

                <div style={s.steps}>
                  {plan.steps?.map((step) => (
                    <div key={step.step} style={s.step}>
                      <div style={s.stepNum}>{step.step}</div>
                      <div style={s.stepBody}>
                        <div style={s.stepRow}>
                          <strong style={s.stepAction}>{step.action}</strong>
                          <span style={s.toolBadge}>{step.tool}</span>
                        </div>
                        <p style={s.stepDesc}>{step.description}</p>
                        <span style={s.stepTime}>{step.estimated_duration}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <button style={s.doneBtn} onClick={() => navigate('/dashboard')}>
                  View in Dashboard →
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  pageTitle: { margin: '0 0 6px', fontSize: 28, fontWeight: 800, color: '#1E3D2A', letterSpacing: '-0.5px' },
  pageSub:   { margin: '0 0 28px', color: '#888', fontSize: 14, lineHeight: 1.5 },
  panel: {
    background: '#fff',
    borderRadius: 12,
    padding: 32,
    boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
    border: '1px solid #ede9e0',
  },
  form:     { display: 'flex', flexDirection: 'column', gap: 16 },
  label:    { fontSize: 13, fontWeight: 700, color: '#1E3D2A', marginBottom: -8 },
  input:    { padding: '12px 14px', border: '2px solid #e8e3d8', borderRadius: 8, fontSize: 15, outline: 'none', color: '#1a1a1a', background: '#faf9f5' },
  select:   { flex: 1, padding: '11px 14px', border: '2px solid #e8e3d8', borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a1a1a', background: '#faf9f5', cursor: 'pointer', appearance: 'auto' },
  textarea: { padding: '12px 14px', border: '2px solid #e8e3d8', borderRadius: 8, fontSize: 14, outline: 'none', resize: 'vertical', lineHeight: 1.65, color: '#1a1a1a', background: '#faf9f5', fontFamily: 'inherit' },
  brandSelector: { display: 'flex', gap: 8, alignItems: 'center' },
  brandHint: { margin: '-4px 0 0', fontSize: 12, color: '#888', fontStyle: 'italic' },
  brandBadge: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F5F0E8', border: '1px solid #e0d9cc', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: '#1E3D2A', marginBottom: 10 },
  colorPips: { display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 },
  colorPip:  { display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '1.5px solid rgba(0,0,0,0.12)' },
  dropzone: {
    border: '2px dashed #d5cfc0',
    borderRadius: 8,
    padding: '22px 16px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    background: '#faf9f5',
  },
  dropzoneOver: { borderColor: '#C89A2E', background: '#fdf8ee' },
  dropzoneHint: { color: '#bbb', fontSize: 13 },
  fileName:     { color: '#1E3D2A', fontWeight: 600, fontSize: 13 },
  error:        { margin: 0, color: '#c0392b', fontSize: 13 },
  submitBtn: {
    marginTop: 4,
    padding: '14px',
    background: '#1E3D2A',
    color: '#F5F0E8',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background 0.15s, opacity 0.15s',
  },
  planHeader:  { marginBottom: 24 },
  planTitle:   { margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: '#1E3D2A', lineHeight: 1.25 },
  planSummary: { margin: '0 0 14px', color: '#555', fontSize: 14, lineHeight: 1.55 },
  metaRow:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  tags:        { display: 'flex', gap: 6, flexWrap: 'wrap' },
  tag:         { background: '#F5F0E8', color: '#1E3D2A', padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600 },
  totalTime:   { color: '#C89A2E', fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap' },
  steps:       { display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 },
  step:        { display: 'flex', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 26,
    height: 26,
    minWidth: 26,
    background: '#1E3D2A',
    color: '#F5F0E8',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 800,
    marginTop: 2,
  },
  stepBody:   { flex: 1, minWidth: 0 },
  stepRow:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  stepAction: { fontSize: 14, color: '#1E3D2A', fontWeight: 700 },
  toolBadge:  { background: '#C89A2E', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' },
  stepDesc:   { margin: '0 0 4px', fontSize: 13, color: '#555', lineHeight: 1.55 },
  stepTime:   { fontSize: 11, color: '#bbb' },
  doneBtn: {
    width: '100%',
    padding: '13px',
    background: '#C89A2E',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
}
