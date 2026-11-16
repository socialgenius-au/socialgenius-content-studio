import { useState } from 'react'
import { generateApi } from '../../../api/client'

export type CreativeTask = 'hook_generation' | 'script_generation' | 'caption_generation' | 'thumbnail_ideas'

const TASKS: ReadonlyArray<{ key: CreativeTask; title: string; hint: string }> = [
  { key: 'hook_generation', title: 'AI Hook Suggestion', hint: 'Three original hooks with first-shot directions' },
  { key: 'script_generation', title: 'AI Script Writer', hint: 'Scene-by-scene script with visuals and CTA' },
  { key: 'caption_generation', title: 'AI Caption Generator', hint: 'Caption, CTA and hashtags' },
  { key: 'thumbnail_ideas', title: 'AI Thumbnail Ideas', hint: 'Three practical thumbnail concepts' },
]

export interface CreativeToolsPanelProps {
  context: Record<string, unknown>
  onUseText?: (text: string, task: CreativeTask) => void
}

/** Does not write to drafts or trigger paid calls on mount. Every generation requires a click. */
export default function CreativeToolsPanel({ context, onUseText }: CreativeToolsPanelProps) {
  const [task, setTask] = useState<CreativeTask>('hook_generation')
  const [instruction, setInstruction] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const generate = async () => {
    if (!instruction.trim() || loading) return
    setLoading(true)
    setError('')
    setResult('')
    try {
      const response = await generateApi.creativeTool({ task, instruction: instruction.trim(), context })
      setResult(response.data.content)
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Generation failed. No content was applied to the video.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section aria-label="Creative AI tools">
      <h3>Creative AI tools</h3>
      <p>Suggestions are editable and never automatically overwrite your video. Paid AI calls are blocked while spending is disabled.</p>
      <label htmlFor="creative-tool-select">Tool</label>
      <select id="creative-tool-select" value={task} disabled={loading}
        onChange={event => { setTask(event.target.value as CreativeTask); setResult(''); setError('') }}>
        {TASKS.map(t => <option key={t.key} value={t.key}>{t.title}</option>)}
      </select>
      <p>{TASKS.find(t => t.key === task)?.hint}</p>
      <label htmlFor="creative-tool-instruction">What should this video communicate?</label>
      <textarea id="creative-tool-instruction" value={instruction} rows={3}
        onChange={event => setInstruction(event.target.value)} disabled={loading}
        placeholder="Describe the target business, audience, objective and any constraints." />
      <button type="button" onClick={generate} disabled={loading || !instruction.trim()}>
        {loading ? 'Generating…' : 'Generate'}
      </button>
      {error && <p role="alert">{error}</p>}
      {result && <div>
        <label htmlFor="creative-tool-output">Generated content (editable)</label>
        <textarea id="creative-tool-output" value={result} rows={10}
          onChange={event => setResult(event.target.value)} />
        <button type="button" onClick={() => { void navigator.clipboard.writeText(result) }}>Copy</button>
        {onUseText && <button type="button" onClick={() => onUseText(result, task)}>Use in editor</button>}
      </div>}
    </section>
  )
}
