import { useEffect, useState } from 'react'
import { initialUrlTokenState, nextUrlTokenState, watchUrlHash, type UrlTokenState } from './authRecovery'

/**
 * The one-time token in the address bar's #fragment, kept current while the page stays open.
 * Read (not cleared) during the first render: React StrictMode renders twice before any effect runs, and both passes must see the fragment.
 * Screens clear the fragment themselves in an effect, and are keyed on `version` so a new link restarts them from scratch.
 */
export function useUrlToken(): UrlTokenState {
  const [state, setState] = useState(() => initialUrlTokenState(typeof window === 'undefined' ? '' : window.location.hash))
  useEffect(() => watchUrlHash(window, (hash) => setState((prev) => nextUrlTokenState(prev, hash))), [])
  return state
}
