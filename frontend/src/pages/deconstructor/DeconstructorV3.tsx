import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Aperture, ArrowRight, Clapperboard, Film, FolderKanban, FolderOpen, Globe, Home, Image, LayoutTemplate, MessageSquare, Palette, RefreshCw, ScanSearch, Settings, Target, UploadCloud, Zap } from 'lucide-react'
import { assetsApi, referenceVideosApi, uploadApi, videoExportApi } from '../../api/client'
import type { ReferenceVideo } from '../../types'
import { errorMessage, useDeconstructor } from './useDeconstructor'
import { evidenceSummary, hookSummary, typeLabel } from './intelligence'
import './DeconstructorV3.css'

const root = '/deconstructor-v3'
const navigation = [
  ['Home','/home',Home], ['Campaigns','/dashboard-classic',FolderKanban],
  ['Post Creator','/post-creator-v2',Image], ['Video Studio','/video-studio-v3',Film],
  ['Deconstructor',root,ScanSearch], ['Reconstructor','/reconstructor/assets',RefreshCw],
  ['Assets','/assets',FolderOpen], ['Templates','/templates',LayoutTemplate],
  ['Brand Kit','/brands',Palette], ['Settings','/settings',Settings],
] as const
const views = ['Reference', 'Quick Analysis', 'Deep Analysis', 'Selective Analysis', 'Messaging Intelligence', 'Technical Intelligence', 'Discoverability'] as const
type View = typeof views[number]
type Evidence = 'Extracted' | 'Detected' | 'Inferred' | 'Researched' | 'Unavailable'
type Finding = [label: string, value: ReactNode, evidence: Evidence]
const modules = [
  ['technical', 'Technical Intelligence', 'Detect shot boundaries and extract frames.'],
  ['messaging', 'Messaging Intelligence', 'Transcribe speech and detect on-screen text.'],
  ['discoverability', 'Discoverability Intelligence', 'Find terms and hashtags visible in the video.'],
  ['metadata', 'Metadata', 'Probe video, audio and container properties.'],
  ['keywords', 'Keywords', 'Extract terms from speech and visible text.'],
  ['hashtags', 'Hashtags', 'Detect hashtags present in the reference.'],
  ['seo', 'SEO', 'Live cited search research.'],
  ['geo', 'GEO', 'Live cited generative search research.'],
  ['aeo', 'AEO', 'Live cited answer-engine research.'],
  ['local', 'Local', 'Location-specific SEO research using a public topic.'],
] as const
type Module = typeof modules[number][0]
type ContextNotes = { industry: string; contentType: string; objective: string; audience: string; note: string }
const emptyNotes: ContextNotes = { industry: '', contentType: '', objective: '', audience: '', note: '' }
type TimelineItem = { key: string; start: number; end: number; text: string }

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
const spanLabel = (start: number, end: number) => `${time(start)} – ${time(end)}`
const result = (label: string, value: string | number | null | undefined, source: Evidence): Finding =>
  [label, value == null || value === '' ? 'Unavailable' : value, value == null || value === '' ? 'Unavailable' : source]

function Card({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`dc3-card ${className}`}><h2>{title}</h2><div className="dc3-card-content">{children}</div></section>
}
function Findings({ rows }: { rows: Finding[] }) {
  return <dl className="dc3-findings">{rows.map(([label, value, source]) => <div key={label}><dt>{label}</dt><dd>{value ?? 'Unavailable'}</dd><dd><span className={`dc3-badge dc3-${source.toLowerCase()}`}>{source}</span></dd></div>)}</dl>
}
function mediaProperties(reference: ReferenceVideo | null): Finding[] {
  const facts = reference?.technical_details
  const picture = facts?.video
  const audio = facts?.audio
  return [
    result('File name', reference?.original_filename, 'Extracted'),
    result('Duration', facts?.container.duration_seconds != null ? time(facts.container.duration_seconds) : null, 'Extracted'),
    result('Resolution', picture?.width && picture?.height ? `${picture.width} × ${picture.height}` : null, 'Extracted'),
    result('Aspect ratio', picture?.display_aspect_ratio && picture.display_aspect_ratio !== 'N/A' ? picture.display_aspect_ratio : picture?.width && picture?.height ? (() => { const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a; const divisor = gcd(picture.width, picture.height); return `${picture.width / divisor}:${picture.height / divisor} (pixel dimensions)` })() : null, 'Extracted'),
    result('Frame rate', (picture?.average_frame_rate ?? picture?.frame_rate) != null ? `${picture?.average_frame_rate ?? picture?.frame_rate} fps` : null, 'Extracted'),
    result('Format / codec', [facts?.container.format_name, picture?.codec_name].filter(Boolean).join(' / '), 'Extracted'),
    result('Audio', audio?.present ? [audio.codec_name, audio.channel_layout, audio.sample_rate_hz && `${audio.sample_rate_hz} Hz`].filter(Boolean).join(' · ') : audio ? 'No audio stream' : null, 'Extracted'),
  ]
}
// Display guard only: retain raw evidence in storage for diagnostic review.
function readableOverlay(text: string): boolean {
  const value = text.trim()
  const tokens = value.split(/\s+/)
  const numeric = tokens.filter(token => /^[-+]?\d+(?:\.\d+)?$/.test(token)).length
  return /\p{L}\p{M}*\p{L}/u.test(value) && !(tokens.length >= 5 && numeric / tokens.length >= 0.5)
}
function sourceTerms(text: string) {
  const ignore = new Set(['about','above','after','again','are','and','before','from','have','here','into','just','more','only','some','than','that','them','then','there','these','they','this','those','what','when','where','which','will','with','would','your','you'])
  const terms = new Map<string, number>()
  for (const word of text.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]{3,}/gu) ?? []) {
    if (/\p{L}/u.test(word) && !ignore.has(word)) terms.set(word, (terms.get(word) ?? 0) + 1)
  }
  return [...terms.entries()].sort((a,b) => b[1] - a[1]).slice(0,12).map(([word]) => word)
}

