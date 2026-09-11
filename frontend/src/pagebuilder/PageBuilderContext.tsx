import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import type {
  AnimationConfig, Breakpoint, ElementConfig, PageBuilderMode, PageConfig, ResponsiveOverride,
  SectionBackgroundConfig,
} from './types'

/**
 * Page Builder — shared editing state.
 *
 * PERSISTENCE (Section 25 of the brief — "lightweight for v1, structured so more can be added
 * later"): a draft is saved to localStorage under `storageKey`, the SAME pattern
 * VideoStudioV2.tsx's own ProjectPersistence already established for its own drafts (see that
 * file's comments) — no backend/DB involvement yet. Swapping this for a real save endpoint later
 * only means changing `persist()`'s own body; nothing else in this file or its consumers needs to
 * change (same isolation principle as the landing page's own `submitPositioningLead`).
 */

interface PageBuilderState {
  mode: PageBuilderMode
  page: PageConfig
  selectedId: string | null
  /** Section-level selection, for editing a SECTION'S BACKGROUND LAYER rather than an element —
   * mutually exclusive with `selectedId` (selecting one clears the other), since the property
   * panel shows one editor or the other, never both at once. */
  selectedSectionId: string | null
  breakpoint: Breakpoint
}

interface PageBuilderActions {
  setMode: (mode: PageBuilderMode) => void
  select: (id: string | null) => void
  selectSection: (id: string | null) => void
  updateSectionBackground: (sectionId: string, patch: Partial<SectionBackgroundConfig>) => void
  setBreakpoint: (bp: Breakpoint) => void
  moveElement: (id: string, dx: number, dy: number) => void
  resizeElement: (id: string, patch: { width?: number; height?: number; x?: number; y?: number }) => void
  updateElement: (id: string, patch: Partial<ElementConfig>) => void
  updateResponsiveOverride: (id: string, bp: Breakpoint, patch: Partial<ResponsiveOverride>) => void
  updateAnimation: (id: string, patch: Partial<AnimationConfig>) => void
  setLocked: (id: string, locked: boolean) => void
  setVisible: (id: string, visible: boolean) => void
  reorderLayer: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void
  duplicateElement: (id: string) => void
  deleteElement: (id: string) => void
  resetDraft: () => void
  findElement: (id: string | null) => ElementConfig | null
}

type PageBuilderContextValue = PageBuilderState & PageBuilderActions

const PageBuilderCtx = createContext<PageBuilderContextValue | null>(null)

function cloneConfig(config: PageConfig): PageConfig {
  return JSON.parse(JSON.stringify(config))
}

/** Depth-first find + mutate helper — elements can nest (containers hold children), so every
 * lookup/mutation walks the whole tree rather than assuming a flat list. */
function walk(elements: ElementConfig[], id: string, visit: (el: ElementConfig, siblings: ElementConfig[]) => void): boolean {
  for (const el of elements) {
    if (el.id === id) {
      visit(el, elements)
      return true
    }
    if (el.children && walk(el.children, id, visit)) return true
  }
  return false
}

function findInElements(elements: ElementConfig[], id: string): ElementConfig | null {
  for (const el of elements) {
    if (el.id === id) return el
    if (el.children) {
      const found = findInElements(el.children, id)
      if (found) return found
    }
  }
  return null
}

let uid = 0
function nextId(prefix: string) {
  uid += 1
  return `${prefix}-copy-${Date.now()}-${uid}`
}

