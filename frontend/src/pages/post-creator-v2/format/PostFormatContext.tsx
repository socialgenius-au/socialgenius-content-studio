import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react'
import type { Placement, PlatformGroup, ResolvedCanvas } from '../../../lib/platformFormats'
import { canvasOf, initialPostFormatState, postCreatorFormats, postCreatorPlatforms, postFormatReducer, type PostFormatState } from './formatState'

interface PostFormatApi {
  state: PostFormatState
  canvas: ResolvedCanvas
  platforms: PlatformGroup[]
  formats: Placement[]
  selectPlatform: (platformKey: string) => void
  selectFormat: (formatKey: string) => void
  setCustomSize: (size: { width: number; height: number }) => void
  toggleExtraPlatform: (platformKey: string) => void
}

const Ctx = createContext<PostFormatApi | null>(null)

/** Holds the single platform/format selection for the whole Post Creator workflow (session state; no persistence in this phase). */
export function PostFormatProvider({ children, initialState }: { children: ReactNode; initialState?: PostFormatState }) {
  const [state, dispatch] = useReducer(postFormatReducer, initialState ?? undefined, s => s ?? initialPostFormatState())
  const api = useMemo<PostFormatApi>(() => ({
    state,
    canvas: canvasOf(state),
    platforms: postCreatorPlatforms(),
    formats: postCreatorFormats(state.selection.platformKey),
    selectPlatform: platformKey => dispatch({ type: 'platform', platformKey }),
    selectFormat: formatKey => dispatch({ type: 'format', formatKey }),
    setCustomSize: size => dispatch({ type: 'custom', size }),
    toggleExtraPlatform: platformKey => dispatch({ type: 'toggleExtraPlatform', platformKey }),
  }), [state])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function usePostFormat(): PostFormatApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePostFormat must be used inside <PostFormatProvider>')
  return v
}
