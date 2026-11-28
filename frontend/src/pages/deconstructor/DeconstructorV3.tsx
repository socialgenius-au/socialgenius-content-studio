import { VirtualAssetPicker } from '../../components/VirtualAssetLibrary'
import { DiscoverabilityReport, type DiscoverabilityReportData } from './DiscoverabilityReport'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Aperture, ArrowRight, Clapperboard, Search, UserCircle, Film, FolderKanban, FolderOpen, Globe, Home, Image, LayoutTemplate, MessageSquare, Palette, RefreshCw, ScanSearch, Settings, Target, UploadCloud, Zap } from 'lucide-react'
import { assetsApi, referenceVideosApi, uploadApi, videoExportApi } from '../../api/client'
import type { ReferenceVideo } from '../../types'
import { errorMessage, useDeconstructor } from './useDeconstructor'
import { evidenceSummary, hookSummary, typeLabel } from './intelligence'
import { TechnicalAudioEvidence, TechnicalSceneEvidence, TechnicalShotEvidence, type TechnicalReport } from './technicalReport'
import './DeconstructorV3.css'

const root = '/deconstructor-v3'
const navigation = [
  ['Home','/home',Home], ['Campaigns','/dashboard-classic',FolderKanban],
  ['Post Creator','/post-creator-v2',Image], ['Video Studio','/video-studio-v3',Film],
  ['Deconstructor',root,ScanSearch], ['Reconstructor','/reconstructor/assets',RefreshCw],
  ['Assets','/assets',FolderOpen], ['Templates','/templates',LayoutTemplate],
  ['Brand Kit','/brands',Palette], ['Settings','/settings',Settings],
] as const
const views = ['Reference', 'Quick Analysis', 'Deep Analysis', 'Selective Analysis', 'Messaging Intelligence', 'Technical Intelligence', 'Discoverability', 'Insights & Learnings'] as const
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
  ['local', 'Local', 'Cited location-specific research using a public topic.'],
] as const
type Module = typeof modules[number][0]
type ContextNotes = { industry: string; contentType: string; objective: string; audience: string; note: string }
const emptyNotes: ContextNotes = { industry: '', contentType: '', objective: '', audience: '', note: '' }
type MessagingSource = {id:string; kind:string; start:number; end:number; text:string}
type MessagingFinding = {summary:string; confidence:string; evidence:MessagingSource[]}
type MessagingReport = {
  findings: Record<string, MessagingFinding>
  scenes: (MessagingFinding & {scene:MessagingSource; messaging?:string; emotional_trigger?:string; narrative_contribution?:string})[]
  translations: {source:MessagingSource; english:string; confidence:string; refined_reading?:string|null}[]
}
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
function prominentOcrCandidate(item: {text: string; confidence_score: number | null; observations: {text: string}[]}) {
  const text = item.text.trim().normalize('NFC')
  if (!readableOverlay(text)) return false
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  if (letters < 4) return false
  const repeats = item.observations.filter(observation => observation.text.trim().normalize('NFC') === text).length
  return (item.confidence_score ?? 0) >= .75 || repeats >= 2
}
function sourceTerms(text: string) {
  const ignore = new Set(['about','above','after','again','are','and','before','from','have','here','into','just','more','only','some','than','that','them','then','there','these','they','this','those','what','when','where','which','will','with','would','your','you'])
  const terms = new Map<string, number>()
  for (const word of text.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]{3,}/gu) ?? []) {
    if (/\p{L}/u.test(word) && !ignore.has(word)) terms.set(word, (terms.get(word) ?? 0) + 1)
  }
  return [...terms.entries()].sort((a,b) => b[1] - a[1]).slice(0,12).map(([word]) => word)
}

