import { useEffect, type CSSProperties } from 'react'
import { StudioProvider } from '../../contexts/StudioContext'
import { ThemeProvider } from '../../contexts/ThemeContext'
import TopBar from './TopBar'
import IconRail from './IconRail'
import ToolPanel from './ToolPanel'
import PreviewCanvas from './PreviewCanvas'
import PropertiesPanel from './PropertiesPanel'
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

      {/* Icon-rail + expandable tool panel + canvas + contextual properties panel */}
      <div style={s.workspace}>
        <IconRail />
        <ToolPanel />
        <PreviewCanvas />
        <PropertiesPanel />
      </div>

      {/* Chat bar at bottom — unchanged, core product differentiator */}
      <ChatBar />
    </div>
  )
}

export default function StudioPage() {
  return (
    <ThemeProvider>
      <StudioProvider>
        <StudioLayout />
      </StudioProvider>
    </ThemeProvider>
  )
}

const s: Record<string, CSSProperties> = {
  root: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--canvas-bg)',
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