export function PageBuilderProvider({
  children, initialConfig, storageKey,
}: { children: ReactNode; initialConfig: PageConfig; storageKey: string }) {
  const [page, setPage] = useState<PageConfig>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) return JSON.parse(raw) as PageConfig
    } catch {
      // corrupted/old-shape draft — fall back to the shipped config rather than crash
    }
    return cloneConfig(initialConfig)
  })
  const [mode, setMode] = useState<PageBuilderMode>('view')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('desktop')

  const initialRef = useRef(initialConfig)
  initialRef.current = initialConfig

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(page))
    } catch {
      // storage full/unavailable — editing still works in-memory for this session
    }
  }, [page, storageKey])

  // BUG FIX (responsive-architecture audit): `breakpoint` previously defaulted to 'desktop' and
  // was NEVER updated outside Edit Mode's own toolbar buttons — meaning a real visitor loading
  // /positioning on an actual phone in VIEW MODE always got 'desktop', so per-element responsive
  // overrides could never activate for anyone but an editor manually clicking the preview toggle.
  // In View Mode this now tracks the REAL window width (same thresholds the page's own CSS
  // container queries use: <=640 mobile, <=960 tablet). In Edit Mode, breakpoint stays fully
  // driven by the toolbar — that is the deliberate simulation surface, untouched by this effect.
  useEffect(() => {
    if (mode !== 'view') return
    const compute = () => {
      const w = window.innerWidth
      setBreakpoint(w <= 640 ? 'mobile' : w <= 960 ? 'tablet' : 'desktop')
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [mode])

  const mutate = useCallback((fn: (draft: PageConfig) => void) => {
    setPage(prev => {
      const draft = cloneConfig(prev)
      fn(draft)
      return draft
    })
  }, [])

  const allElements = useCallback((draft: PageConfig) => draft.sections.flatMap(s => s.elements), [])

  const findElement = useCallback((id: string | null): ElementConfig | null => {
    if (!id) return null
    for (const section of page.sections) {
      const found = findInElements(section.elements, id)
      if (found) return found
    }
    return null
  }, [page])

  const actions: PageBuilderActions = useMemo(() => ({
    setMode: (m) => setMode(m),
    select: (id) => { setSelectedId(id); if (id) setSelectedSectionId(null) },
    selectSection: (id) => { setSelectedSectionId(id); if (id) setSelectedId(null) },
    updateSectionBackground: (sectionId, patch) => mutate(draft => {
      const section = draft.sections.find(s => s.id === sectionId)
      if (!section) return
      section.backgroundLayer = { ...(section.backgroundLayer ?? { type: 'none', opacity: 1 }), ...patch }
    }),
    setBreakpoint: (bp) => setBreakpoint(bp),

    // BUG FIX (responsive-architecture audit): these two actions previously always wrote to the
    // element's base (desktop) x/y/width/height, no matter which breakpoint tab was active in the
    // toolbar — so there was no way to author a genuine tablet/mobile-only override at all, and
    // (see ElementRenderer.tsx's own matching fix) an edited element would blindly reapply its
    // desktop pixels at every narrower breakpoint. They now target `element.responsive[breakpoint]`
    // whenever the active breakpoint isn't 'desktop', reading the CURRENT effective value at that
    // breakpoint (its own override if one already exists, else the desktop base) as the starting
    // point for the drag/resize delta — so a fresh mobile-only override starts from wherever the
    // element already visually sits, not from an unrelated stored number.
    moveElement: (id, dx, dy) => mutate(draft => {
      walk(allElements(draft), id, el => {
        if (breakpoint === 'desktop') {
          el.positionOverridden = true
          el.x = Math.round(el.x + dx)
          el.y = Math.round(el.y + dy)
        } else {
          const current = el.responsive[breakpoint] ?? {}
          const baseX = current.x ?? el.x
          const baseY = current.y ?? el.y
          el.responsive = { ...el.responsive, [breakpoint]: { ...current, x: Math.round(baseX + dx), y: Math.round(baseY + dy) } }
        }
      })
    }),

    resizeElement: (id, patch) => mutate(draft => {
      walk(allElements(draft), id, el => {
        if (breakpoint === 'desktop') {
          if (patch.width !== undefined) { el.width = Math.max(8, Math.round(patch.width)); el.sizeOverridden = true }
          if (patch.height !== undefined) { el.height = Math.max(8, Math.round(patch.height)); el.sizeOverridden = true }
          if (patch.x !== undefined) { el.x = Math.round(patch.x); el.positionOverridden = true }
          if (patch.y !== undefined) { el.y = Math.round(patch.y); el.positionOverridden = true }
        } else {
          const current = el.responsive[breakpoint] ?? {}
          const next = { ...current }
          if (patch.width !== undefined) next.width = Math.max(8, Math.round(patch.width))
          if (patch.height !== undefined) next.height = Math.max(8, Math.round(patch.height))
          if (patch.x !== undefined) next.x = Math.round(patch.x)
          if (patch.y !== undefined) next.y = Math.round(patch.y)
          el.responsive = { ...el.responsive, [breakpoint]: next }
        }
      })
    }),

    updateElement: (id, patch) => mutate(draft => {
      walk(allElements(draft), id, el => Object.assign(el, patch))
    }),

    updateResponsiveOverride: (id, bp, patch) => mutate(draft => {
      walk(allElements(draft), id, el => {
        el.responsive = { ...el.responsive, [bp]: { ...el.responsive[bp], ...patch } }
      })
    }),

    updateAnimation: (id, patch) => mutate(draft => {
      walk(allElements(draft), id, el => { el.animation = { ...el.animation, ...patch } })
    }),

    setLocked: (id, locked) => mutate(draft => {
      walk(allElements(draft), id, el => { el.locked = locked })
    }),

    setVisible: (id, visible) => mutate(draft => {
      walk(allElements(draft), id, el => { el.visible = visible })
    }),

    reorderLayer: (id, direction) => mutate(draft => {
      walk(allElements(draft), id, (el, siblings) => {
        const zs = siblings.map(s => s.zIndex)
        if (direction === 'front') el.zIndex = Math.max(...zs) + 1
        else if (direction === 'back') el.zIndex = Math.min(...zs) - 1
        else if (direction === 'forward') el.zIndex += 1
        else el.zIndex -= 1
      })
    }),

    duplicateElement: (id) => mutate(draft => {
      walk(allElements(draft), id, (el, siblings) => {
        const copy: ElementConfig = JSON.parse(JSON.stringify(el))
        copy.id = nextId(el.type)
        copy.name = `${el.name} copy`
        copy.x += 24
        copy.y += 24
        siblings.push(copy)
      })
    }),

    deleteElement: (id) => mutate(draft => {
      for (const section of draft.sections) {
        const idx = section.elements.findIndex(e => e.id === id)
        if (idx !== -1) { section.elements.splice(idx, 1); return }
        for (const el of section.elements) {
          if (el.children) {
            const cIdx = el.children.findIndex(c => c.id === id)
            if (cIdx !== -1) { el.children.splice(cIdx, 1); return }
          }
        }
      }
    }),

    resetDraft: () => {
      setPage(cloneConfig(initialRef.current))
      setSelectedId(null)
      setSelectedSectionId(null)
    },

    findElement,
  }), [mutate, allElements, findElement, breakpoint])

  const value: PageBuilderContextValue = { mode, page, selectedId, selectedSectionId, breakpoint, ...actions }

  return <PageBuilderCtx.Provider value={value}>{children}</PageBuilderCtx.Provider>
}

export function usePageBuilder(): PageBuilderContextValue {
  const ctx = useContext(PageBuilderCtx)
  if (!ctx) throw new Error('usePageBuilder must be used inside a PageBuilderProvider')
  return ctx
}