const researchDimensions = ['SEO', 'GEO', 'AEO'] as const
type ResearchDimension = typeof researchDimensions[number]
type ResearchReport = {
  topic: string
  researched_at: string
  partial?: boolean
  findings: {text: string; citations: {url:string; title:string}[]}[]
}

const researchReportTitles = {
  SEO: 'Search topics and related keywords',
  GEO: 'Source coverage for generative answers',
  AEO: 'Questions and cited answers',
} satisfies Record<ResearchDimension, string>

function ExternalResearch({referenceId, onReports}: {referenceId: number; onReports: (reports: Partial<Record<ResearchDimension, ResearchReport>>) => void}) {
  const [topic, setTopic] = useState('')
  const [reports, setReports] = useState<Partial<Record<ResearchDimension, ResearchReport>>>({})
  const [pending, setPending] = useState<ResearchDimension | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let live = true
    referenceVideosApi.searchResearch(referenceId).then(({data}) => {
      if (live) { setReports(data); onReports(data); setTopic(previous => previous || Object.values(data as Partial<Record<ResearchDimension, ResearchReport>>).find(report => report?.topic)?.topic || '') }
    }).catch(error => {if (live) setMessage(errorMessage(error, 'Saved research could not be loaded.'))})
    return () => {live = false}
  }, [referenceId])
  async function research(dimension: ResearchDimension) {
    if (pending || topic.trim().length < 3) return
    setPending(dimension)
    setMessage('')
    try {
      const {data} = await referenceVideosApi.runSearchResearch(referenceId, topic.trim(), dimension)
      const updated = {...reports, [dimension]:data}
      setReports(updated)
      onReports(updated)
    } catch (error) {
      setMessage(errorMessage(error, 'Web research was unavailable.'))
    } finally {
      setPending(null)
    }
  }
  return <Card title="External search research">
    <label>Public search topic <input value={topic} onChange={event => setTopic(event.target.value)} maxLength={160} /></label>
    <p>The topic is sent to Claude for live web search. Each report includes cited sources. Rankings, search volume and visibility on other answer engines require separate measurements.</p>
    <div className="dc3-actions">{researchDimensions.map(dimension =>
      <button key={dimension} type="button" disabled={!!pending || topic.trim().length < 3} onClick={() => void research(dimension)}>
        {pending === dimension ? `Researching ${dimension}…` : `Research ${dimension}`}
      </button>
    )}</div>
    {message && <p role="status">{message}</p>}
    {researchDimensions.map(dimension => {
      const report = reports[dimension]
      return report && <details key={dimension} open>
        <summary>{dimension} · {report.topic}</summary>
        <small>{new Date(report.researched_at).toLocaleString()} · {report.partial ? 'Partial web-cited findings' : 'Web-cited findings'}</small>
        <h3>{researchReportTitles[dimension]}</h3>
        {report.findings.map((finding,index) => <div key={index}>
          <p>{finding.text}</p>
          <ul>{finding.citations.map((source,sourceIndex) =>
            <li key={sourceIndex}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>
          )}</ul>
        </div>)}
      </details>
    })}
  </Card>
}

