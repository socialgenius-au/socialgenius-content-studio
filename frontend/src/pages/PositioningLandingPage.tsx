import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageBuilderProvider, usePageBuilder } from '../pagebuilder/PageBuilderContext'
import { PageCanvas } from '../pagebuilder/PageCanvas'
import { positioningPageConfig } from '../pagebuilder/positioningPageConfig'
import './PositioningLandingPage.css'

/**
 * Social Genius — Public Positioning Landing Page, now rendered by the Page Builder
 * (see frontend/src/pagebuilder/) instead of hard-coded JSX.
 *
 * Still PUBLIC at /positioning, still unauthenticated, still its own full-screen chrome — none of
 * that changed. What changed is HOW the page is produced: `positioningPageConfig.ts` is the data,
 * `<PageCanvas />` is the one renderer that turns that data into the page, in either VIEW MODE
 * (what every visitor gets, by default) or EDIT MODE (internal/admin only, entered via ?edit=1 —
 * deliberately not a public button, see Section 2 of the brief).
 */
function EditModeGate() {
  const [params] = useSearchParams()
  const { setMode } = usePageBuilder()
  useEffect(() => {
    if (params.get('edit') === '1') setMode('edit')
  }, [params, setMode])
  return <PageCanvas />
}

export default function PositioningLandingPage() {
  return (
    <PageBuilderProvider initialConfig={positioningPageConfig} storageKey="pb-positioning-draft-v1">
      <EditModeGate />
    </PageBuilderProvider>
  )
}
