// M2.5a -- REAL-DATA validation against the actual VA5368 transcript. LOCAL ONLY: it runs when M2_REAL_SPEECH_EVIDENCE points at a JSON file shaped like the reference-video response
// (kept outside the repository because it holds a third party's spoken words). Skipped in CI and on a fresh checkout. It asserts what we CLAIM, never the words themselves.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { ReferenceVideo } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { buildSpeechCandidates } from './candidates'
import { makeTimeMap, setAllIncluded } from './corrections'
import { readSpeechEvidence } from './evidence'
import { mergeSpeech, planSpeech } from './materialize'

const file = process.env.M2_REAL_SPEECH_EVIDENCE
const run = !!file && existsSync(file)
const d = run ? describe : describe.skip

d('real VA5368 transcript (local only)', () => {
  const ref = run ? (JSON.parse(readFileSync(file!, 'utf8')) as ReferenceVideo) : (null as never)
  const before = run ? JSON.stringify(ref) : ''
  const plan = buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-10-01T00:00:00Z'))
  const evidence = run ? readSpeechEvidence(ref, plan.videoAnalysisId) : (null as never)
  const cands = run ? buildSpeechCandidates(evidence) : []
  const map = run ? makeTimeMap(evidence.durationSeconds ?? 43.9, plan.totalSeconds) : (null as never)
  const ctx = { referenceVideoId: ref?.id ?? 0, videoAnalysisId: plan.videoAnalysisId, timeMap: map, scenes: plan.scenes.map(s => ({ sceneNumber: s.sceneNumber, startTime: s.startTime, endTime: s.endTime })), existingSubtitleIds: [], createdAt: '2026-10-30T00:00:00.000Z' }

  it('reads the 15 segments without touching the analysis; the reference is a third party’s, so none is included by default', () => {
    expect(evidence.segments).toHaveLength(15); expect(JSON.stringify(ref)).toBe(before); expect(Object.isFrozen(evidence)).toBe(true)
    expect(evidence.rightsStatus).toBe('unknown_third_party'); expect(cands.every(c => !c.defaultInclude)).toBe(true)
    expect(planSpeech(cands, {}, ctx).subtitles).toEqual([])
  })
  it('is in Arabic script (Urdu): every segment carries the Naskh note, none is flagged as undrawable, and the count says so', () => {
    expect(cands.every(c => c.script === 'arabic' && c.flags.some(f => f.code === 'script_naskh') && !c.flags.some(f => f.code === 'script_unsupported'))).toBe(true)
    const p = planSpeech(cands, setAllIncluded({}, cands.map(c => c.id), true), ctx)
    expect(p.record.counts.arabicScript).toBe(p.subtitles.length); expect(p.record.counts.unsupportedScript).toBe(0); expect(p.subtitles.length).toBeGreaterThan(10)
  })
  it('turns an explicit “include all” into editable subtitles on the draft’s timeline and a script covering the blueprint’s scenes', () => {
    const p = planSpeech(cands, setAllIncluded({}, cands.map(c => c.id), true), ctx)
    expect(p.subtitles.every(s => s.startTime >= 0 && s.endTime <= plan.totalSeconds + 1e-6 && s.endTime > s.startTime)).toBe(true)
    expect(p.script).toHaveLength(plan.scenes.length); expect(p.script.flatMap(s => s.lines)).toHaveLength(p.subtitles.length)
    expect(p.subtitles.every(s => s.reconstruction!.claims.wordsVerifiedAgainstAudio === false && s.reconstruction!.transcribedText.length > 0)).toBe(true)
    console.log(`      real transcript: ${p.subtitles.length} subtitles over ${plan.totalSeconds}s (map ${map.mode} x${map.factor.toFixed(3)}); script lines per scene: ${p.script.map(s => s.lines.length).join(',')}`)
    expect((mergeSpeech({ subtitles: [] as never[] }, p) as unknown as { subtitles: unknown[] }).subtitles).toHaveLength(p.subtitles.length)
  })
})
