// M4 -- visual intelligence: classify, track and assess the readiness of what the analysis found on screen. See contract.ts for the versioned interface M5 consumes.
export * from './contract'
export { buildVisualElements, buildTextTracks, buildObjectTracks, type BarEvidence, type BuildOptions, type VisualInput } from './build'
export { classifyTextTrack, classifyObjectTrack, classifyBackgroundBar, applyCorrection, findSubtitleLines, RULE_CAP, UNKNOWN_BELOW } from './classify'
export { readinessOf } from './readiness'
export { distinctSpots, looksLikeHandle, looksLikeWords, movementOf, visibilityIntervals } from './signals'
