import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({ title = 'Something went wrong', description, onRetry, className }: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center', className)}>
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

interface EntitlementLockedProps {
  feature: string
  className?: string
}

export function EntitlementLocked({ feature, className }: EntitlementLockedProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center', className)}>
      <p className="text-sm font-semibold text-foreground">Not included in this client's plan</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {feature} is disabled for this client. Enable it from Service Configurator to unlock this module.
      </p>
    </div>
  )
}

export function DisconnectedIntegration({ integration, className }: { integration: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning', className)}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>{integration} isn't connected yet — this view is showing sample data only.</span>
    </div>
  )
}
