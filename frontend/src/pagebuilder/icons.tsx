import {
  ArrowRight, Eye, ShieldCheck, Award, CheckCircle2, Compass, TrendingDown, Layers, Megaphone,
  Circle, type LucideIcon,
} from 'lucide-react'

/**
 * Icon elements store their icon choice as a plain string name (Section 10/23 — element config
 * must stay JSON-serializable, so it can't hold a React component reference directly). This is
 * the lookup from that name back to the actual lucide component. Add an entry here whenever a new
 * icon is used in a page config.
 */
const ICONS: Record<string, LucideIcon> = {
  'arrow-right': ArrowRight,
  eye: Eye,
  'shield-check': ShieldCheck,
  award: Award,
  'check-circle': CheckCircle2,
  compass: Compass,
  'trending-down': TrendingDown,
  layers: Layers,
  megaphone: Megaphone,
  circle: Circle,
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Cmp = ICONS[name] ?? Circle
  return <Cmp size={size} />
}
