import { createContext, useContext } from 'react'

/**
 * Visual Editor V1 — the artboard's current CSS zoom factor (1 = 100%), so pointer-drag math can
 * compensate for it (Section 5 of the UX-correction brief: "Zoom changes visual canvas scale only.
 * It must NOT alter website CSS dimensions or saved page properties"). Without this, a screen-pixel
 * mouse delta stops matching the artboard's own CSS pixels the moment it's scaled — drag/resize
 * would feel wrong (too fast zoomed out, too slow zoomed in).
 *
 * Defaults to 1 and is only ever provided by VisualEditorShell around its scaled artboard — the
 * retained Page Builder (PageCanvas.tsx) never renders a ZoomProvider, so `useZoom()` there always
 * reads the default 1 and EditableWrapper's existing drag/resize math is completely unchanged.
 */
const ZoomCtx = createContext(1)

export const ZoomProvider = ZoomCtx.Provider

export function useZoom(): number {
  return useContext(ZoomCtx)
}
