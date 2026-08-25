import { useEffect, useState, type CSSProperties } from 'react'
import {
  Film, Image as ImageIcon, Music2, Upload, Filter, Share2, LayoutGrid, List,
} from 'lucide-react'
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
import SEOPanel from './SEOPanel'
import PublishPanel from './PublishPanel'

const TITLES: Record<string, string> = {
  history: 'History', templates: 'Brand Kit',
  video: 'Media', image: 'Image', text: 'Text Overlays', audio: 'Audio Tracks',
  media: 'Overlays', effects: 'Transitions', lower: 'Elements', intro: 'Intro / Outro', platform: 'Platform',
  seo: 'SEO', publish: 'Publish',
}

const STATUS_COLOR: Record<string, string> = {
  done: '#2ecc71', running: '#e67e22', pending: '#95a5a6', failed: '#e74c3c',
}

export default function ToolPanel() {
  const { activeRailTool, setActiveRailTool } = useStudio()

  return (
    <aside className="sgv-left-panel sgv-collapsible" data-collapsed={!activeRailTool} style={s.panel}>
      {activeRailTool && (
        <>
          <div style={s.header}>
            <span style={s.title}>{TITLES[activeRailTool]}</span>
          </div>
          <div style={s.content}>
            {activeRailTool === 'history' && <HistoryContent />}
            {activeRailTool === 'templates' && <BrandKitPanel />}
            {activeRailTool === 'video' && <MediaLibrary />}
            {activeRailTool === 'image' && <ImageControls />}
            {activeRailTool === 'text' && <TextOverlayEditor />}
            {activeRailTool === 'audio' && <AudioTrackControls />}
            {activeRailTool === 'media' && <MediaOverlayEditor />}
            {activeRailTool === 'effects' && <EffectsPanel />}
            {activeRailTool === 'lower' && <ElementsPanel />}
            {activeRailTool === 'seo' && <SEOPanel />}
            {activeRailTool === 'publish' && <PublishPanel />}
          </div>
        </>
      )}
    </aside>
  )
}

const MEDIA_TABS = ['All', 'Video', 'Image', 'Audio'] as const

// Dev-only demo library (spec section 17) — purely presentational placeholder tiles so the
// panel reads correctly for visual approval. Never shown in production builds; the real
// clip list (VideoControls, unchanged) always renders underneath. Gradients stand in for real
// thumbnails since no actual frame/photo assets exist yet.
const DEMO_MEDIA: { name: string; kind: 'Video' | 'Image' | 'Audio'; duration: string; gradient: string }[] = [
  { name: 'Beach Drone.mp4', kind: 'Video', duration: '0:12', gradient: 'linear-gradient(135deg, #1e4a5f, #d4a56a)' },
  { name: 'Surfing.mp4', kind: 'Video', duration: '0:09', gradient: 'linear-gradient(135deg, #cf6b3f, #f4c34a)' },
  { name: 'Palm Trees.mp4', kind: 'Video', duration: '0:07', gradient: 'linear-gradient(135deg, #0f5c7a, #2a9d6f)' },
  { name: 'Happy Girl.mp4', kind: 'Video', duration: '0:05', gradient: 'linear-gradient(135deg, #b5495b, #e8935c)' },
  { name: 'Road Trip.mp4', kind: 'Video', duration: '0:14', gradient: 'linear-gradient(135deg, #2f5233, #86a05e)' },
  { name: 'Ocean View.mp4', kind: 'Video', duration: '0:10', gradient: 'linear-gradient(135deg, #145a7a, #5fb5c9)' },
]

