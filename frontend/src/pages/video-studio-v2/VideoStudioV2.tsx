
import React, { useEffect, useRef, useState } from "react";
import {
  FileText, LayoutGrid, PenSquare, Clock, MonitorPlay,
  FolderOpen, Palette, Settings as SettingsIcon,
  Sun, Moon, FileStack, type LucideIcon,
} from "lucide-react";
import "./VideoStudioV2.css";
import { StudioProvider, useStudio, type CanvasFormatState, type CanvasItemPosition } from "../../contexts/StudioContext";
import type { VideoClip, TextOverlay, MediaOverlay, AudioTrack, Asset } from "../../types";
import { workflow, WorkflowStage, ThemeMode } from "./data/videoStudioMock";
import BriefTab from "./components/BriefTab";
import IntelligenceTab from "./components/IntelligenceTab";
import CreativeLabTab from "./components/CreativeLabTab";
import CreateEditTab from "./components/CreateEditTab";
import ReviewTab from "./components/ReviewTab";
import LearnTab from "./components/LearnTab";

// Step 7.1 (second persistence defect): the active workflow stage and the entire project
// (video/audio/text/overlays/timeline positions/canvas format/placeholder positions) were pure
// in-memory React state with nowhere to survive a refresh — StudioContext was always
// deliberately "no persistence" (every prior step's own notes say so), and `stage` here was a
// plain useState with no storage at all. Same localStorage convention this file's own theme
// persistence already uses (`sg-video-studio-theme`), just two more keys.
const STAGE_STORAGE_KEY = "sg-video-studio-v2-stage";
const PROJECT_STORAGE_KEY = "sg-video-studio-v2-project";

interface PersistedProject {
  videoClips: VideoClip[];
  textOverlays: TextOverlay[];
  mediaOverlays: MediaOverlay[];
  audioTracks: AudioTrack[];
  mediaAssets: Asset[];
  canvasFormat: CanvasFormatState;
  timeline: ReturnType<typeof useStudio>["timeline"];
  canvasItemPositions: Record<string, CanvasItemPosition>;
}

// Mounted as a child of <StudioProvider> purely for its useStudio() access — renders nothing.
// Restores once on mount (via the SAME existing add*/set* actions every other feature already
// uses — no bulk-replace action added to the shared StudioContext, so this can't affect legacy
// /studio, which mounts its own separate StudioProvider instance and never reads this key), then
// re-saves the whole snapshot whenever any of it changes.
function ProjectPersistence() {
  const {
    videoClips, addVideoClip,
    textOverlays, addTextOverlay,
    mediaOverlays, addMediaOverlay,
    audioTracks, addAudioTrack,
    mediaAssets, addMediaAsset,
    canvasFormat, setCanvasFormat,
    timeline, setTimeline,
    canvasItemPositions, setCanvasItemPosition,
  } = useStudio();

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Partial<PersistedProject>;
      (saved.videoClips ?? []).forEach(c => addVideoClip(c));
      (saved.textOverlays ?? []).forEach(t => addTextOverlay(t));
      (saved.mediaOverlays ?? []).forEach(o => addMediaOverlay(o));
      (saved.audioTracks ?? []).forEach(a => addAudioTrack(a));
      (saved.mediaAssets ?? []).forEach(a => addMediaAsset(a));
      if (saved.canvasFormat) setCanvasFormat(saved.canvasFormat);
      if (saved.timeline) setTimeline(saved.timeline);
      Object.entries(saved.canvasItemPositions ?? {}).forEach(([id, pos]) => setCanvasItemPosition(id, pos));
    } catch {
      // Corrupted or old-shape data (e.g. from an earlier version of this fix) — start the
      // project fresh rather than crash the whole editor on a bad localStorage value.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const snapshot: PersistedProject = {
      videoClips, textOverlays, mediaOverlays, audioTracks, mediaAssets,
      canvasFormat, timeline, canvasItemPositions,
    };
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(snapshot));
  }, [videoClips, textOverlays, mediaOverlays, audioTracks, mediaAssets, canvasFormat, timeline, canvasItemPositions]);

  return null;
}

const stageComponent: Record<WorkflowStage, React.ComponentType<{ onNext?: () => void; onBack?: () => void }>> = {
  brief: BriefTab,
  intelligence: IntelligenceTab,
  creative: CreativeLabTab,
  create: CreateEditTab,
  review: ReviewTab,
  learn: LearnTab,
};

