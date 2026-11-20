import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AudioTrack, PostDocument } from '../postDocument'
import { assertValidPostDocument, validatePostDocument } from '../postDocument'
import { createCarouselDocument } from './document'
import type { OpContext } from './ops'
import { audibleWindow, newTrack, normalizeTrack, probeAudioDuration, replaceTrackFile, sourceTimeAt, trackToSpec, validateAudioFile, volumeAt } from './audio'
import { exportAnimatedVideo, type VideoMeta, type VideoSink } from './videoRender'
import type { RasterBackend } from './exporter'
import { createHttpVideoSink } from './videoSink'
import { editorReducer, initialState } from '../../pages/carousel-creator/editorState'
import TimelineBar, { tickStep } from '../../pages/carousel-creator/components/TimelineBar'
import AudioPanel from '../../pages/carousel-creator/components/AudioPanel'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-21T09:00:00Z') } }
const doc = (n = 3): PostDocument => { const d = createCarouselDocument({ title: 'A', layouts: Array.from({ length: n }, () => 'statement' as const) }, ids()); return { ...d, pages: d.pages.map(p => ({ ...p, durationMs: 2000 })) } }
const track = (over: Partial<AudioTrack> = {}): AudioTrack => ({ ...newTrack({ assetId: 7, url: '/uploads/1/m.mp3', name: 'music.mp3' }, 30000), ...over })

describe('audio files', () => {
  it('accepts MP3, WAV, M4A and AAC and refuses everything else with a reason', () => {
    for (const n of ['a.mp3', 'B.WAV', 'c.m4a', 'd.aac']) expect(validateAudioFile({ name: n, size: 1000 }), n).toBeNull()
    expect(validateAudioFile({ name: 'a.ogg', size: 1000 })).toMatch(/not an MP3, WAV, M4A or AAC/)
    expect(validateAudioFile({ name: 'noext', size: 1000 })).toMatch(/not an MP3/)
    expect(validateAudioFile({ name: 'a.mp3', size: 0 })).toMatch(/empty/)
    expect(validateAudioFile({ name: 'a.mp3', size: 200 * 1024 * 1024 })).toMatch(/larger than 100 MB/)
  })
  it('reads the length of a file from its metadata, and gives 0 when it cannot', async () => {
    const make = (outcome: 'ok' | 'error') => () => { const l: Record<string, () => void> = {}; const a = { src: '', preload: '', duration: 12.345, addEventListener: (e: string, f: () => void) => { l[e] = f }, load: () => { setTimeout(() => l[outcome === 'ok' ? 'loadedmetadata' : 'error']?.(), 0) } }; return a }
    expect(await probeAudioDuration('/x.mp3', make('ok'))).toBe(12345)
    expect(await probeAudioDuration('/x.mp3', make('error'))).toBe(0)
  })
})

