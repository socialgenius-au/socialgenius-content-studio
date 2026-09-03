import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default api

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
}

export const planApi = {
  create: (prompt: string, title?: string, brand_id?: number) =>
    api.post('/plan/', { prompt, title, brand_id }),
}

export const jobsApi = {
  list:         ()                          => api.get('/jobs/'),
  get:          (id: number)                => api.get(`/jobs/${id}`),
  getAssets:    (id: number)                => api.get(`/jobs/${id}/assets`),
  execute:      (id: number)                => api.post(`/jobs/${id}/execute`),
  updateStatus: (id: number, s: string)     => api.patch(`/jobs/${id}/status`, { status: s }),
}

export const transcribeApi = {
  transcribe: (assetId: number, language?: string) =>
    api.post(`/transcribe/${assetId}`, null, { params: language ? { language } : {} }),
  list: (assetId: number) => api.get(`/transcribe/asset/${assetId}`),
}

export const processApi = {
  process: (body: Record<string, unknown>) => api.post('/process/', body),
  merge:   (body: Record<string, unknown>) => api.post('/process/merge', body),
  export:  (body: Record<string, unknown>) => api.post('/process/export', body),
}

export const publishApi = {
  beehiiv: (body: Record<string, unknown>) => api.post('/publish/beehiiv', body),
  gmb:     (body: Record<string, unknown>) => api.post('/publish/gmb', body),
}

export const canvaApi = {
  createDesign:   (body: Record<string, unknown>)          => api.post('/canva/design', body),
  listTemplates:  (query?: string)                          => api.get('/canva/templates', { params: { query } }),
  exportDesign:   (designId: string, fmt = 'png')           => api.post(`/canva/export/${designId}`, null, { params: { fmt } }),
}

export const scrapeApi = {
  run: (body: Record<string, unknown>) => api.post('/scrape/', body),
}

export const pixabayApi = {
  searchImages: (q: string, imageType?: string, perPage = 20) =>
    api.get('/pixabay/search', { params: { q, image_type: imageType, per_page: perPage } }),
  searchVideos: (q: string, perPage = 20) =>
    api.get('/pixabay/search/videos', { params: { q, per_page: perPage } }),
}

export const brandsApi = {
  list:   ()                                              => api.get('/brands/'),
  get:    (id: number)                                    => api.get(`/brands/${id}`),
  create: (body: Record<string, unknown>)                 => api.post('/brands/', body),
  update: (id: number, body: Record<string, unknown>)     => api.put(`/brands/${id}`, body),
  delete: (id: number)                                    => api.delete(`/brands/${id}`),
}

export const generateApi = {
  generate: (body: Record<string, unknown>) => api.post('/generate/', body),
  chat: (body: Record<string, unknown>) => api.post('/generate/chat', body),
  // Video Studio V2 AI Tools — AI Prompt Generator (first of six AI Tools cards).
  prompt: (body: Record<string, unknown>) => api.post('/generate/prompt', body),
}

export const assetsApi = {
  list:     (params?: { file_type?: string; job_id?: number }) => api.get('/assets/', { params }),
  download: (id: number)                  => api.get(`/assets/${id}/download`, { responseType: 'blob' }),
  delete:   (id: number)                  => api.delete(`/assets/${id}`),
  zip:      (asset_ids: number[])          => api.post('/assets/zip', { asset_ids }, { responseType: 'blob' }),
  // Unauthenticated static path for <video>/<img>/<audio> src — the /assets/:id/download
  // route requires a Bearer header that browser-native media/anchor loads never send.
  // file_path from the backend is relative (e.g. "uploads/1/x.mp4" on Linux/macOS, but
  // "uploads\1\x.mp4" on Windows — Path(...).__str__ uses the OS separator). Normalize to
  // forward slashes first so the "uploads/" strip matches on every platform; otherwise on
  // Windows it never matches and the URL doubles up into "/uploads/uploads\1\x.mp4".
  previewUrl: (filePath: string)           => `${import.meta.env.VITE_API_URL ?? ''}/uploads/${filePath.replace(/\\/g, '/').replace(/^\/?uploads\//, '')}`,
}

