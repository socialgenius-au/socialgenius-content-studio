import { type CSSProperties } from 'react'
import { useStudio, type RailTool } from '../../contexts/StudioContext'

interface RailItem {
  key: RailTool
  icon: string
  label: string
}

interface RailGroup {
  items: RailItem[]
}

const GROUPS: RailGroup[] = [
  { items: [
    { key: 'history', icon: '🕘', label: 'History' },
    { key: 'templates', icon: '🗂️', label: 'Templates' },
  ] },
  { items: [
    { key: 'video', icon: '🎬', label: 'Video' },
    { key: 'image', icon: '🖼️', label: 'Image' },
    { key: 'text', icon: '🔤', label: 'Text' },
    { key: 'audio', icon: '🎵', label: 'Audio' },
    { key: 'media', icon: '⊕', label: 'Overlay' },
    { key: 'lower', icon: '🏷️', label: 'Lower Third' },
    { key: 'intro', icon: '⏮', label: 'Intro/Outro' },
    { key: 'platform', icon: '📱', label: 'Platform' },
  ] },
  { items: [
    { key: 'seo', icon: '🔍', label: 'SEO' },
    { key: 'publish', icon: '🚀', label: 'Publish' },
  ] },
]

export default function IconRail() {
  const { activeRailTool, setActiveRailTool } = useStudio()

  return (
    <nav style={s.root} aria-label="Studio tools">
      {GROUPS.map((group, gi) => (
        <div key={gi} style={s.group}>
          {group.items.map(item => {
            const active = activeRailTool === item.key
            return (
              <button
                key={item.key}
                style={{ ...s.btn, ...(active ? s.btnActive : {}) }}
                onClick={() => setActiveRailTool(active ? null : item.key)}
                title={item.label}
                aria-label={item.label}
                aria-pressed={active}
              >
                <span style={s.icon}>{item.icon}</span>
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

const s: Record<string, CSSProperties> = {
  root: {
    width: 60, minWidth: 60, flexShrink: 0,
    background: 'var(--panel-bg)', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: 'var(--space-2) 0', gap: 'var(--space-4)', overflowY: 'auto',
  },
  group: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', width: '100%', alignItems: 'center' },
  btn: {
    width: 44, height: 44, border: 'none', borderRadius: 10,
    background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.15s, color 0.15s',
  },
  btnActive: { background: 'var(--brand-header)', color: 'var(--brand-header-text)' },
  icon: { fontSize: 18, lineHeight: 1 },
}
