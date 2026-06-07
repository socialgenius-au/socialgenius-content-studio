import { useState, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { SEOPackage } from '../../types'

type SeoField = {
  key: keyof SEOPackage
  label: string
  platform: string
  multiline?: boolean
}

const SEO_FIELDS: SeoField[] = [
  { key: 'instagramCaption', label: 'Caption', platform: 'Instagram', multiline: true },
  { key: 'instagramHashtags', label: 'Hashtags', platform: 'Instagram' },
  { key: 'instagramGeotag', label: 'Geotag', platform: 'Instagram' },
  { key: 'youtubeTitle', label: 'Title', platform: 'YouTube' },
  { key: 'youtubeDescription', label: 'Description', platform: 'YouTube', multiline: true },
  { key: 'youtubeTags', label: 'Tags', platform: 'YouTube' },
  { key: 'youtubeChapters', label: 'Chapters', platform: 'YouTube', multiline: true },
  { key: 'tiktokCaption', label: 'Caption', platform: 'TikTok', multiline: true },
  { key: 'tiktokTrendingSound', label: 'Trending Sound', platform: 'TikTok' },
  { key: 'gmbPost', label: 'GMB Post', platform: 'Google Business', multiline: true },
]

export default function SEOPanel() {
  const { seoPackage, setSeoPackage } = useStudio()
  const [copied, setCopied] = useState<string | null>(null)
  const [activePlatform, setActivePlatform] = useState('Instagram')

  const platforms = [...new Set(SEO_FIELDS.map(f => f.platform))]

  const copy = (key: keyof SEOPackage) => {
    const val = seoPackage?.[key]
    if (!val) return
    navigator.clipboard.writeText(val).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const updateField = (key: keyof SEOPackage, value: string) => {
    setSeoPackage({ ...(seoPackage ?? {}), [key]: value })
  }

  const visibleFields = SEO_FIELDS.filter(f => f.platform === activePlatform)

  return (
    <div style={s.root}>
      {/* Platform tabs */}
      <div style={s.platformTabs}>
        {platforms.map(p => (
          <button
            key={p}
            style={{ ...s.platformTab, ...(activePlatform === p ? s.platformTabActive : {}) }}
            onClick={() => setActivePlatform(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {!seoPackage ? (
        <div style={s.empty}>
          <p>SEO content will auto-generate here when you create or publish content.</p>
          <p>Or chat below: "generate SEO for Instagram"</p>
        </div>
      ) : (
        <div style={s.fields}>
          {visibleFields.map(field => {
            const val = seoPackage[field.key] ?? ''
            return (
              <div key={field.key} style={s.fieldGroup}>
                <div style={s.fieldHeader}>
                  <span style={s.fieldLabel}>{field.label}</span>
                  <button
                    style={{ ...s.copyBtn, ...(copied === field.key ? s.copyBtnDone : {}) }}
                    onClick={() => copy(field.key)}
                    disabled={!val}
                  >
                    {copied === field.key ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                {field.multiline ? (
                  <textarea
                    style={s.textarea}
                    value={val}
                    onChange={e => updateField(field.key, e.target.value)}
                    rows={4}
                    placeholder={`${field.platform} ${field.label}…`}
                  />
                ) : (
                  <input
                    style={s.input}
                    value={val}
                    onChange={e => updateField(field.key, e.target.value)}
                    placeholder={`${field.platform} ${field.label}…`}
                  />
                )}
                {field.key === 'instagramHashtags' && val && (
                  <span style={s.hashtagCount}>
                    {val.split('#').filter(Boolean).length} hashtags
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: {},
  platformTabs: {
    display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12,
    borderBottom: '1px solid #e8e3d8', paddingBottom: 8,
  },
  platformTab: {
    padding: '4px 10px', border: '1px solid #ddd', borderRadius: 10,
    fontSize: 11, cursor: 'pointer', background: '#fff', color: '#555',
  },
  platformTabActive: { background: '#1E3D2A', color: '#F5F0E8', borderColor: '#1E3D2A' },

  empty: { color: '#aaa', fontSize: 12, textAlign: 'center', padding: '16px 0', lineHeight: 1.8 },

  fields: { display: 'flex', flexDirection: 'column', gap: 12 },
  fieldGroup: {},
  fieldHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: '#1E3D2A', textTransform: 'uppercase', letterSpacing: 0.5 },
  copyBtn: {
    padding: '2px 8px', border: '1px solid #ddd', borderRadius: 4,
    fontSize: 10, cursor: 'pointer', background: '#fff', color: '#555',
  },
  copyBtnDone: { background: '#2ecc71', color: '#fff', borderColor: '#2ecc71' },
  textarea: {
    width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 5,
    fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
    lineHeight: 1.5,
  },
  input: {
    width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 5,
    fontSize: 12, boxSizing: 'border-box',
  },
  hashtagCount: { fontSize: 10, color: '#888', marginTop: 2, display: 'block' },
}
