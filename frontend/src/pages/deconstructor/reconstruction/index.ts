// M5 -- editable reconstruction accounting. Consumes the M4 visual-element contract; adds no layer of its own.
export * from './plan'
export { mergeElementReconstruction, readElementReconstruction, ELEMENT_RECONSTRUCTION_KEY } from './merge'
export { manualRegionFromElement } from './slots'
export { validateVisualElement } from './validate'
