import { useState, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import VideoControls from './VideoControls'
import ImageControls from './ImageControls'
import TextOverlayEditor from './TextOverlayEditor'
import AudioTrackControls from './AudioTrackControls'
import MediaOverlayEditor from './MediaOverlayEditor'
import LowerThirdBuilder from './LowerThirdBuilder'
import IntroOutroBuilder from './IntroOutroBuilder'
import PlatformSwitcher from './PlatformSwitcher'
import SEOPanel from './SEOPanel'
import PublishPanel from './PublishPanel'

type EditTab = 'video' | 'image' | 'text' | 'audio' | 'media' | 'lower' | 'intro' | 'platform'

export default function RightPanel() {
  const { rightPanelTab, setRightPanelTab } = useStudio()
  const [editTab, setEditTab] = useState<EditTab>('video')

  const EDIT_TABS: { key: EditTab; label: string; icon: string }[] = [
    { key: 'video', label: 'Video', icon: '🎬' },
    { key: 'image', label: 'Image', icon: '🖼️' },
    { key: 'text', label: 'Text', icon: 'T' },
    { key: 'audio', label: 'Audio', icon: '🎵' },
    { key: 'media', label: 'Overlay', icon: '⊕' },
    { key: 'lower', label: 'Lower 3rd', icon: 'L3' },
    { key: 'intro', label: 'Intro/Outro', icon: '⏮' },
    { key: 'platform', label: 'Platform', icon: '📱' },
  ]

  return (
    <aside style={s.panel}>
      {/* Main panel tabs */}
      <div style={s.mainTabs}>
        {(['editing', 'seo', 'publish'] as const).map(t => (
          <button
            key={t}
            style={{ ...s.mainTab, ...(rightPanelTab === t ? s.mainTabActive : {}) }}
            onClick={() => setRightPanelTab(t)}
          >
            {t === 'editing' ? '⚙️ Edit' : t === 'seo' ? '🔍 SEO' : '🚀 Publish'}
          </button>
        ))}
      </div>

      <div style={s.content}>
        {/* EDITING */}
        {rightPanelTab === 'editing' && (
          <>
            {/* Sub-tabs */}
            <div style={s.editTabs}>
              {EDIT_TABS.map(t => (
                <button
                  key={t.key}
                  style={{ ...s.editTab, ...(editTab === t.key ? s.editTabActive : {}) }}
                  onClick={() => setEditTab(t.key)}
                  title={t.label}
                >
                  {t.icon}
                </button>
              ))}
            </div>

            <div style={s.editContent}>
              {editTab === 'video' && <VideoControls />}
              {editTab === 'image' && <ImageControls />}
              {editTab === 'text' && <TextOverlayEditor />}
              {editTab === 'audio' && <AudioTrackControls />}
              {editTab === 'media' && <MediaOverlayEditor />}
              {editTab === 'lower' && <LowerThirdBuilder />}
              {editTab === 'intro' && <IntroOutroBuilder />}
              {editTab === 'platform' && <PlatformSwitcher />}
            </div>
          </>
        )}

        {/* SEO */}
        {rightPanelTab === 'seo' && <SEOPanel />}

        {/* PUBLISH */}
        {rightPanelTab === 'publish' && <PublishPanel />}
      </div>
    </aside>
  )
}

const s: Record<string, CSSProperties> = {
  panel: {
    width: '25vw', minWidth: '25vw', background: '#fff', borderLeft: '1px solid #e8e3d8',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  mainTabs: {
    display: 'flex', borderBottom: '1px solid #e8e3d8',
  },
  mainTab: {
    flex: 1, padding: '10px 4px', border: 'none', background: 'transparent',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#888',
    borderBottom: '2px solid transparent', transition: 'all 0.15s',
  },
  mainTabActive: { color: '#1E3D2A', borderBottomColor: '#1E3D2A', background: '#fafaf8' },

  content: { flex: 1, overflowY: 'auto' },

  editTabs: {
    display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 10px',
    borderBottom: '1px solid #e8e3d8',
  },
  editTab: {
    width: 36, height: 32, border: '1px solid #ddd', borderRadius: 6,
    background: '#fff', fontSize: 12, cursor: 'pointer', color: '#555',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  editTabActive: { background: '#1E3D2A', color: '#F5F0E8', borderColor: '#1E3D2A' },

  editContent: { padding: '12px 12px' },
}
