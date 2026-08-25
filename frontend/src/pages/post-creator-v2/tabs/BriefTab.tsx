import { CheckCircle2, AlertTriangle, Radar, Target, Palette, Users2 } from 'lucide-react'
import { MOCK_CLIENT } from '../mockData'

function StatusRow({
  icon: Icon,
  label,
  status,
}: {
  icon: typeof CheckCircle2
  label: string
  status: 'complete' | 'needs-refresh'
}) {
  return (
    <div className="pcv2-readonly-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="pcv2-status-icon">
          <Icon size={15} />
        </span>
        <span className="pcv2-readonly-label">{label}</span>
      </div>
      {status === 'complete' ? (
        <span className="pcv2-badge pcv2-badge-success">
          <CheckCircle2 size={12} /> Complete
        </span>
      ) : (
        <span className="pcv2-badge pcv2-badge-warning">
          <AlertTriangle size={12} /> Needs refresh
        </span>
      )}
    </div>
  )
}

export default function BriefTab({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <div className="pcv2-stage-head">
        <span className="pcv2-stage-num">1</span>
        <span className="pcv2-stage-title">Brief</span>
      </div>
      <p className="pcv2-stage-sub">Define what we're creating</p>

      <div className="pcv2-grid-2" style={{ marginTop: 20 }}>
        {/* Inherited from Content Studio — read-only */}
        <div className="pcv2-card">
          <h3 className="pcv2-card-title">Inherited from Content Studio</h3>
          <p className="pcv2-card-sub">Read-only — managed in Clients &amp; Intelligence</p>

          <div className="pcv2-client-card">
            <div className="pcv2-client-avatar">{MOCK_CLIENT.initials}</div>
            <div>
              <div className="pcv2-client-name">{MOCK_CLIENT.name}</div>
              <div className="pcv2-client-meta">{MOCK_CLIENT.industry}</div>
            </div>
          </div>

          <StatusRow icon={Palette} label="Brand Kit" status={MOCK_CLIENT.brandKitStatus} />
          <StatusRow icon={Users2} label="Research" status={MOCK_CLIENT.researchStatus} />
          <StatusRow icon={Target} label="Positioning" status={MOCK_CLIENT.positioningStatus} />
          <StatusRow icon={Radar} label="Competitor Intelligence" status={MOCK_CLIENT.competitorIntelStatus} />
        </div>

        {/* Post-specific variables — editable */}
        <div className="pcv2-card">
          <h3 className="pcv2-card-title">Post Details</h3>
          <p className="pcv2-card-sub">Only these fields are edited per post</p>

          <div className="pcv2-field">
            <label className="pcv2-label">Target Segment</label>
            <select className="pcv2-select" defaultValue="Builders">
              <option>Builders</option>
              <option>Homeowners</option>
              <option>Trade Accounts</option>
            </select>
          </div>

          <div className="pcv2-field">
            <label className="pcv2-label">Goal / Objective</label>
            <select className="pcv2-select" defaultValue="Generate Enquiries">
              <option>Generate Enquiries</option>
              <option>Drive Traffic</option>
              <option>Brand Awareness</option>
            </select>
          </div>

          <div className="pcv2-field">
            <label className="pcv2-label">Product / Offer</label>
            <select className="pcv2-select" defaultValue="Metro Grey 600x600 Porcelain Tile">
              <option>Metro Grey 600x600 Porcelain Tile</option>
              <option>Riverstone Sandstone Pavers</option>
              <option>Coastal Oak Timber-Look Plank</option>
            </select>
          </div>

          <div className="pcv2-field">
            <label className="pcv2-label">Platform / Format</label>
            <select className="pcv2-select" defaultValue="Instagram Feed — Square">
              <option>Instagram Feed — Square</option>
              <option>Instagram Story — 9:16</option>
              <option>Facebook Feed — Landscape</option>
              <option>LinkedIn — Square</option>
            </select>
          </div>

          <div className="pcv2-field">
            <label className="pcv2-label">
              Key Message <span className="pcv2-label-optional">(Optional)</span>
            </label>
            <textarea
              className="pcv2-textarea"
              defaultValue="Large format. In stock. Fast delivery for Western Sydney builders."
            />
          </div>

          <div className="pcv2-field">
            <label className="pcv2-label">Call to Action</label>
            <select className="pcv2-select" defaultValue="Send Your Tile Schedule">
              <option>Send Your Tile Schedule</option>
              <option>Get a Trade Quote</option>
              <option>Visit the Showroom</option>
            </select>
          </div>

          <div className="pcv2-field">
            <label className="pcv2-label">
              Special Instructions <span className="pcv2-label-optional">(Optional)</span>
            </label>
            <textarea className="pcv2-textarea" placeholder="Anything the AI should know for this post specifically…" />
          </div>
        </div>
      </div>

      <div className="pcv2-footer-nav" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="pcv2-btn pcv2-btn-primary" onClick={onNext}>
          Next: Intelligence →
        </button>
      </div>
    </div>
  )
}
