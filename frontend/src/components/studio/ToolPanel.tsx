import { useEffect, useState, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import { templatesApi, jobsApi } from '../../api/client'
import type { Template, Job, Asset } from '../../types'
import VideoControls from './VideoControls'
import ImageControls from './ImageControls'
import TextOverlayEditor from './TextOverlayEditor'
import AudioTrackControls from './AudioTrackControls'
import MediaOverlayEditor from './MediaOverlayEditor'
import EffectsPanel from './EffectsPanel'
import LowerThirdBuilder from './LowerThirdBuilder'
import IntroOutroBuilder from './IntroOutroBuilder'
import PlatformSwitcher from './PlatformSwitcher'
import SEOPanel from './SEOPanel'
import PublishPanel from './PublishPanel'

const TITLES: Record<string, string> = {
  history: 'History', templates: 'Templates',
  video: 'Video', image: 'Image', text: 'Text Overlays', audio: 'Audio Tracks',
  media: 'Media Overlay', effects: 'Effects', lower: 'Lower Thirds', intro: 'Intro / Outro', platform: 'Platform',
  seo: 'SEO', publish: 'Publish',
}

const STATUS_COLOR: Record<string, string> = {
  done: '#2ecc71', running: '#e67e22', pending: '#95a5a6', failed: '#e74c3c',
}

export default function ToolPanel() {
  const { activeRailTool, setActiveRailTool } = useStudio()

  if (!activeRailTool) return null

  return (
    <aside style={s.panel}>
      <div style={s.header}>
        <span style={s.title}>{TITLES[activeRailTool]}</span>
        <button style={s.closeBtn} onClick={() => setActiveRailTool(null)} title="Collapse panel" aria-label="Collapse panel">
          ‹
        </button>
      </div>
      <div style={s.content}>
        {activeRailTool === 'history' && <HistoryContent />}
        {activeRailTool === 'templates' && <TemplatesContent />}
        {activeRailTool === 'video' && <VideoControls />}
        {activeRailTool === 'image' && <ImageControls />}
        {activeRailTool === 'text' && <TextOverlayEditor />}
        {activeRailTool === 'audio' && <AudioTrackControls />}
        {activeRailTool === 'media' && <MediaOverlayEditor />}
        {activeRailTool === 'effects' && <EffectsPanel />}
        {activeRailTool === 'lower' && <LowerThirdBuilder />}
        {activeRailTool === 'intro' && <IntroOutroBuilder />}
        {activeRailTool === 'platform' && <PlatformSwitcher />}
        {activeRailTool === 'seo' && <SEOPanel />}
        {activeRailTool === 'publish' && <PublishPanel />}
      </div>
    </aside>
  )
}

function TemplatesContent() {
  const { templates, setTemplates } = useStudio()
  const [favourites, setFavourites] = useState<Set<number>>(new Set())
  const [templateCategory, setTemplateCategory] = useState('all')

  const CATEGORIES = ['all', 'Posts', 'Carousels', 'Reels', 'Thumbnails', 'Flyers', 'Intros', 'Outros', 'Lower Thirds', 'Text Overlays', 'Audio Beds']

  useEffect(() => {
    templatesApi.list().then(r => setTemplates(r.data as Template[])).catch(() => {})
  }, [])

  const toggleFavourite = (id: number) => {
    setFavourites(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const applyTemplate = (t: Template) => alert(`Applying template: ${t.name}`)

  const filteredTemplates = templates.filter(t => {
    if (templateCategory === 'all') return true
    return t.description?.toLowerCase().includes(templateCategory.toLowerCase())
  })

  const sortedTemplates = [
    ...filteredTemplates.filter(t => favourites.has(t.id)),
    ...filteredTemplates.filter(t => !favourites.has(t.id)),
  ]

  return (
    <div>
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
              <button style={s.applyBtn} onClick={() => applyTemplate(t)}>Apply</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HistoryContent() {
  const { recentJobs, setRecentJobs, activeJob, setActiveJob } = useStudio()
  const [jobAssets, setJobAssets] = useState<Record<number, Asset[]>>({})

  useEffect(() => {
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
    } catch { /* noop */ }
  }

  return (
    <div>
      {recentJobs.length === 0 ? (
        <p style={s.empty}>No jobs yet.</p>
      ) : recentJobs.map(job => (
        <div
          key={job.id}
          style={{ ...s.jobCard, ...(activeJob?.id === job.id ? s.jobCardActive : {}) }}
          onClick={() => { setActiveJob(job); loadJobAssets(job.id) }}
        >
          <div style={s.jobHeader}>
            <span style={s.jobTitle}>{job.title}</span>
            {activeJob?.id === job.id && <span style={s.activeBadge}>Active</span>}
            <span style={{ ...s.jobStatus, background: STATUS_COLOR[job.status] }}>{job.status}</span>
          </div>
          <span style={s.jobDate}>{new Date(job.created_at).toLocaleDateString()}</span>

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
  )
}

const s: Record<string, CSSProperties> = {
  panel: {
    width: 300, minWidth: 300, background: 'var(--panel-bg)', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)', flexShrink: 0,
  },
  title: { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' },
  closeBtn: {
    background: 'none', border: 'none', fontSize: 16, cursor: 'pointer',
    color: 'var(--text-tertiary)', padding: 'var(--space-1) var(--space-2)', borderRadius: 4,
  },
  content: { flex: 1, overflowY: 'auto', padding: 'var(--space-4)' },

  catSelect: {
    width: '100%', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: 12, marginBottom: 'var(--space-3)', background: 'var(--input-bg)', color: 'var(--text-primary)',
  },
  templateGrid: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  templateCard: {
    border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
    cursor: 'pointer', background: 'var(--panel-surface)',
  },
  templateThumb: {
    height: 60, background: 'linear-gradient(135deg, #1E3D2A22, #C89A2E22)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  thumbIcon: { fontSize: 24 },
  templateInfo: { padding: 'var(--space-2) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 2 },
  templateName: { fontSize: 12, fontWeight: 700, color: 'var(--brand-header)' },
  templateDesc: { fontSize: 10, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  templateActions: { display: 'flex', alignItems: 'center', padding: 'var(--space-1) var(--space-3) var(--space-3)', gap: 'var(--space-2)' },
  starBtn: { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--brand-accent)', padding: 0 },
  applyBtn: {
    flex: 1, background: 'var(--brand-header)', color: 'var(--brand-header-text)', border: 'none',
    borderRadius: 5, padding: 'var(--space-1) var(--space-2)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
  },
  empty: { color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center', padding: 'var(--space-6) var(--space-2)' },

  jobCard: {
    background: 'var(--panel-surface)', border: '1px solid var(--border)', borderRadius: 8,
    padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-2)', cursor: 'pointer',
    transition: 'background 0.15s',
  },
  jobCardActive: { borderColor: 'var(--brand-accent)', boxShadow: '0 0 0 1px var(--brand-accent)' },
  activeBadge: {
    fontSize: 9, fontWeight: 700, color: 'var(--brand-accent)', textTransform: 'uppercase',
    letterSpacing: 0.4, flexShrink: 0,
  },
  jobHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 3 },
  jobTitle: { fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  jobStatus: {
    fontSize: 9, fontWeight: 700, color: '#fff', padding: '2px var(--space-2)',
    borderRadius: 10, textTransform: 'uppercase', flexShrink: 0,
  },
  jobDate: { fontSize: 10, color: 'var(--text-tertiary)' },
  assetRow: { display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-2)' },
  assetThumb: {
    width: 28, height: 28, borderRadius: 4, background: 'var(--canvas-surface)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, color: 'var(--text-secondary)',
  },
}
