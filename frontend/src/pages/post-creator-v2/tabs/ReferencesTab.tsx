import { useState } from 'react'
import { Eye, Heart, Wand2, BookmarkPlus, Sparkles } from 'lucide-react'
import { REFERENCE_LIBRARY, REFERENCE_DETAIL } from '../mockData'

const SUBTABS = ['Our Library', 'Competitors', 'Popular Posts', 'Upload New'] as const

// Deterministic placeholder colours per card so the grid reads as distinct
// reference tiles without needing real imagery for a UI-only pass.
const SWATCHES = ['#3d4a44', '#4a4038', '#37424a', '#4a3d47', '#3f4a3d', '#454a3d', '#3d454a', '#4a4340']

export default function ReferencesTab({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [subtab, setSubtab] = useState<(typeof SUBTABS)[number]>('Our Library')
  const [selected, setSelected] = useState<string | null>('r1')

  const selectedRef = REFERENCE_LIBRARY.find((r) => r.id === selected)

  return (
    <div>
      <div className="pcv2-stage-head">
        <span className="pcv2-stage-num">3</span>
        <span className="pcv2-stage-title">References</span>
      </div>
      <p className="pcv2-stage-sub">Learn from what works</p>

      <div className="pcv2-subtabs" style={{ marginTop: 20 }}>
        {SUBTABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`pcv2-subtab ${subtab === t ? 'is-active' : ''}`}
            onClick={() => setSubtab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="pcv2-filters">
        <select className="pcv2-select" defaultValue="Building Materials">
          <option>Building Materials</option>
          <option>Automotive</option>
          <option>Retail</option>
        </select>
        <select className="pcv2-select" defaultValue="Tile & Stone">
          <option>Tile & Stone</option>
          <option>Timber</option>
          <option>Fixtures</option>
        </select>
        <select className="pcv2-select" defaultValue="Builders">
          <option>Builders</option>
          <option>Homeowners</option>
          <option>Trade Accounts</option>
        </select>
        <select className="pcv2-select" defaultValue="Generate Enquiries">
          <option>Generate Enquiries</option>
          <option>Brand Awareness</option>
          <option>Drive Traffic</option>
        </select>
        <select className="pcv2-select" defaultValue="Instagram">
          <option>Instagram</option>
          <option>Facebook</option>
          <option>LinkedIn</option>
        </select>
        <select className="pcv2-select" defaultValue="Western Sydney">
          <option>Western Sydney</option>
          <option>All Regions</option>
        </select>
      </div>

      <div className="pcv2-ref-grid">
        {REFERENCE_LIBRARY.map((ref, i) => (
          <button
            key={ref.id}
            type="button"
            className={`pcv2-ref-card ${selected === ref.id ? 'is-selected' : ''}`}
            onClick={() => setSelected(ref.id)}
          >
            <div className="pcv2-ref-thumb" style={{ background: SWATCHES[i % SWATCHES.length] }} />
            <div className="pcv2-ref-stats">
              <span>
                <Eye size={12} /> {ref.views}
              </span>
              <span>
                <Heart size={12} /> {ref.likes}
              </span>
            </div>
          </button>
        ))}
      </div>

      {selectedRef && (
        <div className="pcv2-ref-detail">
          <div className="pcv2-ref-detail-grid">
            <div
              className="pcv2-ref-detail-img"
              style={{ background: SWATCHES[REFERENCE_LIBRARY.indexOf(selectedRef) % SWATCHES.length] }}
            />
            <div>
              <h3 className="pcv2-card-title">{selectedRef.title}</h3>
              <div className="pcv2-grid-2" style={{ marginTop: 12 }}>
                <div>
                  <p className="pcv2-label" style={{ marginBottom: 4 }}>Why It Worked</p>
                  <p className="pcv2-card-sub" style={{ marginBottom: 12 }}>{REFERENCE_DETAIL.whyItWorked}</p>
                  <p className="pcv2-label" style={{ marginBottom: 4 }}>Breakdown</p>
                  <p className="pcv2-card-sub" style={{ marginBottom: 12 }}>{REFERENCE_DETAIL.breakdown}</p>
                  <p className="pcv2-label" style={{ marginBottom: 4 }}>Key Elements</p>
                  <ul className="pcv2-insight-list">
                    {REFERENCE_DETAIL.keyElements.map((k, i) => (
                      <li key={i}>• {k}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="pcv2-label" style={{ marginBottom: 4 }}>Transferable Mechanism</p>
                  <p className="pcv2-card-sub" style={{ marginBottom: 12 }}>{REFERENCE_DETAIL.transferableMechanism}</p>
                  <p className="pcv2-label" style={{ marginBottom: 4 }}>How to Adapt</p>
                  <p className="pcv2-card-sub" style={{ marginBottom: 16 }}>{REFERENCE_DETAIL.howToAdapt}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="pcv2-btn pcv2-btn-secondary">
                      <Wand2 size={14} /> Deconstruct
                    </button>
                    <button type="button" className="pcv2-btn pcv2-btn-secondary">
                      <BookmarkPlus size={14} /> Use as Reference
                    </button>
                    <button type="button" className="pcv2-btn pcv2-btn-primary">
                      <Sparkles size={14} /> Adapt for Client
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="pcv2-footer-nav">
        <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={onBack}>
          ← Intelligence
        </button>
        <button type="button" className="pcv2-btn pcv2-btn-primary" onClick={onNext}>
          Next: Create →
        </button>
      </div>
    </div>
  )
}
