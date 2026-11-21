import { Loader2, Palette, FileText } from 'lucide-react'
import type { BrandKitSummary } from '../../../lib/carousel/brandKit'
import type { ServerCarouselSummary } from '../../../lib/carousel/serverStore'
import { FormatSelect, PlatformSelect, CustomSizeInputs, sizeReadout } from '../components/FormatFields'
import CommitField from '../components/CommitField'
import { usePostFormat } from '../format/PostFormatContext'
import { useOptionalPostSession } from '../session'
import { GOALS, THEMES, type PostBrief } from '../workflow'

export interface BriefTabProps {
  /** The brief being written before the post exists (once it is started, the post's own saved brief is used). */
  draftBrief: PostBrief
  onDraftBrief: (patch: Partial<PostBrief>) => void
  kits: BrandKitSummary[] | null
  onStart: () => void
  starting: boolean
  startError: string | null
  drafts: ServerCarouselSummary[] | null
  draftsError: string | null
  onOpenDraft: (id: string) => void
  openingId: string | null
  onNext: () => void
}

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }

export default function BriefTab(p: BriefTabProps) {
  const session = useOptionalPostSession()
  const { canvas } = usePostFormat()
  const brief = session ? session.workflow.brief : p.draftBrief
  const set = (patch: Partial<PostBrief>) => { if (session) session.updateBrief(patch); else p.onDraftBrief(patch) }
  const select = (label: string, value: string, options: readonly string[], onChange: (v: string) => void, testId: string) => (
    <div className="pcv2-field"><label className="pcv2-label">{label}</label>
      <select className="pcv2-select" value={value} data-testid={testId} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o}>{o}</option>)}</select></div>
  )
  const field = (label: string, optional: boolean, node: React.ReactNode) => (
    <div className="pcv2-field"><label className="pcv2-label">{label}{optional && <span className="pcv2-label-optional"> (Optional)</span>}</label>{node}</div>
  )

  return (
    <div>
      <div className="pcv2-stage-head"><span className="pcv2-stage-num">1</span><span className="pcv2-stage-title">Brief</span></div>
      <p className="pcv2-stage-sub">{session ? 'Your brief is saved with this post. Change anything at any time.' : 'Define what we are creating, then start the post. It is saved to your account as you work.'}</p>

      <div className="pcv2-grid-2" style={{ marginTop: 20 }}>
        <div className="pcv2-card" data-testid="pcv2-brief-source">
          {session ? (
            <>
              <h3 className="pcv2-card-title">This post</h3>
              <p className="pcv2-card-sub">Saved in your account. Reopen it any time from your drafts.</p>
              <div className="pcv2-readonly-row"><span className="pcv2-readonly-label">Format</span><span className="pcv2-readonly-value">{session.doc.format.platformKey} · {session.doc.format.width} × {session.doc.format.height} · {session.doc.format.ratio}</span></div>
              <div className="pcv2-readonly-row"><span className="pcv2-readonly-label"><Palette size={14} style={{ verticalAlign: -2 }} /> Brand Kit</span><span className="pcv2-readonly-value">{session.kit ? session.kit.name : 'None applied (choose one in Create → Brand)'}</span></div>
              <p className="pcv2-source-note" style={{ marginTop: 12 }}>To change the size or platform, use Create → Format: the post is re-laid out and every layer stays editable.</p>
            </>
          ) : (
            <>
              <h3 className="pcv2-card-title">Your drafts</h3>
              <p className="pcv2-card-sub">Posts you have saved. Open one to keep working on it.</p>
              {p.draftsError && <p role="alert" className="pcv2-source-note" data-testid="pcv2-drafts-error">{p.draftsError}</p>}
              {p.drafts === null && !p.draftsError && <p className="pcv2-card-sub">Loading your drafts…</p>}
              {p.drafts?.length === 0 && <p className="pcv2-card-sub" data-testid="pcv2-no-drafts">No saved posts yet. Fill in the brief and start your first one.</p>}
              <ul className="pcv2-insight-list" data-testid="pcv2-draft-list">
                {(p.drafts ?? []).map(d => (
                  <li key={d.id} style={{ justifyContent: 'space-between', gap: 8 }}>
                    <span><FileText size={14} style={{ verticalAlign: -2 }} /> <strong>{d.title}</strong><br /><span className="pcv2-card-sub">{d.platformKey} · {d.formatKey} · {when(d.updatedAt)}</span></span>
                    <button type="button" className="pcv2-btn pcv2-btn-secondary" disabled={p.openingId !== null} onClick={() => p.onOpenDraft(d.id)} data-testid="pcv2-open-draft">{p.openingId === d.id ? 'Opening…' : 'Open'}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="pcv2-card">
          <h3 className="pcv2-card-title">Post details</h3>
          <p className="pcv2-card-sub">These shape the starting design and are checked again in Review.</p>
          {field('Post name', false, <CommitField value={brief.title} onCommit={v => set({ title: v })} placeholder="e.g. Autumn tile sale" ariaLabel="Post name" testId="pcv2-brief-title" maxLength={120} />)}
          {field('Target audience', true, <CommitField value={brief.audience} onCommit={v => set({ audience: v })} placeholder="Who is this for?" ariaLabel="Target audience" testId="pcv2-brief-audience" maxLength={200} />)}
          {select('Goal / objective', brief.goal, GOALS, v => set({ goal: v }), 'pcv2-brief-goal')}
          {field('Product / offer', true, <CommitField value={brief.product} onCommit={v => set({ product: v })} placeholder="What are you promoting?" ariaLabel="Product or offer" testId="pcv2-brief-product" maxLength={200} />)}
          {!session && (
            <div className="pcv2-field"><label className="pcv2-label">Platform / format</label>
              <div className="pcv2-pill-row" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
                <PlatformSelect testId="pcv2-brief-platform" ariaLabel="Platform" />
                <FormatSelect testId="pcv2-brief-format" ariaLabel="Format" />
              </div>
              <CustomSizeInputs />
              <p className="pcv2-source-note">Canvas: {sizeReadout(canvas)}</p>
            </div>
          )}
          {field('Key message', true, <CommitField multiline value={brief.keyMessage} onCommit={v => set({ keyMessage: v })} placeholder="The one thing the post must say" ariaLabel="Key message" testId="pcv2-brief-message" maxLength={300} />)}
          {field('Call to action', true, <CommitField value={brief.cta} onCommit={v => set({ cta: v })} placeholder="e.g. Get a quote" ariaLabel="Call to action" testId="pcv2-brief-cta" maxLength={80} />)}
          {!session && select('Colour style', THEMES.find(t => t.id === brief.themeId)?.label ?? THEMES[0].label, THEMES.map(t => t.label), v => set({ themeId: THEMES.find(t => t.label === v)?.id ?? THEMES[0].id }), 'pcv2-brief-theme')}
          {!session && (
            <div className="pcv2-field"><label className="pcv2-label">Brand Kit <span className="pcv2-label-optional">(Optional)</span></label>
              <select className="pcv2-select" data-testid="pcv2-brief-kit" value={brief.brandKitId ?? ''} disabled={p.kits === null} onChange={e => set({ brandKitId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No Brand Kit</option>
                {(p.kits ?? []).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
              <p className="pcv2-source-note">Applies your colours and fonts when the post starts. Create and edit kits in the Carousel Creator.</p>
            </div>
          )}
          {field('Special instructions', true, <CommitField multiline value={brief.instructions} onCommit={v => set({ instructions: v })} placeholder="Anything to remember for this post (kept as a note; it is not sent to any AI)" ariaLabel="Special instructions" testId="pcv2-brief-instructions" maxLength={1000} />)}
          {p.startError && <p role="alert" className="pcv2-source-note" data-testid="pcv2-start-error">{p.startError}</p>}
        </div>
      </div>

      <div className="pcv2-footer-nav" style={{ justifyContent: 'flex-end' }}>
        {session
          ? <button type="button" className="pcv2-btn pcv2-btn-primary" onClick={p.onNext} data-testid="pcv2-next">Next: Intelligence →</button>
          : <button type="button" className="pcv2-btn pcv2-btn-primary" disabled={p.starting} onClick={p.onStart} data-testid="pcv2-start">{p.starting ? <><Loader2 size={14} className="animate-spin" /> Starting…</> : 'Start post →'}</button>}
      </div>
    </div>
  )
}
