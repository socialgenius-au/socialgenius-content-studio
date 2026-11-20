import { useEffect, useState } from 'react'

/** Tracks a CSS media query. Fails safe to false (the desktop layout) when matchMedia is unavailable. */
export function useMatchMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [matches, setMatches] = useState<boolean>(get)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])
  return matches
}

/** Below this width the editor stacks (canvas, then slides, then panels) because the three-column layout would leave the canvas too small beside the app sidebar. */
export const STACKED_QUERY = '(max-width: 1279px)'
