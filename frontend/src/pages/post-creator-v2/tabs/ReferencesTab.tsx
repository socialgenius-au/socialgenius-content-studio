import { ImagePlus, Info, Trash2 } from 'lucide-react'
import { withMediaToken } from '../../../api/mediaAccess'
import ImagePicker, { type PickedImage } from '../../carousel-creator/components/ImagePicker'
import CommitField from '../components/CommitField'
import { usePostSession } from '../session'
import { MAX_REFERENCES, type PostReference } from '../workflow'

export default function ReferencesTab({ onNext, onBack, onGoCreate }: { onNext: () => void; onBack: () => void; onGoCreate: () => void }) {
  const s = usePostSession()
  const refs = s.workflow.references
  const full = refs.length >= MAX_REFERENCES
  const add = (img: PickedImage) => {
    if (refs.some(r => r.assetId === img.assetId) || full) return
    s.setWorkflow(w => ({ ...w, references: [...w.references, { id: `ref_${img.assetId}`, assetId: img.assetId, url: img.url, name: img.name, note: '' }] }))
  }
  const update = (id: string, patch: Partial<PostReference>) => s.setWorkflow(w => ({ ...w, references: w.references.map(r => (r.id === id ? { ...r, ...patch } : r)) }))
  const remove = (id: string) => s.setWorkflow(w => ({ ...w, references: w.references.filter(r => r.id !== id) }))
  const useOnCanvas = (r: PostReference) => { s.dispatch({ type: 'addImages', items: [{ assetId: r.assetId, url: r.url, name: r.name || 'Reference' }] }); onGoCreate() }

  return (
    <div>
      <div className="pcv2-stage-head"><span className="pcv2-stage-num">3</span><span className="pcv2-stage-title">References</span></div>
      <p className="pcv2-stage-sub">Pictures and inspiration for this post</p>

      <div className="pcv2-source-note" role="note" data-testid="pcv2-references-honesty" style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Info size={14} style={{ marginTop: 2, flex: 'none' }} />
        <span>Add your own pictures here: upload new ones or choose from your library. There is no competitor or popular-post feed connected, so none is shown. To study how a video works, use the <a href="/deconstructor">Deconstructor</a>.</span>
      </div>

      <div className="pcv2-grid-2" style={{ marginTop: 16 }}>
        <div className="pcv2-card" data-testid="pcv2-reference-picker">
          <h3 className="pcv2-card-title">Add a picture</h3>
          <p className="pcv2-card-sub">{full ? `You have added the most (${MAX_REFERENCES}). Remove one to add another.` : 'Upload one or choose from your library (up to 12).'}</p>
          {!full && <ImagePicker onPick={add} />}
        </div>

        <div className="pcv2-card" data-testid="pcv2-reference-list">
          <h3 className="pcv2-card-title">Chosen references ({refs.length})</h3>
          <p className="pcv2-card-sub">Add a note on why each one is useful, or place it on the canvas.</p>
          {refs.length === 0 && <p className="pcv2-card-sub" data-testid="pcv2-no-references">Nothing chosen yet. This stage is optional.</p>}
          {refs.map(r => (
            <div key={r.id} data-testid="pcv2-reference" style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 10, padding: '10px 0', borderTop: '1px solid var(--pcv2-border)' }}>
              <img src={withMediaToken(r.url)} alt={r.name} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }} />
              <div>
                <div className="pcv2-label" style={{ marginBottom: 4 }}>{r.name || 'Picture'}</div>
                <CommitField value={r.note} onCommit={v => update(r.id, { note: v })} placeholder="Why this reference?" ariaLabel={`Note for ${r.name}`} maxLength={500} />
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={() => useOnCanvas(r)} data-testid="pcv2-use-on-canvas"><ImagePlus size={14} /> Use on canvas</button>
                  <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={() => remove(r.id)} aria-label={`Remove ${r.name}`}><Trash2 size={14} /> Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pcv2-footer-nav">
        <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={onBack}>← Intelligence</button>
        <button type="button" className="pcv2-btn pcv2-btn-primary" onClick={onNext} data-testid="pcv2-next">Next: Create →</button>
      </div>
    </div>
  )
}