// Video Deconstructor — Stage 2 (Reference Video Ingestion) ONLY. Takes an asset_id already
// returned by uploadApi.upload — never uploads a file itself; see reference_videos.py's own
// module docstring on the backend for exact scope.
export const referenceVideosApi = {
  ingest:  (asset_id: number) => api.post('/reference-videos/', { asset_id }),
  get:     (id: number)       => api.get(`/reference-videos/${id}`),
  // Restoration path (post-Stage-3 defect fix): the caller's own ReferenceVideos, newest first
  // — lets Import External restore an already-ingested reference after a reload/remount instead
  // of only ever holding it in local component state.
  list:    ()                 => api.get('/reference-videos/'),
  // Video Deconstructor — Stage 3 (Reference Video Technical Analysis) ONLY. Deterministic
  // ffmpeg-based facts, no AI — see reference_videos.py's own module docstring for exact scope.
  analyze: (id: number)       => api.post(`/reference-videos/${id}/analyze`),
  // Video Deconstructor — Stage 4 (Deterministic Shot/Cut Boundary Detection) ONLY. No semantic
  // Scene grouping, no AI — see reference_videos.py's own module docstring for exact scope.
  analyzeStructure: (id: number) => api.post(`/reference-videos/${id}/analyze-structure`),
  // Video Deconstructor — Stage 5 (Visual Evidence / Representative Frames) ONLY. Deterministic
  // ffmpeg + Pillow/numpy frame extraction, no AI/OCR/object detection — see reference_videos.py's
  // own module docstring for exact scope.
  analyzeFrames: (id: number) => api.post(`/reference-videos/${id}/analyze-frames`),
}

export const templatesApi = {
  list:   ()                                                  => api.get('/templates/'),
  get:    (id: number)                                        => api.get(`/templates/${id}`),
  create: (body: { name: string; description?: string; prompt: string; job_id?: number; plan_json?: unknown }) =>
    api.post('/templates/', body),
  update: (id: number, body: Record<string, unknown>)         => api.put(`/templates/${id}`, body),
  delete: (id: number)                                        => api.delete(`/templates/${id}`),
}

// Step 7.9: durable "Save Draft" / "My Drafts" storage for Video Studio V2 — a project_json
// blob (opaque to the backend, shaped entirely by the frontend) plus a name/timestamps.
export const videoStudioDraftsApi = {
  list:   ()                                                    => api.get('/video-studio-drafts/'),
  get:    (id: number)                                          => api.get(`/video-studio-drafts/${id}`),
  create: (body: { name: string; project_json: unknown })       => api.post('/video-studio-drafts/', body),
  update: (id: number, body: { name: string; project_json: unknown }) => api.put(`/video-studio-drafts/${id}`, body),
  delete: (id: number)                                          => api.delete(`/video-studio-drafts/${id}`),
}

// STEP 7.15F: real Video Studio V2 export/render — POSTs the current project (see
// ReviewTab.tsx's buildExportRequest) and gets the actual rendered MP4 back as a blob, the
// exact same responseType: 'blob' pattern assetsApi.download/zip already use for real
// downloads elsewhere in this app.
export const videoExportApi = {
  exportProject: (body: Record<string, unknown>) =>
    api.post('/video-export/export', body, { responseType: 'blob' }),
}

export const uploadApi = {
  upload: (file: File, job_id?: number) => {
    const form = new FormData()
    form.append('file', file)
    const url = job_id ? `/upload/?job_id=${job_id}` : '/upload/'
    // Instance default forces Content-Type: application/json — clearing it here lets the
    // browser set multipart/form-data with the correct boundary for FormData bodies.
    return api.post(url, form, { headers: { 'Content-Type': undefined } })
  },
}
