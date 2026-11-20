import { describe, expect, it } from 'vitest'
import type { PostDocument, PostElement } from '../postDocument'
import { createCarouselDocument } from './document'
import { addElement, makeShape, makeText, type OpContext } from './ops'
import { defaultAnimation, withAnimation } from './animation'
import { exportAnimatedVideo, drawFrame, frameCount, prepareFrameContext, videoSize, type VideoMeta, type VideoSink } from './videoRender'
import { ExportCancelled, type RasterBackend } from './exporter'
import { drawSlide, type Ctx2D } from './rasterize'
import { buildTimeline } from './animation'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-20T09:00:00Z') } }

type Call = [string, ...unknown[]]
/** A recording 2D context; `alpha` is captured with every call so opacity changes are visible. */
function recorder(tag: string, log: Call[]) {
  const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', font: '10px sans-serif' }
  return new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'measureText') return (s: string) => ({ width: s.length * 5 })
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => undefined })
      return (...args: unknown[]) => { log.push([`${tag}.${k}`, ...args, t.globalAlpha]) }
    },
    set(t, k: string, v) { t[k] = v; return true },
  }) as unknown as Ctx2D
}

function backend(log: Call[], loads: string[] = []): RasterBackend & { made: number } {
  const b = {
    made: 0,
    createSurface(width: number, height: number) {
      const tag = ['main', 'a', 'b'][b.made++] ?? `s${b.made}`
      const image = { tag, width, height }
      return { ctx: recorder(tag, log), image, toBytes: async (mime: string) => new Uint8Array([mime === 'image/jpeg' ? 0xff : 0, 0xd8, b.made]) }
    },
    loadImage: async (url: string) => { loads.push(url); return { width: 100, height: 100 } },
  }
  return b
}

function motionDoc(): PostDocument {
  const c = ids()
  let d = createCarouselDocument({ title: 'Motion', layouts: ['statement', 'statement', 'statement'] }, c)
  d = { ...d, pages: d.pages.map(p => ({ ...p, durationMs: 2000 })) }
  d = { ...d, pages: d.pages.map((p, i) => (i === 0 ? p : { ...p, transition: { kind: 'dissolve' as const, durationMs: 500, easing: 'linear' as const } })) }
  return d
}

