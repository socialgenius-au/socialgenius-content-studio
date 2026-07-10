import { useEffect, useState, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import { templatesApi, jobsApi, assetsApi } from '../../api/client'
import type { Template, Job, Asset } from '../../types'

export default function LeftPanel() {
  const {
    leftPanelOpen, leftPanelTab, setLeftPanelOpen, setLeftPanelTab,
    templates, setTemplates, recentJobs, setRecentJobs,
    activeBrand, addVideoClip, addImageSlide, setPreviewUrl,
  } = useStudio()

  const [jobAssets, setJobAssets] = useState<Record<number, Asset[]>>({})
  const [favourites, setFavourites] = useState<Set<number>>(new Set())
  const [templateCategory, setTemplateCategory] = useState('all')

  const CATEGORIES = ['all', 'Posts', 'Carousels', 'Reels', 'Thumbnails', 'Flyers', 'Intros', 'Outros', 'Lower Thirds', 'Text Overlays', 'Audio Beds']

  useEffect(() => {
    templatesApi.list().then(r => setTemplates(r.data as Template[])).catch(() => {})
    jobsApi.list().then(r => {
      const jobs = r.data as Job[]
      setRecentJobs(jobs.slice(0, 20))
    }).catch(() => {})
  }, [])

  const loadJobAssets = async (jobId: number) => {
    if (jobAssets[jobId]) return
    try {
      const r = await jobsApi.getAssets(jobId)
      setJobAssets(p => ({ ...p, [jobId]: r.data as Asset[] }))
    } catch {}
  }

  const toggleFavourite = (id: number) => {
    setFavourites(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const applyTemplate = (t: Template) => {
    alert(`Applying template: ${t.name}`)
  }

  const filteredTemplates = templates.filter(t => {
    if (templateCategory === 'all') return true
    return t.description?.toLowerCase().includes(templateCategory.toLowerCase())
  })

  const sortedTemplates = [
    ...filteredTemplates.filter(t => favourites.has(t.id)),
    ...filteredTemplates.filter(t => !favourites.has(t.id)),
  ]

  if (!leftPanelOpen) {
    return (
      <div style={s.collapsed}>
        <button style={s.toggleBtn} onClick={() => setLeftPanelOpen(true)} title="Open panel">
          ›
        </button>
      </div>
    )
  }

  return (
    <aside style={s.panel}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.tabs}>
          <button
            style={{ ...s.tab, ...(leftPanelTab === 'history' ? s.tabActive : {}) }}
            onClick={() => setLeftPanelTab('history')}
          >
            History
          </button>
          <button
            style={{ ...s.tab, ...(leftPanelTab === 'templates' ? s.tabActive : {}) }}
            onClick={() => setLeftPanelTab('templates')}
          >
            Templates
          </button>
        </div>
        <button style={s.collapseBtn} onClick={() => setLeftPanelOpen(false)}>‹</button>
      </div>

      {/* Template Library */}
      {leftPanelTab === 'templates' && (
        <div style={s.content}>
          <select
            style={s.catSelect}
            value={templateCategory}
            onChange={e => setTemplateCategory(e.target.value)}
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>
            ))}
          </select>

          <div style={s.templateGrid}>
            {sortedTemplates.length === 0 ? (
              <p style={s.empty}>No templates yet. Save a finished design to create one.</p>
            ) : sortedTemplates.map(t => (
              <div key={t.id} style={s.templateCard}>
                <div style={s.templateThumb}>
                  <span style={s.thumbIcon}>📄</span>
                </div>
                <div style={s.templateInfo}>
                  <span style={s.templateName}>{t.name}</span>
                  {t.description && <span style={s.templateDesc}>{t.description}</span>}
                </div>
                <div style={s.templateActions}>
                  <button
                    style={s.starBtn}
                    onClick={() => toggleFavourite(t.id)}
                    title={favourites.has(t.id) ? 'Unstar' : 'Star'}
                  >
                    {favourites.has(t.id) ? '★' : '☆'}
                  </button>
                  <button style={s.applyBtn} onClick={() => applyTemplate(t)}>
                    Apply
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Job History */}
      {leftPanelTab === 'history' && (
        <div style={s.content}>
          {recentJobs.length === 0 ? (
            <p style={s.empty}>No jobs yet.</p>
          ) : recentJobs.map(job => (
            <div
              key={job.id}
              style={s.jobCard}
              onClick={() => loadJobAssets(job.id)}
            >
              <div style={s.jobHeader}>
                <span style={s.jobTitle}>{job.title}</span>
                <span style={{ ...s.jobStatus, background: STATUS_COLOR[job.status] }}>
                  {job.status}
                </span>
              </div>
              <span style={s.jobDate}>{new Date(job.created_at).toLocaleDateString()}</span>

              {/* Assets from job */}
              {jobAssets[job.id] && (
                <div style={s.assetRow}>
                  {jobAssets[job.id].slice(0, 3).map(a => (
                    <div key={a.id} style={s.assetThumb} title={a.original_filename}>
                      {a.file_type === 'video' ? '🎬' : a.file_type === 'image' ? '🖼️' : '🎵'}
                    </div>
                  ))}
                  {jobAssets[job.id].length > 3 && (
                    <div style={s.assetThumb}>+{jobAssets[job.id].length - 3}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

const STATUS_COLOR: Record<string, string> = {
  done: '#2ecc71', running: '#e67e22', pending: '#95a5a6', failed: '#e74c3c',
}

const s: Record<string, CSSProperties> = {
  panel: {
    width: '15vw', minWidth: '15vw', background: '#fff', borderRight: '1px solid #e8e3d8',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  collapsed: {
    width: 28, background: '#fff', borderRight: '1px solid #e8e3d8',
    display: 'flex', alignItems: 'flex-start', paddingTop: 12,
  },
  toggleBtn: {
    background: 'none', border: 'none', fontSize: 18, cursor: 'pointer',
    color: '#1E3D2A', padding: '4px 6px', borderRadius: 4,
  },
  header: {
    display: 'flex', alignItems: 'center', borderBottom: '1px solid #e8e3d8',
    padding: '0 4px', gap: 4,
  },
  tabs: { display: 'flex', flex: 1, gap: 2, padding: '6px 0' },
  tab: {
    flex: 1, padding: '6px 4px', border: 'none', background: 'transparent',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 6, color: '#666',
  },
  tabActive: { background: '#1E3D2A', color: '#F5F0E8' },
  collapseBtn: {
    background: 'none', border: 'none', fontSize: 16, cursor: 'pointer',
    color: '#999', padding: '4px 6px',
  },
  content: { flex: 1, overflowY: 'auto', padding: 10 },
  catSelect: {
    width: '100%', padding: '6px 8px', border: '1px solid #e0dbd0',
    borderRadius: 6, fontSize: 12, marginBottom: 10, background: '#F5F0E8',
  },
  templateGrid: { display: 'flex', flexDirection: 'column', gap: 8 },
  templateCard: {
    border: '1px solid #e8e3d8', borderRadius: 8, overflow: 'hidden',
    cursor: 'pointer', background: '#fafaf8',
  },
  templateThumb: {
    height: 60, background: 'linear-gradient(135deg, #1E3D2A22, #C89A2E22)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  thumbIcon: { fontSize: 24 },
  templateInfo: { padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 },
  templateName: { fontSize: 12, fontWeight: 700, color: '#1E3D2A' },
  templateDesc: { fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  templateActions: { display: 'flex', alignItems: 'center', padding: '4px 8px 8px', gap: 6 },
  starBtn: {
    background: 'none', border: 'none', fontSize: 16, cursor: 'pointer',
    color: '#C89A2E', padding: 0,
  },
  applyBtn: {
    flex: 1, background: '#1E3D2A', color: '#F5F0E8', border: 'none',
    borderRadius: 5, padding: '4px 8px', fontSize: 11, fontWeight: 700,
    cursor: 'pointer',
  },
  empty: { color: '#aaa', fontSize: 12, textAlign: 'center', padding: '24px 8px' },

  jobCard: {
    background: '#fafaf8', border: '1px solid #e8e3d8', borderRadius: 8,
    padding: '8px 10px', marginBottom: 8, cursor: 'pointer',
    transition: 'background 0.15s',
  },
  jobHeader: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 },
  jobTitle: { fontSize: 12, fontWeight: 700, color: '#1a1a1a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  jobStatus: {
    fontSize: 9, fontWeight: 700, color: '#fff', padding: '2px 6px',
    borderRadius: 10, textTransform: 'uppercase', flexShrink: 0,
  },
  jobDate: { fontSize: 10, color: '#aaa' },
  assetRow: { display: 'flex', gap: 4, marginTop: 6 },
  assetThumb: {
    width: 28, height: 28, borderRadius: 4, background: '#e8e3d8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, color: '#666',
  },
}
