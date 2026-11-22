// Maps an Asset's stored `file_path` to the part of the public `/uploads/` URL that follows it.
//
// The backend serves its upload directory at `/uploads` and stores `file_path` as str(Path(UPLOAD_DIR) / <user id> / <file>). The existing layouts are:
//   * relative  UPLOAD_DIR=uploads        -> "uploads/1/x.mp4"          (local development; always worked)
//   * absolute  UPLOAD_DIR=/data/uploads  -> "/data/uploads/1/x.mp4"    (the Railway preview, on its mounted volume)
// The production container additionally mounts its volume at /app/uploads. Anything else -- another absolute path, a drive-letter path, dot segments, control characters, non-strings -- returns
// null, so a stored path can never be turned into a URL that reaches anything outside the uploads route.
export const RAILWAY_UPLOAD_PREFIX = '/data/uploads/'
const UPLOAD_PREFIXES = [RAILWAY_UPLOAD_PREFIX, '/app/uploads/', '/uploads/', 'uploads/']

export function uploadUrlPath(filePath: unknown): string | null {
  if (typeof filePath !== 'string' || filePath === '') return null
  if (/[\u0000-\u001f\u007f]/.test(filePath)) return null
  const input = filePath.replace(/\\/g, '/')
  const prefix = UPLOAD_PREFIXES.find(root => input.startsWith(root))
  if (!prefix && (input.startsWith('/') || /^[A-Za-z]:/.test(input))) return null
  const p = prefix ? input.slice(prefix.length) : input

  const segments = p.split('/')
  if (segments.some(s => s === '' || s === '.' || s === '..')) return null              // traversal / empty segments (also covers an empty remainder)
  return segments.map(encodeURIComponent).join('/')                                      // file names are data: '#', '?', '%', spaces and unicode stay inside the path
}