export default function DeconstructorV3() {
  const { referenceVideoId } = useParams()
  const id = referenceVideoId && /^\d+$/.test(referenceVideoId) ? Number(referenceVideoId) : null
  const [params, setParams] = useSearchParams()
  const mode = views.find(view => view === params.get('view')) ?? 'Reference'
  const changeView = (view: View) => setParams({ view })
  const navigate = useNavigate()
  const d = useDeconstructor(id)
  const [reference, setReference] = useState<ReferenceVideo | null>(null)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const [select, setSelect] = useState<Module[]>(['technical','metadata'])
  const [researchTopic, setResearchTopic] = useState('')
  const [speechLanguage, setSpeechLanguage] = useState('')
  const [speechReadings, setSpeechReadings] = useState<{id:number; data: Awaited<ReturnType<typeof referenceVideosApi.transcriptAlternatives>>['data']} | null>(null)
  const speechReading = speechReadings && speechReadings.id === id ? speechReadings.data.alternatives.find(
    reading => reading.model === 'small' && reading.language_hint === (speechLanguage || null),
  ) : undefined
  useEffect(() => {
    if (!id || mode !== 'Messaging Intelligence') return
    let current = true
    referenceVideosApi.transcriptAlternatives(id).then(({data}) => {
      if (current) setSpeechReadings({id, data})
    }).catch(() => { /* A reference may not have transcript evidence yet. */ })
    return () => { current = false }
  }, [id, mode])
  const [range, setRange] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [sourceScope, setSourceScope] = useState('')
  const [selected, setSelected] = useState(0)
  const [deepTab, setDeepTab] = useState<'Overview' | 'Scenes' | 'Narrative' | 'Messaging' | 'Persuasion' | 'Emotions' | 'Technical' | 'Transcript' | 'Keywords' | 'Mechanisms'>('Overview')
  const [messageTab, setMessageTab] = useState<'Strategy' | 'Hook' | 'Problem' | 'Solution' | 'Storytelling' | 'Persuasion' | 'Audience'>('Strategy')
  const [tabular, setTabular] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [waveform, setWaveform] = useState<{ referenceId: number; peaks: number[] } | null>(null)
  const [waveformLoading, setWaveformLoading] = useState(false)
  const [contextByReference, setContextByReference] = useState<Record<string, ContextNotes>>(() => { try { return JSON.parse(sessionStorage.getItem('sg-dc3-context') || '{}') } catch { return {} } })
  useEffect(() => { try { sessionStorage.setItem('sg-dc3-context', JSON.stringify(contextByReference)) } catch { /* Context remains available in memory. */ } }, [contextByReference])
  const contextKey = id?.toString() ?? 'new'
  const notes = contextByReference[contextKey] ?? emptyNotes
  const setNotes = (next: ContextNotes) => setContextByReference(previous => ({ ...previous,[contextKey]:next }))
  const [urlMode, setUrlMode] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState('')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [publication, setPublication] = useState<{id:number; creator?:string; provider?:string; provider_video_id?:string} | null>(null)
  const [sending, setSending] = useState(false)
  const player = useRef<HTMLVideoElement>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (id == null) return
    let live = true
    referenceVideosApi.get(id).then(({data}) => {
      if (live) setReference(data)
    }).catch(error => { if (live) setMessage(errorMessage(error, 'Could not load the reference video.')) })
    return () => { live = false }
  }, [id, d.references.data])
  const video = reference?.id === id ? reference : null
  useEffect(() => {
    if (!video?.original_url) return
    const id = video.id
    let live = true
    referenceVideosApi.publication(id).then(({data}) => {
      if (live && data) setPublication({...data,id})
    }).catch(() => { /* Provider evidence remains unavailable. */ })
    return () => {live = false}
  }, [video?.id, video?.original_url])
  const [savedReports, setSavedReports] = useState<{id:number; reports: Partial<Record<ResearchDimension, ResearchReport>>} | null>(null)
  useEffect(() => {
    if (!id) return
    let live = true
    referenceVideosApi.searchResearch(id).then(({data}) => { if (live) setSavedReports({id, reports:data}) }).catch(() => {})
    return () => { live = false }
  }, [id])
  const publishedEvidence = publication?.id === video?.id ? publication : null
  const details = video?.technical_details
  const duration = details?.container.duration_seconds ?? details?.video.duration_seconds ?? 0
  const anatomy = d.anatomy.data?.provenance.reference_video_id === id ? d.anatomy.data : null
  const creative = anatomy ? d.intelligence.data : null
  const shots = video?.shots ?? []
  const sections = anatomy?.sections ?? []
  const sceneList = sections.length ? sections.map(section => ({
    number: section.number, start: section.start_time, end: section.end_time,
    role: section.interpretive.narrative_role || 'Scene',
    story: section.speech_reading?.text || section.transcript_excerpt || section.on_screen_text.filter(text => readableOverlay(text.text)).map(text => text.text).join(' · '),
    technical: `${section.pacing.shot_count} detected shots`,
    audio: section.audio.audio_stream_present ? 'Audio stream detected' : '',
  })) : shots.map(shot => ({ number: shot.order, start: shot.start_time, end: shot.end_time, role: 'Shot', story: shot.text_elements.filter(text => readableOverlay(text.text)).map(text => text.text).join(' · '), technical: shot.evidence_summary || '', audio: '' }))
  const waveformPeaks = waveform?.referenceId === id ? waveform.peaks : null
  const activeShot = shots.find(shot => playhead >= shot.start_time && playhead < shot.end_time) ?? shots[selected]
  const speech = video?.speech_segments ?? []
  const transcript = speech.map(segment => segment.text).join(' ')
  const timeline: { label: string; items: TimelineItem[] }[] = [
    {label:'Scenes',items:sceneList.map(scene => ({key:String(scene.number),start:scene.start,end:scene.end,text:`${scene.role} ${scene.number}`}))},
    {label:'Shots',items:shots.map(shot => ({key:String(shot.id),start:shot.start_time,end:shot.end_time,text:`Shot ${shot.order}`}))},
    {label:'Text overlays',items:shots.flatMap(shot => shot.text_elements.filter(item => readableOverlay(item.text)).map(item => ({key:String(item.id),start:item.start_time,end:item.end_time,text:item.text})))},
    {label:'Speech',items:speech.map(item => ({key:String(item.id),start:item.start_time,end:item.end_time,text:item.text}))},
    {label:'Transitions',items:(video?.transition_evidence ?? []).map(item => ({key:String(item.id),start:item.boundary_timestamp,end:item.boundary_timestamp,text:'Boundary measurement'}))},
  ]
  const observedText = shots.flatMap(shot => shot.text_elements.filter(item => readableOverlay(item.text)).map(item => item.text)).join(' ')
  const detectedTerms = sourceTerms(`${transcript} ${observedText}`)
  const visibleHashtags = [...new Set(observedText.match(/#[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*/gu) ?? [])]
  const metadata = mediaProperties(video)
  const messaging: Finding[] = [
    result('Business objective', notes.objective || null, 'Extracted'),
    result('Strategy and positioning', anatomy?.video.creative?.summary, 'Inferred'),
    result('Core message', anatomy?.video.creative?.summary, 'Inferred'),
    result('Hook', creative?.hook ? hookSummary(creative.hook) : null, 'Inferred'),
    result('Problem', sections.find(section => /problem/i.test(section.interpretive.narrative_role ?? ''))?.transcript_excerpt, 'Inferred'),
    result('Solution', sections.find(section => /solution/i.test(section.interpretive.narrative_role ?? ''))?.transcript_excerpt, 'Inferred'),
    result('Benefits', sections.find(section => /benefit/i.test(section.interpretive.narrative_role ?? ''))?.transcript_excerpt, 'Inferred'),
    result('Storytelling', creative?.narrative?.arc_text, 'Inferred'),
    result('Persuasion mechanisms', creative?.mechanisms.map(typeLabel).join(' · '), 'Inferred'),
    result('Emotional triggers', [...new Set(sections.flatMap(section => section.interpretive.emotional_function || []))].join(' · '), 'Inferred'),
    result('Target audience', notes.audience || null, 'Extracted'),
    result('Trust signals', sections.find(section => /trust/i.test(section.interpretive.narrative_role ?? ''))?.transcript_excerpt, 'Inferred'),
    result('Call to action', sections.find(section => section.interpretive.cta_role)?.transcript_excerpt, 'Inferred'),
  ]
  const discoverability: Finding[] = [
    result('Published URL', video?.original_url, 'Extracted'),
    result('Platform', publishedEvidence?.provider, 'Extracted'),
    result('Publisher', publishedEvidence?.creator, 'Extracted'),
    result('Platform video ID', publishedEvidence?.provider_video_id, 'Extracted'),
    result('Published title', null, 'Extracted'),
    result('Published description', null, 'Extracted'),
    result('Frequently detected terms', detectedTerms.join(' · '), 'Detected'),
    result('Hashtags visible in the video', visibleHashtags.join(' · '), 'Detected'),
    result('Published hashtags', null, 'Extracted'),
    result('Detected visual entities', [...new Set(shots.flatMap(shot => (shot.visual_objects ?? []).map(item => item.label)))].join(' · '), 'Detected'),
    result('Searchable terms in recognised speech', sourceTerms(transcript).join(' · '), 'Detected'),
    result('Searchable terms in on-screen text', sourceTerms(observedText).join(' · '), 'Detected'),
    result('Questions in recognised speech', speech.filter(segment => /[?؟？]/u.test(segment.text)).slice(0,6).map(segment => `${time(segment.start_time)} · ${segment.text}`).join(' / '), 'Detected'),
    result('Primary keyword candidates (frequency ranked)', detectedTerms.slice(0,3).join(' · '), 'Detected'),
    result('Secondary keyword candidates (frequency ranked)', detectedTerms.slice(3).join(' · '), 'Detected'),
    ...['Publication date', 'Views', 'Likes', 'Long-tail and semantic keywords', 'Geographic and local search'].map(label => result(label, null, 'Researched')),
    ...researchDimensions.map(dimension => { const report = savedReports?.id === id ? savedReports.reports[dimension] : undefined; return result(dimension, report?.findings.length ? `${report.partial ? 'Partial research' : 'Research saved'} · ${report.findings.length} cited findings · ${report.topic}` : null, 'Researched') }),
  ]
  const busy = working || d.busy !== null
  const selectReference = (newId: number, view: View = 'Reference') => {
    setSelected(0)
    setPlayhead(0)
    navigate(`${root}/${newId}?view=${encodeURIComponent(view)}`)
  }
  const importVideo = async (candidate?: File) => {
    if (!candidate || busy) return
    setMessage('')
    const newId = await d.addReference(candidate)
    if (newId != null) {
      setSourceScope('')
      setContextByReference(previous => ({ ...previous,[newId]:notes }))
      selectReference(newId)
      try { setReference((await referenceVideosApi.analyze(newId)).data) }
      catch (error) { setMessage(errorMessage(error, 'Video uploaded. Metadata extraction can be retried in Quick Analysis.')) }
    }
  }
  const importPublished = async () => {
    if (busy || !rightsConfirmed) return
    setWorking(true)
    setMessage('')
    try {
      const {data} = await referenceVideosApi.importPublished(publishedUrl.trim())
      const publishedId = data.id as number
      setContextByReference(previous => ({...previous,[publishedId]:notes}))
      selectReference(publishedId)
      setReference(data)
      const metadata = await referenceVideosApi.analyze(publishedId)
      setReference(metadata.data)
    } catch (error) {
      setMessage(errorMessage(error, 'Published source import could not be completed.'))
    } finally {
      setWorking(false)
    }
  }
  const updateTime = (seconds: number) => {
    setPlayhead(seconds)
    if (player.current) player.current.currentTime = seconds
  }
  const run = async (custom: boolean) => {
    if (!video || busy) return
    setWorking(true)
    setMessage('')
    try {
      const researchSelected = custom && select.some(key => ['seo','geo','aeo','local'].includes(key))
      if (researchSelected && researchTopic.trim().length < 3) throw Error('Enter a public research topic, including a location for Local research.')
      let target = video
      if (custom && !select.length) throw Error('Select at least one analysis module.')
      if (custom && range) {
        const a = Number(start)
        const b = Number(end)
        if (!start || !end || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || b > duration) throw Error('Enter a start and end within the source duration.')
        const landscape = (details?.video.width ?? 0) >= (details?.video.height ?? 0)
        const excerpt = await videoExportApi.exportProject({
          canvas_width: details?.video.width || (landscape ? 1920 : 1080), canvas_height: details?.video.height || (landscape ? 1080 : 1920),
          video_clips: [{asset_id:video.asset_id,start_time:0,end_time:b-a,trim_in:a}],
        })
        const name = `Reference ${video.id} excerpt ${a}-${b}s.mp4`
        const uploaded = await uploadApi.upload(new File([excerpt.data],name,{type:'video/mp4'}))
        target = (await referenceVideosApi.ingest(uploaded.data.id)).data
        setSourceScope(`Excerpt from ${video.original_filename}, ${spanLabel(a,b)}. Timecodes and technical properties refer to the rendered excerpt.`)
      } else {
        setSourceScope('')
      }
      const targetId = target.id
      await referenceVideosApi.analyze(targetId)
      const speechAndText = custom && (select.includes('messaging') || select.includes('discoverability') || select.includes('keywords') || select.includes('hashtags'))
      if (!custom || select.includes('technical') || speechAndText) await referenceVideosApi.analyzeStructure(targetId)
      if (custom && (select.includes('technical') || speechAndText)) await referenceVideosApi.analyzeFrames(targetId)
      if (speechAndText) {
        await referenceVideosApi.analyzeText(targetId)
        await referenceVideosApi.analyzeSpeech(targetId)
      }
      if (researchSelected) {
        const reports = {...(await referenceVideosApi.searchResearch(targetId)).data} as Partial<Record<ResearchDimension, ResearchReport>>
        const dimensions = researchDimensions.filter(dimension =>
          select.includes(dimension.toLowerCase() as Module) || (dimension === 'SEO' && select.includes('local')))
        for (const dimension of dimensions) {
          const saved = reports[dimension]
          if (saved && !saved.partial && saved.topic.trim().toLowerCase() === researchTopic.trim().toLowerCase()) continue
          reports[dimension] = (await referenceVideosApi.runSearchResearch(targetId, researchTopic.trim(), dimension)).data
        }
        setSavedReports({id:targetId, reports})
      }
      setReference((await referenceVideosApi.get(targetId)).data)
      const resultView = researchSelected || (custom && select.some(key => ['discoverability','keywords','hashtags'].includes(key)))
        ? 'Discoverability'
        : custom && select.includes('messaging') ? 'Messaging Intelligence'
        : custom && select.includes('technical') ? 'Technical Intelligence' : 'Quick Analysis'
      if (targetId !== id) selectReference(targetId,resultView)
      else changeView(resultView)
      setMessage(custom ? 'Selected analysis completed.' : 'Quick Analysis completed.')
    } catch (error) {
      setMessage(errorMessage(error, error instanceof Error ? error.message : 'Analysis could not be completed.'))
    } finally {
      setWorking(false)
    }
  }
  const rereadSpeech = async () => {
    if (!video || busy) return
    setWorking(true)
    setMessage('')
    try {
      await referenceVideosApi.analyze(video.id)
      await referenceVideosApi.analyzeSpeech(video.id)
      const {data} = await referenceVideosApi.runTranscriptAlternative(video.id, speechLanguage)
      const reading = data.alternatives.find(alternative => alternative.language_hint === (speechLanguage || null) && alternative.model === 'small')
      setSpeechReadings({id:video.id, data})
      if (!reading) setMessage('No alternative speech segments were detected.')
    } catch (error) {
      setMessage(errorMessage(error, 'The speech reading could not be completed.'))
    } finally {
      setWorking(false)
    }
  }
  const loadWaveform = async () => {
    if (!video || waveformLoading) return
    setWaveformLoading(true)
    setMessage('')
    try {
      const measuredSize = details?.container.size_bytes
      if (measuredSize == null || measuredSize > 32 * 1024 * 1024) throw Error('Waveform decoding supports probed files up to 32 MB.')
      const { data } = await assetsApi.download(video.asset_id)
      const bytes = await (data as Blob).arrayBuffer()
      const context = new OfflineAudioContext(1, 1, 8000)
      const audio = await context.decodeAudioData(bytes)
      const samples = audio.getChannelData(0)
      const peaks = Array.from({length:180},(_,index) => {
        const startSample = Math.floor(index * samples.length / 180)
        const endSample = Math.floor((index + 1) * samples.length / 180)
        let peak = 0
        for (let sample = startSample; sample < endSample; sample += 1) peak = Math.max(peak,Math.abs(samples[sample]))
        return peak
      })
      setWaveform({ referenceId:video.id, peaks })
    } catch (error) {
      setMessage(errorMessage(error, error instanceof Error ? error.message : 'This browser could not decode the audio waveform.'))
    } finally {
      setWaveformLoading(false)
    }
  }
  const send = async () => {
    if (!video || !sceneList.length || sending) return
    setSending(true)
    const handoff = { referenceId:video.id, scenes:sceneList, context:notes, messaging, discoverability, metadata, mechanisms:creative?.mechanisms ?? [], provenance:anatomy?.provenance }
    try {
      const {data: savedResearch} = await referenceVideosApi.searchResearch(video.id)
      const researchEvidence = discoverability.map(([label, value, evidence]): Finding => {
        const dimension = researchDimensions.find(item => item === label)
        const report = dimension ? (savedResearch as Partial<Record<ResearchDimension, ResearchReport>>)[dimension] : undefined
        return report?.findings.length ? [label, `${report.topic} · ${report.partial ? 'Partial research' : 'Web research'} · ${report.findings.map(finding => `${finding.text} (${finding.citations.map(source => `${source.title}: ${source.url}`).join('; ')})`).join('\n')}`, 'Researched'] : [label, value, evidence]
      })
      const {data} = await referenceVideosApi.createHandoff(video.id,{...handoff, discoverability: researchEvidence})
      navigate(`/reconstructor/assets?scene=${sceneList[0].number}&reference=${video.id}&handoff=${data.id}`)
    } catch (error) { setMessage(errorMessage(error, 'Could not save this Reconstructor handoff.')) }
    finally { setSending(false) }
  }
  const report = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ reference:video?.original_filename, context:notes, metadata, messaging, discoverability, scenes:sceneList, mechanisms:creative?.mechanisms ?? [] },null,2)],{type:'application/json'}))
    const link = document.createElement('a')
    link.href = url
    link.download = `reference-${id}-analysis.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url),60000)
  }
  const seek = (seconds: number, index: number) => { setSelected(index); updateTime(seconds) }
  const preview = video ? <video className="dc3-preview" ref={player} src={assetsApi.previewUrl(video.asset_file_path)} controls playsInline preload="metadata" onLoadedMetadata={() => { if(player.current) player.current.currentTime = playhead }} onTimeUpdate={event => setPlayhead(event.currentTarget.currentTime)} aria-label="Read-only reference video" /> : <div className="dc3-placeholder"><Film />Select a reference video to preview</div>
  const scenes = <div className="dc3-scenes">{sceneList.map((scene,index) => {
    const frame = shots.find(shot => shot.start_time <= scene.start && shot.end_time > scene.start)?.frames[0]
    return <button type="button" key={scene.number} aria-pressed={playhead >= scene.start && playhead < scene.end} onClick={() => seek(scene.start,index)}><strong>{scene.number}</strong>{frame && <img src={assetsApi.previewUrl(frame.asset_file_path)} alt="" />}<span>{scene.role}<small>{spanLabel(scene.start,scene.end)}</small></span></button>
  })}{!sceneList.length && <p>Run analysis to detect shots and scenes.</p>}</div>
  const row = (label: string, rows: Finding[]) => <Card title={label}><Findings rows={rows} /></Card>
  const tabs = <div className="dc3-modes">{views.map(view => <button key={view} type="button" className={view === mode ? 'chosen' : ''} onClick={() => changeView(view)}>{view}</button>)}</div>
  return <div className={`dc3 ${mode === 'Messaging Intelligence' ? 'dc3-dark' : ''}`}>
    <aside className="dc3-sidebar">
      <Link className="dc3-brand" to="/dashboard"><img src="/social-genius-official-logo.svg" alt="" /><strong>Social Genius</strong><span>Content Studio</span><small>The Positioning People</small></Link>
      <nav aria-label="Content Studio">{navigation.map(([name,url,Icon]) => <Link key={name} to={url} aria-current={url === root ? 'page' : undefined}><Icon />{name}</Link>)}</nav>
    </aside>
    <main>
      <header className="dc3-banner"><Clapperboard /><div><p>Deconstructor</p><h1>{mode === 'Reference' ? 'Reference Import & Context' : mode}</h1></div><span className="dc3-banner-brand"><img src="/social-genius-official-logo.svg" alt="" /><span><strong>Social Genius</strong><small>The Positioning People</small></span></span></header>
      {tabs}
      {(message || d.actionError || sourceScope) && <p className="dc3-status" role="status">{message || d.actionError}{sourceScope && <><br />{sourceScope}</>}</p>}
      {mode === 'Reference' && <div className="dc3-import">
        <Card title="Video Reference">
          <div className="dc3-actions"><button type="button" onClick={() => setUrlMode(false)}>Upload Video File</button><button type="button" onClick={() => setUrlMode(true)}>Published Video URL</button></div>
          {urlMode ? <form className="dc3-drop" onSubmit={event => {event.preventDefault(); void importPublished()}}>
            <label>Published Pexels video URL <input type="url" required value={publishedUrl} onChange={event => setPublishedUrl(event.target.value)} placeholder="https://www.pexels.com/video/…" /></label>
            <label><input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} /> I am authorised to analyse this video.</label>
            <button type="submit" disabled={busy || !rightsConfirmed || !publishedUrl.trim()}>Import published video</button>
            <small>For other platforms, upload a licensed video file.</small>
          </form> : <div className="dc3-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void importVideo(event.dataTransfer.files[0]) }}>
            <UploadCloud /><button type="button" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Working…' : 'Browse or drop a video file'}</button><input ref={file} type="file" accept="video/*" hidden onChange={event => void importVideo(event.currentTarget.files?.[0])} />
          </div>}
          {preview}
          <label>Saved references<select value={id ?? ''} disabled={busy} onChange={event => { if(event.target.value) selectReference(Number(event.target.value)) }}><option value="">Select a reference</option>{(d.references.data ?? []).map(item => <option key={item.id} value={item.id}>{item.original_filename}</option>)}</select></label>
        </Card>
        {row('Video & Metadata Preview', [...metadata,...discoverability.slice(0,3)])}
        <div className="dc3-stack"><Card title="Add Context"><div className="dc3-context">{([['industry','Industry / category'],['contentType','Content type'],['objective','Business objective'],['audience','Target audience']] as const).map(([key,label]) => <label key={key}>{label}<input value={notes[key]} onChange={event => setNotes({...notes,[key]:event.target.value})} /></label>)}<label>Additional context<textarea maxLength={500} value={notes.note} onChange={event => setNotes({...notes,note:event.target.value})} /></label></div></Card>
          {row('Source Evidence',[result('Video file',video?.original_filename,'Extracted'),result('Container metadata',details?'Available':null,'Extracted'),result('Transcript',transcript?'Available':null,'Detected')])}
        </div>
        <footer className="dc3-footer"><span><Target /> Messaging, technical production and discoverability</span><button className="chosen" disabled={!video || busy} type="button" onClick={() => void run(false)}>Begin Quick Analysis <ArrowRight /></button></footer>
      </div>}
      {mode === 'Selective Analysis' && <div className="dc3-grid">
        <div className="dc3-stack"><Card title="Video Reference">{preview}<strong>{video?.original_filename}</strong><small>{time(duration)} · {shots.length} shots</small></Card><Card title="Analysis Focus (Optional)"><label>Public research topic / location<input value={researchTopic} maxLength={160} onChange={event => setResearchTopic(event.target.value)} placeholder="Topic and location for SEO, GEO, AEO or Local" /></label><small>Used for selected external research; not a general AI instruction.</small></Card><Card title="Time Range">
          <label className="dc3-check"><input type="checkbox" checked={range} onChange={event => {setRange(event.target.checked); if(event.target.checked){setStart('0');setEnd(String(duration))}}} />Use a specific time range</label>
          {range && <div className="dc3-context"><label>Start (seconds)<input type="number" min={0} step=".01" value={start} onChange={event => setStart(event.target.value)} /></label><label>End (seconds)<input type="number" min={0} max={duration || undefined} step=".01" value={end} onChange={event => setEnd(event.target.value)} /></label><label>Use scene or shot<select defaultValue="" onChange={event => {
            if (!event.target.value) return
            const [first,last] = event.target.value.split(':')
            setStart(first)
            setEnd(last)
          }}><option value="">Choose a boundary</option>
            {sections.length > 0 && <optgroup label="Scenes">{sections.map(scene => <option key={scene.number} value={`${scene.start_time}:${scene.end_time}`}>Scene {scene.number} · {spanLabel(scene.start_time,scene.end_time)}</option>)}</optgroup>}
            {shots.length > 0 && <optgroup label="Shots">{shots.map(shot => <option key={shot.id} value={`${shot.start_time}:${shot.end_time}`}>Shot {shot.order} · {spanLabel(shot.start_time,shot.end_time)}</option>)}</optgroup>}
          </select></label></div>}
        </Card></div>
        <div className="dc3-stack"><Card title="Select Analysis Modules"><label className="dc3-check"><input type="checkbox" checked={select.length === modules.length} onChange={event => setSelect(event.target.checked ? modules.map(([key]) => key) : [])} />Select all available modules</label><p>Combine intelligence modules for a focused analysis. Local uses the SEO report with a location-specific topic.</p><div className="dc3-modules dc3-selective-modules">{modules.map(([key,label,description]) => <label className={select.includes(key) ? 'selected' : ''} key={key}><input type="checkbox" checked={select.includes(key)} onChange={event => setSelect(event.target.checked ? [...select,key] : select.filter(module => module !== key))} /><strong>{label}</strong><small>{description}</small></label>)}</div></Card>
          <Card title="Analysis Scope Summary"><div className="dc3-actions"><div><strong>{select.length} modules selected</strong><p>{modules.filter(([key]) => select.includes(key)).map(([,label]) => label).join(', ')}</p><small>Scope: {range ? `${Number(start || 0).toFixed(2)}–${Number(end || duration).toFixed(2)}s` : `Full video · ${time(duration)}`} · Selective (Custom) · Processing time varies by module</small></div>{select.some(key => ['seo','geo','aeo','local'].includes(key)) && researchTopic.trim().length < 3 && <p role="status">Enter a public research topic before running selected research modules.</p>}<button className="chosen" type="button" disabled={!video || busy || !select.length || (select.some(key => ['seo','geo','aeo','local'].includes(key)) && researchTopic.trim().length < 3)} onClick={() => void run(true)}><Target />Run Selected Analysis</button></div></Card>
        </div>
      </div>}
      {(mode === 'Quick Analysis' || mode === 'Deep Analysis') && <div className="dc3-grid dc3-analysis">
        <div className="dc3-reference-strip"><strong>{video?.original_filename ?? 'Select a reference'}</strong><span>{duration ? time(duration) : '—'} · {shots.length} detected shots</span></div>
        <div className="dc3-stack">{preview}<Card title="Scenes & Timeline">{scenes}</Card></div>
        <div className="dc3-stack">
          <div className="dc3-actions">{mode === 'Deep Analysis' ? <><button className="chosen" disabled={!video || busy} type="button" onClick={() => { if(window.confirm('Run the full analysis pipeline? Configured AI stages may incur provider costs.')) void d.deconstruct() }}>Run Deep Analysis</button><span role="status">{d.progress.headline}</span></> : <button className="chosen" disabled={!video || busy} type="button" onClick={() => void run(false)}><Zap />Run Quick Analysis</button>}<button type="button" disabled={!video} onClick={report}>Export Analysis</button><button type="button" disabled={!sceneList.length || !video || sending} onClick={() => void send()}>Send to Reconstructor <ArrowRight /></button></div>
          {mode === 'Deep Analysis' && d.progress.steps.length > 0 && <details className="dc3-card"><summary>Analysis status by stage</summary><Findings rows={d.progress.steps.map(step => [step.label,[step.status.replace(/_/g,' '),step.note].filter(Boolean).join(' · '),step.status === 'skipped' || step.status === 'failed' ? 'Unavailable' : 'Extracted'])} /></details>}
          {mode === 'Deep Analysis' && <div className="dc3-actions">{(['Overview','Scenes','Narrative','Messaging','Persuasion','Emotions','Technical','Transcript','Keywords','Mechanisms'] as const).map(tab => <button className={tab === deepTab ? 'chosen' : ''} key={tab} onClick={() => setDeepTab(tab)}>{tab}</button>)}</div>}
          {mode === 'Deep Analysis' && deepTab === 'Scenes' ? <Card title="Scene evidence">{scenes}</Card> : mode === 'Deep Analysis' && deepTab === 'Messaging' ? row('Messaging', messaging) : mode === 'Deep Analysis' && deepTab === 'Persuasion' ? row('Persuasion', messaging.filter(([label]) => ['Persuasion mechanisms','Trust signals','Call to action'].includes(label))) : mode === 'Deep Analysis' && deepTab === 'Emotions' ? row('Emotional evidence', messaging.filter(([label]) => label === 'Emotional triggers')) : mode === 'Deep Analysis' && deepTab === 'Technical' ? <>{row('Technical properties',metadata)}<button type="button" onClick={() => changeView('Technical Intelligence')}>Open Technical Intelligence</button></> : mode === 'Deep Analysis' && deepTab === 'Keywords' ? row('Discoverability evidence',discoverability) : mode === 'Deep Analysis' && deepTab === 'Narrative' ? row('Narrative', messaging) : mode === 'Deep Analysis' && deepTab === 'Transcript' ? row('Transcript', [result('Recognised speech',transcript || null,'Detected')]) : mode === 'Deep Analysis' && deepTab === 'Mechanisms' ? row('Persuasion & Mechanisms', creative?.mechanisms.length ? creative.mechanisms.map((mechanism): Finding => [typeLabel(mechanism),`${mechanism.purpose} · ${evidenceSummary(mechanism)}`,'Inferred']) : [result('Mechanisms',null,'Inferred')]) : <>
            <div className="dc3-evidence-legend">{(['Extracted','Detected','Inferred','Researched','Unavailable'] as const).map(label => <span key={label} className={`dc3-badge dc3-${label.toLowerCase()}`}>{label}</span>)}</div><div className="dc3-overview"><div className="dc3-stack">
            {row('Executive Summary',messaging.filter(([label]) => ['Core message','Hook','Target audience','Call to action'].includes(label)))}<Card title="Video Architecture at a Glance"><div className="dc3-story">{sceneList.map((scene,index) => <button key={scene.number} type="button" onClick={() => seek(scene.start,index)}><strong>{scene.role} {scene.number}</strong><small>{spanLabel(scene.start,scene.end)}</small></button>)}</div>{!sceneList.length && <p>Run analysis to populate the architecture.</p>}</Card>{row('Key Findings', messaging.filter(([label]) => ['Problem','Solution','Benefits','Persuasion mechanisms','Emotional triggers'].includes(label)))}</div><div className="dc3-stack">{row('Key Metrics & Metadata',[...metadata,result('Detected shots',shots.length || null,'Detected'),result('Analysed scenes',sections.length || null,'Inferred')])}{row('Persuasion & Mechanisms – Top 5',creative?.mechanisms.length ? creative.mechanisms.slice(0,5).map((mechanism): Finding => [typeLabel(mechanism),mechanism.purpose,'Inferred']) : [result('Mechanisms',null,'Inferred')])}{row('Discoverability Snapshot',discoverability.filter(([label]) => ['Frequently detected terms','Hashtags visible in the video','SEO','GEO','AEO'].includes(label)))}</div></div>
            <div className="dc3-modules">{([['Messaging Intelligence',MessageSquare],['Technical Intelligence',Aperture],['Discoverability',Globe]] as const).map(([view,Icon]) => <button type="button" key={view} onClick={() => changeView(view)}><Icon />{view}<ArrowRight /></button>)}</div>
          </>}
        </div>
      </div>}
      {mode === 'Messaging Intelligence' && <>
        <Card title="Speech Recognition">
          <div className="dc3-actions">
            <label>Speech language <select value={speechLanguage} onChange={event => setSpeechLanguage(event.target.value)}>
              <option value="">Detect automatically</option>
              <option value="en">English</option><option value="hi">Hindi</option>
              <option value="ur">Urdu</option><option value="ar">Arabic</option>
              <option value="es">Spanish</option><option value="fr">French</option>
            </select></label>
            <button type="button" disabled={!video || busy} onClick={() => void rereadSpeech()}>Read speech with multilingual model</button>
          </div>
          {speechReading && <><small>Unverified machine reading{speechReading.detected_language ? ` · ${speechReading.detected_language}` : ''}</small><p dir="auto">{speechReading.text}</p></>}
        </Card>
        <div className="dc3-grid">{preview}{row('Core Message',messaging.filter(([label]) => ['Core message','Target audience','Emotional triggers','Storytelling','Call to action'].includes(label)))}</div>
        <div className="dc3-actions">{(['Strategy','Hook','Problem','Solution','Storytelling','Persuasion','Audience'] as const).map(tab => <button className={tab === messageTab ? 'chosen' : ''} type="button" key={tab} onClick={() => setMessageTab(tab)}>{tab}</button>)}<button type="button" disabled={!sceneList.length || !video || sending} onClick={() => void send()}>Send to Reconstructor <ArrowRight /></button></div>
        <div className="dc3-grid">{row(`${messageTab} Evidence`,messaging.filter(([label]) => ({Strategy:['Business objective','Strategy and positioning','Problem','Solution','Benefits'],Hook:['Hook'],Problem:['Problem'],Solution:['Solution','Benefits'],Storytelling:['Storytelling','Core message','Call to action'],Persuasion:['Persuasion mechanisms','Emotional triggers','Trust signals'],Audience:['Target audience']}[messageTab].includes(label))))}<Card title="Messaging Structure & Evidence"><button type="button" onClick={() => setTabular(!tabular)}>{tabular ? 'Timeline view' : 'Table view'}</button>{tabular ? <Findings rows={sceneList.map(scene => result(`${scene.role} ${scene.number} · ${spanLabel(scene.start,scene.end)}`,scene.story,'Detected'))} /> : <div className="dc3-story">{sceneList.map((scene,index) => <button key={scene.number} type="button" onClick={() => seek(scene.start,index)}><strong>{scene.role} {scene.number}</strong><small>{spanLabel(scene.start,scene.end)}</small><span>{scene.story || 'Evidence unavailable'}</span></button>)}</div>}</Card></div>
      </>}
      {mode === 'Technical Intelligence' && <div className="dc3-technical">
        <Card title="Scenes">{scenes}</Card>
        <div className="dc3-stack">{preview}<Card title="Read-only Technical Timeline">
          <label>Playhead <input type="range" min={0} max={duration || 1} step=".01" value={playhead} onChange={event => updateTime(Number(event.target.value))} /></label>
          <div className="dc3-timeline">
            <div><strong>{time(playhead)}</strong><div className="dc3-ruler">{Array.from({length:5},(_,index) => <span key={index}>{time(duration*index/4)}</span>)}</div></div>
            {timeline.map(({label, items}) => <div key={label}>
              <strong>{label}</strong>
              <div className="dc3-lane">
                {items.map(item => <button key={item.key} type="button" title={`${item.text} · ${spanLabel(item.start,item.end)}`} aria-label={`Seek to ${item.text} at ${time(item.start)}`} style={{ left:`${Math.min(98,item.start/(duration||1)*100)}%`,width:`max(14px,${(item.end-item.start)/(duration||1)*100}%)` }} onClick={() => updateTime(item.start)}>{item.text}</button>)}
                {!items.length && <span className="dc3-lane-empty">Unavailable</span>}
                <i aria-hidden="true" style={{left:`${Math.min(100,playhead/(duration||1)*100)}%`}} />
              </div>
            </div>)}
          </div>
          {waveformPeaks ? <div className="dc3-waveform"><span>Audio waveform</span><svg role="img" aria-label="Audio peaks measured from the reference" viewBox="0 0 180 36" preserveAspectRatio="none">{waveformPeaks.map((peak,index) => <line key={index} x1={index} x2={index} y1={18-peak*17} y2={18+peak*17} />)}<line className="dc3-cursor" x1={playhead/(duration||1)*180} x2={playhead/(duration||1)*180} y1={0} y2={36} /></svg></div> : <button type="button" disabled={!details?.audio.present || waveformLoading} onClick={() => void loadWaveform()}>{waveformLoading ? 'Decoding audio…' : 'Load audio waveform'}</button>}
        </Card></div>
        <div className="dc3-stack">{row('Video Properties',metadata)}{row('Shot Breakdown',[
          result('Time range',activeShot?spanLabel(activeShot.start_time,activeShot.end_time):null,'Detected'),
          result('Shot evidence',activeShot?.evidence_summary,'Detected'),
          result('Text overlays',activeShot?.text_elements.filter(item => readableOverlay(item.text)).map(item => item.text).join(' · '),'Detected'),
          result('Voice-over / speech',activeShot ? speech.filter(segment => segment.start_time < activeShot.end_time && segment.end_time > activeShot.start_time).map(segment => segment.text).join(' ') : null,'Detected'),
          result('Transition measurements',activeShot ? (video?.transition_evidence ?? []).filter(item => item.boundary_timestamp >= activeShot.start_time && item.boundary_timestamp <= activeShot.end_time).length : null,'Detected'),
          result('Measured picture motion',activeShot?.global_motion_evidence ? `${activeShot.global_motion_evidence.frame_pair_count} frame pairs sampled at ${activeShot.global_motion_evidence.sampling_fps} fps` : null,'Detected'),
          result('Silence intervals in reference',video?.audio_structure?.audio_stream_present ? video.audio_structure.silence_count : null,'Detected'),
          result('Audio waveform',waveformPeaks?'Measured from decoded audio':null,'Detected'),
          ...['Camera angles','Camera movement','Framing','Lighting','Animations','Music identification'].map(label => result(label,null,'Unavailable')),
        ])}</div>
      </div>}
      {mode === 'Discoverability' && <div className="dc3-grid">{preview}<div className="dc3-stack">{row('Source and Discoverability Evidence', discoverability)}{video && <ExternalResearch key={video.id} referenceId={video.id} onReports={reports => setSavedReports({id:video.id,reports})} />}<Card title="Evidence Classification"><p>Extracted facts come from the source file or supplied context. Detected findings come from the analysis engines. Interpretations are labelled Inferred. Externally verified findings are labelled Researched. Detected terms and questions describe the source content. Search ranking, generative answer visibility and local demand require independent evidence.</p></Card></div></div>}
    </main>
  </div>
}