const stageIcon: Record<WorkflowStage, LucideIcon> = {
  brief: FileText,
  intelligence: LayoutGrid,
  creative: LayoutGrid,
  create: PenSquare,
  review: Clock,
  learn: MonitorPlay,
};

const stageNavLabel: Record<WorkflowStage, string> = {
  brief: "Brief",
  intelligence: "Intelligence",
  creative: "Creative Lab",
  create: "Create / Edit",
  review: "Review",
  learn: "Learn",
};

function isWorkflowStage(v: string | null): v is WorkflowStage {
  return !!v && workflow.some(w => w.id === v);
}

export default function VideoStudioV2() {
  // Restored synchronously from the initializer (not a post-mount effect, unlike theme) so the
  // very first render already lands on the right stage instead of flashing "Brief" first —
  // requirement #5 explicitly forbids hard-coding Create/Edit (or any stage) as the default, so
  // this only ever falls back to "brief" when nothing was ever saved.
  const [stage, setStageState] = useState<WorkflowStage>(() => {
    const saved = localStorage.getItem(STAGE_STORAGE_KEY);
    return isWorkflowStage(saved) ? saved : "brief";
  });
  const [theme, setTheme] = useState<ThemeMode>("light");

  const setStage = (next: WorkflowStage) => {
    setStageState(next);
    localStorage.setItem(STAGE_STORAGE_KEY, next);
  };

  useEffect(() => {
    const saved = localStorage.getItem("sg-video-studio-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  const switchTheme = (next: ThemeMode) => {
    setTheme(next);
    localStorage.setItem("sg-video-studio-theme", next);
  };

  const currentIndex = workflow.findIndex(x => x.id === stage);
  const Current = stageComponent[stage];

  const goNext = () => {
    if (currentIndex < workflow.length - 1) setStage(workflow[currentIndex + 1].id);
  };
  const goBack = () => {
    if (currentIndex > 0) setStage(workflow[currentIndex - 1].id);
  };

  return (
    <StudioProvider>
    <ProjectPersistence />
    <div className={`vsv2 ${theme === "dark" ? "vsv2--dark" : "vsv2--light"}`}>
      <aside className="vsv2-sidebar">
        <div className="vsv2-brand">
          <div className="vsv2-brandmark">▶</div>
          <div>
            <strong>Video Studio</strong>
            <span>From Brief to High-Performing Video</span>
          </div>
        </div>

        <nav className="vsv2-side-nav">
          {workflow.map(item => {
            const Icon = stageIcon[item.id];
            return (
              <button key={item.id} className={stage === item.id ? "active" : ""} onClick={() => setStage(item.id)}>
                <Icon size={17} />{stageNavLabel[item.id]}
              </button>
            );
          })}
          <div className="nav-sep" />
          <button><FileStack size={17} />Library</button>
          <button><Palette size={17} />Brand Kit</button>
          <button><SettingsIcon size={17} />Settings</button>
        </nav>

        <div className="vsv2-project-card">
          <div className="pc-head"><FolderOpen size={15} /><span>Current Project</span></div>
          <strong>ABC Tiles</strong>
          <span>Builders Footfall Campaign</span>
          <button>Change Project</button>
        </div>
      </aside>

      <main className="vsv2-main">
        <header className="vsv2-header">
          <div className="vsv2-title">
            <span className="vsv2-title-num">{workflow[currentIndex].number}.</span>
            <strong>{workflow[currentIndex].label}</strong>
          </div>

          <div className="vsv2-theme">
            <button className={theme === "light" ? "active" : ""} onClick={() => switchTheme("light")}><Sun size={14} />Light</button>
            <button className={theme === "dark" ? "active" : ""} onClick={() => switchTheme("dark")}><Moon size={14} />Dark</button>
          </div>
        </header>

        <div className="vsv2-stepper">
          {workflow.map((item, idx) => (
            <React.Fragment key={item.id}>
              <button className={stage === item.id ? "active" : ""} onClick={() => setStage(item.id)}>
                <span>{item.number}</span>{item.label}
              </button>
              {idx < workflow.length - 1 && <i className={idx === currentIndex ? "done" : ""}>→</i>}
            </React.Fragment>
          ))}
        </div>

        <section className="vsv2-workspace">
          <Current onNext={goNext} onBack={goBack} />
        </section>
      </main>
    </div>
    </StudioProvider>
  );
}
