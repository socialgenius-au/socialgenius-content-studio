import PostWorkspace from '../components/PostWorkspace'

export default function CreateTab({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div>
      <PostWorkspace />

      <div className="pcv2-footer-nav pcv2-editor-review-nav">
        <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={onBack}>← References</button>
        <button type="button" className="pcv2-btn pcv2-btn-primary" onClick={onNext} data-testid="pcv2-next">Next: Review →</button>
      </div>
    </div>
  )
}
