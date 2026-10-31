// Post Creator — the ONE platform/format selection shared by every stage (Brief, References, Create, Review).
// Pure reducer + selectors (no React) so the rules are unit-tested. Selection rules live in the shared registry helpers.
import {
  defaultSelection, placementsFor, platformsFor, POST_MEDIA_TYPES, resolveCanvas, selectFormat, selectPlatform, setCustomSize,
  type FormatSelection, type Placement, type PlatformGroup, type ResolvedCanvas,
} from '../../../lib/platformFormats'

export interface PostFormatState {
  selection: FormatSelection
  /** Additional publish targets chosen in Review. The primary platform (selection.platformKey) is never stored here, so the two cannot contradict. */
  extraPlatformKeys: string[]
}

export type PostFormatAction =
  | { type: 'platform'; platformKey: string }
  | { type: 'format'; formatKey: string }
  | { type: 'custom'; size: { width: number; height: number } }
  | { type: 'toggleExtraPlatform'; platformKey: string }

export const initialPostFormatState = (): PostFormatState => ({ selection: defaultSelection(POST_MEDIA_TYPES), extraPlatformKeys: [] })

export function postFormatReducer(state: PostFormatState, action: PostFormatAction): PostFormatState {
  switch (action.type) {
    case 'platform': {
      const selection = selectPlatform(state.selection, action.platformKey, POST_MEDIA_TYPES)
      return { selection, extraPlatformKeys: state.extraPlatformKeys.filter(k => k !== selection.platformKey) }
    }
    case 'format':
      return { ...state, selection: selectFormat(state.selection, action.formatKey, POST_MEDIA_TYPES) }
    case 'custom':
      return { ...state, selection: setCustomSize(state.selection, action.size) }
    case 'toggleExtraPlatform': {
      const { platformKey } = action
      if (platformKey === state.selection.platformKey) return state
      if (!platformsFor(POST_MEDIA_TYPES).some(p => p.key === platformKey)) return state
      const has = state.extraPlatformKeys.includes(platformKey)
      return { ...state, extraPlatformKeys: has ? state.extraPlatformKeys.filter(k => k !== platformKey) : [...state.extraPlatformKeys, platformKey] }
    }
  }
}

/** Platforms offered in Post Creator (each lists only its post/image-capable placements). */
export const postCreatorPlatforms = (): PlatformGroup[] => platformsFor(POST_MEDIA_TYPES)

/** Formats offered for the selected platform. */
export const postCreatorFormats = (platformKey: string): Placement[] => placementsFor(platformKey, POST_MEDIA_TYPES)

/** Concrete canvas for the current selection. The selection is always kept valid by the reducer, so this is defined. */
export const canvasOf = (state: PostFormatState): ResolvedCanvas => resolveCanvas(state.selection) as ResolvedCanvas
