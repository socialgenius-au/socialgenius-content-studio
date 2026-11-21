import { Info } from 'lucide-react'
import PostWorkspace from '../components/PostWorkspace'

export default function CreateTab({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div>
      <div className="pcv2-stage-head"><span className="pcv2-stage-num">4</span><span className="pcv2-stage-title">Create</span></div>
      <p className="pcv2-stage-sub">Design your post. Click anything on the canvas to edit it; every change is saved automatically.</p>

      <div className="pcv2-source-note" role="note" data-testid="pcv2-create-honesty" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Info size={14} style={{ marginTop: 2, flex: 'none' }} />
        <span>Everything here is hand-editing: text, shapes, pictures, backgrounds, layers, Brand Kit and size. AI generation (text or images) is not connected to Post Creator, so no AI options are shown.</span>
      </div>

      <PostWorkspace />

      <div className="pcv2-footer-nav">
        <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={onBack}>← References</button>
        <button type="button" className="pcv2-btn pcv2-btn-primary" onClick={onNext} data-testid="pcv2-next">Next: Review →</button>
      </div>
    </div>
  )
}
