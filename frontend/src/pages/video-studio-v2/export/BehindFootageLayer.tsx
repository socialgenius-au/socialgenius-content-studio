// Option C: the layer that holds the shapes marked "behind footage". It sits above the V1 picture in the DOM (so it needs no change to the video element, the master clock or the backdrop) but is CLIPPED
// away from every rectangle the footage occupies right now, so a shape shows only where no picture is -- the same rule the exporter applies to the shape's PNG. One wrapper per rectangle (a dissolve has
// two): nested clips keep what is outside both, i.e. outside their union. Hit-testing follows the clip, so clicks over the footage reach the footage exactly as before, and a click on the bars still
// bubbles to the preview box (which selects the clip) just as it did.
import React from 'react'
import { outsideRectClipPath, type Rect } from './footageGeometry'

export default function BehindFootageLayer({ rects, canvasW, canvasH, children }: { rects: readonly Rect[]; canvasW: number; canvasH: number; children: React.ReactNode }) {
  let node: React.ReactNode = children
  for (const r of rects) {
    node = <div style={{ position: 'absolute', inset: 0, clipPath: outsideRectClipPath(r, canvasW, canvasH) }}>{node}</div>
  }
  return <div data-testid="behind-footage-layer" style={{ position: 'absolute', inset: 0 }}>{node}</div>
}
