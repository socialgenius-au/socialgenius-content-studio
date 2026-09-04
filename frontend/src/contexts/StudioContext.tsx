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

// Video Studio V2's Create/Edit multi-platform canvas system (see
// pages/video-studio-v2/data/canvasFormats.ts for the full platform → placement menu that
// produces these values). Kept here, not in the V2 page tree, purely so it's carried by the
// same StudioContext instance Review reads from — legacy /studio never reads or writes this.
export interface CanvasFormatState {
  platformKey: string
  placementKey: string
  label: string
  ratio: string
  width: number
  height: number
}

const DEFAULT_CANVAS_FORMAT: CanvasFormatState = {
  platformKey: 'instagram', placementKey: 'reel_story', label: 'Instagram - Reel / Story',
  ratio: '9:16', width: 1080, height: 1920,
}

// Video Studio V2 Create/Edit — drag position for a canvas element that has no dedicated
// data-model position field yet (see SelectedElement's 'canvasItem' variant). Stored as a
// fraction (0–1) of the canvas's own width/height, NOT display pixels — that makes it a true
// canvas/project coordinate (survives any zoom level) and, being a fraction rather than an
// absolute pixel count, it also stays proportionally in place when the canvas format changes.
export interface CanvasItemPosition { xPct: number; yPct: number }

export type RailTool =
  | 'history' | 'templates'
  | 'video' | 'image' | 'text' | 'audio' | 'media' | 'effects' | 'lower' | 'intro' | 'platform'
  | 'seo' | 'publish'

export type SelectedElement =
  | { type: 'clip'; lane: 'video' | 'additional'; id: string }
  | { type: 'text'; id: string }
  | { type: 'audio'; id: string }
  // MediaOverlay (uploaded overlay asset) — mirrors 'text'/'audio' exactly: real backing
  // data-model entry, identified by id alone. Added when Overlay selection was wired up
  // (previously the only gap: MediaOverlay had a full data model but no SelectedElement
  // variant at all, so nothing could ever select one).
  | { type: 'overlay'; id: string }
  // Phase 2 (Video Studio V2 — Lower Thirds): same real-backing-data-model pattern as
  // 'overlay' above, over LowerThird instead of MediaOverlay. Additive only; legacy /studio's
  // own LowerThirdBuilder.tsx has no canvas selection concept and never produces this variant.
  | { type: 'lowerThird'; id: string }
  // A canvas element with no backing data-model entry yet (Video Studio V2's placeholder
  // mock content — headline, badge, CTA, etc.) — carries just enough for Properties'
  // "Type / Name" identification. Additive only; legacy /studio never produces this variant.
  | { type: 'canvasItem'; id: string; kind: string; name: string }
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

  // Media library — assets uploaded via the "Upload Files" button, shown in the left panel
  mediaAssets: Asset[]
  addMediaAsset: (a: Asset) => void
  // Video Studio V2's "remove from Media Library" — only ever removes this session's local
  // reference (the array entry that makes it show up in the left panel); never calls the
  // backend's own DELETE /assets/{id} (that would touch the underlying file/DB row shared
  // across every other draft that might reference the same asset id — out of scope and unsafe
  // for a per-project "remove from library" action).
  removeMediaAsset: (id: number) => void

  // Video Studio V2 multi-platform canvas — current active format, plus every format the
  // project has been given a version for. The master timeline (videoClips etc.) is identical
  // across all of them; only the canvas frame differs, and only ever fitted, never stretched.
  canvasFormat: CanvasFormatState
  setCanvasFormat: (f: CanvasFormatState) => void
  canvasVersions: CanvasFormatState[]
  addCanvasVersion: (f: CanvasFormatState) => void

  // Drag position for canvas elements with no dedicated position field of their own yet
  // (see CanvasItemPosition above). Keyed by the element's canvasItem id.
  canvasItemPositions: Record<string, CanvasItemPosition>
  setCanvasItemPosition: (id: string, pos: CanvasItemPosition) => void

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

  // Media overlays
  addMediaOverlay: (o: MediaOverlay) => void
  updateMediaOverlay: (id: string, upd: Partial<MediaOverlay>) => void
  removeMediaOverlay: (id: string) => void

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
  const [mediaAssets, setMediaAssets] = useState<Asset[]>([])
  const [canvasFormat, setCanvasFormat] = useState<CanvasFormatState>(DEFAULT_CANVAS_FORMAT)
  const [canvasVersions, setCanvasVersions] = useState<CanvasFormatState[]>([DEFAULT_CANVAS_FORMAT])
  const [canvasItemPositions, setCanvasItemPositions] = useState<Record<string, CanvasItemPosition>>({})

  const [contentType, setContentType] = useState<ContentType>('video')
  const [platform, setPlatform] = useState<Platform>('instagram_reel')

  const [videoClips, setVideoClips] = useState<VideoClip[]>([])
  const [additionalVideoClips, setAdditionalVideoClips] = useState<VideoClip[]>([])
  const [imageSlides, setImageSlides] = useState<ImageSlide[]>([])
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([])
  const [mediaOverlays, setMediaOverlays] = useState<MediaOverlay[]>([])
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

  const addMediaAsset = useCallback((a: Asset) => setMediaAssets(p => [...p, a]), [])
  const removeMediaAsset = useCallback((id: number) => setMediaAssets(p => p.filter(a => a.id !== id)), [])

  // Non-destructive: adding a version never touches the master timeline, and re-adding a
  // format that already has a version just moves focus rather than duplicating it.
  const addCanvasVersion = useCallback((f: CanvasFormatState) => setCanvasVersions(p =>
    p.some(v => v.platformKey === f.platformKey && v.placementKey === f.placementKey) ? p : [...p, f]
  ), [])

  const setCanvasItemPosition = useCallback((id: string, pos: CanvasItemPosition) =>
    setCanvasItemPositions(p => ({ ...p, [id]: pos })), [])

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

  // Media overlay actions
  const addMediaOverlay = useCallback((o: MediaOverlay) => setMediaOverlays(p => [...p, o]), [])
  const updateMediaOverlay = useCallback((id: string, upd: Partial<MediaOverlay>) =>
    setMediaOverlays(p => p.map(o => o.id === id ? { ...o, ...upd } : o)), [])
  const removeMediaOverlay = useCallback((id: string) =>
    setMediaOverlays(p => p.filter(o => o.id !== id)), [])

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
    mediaAssets, addMediaAsset, removeMediaAsset,
    canvasFormat, setCanvasFormat, canvasVersions, addCanvasVersion,
    canvasItemPositions, setCanvasItemPosition,
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
    addMediaOverlay, updateMediaOverlay, removeMediaOverlay,
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
