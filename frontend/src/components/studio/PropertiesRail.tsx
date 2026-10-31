import { type CSSProperties } from 'react'
import {
  SlidersHorizontal, Music, Gauge, Shuffle, Wand2, SunMedium, Sparkles, type LucideIcon,
} from 'lucide-react'

export type RightRailTab = 'properties' | 'audio' | 'speed' | 'transitions' | 'filters' | 'adjust' | 'ai'

interface RailItem {
  key: RightRailTab
  icon: LucideIcon
  label: string
}

const ITEMS: RailItem[] = [
  { key: 'properties', icon: SlidersHorizontal, label: 'Properties' },
  { key: 'audio', icon: Music, label: 'Audio' },
  { key: 'speed', icon: Gauge, label: 'Speed' },
  { key: 'transitions', icon: Shuffle, label: 'Transitions' },
  { key: 'filters', icon: Wand2, label: 'Filters' },
  { key: 'adjust', icon: SunMedium, label: 'Adjust' },
  { key: 'ai', icon: Sparkles, label: 'AI Tools' },
]

interface Props {
  active: RightRailTab
  onChange: (tab: RightRailTab) => void
}

// Right tool rail (spec section 12). Only "Properties" is backed by real, existing
// selected-element data (PropertiesPanel); the rest are presentational-only placeholders
// for a future functionality pass, not wired to any editing behaviour yet.
export default function PropertiesRail({ active, onChange }: Props) {
  return (
    <nav style={s.root} aria-label="Properties tools">
      {ITEMS.map(item => {
        const isActive = active === item.key
        const Icon = item.icon
        return (
          <button
            key={item.key}
            className="sgv-rail-item"
            data-active={isActive}
            onClick={() => onChange(item.key)}
            title={item.label}
            aria-label={item.label}
            aria-pressed={isActive}
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
