import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { Job, Asset } from '../types'
import { jobsApi, assetsApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

const STATUS_COLOR: Record<string, string> = {
  pending: '#C89A2E',
  running: '#2980b9',
  done:    '#27ae60',
  failed:  '#c0392b',
}

export default function Dashboard() {
  const { user } = useAuth()
  const [jobs, setJobs]             = useState<Job[]>([])
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({})
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    Promise.all([
      jobsApi.list(),
      assetsApi.list({ file_type: 'thumbnail' }),
    ]).then(([jr, tr]) => {
      const jobList = jr.data as Job[]
      setJobs(jobList)

      // Build job_id → thumbnail URL map
      const thumbMap: Record<number, string> = {}
      for (const a of tr.data as Asset[]) {
        if (a.job_id && !thumbMap[a.job_id]) {
          // Derive public URL from file_path — file is served via StaticFiles at /uploads
          const parts = a.file_path.split(/[/\\]uploads[/\\]/)
          if (parts[1]) {
            thumbMap[a.job_id] = `${import.meta.env.VITE_API_URL ?? ''}/uploads/${parts[1]}`
          }
        }
      }
      setThumbnails(thumbMap)
    }).finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div style={s.header}>
        <div>
          <h2 style={s.title}>Welcome back, {user?.username}</h2>
          <p style={s.sub}>{jobs.length} job{jobs.length !== 1 ? 's' : ''} in your pipeline</p>
        </div>
        <Link to="/planner" style={s.newBtn}>+ New Plan</Link>
      </div>

      {loading ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : jobs.length === 0 ? (
        <div style={s.empty}>
          <p style={{ fontSize: 18, fontWeight: 600, color: '#555', margin: '0 0 12px' }}>No jobs yet</p>
          <Link to="/planner" style={s.emptyLink}>Create your first content plan →</Link>
        </div>
      ) : (
        <div style={s.grid}>
          {jobs.map((job) => {
            const thumbUrl = thumbnails[job.id]
            return (
              <Link key={job.id} to={`/jobs/${job.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ ...s.card, cursor: 'pointer' }}>
                  {/* ── Thumbnail banner ── */}
                  {thumbUrl && (
                    <div style={s.thumbBanner}>
                      <img
                        src={thumbUrl}
                        alt=""
                        style={s.thumbImg}
                        onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }}
                      />
                      <div style={s.thumbOverlay} />
                    </div>
                  )}

                  <div style={s.cardContent}>
                    <div style={s.cardTop}>
                      <span style={{ ...s.status, background: STATUS_COLOR[job.status] ?? '#999' }}>
                        {job.status}
                      </span>
                      <span style={s.date}>{new Date(job.created_at).toLocaleDateString('en-AU')}</span>
                    </div>
                    <h3 style={s.cardTitle}>{job.title}</h3>
                    <p style={s.cardPrompt}>
                      {job.prompt.length > 120 ? `${job.prompt.slice(0, 120)}…` : job.prompt}
                    </p>
                    {job.plan_json?.platforms && (
                      <div style={s.tags}>
                        {job.plan_json.platforms.map((p) => <span key={p} style={s.tag}>{p}</span>)}
                      </div>
                    )}
                    <p style={s.meta}>
                      {job.plan_json?.steps?.length ?? 0} steps
                      {job.plan_json?.estimated_total_time ? ` · ${job.plan_json.estimated_total_time}` : ''}
                    </p>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 },
  title:  { margin: 0, fontSize: 28, color: '#1E3D2A', fontWeight: 800, letterSpacing: '-0.5px' },
  sub:    { margin: '6px 0 0', color: '#888', fontSize: 14 },
  newBtn: {
    background: '#1E3D2A',
    color: '#F5F0E8',
    textDecoration: 'none',
    padding: '12px 24px',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 14,
    whiteSpace: 'nowrap',
  },
  empty:     { textAlign: 'center', padding: '96px 0' },
  emptyLink: { color: '#C89A2E', textDecoration: 'none', fontWeight: 600, fontSize: 15 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 },
  card: {
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
    border: '1px solid #ede9e0',
    transition: 'box-shadow 0.15s',
    overflow: 'hidden',
  },
  thumbBanner:  { position: 'relative', height: 120, overflow: 'hidden', background: '#1a2e1e' },
  thumbImg:     { width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 },
  thumbOverlay: { position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.35))' },
  cardContent:  { padding: 24 },
  cardTop:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  status:    { color: '#fff', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 },
  date:      { color: '#aaa', fontSize: 12 },
  cardTitle: { margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: '#1E3D2A', lineHeight: 1.3 },
  cardPrompt:{ margin: '0 0 14px', fontSize: 13, color: '#666', lineHeight: 1.6 },
  tags:      { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  tag:       { background: '#F5F0E8', color: '#1E3D2A', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600 },
  meta:      { margin: 0, fontSize: 12, color: '#bbb' },
}
