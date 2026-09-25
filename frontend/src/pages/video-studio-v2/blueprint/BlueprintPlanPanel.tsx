// C6 -- the "Blueprint scenes" panel inside the EXISTING Video Studio V2 shell: shows the scenes the active draft was created from
// (one per blueprint section), their instructions (never final copy), mechanisms and traceability. Read-only; renders nothing when the
// project did not come from a blueprint.
import { useState } from 'react'
import { useBlueprintPlan } from './blueprintPlanStore'
import type { BlueprintPlan } from './blueprintPlan'

const fmt = (n: number) => `${Math.round(n * 10) / 10}s`
const btn: React.CSSProperties = { background: 'transparent', border: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left', padding: 0 }

export default function BlueprintPlanPanel() {
  const plan = useBlueprintPlan()
  return plan ? <BlueprintPlanView plan={plan} /> : null
}

export function BlueprintPlanView({ plan }: { plan: BlueprintPlan }) {
  const [open, setOpen] = useState(true)
  const [detail, setDetail] = useState<number | null>(null)

  return (
    <section
      data-testid="blueprint-plan-panel"
      style={{ margin: '0 0 8px', border: '1px solid rgba(99,102,241,.35)', borderRadius: 10, background: 'rgba(99,102,241,.06)', fontSize: 13 }}
    >
      <button onClick={() => setOpen(o => !o)} style={{ ...btn, width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' }}>
        <span><strong>Blueprint draft</strong> · {plan.scenes.length} scenes · {fmt(plan.totalSeconds)}{plan.platform ? ` · ${plan.platform}` : ''}</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 10px', maxHeight: 260, overflowY: 'auto' }}>
          <p style={{ margin: '0 0 8px', opacity: 0.8 }}>
            Scenes hold <em>creation instructions</em>, not final content — replace each placeholder on the timeline with real wording, footage and voice.
          </p>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {plan.scenes.map(sc => (
              <li key={sc.sceneNumber} data-testid={`blueprint-scene-${sc.sceneNumber}`} style={{ border: '1px solid rgba(128,128,128,.25)', borderRadius: 8, padding: '6px 10px' }}>
                <button onClick={() => setDetail(d => (d === sc.sceneNumber ? null : sc.sceneNumber))} style={{ ...btn, width: '100%', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong>Scene {sc.sceneNumber}</strong>
                  <span style={{ opacity: 0.7 }}>{sc.structuralRole.replace(/_/g, ' ')} · {fmt(sc.startTime)}–{fmt(sc.endTime)}</span>
                  {sc.mechanisms.length > 0 && <span style={{ opacity: 0.7 }}>· {sc.mechanisms.map(m => m.id).join(', ')}</span>}
                  {sc.cta && <span style={{ fontWeight: 600 }}>· CTA</span>}
                </button>
                <div style={{ marginTop: 2 }}>{sc.contentInstruction}</div>
                {detail === sc.sceneNumber && (
                  <dl style={{ margin: '6px 0 0', display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 10px' }}>
                    <dt>Visual</dt><dd style={{ margin: 0 }}>{sc.visual}</dd>
                    <dt>Text</dt><dd style={{ margin: 0 }}>{sc.text}</dd>
                    <dt>Voice</dt><dd style={{ margin: 0 }}>{sc.speech}</dd>
                    <dt>Pacing</dt><dd style={{ margin: 0 }}>{sc.pacing}</dd>
                    {sc.transition && (<><dt>Transition</dt><dd style={{ margin: 0 }}>{sc.transition}</dd></>)}
                    {sc.cta && (<><dt>CTA</dt><dd style={{ margin: 0 }}>{sc.cta}</dd></>)}
                    {sc.mandatoryPoints.length > 0 && (<><dt>Must include</dt><dd style={{ margin: 0 }}>{sc.mandatoryPoints.map(p => p.text).join(' · ')}</dd></>)}
                    {sc.mechanisms.length > 0 && (<><dt>Principles</dt><dd style={{ margin: 0 }}>{sc.mechanisms.map(m => `${m.id} ${m.type.replace(/_/g, ' ')}`).join(' · ')}</dd></>)}
                    <dt>Traceability</dt>
                    <dd style={{ margin: 0, opacity: 0.7 }}>
                      {sc.trace.blueprintId} · section {sc.trace.sectionNumber} · reference {sc.trace.referenceVideoId}{sc.trace.c3AttemptId != null ? ` · mechanisms attempt ${sc.trace.c3AttemptId}` : ''}
                    </dd>
                  </dl>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
