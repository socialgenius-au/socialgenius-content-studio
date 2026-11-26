type TechnicalSource = {
  id: string
  kind: string
  start: number
  end: number
  text: string
  score?: number
  measurement?: Record<string, unknown>
}
type TechnicalFinding = {topic: string; summary: string; confidence: string; evidence: TechnicalSource[]}
type AudioEvent = {
  kind: string; label: string; start: number; end: number; score: number
  confidence: string; evidence: string; tempo_bpm?: number; purpose?: string; purpose_confidence?: string
}
type TechnicalShot = {
  number: number
  start: number
  end: number
  findings?: TechnicalFinding[]
  sources: TechnicalSource[]
}
export type TechnicalReport = {
  shots: TechnicalShot[]
  scenes: {number: number; start: number; end: number; shots: number[]; boundary_source?: 'shot'; summary?: string;
    findings?: (TechnicalFinding & {shot:number})[]; audio?: AudioEvent[]}[]
  audio?: AudioEvent[]
  audio_status?: string
  limitations: string[]
}

export function TechnicalShotEvidence({shot, seek}: {shot: TechnicalShot; seek?: (seconds: number) => void}) {
  const source = (item: TechnicalSource) => <li key={item.id}>
    {seek ? <button type="button" onClick={() => seek(item.start)}>{item.start.toFixed(2)}s</button> : `${item.start.toFixed(2)}s`}
    {' · '}{item.kind === 'ocr' ? 'Raw OCR reading · ' : ''}{item.text}{item.end > item.start && ` · through ${item.end.toFixed(2)}s`}
    {typeof item.score === 'number' && ` · OCR score ${item.score.toFixed(2)}`}
  </li>
  return <div>
    {shot.findings?.length ? shot.findings.map(finding => <details key={finding.topic}>
      <summary>{finding.topic} · Inferred · {finding.confidence} confidence</summary>
      <p>{finding.summary}</p>
      <ul>{finding.evidence.map(source)}</ul>
    </details>) : <p>Technical interpretations unavailable for this shot.</p>}
    {shot.sources.some(item => item.measurement) && <details><summary>Measured evidence</summary>
      <ul>{shot.sources.filter(item => item.measurement).map(source)}</ul>
      {shot.sources.filter(item => item.kind === 'frame' && item.measurement).map(item => {
        const values = item.measurement!
        return <p key={item.id}>{item.start.toFixed(2)}s · Mean luma {String(values.sample_luma_0_255)}/255
          {' · '}Luma deviation {String(values.sample_luma_stddev)} · Mean saturation {String(values.sample_saturation_percent)}%
          {' · '}Palette {(values.sample_palette as string[]).join(', ')}</p>
      })}
    </details>}
  </div>
}

export function TechnicalAudioEvidence({events, seek}: {events: AudioEvent[]; seek?: (seconds: number) => void}) {
  return <ul>{events.map(event => <li key={`${event.kind}-${event.label}-${event.start}`}>
    <details><summary>{event.label} · {event.kind} · {event.confidence} confidence</summary>
      <p>{seek ? <button type="button" onClick={() => seek(event.start)}>{event.start.toFixed(2)}s</button> : `${event.start.toFixed(2)}s`}
        {' – '}{event.end.toFixed(2)}s · Model score {event.score.toFixed(2)}</p>
      <p>{event.evidence}</p>
      {event.purpose && <p>{event.purpose} · Inferred · {event.purpose_confidence} confidence</p>}
      {event.tempo_bpm && <p>Estimated pulse {event.tempo_bpm} BPM from repeated energy onsets in the mix.</p>}
    </details>
  </li>)}</ul>
}

export function TechnicalSceneEvidence({scene, seek}: {scene: TechnicalReport['scenes'][number]; seek?: (seconds: number) => void}) {
  return <div>
    <p>{scene.summary ?? 'Scene summary unavailable in this saved report.'}</p>
    {scene.findings?.map(finding => <TechnicalShotEvidence key={`${finding.shot}-${finding.topic}`}
      shot={{number: finding.shot, start: scene.start, end: scene.end, findings: [finding], sources: []}} seek={seek} />)}
    {!!scene.audio?.length && <TechnicalAudioEvidence events={scene.audio} seek={seek} />}
  </div>
}
