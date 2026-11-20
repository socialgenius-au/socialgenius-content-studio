// Carousel Creator - the HTTP side of animated export: sends the rendered frames to /carousel-video and fetches the encoded file.
import { CarouselServerError, toServerError } from './serverStore'
import type { VideoMeta, VideoSink } from './videoRender'

/** Frames as one request body: repeated [4-byte big-endian length][JPEG bytes]. */
export function packFrames(frames: Uint8Array[]): ArrayBuffer {
  const total = frames.reduce((n, f) => n + 4 + f.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let pos = 0
  for (const f of frames) { view.setUint32(pos, f.length, false); pos += 4; out.set(f, pos); pos += f.length }
  return out.buffer
}

export interface CarouselVideoApiLike {
  createJob(body: Record<string, unknown>): Promise<{ data: unknown }>
  putFrames(jobId: string, start: number, data: ArrayBuffer): Promise<unknown>
  render(jobId: string): Promise<unknown>
  download(jobId: string): Promise<{ data: ArrayBuffer | Uint8Array }>
  delete(jobId: string): Promise<unknown>
}

/** A server problem as a plain sentence for the person (the typed error already carries the server's own message). */
function explain(e: unknown): Error {
  const err = toServerError(e)
  if (err.kind === 'network') return new Error('Could not reach the server while exporting the video. Check your connection and try again.')
  if (err.kind === 'auth') return new Error('Your session has ended. Sign in again, then export the video.')
  if (err instanceof CarouselServerError && err.opts.status === 503) return new Error('Video encoding is not available on this server right now.')
  return new Error(err.message)
}

export function createHttpVideoSink(api: CarouselVideoApiLike): VideoSink {
  const formats = new Map<string, VideoMeta['format']>()
  const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => { try { return await fn() } catch (e) { throw explain(e) } }
  return {
    start: meta => wrap(async () => {
      const r = (await api.createJob({ fps: meta.fps, width: meta.width, height: meta.height, frames: meta.frames, format: meta.format, ...(meta.audio ? { audio: meta.audio } : {}) })).data as { job_id: string }
      formats.set(r.job_id, meta.format)
      return r.job_id
    }),
    sendFrames: (jobId, startIndex, frames) => wrap(async () => { await api.putFrames(jobId, startIndex, packFrames(frames)) }),
    render: jobId => wrap(async () => { await api.render(jobId) }),
    download: jobId => wrap(async () => {
      const r = await api.download(jobId)
      const fmt = formats.get(jobId) ?? 'mp4'
      return { name: `carousel.${fmt}`, mime: fmt === 'gif' ? 'image/gif' : 'video/mp4', bytes: r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data) }
    }),
    discard: async jobId => { try { await api.delete(jobId) } catch { /* the server removes abandoned jobs on its own */ } finally { formats.delete(jobId) } },
  }
}
