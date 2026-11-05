// A draft made from a blueprint (or assembled by the Reconstructor) is a NEW, independent project. The editor's open-draft code only SETS the settings a snapshot carries and leaves the rest as the previously open project had
// them, so a draft that omits its canvas format or subtitle style silently inherits the other project's when it is opened inside the same editor session (and then saves them). These are the editor's own starting values,
// written into such drafts explicitly so opening one always gives exactly this. Mirrored from StudioContext (a protected file we do not edit); projectDefaults.test.ts fails if the two ever differ.
export const EDITOR_DEFAULT_CANVAS_FORMAT = {
  platformKey: 'instagram', placementKey: 'reel_story', label: 'Instagram - Reel / Story',
  ratio: '9:16', width: 1080, height: 1920,
} as const

export const EDITOR_DEFAULT_SUBTITLE_STYLE = {
  fontFamily: 'Inter', fontSize: 36, color: '#FFFFFF',
  bgColor: '#000000', bgOpacity: 0.6, align: 'center',
  outlineColor: '#000000', outlineWidth: 0, shadowColor: '#000000', shadowBlur: 0,
} as const
