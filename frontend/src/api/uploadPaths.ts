// Maps an Asset's stored `file_path` to the part of the public `/uploads/` URL that follows it.
//
// The backend serves its upload directory at `/uploads` and stores `file_path` as str(Path(UPLOAD_DIR) / <user id> / <file>). Two layouts exist:
//   * relative  UPLOAD_DIR=uploads        -> "uploads/1/x.mp4"          (local development; always worked)
//   * absolute  UPLOAD_DIR=/data/uploads  -> "/data/uploads/1/x.mp4"    (the Railway preview, on its mounted volume)
// Only these two are understood. Anything else -- another absolute path, a drive-letter path, dot segments, control characters, non-strings -- returns
// null, so a stored path can never be turned into a URL that reaches anything outside the uploads route.
export const RAILWAY_UPLOAD_PREFIX = '/data/uploads/'

export function uploadUrlPath(filePath: unknown): string | null {
  if (typeof filePath !== 'string' || filePath === '') return null
  if (/[\u0000-\u001f\u007f]/.test(filePath)) return null
  let p = filePath.replace(/\\/g, '/')

  if (p.startsWith(RAILWAY_UPLOAD_PREFIX)) p = p.slice(RAILWAY_UPLOAD_PREFIX.length)   // the known absolute storage root on the volume
  else if (p.startsWith('/')) {
    if (!p.startsWith('/uploads/')) return null                                          // any other absolute path is not ours to expose
    p = p.slice('/uploads/'.length)
  } else if (p.startsWith('uploads/')) p = p.slice('uploads/'.length)
  else if (/^[A-Za-z]:/.test(p)) return null                                             // "C:/..." drive paths

  const segments = p.split('/')
  if (segments.some(s => s === '' || s === '.' || s === '..')) return null              // traversal / empty segments (also covers an empty remainder)
  return segments.map(encodeURIComponent).join('/')                                      // file names are data: '#', '?', '%', spaces and unicode stay inside the path
}
