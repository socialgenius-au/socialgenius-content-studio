// Redirects from the old editor URLs to Video Studio V2. Exported as ready-made <Route> elements (rendered inside <Routes> in App.tsx) so the
// exact routes the app uses can also be inspected by tests with react-router's matchRoutes.
import { Navigate, Route } from 'react-router-dom'
import { LEGACY_STUDIO_REDIRECT_PATHS, VIDEO_STUDIO_ROUTE } from '../config/studioRoutes'

export const legacyStudioRedirectRoutes = LEGACY_STUDIO_REDIRECT_PATHS.map(path => (
  <Route key={path} path={path} element={<Navigate to={VIDEO_STUDIO_ROUTE} replace />} />
))
