import { useNavigate } from "react-router-dom";
import { useBlueprintPlan } from "../blueprint/blueprintPlanStore";
import { useProjectContext } from "../identity/projectContextStore";
import { resolveProjectIdentity } from "../identity/projectIdentity";

/**
 * Evidence-grounded Video Studio intelligence. The former ABC Tiles cards were
 * static demo data, including unsupported market and performance claims.
 * The active reconstruction blueprint is the only intelligence source here.
 * Full Deconstructor creative intelligence remains available at its reference.
 */
export default function IntelligenceTab({ onNext, onBack }: { onNext?: () => void; onBack?: () => void }) {
  const plan = useBlueprintPlan();
  const ctx = useProjectContext();
  const identity = resolveProjectIdentity({ plan, stored: ctx.storedIdentity });
  const navigate = useNavigate();
  const mechanisms = plan ? Array.from(new Map(plan.scenes.flatMap(s => s.mechanisms).map(m => [m.id, m])).values()) : [];
  return (
    <div className="stage-page intelligence-page">
      <h2>Creative Intelligence</h2>
      <p>Project: <strong>{identity.client}</strong>{identity.campaign ? ` — ${identity.campaign}` : ""}</p>
      {!plan ? (
        <section className="card" data-testid="intelligence-no-source">
          <h3>No verified intelligence connected to this video</h3>
          <p>There is no active reconstruction blueprint. This page will not show sample positioning, competitor, market or audience claims as if they were findings about your project.</p>
          <p>Open a reference in Deconstructor, review its Anatomy and Mechanisms, then use its Blueprint in Video Studio to bring evidence-linked creative guidance here.</p>
          <button type="button" className="secondary" onClick={() => navigate("/deconstructor")}>Open Deconstructor</button>
        </section>
      ) : (
        <>
          <section className="card" data-testid="intelligence-blueprint-source">
            <h3>Source and limitations</h3>
            <p><strong>Reference {plan.referenceVideoId}</strong> · Blueprint {plan.blueprintId} · {plan.scenes.length} planned scenes · {plan.totalSeconds}s{plan.platform ? ` · ${plan.platform}` : ""}</p>
            <p>This is the blueprint's creative interpretation, not verified audience performance or independent market research. Review the source analysis for supporting evidence and uncertainty.</p>
            <button type="button" className="secondary" onClick={() => navigate(`/deconstructor/${plan.referenceVideoId}`)}>Review source in Deconstructor</button>
          </section>
          <div className="intel-grid">
            <section className="card">
              <h3>Creative objective</h3>
              <p>{plan.intentSummary || "No creative objective recorded."}</p>
              <h4>Structural approach</h4>
              <p>{plan.structuralApproach || "Not recorded."}</p>
            </section>
            <section className="card">
              <h3>Hook and narrative structure</h3>
              <ol>{plan.scenes.map(s => <li key={s.sceneNumber}><strong>Scene {s.sceneNumber}: {s.structuralRole.replace(/_/g, " ")}</strong> ({s.startTime}–{s.endTime}s) — {s.purpose}</li>)}</ol>
              <p>These are planned scene roles, not measured audience reactions or confirmed boundaries in the original video.</p>
            </section>
            <section className="card">
              <h3>Transferable creative mechanisms</h3>
              {mechanisms.length ? <ul>{mechanisms.map(m => <li key={m.id}><strong>{m.id}: {m.type.replace(/_/g, " ")}</strong> — {m.principle || "No principle recorded."}</li>)}</ul> : <p>No mechanism mappings were recorded in this blueprint.</p>}
            </section>
            <section className="card">
              <h3>Evidence boundaries</h3>
              <p>Audience insights, competitor comparisons, market trends and performance claims are not available from this blueprint alone.</p>
              <p>Creative suggestions should be checked against the original reference and your business brief before use.</p>
            </section>
          </div>
          <section className="card framework-card">
            <h3>Scene-by-scene content framework</h3>
            <div className="framework-flow">{plan.scenes.map(s => <div key={s.sceneNumber}><b>{s.structuralRole.replace(/_/g, " ")}</b><span>{s.purpose}</span></div>)}</div>
          </section>
        </>
      )}
      <div className="stage-footer">
        <button className="secondary" onClick={onBack} type="button">← Back to Brief</button>
        <button className="primary" onClick={onNext} type="button">Next: Creative Lab →</button>
      </div>
    </div>
  );
}
