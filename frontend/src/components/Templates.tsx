import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Template } from '../types'
import { templatesApi } from '../api/client'

export default function Templates() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading]     = useState(true)
  const [deleting, setDeleting]   = useState<number | null>(null)

  const load = () => {
    setLoading(true)
    templatesApi.list()
      .then((r) => setTemplates(r.data as Template[]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleUseTemplate = (tpl: Template) => {
    // Navigate to planner with prompt pre-filled via URL state
    navigate('/planner', { state: { prompt: tpl.prompt, title: tpl.name } })
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this template?')) return
    setDeleting(id)
    try {
      await templatesApi.delete(id)
      setTemplates((prev) => prev.filter((t) => t.id !== id))
    } finally {
      setDeleting(null)
    }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div>
      <div style={s.header}>
        <div>
          <h2 style={s.title}>Templates</h2>
          <p style={s.sub}>{templates.length} saved template{templates.length !== 1 ? 's' : ''}</p>
        </div>
        <button style={s.newBtn} onClick={() => navigate('/planner')}>
          + New Plan
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : templates.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyTitle}>No templates yet</p>
          <p style={s.emptyHint}>
            Open any job and click <strong>Save as Template</strong> to reuse its prompt and structure.
          </p>
          <button style={s.emptyBtn} onClick={() => navigate('/planner')}>
            Create your first plan →
          </button>
        </div>
      ) : (
        <div style={s.grid}>
          {templates.map((tpl) => (
            <div key={tpl.id} style={s.card}>
              <div style={s.cardTop}>
                <h3 style={s.cardName}>{tpl.name}</h3>
                <span style={s.cardDate}>{fmtDate(tpl.created_at)}</span>
              </div>

              {tpl.description && (
                <p style={s.cardDesc}>{tpl.description}</p>
              )}

              <p style={s.cardPrompt}>
                {tpl.prompt.length > 150 ? `${tpl.prompt.slice(0, 150)}…` : tpl.prompt}
              </p>

              {tpl.plan_json?.platforms && tpl.plan_json.platforms.length > 0 && (
                <div style={s.tags}>
                  {tpl.plan_json.platforms.map((p) => (
                    <span key={p} style={s.tag}>{p}</span>
                  ))}
                </div>
              )}

              {tpl.plan_json?.steps && (
                <p style={s.stepCount}>
                  {tpl.plan_json.steps.length} steps
                  {tpl.plan_json.estimated_total_time ? ` · ${tpl.plan_json.estimated_total_time}` : ''}
                </p>
              )}

              <div style={s.cardActions}>
                <button style={s.useBtn} onClick={() => handleUseTemplate(tpl)}>
                  Use Template
                </button>
                <button
                  style={{ ...s.delBtn, opacity: deleting === tpl.id ? 0.5 : 1 }}
                  onClick={() => handleDelete(tpl.id)}
                  disabled={deleting === tpl.id}
                >
                  Delete
                </button>
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
  newBtn: {
    background: '#1E3D2A',
    color: '#F5F0E8',
    border: 'none',
    padding: '12px 24px',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
  empty:      { textAlign: 'center', padding: '80px 0' },
  emptyTitle: { fontSize: 18, fontWeight: 700, color: '#555', margin: '0 0 8px' },
  emptyHint:  { fontSize: 14, color: '#888', margin: '0 0 24px', lineHeight: 1.55 },
  emptyBtn:   { background: 'none', border: 'none', color: '#C89A2E', fontWeight: 700, fontSize: 15, cursor: 'pointer', textDecoration: 'underline' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
    border: '1px solid #ede9e0',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  cardTop:   { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardName:  { margin: 0, fontSize: 16, fontWeight: 800, color: '#1E3D2A', lineHeight: 1.3, flex: 1 },
  cardDate:  { fontSize: 11, color: '#bbb', flexShrink: 0, marginLeft: 8 },
  cardDesc:  { margin: 0, fontSize: 13, color: '#888', fontStyle: 'italic', lineHeight: 1.5 },
  cardPrompt:{ margin: 0, fontSize: 13, color: '#555', lineHeight: 1.6 },
  tags:      { display: 'flex', gap: 6, flexWrap: 'wrap' },
  tag:       { background: '#F5F0E8', color: '#1E3D2A', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600 },
  stepCount: { margin: 0, fontSize: 12, color: '#bbb' },
  cardActions: { display: 'flex', gap: 8, marginTop: 4 },
  useBtn: {
    flex: 1,
    padding: '10px',
    background: '#C89A2E',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  delBtn: {
    padding: '10px 16px',
    background: 'transparent',
    color: '#c0392b',
    border: '1px solid #f5c6c6',
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
