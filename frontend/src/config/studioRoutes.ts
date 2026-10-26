// The ONE place that names the video-editor routes, so every link and redirect agrees on which editor is "the" Video Studio.
//
// Video Studio V2 (/video-studio-v2) is the approved editor. The original editor (components/studio/StudioPage) is kept, unchanged, but is no
// longer a destination: its old URLs redirect to V2 and it is reachable only at the explicit LEGACY path below.

/** The approved Video Studio V2 editor. */
export const VIDEO_STUDIO_ROUTE = '/video-studio-v2'

/** Where the preserved original editor now lives (nothing links here; it exists so the old component and its code stay mounted and reachable). */
export const LEGACY_STUDIO_ROUTE = '/legacy/studio'

/** Old editor URLs that now redirect to Video Studio V2. */
export const LEGACY_STUDIO_REDIRECT_PATHS = ['/studio', '/clients/:clientId/studio'] as const
