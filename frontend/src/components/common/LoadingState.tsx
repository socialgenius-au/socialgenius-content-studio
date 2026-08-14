import { Skeleton } from '@/components/ui/skeleton'

export function LoadingState({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={className}>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  )
}

export function LoadingRow({ className }: { className?: string }) {
  return <Skeleton className={className ?? 'h-4 w-full'} />
}
