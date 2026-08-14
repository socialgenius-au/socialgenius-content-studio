import { Badge, type BadgeProps } from '@/components/ui/badge'

const STATUS_MAP: Record<string, { variant: BadgeProps['variant']; label?: string }> = {
  // generic
  draft: { variant: 'secondary' },
  review: { variant: 'warning' },
  pending_approval: { variant: 'warning', label: 'Pending approval' },
  approved: { variant: 'success' },
  approved_with_conditions: { variant: 'success', label: 'Approved w/ conditions' },
  changes_requested: { variant: 'destructive', label: 'Changes requested' },
  scheduled: { variant: 'accent' },
  publishing: { variant: 'accent' },
  published: { variant: 'success' },
  failed: { variant: 'destructive' },
  active: { variant: 'success' },
  paused: { variant: 'secondary' },
  complete: { variant: 'success' },
  planning: { variant: 'secondary' },
  // ops
  todo: { variant: 'secondary', label: 'To do' },
  in_progress: { variant: 'accent', label: 'In progress' },
  blocked: { variant: 'destructive' },
  awaiting_approval: { variant: 'warning', label: 'Awaiting approval' },
  done: { variant: 'success' },
  // leads
  new: { variant: 'accent' },
  contacted: { variant: 'secondary' },
  qualified: { variant: 'accent' },
  opportunity: { variant: 'warning' },
  appointment_quote: { variant: 'warning', label: 'Appointment/Quote' },
  won: { variant: 'success' },
  lost: { variant: 'destructive' },
  // connections
  connected: { variant: 'success' },
  disconnected: { variant: 'secondary' },
  warning: { variant: 'warning' },
  // gate
  green: { variant: 'success', label: 'Aligned' },
  amber: { variant: 'warning', label: 'Tactical / Neutral' },
  red: { variant: 'destructive', label: 'Detracts' },
  // capability map
  ready: { variant: 'success', label: 'Ready to promise' },
  needs_improvement: { variant: 'warning', label: 'Needs improvement' },
  not_deliverable: { variant: 'destructive', label: 'Not deliverable' },
}

function toTitle(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const conf = STATUS_MAP[status] ?? { variant: 'outline' as const }
  return (
    <Badge variant={conf.variant} className={className}>
      {conf.label ?? toTitle(status)}
    </Badge>
  )
}
