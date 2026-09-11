import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import type {
  AnimationConfig, Breakpoint, ElementConfig, PageBuilderMode, PageConfig, ResponsiveOverride,
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
  breakpoint: Breakpoint
}

interface PageBuilderActions {
  setMode: (mode: PageBuilderMode) => void
  select: (id: string | null) => void
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
    select: (id) => setSelectedId(id),
    setBreakpoint: (bp) => setBreakpoint(bp),

    moveElement: (id, dx, dy) => mutate(draft => {
      walk(allElements(draft), id, el => {
        el.positionOverridden = true
        el.x = Math.round(el.x + dx)
        el.y = Math.round(el.y + dy)
      })
    }),

    resizeElement: (id, patch) => mutate(draft => {
      walk(allElements(draft), id, el => {
        if (patch.width !== undefined) { el.width = Math.max(8, Math.round(patch.width)); el.sizeOverridden = true }
        if (patch.height !== undefined) { el.height = Math.max(8, Math.round(patch.height)); el.sizeOverridden = true }
        if (patch.x !== undefined) { el.x = Math.round(patch.x); el.positionOverridden = true }
        if (patch.y !== undefined) { el.y = Math.round(patch.y); el.positionOverridden = true }
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
    },

    findElement,
  }), [mutate, allElements, findElement])

  const value: PageBuilderContextValue = { mode, page, selectedId, breakpoint, ...actions }

  return <PageBuilderCtx.Provider value={value}>{children}</PageBuilderCtx.Provider>
}

export function usePageBuilder(): PageBuilderContextValue {
  const ctx = useContext(PageBuilderCtx)
  if (!ctx) throw new Error('usePageBuilder must be used inside a PageBuilderProvider')
  return ctx
}