describe('drawing motion', () => {
  it('applies an element\'s opacity, offset, scale and rotation around its centre, and draws nothing extra for a still element', async () => {
    const c = ids()
    let d = createCarouselDocument({ layouts: ['cover'] }, c)
    const page = d.pages[0].id
    d = { ...d, pages: [{ ...d.pages[0], elements: [] }] }
    const box = makeShape({ x: 0.2, y: 0.2, width: 0.4, height: 0.2, opacity: 0.8 }, c)
    d = addElement(d, page, box, c)
    const calls: Call[] = []
    await drawSlide(recorder('m', calls), d, 0, { width: 1000, height: 1000, loadImage: async () => null, motion: () => ({ opacity: 0.5, dx: 0.1, dy: -0.05, scale: 2, rotation: 30, reveal: null }) })
    const names = calls.map(x => x[0])
    expect(names).toContain('m.translate'); expect(names).toContain('m.rotate'); expect(names).toContain('m.scale')
    const fill = calls.filter(x => x[0] === 'm.fill')[0]
    expect(fill[fill.length - 1]).toBeCloseTo(0.4, 6)                                      // 0.8 element opacity x 0.5 motion
    expect(calls.find(x => x[0] === 'm.translate')!.slice(1, 3)).toEqual([100, -50])        // dx 0.1 of the width, dy -0.05 of the height
    expect(calls.find(x => x[0] === 'm.scale')!.slice(1, 3)).toEqual([2, 2])
    const still: Call[] = []
    await drawSlide(recorder('m', still), d, 0, { width: 1000, height: 1000, loadImage: async () => null })
    expect(still.map(x => x[0])).not.toContain('m.scale')
  })

  it('typewriter draws only the first part of the text, laid out in full', async () => {
    const c = ids()
    let d = createCarouselDocument({ layouts: ['cover'] }, c)
    const page = d.pages[0].id
    d = { ...d, pages: [{ ...d.pages[0], elements: [] }] }
    const t = makeText(d.format, { content: 'Hello world', width: 0.9 }, c)
    d = addElement(d, page, t, c)
    const draw = async (reveal: number | null) => { const calls: Call[] = []; await drawSlide(recorder('m', calls), d, 0, { width: 1000, height: 1000, loadImage: async () => null, motion: () => (reveal === null ? null : { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, reveal }) }); return calls.filter(x => x[0] === 'm.fillText').map(x => String(x[1])) }
    expect(await draw(null)).toEqual(['Hello world'])
    expect(await draw(0.5)).toEqual(['Hello '])
    expect(await draw(0)).toEqual([])
    expect(await draw(1)).toEqual(['Hello world'])
  })

  it('uses the preloaded pictures instead of loading them again for every frame', async () => {
    const c = ids()
    let d = createCarouselDocument({ layouts: ['cover'] }, c)
    d = { ...d, pages: [{ ...d.pages[0], elements: [{ ...makeShape({}, c), type: 'image', role: 'hero_image', source: { kind: 'asset', assetId: 1, url: '/uploads/1/a.png' }, fit: 'cover', lockAspect: false } as unknown as PostElement] }] }
    const loads: string[] = []
    const b = backend([], loads)
    const fc = await prepareFrameContext(d, b, { scale: 0.5, resolveUrl: u => u + '?mt=T' })
    expect(loads).toEqual(['/uploads/1/a.png?mt=T'])
    for (let t = 0; t < 3000; t += 500) await drawFrame(fc, t)
    expect(loads).toHaveLength(1)                                                           // six frames, one load
    expect(fc.width).toBe(540); expect(fc.height).toBe(675)
  })
})

describe('frames', () => {
  it('a still moment draws one slide straight onto the frame', async () => {
    const calls: Call[] = []
    const fc = await prepareFrameContext(motionDoc(), backend(calls), {})
    await drawFrame(fc, 500)
    expect(calls.some(x => x[0].startsWith('main.'))).toBe(true)
    expect(calls.some(x => x[0].startsWith('a.') || x[0].startsWith('b.'))).toBe(false)
  })

  it('during a transition both slides are drawn off-screen and composited onto the frame with the right opacity', async () => {
    const calls: Call[] = []
    const fc = await prepareFrameContext(motionDoc(), backend(calls), {})       // slide 2 starts at 1500 (2000 - 500)
    await drawFrame(fc, 1750)                                                       // halfway through the dissolve
    expect(calls.some(x => x[0].startsWith('a.'))).toBe(true); expect(calls.some(x => x[0].startsWith('b.'))).toBe(true)
    const drawn = calls.filter(x => x[0] === 'main.drawImage')
    expect(drawn).toHaveLength(2)
    expect((drawn[0][1] as { tag: string }).tag).toBe('a'); expect((drawn[1][1] as { tag: string }).tag).toBe('b')          // outgoing first, incoming over it
    expect(drawn[0][drawn[0].length - 1]).toBeCloseTo(0.5, 6); expect(drawn[1][drawn[1].length - 1]).toBeCloseTo(0.5, 6)
  })

  it('a wipe clips the incoming slide to the revealed part; a flip squashes it', async () => {
    const wipe = motionDoc(); wipe.pages[1].transition = { kind: 'wipe', durationMs: 500, easing: 'linear', direction: 'left' }
    const calls: Call[] = []
    await drawFrame(await prepareFrameContext(wipe, backend(calls), { scale: 0.1 }), 1750)
    const rect = calls.filter(x => x[0] === 'main.rect')
    expect(rect.length).toBeGreaterThan(0)
    const flip = motionDoc(); flip.pages[1].transition = { kind: 'flip', durationMs: 500, easing: 'linear', direction: 'left' }
    const fcalls: Call[] = []
    await drawFrame(await prepareFrameContext(flip, backend(fcalls), { scale: 0.1 }), 1650)                       // p = 0.3: outgoing slide is turning away
    const sc = fcalls.filter(x => x[0] === 'main.scale')
    expect(sc).toHaveLength(1); expect(Number(sc[0][1])).toBeCloseTo(0.4, 5)
  })

  it('frame count follows the timeline and frame size is always even', () => {
    const d = motionDoc()
    const tl = buildTimeline(d)                                                      // 3 x 2000 - 2 x 500 = 5000 ms
    expect(tl.totalMs).toBe(5000)
    expect(frameCount(tl, 30)).toBe(150); expect(frameCount(tl, 12)).toBe(60)
    const v = videoSize({ ...d, format: { ...d.format, width: 1081, height: 1349 } }, 1)
    expect(v.width % 2).toBe(0); expect(v.height % 2).toBe(0)
    expect(videoSize(d, 0.5)).toEqual({ width: 540, height: 676 })
  })
})

