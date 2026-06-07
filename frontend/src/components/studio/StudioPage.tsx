import { useEffect, type CSSProperties } from 'react'
import { StudioProvider } from '../../contexts/StudioContext'
import TopBar from './TopBar'
import LeftPanel from './LeftPanel'
import PreviewCanvas from './PreviewCanvas'
import RightPanel from './RightPanel'
import ChatBar from './ChatBar'
import ContentTypeSwitcher from './ContentTypeSwitcher'

function StudioLayout() {
  // Inject typing animation CSS
  useEffect(() => {
    const id = 'studio-anim'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      @keyframes bounce {
        0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
        40% { transform: translateY(-6px); opacity: 1; }
      }
      .studio-typing-dot { animation: bounce 1.2s infinite; }
      .studio-typing-dot:nth-child(2) { animation-delay: 0.2s; }
      .studio-typing-dot:nth-child(3) { animation-delay: 0.4s; }
    `
    document.head.appendChild(style)
    return () => { document.getElementById(id)?.remove() }
  }, [])

  return (
    <div style={s.root}>
      <TopBar />

      {/* Content type switcher */}
      <ContentTypeSwitcher />

      {/* Main 3-column layout */}
      <div style={s.workspace}>
        <LeftPanel />
        <PreviewCanvas />
        <RightPanel />
      </div>

      {/* Chat bar at bottom */}
      <ChatBar />
    </div>
  )
}

export default function StudioPage() {
  return (
    <StudioProvider>
      <StudioLayout />
    </StudioProvider>
  )
}

const s: Record<string, CSSProperties> = {
  root: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#111',
    overflow: 'hidden',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  },
  workspace: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    minHeight: 0,
  },
}
