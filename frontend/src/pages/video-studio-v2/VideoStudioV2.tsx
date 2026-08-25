
import React, { useEffect, useState } from "react";
import "./VideoStudioV2.css";
import { workflow, WorkflowStage, ThemeMode } from "./data/videoStudioMock";
import BriefTab from "./components/BriefTab";
import IntelligenceTab from "./components/IntelligenceTab";
import CreativeLabTab from "./components/CreativeLabTab";
import CreateEditTab from "./components/CreateEditTab";
import ReviewTab from "./components/ReviewTab";
import LearnTab from "./components/LearnTab";

const stageComponent: Record<WorkflowStage, React.ComponentType<{ onNext?: () => void; onBack?: () => void }>> = {
  brief: BriefTab,
  intelligence: IntelligenceTab,
  creative: CreativeLabTab,
  create: CreateEditTab,
  review: ReviewTab,
  learn: LearnTab,
};

export default function VideoStudioV2() {
  const [stage, setStage] = useState<WorkflowStage>("brief");
  const [theme, setTheme] = useState<ThemeMode>("light");

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
          {workflow.map(item => (
            <button key={item.id} className={stage === item.id ? "active" : ""} onClick={() => setStage(item.id)}>
              <span className="iconDot">{item.number}</span>{item.label === "CREATE / EDIT" ? "Create / Edit" : item.label[0] + item.label.slice(1).toLowerCase()}
            </button>
          ))}
          <div className="nav-sep" />
          <button><span>▣</span>Library</button>
          <button><span>✦</span>Brand Kit</button>
          <button><span>⚙</span>Settings</button>
        </nav>

        <div className="vsv2-project-card">
          <small>Current Project</small>
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
            <button className={theme === "light" ? "active" : ""} onClick={() => switchTheme("light")}>Light ☀</button>
            <button className={theme === "dark" ? "active" : ""} onClick={() => switchTheme("dark")}>☾ Dark</button>
          </div>
        </header>

        <div className="vsv2-stepper">
          {workflow.map((item, idx) => (
            <React.Fragment key={item.id}>
              <button className={stage === item.id ? "active" : ""} onClick={() => setStage(item.id)}>
                <span>{item.number}</span>{item.label}
              </button>
              {idx < workflow.length - 1 && <i>→</i>}
            </React.Fragment>
          ))}
        </div>

        <section className="vsv2-workspace">
          <Current onNext={goNext} onBack={goBack} />
        </section>
      </main>
    </div>
  );
}