function MediaLibrary() {
  const [tab, setTab] = useState<typeof MEDIA_TABS[number]>('All')
  const items = import.meta.env.DEV
    ? DEMO_MEDIA.filter(m => tab === 'All' || m.kind === tab)
    : []

  return (
    <div>
      <div style={s.mediaHeaderRow}>
        <div style={s.mediaTabs}>
          {MEDIA_TABS.map(t => (
            <button
              key={t}
              className="sgv-tab"
              data-active={tab === t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={s.mediaHeaderIcons}>
          <button className="sgv-btn sgv-btn--icon" style={s.smallIconBtn} title="Filter — coming soon">
            <Filter size={15} />
          </button>
          <button className="sgv-btn sgv-btn--icon" style={s.smallIconBtn} title="Share — coming soon">
            <Share2 size={15} />
          </button>
        </div>
      </div>

      <button className="sgv-btn" style={s.uploadBtn}>
        <Upload size={14} /> Upload Files
      </button>

      {items.length === 0 ? (
        <p style={s.empty}>No media yet. Upload files to build your library.</p>
      ) : (
        <div style={s.mediaGrid}>
          {items.map(m => (
            <div key={m.name} style={s.mediaCard} title={m.name}>
              <div style={{ ...s.mediaThumb, background: m.gradient }}>
                {m.kind === 'Video' && <Film size={18} color="rgba(255,255,255,0.85)" />}
                {m.kind === 'Image' && <ImageIcon size={18} color="rgba(255,255,255,0.85)" />}
                {m.kind === 'Audio' && <Music2 size={18} color="rgba(255,255,255,0.85)" />}
                <span style={s.durationBadge}>{m.duration}</span>
              </div>
              <span style={s.mediaName}>{m.name}</span>
            </div>
          ))}
        </div>
      )}

      <div style={s.mediaFooter}>
        <span style={s.mediaCount}>{items.length} items</span>
        <div style={s.mediaHeaderIcons}>
          <button className="sgv-btn sgv-btn--icon" style={{ ...s.smallIconBtn, ...s.viewToggleActive }} title="Grid view">
            <LayoutGrid size={14} />
          </button>
          <button className="sgv-btn sgv-btn--icon" style={s.smallIconBtn} disabled title="List view — coming soon">
            <List size={14} />
          </button>
        </div>
      </div>

      <div style={s.mediaDivider} />
      <div style={s.subheading}>Current Timeline Clips</div>
      <VideoControls />
    </div>
  )
}

// "Elements" (spec section 2/13) folds the pre-existing Lower Thirds and Intro/Outro tools —
// both untouched — into one left-library entry with a sub-tab switch.
function ElementsPanel() {
  const [tab, setTab] = useState<'lower' | 'intro'>('lower')
  return (
    <div>
      <div style={s.mediaTabs}>
        <button className="sgv-tab" data-active={tab === 'lower'} onClick={() => setTab('lower')}>Lower Thirds</button>
        <button className="sgv-tab" data-active={tab === 'intro'} onClick={() => setTab('intro')}>Intro &amp; Outro</button>
      </div>
      <div style={{ marginTop: 14 }}>
        {tab === 'lower' ? <LowerThirdBuilder /> : <IntroOutroBuilder />}
      </div>
    </div>
  )
}

// "Brand Kit" folds the pre-existing Templates browser (untouched) together with a compact
// active-brand summary.
function BrandKitPanel() {
  const { activeBrand } = useStudio()
  return (
    <div>
      {activeBrand && (
        <div style={s.brandSummary}>
          <span style={s.brandSummaryName}>{activeBrand.name}</span>
          {activeBrand.tone_of_voice && <span style={s.brandSummaryDesc}>{activeBrand.tone_of_voice}</span>}
        </div>
      )}
      <div style={s.subheading}>Templates</div>
      <TemplatesContent />
    </div>
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
    background: 'var(--panel-bg)', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0, height: 44,
  },
  title: { fontSize: 14, lineHeight: '20px', fontWeight: 600, color: 'var(--text-primary)' },
  content: { flex: 1, overflowY: 'auto', padding: 18 },

  mediaHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  mediaTabs: { display: 'flex', gap: 16, marginBottom: 4, borderBottom: '1px solid var(--border)', flex: 1 },
  mediaHeaderIcons: { display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 },
  smallIconBtn: { width: 28, height: 28 },
  viewToggleActive: { background: 'var(--sg-bg-4)', color: 'var(--sg-text-primary)' },
  uploadBtn: {
    width: '100%', height: 42, marginTop: 12, background: 'var(--sg-green-dark)',
    border: '1px solid #247A46', borderRadius: 8, color: 'var(--text-primary)',
  },
  mediaFooter: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)',
  },
  mediaCount: { fontSize: 11, color: 'var(--sg-text-muted)' },

  brandSummary: {
    display: 'flex', flexDirection: 'column', gap: 4, padding: 14,
    background: 'var(--panel-surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 18,
  },
  brandSummaryName: { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' },
  brandSummaryDesc: { fontSize: 11, color: 'var(--text-tertiary)' },
  mediaGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 },
  mediaCard: { display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' },
  mediaThumb: {
    position: 'relative', aspectRatio: '16 / 9', borderRadius: 7, overflow: 'hidden',
    border: '1px solid transparent', background: 'var(--sg-bg-4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute', left: 5, bottom: 5, background: 'rgba(0,0,0,0.72)', color: '#fff',
    fontSize: 10, padding: '2px 5px', borderRadius: 4,
  },
  mediaName: { fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  mediaDivider: { height: 1, background: 'var(--border)', margin: '20px 0 14px' },
  subheading: { fontSize: 12, lineHeight: '16px', fontWeight: 700, color: 'var(--sg-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 },

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
