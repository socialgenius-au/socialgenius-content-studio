import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Clapperboard, Pencil, Undo2, Redo2, ChevronDown, Download,
  Square, RectangleVertical, RectangleHorizontal, type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useStudio } from '../../contexts/StudioContext'
import { brandsApi } from '../../api/client'
import { PLATFORMS } from '../../utils/platforms'
import type { Brand, Platform } from '../../types'

function ratioIcon(aspectRatio: string): LucideIcon {
  if (aspectRatio === '1/1') return Square
  const [w, h] = aspectRatio.split('/').map(Number)
  return w >= h ? RectangleHorizontal : RectangleVertical
}

export default function TopBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const {
    activeBrand, brands, setBrands, setActiveBrand, uploadProgress,
    platform, setPlatform, activeJob,
  } = useStudio()
  const [editingName, setEditingName] = useState(false)
  const [projectName, setProjectName] = useState(() => activeJob?.title || (import.meta.env.DEV ? 'Summer Campaign Reel' : 'Untitled Project'))

  useEffect(() => {
    brandsApi.list().then(r => {
      const data = r.data as Brand[]
      setBrands(data)
      if (data.length && !activeBrand) setActiveBrand(data[0])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (activeJob?.title) setProjectName(activeJob.title)
  }, [activeJob?.title])

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <header className="sgv-header" style={s.bar}>
      {/* Column 1 — brand / title area */}
      <div style={s.brandCol}>
        <div style={s.wordmark}>
          <div style={s.logoIcon}><Clapperboard size={18} color="#07120F" /></div>
          <div style={s.wordmarkText}>
            <span style={s.logoName}>SocialGenius</span>
            <span style={s.logoSub}>Content Studio</span>
          </div>
        </div>

        <div style={s.divider} />

        <div style={s.editorLabel}>
          <Clapperboard size={22} color="var(--sg-green)" />
          <div style={s.editorLabelText}>
            <span style={s.editorTitle}>Video Editor</span>
            <span style={s.editorSubtitle}>Create. Edit. Publish.</span>
          </div>
        </div>
      </div>

      {/* Column 2 — project name */}
      <div style={s.projectCol}>
        <span style={s.projectLabel}>Project Name</span>
        <div style={s.projectValueRow}>
          {editingName ? (
            <input
              autoFocus
              className="sgv-input"
              style={s.projectInput}
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              onBlur={() => setEditingName(false)}
              onKeyDown={e => { if (e.key === 'Enter') setEditingName(false) }}
            />
          ) : (
            <>
              <span style={s.projectValue}>{projectName}</span>
              <button style={s.pencilBtn} onClick={() => setEditingName(true)} title="Rename project" aria-label="Rename project">
                <Pencil size={14} />
              </button>
            </>
          )}
          {brands.length > 0 && (
            <select
              className="sgv-select"
              style={s.brandSelect}
              value={activeBrand?.id ?? ''}
              onChange={e => {
                const b = brands.find(b => b.id === Number(e.target.value))
                setActiveBrand(b ?? null)
              }}
              title="Active brand"
            >
              <option value="">No brand</option>
              {brands.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Column 3 — platform selector */}
      <div style={s.platformCol}>
        <span style={s.projectLabel}>Platform</span>
        <div style={s.platformSelectorWrap}>
          {(() => { const Icon = ratioIcon(PLATFORMS[platform].aspectRatio); return <Icon size={16} color="var(--sg-text-secondary)" style={s.platformIcon} /> })()}
          <select
            className="sgv-select"
            style={s.platformSelect}
            value={platform}
            onChange={e => setPlatform(e.target.value as Platform)}
          >
            {Object.entries(PLATFORMS).map(([key, spec]) => (
              <option key={key} value={key}>{spec.label} ({spec.aspectRatio.replace('/', ':')})</option>
            ))}
          </select>
          <ChevronDown size={14} color="var(--sg-text-muted)" style={s.platformChevron} />
        </div>
        {uploadProgress !== null && (
          <div style={s.uploadBar}>
            <div style={{ ...s.uploadFill, width: `${uploadProgress}%` }} />
            <span style={s.uploadLabel}>Uploading {uploadProgress}%</span>
          </div>
        )}
      </div>

      {/* Column 4 — actions */}
      <div style={s.actionsCol}>
        <button className="sgv-btn sgv-btn--icon" disabled title="Undo — coming soon" aria-label="Undo">
          <Undo2 size={16} />
        </button>
        <button className="sgv-btn sgv-btn--icon" disabled title="Redo — coming soon" aria-label="Redo">
          <Redo2 size={16} />
        </button>

        <button className="sgv-btn sgv-btn--outline" style={s.saveDraftBtn} onClick={() => alert('Draft saved')}>
          Save Draft
        </button>
        <button className="sgv-btn sgv-btn--solid-green" onClick={() => alert('Export coming soon')}>
          <Download size={14} /> Export
        </button>

        <div style={s.userBadgeWrap}>
          <span style={s.avatar}>{user?.username?.[0]?.toUpperCase()}</span>
          <ChevronDown size={14} color="var(--sg-text-muted)" />
        </div>
        <button style={s.signOut} onClick={handleLogout}>Sign out</button>
      </div>
    </header>
  )
}

const s: Record<string, CSSProperties> = {
  bar: {
    background: 'var(--sg-bg-1)',
    borderBottom: '1px solid var(--sg-border)',
    display: 'grid',
    gridTemplateColumns: 'auto minmax(160px, 1fr) 250px auto',
    alignItems: 'center',
    gap: 20,
    padding: '0 24px',
    flexShrink: 0,
  },

  brandCol: { display: 'flex', alignItems: 'center', gap: 20, minWidth: 0 },
  wordmark: { display: 'flex', alignItems: 'center' },
  logoIcon: {
    width: 36, height: 36, borderRadius: 8, background: 'var(--sg-green)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0,
  },
  wordmarkText: { display: 'flex', flexDirection: 'column', lineHeight: 1.2, gap: 1 },
  logoName: { color: 'var(--sg-text-primary)', fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px' },
  logoSub: { color: 'var(--sg-gold)', fontSize: 9, fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase' },

  divider: { width: 1, height: 32, background: 'var(--sg-border)', flexShrink: 0 },

  editorLabel: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  editorLabelText: { display: 'flex', flexDirection: 'column', lineHeight: 1.3, gap: 0, minWidth: 0 },
  editorTitle: { fontSize: 18, lineHeight: '24px', fontWeight: 700, color: 'var(--sg-text-primary)', whiteSpace: 'nowrap' },
  editorSubtitle: { fontSize: 12, color: 'var(--sg-text-muted)', whiteSpace: 'nowrap' },

  projectCol: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  projectLabel: { fontSize: 11, lineHeight: '14px', fontWeight: 500, color: 'var(--sg-text-muted)' },
  projectValueRow: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  projectValue: { fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var(--sg-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  projectInput: { width: 200, height: 28, fontSize: 13, fontWeight: 600 },
  pencilBtn: {
    background: 'none', border: 'none', color: 'var(--sg-text-disabled)', cursor: 'pointer',
    padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0,
  },
  brandSelect: {
    marginLeft: 'auto', height: 28, fontSize: 11, padding: '0 8px', background: 'var(--sg-bg-2)',
    color: 'var(--sg-text-secondary)', maxWidth: 150,
  },

  platformCol: { display: 'flex', flexDirection: 'column', gap: 6 },
  platformSelectorWrap: { position: 'relative', width: 240, height: 42 },
  platformIcon: { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' },
  platformSelect: {
    width: '100%', height: 42, background: 'var(--sg-bg-3)', border: '1px solid var(--sg-border)',
    color: 'var(--sg-text-primary)', fontSize: 13, fontWeight: 500, paddingLeft: 36, paddingRight: 30, appearance: 'none',
  },
  platformChevron: { position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' },

  uploadBar: {
    position: 'relative', width: 240, height: 20, background: 'var(--sg-bg-3)',
    borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center',
  },
  uploadFill: {
    position: 'absolute', left: 0, top: 0, height: '100%',
    background: 'var(--sg-green)', borderRadius: 10, transition: 'width 0.3s',
  },
  uploadLabel: {
    position: 'relative', zIndex: 1, fontSize: 10, fontWeight: 700,
    color: 'var(--sg-bg-0)', width: '100%', textAlign: 'center',
  },

  actionsCol: { display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'end' },
  saveDraftBtn: { borderColor: 'var(--sg-green-dark)', color: 'var(--sg-green)' },
  userBadgeWrap: { display: 'flex', alignItems: 'center', gap: 2, marginLeft: 4 },
  avatar: {
    width: 36, height: 36, borderRadius: '50%', background: 'var(--sg-green-dark)',
    color: 'var(--sg-text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, flexShrink: 0,
  },
  signOut: {
    background: 'transparent', border: '1px solid var(--sg-border-strong)',
    color: 'var(--sg-text-secondary)', borderRadius: 8, padding: '0 12px', height: 36,
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
}
