import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageBuilderProvider, usePageBuilder } from '../pagebuilder/PageBuilderContext'
import { PageCanvas } from '../pagebuilder/PageCanvas'
import { VisualEditorShell } from '../pagebuilder/VisualEditorShell'
import { positioningPageConfig } from '../pagebuilder/positioningPageConfig'
import PositioningGatewayPage from './PositioningGatewayPage'
import './PositioningLandingPage.css'

/**
 * /positioning                 -> object-based Social Genius gateway landing page
 * /positioning?studio=1        -> gateway Visual Editor (same objects, same renderer)
 * /positioning?website=1       -> existing Social Genius positioning website
 * /positioning?experience=1    -> existing website, scrolled to the Positioning Audit
 * /positioning?website=1&studio=1 -> existing website Visual Editor
 */
function ExistingSiteGate({ studio, edit, experience }: { studio: boolean; edit: boolean; experience: boolean }) {
  const { setMode } = usePageBuilder()
  useEffect(() => setMode(studio || edit ? 'edit' : 'view'), [studio, edit, setMode])
  useEffect(() => {
    if (!experience) return
    const timer = window.setTimeout(() => {
      document.getElementById('positioning-audit')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [experience])

  if (studio) return <VisualEditorShell />
  return <PageCanvas />
}

export default function PositioningLandingPage() {
  const [params] = useSearchParams()
  const website = params.get('website') === '1'
  const experience = params.get('experience') === '1'
  const studio = params.get('studio') === '1'
  const edit = params.get('edit') === '1'

  // Gateway is now the primary /positioning page AND its primary Visual Editor target.
  if (!website && !experience) return <PositioningGatewayPage studio={studio || edit} />

  // Preserve Sameena's existing Positioning page and functionality as the Website/Experience route.
  return (
    <PageBuilderProvider initialConfig={positioningPageConfig} storageKey="pb-positioning-draft-v1">
      <ExistingSiteGate studio={studio} edit={edit} experience={experience} />
    </PageBuilderProvider>
  )
}
