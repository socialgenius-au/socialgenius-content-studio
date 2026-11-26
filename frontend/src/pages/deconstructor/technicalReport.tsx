type TechnicalSource = {
  id: string
  kind: string
  start: number
  end: number
  text: string
  measurement?: Record<string, unknown>
}
type TechnicalShot = {
  number: number
  start: number
  end: number
  findings?: {topic: string; summary: string; confidence: string; evidence: TechnicalSource[]}[]
  sources: TechnicalSource[]
}
export type TechnicalReport = {
  shots: TechnicalShot[]
  scenes: {number: number; start: number; end: number; shots: number[]}[]
  limitations: string[]
}

export function TechnicalShotEvidence({shot, seek}: {shot: TechnicalShot; seek?: (seconds: number) => void}) {
  const source = (item: TechnicalSource) => <li key={item.id}>
    {seek ? <button type="button" onClick={() => seek(item.start)}>{item.start.toFixed(2)}s</button> : `${item.start.toFixed(2)}s`}
    {' · '}{item.text}{item.end > item.start && ` · through ${item.end.toFixed(2)}s`}
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
