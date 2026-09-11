import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageBuilderProvider, usePageBuilder } from '../pagebuilder/PageBuilderContext'
import { PageCanvas } from '../pagebuilder/PageCanvas'
import { VisualEditorShell } from '../pagebuilder/VisualEditorShell'
import { positioningPageConfig } from '../pagebuilder/positioningPageConfig'
import './PositioningLandingPage.css'

/**
 * Social Genius — Public Positioning Landing Page, rendered by the shared Page Builder engine
 * (see frontend/src/pagebuilder/) instead of hard-coded JSX.
 *
 * Still PUBLIC at /positioning, still unauthenticated, still its own full-screen chrome — none of
 * that changed. What changed is HOW the page is produced: `positioningPageConfig.ts` is the data,
 * and THREE shells can mount it, all reading/writing the SAME `PageBuilderProvider` state (Section
 * 3 of the Visual Editor brief — "one engine, not two builders"):
 *   - no query param    -> VIEW MODE, what every visitor gets, by default.
 *   - `?edit=1`         -> the original Page Builder (`PageCanvas`) — retained unmodified.
 *   - `?studio=1`       -> the new Visual Editor (`VisualEditorShell`), today's primary interface.
 * Neither `edit` nor `studio` is a public button — both are internal/admin-only entry points.
 */
function ModeGate() {
  const [params] = useSearchParams()
  const { setMode } = usePageBuilder()
  const studio = params.get('studio') === '1'
  const edit = params.get('edit') === '1'
  useEffect(() => {
    if (studio || edit) setMode('edit')
  }, [studio, edit, setMode])
  if (studio) return <VisualEditorShell />
  return <PageCanvas />
}

export default function PositioningLandingPage() {
  return (
    <PageBuilderProvider initialConfig={positioningPageConfig} storageKey="pb-positioning-draft-v1">
      <ModeGate />
    </PageBuilderProvider>
  )
}
