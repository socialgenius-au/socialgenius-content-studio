import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  label: string
  value: string | number
  icon?: LucideIcon
  trend?: { value: string; direction: 'up' | 'down' | 'flat' }
  tone?: 'default' | 'accent' | 'warning' | 'destructive'
  hint?: string
  className?: string
}

const TONE_RING: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'text-foreground',
  accent: 'text-sg-lime',
  warning: 'text-warning',
  destructive: 'text-destructive',
}

export function MetricCard({ label, value, icon: Icon, trend, tone = 'default', hint, className }: MetricCardProps) {
  return (
    <Card className={cn('shadow-none', className)}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className={cn('text-2xl font-bold tabular-nums', TONE_RING[tone])}>{value}</span>
          {trend && (
            <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium', trend.direction === 'up' ? 'text-success' : trend.direction === 'down' ? 'text-destructive' : 'text-muted-foreground')}>
              {trend.direction === 'up' && <ArrowUpRight className="h-3 w-3" />}
              {trend.direction === 'down' && <ArrowDownRight className="h-3 w-3" />}
              {trend.value}
            </span>
          )}
          {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
        </div>
        {Icon && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
