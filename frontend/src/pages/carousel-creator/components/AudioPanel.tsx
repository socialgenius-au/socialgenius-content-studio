import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react'
import { Loader2, Music, Upload, Volume2, VolumeX, Trash2 } from 'lucide-react'
import { assetsApi, uploadApi } from '../../../api/client'
import { stripMediaToken, withMediaToken } from '../../../api/mediaAccess'
import type { Asset } from '../../../types'
import type { AudioTrack, PostDocument } from '../../../lib/postDocument'
import { AUDIO_ACCEPT, audibleWindow, newTrack, normalizeTrack, probeAudioDuration, replaceTrackFile, validateAudioFile } from '../../../lib/carousel/audio'
import { buildTimeline } from '../../../lib/carousel/animation'
import type { EditorAction } from '../editorState'

const field = 'h-8 w-full rounded-md border border-border bg-background px-2 text-sm'
const btn = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50'
const sec = (ms: number) => Math.round(ms) / 1000
const ms = (s: number) => Math.max(0, Math.round(s * 1000))
const storedUrl = (a: Pick<Asset, 'file_path'>) => stripMediaToken(assetsApi.previewUrl(a.file_path))

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="min-w-0">{children}</span></label>
}

/** Background music for animated MP4 exports: add, replace, trim, mute and delete one track, with volume, fades and a start time. GIFs are silent. */
export default function AudioPanel({ doc, dispatch, probe = probeAudioDuration }: { doc: PostDocument; dispatch: Dispatch<EditorAction>; probe?: (url: string) => Promise<number> }) {
  const track = doc.audio
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const total = buildTimeline(doc).totalMs

  useEffect(() => {
    if (!picking && track) return
    let live = true
    assetsApi.list({ file_type: 'audio' }).then(r => { if (live) setAssets((r.data as Asset[]).slice(0, 40)) }).catch(() => { if (live) { setAssets([]); setError('Could not load your audio library.') } })
    return () => { live = false }
  }, [picking, track])

  const set = (patch: Partial<AudioTrack>) => track && dispatch({ type: 'setAudio', audio: normalizeTrack({ ...track, ...patch }) })
  const choose = async (a: Pick<Asset, 'id' | 'file_path' | 'original_filename'>) => {
    setBusy(true); setError(null)
    try {
      const url = storedUrl(a)
      const asset = { assetId: a.id, url, name: a.original_filename }
      const dur = await probe(withMediaToken(url))
      if (!dur) throw new Error('This browser could not read that audio file. Try an MP3, WAV, M4A or AAC.')
      dispatch({ type: 'setAudio', audio: track ? normalizeTrack(replaceTrackFile(track, asset, dur)) : newTrack(asset, dur) })
      setPicking(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not use that audio file.') } finally { setBusy(false) }
  }
  const upload = async (file: File | undefined) => {
    if (!file) return
    const problem = validateAudioFile(file)
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)
    try { const a = (await uploadApi.upload(file)).data as Asset; setAssets(cur => [a, ...(cur ?? [])]); await choose(a) }
    catch { setError('The upload failed. Check your connection and try again.'); setBusy(false) }
    finally { if (input.current) input.current.value = '' }
  }

  const w = track ? audibleWindow(track, total) : null
  const showPicker = !track || picking

  return (
    <section aria-label="Background music" className="space-y-2 border-t border-border pt-3" data-testid="audio-panel">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Music className="h-3.5 w-3.5" />Background music</h3>
      {error && <p role="alert" className="text-xs text-destructive" data-testid="audio-error">{error}</p>}

      {track && (
        <div className="space-y-2 rounded-md border border-border p-2" data-testid="audio-track">
          <div className="flex items-center gap-2">
            <Music className="h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" data-testid="audio-name">{track.name}</p><p className="text-[11px] text-muted-foreground">{sec(track.sourceMs).toFixed(1)} s long{track.muted ? ' · muted' : ''}</p></div>
            <button type="button" className={btn} onClick={() => set({ muted: !track.muted })} aria-pressed={track.muted} aria-label={track.muted ? 'Unmute the music' : 'Mute the music'} data-testid="audio-mute">{track.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
          </div>
          <Row label={`Volume ${Math.round(track.volume * 100)}%`}><input type="range" min={0} max={200} step={1} value={Math.round(track.volume * 100)} onChange={e => set({ volume: Number(e.target.value) / 100 })} className="w-full" aria-label="Music volume" data-testid="audio-volume" /></Row>
          <Row label="Starts at (s)"><input type="number" min={0} step={0.1} className={field} value={sec(track.offsetMs)} onChange={e => e.target.value !== '' && set({ offsetMs: ms(Number(e.target.value)) })} aria-label="Where the music starts on the timeline, in seconds" data-testid="audio-offset" /></Row>
          <Row label="Trim from (s)"><input type="number" min={0} step={0.1} className={field} value={sec(track.trimStartMs)} onChange={e => e.target.value !== '' && set({ trimStartMs: ms(Number(e.target.value)) })} aria-label="Play the music from this point of the file, in seconds" data-testid="audio-trim-start" /></Row>
          <Row label="Trim to (s)"><input type="number" min={0} step={0.1} className={field} value={track.trimEndMs ? sec(track.trimEndMs) : sec(track.sourceMs)} onChange={e => e.target.value !== '' && set({ trimEndMs: ms(Number(e.target.value)) })} aria-label="Stop the music at this point of the file, in seconds" data-testid="audio-trim-end" /></Row>
          <Row label="Fade in (s)"><input type="number" min={0} step={0.1} className={field} value={sec(track.fadeInMs)} onChange={e => e.target.value !== '' && set({ fadeInMs: ms(Number(e.target.value)) })} aria-label="Fade in, in seconds" data-testid="audio-fade-in" /></Row>
          <Row label="Fade out (s)"><input type="number" min={0} step={0.1} className={field} value={sec(track.fadeOutMs)} onChange={e => e.target.value !== '' && set({ fadeOutMs: ms(Number(e.target.value)) })} aria-label="Fade out, in seconds" data-testid="audio-fade-out" /></Row>
          <p className="text-[11px] text-muted-foreground" data-testid="audio-summary">{w ? `The music is heard from ${sec(w.startMs).toFixed(1)} s to ${sec(w.endMs).toFixed(1)} s of the ${sec(total).toFixed(1)} s video${w.endMs >= total && track.sourceMs - track.trimStartMs > total - track.offsetMs ? ' (cut off at the end of the video)' : w.endMs < total ? ' (the video continues in silence)' : ''}.` : track.muted ? 'The music is muted.' : 'No part of the music falls inside the video.'}</p>
          <div className="flex gap-1.5">
            <button type="button" className={btn} onClick={() => setPicking(true)} data-testid="audio-replace">Replace file</button>
            <button type="button" className={`${btn} text-destructive`} onClick={() => dispatch({ type: 'setAudio', audio: null })} data-testid="audio-delete"><Trash2 className="h-3.5 w-3.5" />Remove music</button>
          </div>
        </div>
      )}

      {showPicker && (
        <div className="space-y-2" data-testid="audio-picker">
          <input ref={input} type="file" accept={AUDIO_ACCEPT} className="hidden" onChange={e => void upload(e.target.files?.[0])} data-testid="audio-file-input" />
          <button type="button" className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border text-sm font-medium hover:bg-muted disabled:opacity-60" disabled={busy} onClick={() => input.current?.click()} data-testid="audio-upload">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload music (MP3, WAV, M4A, AAC)</button>
          {assets === null && <p className="text-xs text-muted-foreground">Loading your audio library…</p>}
          {assets?.length === 0 && <p className="text-xs text-muted-foreground" data-testid="audio-empty">No audio in your library yet.</p>}
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {(assets ?? []).map(a => <li key={a.id}><button type="button" className="flex w-full items-center gap-2 rounded border border-border px-2 py-1 text-left text-xs hover:bg-muted" disabled={busy} onClick={() => void choose(a)} data-testid="audio-library-item"><Music className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{a.original_filename}</span></button></li>)}
          </ul>
          {track && <button type="button" className="text-[11px] underline" onClick={() => setPicking(false)}>Keep the current music</button>}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground" data-testid="audio-note">Music is mixed into MP4 exports. A GIF cannot have sound, so GIF exports are always silent.</p>
    </section>
  )
}
