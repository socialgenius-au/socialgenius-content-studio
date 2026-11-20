// Post Document - link and QR destination validation. One rule set for hyperlinks, app / deep links and QR code destinations, used by the editor, the validator and (mirrored) the server.
//
// Allowed: https:// and http:// web addresses (http is accepted with a warning), mailto:, tel:, sms:, and app / deep links with their own scheme (for example myapp://open/offer). A bare
// address such as "example.com/menu" is treated as https. Refused: scripts and embedded data (javascript:, data:, vbscript:), local files, blobs, anything with spaces or control characters,
// web addresses with a username or password in them, and anything over 2048 characters.
export type LinkKind = 'web' | 'mailto' | 'tel' | 'sms' | 'app'
export type LinkCheck = { ok: true; url: string; kind: LinkKind; warning?: string } | { ok: false; error: string }

export const MAX_LINK_LENGTH = 2048
const BLOCKED_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file', 'blob', 'about', 'chrome', 'chrome-extension', 'view-source', 'ftp', 'ws', 'wss', 'jar'])
const SCHEME = /^([a-z][a-z0-9+.-]{0,30}):/i

export function validateLinkUrl(raw: string): LinkCheck {
  const url = (raw ?? '').trim()
  if (url === '') return { ok: false, error: 'Enter a web address, email, phone number or app link.' }
  if (url.length > MAX_LINK_LENGTH) return { ok: false, error: `That link is longer than ${MAX_LINK_LENGTH} characters.` }
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return { ok: false, error: 'A link cannot contain spaces or control characters. Encode them (for example a space as %20).' }
  const m = SCHEME.exec(url)
  if (!m) {
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(url)) return validateLinkUrl(`https://${url}`)
    return { ok: false, error: 'That does not look like a link. Start with https://, mailto:, tel: or an app link such as myapp://page.' }
  }
  const scheme = m[1].toLowerCase()
  if (BLOCKED_SCHEMES.has(scheme)) return { ok: false, error: `${scheme}: links are not allowed.` }
  if (scheme === 'https' || scheme === 'http') {
    let u: URL
    try { u = new URL(url) } catch { return { ok: false, error: 'That web address is not valid.' } }
    if (!u.hostname || !(u.hostname.includes('.') || u.hostname === 'localhost')) return { ok: false, error: 'That web address needs a domain such as example.com.' }
    if (u.username || u.password) return { ok: false, error: 'Web addresses with a username or password are not allowed.' }
    return { ok: true, url, kind: 'web', warning: scheme === 'http' ? 'This address is not secure (http). Use https if the site supports it.' : undefined }
  }
  const rest = url.slice(m[0].length)
  if (scheme === 'mailto') return /^[^@/\s]+@[^@/\s]+\.[^@/\s]+/.test(rest) ? { ok: true, url, kind: 'mailto' } : { ok: false, error: 'That email address is not valid.' }
  if (scheme === 'tel' || scheme === 'sms') return /^\+?[0-9][0-9\-().;=,a-z]{2,}$/i.test(rest) ? { ok: true, url, kind: scheme } : { ok: false, error: 'That phone number is not valid.' }
  if (!rest.startsWith('//') || rest.length < 3) return { ok: false, error: 'An app link needs the form myapp://path.' }
  return { ok: true, url, kind: 'app', warning: 'App links only work on phones that have that app installed.' }
}

export const isSafeLinkUrl = (raw: string): boolean => validateLinkUrl(raw).ok
