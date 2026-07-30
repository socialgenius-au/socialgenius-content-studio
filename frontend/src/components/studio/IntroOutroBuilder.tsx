import { useState, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { IntroOutro } from '../../types'

const ANIMATIONS = ['fade', 'slide_up', 'zoom_in', 'split', 'rotate']

export default function IntroOutroBuilder() {
  const { intro, outro, setIntro, setOutro, activeBrand } = useStudio()
  const [tab, setTab] = useState<'intro' | 'outro'>('intro')

  const current = tab === 'intro' ? intro : outro
  const setCurrent = tab === 'intro' ? setIntro : setOutro

  const [form, setForm] = useState<Partial<IntroOutro>>({
    type: tab, duration: 4, animation: 'fade',
    tagline: activeBrand?.name ? `Powered by ${activeBrand.name}` : '',
    ctaText: '', socialHandles: '',
  })

  const save = () => {
    setCurrent({
      type: tab,
      duration: form.duration ?? 4,
      animation: form.animation ?? 'fade',
      tagline: form.tagline,
      ctaText: form.ctaText,
      socialHandles: form.socialHandles,
      logoUrl: activeBrand?.logo_url ?? undefined,
    })
    alert(`${tab.charAt(0).toUpperCase() + tab.slice(1)} saved!`)
  }

  const remove = () => setCurrent(null)

  return (
    <div style={s.root}>
      <div style={s.tabs}>
        <button style={{ ...s.tab, ...(tab === 'intro' ? s.tabActive : {}) }} onClick={() => setTab('intro')}>
          Intro
        </button>
        <button style={{ ...s.tab, ...(tab === 'outro' ? s.tabActive : {}) }} onClick={() => setTab('outro')}>
          Outro
        </button>
      </div>

      {current && (
        <div style={s.savedBanner}>
          <span>✓ {tab.charAt(0).toUpperCase() + tab.slice(1)} saved · {current.duration}s · {current.animation}</span>
          <button style={s.removeBtn} onClick={remove}>Remove</button>
        </div>
      )}

      <div style={s.form}>
        <div style={s.field}>
          <label style={s.label}>Duration (seconds)</label>
          <div style={s.durationBtns}>
            {[3, 4, 5].map(d => (
              <button
                key={d}
                style={{ ...s.durBtn, ...(form.duration === d ? s.durBtnActive : {}) }}
                onClick={() => setForm(p => ({ ...p, duration: d }))}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>

        {tab === 'intro' && (
          <div style={s.field}>
            <label style={s.label}>Tagline</label>
            <input
              style={s.input}
              placeholder="e.g. Empowering Australian businesses"
              value={form.tagline ?? ''}
              onChange={e => setForm(p => ({ ...p, tagline: e.target.value }))}
            />
          </div>
        )}

        {tab === 'outro' && (
          <>
            <div style={s.field}>
              <label style={s.label}>CTA Text</label>
              <input
                style={s.input}
                placeholder="e.g. Follow for more tips"
                value={form.ctaText ?? ''}
                onChange={e => setForm(p => ({ ...p, ctaText: e.target.value }))}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Social handles</label>
              <input
                style={s.input}
                placeholder="e.g. @socialgenius_au"
                value={form.socialHandles ?? ''}
                onChange={e => setForm(p => ({ ...p, socialHandles: e.target.value }))}
              />
            </div>
          </>
        )}

        <div style={s.field}>
          <label style={s.label}>Animation</label>
          <div style={s.chipRow}>
            {ANIMATIONS.map(a => (
              <button
                key={a}
                style={{ ...s.chip, ...(form.animation === a ? s.chipActive : {}) }}
                onClick={() => setForm(p => ({ ...p, animation: a }))}
              >
                {a.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Preview card */}
        <div style={s.preview}>
          <div style={s.previewScreen}>
            {activeBrand?.logo_url && (
              <img src={activeBrand.logo_url} alt="" style={s.previewLogo} />
            )}
            <span style={s.previewBrandName}>{activeBrand?.name ?? 'Brand Name'}</span>
            {tab === 'intro' && form.tagline && (
              <span style={s.previewTagline}>{form.tagline}</span>
            )}
            {tab === 'outro' && (
              <>
                {form.ctaText && <span style={s.previewCTA}>{form.ctaText}</span>}
                {form.socialHandles && <span style={s.previewHandles}>{form.socialHandles}</span>}
              </>
            )}
            <span style={s.previewDuration}>{form.duration}s</span>
          </div>
        </div>

        <div style={s.actions}>
          <button style={s.saveBtn} onClick={save}>
            Save {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
          {current && (
            <button style={s.applyBtn} onClick={() => alert(`${tab} will be ${tab === 'intro' ? 'prepended' : 'appended'} to your video on render`)}>
              {tab === 'intro' ? '⏮ Prepend' : 'Append ⏭'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: {},
  tabs: { display: 'flex', gap: 4, marginBottom: 10 },
  tab: {
    flex: 1, padding: '6px', border: '1px solid var(--border)', borderRadius: 6,
    fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--text-secondary)',
  },
  tabActive: { background: 'var(--brand-header)', color: 'var(--brand-header-text)', borderColor: 'var(--brand-header)' },

  savedBanner: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
    background: '#d4edda', border: '1px solid #2ecc71', borderRadius: 6,
    fontSize: 11, color: '#155724', marginBottom: 10,
  },
  removeBtn: {
    marginLeft: 'auto', background: 'none', border: 'none',
    color: '#e74c3c', fontSize: 11, cursor: 'pointer', fontWeight: 700,
  },

  form: { background: 'var(--panel-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 },
  field: { marginBottom: 10 },
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 },
  input: {
    width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 5,
    fontSize: 12, boxSizing: 'border-box', background: 'var(--input-bg)', color: 'var(--text-primary)',
  },
  durationBtns: { display: 'flex', gap: 6 },
  durBtn: {
    flex: 1, padding: '6px', border: '1px solid var(--border)', borderRadius: 5,
    fontSize: 12, cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--text-primary)',
  },
  durBtnActive: { background: 'var(--brand-header)', color: 'var(--brand-header-text)', borderColor: 'var(--brand-header)' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  chip: { padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11, cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--text-secondary)' },
  chipActive: { background: 'var(--brand-header)', color: 'var(--brand-header-text)', borderColor: 'var(--brand-header)' },

  preview: { marginBottom: 10 },
  previewScreen: {
    background: '#1a1a1a', borderRadius: 6, padding: '20px 16px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    position: 'relative',
  },
  previewLogo: { width: 40, height: 40, objectFit: 'contain', borderRadius: 4 },
  previewBrandName: { color: '#F5F0E8', fontSize: 14, fontWeight: 800 },
  previewTagline: { color: '#C89A2E', fontSize: 10, textAlign: 'center' },
  previewCTA: { color: '#C89A2E', fontSize: 12, fontWeight: 700, textAlign: 'center' },
  previewHandles: { color: '#888', fontSize: 10 },
  previewDuration: {
    position: 'absolute', top: 6, right: 10, fontSize: 10,
    color: '#666', fontFamily: 'monospace',
  },

  actions: { display: 'flex', gap: 8 },
  saveBtn: {
    flex: 1, padding: '8px', background: 'var(--brand-header)', color: 'var(--brand-header-text)',
    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  applyBtn: {
    flex: 1, padding: '8px', background: 'var(--brand-accent)', color: 'var(--brand-accent-text)',
    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
}