const researchDimensions = ['SEO', 'GEO', 'AEO', 'Local'] as const
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
  Local: 'Location-specific sources and search topics',
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
    const saved = reports[dimension]
    if (saved && !saved.partial && saved.findings.length && saved.topic.trim().toLowerCase() === topic.trim().toLowerCase()) {
      setMessage(`Reusing saved ${dimension} research for this topic.`)
      return
    }
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
  return <Card title="Web research evidence">
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
  const [publication, setPublication] = useState<{id:number; creator?:string; provider?:string; provider_video_id?:string; title?:string; description?:string; published_at?:string; views?:number; likes?:number; comments?:number; shares?:number; hashtags?:string[]} | null>(null)
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
  const [savedMessaging, setSavedMessaging] = useState<{id:number; report:MessagingReport | null} | null>(null)
  const [interpreting, setInterpreting] = useState(false)
  const semantic = savedMessaging?.id === id ? savedMessaging?.report : null
  useEffect(() => {
    if (!id) return
    let live = true
    referenceVideosApi.messagingIntelligence(id).then(({data}) => {
      if (live) setSavedMessaging({id, report:data})
    }).catch(error => { if (live) setMessage(errorMessage(error, 'Could not load saved messaging analysis.')) })
    return () => { live = false }
  }, [id, mode])
  const interpretMessaging = async (targetId: number) => {
    const {data} = await referenceVideosApi.runMessagingIntelligence(targetId, notes)
    setSavedMessaging({id:targetId, report:data})
  }
  const [savedTechnical, setSavedTechnical] = useState<{id: number; report: TechnicalReport | null} | null>(null)
  const [technicalRun, setTechnicalRun] = useState<number | null>(null)
  const technicalReport = savedTechnical?.id === id ? savedTechnical?.report : null
  useEffect(() => {
    if (!id) return
    let live = true
    referenceVideosApi.technicalIntelligence(id).then(({data}) => {
      if (live) setSavedTechnical({id, report: data})
    }).catch(error => { if (live && error?.response?.status !== 409) setMessage(errorMessage(error, 'Could not load saved technical analysis.')) })
    return () => { live = false }
  }, [id])
  const analyzeTechnical = async (targetId: number) => {
    let current = (await referenceVideosApi.get(targetId)).data as ReferenceVideo
    if (!current.shots.some(shot => shot.frames.length)) current = (await referenceVideosApi.analyzeFrames(targetId)).data
    if (!current.shots.some(shot => shot.global_motion_evidence)) current = (await referenceVideosApi.analyzeGlobalMotion(targetId)).data
    if (current.shots.length > 1 && !current.transition_evidence?.length) current = (await referenceVideosApi.analyzeTransitionEvidence(targetId)).data
    const {data} = await referenceVideosApi.runTechnicalIntelligence(targetId)
    setReference(previous => previous?.id === targetId ? current : previous)
    setSavedTechnical({id:targetId, report: data})
  }
  const runTechnical = async () => {
    if (!id || technicalRun !== null) return
    setTechnicalRun(id)
    try {
      await analyzeTechnical(id)
      setMessage('Technical evidence and interpretations saved.')
    } catch (error) {
      setMessage(errorMessage(error, 'Technical analysis could not be saved.'))
    } finally { setTechnicalRun(null) }
  }
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
  const [structured, setStructured] = useState<{id: number; report: DiscoverabilityReportData} | null>(null)
  const [market, setMarket] = useState('')
  const [synthesizing, setSynthesizing] = useState(false)
  const structuredReport = structured?.id === id ? structured.report : null
  useEffect(() => {
    if (!id) return
    let live = true
    setMarket('')
    referenceVideosApi.discoverabilityIntelligence(id).then(({data}) => {
      if (live && data) { setStructured({id, report:data}); setMarket(previous => previous || data.market) }
    }).catch(() => {})
    return () => {live = false}
  }, [id])
  const generateDiscoverability = async (targetId: number) => {
    const {data} = await referenceVideosApi.runDiscoverabilityIntelligence(targetId, market.trim())
    setStructured({id:targetId, report:data})
  }
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
  const activeSection = activeShot && sections.find(section =>
    activeShot.start_time < section.end_time && activeShot.end_time > section.start_time &&
    section.creative?.shot_reads.some(read => read.shot_order === activeShot.order))
  const activeShotReading = activeSection?.creative?.shot_reads.find(read => read.shot_order === activeShot?.order)
  const speech = video?.speech_segments ?? []
  const transcript = speech.map(segment => segment.text).join(' ')
  const timeline: { label: string; items: TimelineItem[] }[] = [
    {label:'Scenes',items:sceneList.map(scene => ({key:String(scene.number),start:scene.start,end:scene.end,text:`${scene.role} ${scene.number}`}))},
    {label:'Shots',items:shots.map(shot => ({key:String(shot.id),start:shot.start_time,end:shot.end_time,text:`Shot ${shot.order}`}))},
    {label:'OCR candidates',items:shots.flatMap(shot => shot.text_elements.filter(prominentOcrCandidate).map(item => ({key:String(item.id),start:item.start_time,end:item.end_time,text:item.text})))},
    {label:'Speech',items:speech.map(item => ({key:String(item.id),start:item.start_time,end:item.end_time,text:item.text}))},
    ...([['Camera angles','Camera angle'], ['Framing','Framing and composition'], ['Animations','Animation']] as const).map(([label, topic]) => ({
      label,
      items:(technicalReport?.shots ?? []).flatMap(shot => (shot.findings ?? []).filter(finding => finding.topic === topic)
        .map(finding => ({key:`${shot.number}-${topic}`,start:shot.start,end:shot.end,text:finding.summary}))),
    })),
    {label:'Music and sounds',items:(technicalReport?.audio ?? []).filter(event => event.kind !== 'speech')
      .map((event, index) => ({key:String(index),start:event.start,end:event.end,text:event.label}))},
    {label:'Transitions',items:(video?.transition_evidence ?? []).map(item => ({key:String(item.id),start:item.boundary_timestamp,end:item.boundary_timestamp,text:'Boundary measurement'}))},
  ]
  const observedText = shots.flatMap(shot => shot.text_elements.filter(prominentOcrCandidate).map(item => item.text)).join(' ')
  const detectedTerms = sourceTerms(`${transcript} ${observedText}`)
  const visibleHashtags = [...new Set(observedText.match(/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*/gu) ?? [])].filter(tag => /\p{L}\p{M}*\p{L}/u.test(tag))
  const metadata = mediaProperties(video)
  const sectionMessage = (section: typeof sections[number] | undefined) => section?.speech_reading?.text?.trim() || section?.transcript_excerpt?.trim() || section?.on_screen_text.filter(item => readableOverlay(item.text)).map(item => item.text).join(' · ') || null
  const roleEvidence = (role: RegExp) => {
    const section = sections.find(item => [item.interpretive.messaging_role, item.interpretive.narrative_role]
      .some(label => label && role.test(label)) && sectionMessage(item))
    return section ? `${spanLabel(section.start_time, section.end_time)} · ${sectionMessage(section)}` : null
  }
  const speechCue = (cue: RegExp) => {
    const segment = speech.find(item => cue.test(item.text))
    return segment ? `${spanLabel(segment.start_time, segment.end_time)} · ${segment.text}` : null
  }
  const pain = roleEvidence(/pain.point|customer.challenge|frustration/i) || speechCue(/\b(?:difficult|takes? too long|time.consuming|mushkil|moshkil|pareshani)\b|मुश्किल|परेशानी|مشکل|پریشانی/iu)
  const action = speechCue(/(?:^|[.!?]\s+)\s*(?:buy|order|shop|subscribe|download|try)\s|\b(?:order karein|kharidein|try karo)\b|ऑर्डर करें|अभी खरीदें|آرڈر کریں/iu)
  const messageEvidence = roleEvidence(/core.message|main.message|value.proposition/i)
  const legacyMessaging: Finding[] = [
    result('Business objective', notes.objective || roleEvidence(/objective|campaign.goal/i), notes.objective ? 'Extracted' : 'Inferred'),
    result('Strategy and positioning', roleEvidence(/positioning|differentiation|strategy/i), 'Inferred'),
    result('Core message', messageEvidence || anatomy?.video.creative?.summary, 'Inferred'),
    result('Recognised speech (machine reading)', speechReading?.text || transcript, 'Detected'),
    result('Hook', creative?.hook ? hookSummary(creative.hook) : roleEvidence(/hook/i), 'Inferred'),
    result('Customer pain points', pain, 'Inferred'),
    result('Problem', roleEvidence(/problem/i) || pain, 'Inferred'),
    result('Solution', roleEvidence(/solution/i), 'Inferred'),
    result('Benefits', roleEvidence(/benefit/i), 'Inferred'),
    result('Value proposition', roleEvidence(/value.proposition|unique.selling/i), 'Inferred'),
    result('Storytelling', creative?.narrative?.arc_text || anatomy?.video.narrative?.arc_text, 'Inferred'),
    result('Persuasion mechanisms', creative?.mechanisms.map(typeLabel).join(' · '), 'Inferred'),
    result('Emotional triggers', [...new Set(sections.flatMap(section => section.interpretive.emotional_function || []))].join(' · '), 'Inferred'),
    result('Target audience', notes.audience || roleEvidence(/target.audience|audience.address/i), notes.audience ? 'Extracted' : 'Inferred'),
    result('Trust signals', roleEvidence(/trust|testimonial|social.proof/i), 'Inferred'),
    result('Call to action', roleEvidence(/call.to.action|^cta$/i) || sectionMessage(sections.find(section => section.interpretive.cta_role && sectionMessage(section))) || action, 'Inferred'),
  ]
  const marketingText = (finding: MessagingFinding) =>
    `${finding.summary} · ${finding.confidence} evidence strength · ${finding.evidence.map(source =>
      `${source.kind} ${spanLabel(source.start, source.end)}: ${source.text}`).join(' | ')}`
  const messaging = legacyMessaging.map(([label,value,evidence]): Finding => {
    const finding = semantic?.findings[label]
    if (finding) return result(label, marketingText(finding), 'Inferred')
    if (evidence === 'Extracted' || evidence === 'Detected') return [label,value,evidence]
    return result(label, null, 'Unavailable')
  })
  const renderMessagingEvidence = (finding: MessagingFinding) => (
    <div><div>{finding.summary}</div><small>{finding.confidence} evidence strength</small>
      <details><summary>Supporting evidence ({finding.evidence.length})</summary>
        {finding.evidence.map(source => <p key={source.id}>
          <button type="button" onClick={() => updateTime(source.start)}>{spanLabel(source.start, source.end)}</button> {source.kind}: {source.text}
        </p>)}
      </details>
    </div>
  )
  const displayMessaging = messaging.map(([label,value,evidence]): Finding => {
    const finding = semantic?.findings[label]
    return [label, finding ? renderMessagingEvidence(finding) : value, evidence]
  })
  const discoverability: Finding[] = [
    result('Published URL', video?.original_url, 'Extracted'),
    result('Platform', publishedEvidence?.provider, 'Extracted'),
    result('Publisher', publishedEvidence?.creator, 'Extracted'),
    result('Platform video ID', publishedEvidence?.provider_video_id, 'Extracted'),
    result('Published title', publishedEvidence?.title, 'Extracted'),
    result('Published description', publishedEvidence?.description, 'Extracted'),
    result('Frequently detected terms', detectedTerms.join(' · '), 'Detected'),
    result('Hashtag candidates from OCR', visibleHashtags.join(' · '), 'Detected'),
    result('Published hashtags', publishedEvidence?.hashtags?.join(' · '), 'Extracted'),
    result('Machine object candidates', [...new Set(shots.flatMap(shot => (shot.visual_objects ?? []).map(item => item.label)))].join(' · '), 'Detected'),
    result('Searchable terms in recognised speech', sourceTerms(transcript).join(' · '), 'Detected'),
    result('Searchable terms in on-screen text', sourceTerms(observedText).join(' · '), 'Detected'),
    result('Questions in recognised speech', speech.filter(segment => /[?؟？]/u.test(segment.text)).slice(0,6).map(segment => `${time(segment.start_time)} · ${segment.text}`).join(' / '), 'Detected'),
    result('Primary keyword candidates (frequency ranked)', detectedTerms.slice(0,3).join(' · '), 'Detected'),
    result('Secondary keyword candidates (frequency ranked)', detectedTerms.slice(3).join(' · '), 'Detected'),
    result('Long-tail phrase candidates (observed speech)', speech.map(segment => segment.text.trim()).filter(value => value.split(/\s+/).length >= 3 && value.split(/\s+/).length <= 8 && readableOverlay(value)).filter((value,index,all) => all.indexOf(value) === index).slice(0,8).join(' · '), 'Detected'),
    result('Research topic candidates', [...new Set(researchDimensions.map(dimension => savedReports?.id === id ? savedReports.reports[dimension]?.topic : undefined).filter(Boolean))].join(' · '), 'Researched'),
    result('Publication date', publishedEvidence?.published_at, 'Extracted'),
    result('Views', publishedEvidence?.views, 'Extracted'),
    result('Likes', publishedEvidence?.likes, 'Extracted'),
    result('Comments', publishedEvidence?.comments, 'Extracted'),
    result('Shares', publishedEvidence?.shares, 'Extracted'),
    ...researchDimensions.map(dimension => { const report = savedReports?.id === id ? savedReports.reports[dimension] : undefined; return result(dimension, report?.findings.length ? `${report.partial ? 'Partial research' : 'Research saved'} · ${report.findings.length} cited findings · ${report.topic}` : null, 'Researched') }),
  ]
  const busy = working || interpreting || d.busy !== null
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
      const needsSpeech = custom && select.some(key => ['messaging', 'discoverability', 'keywords'].includes(key))
      const needsText = needsSpeech || (custom && select.includes('hashtags'))
      const needsFrames = needsText || (custom && select.includes('technical'))
      if (!custom || needsFrames) await referenceVideosApi.analyzeStructure(targetId)
      if (needsFrames) await referenceVideosApi.analyzeFrames(targetId)
      if (needsText) await referenceVideosApi.analyzeText(targetId)
      if (needsSpeech) await referenceVideosApi.analyzeSpeech(targetId)
      if (custom && select.includes('messaging')) await interpretMessaging(targetId)
      if (custom && select.includes('technical')) await analyzeTechnical(targetId)
      if (researchSelected) {
        const reports = {...(await referenceVideosApi.searchResearch(targetId)).data} as Partial<Record<ResearchDimension, ResearchReport>>
        const dimensions = researchDimensions.filter(dimension =>
          select.includes(dimension.toLowerCase() as Module))
        for (const dimension of dimensions) {
          const saved = reports[dimension]
          if (saved && !saved.partial && saved.topic.trim().toLowerCase() === researchTopic.trim().toLowerCase()) continue
          reports[dimension] = (await referenceVideosApi.runSearchResearch(targetId, researchTopic.trim(), dimension)).data
        }
        setSavedReports({id:targetId, reports})
      }
      setReference((await referenceVideosApi.get(targetId)).data)
      if (custom && (researchSelected || select.some(key => ['discoverability','keywords','hashtags'].includes(key)))) {
        await generateDiscoverability(targetId)
      }
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
      if (reading) setMessage('Speech reading saved. Run Messaging Analysis again to refresh the marketing interpretation.')
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
    const handoff = { referenceId:video.id, scenes:sceneList, context:notes, messaging, messaging_report:semantic, discoverability, metadata, mechanisms:creative?.mechanisms ?? [], provenance:anatomy?.provenance }
    try {
      const {data} = await referenceVideosApi.createHandoff(video.id,handoff)
      navigate(`/reconstructor/assets?scene=${sceneList[0].number}&reference=${video.id}&handoff=${data.id}`)
    } catch (error) { setMessage(errorMessage(error, 'Could not save this Reconstructor handoff.')) }
    finally { setSending(false) }
  }
  const report = async () => {
    if (!video) return
    let researchReports = savedReports?.id === video.id ? savedReports.reports : {}
    try {
      researchReports = (await referenceVideosApi.searchResearch(video.id)).data
    } catch {
      setMessage('Could not refresh saved research. The download includes locally loaded evidence.')
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ reference:video?.original_filename, context:notes, metadata, messaging, messaging_report:semantic, technical_report:technicalReport, discoverability, publication:publishedEvidence, original_url:video.original_url, discoverability_report:structuredReport, research_reports:researchReports, scenes:sceneList, mechanisms:creative?.mechanisms ?? [] },null,2)],{type:'application/json'}))
    const link = document.createElement('a')
    link.href = url
    link.download = `reference-${id}-analysis.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url),60000)
  }
  const seek = (seconds: number, index: number) => { setSelected(index); updateTime(seconds) }
  const preview = video ? <video className="dc3-preview" ref={player} src={assetsApi.previewUrl(video.asset_file_path)} poster={shots.find(shot => shot.frames.length)?.frames[0] ? assetsApi.previewUrl(shots.find(shot => shot.frames.length)!.frames[0].asset_file_path) : undefined} controls playsInline preload="metadata" onLoadedMetadata={() => { if(player.current) player.current.currentTime = playhead }} onTimeUpdate={event => setPlayhead(event.currentTarget.currentTime)} aria-label="Read-only reference video" /> : <div className="dc3-placeholder"><Film />Select a reference video to preview</div>
  const scenes = <div className="dc3-scenes">{sceneList.map((scene,index) => {
    const frame = shots.find(shot => shot.start_time <= scene.start && shot.end_time > scene.start)?.frames[0]
    return <button type="button" key={scene.number} aria-pressed={playhead >= scene.start && playhead < scene.end} onClick={() => seek(scene.start,index)}><strong>{scene.number}</strong>{frame && <img src={assetsApi.previewUrl(frame.asset_file_path)} alt="" />}<span>{scene.role}<small>{spanLabel(scene.start,scene.end)}</small></span></button>
  })}{!sceneList.length && <p>Run analysis to detect shots and scenes.</p>}</div>
  const row = (label: string, rows: Finding[]) => <Card title={label}><Findings rows={rows} /></Card>
  const [referenceQuery,setReferenceQuery] = useState('')
  const matchingReferences = referenceQuery.trim() ? (d.references.data ?? []).filter(item =>
    item.original_filename.toLowerCase().includes(referenceQuery.trim().toLowerCase())).slice(0,8) : []
  const activeTechnicalScene = technicalReport?.scenes.find(scene => scene.start <= playhead && playhead < scene.end)
  const technicalSceneIndex = activeTechnicalScene ? technicalReport!.scenes.indexOf(activeTechnicalScene) : -1
  const quickMetrics: [string,ReactNode][] = [
    ['Duration',duration ? time(duration) : 'Unavailable'], ['Scenes',sceneList.length], ['Shots',shots.length],
    ['Aspect ratio',metadata.find(([label]) => label === 'Aspect ratio')?.[1]], ['Audio',details?.audio.present ? 'Stream present' : 'Unavailable'],
    ['Captions',shots.some(shot => shot.text_elements.length) ? 'Text detected' : 'Unavailable'],
  ]
  const referenceFrame = shots.find(shot => shot.frames.length)?.frames[0]
  const thumbnail = referenceFrame && assetsApi.previewUrl(referenceFrame.asset_file_path)
  const labels: Record<View, string> = {
    Reference: 'Import a reference, review its metadata and set the analysis context.',
    'Quick Analysis': 'Review the message, production and discoverability at a glance.',
    'Deep Analysis': 'Explore the strategy, messaging, production and discoverability.',
    'Selective Analysis': 'Choose the intelligence modules and scope to analyse.',
    'Messaging Intelligence': 'Understand how the message is constructed and who it is for.',
    'Technical Intelligence': 'Explore how the video was produced and edited.',
    Discoverability: 'Review source evidence and cited opportunities for discovery.',
    'Insights & Learnings': 'Review the findings before sending the reference to Reconstructor.',
  }
  const viewIcons = [Film, Zap, FolderKanban, Target, MessageSquare, Aperture, Globe, ScanSearch]
  const tabs = <nav className="dc3-modes" aria-label="Deconstructor views">
    {video && mode !== 'Reference' && <div className="dc3-nav-reference">
      {thumbnail && <img src={thumbnail} alt="" />}
      <span><strong>{video.original_filename}</strong><small>{time(duration)} · {shots.length} detected shots</small></span>
    </div>}
    {views.map((view,index) => { const Icon = viewIcons[index]; return <button key={view} type="button"
      aria-current={view === mode ? 'page' : undefined} className={view === mode ? 'chosen' : ''}
      onClick={() => changeView(view)}><Icon aria-hidden="true" />{view}</button> })}
  </nav>
  const [reportBusy, setReportBusy] = useState(false)
  const [history, setHistory] = useState<{
    referenceId:number
    runs:{id:number; status:string; tier:string; created_at:string; stages:Record<string,unknown>}[]
    saved_reports:{id:number; saved_at:string; analysis_id:number}[]
  } | null>(null)
  const [snapshot, setSnapshot] = useState<{referenceId:number; data: Record<string,unknown>} | null>(null)
  const reportBody = {context:notes, metadata, scenes:sceneList, mechanisms:creative?.mechanisms ?? []}
  const loadHistory = async (referenceId: number) => {
    const {data} = await referenceVideosApi.analysisHistory(referenceId)
    setHistory({referenceId,...data})
  }
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  const reportAction = async (action: 'pdf' | 'appendix' | 'save' | 'history', reportId?: number) => {
    if (!video || reportBusy) return
    setReportBusy(true)
    try {
      if (action === 'pdf' || action === 'appendix') {
        const {data} = await referenceVideosApi.analysisPdf(video.id, reportBody, action === 'appendix')
        downloadBlob(data, `reference-${video.id}-analysis${action === 'appendix' ? '-with-appendix' : ''}.pdf`)
      } else if (action === 'save') {
        await referenceVideosApi.saveLibraryReport(video.id, reportBody)
        await loadHistory(video.id)
        setMessage('Analysis report saved to Library.')
      } else if (reportId) {
        const {data} = await referenceVideosApi.openLibraryReport(video.id, reportId)
        setSnapshot({referenceId:video.id,data})
      } else {
        await loadHistory(video.id)
      }
    } catch (error) {
      setMessage(errorMessage(error, 'The report action could not be completed.'))
    } finally { setReportBusy(false) }
  }
  const printReport = () => void reportAction('pdf')
  const analysisTools = <div className="dc3-actions dc3-report-actions">
    <button type="button" disabled={!video || reportBusy} onClick={() => void reportAction('appendix')}>PDF with Evidence Appendix</button>
    <button type="button" disabled={!video || reportBusy} onClick={() => void reportAction('history')}>Analysis History</button>
    <button type="button" disabled={!video || reportBusy} onClick={() => void reportAction('save')}>Save to Library</button>
  </div>
  return <div data-view={mode} className={`dc3 ${mode === 'Messaging Intelligence' ? 'dc3-dark' : ''}`}>
    <aside className="dc3-sidebar">
      <Link className="dc3-brand" to="/dashboard"><img src="/social-genius-official-logo.svg" alt="" /><strong>Social Genius</strong><span>Content Studio</span><small>The Positioning People</small></Link>
      <nav aria-label="Content Studio">{navigation.map(([name,url,Icon]) => <Link key={name} to={url} aria-current={url === root ? 'page' : undefined}><Icon />{name}</Link>)}</nav>
    </aside>
    <main>
      <div className="dc3-global">
        <div className="dc3-global-search"><Search aria-hidden="true" />
          <input aria-label="Search saved references" placeholder="Search saved references…" value={referenceQuery}
            onChange={event => setReferenceQuery(event.target.value)} />
          {referenceQuery.trim() && <div className="dc3-search-results">
            {matchingReferences.length ? matchingReferences.map(item => <button key={item.id} type="button"
              onClick={() => {setReferenceQuery('');selectReference(item.id)}}>{item.original_filename}</button>) : <p>No matching references.</p>}
            <button type="button" onClick={() => setReferenceQuery('')}>Close search</button>
          </div>}
        </div>
        <Link to="/dashboard"><UserCircle aria-hidden="true" /> Workspace dashboard</Link>
      </div>
      <header className="dc3-banner"><Clapperboard /><div>
        {mode === 'Reference' ? <><h1>De<span>constructor</span></h1><p>Analyse, understand and learn from video content.</p></> :
          <><h1>{mode.endsWith('Intelligence') ? mode.replace(' Intelligence', '') : 'Deconstructor'} <span>{mode.endsWith('Intelligence') ? 'Intelligence' : mode}</span></h1><p>{labels[mode]}</p></>}
        </div><span className="dc3-banner-brand"><img src="/social-genius-official-logo.svg" alt="" /><span><strong>Social Genius</strong><small>The Positioning People</small></span></span>
      </header>
      {tabs}
      {video && ['Quick Analysis','Deep Analysis','Insights & Learnings'].includes(mode) && analysisTools}
      {history?.referenceId === id && <Card title="Analysis History">
        <button type="button" onClick={() => {setHistory(null);setSnapshot(null)}}>Close history</button>
        {history.runs.map(run => <details key={run.id}><summary>Run {run.id} · {run.tier} · {run.status} · {new Date(run.created_at).toLocaleString()}</summary>
          <pre>{JSON.stringify(run.stages,null,2)}</pre></details>)}
        <h3>Saved Library reports</h3>
        {history.saved_reports.map(item => <button key={item.id} disabled={reportBusy} type="button"
          onClick={() => void reportAction('history',item.id)}>Open report {item.id} · {new Date(item.saved_at).toLocaleString()}</button>)}
        {!history.saved_reports.length && <p>No saved reports for this reference.</p>}
      </Card>}
      {snapshot?.referenceId === id && <Card title="Saved Analysis Report">
        <div className="dc3-actions"><button type="button" onClick={() => setSnapshot(null)}>Close saved report</button>
          <button type="button" onClick={() => downloadBlob(new Blob([JSON.stringify(snapshot.data,null,2)],{type:'application/json'}), `reference-${id}-saved-analysis.json`)}>Download saved JSON</button></div>
        <p>{String(snapshot.data.reference)} · Analysis {String(snapshot.data.analysis_id)}</p>
        {snapshot.data.discoverability_report != null && <DiscoverabilityReport report={snapshot.data.discoverability_report as DiscoverabilityReportData} seek={updateTime} />}
        {snapshot.data.messaging_report != null && <details><summary>Saved Messaging Intelligence</summary><pre>{JSON.stringify(snapshot.data.messaging_report,null,2)}</pre></details>}
        {snapshot.data.technical_report != null && <details><summary>Saved Technical Intelligence</summary><pre>{JSON.stringify(snapshot.data.technical_report,null,2)}</pre></details>}
      </Card>}
      {(message || d.actionError || sourceScope) && <p className="dc3-status" role="status">{message || d.actionError}{sourceScope && <><br />{sourceScope}</>}</p>}
      {mode === 'Reference' && <><div className="dc3-section-heading"><FolderKanban /><div><h2>Reference Import &amp; Context</h2><p>{labels.Reference}</p></div></div><div className="dc3-import">
        <Card title="Video Reference">
          <div className="dc3-actions"><button className={!urlMode ? 'chosen' : ''} type="button" onClick={() => setUrlMode(false)}><UploadCloud />Upload Video File</button><button className={urlMode ? 'chosen' : ''} type="button" onClick={() => setUrlMode(true)}><Globe />Published Video URL</button></div>
          {urlMode ? <form className="dc3-drop" onSubmit={event => {event.preventDefault(); void importPublished()}}>
            <label>Published Pexels video URL <input type="url" required value={publishedUrl} onChange={event => setPublishedUrl(event.target.value)} placeholder="https://www.pexels.com/video/…" /></label>
            <label><input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} /> I am authorised to analyse this video.</label>
            <button type="submit" disabled={busy || !rightsConfirmed || !publishedUrl.trim()}>Import published video</button>
            <small>For other platforms, upload a licensed video file.</small>
          </form> : <div className="dc3-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void importVideo(event.dataTransfer.files[0]) }}>
            <VirtualAssetPicker kind="video" onMedia={async asset => {
              setWorking(true)
              setMessage('')
              try {
                const { data } = await referenceVideosApi.ingest(asset.id)
                setContextByReference(previous => ({ ...previous, [data.id]: notes }))
                setSourceScope('')
                selectReference(data.id)
                setReference((await referenceVideosApi.analyze(data.id)).data)
              } finally { setWorking(false) }
            }} />
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
      </div></>}
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
        <div className="dc3-stack"><Card title="Select Analysis Modules"><label className="dc3-check"><input type="checkbox" checked={select.length === modules.length} onChange={event => setSelect(event.target.checked ? modules.map(([key]) => key) : [])} />Select all available modules</label><p>Combine intelligence modules for a focused analysis. Include a location in the topic for Local research.</p><div className="dc3-modules dc3-selective-modules">{modules.map(([key,label,description]) => <label className={select.includes(key) ? 'selected' : ''} key={key}><input type="checkbox" checked={select.includes(key)} onChange={event => setSelect(event.target.checked ? [...select,key] : select.filter(module => module !== key))} /><strong>{label}</strong><small>{description}</small></label>)}</div></Card>
          <Card title="Analysis Scope Summary"><div className="dc3-actions"><div><strong>{select.length} modules selected</strong><p>{modules.filter(([key]) => select.includes(key)).map(([,label]) => label).join(', ')}</p><small>Scope: {range ? `${Number(start || 0).toFixed(2)}–${Number(end || duration).toFixed(2)}s` : `Full video · ${time(duration)}`} · Selective (Custom) · Processing time varies by module</small></div>{select.some(key => ['seo','geo','aeo','local'].includes(key)) && researchTopic.trim().length < 3 && <p role="status">Enter a public research topic before running selected research modules.</p>}<button className="chosen" type="button" disabled={!video || busy || !select.length || (select.some(key => ['seo','geo','aeo','local'].includes(key)) && researchTopic.trim().length < 3)} onClick={() => void run(true)}><Target />Run Selected Analysis</button></div></Card>
        </div>
      </div>}
      {(mode === 'Quick Analysis' || mode === 'Deep Analysis') && <div className="dc3-grid dc3-analysis">
        <div className="dc3-reference-strip"><strong>{video?.original_filename ?? 'Select a reference'}</strong><span>{duration ? time(duration) : '—'} · {shots.length} detected shots</span></div>
        <div className="dc3-stack">{preview}{mode === 'Quick Analysis' ?
          <div className="dc3-quick-metrics">{quickMetrics.map(([label,value]) => <div key={label}><small>{label}</small><strong>{value ?? 'Unavailable'}</strong></div>)}</div> :
          <Card title="Scenes & Timeline">{scenes}</Card>}</div>
        <div className="dc3-stack">
          <div className="dc3-actions">{mode === 'Deep Analysis' ? <><button className="chosen" disabled={!video || busy} type="button" onClick={() => { if(window.confirm('Run the full analysis pipeline? Configured AI stages may incur provider costs.')) void d.deconstruct() }}>Run Deep Analysis</button><span role="status">{d.progress.headline}</span></> : <button className="chosen" disabled={!video || busy} type="button" onClick={() => void run(false)}><Zap />Run Quick Analysis</button>}<button type="button" disabled={!video || busy} onClick={async () => { if (!video) return; setInterpreting(true); setMessage(''); try { await interpretMessaging(video.id); setMessage('Marketing interpretation saved.'); } catch (error) { setMessage(errorMessage(error, 'Marketing interpretation could not be completed.')); } finally { setInterpreting(false); } }}>Generate Marketing Summary</button><button type="button" disabled={!video} onClick={report}>Export JSON</button><button type="button" disabled={!video} onClick={printReport}>Export Analysis (PDF)</button><button type="button" disabled={!sceneList.length || !video || sending} onClick={() => void send()}>Send to Reconstructor <ArrowRight /></button></div>
          {mode === 'Deep Analysis' && d.progress.steps.length > 0 && <details className="dc3-card"><summary>Analysis status by stage</summary><Findings rows={d.progress.steps.map(step => [step.label,[step.status.replace(/_/g,' '),step.note].filter(Boolean).join(' · '),step.status === 'skipped' || step.status === 'failed' ? 'Unavailable' : 'Extracted'])} /></details>}
          {mode === 'Deep Analysis' && <div className="dc3-actions">{(['Overview','Scenes','Narrative','Messaging','Persuasion','Emotions','Technical','Transcript','Keywords','Mechanisms'] as const).map(tab => <button className={tab === deepTab ? 'chosen' : ''} key={tab} onClick={() => setDeepTab(tab)}>{tab}</button>)}</div>}
          {mode === 'Quick Analysis' ? <>
            {row('Executive Summary',[
              ...displayMessaging.filter(([label]) => ['Core message','Target audience','Hook'].includes(label)),
              result('Content type',notes.contentType,'Extracted'),
              result('Primary keywords',structuredReport?.sections.Keywords?.filter(item => item.group === 'Primary').map(item => item.label).join(' · '),'Inferred'),
            ])}
            <Card title="Additional Insights">
              <details><summary>Communication flow</summary><Findings rows={displayMessaging.filter(([label]) => ['Problem','Solution','Call to action'].includes(label))} /></details>
              <details><summary>Scene and shot overview</summary>{scenes}</details>
              <details><summary>Production highlights</summary><Findings rows={metadata} /></details>
              <details><summary>Discoverability snapshot</summary><Findings rows={discoverability.filter(([label]) => ['SEO','GEO','AEO'].includes(label))} /></details>
              <button type="button" onClick={() => changeView('Insights & Learnings')}>Key Takeaways &amp; Learnings</button>
            </Card>
          </> : mode === 'Deep Analysis' && deepTab === 'Scenes' ? <Card title="Scene evidence">{scenes}</Card> : mode === 'Deep Analysis' && deepTab === 'Messaging' ? row('Messaging', messaging) : mode === 'Deep Analysis' && deepTab === 'Persuasion' ? row('Persuasion', displayMessaging.filter(([label]) => ['Persuasion mechanisms','Trust signals','Call to action'].includes(label))) : mode === 'Deep Analysis' && deepTab === 'Emotions' ? row('Emotional evidence', displayMessaging.filter(([label]) => label === 'Emotional triggers')) : mode === 'Deep Analysis' && deepTab === 'Technical' ? <>{row('Technical properties',metadata)}<button type="button" onClick={() => changeView('Technical Intelligence')}>Open Technical Intelligence</button></> : mode === 'Deep Analysis' && deepTab === 'Keywords' ? <>{row('Discoverability evidence',discoverability)}{structuredReport && <DiscoverabilityReport key={id} report={structuredReport} seek={updateTime} />}</> : mode === 'Deep Analysis' && deepTab === 'Narrative' ? row('Narrative', messaging) : mode === 'Deep Analysis' && deepTab === 'Transcript' ? row('Transcript', [result('Recognised speech',transcript || null,'Detected')]) : mode === 'Deep Analysis' && deepTab === 'Mechanisms' ? row('Persuasion & Mechanisms', creative?.mechanisms.length ? creative.mechanisms.map((mechanism): Finding => [typeLabel(mechanism),`${mechanism.purpose} · ${evidenceSummary(mechanism)}`,'Inferred']) : [result('Mechanisms',null,'Inferred')]) : <>
            <div className="dc3-evidence-legend">{(['Extracted','Detected','Inferred','Researched','Unavailable'] as const).map(label => <span key={label} className={`dc3-badge dc3-${label.toLowerCase()}`}>{label}</span>)}</div><div className="dc3-overview"><div className="dc3-stack">
            {row('Executive Summary',displayMessaging.filter(([label]) => ['Core message','Hook','Target audience','Business objective','Call to action'].includes(label)))}<Card title="Video Architecture at a Glance"><div className="dc3-story">{sceneList.map((scene,index) => <button key={scene.number} type="button" onClick={() => seek(scene.start,index)}><strong>{scene.role} {scene.number}</strong><small>{spanLabel(scene.start,scene.end)}</small></button>)}</div>{!sceneList.length && <p>Run analysis to populate the architecture.</p>}</Card>{row('Key Findings', displayMessaging.filter(([label]) => ['Problem','Solution','Benefits','Persuasion mechanisms','Emotional triggers'].includes(label)))}</div><div className="dc3-stack">{row('Key Metrics & Metadata',[...metadata,result('Detected shots',shots.length || null,'Detected'),result('Analysed scenes',sections.length || null,'Inferred')])}{row('Persuasion & Mechanisms – Top 5',creative?.mechanisms.length ? creative.mechanisms.slice(0,5).map((mechanism): Finding => [typeLabel(mechanism),mechanism.purpose,'Inferred']) : [result('Mechanisms',null,'Inferred')])}{structuredReport?.sections.Summary?.map(item => <p key={item.label}><strong>{item.label}</strong> · {item.detail}</p>)}{row('Discoverability Snapshot',discoverability.filter(([label]) => ['Frequently detected terms','Hashtag candidates from OCR','SEO','GEO','AEO'].includes(label)))}</div></div>
            <div className="dc3-modules">{([['Messaging Intelligence',MessageSquare],['Technical Intelligence',Aperture],['Discoverability',Globe]] as const).map(([view,Icon]) => <button type="button" key={view} onClick={() => changeView(view)}><Icon />{view}<ArrowRight /></button>)}</div>
          </>}
        </div>
      </div>}
      {mode === 'Quick Analysis' && <div className="dc3-quick-links">
        {([['Messaging Intelligence',MessageSquare,'Understand the message and audience'],
           ['Technical Intelligence',Aperture,'Review the production and scene evidence'],
           ['Discoverability',Globe,'Review search and audience opportunities']] as const).map(([view,Icon,description]) =>
          <button type="button" key={view} onClick={() => changeView(view)}><Icon /><span><strong>{view}</strong><small>{description}</small></span><ArrowRight /></button>)}
        <button className="chosen" type="button" onClick={() => changeView('Deep Analysis')}>View Deep Analysis <ArrowRight /></button>
      </div>}
      {mode === 'Messaging Intelligence' && <>
        <div className="dc3-actions">
          <button className="chosen" type="button" disabled={!video || busy || interpreting} onClick={async () => {
            if (!video) return
            setInterpreting(true)
            setMessage('')
            try { await referenceVideosApi.analyze(video.id); await referenceVideosApi.analyzeStructure(video.id); await referenceVideosApi.analyzeFrames(video.id); await referenceVideosApi.analyzeText(video.id); await referenceVideosApi.analyzeSpeech(video.id); await interpretMessaging(video.id); await d.reload(); setMessage('Messaging analysis saved. Review the evidence and confidence for each finding.') }
            catch (error) { setMessage(errorMessage(error, 'Messaging analysis could not be completed.')) }
            finally { setInterpreting(false) }
          }}>{interpreting ? 'Analysing messaging…' : 'Run Messaging Analysis'}</button>
          <small>Uses saved speech, OCR, visual detections and scene evidence.</small>
        </div>
        <div className="dc3-grid dc3-message-hero">{preview}{row('Core Message',displayMessaging.filter(([label]) => ['Core message','Recognised speech (machine reading)','Target audience','Emotional triggers','Storytelling','Call to action'].includes(label)))}</div>
        <div className="dc3-actions">{(['Strategy','Hook','Problem','Solution','Storytelling','Persuasion','Audience'] as const).map(tab => <button className={tab === messageTab ? 'chosen' : ''} type="button" key={tab} onClick={() => setMessageTab(tab)}>{tab}</button>)}<button type="button" disabled={!sceneList.length || !video || sending} onClick={() => void send()}>Send to Reconstructor <ArrowRight /></button></div>
        <div className="dc3-grid">{row(`${messageTab} Evidence`,displayMessaging.filter(([label]) => ({Strategy:['Business objective','Strategy and positioning','Problem','Solution','Benefits'],Hook:['Hook'],Problem:['Problem','Customer pain points'],Solution:['Solution','Benefits','Value proposition'],Storytelling:['Storytelling','Core message','Call to action'],Persuasion:['Persuasion mechanisms','Emotional triggers','Trust signals'],Audience:['Target audience']}[messageTab].includes(label))))}<Card title="Messaging Structure & Evidence">{semantic && <Findings rows={sceneList.map(scene => {
          const purpose = semantic.scenes.find(item => item.scene.id === `scene-${scene.number}`)
          const label = `Marketing purpose · ${spanLabel(scene.start,scene.end)}`
          return purpose ? [label, <>{renderMessagingEvidence(purpose)}
            {purpose.messaging && <p>Message · {purpose.messaging}</p>}
            {purpose.emotional_trigger && <p>Emotional trigger · {purpose.emotional_trigger}</p>}
            {purpose.narrative_contribution && <p>Narrative contribution · {purpose.narrative_contribution}</p>}
          </>, 'Inferred'] : result(label,null,'Unavailable')
        })} />}<button type="button" onClick={() => setTabular(!tabular)}>{tabular ? 'Timeline view' : 'Table view'}</button>{tabular ? <Findings rows={sceneList.map(scene => result(`${scene.role} ${scene.number} · ${spanLabel(scene.start,scene.end)}`,scene.story,'Detected'))} /> : <div className="dc3-story dc3-messaging-story">{sceneList.map((scene,index) => {
          const frame = shots.find(shot => shot.start_time <= scene.start && shot.end_time > scene.start)?.frames[0]
          const purpose = semantic?.scenes.find(item => item.scene.id === `scene-${scene.number}`)
          return <button type="button" key={scene.number} aria-pressed={playhead >= scene.start && playhead < scene.end}
            onClick={() => seek(scene.start,index)}><strong>{scene.role} {scene.number}</strong><small>{spanLabel(scene.start,scene.end)}</small>
            {frame && <img src={assetsApi.previewUrl(frame.asset_file_path)} alt="" />}
            <span>{purpose?.messaging || scene.story || 'Evidence unavailable'}</span>
            {purpose?.emotional_trigger && <small>{purpose.emotional_trigger}</small>}
          </button>
        })}</div>}</Card></div>
        <details className="dc3-card"><summary>Speech Recognition</summary>
        <div className="dc3-card-content">
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
          {!!semantic?.translations.length && <details><summary>English translation · machine interpreted</summary>
            {semantic.translations.map(item => <p key={item.source.id}>
              <strong>{spanLabel(item.source.start,item.source.end)}</strong> {item.english} · {item.confidence} evidence strength
              <br /><span dir="auto">Original · {item.source.text}</span>
              {item.refined_reading && <><br /><span dir="auto">Refined machine reading · {item.refined_reading}</span></>}
            </p>)}
          </details>}
        </div>
        </details>
      </>}
      {mode === 'Technical Intelligence' && <div className="dc3-technical">
        <Card title="Scenes">{scenes}</Card>
        <div className="dc3-stack dc3-production"><div className="dc3-production-preview">{preview}{row('Video Properties',metadata)}</div><Card title="Scene-by-Scene Technical Timeline">
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
        <div className="dc3-stack">
        <Card title={activeTechnicalScene ? `Scene ${activeTechnicalScene.number} – Technical Breakdown` : 'Scene Technical Breakdown'}>
          {activeTechnicalScene ? <>
            <div className="dc3-actions">
              <button type="button" disabled={technicalSceneIndex <= 0} onClick={() => updateTime(technicalReport!.scenes[technicalSceneIndex-1].start)}>Previous scene</button>
              <strong>{spanLabel(activeTechnicalScene.start,activeTechnicalScene.end)}</strong>
              <button type="button" disabled={technicalSceneIndex >= technicalReport!.scenes.length-1} onClick={() => updateTime(technicalReport!.scenes[technicalSceneIndex+1].start)}>Next scene</button>
            </div>
            <TechnicalSceneEvidence scene={activeTechnicalScene} seek={updateTime} />
          </> : <p>Select a scene with saved technical findings.</p>}
        </Card>
        <Card title="Audio Intelligence">
          {technicalReport?.audio?.length ? <TechnicalAudioEvidence events={technicalReport.audio} seek={updateTime} /> :
            <p>{technicalReport?.audio_status === 'classified' ? 'No supported audio classifications.' :
              technicalReport?.audio_status === 'no_stream' ? 'No source audio stream.' : 'Audio classifications unavailable.'}</p>}
        </Card>
        <Card title="Technical findings">
          <button type="button" disabled={!shots.length || technicalRun !== null} onClick={() => void runTechnical()}>{technicalRun !== null ? 'Analysing shots…' : 'Run Technical Intelligence'}</button>
          <button type="button" disabled={!sceneList.length || sending} onClick={() => void send()}>Send to Reconstructor</button>
          {technicalReport?.limitations.length ? <details><summary>Evidence limitations</summary><ul>{technicalReport.limitations.map(note => <li key={note}>{note}</li>)}</ul></details> : null}
          {technicalReport?.shots.map(shot => <details key={shot.number} open={shot.number === activeShot?.order || undefined}>
            <summary>Shot {shot.number} · {spanLabel(shot.start, shot.end)}</summary>
            <button type="button" onClick={() => updateTime(shot.start)}>Seek to shot</button>
            <TechnicalShotEvidence shot={shot} seek={updateTime} />
          </details>)}
          {technicalReport?.scenes.map(scene => <details key={scene.number}>
            <summary>{scene.boundary_source === 'shot' ? 'Shot partition' : 'Scene'} {scene.number} · {spanLabel(scene.start, scene.end)}</summary>
            <button type="button" onClick={() => updateTime(scene.start)}>Seek to scene</button>
            <TechnicalSceneEvidence scene={scene} seek={updateTime} />
            {technicalReport.shots.filter(shot => scene.shots.includes(shot.number)).map(shot =>
              <details key={shot.number}><summary>Shot {shot.number}</summary><TechnicalShotEvidence shot={shot} seek={updateTime} /></details>)}
          </details>)}
        </Card>
        {!!activeShot?.text_elements.length && <Card title="Raw OCR evidence">
          <details><summary>All recognizer readings for the active shot</summary>
            <p>Machine readings may contain incorrect characters or words.</p>
            <ul>{activeShot.text_elements.map(item => <li key={item.id}>
              <button type="button" onClick={() => updateTime(item.start_time)}>{time(item.start_time)}</button>
              {' '}<span dir="auto">{item.text}</span>
              {item.confidence_score !== null && <small> · engine confidence {Math.round(item.confidence_score * 100)}%</small>}
            </li>)}</ul>
          </details>
        </Card>}
        {row('Shot Breakdown',[
          result('Time range',activeShot?spanLabel(activeShot.start_time,activeShot.end_time):null,'Detected'),
          result('Shot evidence',activeShot?.evidence_summary,'Detected'),
          result('Framing',activeShotReading?.framing,'Inferred'),
          result('Visual subject',activeShotReading?.focal_subject,'Inferred'),
          result('Visual interpretation',activeShotReading?.notes,'Inferred'),
          result('OCR candidates',activeShot?.text_elements.filter(prominentOcrCandidate).map(item => item.text).join(' · '),'Detected'),
          result('Voice-over / speech',activeShot ? speech.filter(segment => segment.start_time < activeShot.end_time && segment.end_time > activeShot.start_time).map(segment => segment.text).join(' ') : null,'Detected'),
          result('Transition measurements',activeShot ? (video?.transition_evidence ?? []).filter(item => item.boundary_timestamp >= activeShot.start_time && item.boundary_timestamp <= activeShot.end_time).length : null,'Detected'),
          result('Measured picture motion',activeShot?.global_motion_evidence ? `${activeShot.global_motion_evidence.frame_pair_count} frame pairs sampled at ${activeShot.global_motion_evidence.sampling_fps} fps` : null,'Detected'),
          result('Silence intervals in reference',video?.audio_structure?.audio_stream_present ? video.audio_structure.silence_count : null,'Detected'),
          result('Audio waveform',waveformPeaks?'Measured from decoded audio':null,'Detected'),
        ])}</div>
      </div>}
      {mode === 'Insights & Learnings' && <div className="dc3-grid">
        <div className="dc3-stack">{preview}<Card title="Scenes & Timeline">{scenes}</Card></div>
        <div className="dc3-stack">
          {row('Messaging insights', displayMessaging.filter(([name]) => ['Core message','Hook','Target audience','Call to action'].includes(name)))}
          <Card title="Technical insights">{technicalReport?.scenes.length ? technicalReport.scenes.map(scene =>
            <details key={scene.number}><summary>Scene {scene.number}</summary><TechnicalSceneEvidence scene={scene} seek={updateTime} /></details>
          ) : <p>Run Technical Intelligence to review production findings.</p>}</Card>
          <Card title="Discoverability insights">{structuredReport ? <DiscoverabilityReport report={structuredReport} seek={updateTime} /> :
            <p>Generate a Discoverability report to review recommendations.</p>}</Card>
          <div className="dc3-actions"><button type="button" disabled={!video} onClick={report}>Export JSON</button>
            <button type="button" disabled={!video} onClick={printReport}>Export Analysis (PDF)</button>
            <button className="chosen" type="button" disabled={!video || !sceneList.length || sending} onClick={() => void send()}>Send to Reconstructor <ArrowRight /></button></div>
        </div>
      </div>}
      {mode === 'Discoverability' && <div className="dc3-grid">{preview}<div className="dc3-stack">
        <Card title="Discoverability Intelligence">
          <label>Target market <input value={market} onChange={event => setMarket(event.target.value)} maxLength={160} /></label>
          <button type="button" disabled={!video || synthesizing} onClick={async () => {
            if (!video) return
            setSynthesizing(true)
            try { await generateDiscoverability(video.id); setMessage('Discoverability report saved.') }
            catch (error) { setMessage(errorMessage(error, 'Discoverability report could not be generated.')) }
            finally { setSynthesizing(false) }
          }}>{synthesizing ? 'Generating report…' : 'Generate structured report'}</button>
          <button type="button" disabled={!sceneList.length || sending} onClick={() => void send()}>Send to Reconstructor</button>
          <button type="button" disabled={!video} onClick={() => void report()}>Download analysis JSON</button>
          {structuredReport && <DiscoverabilityReport key={id} report={structuredReport} seek={updateTime} />}
        </Card>{row('Source and Discoverability Evidence', discoverability)}{video && <ExternalResearch key={video.id} referenceId={video.id} onReports={reports => setSavedReports({id:video.id,reports})} />}<Card title="Evidence Classification"><p>Extracted facts come from the source file or supplied context. Detected findings come from the analysis engines. Interpretations are labelled Inferred. Externally verified findings are labelled Researched. Detected terms and questions describe the source content. Search ranking, generative answer visibility and local demand require independent evidence.</p></Card></div></div>}
    </main>
  </div>
}
