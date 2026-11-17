// The optional colour behind a letterboxed clip and in timeline gaps. It lives on the canvas format (`canvasFormat.background`), so it is saved in the draft and restored with it.
// A draft or local copy written before it existed has none (black, as before); anything that is not "#rrggbb" is ignored rather than sent to the exporter, which would reject it.
export const CANVAS_BACKGROUND_RE = /^#[0-9a-fA-F]{6}$/

export const validCanvasBackground = (v: unknown): string | undefined => (typeof v === 'string' && CANVAS_BACKGROUND_RE.test(v) ? v.toLowerCase() : undefined)
