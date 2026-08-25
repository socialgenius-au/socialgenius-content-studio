import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import './PostCreatorV2.css'
import BriefTab from './tabs/BriefTab'
import IntelligenceTab from './tabs/IntelligenceTab'
import ReferencesTab from './tabs/ReferencesTab'
import CreateTab from './tabs/CreateTab'
import ReviewTab from './tabs/ReviewTab'

export type ThemeMode = 'light' | 'dark'
export type Stage = 'brief' | 'intelligence' | 'references' | 'create' | 'review'

const STAGES: { id: Stage; num: number; label: string }[] = [
  { id: 'brief', num: 1, label: 'Brief' },
  { id: 'intelligence', num: 2, label: 'Intelligence' },
  { id: 'references', num: 3, label: 'References' },
  { id: 'create', num: 4, label: 'Create' },
  { id: 'review', num: 5, label: 'Review' },
]

const THEME_KEY = 'sg-post-creator-v2-theme'

export default function PostCreatorV2() {
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [stage, setStage] = useState<Stage>('brief')

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') setTheme(saved)
  }, [])

  const setThemeAndPersist = (mode: ThemeMode) => {
    setTheme(mode)
    window.localStorage.setItem(THEME_KEY, mode)
  }

  const stageIndex = STAGES.findIndex((s) => s.id === stage)
  const goTo = (s: Stage) => setStage(s)
  const goNext = () => {
    const next = STAGES[stageIndex + 1]
    if (next) setStage(next.id)
  }
  const goBack = () => {
    const prev = STAGES[stageIndex - 1]
    if (prev) setStage(prev.id)
  }

  return (
    <div className="pcv2" data-theme={theme}>
      <header className="pcv2-header">
        <a className="pcv2-brand" href="/dashboard">
          <span className="pcv2-brand-badge">
            <Sparkles size={16} />
          </span>
          <span className="pcv2-brand-name">SocialGenius</span>
        </a>

        <div className="pcv2-titles">
          <div className="pcv2-title">POST CREATOR — From Brief to High-Performing Post</div>
          <div className="pcv2-subtitle">AI-Powered. Brand-Aligned. Fully Editable.</div>
        </div>

        <nav className="pcv2-stepper" aria-label="Post Creator workflow">
          {STAGES.map((s, i) => (
            <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {i > 0 && <span className="pcv2-step-arrow">→</span>}
              <button
                type="button"
                className={`pcv2-step ${stage === s.id ? 'is-active' : ''} ${i < stageIndex ? 'is-done' : ''}`}
                onClick={() => goTo(s.id)}
              >
                <span className="pcv2-step-num">{s.num}</span>
                {s.label.toUpperCase()}
              </button>
            </span>
          ))}
        </nav>

        <div className="pcv2-theme-toggle" role="group" aria-label="Theme">
          <button
            type="button"
            className={theme === 'light' ? 'is-active' : ''}
            onClick={() => setThemeAndPersist('light')}
          >
            Light
          </button>
          <button
            type="button"
            className={`pcv2-theme-knob ${theme === 'dark' ? 'is-dark' : ''}`}
            aria-label="Toggle theme"
            onClick={() => setThemeAndPersist(theme === 'light' ? 'dark' : 'light')}
          />
          <button
            type="button"
            className={theme === 'dark' ? 'is-active' : ''}
            onClick={() => setThemeAndPersist('dark')}
          >
            Dark
          </button>
        </div>
      </header>

      <div className="pcv2-body">
        {stage === 'brief' && <BriefTab onNext={goNext} />}
        {stage === 'intelligence' && <IntelligenceTab onNext={goNext} onBack={goBack} />}
        {stage === 'references' && <ReferencesTab onNext={goNext} onBack={goBack} />}
        {stage === 'create' && <CreateTab onNext={goNext} onBack={goBack} />}
        {stage === 'review' && <ReviewTab onBack={goBack} />}
      </div>
    </div>
  )
}
