import { describe, expect, it } from 'vitest'
import type { DeconStatus } from '../../types/deconstructor'
import { GRACE_POLLS, MAX_FOLLOW_MS, nextPoll } from './pollPolicy'
import { summarizeDeconStatus } from './viewModel'

const stage = (key: string, status: string, extra: Partial<DeconStatus['stages'][number]> = {}) =>
  ({ key, label: key, kind: 'endpoint', status, error: null, reason: null, requires_ai: false, ...extra }) as DeconStatus['stages'][number]
const status = (orch: DeconStatus['orchestration'], stages: DeconStatus['stages']): DeconStatus => ({ reference_video_id: 5128, video_analysis_id: 5369, orchestration: orch, stages })

describe('nextPoll: the page keeps following a run it started', () => {
  const settled = { state: 'done' as const }
  it('keeps going while the server says running', () => {
    expect(nextPoll({ progress: { state: 'running' }, pollsSoFar: 50, startedByClick: true, elapsedMs: 1000 })).toBe('continue')
  })
  it('one early reply that does not say running (the hosted freeze) does NOT end the follow-up after a click', () => {
    for (const state of ['done', 'not_started', 'failed'] as const)
      for (let polls = 1; polls < GRACE_POLLS; polls++) expect(nextPoll({ progress: { state }, pollsSoFar: polls, startedByClick: true, elapsedMs: 800 }), `${state}/${polls}`).toBe('continue')
  })
  it('after the grace polls a settled reply ends it', () => {
    expect(nextPoll({ progress: settled, pollsSoFar: GRACE_POLLS, startedByClick: true, elapsedMs: 9000 })).toBe('settle')
  })
  it('a follow-up that was only resumed (page reopened) has no grace: it settles on the first settled reply', () => {
    expect(nextPoll({ progress: settled, pollsSoFar: 1, startedByClick: false, elapsedMs: 100 })).toBe('settle')
  })
  it('is bounded: gives up after the maximum time, even if the server still says running', () => {
    expect(nextPoll({ progress: { state: 'running' }, pollsSoFar: 9999, startedByClick: true, elapsedMs: MAX_FOLLOW_MS + 1 })).toBe('give_up')
  })
})

describe('summarizeDeconStatus reflects the real backend status', () => {
  const all = [stage('technical_probe', 'complete'), stage('visual_evidence', 'running'), stage('text_analysis', 'not_run')]
  it('running claim: running, names the current step', () => {
    const p = summarizeDeconStatus(status({ status: 'running', started_at: '2026-11-06T03:59:00Z' }, all))
    expect(p.state).toBe('running'); expect(p.current).toBe('visual_evidence'); expect(p.done).toBe(1)
  })
  it('a claim older than the server\'s crash limit is NOT running, even if a step still carries its old running marker (no endless spinner, button usable)', () => {
    const p = summarizeDeconStatus(status({ status: 'running', started_at: '2026-11-06T03:00:00Z', stale: true }, all))
    expect(p.state).toBe('interrupted'); expect(p.current).toBeNull(); expect(p.headline).toMatch(/stopped before it finished/)
  })
  it('the browser clock plays no part: an old started_at without the server stale flag is still a running run', () => {
    expect(summarizeDeconStatus(status({ status: 'running', started_at: '2001-01-01T00:00:00Z' }, all)).state).toBe('running')
  })
  it('a recorded interrupted run is shown as interrupted', () => {
    expect(summarizeDeconStatus(status({ status: 'interrupted', started_at: '2026-11-06T03:00:00Z' }, all)).state).toBe('interrupted')
  })
  it('a finished run with skipped AI steps: done, skipped counted and explained, nothing reported as failed', () => {
    const stages = [stage('technical_probe', 'complete'), stage('scene_story_beats', 'skipped', { kind: 'service', requires_ai: true, reason: 'AI reasoner not configured (X is empty)' }), stage('editing_rhythm', 'complete')]
    const p = summarizeDeconStatus(status({ status: 'complete', started_at: '2026-11-06T03:39:29Z', finished_at: '2026-11-06T03:40:48Z' }, stages))
    expect(p.state).toBe('done'); expect(p.skipped).toBe(1); expect(p.failures).toEqual([]); expect(p.done).toBe(3)
    expect(p.headline).toContain('1 AI step skipped')
    expect(p.steps.find(s => s.key === 'scene_story_beats')).toMatchObject({ status: 'skipped', note: 'AI reasoner not configured (X is empty)' })
  })
  it('a failed step is reported with its error and the other steps keep their own statuses', () => {
    const p = summarizeDeconStatus(status({ status: 'partial', started_at: '2026-11-06T03:39:29Z' }, [stage('technical_probe', 'complete'), stage('speech_analysis', 'failed', { error: 'HTTP 502: whisper unavailable' }), stage('audio_structure', 'blocked', { reason: "dependency 'speech' is failed" })]))
    expect(p.state).toBe('failed'); expect(p.failures).toEqual([{ label: 'speech_analysis', error: 'HTTP 502: whisper unavailable' }])
    expect(p.steps.map(s => s.status)).toEqual(['complete', 'failed', 'blocked'])
  })
  it('nothing recorded yet: not started, no steps claimed as done', () => {
    expect(summarizeDeconStatus(status(null, [stage('technical_probe', 'not_run')]))).toMatchObject({ state: 'not_started', done: 0 })
    expect(summarizeDeconStatus(null).steps).toEqual([])
  })
  it('a manual single-step run (no orchestration record) that is still running is shown as running', () => {
    expect(summarizeDeconStatus(status(null, [stage('technical_probe', 'running')])).state).toBe('running')
  })
})
