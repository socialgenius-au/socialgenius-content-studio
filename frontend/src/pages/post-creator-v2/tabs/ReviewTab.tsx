import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Info, Loader2, Save } from 'lucide-react'
import { withMediaToken } from '../../../api/mediaAccess'
import { BrandTokensContext } from '../../../lib/carousel/brandContext'
import { browserBackend, downloadBytes } from '../../../lib/carousel/browserBackend'
import SlideView from '../../carousel-creator/components/SlideView'
import ExportPanel from '../../carousel-creator/components/ExportPanel'
import { SaveBadge } from '../../carousel-creator/components/SyncStatus'
import { postCreatorPlatforms } from '../format/formatState'
import { exportForPlatforms, platformExports } from '../postExport'
import { usePostSession } from '../session'
import { checkSummary, reviewChecks } from '../workflow'

export default function ReviewTab({ onBack, onGoCreate }: { onBack: () => void; onGoCreate: () => void }) {
  const s = usePostSession()
  const { doc } = s
  const checks = useMemo(() => reviewChecks(doc), [doc])
  const sum = checkSummary(checks)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [extra, setExtra] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [exportMsg, setExportMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const platforms = postCreatorPlatforms()
  const targets = platformExports(doc, extra)

  const save = async () => {
    setSaving(true); setSaveMsg(null)
    try { setSaveMsg((await s.saveNow()) ? { tone: 'ok', text: 'Saved to your account. Reopen it any time from your drafts.' } : { tone: 'error', text: 'Could not save yet. Your changes are kept in this browser and the editor keeps retrying.' }) }
    finally { setSaving(false) }
  }
  const exportPlatforms = async () => {
    setBusy(true); setExportMsg(null)
    const ctl = new AbortController(); abort.current = ctl
    try {
      if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready
      const f = await exportForPlatforms(doc, extra, browserBackend(), { resolveUrl: withMediaToken, tokens: s.tokens, signal: ctl.signal })
      downloadBytes(f.name, f.mime, f.bytes)
      setExportMsg({ tone: 'ok', text: `Downloaded ${f.name} (${(f.bytes.length / 1024 / 1024).toFixed(2)} MB): the post as designed plus ${targets.length} re-laid-out size${targets.length === 1 ? '' : 's'}. Check each one before posting.` })
    } catch (e) { setExportMsg({ tone: 'error', text: e instanceof Error ? e.message : 'The export failed.' }) } finally { setBusy(false); abort.current = null }
  }
  const toggle = (k: string) => setExtra(cur => (cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]))

  return (
    <BrandTokensContext.Provider value={s.tokens}>
      <div>
        <div className="pcv2-stage-head"><span className="pcv2-stage-num">5</span><span className="pcv2-stage-title">Review</span></div>
        <p className="pcv2-stage-sub">Check the finished post, save it and export it</p>

        <div className="pcv2-review-layout" style={{ marginTop: 20 }}>
          <div>
            <div className="pcv2-review-preview" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }} data-testid="pcv2-review-preview">
              <SlideView doc={doc} pageId={doc.pages[0].id} style={{ width: '100%', maxHeight: 520 }} />
            </div>
            <div className="pcv2-card" style={{ marginTop: 16 }}>
              <h3 className="pcv2-card-title">Draft</h3>
              <p className="pcv2-card-sub">{doc.title} · {doc.format.platformKey} · {doc.format.width} × {doc.format.height}</p>
              <div style={{ margin: '8px 0' }}><SaveBadge state={s.sync} onRetry={s.retry} /></div>
              <button type="button" className="pcv2-btn pcv2-btn-primary pcv2-btn-block" disabled={saving} onClick={() => void save()} data-testid="pcv2-save-draft">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save draft
              </button>
              {saveMsg && <p role={saveMsg.tone === 'error' ? 'alert' : 'status'} className="pcv2-source-note" data-testid="pcv2-save-message">{saveMsg.text}</p>}
              <p className="pcv2-source-note">Changes also save automatically as you work.</p>
            </div>
          </div>

          <div>
            <div className="pcv2-card" style={{ marginBottom: 20 }} data-testid="pcv2-checks">
              <h3 className="pcv2-card-title">Pre-publish checks</h3>
              <p className="pcv2-card-sub">Facts about this post, checked against your brief. There is no quality score: nothing here predicts how the post will perform.</p>
              <p style={{ margin: '6px 0 10px', fontWeight: 700 }} data-testid="pcv2-check-summary">{sum.passed} of {sum.total} checks passed{sum.warnings > 0 ? ` · ${sum.warnings} to look at` : ''}</p>
              <ul className="pcv2-insight-list">
                {checks.map(c => (
                  <li key={c.id} data-testid="pcv2-check" data-status={c.status}>
                    {c.status === 'pass' ? <CheckCircle2 size={15} /> : c.status === 'warn' ? <AlertTriangle size={15} /> : <Info size={15} />}
                    <span>{c.label}{c.detail && <><br /><span className="pcv2-card-sub">{c.detail}</span></>}</span>
                  </li>
                ))}
              </ul>
              {sum.warnings > 0 && <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={onGoCreate}>← Fix in Create</button>}
            </div>

            <div className="pcv2-card" style={{ marginBottom: 20 }} data-testid="pcv2-export-card">
              <h3 className="pcv2-card-title"><Download size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Export the finished post</h3>
              <p className="pcv2-card-sub">PNG, JPEG, SVG or PDF, at the size you choose.</p>
              <ExportPanel doc={doc} activeIndex={0} />
            </div>

            <div className="pcv2-card" style={{ marginBottom: 20 }} data-testid="pcv2-platforms-card">
              <h3 className="pcv2-card-title">Also export for other platforms</h3>
              <p className="pcv2-card-sub">The post is re-laid out for each size you pick; every layer is kept. Exported as one ZIP of PNG files.</p>
              <div className="pcv2-platform-row">
                {platforms.map(p => {
                  const primary = p.key === doc.format.platformKey
                  const selected = primary || extra.includes(p.key)
                  return <button key={p.key} type="button" data-testid={`pcv2-publish-${p.key}`} className={`pcv2-platform-pill ${selected ? 'is-selected' : ''}`} aria-pressed={selected} disabled={primary} title={primary ? `Primary platform (${doc.format.width} × ${doc.format.height}). Change it in Create → Format.` : undefined} onClick={() => toggle(p.key)}>{p.label}</button>
                })}
              </div>
              <button type="button" className="pcv2-btn pcv2-btn-secondary" style={{ marginTop: 12 }} disabled={busy || targets.length === 0} onClick={() => void exportPlatforms()} data-testid="pcv2-export-platforms">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export ZIP ({targets.length + 1} size{targets.length === 0 ? '' : 's'})
              </button>
              {exportMsg && <p role={exportMsg.tone === 'error' ? 'alert' : 'status'} className="pcv2-source-note" data-testid="pcv2-platforms-message">{exportMsg.text}</p>}
            </div>

            <div className="pcv2-card" data-testid="pcv2-publishing-note">
              <h3 className="pcv2-card-title">Publishing</h3>
              <p className="pcv2-card-sub">Posting to social platforms and approval requests are not connected in this release, so there are no publish or approval buttons. Export the finished post above and upload it on the platform.</p>
            </div>
          </div>
        </div>

        <div className="pcv2-footer-nav" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={onBack}>← Create</button>
        </div>
      </div>
    </BrandTokensContext.Provider>
  )
}
