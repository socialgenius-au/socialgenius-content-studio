import { useEffect, useState, type CSSProperties } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { Job, JobStep, Asset } from '../types'
import { jobsApi, uploadApi } from '../api/client'
import api from '../api/client'

const EXEC_COLOR: Record<string, string> = {
  pending:          '#bbb',
  running:          '#2980b9',
  done:             '#27ae60',
  failed:           '#c0392b',
  skipped:          '#e67e22',
  awaiting_manual:  '#C89A2E',
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#C89A2E',
  running: '#2980b9',
  done:    '#27ae60',
  failed:  '#c0392b',
}

export default function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    if (!jobId) return
    const [jr, ar] = await Promise.all([
      jobsApi.get(Number(jobId)),
      jobsApi.getAssets(Number(jobId)),
    ])
    setJob(jr.data as Job)
    setAssets(ar.data as Asset[])
  }

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [jobId])

  // Poll while running
  useEffect(() => {
    if (job?.status === 'running' && !pollInterval) {
      const id = setInterval(() => load(), 2000)
      setPollInterval(id)
    }
    if (job?.status !== 'running' && pollInterval) {
      clearInterval(pollInterval)
      setPollInterval(null)
    }
    return () => { if (pollInterval) clearInterval(pollInterval) }
  }, [job?.status])

  const handleExecute = async () => {
    if (!jobId) return
    setExecuting(true)
    try {
      await jobsApi.execute(Number(jobId))
      await load()
    } finally {
      setExecuting(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !jobId) return
    await uploadApi.upload(file, Number(jobId))
    await load()
  }

  if (loading) return <p style={{ color: '#888', padding: 48 }}>Loading…</p>
  if (!job)   return <p style={{ color: '#c0392b', padding: 48 }}>Job not found.</p>

  const plan = job.plan_json
  const steps: (JobStep & { exec_status?: string; exec_note?: string; output?: Record<string, unknown>; started_at?: string; finished_at?: string })[]
    = (plan?.steps ?? []) as typeof steps

  return (
    <div>
      {/* ── Header ── */}
      <div style={s.header}>
        <div>
          <Link to="/dashboard" style={s.back}>← Dashboard</Link>
          <h2 style={s.title}>{job.title}</h2>
          <p style={s.promptText}>{job.prompt}</p>
        </div>
        <div style={s.headerRight}>
          <span style={{ ...s.statusBadge, background: STATUS_COLOR[job.status] ?? '#999' }}>
            {job.status}
          </span>
          {job.plan_json && job.status !== 'running' && (
            <button
              style={{ ...s.btn, opacity: executing ? 0.65 : 1 }}
              onClick={handleExecute}
              disabled={executing}
            >
              {executing ? 'Starting…' : '▶ Execute Plan'}
            </button>
          )}
        </div>
      </div>

      <div style={s.layout}>
        {/* ── Plan steps ── */}
        {steps.length > 0 && (
          <div style={s.panel}>
            <h3 style={s.sectionTitle}>Execution Plan</h3>
            {plan && (
              <div style={s.planMeta}>
                <span>{plan.estimated_total_time}</span>
                <div style={s.tags}>
                  {plan.platforms?.map((p) => <span key={p} style={s.tag}>{p}</span>)}
                </div>
              </div>
            )}
            <div style={s.steps}>
              {steps.map((step) => {
                const es = step.exec_status ?? 'pending'
                return (
                  <div key={step.step} style={s.step}>
                    <div style={{ ...s.stepNum, background: EXEC_COLOR[es] ?? '#bbb' }}>{step.step}</div>
                    <div style={s.stepBody}>
                      <div style={s.stepRow}>
                        <strong style={s.stepAction}>{step.action}</strong>
                        <div style={s.stepBadges}>
                          <span style={s.toolBadge}>{step.tool}</span>
                          <span style={{ ...s.execBadge, background: EXEC_COLOR[es] ?? '#bbb' }}>{es.replace('_', ' ')}</span>
                        </div>
                      </div>
                      <p style={s.stepDesc}>{step.description}</p>
                      {step.exec_note && <p style={s.execNote}>{step.exec_note}</p>}
                      {step.output && (
                        <pre style={s.outputBox}>{JSON.stringify(step.output, null, 2)}</pre>
                      )}
                      <span style={s.stepTime}>{step.estimated_duration}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Side panel: Assets + Tool actions ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Assets */}
          <div style={s.panel}>
            <h3 style={s.sectionTitle}>Assets</h3>
            <label style={s.uploadLabel}>
              <input type="file" style={{ display: 'none' }} accept="video/*,audio/*,image/*,.pdf,.srt"
                onChange={handleFileUpload} />
              + Attach file
            </label>
            {assets.length === 0
              ? <p style={s.emptyText}>No assets attached yet.</p>
              : assets.map((a) => (
                  <div key={a.id} style={s.assetRow}>
                    <span style={s.assetIcon}>{fileIcon(a.file_type)}</span>
                    <div>
                      <p style={s.assetName}>{a.original_filename}</p>
                      <p style={s.assetMeta}>{a.file_type} · {fmtSize(a.file_size)}</p>
                    </div>
                  </div>
                ))
            }
          </div>

          {/* Quick actions */}
          <div style={s.panel}>
            <h3 style={s.sectionTitle}>Quick Actions</h3>
            <div style={s.actionGrid}>
              <ActionTile
                title="Transcribe"
                desc="Whisper → SRT"
                onClick={() => assets[0] && api.post(`/transcribe/${assets[0].id}`).then(() => alert('Transcription started')).catch((e) => alert(e.message))}
                disabled={!assets.some((a) => a.file_type === 'audio' || a.file_type === 'video')}
              />
              <ActionTile
                title="Search Stock"
                desc="Pixabay images"
                onClick={() => navigate(`/pixabay?job=${job.id}&q=${encodeURIComponent(job.title)}`)}
              />
              <ActionTile
                title="Canva Design"
                desc="Create design"
                onClick={() => navigate(`/canva/new?job=${job.id}`)}
              />
              <ActionTile
                title="Publish"
                desc="Beehiiv / GMB"
                onClick={() => navigate(`/publish?job=${job.id}`)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionTile({ title, desc, onClick, disabled = false }: {
  title: string; desc: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      style={{ ...s.actionTile, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      onClick={disabled ? undefined : onClick}
    >
      <strong style={s.actionTitle}>{title}</strong>
      <span style={s.actionDesc}>{desc}</span>
    </button>
  )
}

function fileIcon(type: string) {
  return type === 'video' ? '🎬' : type === 'audio' ? '🎵' : type === 'image' ? '🖼' : '📄'
}

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const s: Record<string, CSSProperties> = {
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 },
  back:   { color: '#C89A2E', textDecoration: 'none', fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 },
  title:  { margin: '0 0 6px', fontSize: 26, fontWeight: 800, color: '#1E3D2A', letterSpacing: '-0.3px' },
  promptText: { margin: 0, color: '#888', fontSize: 13, lineHeight: 1.5, maxWidth: 600 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 },
  statusBadge: { color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 800, textTransform: 'uppercase' },
  btn: {
    padding: '10px 22px',
    background: '#1E3D2A',
    color: '#F5F0E8',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  layout: { display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' },
  panel: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)', border: '1px solid #ede9e0' },
  sectionTitle: { margin: '0 0 16px', fontSize: 15, fontWeight: 800, color: '#1E3D2A', textTransform: 'uppercase', letterSpacing: 0.5 },
  planMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, color: '#C89A2E', fontWeight: 700, fontSize: 13 },
  tags: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  tag:  { background: '#F5F0E8', color: '#1E3D2A', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 },
  steps: { display: 'flex', flexDirection: 'column', gap: 14 },
  step:  { display: 'flex', gap: 12, alignItems: 'flex-start' },
  stepNum: { width: 26, height: 26, minWidth: 26, color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, marginTop: 2, transition: 'background 0.3s' },
  stepBody: { flex: 1, minWidth: 0 },
  stepRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  stepAction: { fontSize: 14, color: '#1E3D2A', fontWeight: 700 },
  stepBadges: { display: 'flex', gap: 6 },
  toolBadge: { background: '#C89A2E', color: '#fff', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 800, textTransform: 'uppercase' },
  execBadge: { color: '#fff', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 800, textTransform: 'capitalize' },
  stepDesc: { margin: '0 0 4px', fontSize: 13, color: '#555', lineHeight: 1.55 },
  execNote: { margin: '4px 0', fontSize: 12, color: '#888', fontStyle: 'italic', lineHeight: 1.5 },
  outputBox: { background: '#f8f6f0', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#555', overflowX: 'auto', margin: '4px 0' },
  stepTime: { fontSize: 11, color: '#bbb' },
  uploadLabel: { display: 'inline-block', padding: '8px 16px', background: '#1E3D2A', color: '#F5F0E8', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 14 },
  emptyText: { color: '#bbb', fontSize: 13, margin: 0 },
  assetRow: { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid #f0ece4' },
  assetIcon: { fontSize: 22 },
  assetName: { margin: 0, fontSize: 13, fontWeight: 600, color: '#1E3D2A', wordBreak: 'break-all' },
  assetMeta: { margin: '2px 0 0', fontSize: 11, color: '#aaa' },
  actionGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  actionTile: { display: 'flex', flexDirection: 'column', gap: 4, padding: '12px', background: '#F5F0E8', border: '1px solid #e0d9cc', borderRadius: 8, textAlign: 'left' },
  actionTitle: { fontSize: 13, color: '#1E3D2A', fontWeight: 700 },
  actionDesc:  { fontSize: 11, color: '#888' },
}
