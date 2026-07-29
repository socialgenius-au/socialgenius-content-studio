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
}

export const assetsApi = {
  list:     (params?: { file_type?: string; job_id?: number }) => api.get('/assets/', { params }),
  download: (id: number)                  => api.get(`/assets/${id}/download`, { responseType: 'blob' }),
  delete:   (id: number)                  => api.delete(`/assets/${id}`),
  zip:      (asset_ids: number[])          => api.post('/assets/zip', { asset_ids }, { responseType: 'blob' }),
  downloadUrl: (id: number)               => `${import.meta.env.VITE_API_URL ?? ''}/assets/${id}/download`,
}

export const templatesApi = {
  list:   ()                                                  => api.get('/templates/'),
  get:    (id: number)                                        => api.get(`/templates/${id}`),
  create: (body: { name: string; description?: string; prompt: string; job_id?: number; plan_json?: unknown }) =>
    api.post('/templates/', body),
  update: (id: number, body: Record<string, unknown>)         => api.put(`/templates/${id}`, body),
  delete: (id: number)                                        => api.delete(`/templates/${id}`),
}

export const uploadApi = {
  upload: (file: File, job_id?: number) => {
    const form = new FormData()
    form.append('file', file)
    const url = job_id ? `/upload/?job_id=${job_id}` : '/upload/'
    return api.post(url, form)
  },
}
