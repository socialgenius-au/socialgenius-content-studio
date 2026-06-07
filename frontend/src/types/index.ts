export interface User {
  id: number
  username: string
  email: string
  role: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user_id: number
  username: string
  role: string
}

export interface JobStep {
  step: number
  action: string
  description: string
  tool: string
  inputs: string[]
  outputs: string[]
  estimated_duration: string
}

export interface JobPlan {
  title: string
  summary: string
  platforms: string[]
  content_types: string[]
  steps: JobStep[]
  estimated_total_time: string
  brand_guidelines_applied: boolean
  error?: string
}

export interface Job {
  id: number
  user_id: number
  brand_id: number | null
  title: string
  prompt: string
  plan_json: JobPlan | null
  status: 'pending' | 'running' | 'done' | 'failed'
  created_at: string
  updated_at: string
}

export interface Asset {
  id: number
  job_id: number | null
  user_id: number
  original_filename: string
  stored_filename: string
  file_path: string
  file_type: string
  mime_type: string
  file_size: number
  created_at: string
}
