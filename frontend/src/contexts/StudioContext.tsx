import {
  createContext, useContext, useState, useCallback, useRef,
  type ReactNode,
} from 'react'
import type {
  Brand, Asset, Template, Job,
  Platform, ContentType,
  VideoClip, TextOverlay, MediaOverlay, AudioTrack, ImageSlide,
  ChatMessage, SEOPackage, LowerThird, IntroOutro, ApprovalGate,
} from '../types'
import { generateApi, uploadApi } from '../api/client'

interface TimelineState {
  currentTime: number
  duration: number
  playing: boolean
  markIn: number | null
  markOut: number | null
}

export type RailTool =
  | 'history' | 'templates'
  | 'video' | 'image' | 'text' | 'audio' | 'media' | 'effects' | 'lower' | 'intro' | 'platform'
  | 'seo' | 'publish'

export type SelectedElement =
  | { type: 'clip'; lane: 'video' | 'additional'; id: string }
  | { type: 'text'; id: string }
  | { type: 'audio'; id: string }
  | null

interface StudioState {
  // Brand / Job
  activeBrand: Brand | null
  activeJob: Job | null
  brands: Brand[]
  recentJobs: Job[]

  // Content
  contentType: ContentType
  platform: Platform
  videoClips: VideoClip[]
  // Secondary video track — the Timeline's "Additional video" lane (intro/outro/transition
  // inserts layered alongside the main Video lane). Same shape as a main clip.
  additionalVideoClips: VideoClip[]
  imageSlides: ImageSlide[]
  textOverlays: TextOverlay[]
  mediaOverlays: MediaOverlay[]
  audioTracks: AudioTrack[]
  lowerThirds: LowerThird[]
  intro: IntroOutro | null
  outro: IntroOutro | null

  // Preview
  previewUrl: string | null
  previewHtml: string | null
  previewText: string

  // Timeline
  timeline: TimelineState

  // Chat
  chatMessages: ChatMessage[]
  chatLoading: boolean

  // SEO
  seoPackage: SEOPackage | null

  templates: Template[]

  // Icon-rail: which tool panel is expanded (null = collapsed, canvas gets full width)
  activeRailTool: RailTool | null

  // Contextual properties panel: which canvas/timeline element is selected
  selectedElement: SelectedElement

  // Upload progress
  uploadProgress: number | null

  // Approval gate
  pendingApproval: ApprovalGate | null

  // Actions
  setActiveBrand: (b: Brand | null) => void
  setActiveJob: (j: Job | null) => void
  setPlatform: (p: Platform) => void
  setContentType: (t: ContentType) => void
  setTimeline: (upd: Partial<TimelineState>) => void
  setActiveRailTool: (t: RailTool | null) => void
  setSelectedElement: (e: SelectedElement) => void
  setBrands: (b: Brand[]) => void
  setRecentJobs: (j: Job[]) => void
  setTemplates: (t: Template[]) => void
  setSeoPackage: (s: SEOPackage | null) => void
  setPreviewUrl: (u: string | null) => void
  setPreviewHtml: (h: string | null) => void

  // Video editing
  addVideoClip: (clip: VideoClip) => void
  updateVideoClip: (id: string, upd: Partial<VideoClip>) => void
  removeVideoClip: (id: string) => void

  // Additional video track (2nd lane)
  addAdditionalVideoClip: (clip: VideoClip) => void
  updateAdditionalVideoClip: (id: string, upd: Partial<VideoClip>) => void
  removeAdditionalVideoClip: (id: string) => void

  // Image editing
  addImageSlide: (slide: ImageSlide) => void
  updateImageSlide: (id: string, upd: Partial<ImageSlide>) => void
  removeImageSlide: (id: string) => void

  // Text overlays
  addTextOverlay: (o: TextOverlay) => void
  updateTextOverlay: (id: string, upd: Partial<TextOverlay>) => void
  removeTextOverlay: (id: string) => void

  // Audio
  addAudioTrack: (t: AudioTrack) => void
  updateAudioTrack: (id: string, upd: Partial<AudioTrack>) => void
  removeAudioTrack: (id: string) => void

  // Lower thirds
  addLowerThird: (lt: LowerThird) => void
  updateLowerThird: (id: string, upd: Partial<LowerThird>) => void
  removeLowerThird: (id: string) => void

  // Intro/outro
  setIntro: (i: IntroOutro | null) => void
  setOutro: (o: IntroOutro | null) => void

  // Chat
  sendChatMessage: (text: string) => Promise<void>
  approveGate: (gateId: string) => void
  rejectGate: (gateId: string) => void

  // Upload
  uploadAsset: (file: File, jobId?: number) => Promise<Asset>
  setUploadProgress: (p: number | null) => void
}

