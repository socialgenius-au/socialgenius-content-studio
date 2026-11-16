import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBlueprintPlan } from "../blueprint/blueprintPlanStore";

/** Creative directions from the active blueprint, never canned hook scores. */
export default function CreativeLabTab({ onNext, onBack }: { onNext?: () => void; onBack?: () => void }) {
  const plan = useBlueprintPlan();
  const navigate = useNavigate();
  const [selectedScene, setSelectedScene] = useState<number | null>(null);
  const mechanisms = useMemo(() => plan ? Array.from(new Map(plan.scenes.flatMap(s => s.mechanisms).map(m => [m.id, m])).values()) : [], [plan]);
  const selected = plan?.scenes.find(s => s.sceneNumber === selectedScene) || plan?.scenes[0];
  return <div className="stage-page creative-page">
    <h2>Creative Lab — evidence-linked directions</h2>
    {!plan ? <section className="card">
      <h3>No creative blueprint connected</h3>
      <p>Creative Lab does not invent hooks, scores, market evidence or video ideas. Build and use a blueprint in Deconstructor to bring its creative decisions here.</p>
      <button className="secondary" type="button" onClick={() => navigate("/deconstructor")}>Open Deconstructor</button>
    </section> : <>
      <section className="card">
        <h3>Creative direction</h3>
        <p>{plan.structuralApproach}</p>
        <p><strong>Brief:</strong> {plan.intentSummary}</p>
        <p>These are planned creative directions from your blueprint, not tested performance predictions. The source reference and supporting evidence can be reviewed in Deconstructor.</p>
        <button className="secondary" type="button" onClick={() => navigate(`/deconstructor/${plan.referenceVideoId}`)}>Review source and revise blueprint</button>
      </section>
      <div className="creative-grid">
        <section className="card">
          <h3>Scene and opening directions</h3>
          {plan.scenes.map(s => <button key={s.sceneNumber} className={selected?.sceneNumber === s.sceneNumber ? "secondary wide active" : "secondary wide"} type="button" onClick={() => setSelectedScene(s.sceneNumber)}>
            Scene {s.sceneNumber}: {s.structuralRole.replace(/_/g, " ")} ({s.startTime}–{s.endTime}s)
          </button>)}
        </section>
        <section className="card">
          <h3>{selected ? `Scene ${selected.sceneNumber} — ${selected.structuralRole.replace(/_/g, " ")}` : "Select a scene"}</h3>
          {selected && <>
            <p><strong>Purpose:</strong> {selected.purpose}</p>
            <p><strong>Visual direction:</strong> {selected.visual}</p>
            <p><strong>On-screen text:</strong> {selected.text}</p>
            <p><strong>Speech:</strong> {selected.speech}</p>
            <p><strong>Pacing:</strong> {selected.pacing}</p>
            {selected.cta && <p><strong>CTA:</strong> {selected.cta}</p>}
            {selected.limitations.length > 0 && <p><strong>Limitations:</strong> {selected.limitations.join("; ")}</p>}
          </>}
        </section>
        <section className="card">
          <h3>Transferable mechanisms</h3>
          {mechanisms.length ? <ul>{mechanisms.map(m => <li key={m.id}><strong>{m.id}: {m.type.replace(/_/g, " ")}</strong> — {m.principle || "No principle recorded"}</li>)}</ul> : <p>No mechanism mapping available for this blueprint.</p>}
          <p>Mechanism principles are creative guidance, not proof of higher retention or conversion.</p>
        </section>
      </div>
    </>}
    <div className="stage-footer">
      <button className="secondary" type="button" onClick={onBack}>← Back: Intelligence</button>
      <button className="primary" type="button" onClick={onNext}>Next: Create / Edit →</button>
    </div>
  </div>;
}
