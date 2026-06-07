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
  list: () => api.get('/jobs/'),
  get: (id: number) => api.get(`/jobs/${id}`),
  updateStatus: (id: number, status: string) =>
    api.patch(`/jobs/${id}/status`, { status }),
}

export const uploadApi = {
  upload: (file: File, job_id?: number) => {
    const form = new FormData()
    form.append('file', file)
    const url = job_id ? `/upload/?job_id=${job_id}` : '/upload/'
    return api.post(url, form, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}
