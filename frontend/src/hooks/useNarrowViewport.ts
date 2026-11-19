import { useEffect, useState } from 'react'

/** Below the `md` breakpoint (768px) the app shell shows its navigation as an off-canvas drawer instead of a permanent 240px column. */
export const NARROW_QUERY = '(max-width: 767px)'

export function matchesNarrow(win: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  return !!win && typeof win.matchMedia === 'function' && win.matchMedia(NARROW_QUERY).matches
}

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => matchesNarrow())
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(NARROW_QUERY)
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return narrow
}
