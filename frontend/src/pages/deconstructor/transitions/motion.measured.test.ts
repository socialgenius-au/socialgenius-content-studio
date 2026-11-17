// M2.4 / B1 -- the motion estimate on numbers produced by the backend's REAL transition-evidence code (ORB+RANSAC affine and phase correlation) on two constructed SYNTHETIC clips: a fast pan
// and a punch-in zoom, each across a hard cut. This shows the whole chain (stored measurement -> API shape -> estimate) with real measured values; it is not real reference footage.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReferenceVideo, TransitionEvidenceSummary } from '../../../types'
import { classifyBoundary } from './classify'
import { readTransitionEvidence } from './evidence'

const fx = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'motion.synthetic-clips.json'), 'utf8')) as { frame: { width: number; height: number }; clips: Record<string, Record<string, unknown>> }
const boundary = (name: string) => {
  const s = { id: 1, preceding_shot_id: 1, following_shot_id: 2, certainty: 'MEASURED', ...fx.clips[name] } as unknown as TransitionEvidenceSummary
  const ref = { id: 1, shots: [], transition_evidence: [s], technical_details: { video: { ...fx.frame } } as unknown as ReferenceVideo['technical_details'] }
  return readTransitionEvidence(ref, 1).boundaries[0]
}

describe('motion estimate on measured numbers from constructed clips', () => {
  it('reads the fast pan: the picture moved left 16-24 % of the width per sample on four consecutive pairs, a whip pan at medium confidence, not default-worthy', () => {
    const c = classifyBoundary(boundary('pan'))
    expect(c).toMatchObject({ kind: 'whip_pan', confidence: 'medium' }); expect(c.motion).toMatchObject({ direction: 'left', pairs: 4, source: 'affine' })
    expect(Math.min(...c.motion!.perPair)).toBeGreaterThan(0.12); expect(Math.max(...c.motion!.perPair)).toBeLessThan(0.3)
    expect(c.reasons.join(' ')).toMatch(/not the original effect/); expect(c.reasons.join(' ')).toMatch(/picture moving left/)
  })
  it('reads the punch-in: the picture scaled up 1.2-1.3x per sample on four consecutive pairs, with no sideways shift, a zoom punch at medium confidence', () => {
    const c = classifyBoundary(boundary('zoom'))
    expect(c).toMatchObject({ kind: 'zoom_punch', confidence: 'medium' }); expect(c.motion).toMatchObject({ direction: 'in', pairs: 4 }); expect(Math.min(...c.motion!.perPair)).toBeGreaterThan(1.15)
  })
  it('the failed feature fit on the cut pair is not turned into a movement (it is a gap in the run, not a value)', () => {
    const b = boundary('pan')
    expect(b.motion!.affine.filter(p => !p.ok || (p.inlierRatio ?? 0) < 0.5).length).toBeGreaterThanOrEqual(1)
    expect(classifyBoundary(b).motion!.pairs).toBe(4)
  })
})
