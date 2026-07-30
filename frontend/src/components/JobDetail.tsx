import { useEffect, useState, type CSSProperties, type ChangeEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { Job, JobPlan, Asset } from '../types'
import { jobsApi, uploadApi, generateApi, templatesApi } from '../api/client'
import { useJobSocket } from '../hooks/useJobSocket'

const EXEC_COLOR: Record<string, string> = {
  pending:         '#bbb',
  running:         '#2980b9',
  done:            '#27ae60',
  failed:          '#c0392b',
  skipped:         '#e67e22',
  awaiting_manual: '#C89A2E',
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#C89A2E',
  running: '#2980b9',
  done:    '#27ae60',
  failed:  '#c0392b',
}

type StepWithExec = {
  step: number
  action: string
  description: string
  tool: string
  estimated_duration: string
  exec_status?: string
  exec_note?: string
  started_at?: string
  finished_at?: string
  output?: Record<string, unknown>
  generated_content?: GeneratedContent
}

type GeneratedContent = {
  platform: string
  content_type: string
  content: string
  hashtags: string[]
  character_count: number
  cta: string
  notes: string
}

const PLATFORMS = ['Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Facebook', 'Email', 'GMB']

export default function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate   = useNavigate()
  const [job, setJob]         = useState<Job | null>(null)
  const [assets, setAssets]   = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [executeError, setExecuteError] = useState<string | null>(null)
  // per-step generate UI state
  const [savingTpl, setSavingTpl]       = useState(false)
  const [tplSaved, setTplSaved]         = useState(false)
  // per-step generate UI state
  const [genPlatform, setGenPlatform]   = useState<Record<number, string>>({})
  const [genLoading, setGenLoading]     = useState<Record<number, boolean>>({})
  const [genTone, setGenTone]           = useState<Record<number, string>>({})
  const [genExpanded, setGenExpanded]   = useState<Record<number, boolean>>({})

  const load = async () => {
    if (!jobId) return
    const [jr, ar] = await Promise.all([
      jobsApi.get(Number(jobId)),
      jobsApi.getAssets(Number(jobId)),
    ])
    setJob(jr.data as Job)
    setAssets(ar.data as Asset[])
  }

  // WebSocket — patches job state from server messages
  useJobSocket(
    jobId ? Number(jobId) : null,
    (msg) => {
      if (msg.type === 'init' || msg.type === 'status') {
        setJob((prev) => prev ? { ...prev, status: (msg.status as Job['status']) ?? prev.status, plan_json: (msg.plan_json as JobPlan) ?? prev.plan_json } : prev)
      }
      if (msg.type === 'step_update') {
        setJob((prev) => prev ? { ...prev, plan_json: (msg.plan_json as JobPlan) ?? prev.plan_json } : prev)
      }
    },
    load,  // fallback: poll via regular fetch
  )

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [jobId])

  const handleExecute = async () => {
    if (!jobId) return
    setExecuting(true)
    setExecuteError(null)
    try {
      await jobsApi.execute(Number(jobId))
      await load()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setExecuteError(typeof detail === 'string' ? detail : 'Failed to start execution.')
    } finally {
      setExecuting(false)
    }
  }

  const handleSaveTemplate = async () => {
    if (!job) return
    setSavingTpl(true)
    try {
      await templatesApi.create({ name: job.title, prompt: job.prompt, job_id: job.id })
      setTplSaved(true)
      setTimeout(() => setTplSaved(false), 3000)
    } finally {
      setSavingTpl(false)
    }
  }

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !jobId) return
    await uploadApi.upload(file, Number(jobId))
    await load()
  }

  const handleGenerate = async (stepNum: number) => {
    if (!jobId) return
    const platform = genPlatform[stepNum] || PLATFORMS[0]
    const tone = genTone[stepNum] || 'professional'
    setGenLoading((p) => ({ ...p, [stepNum]: true }))
    try {
      await generateApi.generate({
        job_id: Number(jobId),
        step_number: stepNum,
        platform,
        tone,
        save_to_step: true,
      })
      await load()  // reload to get generated_content saved in plan_json
    } finally {
      setGenLoading((p) => ({ ...p, [stepNum]: false }))
    }
  }

  if (loading) return <p style={{ color: '#888', padding: 48 }}>Loading…</p>
  if (!job)    return <p style={{ color: '#c0392b', padding: 48 }}>Job not found.</p>

  const plan = job.plan_json
  const steps = (plan?.steps ?? []) as StepWithExec[]

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
          {plan && job.status !== 'running' && (
            <button style={{ ...s.btn, opacity: executing ? 0.65 : 1 }} onClick={handleExecute} disabled={executing}>
              {executing ? 'Starting…' : '▶ Execute Plan'}
            </button>
          )}
          <button
            style={{ ...s.tplBtn, opacity: savingTpl ? 0.65 : 1, ...(tplSaved ? s.tplBtnSaved : {}) }}
            onClick={handleSaveTemplate}
            disabled={savingTpl}
          >
            {tplSaved ? '✓ Saved!' : savingTpl ? 'Saving…' : '📋 Save as Template'}
          </button>
        </div>
      </div>

      {executeError && <p style={s.executeError}>{executeError}</p>}

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
                const isExpanded = genExpanded[step.step]
                return (
                  <div key={step.step} style={s.step}>
                    <div style={{ ...s.stepNum, background: EXEC_COLOR[es] ?? '#bbb' }}>{step.step}</div>
                    <div style={s.stepBody}>
                      <div style={s.stepRow}>
                        <strong style={s.stepAction}>{step.action}</strong>
                        <div style={s.stepBadges}>
                          <span style={s.toolBadge}>{step.tool}</span>
                          <span style={{ ...s.execBadge, background: EXEC_COLOR[es] ?? '#bbb' }}>
                            {es.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                      <p style={s.stepDesc}>{step.description}</p>
                      {step.exec_note && <p style={s.execNote}>{step.exec_note}</p>}
                      {step.output && (
                        <pre style={s.outputBox}>{JSON.stringify(step.output, null, 2)}</pre>
                      )}

                      {/* ── Generated content ── */}
                      {step.generated_content && (
                        <div style={s.genResult}>
                          <div style={s.genResultHeader}>
                            <span style={s.genPlatformTag}>{step.generated_content.platform}</span>
                            <span style={s.genType}>{step.generated_content.content_type}</span>
                            <span style={s.genChars}>{step.generated_content.character_count} chars</span>
                          </div>
                          <p style={s.genContent}>{step.generated_content.content}</p>
                          {step.generated_content.hashtags?.length > 0 && (
                            <p style={s.genHashtags}>{step.generated_content.hashtags.join(' ')}</p>
                          )}
                          {step.generated_content.cta && (
                            <p style={s.genCta}>CTA: {step.generated_content.cta}</p>
                          )}
                        </div>
                      )}

                      {/* ── Generate copy panel ── */}
                      <div style={s.genPanel}>
                        <button
                          style={s.genToggle}
                          onClick={() => setGenExpanded((p) => ({ ...p, [step.step]: !p[step.step] }))}
                        >
                          {step.generated_content ? '✏️ Regenerate Copy' : '✨ Generate Copy'}
                        </button>
                        {isExpanded && (
                          <div style={s.genControls}>
                            <select
                              style={s.genSelect}
                              value={genPlatform[step.step] || PLATFORMS[0]}
                              onChange={(e) => setGenPlatform((p) => ({ ...p, [step.step]: e.target.value }))}
                            >
                              {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
                            </select>
                            <input
                              style={s.genToneInput}
                              placeholder="Tone (e.g. professional)"
                              value={genTone[step.step] || ''}
                              onChange={(e) => setGenTone((p) => ({ ...p, [step.step]: e.target.value }))}
                            />
                            <button
                              style={{ ...s.genBtn, opacity: genLoading[step.step] ? 0.65 : 1 }}
                              onClick={() => handleGenerate(step.step)}
                              disabled={genLoading[step.step]}
                            >
                              {genLoading[step.step] ? 'Writing…' : 'Write'}
                            </button>
                          </div>
                        )}
                      </div>

                      <span style={s.stepTime}>{step.estimated_duration}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Side panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={s.panel}>
            <h3 style={s.sectionTitle}>Assets</h3>
            <label style={s.uploadLabel}>
              <input type="file" style={{ display: 'none' }} accept="video/*,audio/*,image/*,.pdf,.srt"
                onChange={handleFileUpload} />
              + Attach file
            </label>
            {assets.length === 0
              ? <p style={s.emptyText}>No assets yet.</p>
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

          <div style={s.panel}>
            <h3 style={s.sectionTitle}>Quick Actions</h3>
            <div style={s.actionGrid}>
              <ActionTile title="Transcribe" desc="Whisper → SRT"
                onClick={() => assets[0] && navigate(`/transcribe/${assets[0].id}`)}
                disabled={!assets.some((a) => a.file_type === 'audio' || a.file_type === 'video')} />
              <ActionTile title="Search Stock" desc="Pixabay images"
                onClick={() => navigate(`/pixabay?job=${job.id}&q=${encodeURIComponent(job.title)}`)} />
              <ActionTile title="Canva Design" desc="Create design"
                onClick={() => navigate(`/canva/new?job=${job.id}`)} />
              <ActionTile title="Publish" desc="Beehiiv / GMB"
                onClick={() => navigate(`/publish?job=${job.id}`)} />
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
  header:      { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 },
  back:        { color: '#C89A2E', textDecoration: 'none', fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 },
  title:       { margin: '0 0 6px', fontSize: 26, fontWeight: 800, color: '#1E3D2A', letterSpacing: '-0.3px' },
  promptText:  { margin: 0, color: '#888', fontSize: 13, lineHeight: 1.5, maxWidth: 600 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 },
  statusBadge: { color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 800, textTransform: 'uppercase' },
  btn:         { padding: '10px 22px', background: '#1E3D2A', color: '#F5F0E8', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  tplBtn:      { padding: '10px 16px', background: 'transparent', color: '#888', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  tplBtnSaved: { color: '#27ae60', borderColor: '#27ae60' },
  executeError: { margin: '-16px 0 20px', color: '#c0392b', fontSize: 13, fontWeight: 600 },
  layout:      { display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, alignItems: 'start' },
  panel:       { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)', border: '1px solid #ede9e0' },
  sectionTitle:{ margin: '0 0 16px', fontSize: 13, fontWeight: 800, color: '#1E3D2A', textTransform: 'uppercase', letterSpacing: 0.8 },
  planMeta:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, color: '#C89A2E', fontWeight: 700, fontSize: 13 },
  tags:        { display: 'flex', gap: 6, flexWrap: 'wrap' },
  tag:         { background: '#F5F0E8', color: '#1E3D2A', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 },
  steps:       { display: 'flex', flexDirection: 'column', gap: 20 },
  step:        { display: 'flex', gap: 12, alignItems: 'flex-start' },
  stepNum:     { width: 26, height: 26, minWidth: 26, color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, marginTop: 2, transition: 'background 0.3s' },
  stepBody:    { flex: 1, minWidth: 0 },
  stepRow:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  stepAction:  { fontSize: 14, color: '#1E3D2A', fontWeight: 700 },
  stepBadges:  { display: 'flex', gap: 6 },
  toolBadge:   { background: '#C89A2E', color: '#fff', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 800, textTransform: 'uppercase' },
  execBadge:   { color: '#fff', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 800, textTransform: 'capitalize' },
  stepDesc:    { margin: '0 0 4px', fontSize: 13, color: '#555', lineHeight: 1.55 },
  execNote:    { margin: '4px 0', fontSize: 12, color: '#888', fontStyle: 'italic', lineHeight: 1.5, padding: '6px 10px', background: '#faf8f4', borderRadius: 4 },
  outputBox:   { background: '#f4f2ec', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#555', overflowX: 'auto', margin: '6px 0' },
  stepTime:    { fontSize: 11, color: '#bbb', display: 'block', marginTop: 8 },
  genPanel:    { marginTop: 10 },
  genToggle:   { background: 'none', border: '1px dashed #C89A2E', color: '#C89A2E', padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  genControls: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' },
  genSelect:   { padding: '7px 10px', border: '2px solid #e8e3d8', borderRadius: 6, fontSize: 13, background: '#faf9f5', outline: 'none' },
  genToneInput:{ padding: '7px 10px', border: '2px solid #e8e3d8', borderRadius: 6, fontSize: 13, background: '#faf9f5', outline: 'none', width: 160 },
  genBtn:      { padding: '7px 18px', background: '#1E3D2A', color: '#F5F0E8', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  genResult:   { background: '#fdf9f0', border: '1px solid #e8d9b0', borderRadius: 8, padding: '14px 16px', margin: '10px 0' },
  genResultHeader: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 },
  genPlatformTag: { background: '#1E3D2A', color: '#F5F0E8', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 },
  genType:     { background: '#e8d9b0', color: '#7a5c00', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 },
  genChars:    { marginLeft: 'auto', fontSize: 11, color: '#bbb' },
  genContent:  { margin: '0 0 8px', fontSize: 14, color: '#333', lineHeight: 1.65, whiteSpace: 'pre-wrap' },
  genHashtags: { margin: '0 0 4px', fontSize: 12, color: '#C89A2E', fontWeight: 600 },
  genCta:      { margin: 0, fontSize: 12, color: '#888', fontStyle: 'italic' },
  uploadLabel: { display: 'inline-block', padding: '8px 16px', background: '#1E3D2A', color: '#F5F0E8', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', marginBottom: 14 },
  emptyText:   { color: '#bbb', fontSize: 13, margin: 0 },
  assetRow:    { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid #f0ece4' },
  assetIcon:   { fontSize: 20 },
  assetName:   { margin: 0, fontSize: 12, fontWeight: 600, color: '#1E3D2A', wordBreak: 'break-all' },
  assetMeta:   { margin: '2px 0 0', fontSize: 11, color: '#aaa' },
  actionGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  actionTile:  { display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 12px', background: '#F5F0E8', border: '1px solid #e0d9cc', borderRadius: 8, textAlign: 'left' },
  actionTitle: { fontSize: 12, color: '#1E3D2A', fontWeight: 700 },
  actionDesc:  { fontSize: 11, color: '#aaa' },
}
