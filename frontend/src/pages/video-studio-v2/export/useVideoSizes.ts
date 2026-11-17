// Option C: the pixel size of each V1 source file (what the exporter probes with ffmpeg), read once per url from the browser's own metadata (videoWidth/Height are already the displayed size, i.e. after
// any rotation flag). Only used while a shape is marked "behind footage"; nothing is loaded otherwise.
import { useEffect, useState } from 'react'

const cache = new Map<string, readonly [number, number]>()

export function useVideoSizes(urls: readonly string[], enabled: boolean): ReadonlyMap<string, readonly [number, number]> {
  const [, bump] = useState(0)
  const key = enabled ? [...new Set(urls)].sort().join('\n') : ''
  useEffect(() => {
    if (!key) return
    let alive = true
    const probes: HTMLVideoElement[] = []
    for (const url of key.split('\n')) {
      if (cache.has(url)) continue
      const v = document.createElement('video')
      probes.push(v)
      v.preload = 'metadata'; v.muted = true
      v.onloadedmetadata = () => {
        if (v.videoWidth > 0 && v.videoHeight > 0) cache.set(url, [v.videoWidth, v.videoHeight])
        v.removeAttribute('src'); v.load()
        if (alive) bump(n => n + 1)
      }
      v.onerror = () => { v.removeAttribute('src') }
      v.src = url
    }
    return () => { alive = false; probes.forEach(v => { v.onloadedmetadata = null; v.onerror = null; v.removeAttribute('src') }) }
  }, [key])
  return cache
}