describe('what is heard when', () => {
  it('the audible window follows offset, trim and the video length, and is empty when muted or past the end', () => {
    expect(audibleWindow(track(), 10000)).toEqual({ startMs: 0, endMs: 10000, sourceStartMs: 0 })                                   // a 30 s file is cut to a 10 s video
    expect(audibleWindow(track({ offsetMs: 2000, trimStartMs: 5000, trimEndMs: 9000 }), 10000)).toEqual({ startMs: 2000, endMs: 6000, sourceStartMs: 5000 })
    expect(audibleWindow(track({ sourceMs: 4000 }), 10000)).toEqual({ startMs: 0, endMs: 4000, sourceStartMs: 0 })                  // a short file ends early
    expect(audibleWindow(track({ muted: true }), 10000)).toBeNull()
    expect(audibleWindow(track({ offsetMs: 20000 }), 10000)).toBeNull()
  })
  it('volume follows the level and the fades, measured on the part that is heard; zero outside it', () => {
    const t = track({ volume: 0.8, fadeInMs: 1000, fadeOutMs: 2000, offsetMs: 1000 })
    expect(volumeAt(t, 500, 10000)).toBe(0)                                           // before the music starts
    expect(volumeAt(t, 1000, 10000)).toBeCloseTo(0, 6); expect(volumeAt(t, 1500, 10000)).toBeCloseTo(0.4, 6); expect(volumeAt(t, 2000, 10000)).toBeCloseTo(0.8, 6)
    expect(volumeAt(t, 5000, 10000)).toBeCloseTo(0.8, 6)
    expect(volumeAt(t, 9000, 10000)).toBeCloseTo(0.4, 6); expect(volumeAt(t, 10000, 10000)).toBeCloseTo(0, 6)
    expect(volumeAt(track({ fadeInMs: 99999 }), 500, 1000)).toBeCloseTo(0.5, 6)       // a fade can never be longer than what is heard
    expect(sourceTimeAt(track({ trimStartMs: 5000, offsetMs: 2000 }), 4000)).toBe(7)
  })
  it('sends the server only what it needs, nothing for a muted or missing track, and keeps edits consistent', () => {
    expect(trackToSpec(track({ trimStartMs: 1000, trimEndMs: 4000, offsetMs: 500, volume: 0.5, fadeInMs: 200, fadeOutMs: 300 }))).toEqual({ asset_id: 7, trim_start_ms: 1000, trim_end_ms: 4000, offset_ms: 500, volume: 0.5, fade_in_ms: 200, fade_out_ms: 300 })
    expect(trackToSpec(track({ muted: true }))).toBeNull(); expect(trackToSpec(undefined)).toBeNull()
    const n = normalizeTrack(track({ trimStartMs: 50000, trimEndMs: 100, offsetMs: -5, volume: 9, fadeInMs: -1 }))
    expect(n.trimStartMs).toBeLessThan(n.sourceMs); expect(n.offsetMs).toBe(0); expect(n.volume).toBe(2); expect(n.fadeInMs).toBe(0)
    expect(normalizeTrack(track({ trimStartMs: 1000, trimEndMs: 1010 })).trimEndMs).toBe(1100)                                       // an end never sits at or before the start
    expect(normalizeTrack(track({ trimEndMs: 99999 })).trimEndMs).toBe(0)                                                            // past the end of the file = to the end
    const r = replaceTrackFile(track({ volume: 0.3, fadeOutMs: 800, trimStartMs: 4000 }), { assetId: 9, url: '/uploads/1/n.mp3', name: 'new.mp3' }, 60000)
    expect(r).toMatchObject({ assetId: 9, name: 'new.mp3', sourceMs: 60000, volume: 0.3, fadeOutMs: 800, trimStartMs: 0 })        // levels kept, trim reset
  })
})

describe('music is stored with the document', () => {
  it('round-trips through the validator, and the reducer sets, changes and removes it as undoable steps', () => {
    const d = { ...doc(), audio: track({ trimEndMs: 20000 }) }
    assertValidPostDocument(d)
    const bad = (m: Partial<AudioTrack>) => validatePostDocument({ ...d, audio: { ...d.audio!, ...m } }).errors.join('|')
    expect(bad({ volume: 5 })).toMatch(/audio/); expect(bad({ assetId: 0 })).toMatch(/audio/); expect(bad({ trimStartMs: 9000, trimEndMs: 1000 })).toMatch(/end of the trim/); expect(bad({ muted: 'no' as never })).toMatch(/audio/)
    let s = initialState(doc(), 'forest')
    s = editorReducer(s, { type: 'setAudio', audio: track() }, ids())
    expect(s.doc.audio?.name).toBe('music.mp3'); expect(s.dirty).toBe(true); expect(s.past).toHaveLength(1)
    s = editorReducer(s, { type: 'setAudio', audio: track({ volume: 0.4 }) }, ids())
    s = editorReducer(s, { type: 'setAudio', audio: null }, ids())
    expect('audio' in s.doc).toBe(false)
    s = editorReducer(s, { type: 'undo' }, ids())
    expect(s.doc.audio?.volume).toBe(0.4)
  })
})

