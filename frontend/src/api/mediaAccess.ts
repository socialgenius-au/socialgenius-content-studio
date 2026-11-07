// Short-lived signed media access (backend: app/services/media_access.py).
//
// Uploaded files are served at /uploads/<user_id>/<file> and now need `?mt=<media token>`. This module holds the current token and does three small jobs:
//   1. withMediaToken(url)   puts the CURRENT token on a media URL (and replaces an older one); any other URL is returned untouched.
//   2. installMediaSrcUpgrade() makes every <img>/<video>/<audio>/<source> that is given a media URL end up with the current token, whoever set it (the editor, a saved project that
//      still holds an expired link, ...). Nothing in the editor needed to change for this.
//   3. keepMediaTokenFresh(fetchToken) fetches a token at start, refreshes it before it expires, and re-points media elements that are idle (paused or not playing) so seeking keeps working
//      in a session that runs longer than the token's life. A playing element is never touched mid-playback.
// Tokens are never stored (not in localStorage, not in drafts): the server strips them from saved projects and adds a fresh one when the owner reads them back.

const MEDIA_URL = /\/uploads\/\d+\/[^/?#\s]+/
const QUERY_KEY = 'mt'

let token: string | null = null
let expiresAtMs = 0

export function setMediaToken(t: string | null, expiresInSeconds = 0): void {
  token = t
  expiresAtMs = t ? Date.now() + expiresInSeconds * 1000 : 0
}

export function getMediaToken(): string | null {
  return token
}

export function mediaTokenSecondsLeft(now = Date.now()): number {
  return token ? Math.max(0, Math.round((expiresAtMs - now) / 1000)) : 0
}

export function isMediaUrl(url: string): boolean {
  return MEDIA_URL.test(url) && !url.startsWith('blob:') && !url.startsWith('data:')
}

/** The URL with the current token on it. Not a media URL, or no token yet: returned as it was. */
export function withMediaToken(url: string, t: string | null = token): string {
  if (!t || !isMediaUrl(url)) return url
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url
  const qAt = noHash.indexOf('?')
  const base = qAt >= 0 ? noHash.slice(0, qAt) : noHash
  const params = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : '')
  params.set(QUERY_KEY, t)
  return `${base}?${params.toString()}${hash}`
}

/** The URL without any token (what is safe to keep or compare). */
export function stripMediaToken(url: string): string {
  if (!isMediaUrl(url)) return url
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url
  const qAt = noHash.indexOf('?')
  if (qAt < 0) return url
  const params = new URLSearchParams(noHash.slice(qAt + 1))
  params.delete(QUERY_KEY)
  const q = params.toString()
  return `${noHash.slice(0, qAt)}${q ? `?${q}` : ''}${hash}`
}

// ── make element sources pick up the current token ───────────────────────────────────────

let upgradeInstalled = false

export function installMediaSrcUpgrade(): void {
  if (upgradeInstalled || typeof window === 'undefined' || typeof Element === 'undefined') return
  upgradeInstalled = true
  const targets: Array<typeof HTMLMediaElement | typeof HTMLImageElement | typeof HTMLSourceElement> = [HTMLMediaElement, HTMLImageElement, HTMLSourceElement]
  for (const ctor of targets) {
    const d = Object.getOwnPropertyDescriptor(ctor.prototype, 'src')
    if (!d || !d.set) continue
    const nativeSet = d.set
    Object.defineProperty(ctor.prototype, 'src', { ...d, set(this: Element, v: string) { nativeSet.call(this, typeof v === 'string' ? withMediaToken(v) : v) } })
  }
  const nativeSetAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    if (name === 'src' && typeof value === 'string' && (this instanceof HTMLMediaElement || this instanceof HTMLImageElement || this instanceof HTMLSourceElement)) value = withMediaToken(value)
    return nativeSetAttribute.call(this, name, value)
  }
}

// ── keep the token fresh, re-point idle elements ─────────────────────────────────────────

type TokenResponse = { token: string; expires_in: number }
let timer: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<boolean> | null = null
let fetcher: (() => Promise<TokenResponse>) | null = null

function mediaElements(): Array<HTMLMediaElement | HTMLImageElement> {
  return Array.from(document.querySelectorAll<HTMLMediaElement | HTMLImageElement>('video, audio, img'))
}

/** Re-points elements whose link carries an older token. Playing elements are skipped (tried again on the next tick); position and pause state are kept. */
export function repointMediaElements(): number {
  let deferred = 0
  for (const el of mediaElements()) {
    const cur = el.getAttribute('src') ?? ''
    if (!isMediaUrl(cur) || withMediaToken(cur) === cur) continue
    if (el instanceof HTMLMediaElement) {
      if (!el.paused && !el.ended) { deferred += 1; continue }
      const t = el.currentTime
      const wasPaused = el.paused
      el.setAttribute('src', cur)                                    // goes through the upgrade above -> current token
      el.addEventListener('loadedmetadata', () => { try { el.currentTime = t } catch { /* not seekable yet */ } if (!wasPaused) void el.play().catch(() => undefined) }, { once: true })
    } else {
      el.setAttribute('src', cur)
    }
  }
  return deferred
}

async function refreshOnce(): Promise<boolean> {
  if (!fetcher) return false
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const r = await fetcher!()
      setMediaToken(r.token, r.expires_in)
      return true
    } catch {
      return false
    } finally {
      inflight = null
    }
  })()
  return inflight
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  const secs = mediaTokenSecondsLeft()
  const wait = secs > 0 ? Math.max(15, Math.floor(secs * 0.7)) : 30            // refresh at ~70% of the life; retry soon if it could not be fetched
  timer = setTimeout(async () => {
    const ok = await refreshOnce()
    if (ok && typeof document !== 'undefined') {
      const deferred = repointMediaElements()
      if (deferred > 0) setTimeout(() => repointMediaElements(), 10_000)       // a playing element is tried again shortly
    }
    schedule()
  }, wait * 1000)
}

/** Fetches the first token (call and await it before the first screen that shows media) and keeps it fresh. Safe to call again after login. */
export async function keepMediaTokenFresh(fetchToken: () => Promise<TokenResponse>): Promise<boolean> {
  fetcher = fetchToken
  installMediaSrcUpgrade()
  const ok = await refreshOnce()
  schedule()
  if (typeof document !== 'undefined' && !(keepMediaTokenFresh as unknown as { wired?: boolean }).wired) {
    (keepMediaTokenFresh as unknown as { wired?: boolean }).wired = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && mediaTokenSecondsLeft() < 120) void refreshOnce().then(ok2 => { if (ok2) repointMediaElements() })
    })
  }
  return ok
}

export function stopMediaAccess(): void {
  if (timer) clearTimeout(timer)
  timer = null
  fetcher = null
  setMediaToken(null)
}
