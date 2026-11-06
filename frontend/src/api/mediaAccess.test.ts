import { afterEach, describe, expect, it } from 'vitest'
import { getMediaToken, isMediaUrl, mediaTokenSecondsLeft, setMediaToken, stripMediaToken, withMediaToken } from './mediaAccess'

afterEach(() => setMediaToken(null))

describe('which URLs are media URLs', () => {
  it('only /uploads/<user id>/<file> links', () => {
    for (const u of ['http://api.test/uploads/5/a.mp4', '/uploads/12/x.jpg', 'https://h/uploads/5/a.mp4?x=1#t=3']) expect(isMediaUrl(u), u).toBe(true)
    for (const u of ['http://api.test/assets/5/download', '/uploads/a.mp4', 'blob:http://x/uploads/5/a.mp4', 'data:image/png;base64,AAAA', '', 'https://example.com/video.mp4']) expect(isMediaUrl(u), u).toBe(false)
  })
})

describe('withMediaToken', () => {
  it('adds the current token to a media URL and keeps everything else in it', () => {
    setMediaToken('TOK', 3600)
    expect(withMediaToken('http://api.test/uploads/5/a.mp4')).toBe('http://api.test/uploads/5/a.mp4?mt=TOK')
    expect(withMediaToken('/uploads/5/a.mp4?x=1')).toBe('/uploads/5/a.mp4?x=1&mt=TOK')
    expect(withMediaToken('http://api.test/uploads/5/a.mp4#t=2')).toBe('http://api.test/uploads/5/a.mp4?mt=TOK#t=2')
  })
  it('replaces an older token instead of stacking', () => {
    setMediaToken('NEW', 3600)
    expect(withMediaToken('http://api.test/uploads/5/a.mp4?mt=OLD')).toBe('http://api.test/uploads/5/a.mp4?mt=NEW')
    expect(withMediaToken(withMediaToken('/uploads/5/a.mp4'))).toBe('/uploads/5/a.mp4?mt=NEW')            // idempotent
  })
  it('never touches other URLs, and does nothing until a token exists', () => {
    expect(withMediaToken('http://api.test/uploads/5/a.mp4')).toBe('http://api.test/uploads/5/a.mp4')
    setMediaToken('TOK', 3600)
    for (const u of ['blob:abc', 'data:image/png;base64,AA', 'https://example.com/a.mp4', '/assets/1/download']) expect(withMediaToken(u)).toBe(u)
  })
})

describe('stripMediaToken', () => {
  it('removes only the token', () => {
    expect(stripMediaToken('http://h/uploads/5/a.mp4?mt=OLD')).toBe('http://h/uploads/5/a.mp4')
    expect(stripMediaToken('/uploads/5/a.mp4?x=1&mt=OLD#t=3')).toBe('/uploads/5/a.mp4?x=1#t=3')
    expect(stripMediaToken('https://example.com/a.mp4?mt=keep')).toBe('https://example.com/a.mp4?mt=keep')
  })
})

describe('token lifetime', () => {
  it('reports seconds left and clears', () => {
    setMediaToken('TOK', 100)
    expect(getMediaToken()).toBe('TOK')
    expect(mediaTokenSecondsLeft()).toBeGreaterThan(95)
    expect(mediaTokenSecondsLeft(Date.now() + 200_000)).toBe(0)
    setMediaToken(null)
    expect(getMediaToken()).toBeNull()
    expect(mediaTokenSecondsLeft()).toBe(0)
  })
})