describe('animated video export', () => {
  function fakeSink() {
    const log: string[] = []
    const frames: number[] = []
    let meta: VideoMeta | null = null
    const sink: VideoSink = {
      async start(m) { meta = m; log.push('start'); return 'job1' },
      async sendFrames(job, start, fr) { expect(start).toBe(frames.length); fr.forEach(() => frames.push(frames.length)); log.push(`send ${start}+${fr.length}`) },
      async render() { log.push('render') },
      async download() { log.push('download'); return { name: 'out.mp4', mime: 'video/mp4', bytes: new Uint8Array([1, 2, 3]) } },
      async discard() { log.push('discard') },
    }
    return { sink, log, frames, meta: () => meta }
  }

  it('renders every frame in order, sends them in batches, encodes, downloads and cleans up', async () => {
    const d = motionDoc()
    const s = fakeSink()
    const progress: string[] = []
    const file = await exportAnimatedVideo(d, backend([]), s.sink, { fps: 12, scale: 0.1, format: 'mp4', batchBytes: 40, onProgress: (st, done, total) => { if (done === total || st !== 'rendering') progress.push(`${st}:${done}/${total}`) } })
    expect(file).toMatchObject({ name: 'out.mp4', mime: 'video/mp4' })
    expect(s.meta()).toMatchObject({ fps: 12, frames: 60, format: 'mp4', width: 108, height: 136 })
    expect(s.frames).toHaveLength(60)
    expect(s.log[0]).toBe('start'); expect(s.log.slice(-3)).toEqual(['render', 'download', 'discard'])
    expect(s.log.filter(l => l.startsWith('send')).length).toBeGreaterThan(1)                    // batched, not one giant request
    expect(progress).toContain('rendering:60/60'); expect(progress).toContain('encoding:0/1')
  })

  it('cancelling stops before the next frame, renders nothing more and asks the server to discard the partial job', async () => {
    const d = motionDoc()
    const s = fakeSink()
    const ctl = new AbortController()
    const b = backend([])
    await expect(exportAnimatedVideo(d, b, s.sink, { fps: 12, scale: 0.1, format: 'mp4', signal: ctl.signal, onProgress: (_st, done) => { if (done === 10) ctl.abort() } })).rejects.toBeInstanceOf(ExportCancelled)
    expect(s.log).not.toContain('render'); expect(s.log).not.toContain('download'); expect(s.log).toContain('discard')
    expect(s.frames.length).toBeLessThan(60)
  })

  it('a failure while encoding discards the job and reports the error', async () => {
    const s = fakeSink()
    s.sink.render = async () => { throw new Error('The server could not encode the video.') }
    await expect(exportAnimatedVideo(motionDoc(), backend([]), s.sink, { fps: 12, scale: 0.1, format: 'gif' })).rejects.toThrow(/could not encode/)
    expect(s.log).toContain('discard')
  })
})

export { withAnimation, defaultAnimation }
