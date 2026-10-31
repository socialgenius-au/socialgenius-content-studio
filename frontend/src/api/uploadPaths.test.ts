// Stage 4A -- assetsApi.previewUrl on the two stored-path layouts, and on paths that must never become a URL.
import { describe, expect, it } from 'vitest'
import { assetsApi } from './client'
import { RAILWAY_UPLOAD_PREFIX, uploadUrlPath } from './uploadPaths'

const HEX = 'a488cd52f9e44e2e950711208e98f7c4'
const legacy = (fp: string) => `/uploads/${fp.replace(/\\/g, '/').replace(/^\/?uploads\//, '')}`   // the implementation this replaces, as the oracle for existing layouts

describe('absolute layout on the Railway volume', () => {
  it('maps /data/uploads/<user>/<file> to the public /uploads route', () => {
    expect(assetsApi.previewUrl(`/data/uploads/1/${HEX}.mp4`)).toBe(`/uploads/1/${HEX}.mp4`)
    expect(assetsApi.previewUrl(`/data/uploads/90/${HEX}.jpg`)).toBe(`/uploads/90/${HEX}.jpg`)
    expect(uploadUrlPath(`${RAILWAY_UPLOAD_PREFIX}7/${HEX}.mp4`)).toBe(`7/${HEX}.mp4`)
  })
  it('handles nested folders (extracted frames) and Windows-style separators from a dev backend using the same root', () => {
    expect(uploadUrlPath('/data/uploads/1/frames/f_001.jpg')).toBe('1/frames/f_001.jpg')
    expect(uploadUrlPath('\\data\\uploads\\1\\x.mp4')).toBe('1/x.mp4')
  })
  it('never repeats the root in the result (the original defect: /uploads//data/uploads/...)', () => {
    expect(assetsApi.previewUrl(`/data/uploads/1/${HEX}.mp4`)).not.toContain('/data/')
    expect(assetsApi.previewUrl(`/data/uploads/1/${HEX}.mp4`)).not.toContain('//')
  })
})

describe('existing relative layout is unchanged', () => {
  const normal = [
    `uploads/1/${HEX}.mp4`, `/uploads/1/${HEX}.mp4`, `uploads\\1\\${HEX}.mp4`, `\\uploads\\1\\${HEX}.mp4`, `uploads/12/frames/f_001.jpg`, `1/${HEX}.mp4`, 'uploads/3/thumbnail_clip.jpg',
  ]
  it.each(normal)('%s -> exactly what the previous implementation produced', fp => {
    expect(assetsApi.previewUrl(fp)).toBe(legacy(fp))
    expect(assetsApi.previewUrl(fp)).not.toBe('')
  })
})

describe('file names are data, not URL syntax', () => {
  it('encodes each segment so # ? % spaces and unicode stay inside the path', () => {
    const names = ['my clip.mp4', 'a#b.mp4', 'what?.mp4', '100%.mp4', 'café ☕.mp4', 'a&b=c.mp4', '%2e%2e', 'x;y.mp4']
    for (const n of names) {
      const out = uploadUrlPath(`/data/uploads/1/${n}`)!
      const [user, file] = out.split('/')
      expect(user).toBe('1')
      expect(out.split('/')).toHaveLength(2)                                  // no extra path segments were created
      expect(decodeURIComponent(file)).toBe(n)                                // and the name round-trips exactly
      expect(file).not.toMatch(/[#?]/)
    }
    expect(uploadUrlPath('uploads/1/my clip.mp4')).toBe('1/my%20clip.mp4')
  })
  it('a literal "%2e%2e" file name is encoded, not treated as a dot segment', () => {
    expect(uploadUrlPath('/data/uploads/1/%2e%2e')).toBe('1/%252e%252e')
  })
})

describe('unexpected paths never become URLs', () => {
  const unexpected = [
    '/etc/passwd', '/tmp/x.mp4', '/data/other/1/x.mp4', '/data/uploads', '/data/uploadsX/1/x.mp4', '/DATA/UPLOADS/1/x.mp4', '/data/uploads-evil/1/x.mp4', '/data/x.mp4',
    'C:/Users/a/uploads/1/x.mp4', 'C:\\Users\\a\\uploads\\1\\x.mp4', 'c:x.mp4', '//server/share/x.mp4', '/uploads', '/var/data/uploads/1/x.mp4',
  ]
  it.each(unexpected)('%s -> no URL', fp => {
    expect(uploadUrlPath(fp)).toBeNull()
    expect(assetsApi.previewUrl(fp)).toBe('')
  })
  it('traversal and dot segments are refused in every spelling', () => {
    const t = [
      '/data/uploads/../x', '/data/uploads/1/../../etc/passwd', 'uploads/../../etc/passwd', '/uploads/../x', 'uploads/1/./x.mp4', '/data/uploads/1/..', '/data/uploads/..\\..\\x',
      '..', '../x', 'uploads/1/..\\x', '/data/uploads//1/x.mp4', 'uploads/1//x.mp4', '/data/uploads/1/x.mp4/',
    ]
    for (const fp of t) { expect(uploadUrlPath(fp), fp).toBeNull(); expect(assetsApi.previewUrl(fp), fp).toBe('') }
  })
  it('nothing it does return can contain a dot segment, a double slash or a scheme', () => {
    for (const fp of [`/data/uploads/1/${HEX}.mp4`, 'uploads/1/a.b.c.mp4', 'uploads/1/..hidden', 'uploads/1/.hidden']) {
      const out = uploadUrlPath(fp)!
      expect(out.split('/').some(s => s === '.' || s === '..' || s === '')).toBe(false)
      expect(out).not.toMatch(/^[a-z]+:/i)
    }
  })
})

describe('malformed input', () => {
  it('non-strings, empty and bare roots return no URL and never throw', () => {
    for (const bad of [undefined, null, 5, {}, [], true, '', '/', 'uploads/', '/uploads/', '/data/uploads/', '\n', 'uploads/1/x\u0000.mp4', 'uploads/1/x\n.mp4', '/data/uploads/1/\u007f']) {
      expect(() => uploadUrlPath(bad as never), String(bad)).not.toThrow()
      expect(uploadUrlPath(bad as never), JSON.stringify(bad)).toBeNull()
      expect(assetsApi.previewUrl(bad as never), JSON.stringify(bad)).toBe('')
    }
  })
})