describe('music in the export', () => {
  const backend = (): RasterBackend => ({ createSurface: () => ({ ctx: new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop: () => undefined, width: 5 })), set: (t, k: string, v) => { t[k] = v; return true } }) as never, image: {}, toBytes: async () => new Uint8Array([0xff, 0xd8, 0xff]) }), loadImage: async () => null })
  const sinkFor = () => { const metas: VideoMeta[] = []; const sink: VideoSink = { async start(m) { metas.push(m); return 'j' }, async sendFrames() {}, async render() {}, async download() { return { name: 'x', mime: 'video/mp4', bytes: new Uint8Array([1]) } }, async discard() {} }; return { sink, metas } }

  it('an MP4 export sends the music settings; a GIF export and a muted track send none', async () => {
    const d = doc(1)
    const t = track({ offsetMs: 500, fadeInMs: 300 })
    const mp4 = sinkFor(); await exportAnimatedVideo(d, backend(), mp4.sink, { fps: 12, scale: 0.05, format: 'mp4', audio: t })
    expect(mp4.metas[0].audio).toMatchObject({ asset_id: 7, offset_ms: 500, fade_in_ms: 300 })
    const gif = sinkFor(); await exportAnimatedVideo(d, backend(), gif.sink, { fps: 12, scale: 0.05, format: 'gif', audio: t })
    expect(gif.metas[0].audio).toBeUndefined()
    const muted = sinkFor(); await exportAnimatedVideo(d, backend(), muted.sink, { fps: 12, scale: 0.05, format: 'mp4', audio: track({ muted: true }) })
    expect(muted.metas[0].audio).toBeUndefined()
    const none = sinkFor(); await exportAnimatedVideo(d, backend(), none.sink, { fps: 12, scale: 0.05, format: 'mp4' })
    expect(none.metas[0].audio).toBeUndefined()
  })
  it('the HTTP sink includes the audio settings in the job it creates', async () => {
    let body: Record<string, unknown> = {}
    const sink = createHttpVideoSink({ createJob: async b => { body = b; return { data: { job_id: 'j' } } }, putFrames: async () => ({}), render: async () => ({}), download: async () => ({ data: new ArrayBuffer(1) }), delete: async () => ({}) })
    await sink.start({ fps: 12, width: 64, height: 80, frames: 12, format: 'mp4', audio: { asset_id: 7, trim_start_ms: 0, trim_end_ms: 0, offset_ms: 0, volume: 1, fade_in_ms: 0, fade_out_ms: 0 } })
    expect(body).toMatchObject({ format: 'mp4', audio: { asset_id: 7 } })
    await sink.start({ fps: 12, width: 64, height: 80, frames: 12, format: 'gif' })
    expect('audio' in body).toBe(false)
  })
})

describe('timeline and music panel', () => {
  it('the timeline shows every slide with its length, the transition overlap, the music span and the playhead', () => {
    const d = doc(3)
    const withTransitions = { ...d, pages: d.pages.map((p, i) => (i === 0 ? p : { ...p, transition: { kind: 'push' as const, durationMs: 500, easing: 'linear' as const } })), audio: track({ offsetMs: 1000, trimEndMs: 4000 }) }
    const h = renderToStaticMarkup(<TimelineBar doc={withTransitions} scope="all" activePageId={d.pages[1].id} t={2500} onSeek={() => undefined} onSelectSlide={() => undefined} audio={withTransitions.audio} />)
    expect(h.match(/data-testid="timeline-slide"/g)).toHaveLength(3)
    expect(h).toContain('data-start="1500"'); expect(h).toContain('data-start="3000"')                                               // each transition overlaps the end of the slide before
    expect(h).toContain('aria-label="Slide 2, 2 seconds, push transition of 0.5 seconds"')
    expect(h).toContain('data-testid="timeline-audio"'); expect(h).toContain('music.mp3')
    expect(h).toMatch(/data-testid="timeline-playhead"/); expect(h).toContain('left:')
    expect(tickStep(5000)).toBe(500); expect(tickStep(60000)).toBe(5000); expect(tickStep(10 ** 7)).toBe(600000)
  })
  it('the music panel offers upload and the library with no track, and every control with one, and says GIFs are silent', () => {
    const none = renderToStaticMarkup(<AudioPanel doc={doc()} dispatch={() => undefined} />)
    expect(none).toContain('data-testid="audio-picker"'); expect(none).toContain('Upload music (MP3, WAV, M4A, AAC)'); expect(none).not.toContain('data-testid="audio-track"')
    expect(none).toContain('A GIF cannot have sound')
    const d = { ...doc(), audio: track({ volume: 1.2, fadeInMs: 500, offsetMs: 1000 }) }
    const h = renderToStaticMarkup(<AudioPanel doc={d} dispatch={() => undefined} />)
    for (const id of ['audio-track', 'audio-name', 'audio-mute', 'audio-volume', 'audio-offset', 'audio-trim-start', 'audio-trim-end', 'audio-fade-in', 'audio-fade-out', 'audio-replace', 'audio-delete', 'audio-summary']) expect(h, id).toContain(`data-testid="${id}"`)
    expect(h).toContain('Volume 120%'); expect(h).toContain('The music is heard from 1.0 s to 6.0 s'); expect(h).not.toContain('data-testid="audio-picker"')
    expect(renderToStaticMarkup(<AudioPanel doc={{ ...d, audio: { ...d.audio!, muted: true } }} dispatch={() => undefined} />)).toContain('The music is muted.')
  })
})
