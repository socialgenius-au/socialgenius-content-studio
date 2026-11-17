// The two lines of the sidebar's "Current Project" card: the real project identity (see projectIdentity.ts), or a neutral fallback when none is selected.
import { useBlueprintPlan } from '../blueprint/blueprintPlanStore'
import { useProjectContext } from './projectContextStore'
import { resolveProjectIdentity } from './projectIdentity'

export default function ProjectIdentityCard() {
  const plan = useBlueprintPlan()
  const ctx = useProjectContext()
  const id = resolveProjectIdentity({ plan, stored: ctx.storedIdentity })
  return (
    <>
      <strong data-testid="project-client" data-identity-source={id.source}>{id.client}</strong>
      <span data-testid="project-campaign">{id.campaign}</span>
    </>
  )
}