const StudioCtx = createContext<StudioState | null>(null)

export function StudioProvider({ children }: { children: ReactNode }) {
  const [activeBrand, setActiveBrand] = useState<Brand | null>(null)
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [templates, setTemplates] = useState<Template[]>([])

  const [contentType, setContentType] = useState<ContentType>('video')
  const [platform, setPlatform] = useState<Platform>('instagram_reel')

  const [videoClips, setVideoClips] = useState<VideoClip[]>([])
  const [additionalVideoClips, setAdditionalVideoClips] = useState<VideoClip[]>([])
  const [imageSlides, setImageSlides] = useState<ImageSlide[]>([])
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([])
  const [mediaOverlays, _setMediaOverlays] = useState<MediaOverlay[]>([])
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [lowerThirds, setLowerThirds] = useState<LowerThird[]>([])
  const [intro, setIntro] = useState<IntroOutro | null>(null)
  const [outro, setOutro] = useState<IntroOutro | null>(null)

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewText, _setPreviewText] = useState('')

  const [timeline, setTimelineState] = useState<TimelineState>({
    currentTime: 0, duration: 0, playing: false, markIn: null, markOut: null,
  })

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: '0',
      role: 'assistant',
      content: 'Hi! I\'m your AI content assistant. Tell me what you\'d like to create — or give me an instruction like "make scene 2 black and white" or "cut from 0:45 to 1:20".',
      timestamp: new Date().toISOString(),
    }
  ])
  const [chatLoading, setChatLoading] = useState(false)
  const [seoPackage, setSeoPackage] = useState<SEOPackage | null>(null)

  const [activeRailTool, setActiveRailTool] = useState<RailTool | null>('video')
  const [selectedElement, setSelectedElement] = useState<SelectedElement>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [pendingApproval, setPendingApproval] = useState<ApprovalGate | null>(null)

  const msgIdRef = useRef(1)
  const nextId = () => String(msgIdRef.current++)

  const setTimeline = useCallback((upd: Partial<TimelineState>) => {
    setTimelineState(prev => ({ ...prev, ...upd }))
  }, [])

  // Video clip actions
  const addVideoClip = useCallback((clip: VideoClip) => setVideoClips(p => [...p, clip]), [])
  const updateVideoClip = useCallback((id: string, upd: Partial<VideoClip>) =>
    setVideoClips(p => p.map(c => c.id === id ? { ...c, ...upd } : c)), [])
  const removeVideoClip = useCallback((id: string) =>
    setVideoClips(p => p.filter(c => c.id !== id)), [])

  // Additional video track (2nd lane) actions
  const addAdditionalVideoClip = useCallback((clip: VideoClip) => setAdditionalVideoClips(p => [...p, clip]), [])
  const updateAdditionalVideoClip = useCallback((id: string, upd: Partial<VideoClip>) =>
    setAdditionalVideoClips(p => p.map(c => c.id === id ? { ...c, ...upd } : c)), [])
  const removeAdditionalVideoClip = useCallback((id: string) =>
    setAdditionalVideoClips(p => p.filter(c => c.id !== id)), [])

  // Image slide actions
  const addImageSlide = useCallback((slide: ImageSlide) => setImageSlides(p => [...p, slide]), [])
  const updateImageSlide = useCallback((id: string, upd: Partial<ImageSlide>) =>
    setImageSlides(p => p.map(s => s.id === id ? { ...s, ...upd } : s)), [])
  const removeImageSlide = useCallback((id: string) =>
    setImageSlides(p => p.filter(s => s.id !== id)), [])

  // Text overlay actions
  const addTextOverlay = useCallback((o: TextOverlay) => setTextOverlays(p => [...p, o]), [])
  const updateTextOverlay = useCallback((id: string, upd: Partial<TextOverlay>) =>
    setTextOverlays(p => p.map(o => o.id === id ? { ...o, ...upd } : o)), [])
  const removeTextOverlay = useCallback((id: string) =>
    setTextOverlays(p => p.filter(o => o.id !== id)), [])

  // Audio actions
  const addAudioTrack = useCallback((t: AudioTrack) => setAudioTracks(p => [...p, t]), [])
  const updateAudioTrack = useCallback((id: string, upd: Partial<AudioTrack>) =>
    setAudioTracks(p => p.map(t => t.id === id ? { ...t, ...upd } : t)), [])
  const removeAudioTrack = useCallback((id: string) =>
    setAudioTracks(p => p.filter(t => t.id !== id)), [])

  // Lower thirds
  const addLowerThird = useCallback((lt: LowerThird) => setLowerThirds(p => [...p, lt]), [])
  const updateLowerThird = useCallback((id: string, upd: Partial<LowerThird>) =>
    setLowerThirds(p => p.map(l => l.id === id ? { ...l, ...upd } : l)), [])
  const removeLowerThird = useCallback((id: string) =>
    setLowerThirds(p => p.filter(l => l.id !== id)), [])

  const approveGate = useCallback((gateId: string) => {
    setChatMessages(p => p.map(m =>
      m.approvalGate?.id === gateId
        ? { ...m, approvalGate: { ...m.approvalGate, status: 'approved' } }
        : m
    ))
    setPendingApproval(null)
  }, [])

  const rejectGate = useCallback((gateId: string) => {
    setChatMessages(p => p.map(m =>
      m.approvalGate?.id === gateId
        ? { ...m, approvalGate: { ...m.approvalGate, status: 'rejected' } }
        : m
    ))
    setPendingApproval(null)
  }, [])

  const sendChatMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = {
      id: nextId(), role: 'user', content: text, timestamp: new Date().toISOString(),
    }
    setChatMessages(p => [...p, userMsg])
    setChatLoading(true)

    try {
      const { data } = await generateApi.chat({
        prompt: text,
        brand_id: activeBrand?.id,
        job_id: activeJob?.id,
        context: {
          platform,
          content_type: contentType,
          current_clips: videoClips.length,
          current_time: timeline.currentTime,
        },
      })

      const chatData = data as {
        content?: string
        needs_approval?: boolean
        approval_summary?: string | null
      }
      const reply = chatData.content || JSON.stringify(data)

      // The backend signals approval explicitly via a tool call (request_approval),
      // not by guessing from words like "approve"/"confirm" in the reply text.
      let gate: ApprovalGate | undefined

      if (chatData.needs_approval) {
        gate = {
          id: nextId(),
          message: chatData.approval_summary || reply,
          status: 'waiting',
          timestamp: new Date().toISOString(),
        }
        setPendingApproval(gate)
      }

      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
        approvalGate: gate,
      }
      setChatMessages(p => [...p, assistantMsg])

      // Parse SEO if present
      if ((data as { seo?: SEOPackage }).seo) {
        setSeoPackage((data as { seo: SEOPackage }).seo)
      }
    } catch (err) {
      const errMsg: ChatMessage = {
        id: nextId(),
        role: 'system',
        content: `Error: ${err instanceof Error ? err.message : 'Request failed'}`,
        timestamp: new Date().toISOString(),
      }
      setChatMessages(p => [...p, errMsg])
    } finally {
      setChatLoading(false)
    }
  }, [activeBrand, activeJob, platform, contentType, videoClips.length, timeline.currentTime])

  const uploadAsset = useCallback(async (file: File, jobId?: number): Promise<Asset> => {
    setUploadProgress(0)
    try {
      const { data } = await uploadApi.upload(file, jobId)
      setUploadProgress(100)
      setTimeout(() => setUploadProgress(null), 1500)
      return data as Asset
    } catch (err) {
      setUploadProgress(null)
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      const errMsg: ChatMessage = {
        id: nextId(),
        role: 'system',
        content: `Upload failed: ${typeof detail === 'string' ? detail : (err instanceof Error ? err.message : 'unknown error')}`,
        timestamp: new Date().toISOString(),
      }
      setChatMessages(p => [...p, errMsg])
      throw err
    }
  }, [])

  const value: StudioState = {
    activeBrand, activeJob, brands, recentJobs,
    contentType, platform,
    videoClips, additionalVideoClips, imageSlides, textOverlays, mediaOverlays, audioTracks, lowerThirds, intro, outro,
    previewUrl, previewHtml, previewText,
    timeline,
    chatMessages, chatLoading,
    seoPackage,
    templates,
    activeRailTool, selectedElement,
    uploadProgress,
    pendingApproval,

    setActiveBrand, setActiveJob, setPlatform, setContentType,
    setTimeline, setActiveRailTool, setSelectedElement,
    setBrands, setRecentJobs, setTemplates, setSeoPackage,
    setPreviewUrl, setPreviewHtml,

    addVideoClip, updateVideoClip, removeVideoClip,
    addAdditionalVideoClip, updateAdditionalVideoClip, removeAdditionalVideoClip,
    addImageSlide, updateImageSlide, removeImageSlide,
    addTextOverlay, updateTextOverlay, removeTextOverlay,
    addAudioTrack, updateAudioTrack, removeAudioTrack,
    addLowerThird, updateLowerThird, removeLowerThird,
    setIntro, setOutro,

    sendChatMessage, approveGate, rejectGate,
    uploadAsset, setUploadProgress,
  }

  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>
}

export function useStudio(): StudioState {
  const ctx = useContext(StudioCtx)
  if (!ctx) throw new Error('useStudio must be inside StudioProvider')
  return ctx
}
