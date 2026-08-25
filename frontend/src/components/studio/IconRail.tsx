import { type CSSProperties } from 'react'
import {
  Film, Music, Type, Layers, LayoutTemplate, Shuffle, Palette, type LucideIcon,
} from 'lucide-react'
import { useStudio, type RailTool } from '../../contexts/StudioContext'

interface RailItem {
  key: RailTool
  icon: LucideIcon
  label: string
}

// Exactly the 7 categories from the locked reference (spec section 2). The remaining pre-existing
// tools (History, SEO, Publish, standalone Platform switcher) aren't dropped — they simply don't
// have a slot in this rail; Lower Thirds + Intro/Outro fold into "Elements" and Templates + the
// active brand summary fold into "Brand Kit" (see ToolPanel.tsx). Platform switching now lives
// only in the header.
const ITEMS: RailItem[] = [
  { key: 'video', icon: Film, label: 'Media' },
  { key: 'audio', icon: Music, label: 'Audio' },
  { key: 'text', icon: Type, label: 'Text' },
  { key: 'media', icon: Layers, label: 'Overlays' },
  { key: 'lower', icon: LayoutTemplate, label: 'Elements' },
  { key: 'effects', icon: Shuffle, label: 'Transitions' },
  { key: 'templates', icon: Palette, label: 'Brand Kit' },
]

export default function IconRail() {
  const { activeRailTool, setActiveRailTool } = useStudio()

  return (
    <nav style={s.root} aria-label="Studio tools">
      {ITEMS.map(item => {
        const active = activeRailTool === item.key
        const Icon = item.icon
        return (
          <button
            key={item.key}
            className="sgv-rail-item"
            data-active={active}
            onClick={() => setActiveRailTool(active ? null : item.key)}
            title={item.label}
            aria-label={item.label}
            aria-pressed={active}
          >
            <Icon size={22} />
            <span className="sgv-rail-label">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

const s: Record<string, CSSProperties> = {
  root: {
    width: 78, minWidth: 78, flexShrink: 0,
    background: 'var(--sg-bg-1)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '12px 0', overflowY: 'auto',
  },
}
