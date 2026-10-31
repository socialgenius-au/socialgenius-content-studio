import { useEffect } from 'react'
import { PageBuilderProvider, usePageBuilder } from '../pagebuilder/PageBuilderContext'
import { PageContent } from '../pagebuilder/PageCanvas'
import { VisualEditorShell } from '../pagebuilder/VisualEditorShell'
import { positioningGatewayConfig } from '../pagebuilder/positioningGatewayConfig'
import './PositioningGatewayPage.css'

/**
 * The gateway is a real Page Builder composition, not a screenshot with hotspots.
 * Every editable visual is an ElementConfig instance and View/Editor share the same render path.
 */
function GatewayMode({ studio = false }: { studio?: boolean }) {
  const { setMode } = usePageBuilder()
  useEffect(() => setMode(studio ? 'edit' : 'view'), [studio, setMode])
  return studio ? <VisualEditorShell /> : <PageContent />
}

export default function PositioningGatewayPage({ studio = false }: { studio?: boolean }) {
  return (
    <PageBuilderProvider initialConfig={positioningGatewayConfig} storageKey="pb-positioning-gateway-draft-v1">
      <GatewayMode studio={studio} />
    </PageBuilderProvider>
  )
}
