import { useState } from 'react'

type Source = {
  id: string
  kind: string
  text: string
  start?: number
  end?: number
  citations?: {url: string; title: string}[]
}
type Entry = {
  group: string
  label: string
  detail: string
  confidence: string
  scope: 'reference' | 'recommendation'
  evidence: Source[]
}

const sections = ['Summary', 'Keywords', 'Hashtags', 'SEO', 'GEO', 'AEO', 'Local', 'Recommendations'] as const
export type DiscoverabilityReportData = {
  sections: Partial<Record<typeof sections[number], Entry[]>>
  market: string
}

export function DiscoverabilityReport({report, seek}: {report: DiscoverabilityReportData; seek?: (seconds: number) => void}) {
  const [section, setSection] = useState<typeof sections[number]>('Summary')
  const entries = report.sections[section] ?? []
  const groups = [...new Set(entries.map(item => item.group))]
  return <section aria-label="Structured Discoverability report">
    <div className="dc3-actions" aria-label="Discoverability sections">
      {sections.map(name => <button type="button" key={name} aria-pressed={section === name}
        onClick={() => setSection(name)}>{name}</button>)}
    </div>
    {report.market && <p>Target market · {report.market}</p>}
    {!entries.length && <p>No supported findings for this section.</p>}
    {groups.map(group => <section key={group}>
      <h3>{group}</h3>
      {entries.filter(entry => entry.group === group).map(entry => <article key={entry.label}>
        <h4>{entry.label}</h4>
        <p>{entry.detail}</p>
        <small>{entry.scope === 'reference' ? 'Reference finding' : 'Recommendation for reconstructed content'} · {entry.confidence} confidence</small>
        <details><summary>Supporting evidence ({entry.evidence.length})</summary>
          <ul>{entry.evidence.map(item => <li key={item.id}>
            <strong>{item.kind}</strong> · {item.text}
            {item.start !== undefined && (seek ?
              <button type="button" onClick={() => seek(item.start!)}>{item.start.toFixed(2)}s</button> :
              <small> · {item.start.toFixed(2)}s</small>)}
            {item.citations?.filter(source => /^https?:\/\//i.test(source.url)).map(source =>
              <p key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></p>)}
          </li>)}</ul>
        </details>
      </article>)}
    </section>)}
  </section>
}
