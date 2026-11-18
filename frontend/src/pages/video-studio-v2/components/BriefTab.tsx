import { useBlueprintPlan } from "../blueprint/blueprintPlanStore";
import { useProjectContext } from "../identity/projectContextStore";
import { resolveProjectIdentity } from "../identity/projectIdentity";
import { useNavigate } from "react-router-dom";

/** Read-only, source-grounded brief for a reconstruction draft.
 * Editing the source brief remains in Deconstructor → New Content.
 * No fake save action or duplicate state that could diverge from the blueprint.
 */
export default function BriefTab({ onNext }: { onNext?: () => void; onBack?: () => void }) {
  const plan = useBlueprintPlan();
  const ctx = useProjectContext();
  const identity = resolveProjectIdentity({ plan, stored: ctx.storedIdentity });
  const navigate = useNavigate();
  return <div className="stage-page brief-page">
    <h2>Video brief</h2>
    <section className="card">
      <h3>Current project</h3>
      <p><strong>Brand:</strong> {identity.client}</p>
      <p><strong>Campaign:</strong> {identity.campaign}</p>
      {plan ? <>
        <p><strong>Brief and objective:</strong> {plan.intentSummary}</p>
        <p><strong>Platform:</strong> {plan.platform || "Not specified"}</p>
        <p><strong>Duration:</strong> {plan.totalSeconds} seconds</p>
        <p><strong>Planned scenes:</strong> {plan.scenes.length}</p>
        <p><strong>Creative direction:</strong> {plan.structuralApproach}</p>
        <p>This brief is sourced from the active reconstruction blueprint. To change its creative objective, edit the brief in Deconstructor and build a new blueprint. Existing drafts are not modified automatically.</p>
        <button className="secondary" type="button" onClick={() => navigate(`/deconstructor/${plan.referenceVideoId}`)}>Open source brief in Deconstructor</button>
      </> : <>
        <p>No reconstruction brief is connected to this Video Studio session. Open a reference in Deconstructor, create a New Content brief, and use its Blueprint to start a project.</p>
        <button className="secondary" type="button" onClick={() => navigate("/deconstructor")}>Open Deconstructor</button>
      </>}
    </section>
    <div className="stage-footer">
      <button className="primary" type="button" onClick={onNext}>Next: Intelligence →</button>
    </div>
  </div>;
}
