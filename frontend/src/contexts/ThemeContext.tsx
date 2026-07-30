import {
  createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode,
} from 'react'

export type ThemeMode = 'light' | 'dark' | 'auto'
type ResolvedTheme = 'light' | 'dark'

interface ThemeState {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
  setMode: (m: ThemeMode) => void
}

const STORAGE_KEY = 'studio-theme-mode'
const ThemeCtx = createContext<ThemeState | null>(null)

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto'
  })
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme)

  // Live-update when the OS preference changes, without needing a reload
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemTheme(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme: ResolvedTheme = mode === 'auto' ? systemTheme : mode

  // useLayoutEffect (not useEffect) so data-theme lands before the browser paints the first
  // frame — every Studio component reads --panel-bg/--border/--text-* with no CSS fallback,
  // so a post-paint update would flash unstyled/wrong-theme panels for a frame on every load.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  const setMode = (m: ThemeMode) => {
    setModeState(m)
    localStorage.setItem(STORAGE_KEY, m)
  }

  return (
    <ThemeCtx.Provider value={{ mode, resolvedTheme, setMode }}>
      {children}
    </ThemeCtx.Provider>
  )
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx)
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider')
  return ctx
}
