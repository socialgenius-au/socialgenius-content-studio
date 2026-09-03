
import React, { useState } from "react";
import { reviewCriteria } from "../data/videoStudioMock";
import { useStudio } from "../../../contexts/StudioContext";
import { fitCanvasBox } from "../data/canvasFormats";
import { findActiveClip } from "../../../components/studio/videoPreviewUtils";
import { videoExportApi } from "../../../api/client";

const PLATFORMS = [
  { key: "instagram", glyph: "◎", label: "Instagram" },
  { key: "facebook", glyph: "f", label: "Facebook" },
  { key: "tiktok", glyph: "♪", label: "TikTok" },
  { key: "youtube", glyph: "▶", label: "YouTube" },
  { key: "linkedin", glyph: "in", label: "LinkedIn" },
];

const RECOMMENDATIONS = [
  "Great hook! Strong attention in the first 2 seconds.",
  "Message is clear and benefit-focused.",
  "Add urgency in CTA: “Visit today” or “Stock limited”.",
  "Try bolder text on key message for mobile view.",
  "Consider adding customer testimonial in scene 4.",
];

export default function ReviewTab({ onNext, onBack }: { onNext?: () => void; onBack?: () => void }) {
  const { canvasFormat, videoClips, textOverlays, mediaOverlays, audioTracks, timeline } = useStudio();
  const activeClip = findActiveClip(videoClips, timeline.currentTime);
  const hasRealSrc = !!activeClip?.url;
  // Same fit-not-stretch box used in Create/Edit, sized for Review's preview card instead.
  const canvasBox = fitCanvasBox(canvasFormat.width, canvasFormat.height, 300, 420);

  const [notes, setNotes] = useState("");
  const [applied, setApplied] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>(["instagram", "facebook", "tiktok"]);
  const [date, setDate] = useState("2026-08-20");
  const [time, setTime] = useState("10:00");
  const [activeThumb, setActiveThumb] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const togglePlatform = (key: string) =>
    setPlatforms(p => (p.includes(key) ? p.filter(x => x !== key) : [...p, key]));

  const flash = (msg: string) => { setStatus(msg); setTimeout(() => setStatus(null), 2000); };

  // STEP 7.15F: real export/render. "Export Video" previously just called flash("Video
  // exported.") with zero actual rendering — see the backend report for the root cause
  // (ffmpeg was never actually installed in this environment, so no ffmpeg_svc.py function
  // could ever have worked here regardless of what the button did).
  const [exportState, setExportState] = useState<"idle" | "exporting" | "error">("idle");
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportVideo = async () => {
    const clipsWithoutAsset = videoClips.filter(c => c.assetId == null);
    if (videoClips.length === 0) {
      setExportState("error");
      setExportError("Add at least one video clip in Create/Edit before exporting.");
      return;
    }
    if (clipsWithoutAsset.length > 0) {
      setExportState("error");
      setExportError("One or more clips have no uploaded source video and can't be rendered yet.");
      return;
    }

    setExportState("exporting");
    setExportError(null);
    try {
      const body = {
        canvas_width: canvasFormat.width,
        canvas_height: canvasFormat.height,
        video_clips: videoClips.map(c => ({
          asset_id: c.assetId,
          start_time: c.startTime, end_time: c.endTime, trim_in: c.trimIn,
          speed: c.speed, color_grade: c.colorGrade,
          brightness: c.brightness, contrast: c.contrast, saturation: c.saturation,
          transition: c.transition, transition_duration: c.transitionDuration,
          // Step 7 (Original Video Audio controls): this clip's own embedded-audio on/off +
          // volume — independent of A1, other clips, and overlay audio.
          muted: c.muted ?? false, volume: c.volume ?? 1,
          // STEP 7 (Platform Canvas / Full-Screen Video Acceptance): this clip's own Fit/Fill +
          // crop position, exactly as its live preview rendered it — the backend default
          // ("fit"/50/50) matches this same fallback, so a clip saved before this feature
          // existed sends the same values either way.
          fit_mode: c.fitMode ?? "fit", crop_x: c.cropOffsetX ?? 50, crop_y: c.cropOffsetY ?? 50,
        })),
        text_overlays: textOverlays.map(t => ({
          text: t.text, start_time: t.startTime, end_time: t.endTime,
          x: t.x, y: t.y, font_size: t.fontSize, color: t.color, order: t.order ?? 0,
        })),
        media_overlays: mediaOverlays.map(o => ({
          asset_id: o.assetId, start_time: o.startTime, end_time: o.endTime,
          x: o.x, y: o.y, width: o.width, height: o.height, opacity: o.opacity, order: o.order ?? 0,
          // STEP 7.15H: a video-backed overlay's own audio was never sent to the backend at
          // all, so it could never have been mixed into the export regardless of what the
          // renderer did with it — this is the other half of that fix.
          muted: o.muted ?? false, volume: o.volume ?? 1,
        })),
        audio_tracks: audioTracks
          .filter(a => a.assetId != null)
          .map(a => ({
            asset_id: a.assetId, start_time: a.startTime, end_time: a.endTime,
            trim_in: a.trimIn, volume: a.volume,
          })),
      };

      const { data } = await videoExportApi.exportProject(body);
      const blob = data as Blob;
      // Real browser download — same createObjectURL + <a download> + click pattern
      // AssetLibrary.tsx's own handleDownload/handleZip already use for real file downloads.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "video-studio-export.mp4";
      link.click();
      URL.revokeObjectURL(url);

      setExportState("idle");
      flash("Video exported — check your downloads.");
    } catch (err) {
      setExportState("error");
      // responseType:'blob' means even a JSON error body arrives as a Blob — read it back to
      // surface the real backend error message instead of a generic one.
      const resp = (err as { response?: { data?: unknown } })?.response;
      let detail = "Export failed — please try again.";
      if (resp?.data instanceof Blob) {
        try {
          const text = await resp.data.text();
          const parsed = JSON.parse(text) as { detail?: string };
          if (parsed.detail) detail = parsed.detail;
        } catch { /* keep the generic message */ }
      }
      setExportError(detail);
    }
  };

  return (
    <div className="stage-page review-page">
      <h2>Review your video and optimize for maximum impact.</h2>
      <div className="review-grid">
        <section className="card quality">
          <h3>AI Quality Score</h3>
          <div className="ring-score large"><b>92</b><span>/100</span><small>Excellent</small></div>
          {reviewCriteria.map(([a, b]) => (
            <div className="criteria" key={a}><span>✓ {a}</span><b>{b}/10</b></div>
          ))}
        </section>

        <section className="card review-preview">
          <h3>Video Preview</h3>
          {hasRealSrc ? (
            <div className="video-preview review real" style={{ width: canvasBox.w, height: canvasBox.h }}>
              <video src={activeClip!.url} className="real-video-el" playsInline controls />
            </div>
          ) : (
            <div className="video-preview review" style={{ width: canvasBox.w, height: canvasBox.h }}>
              <div className="preview-copy">WHY BUILDERS<br />CHOOSE US<br /><strong>EVERY TIME</strong></div>
              <div className="preview-badge">STOCK • SERVICE • SOLUTIONS</div>
            </div>
          )}
          <div className="canvas-dims">{canvasFormat.label} — {canvasFormat.width}×{canvasFormat.height} ({canvasFormat.ratio})</div>
          <div className="review-transport">▶ 00:05 / 0:15 🔊 ⛶</div>
          <div className="story-strip">
            {[1, 2, 3, 4, 5].map((x, i) => (
              <div className={`story-thumb ${activeThumb === i ? "active" : ""}`} key={x} onClick={() => setActiveThumb(i)} />
            ))}
          </div>
        </section>

        <section className="mid-stack">
          <section className="card">
            <h3>AI Recommendations</h3>
            <ul className={`check-list ${applied ? "applied" : ""}`}>
              {RECOMMENDATIONS.map(r => <li key={r}>{r}</li>)}
            </ul>
            <button className="secondary wide" type="button" onClick={() => setApplied(true)}>
              {applied ? "✓ Suggestions Applied" : "Apply All Suggestions"}
            </button>
          </section>
          <section className="card">
            <h3>Publishing Options</h3>
            <p>Select Platforms</p>
            <div className="platform-pills big">
              {PLATFORMS.map(p => (
                <button key={p.key} className={platforms.includes(p.key) ? "active" : ""} type="button" onClick={() => togglePlatform(p.key)}>
                  {p.glyph}<small>{p.label}</small>
                </button>
              ))}
            </div>
            <div className="row">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
              <input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </section>
        </section>

        <aside className="right-stack">
          <section className="card">
            <h3>Content Scorecard</h3>
            <div className="ring-score"><b>86</b><span>/100</span><small>Very Good</small></div>
            {[["Clarity", 8.5], ["Relevance", 8.5], ["Engagement", 8.5], ["Emotional Pull", 8], ["Shareability", 8.5], ["Brand Fit", 9], ["CTA Strength", 8], ["Overall Impact", 8.5]].map(([a, b]) => (
              <div className="score-line" key={a as string}><span>{a}</span><b>{b}/10</b><i><u style={{ width: `${Number(b) * 10}%` }} /></i></div>
            ))}
          </section>
          <section className="card">
            <h3>Review Notes</h3>
            <textarea
              placeholder="Add your notes or feedback..."
              value={notes}
              maxLength={500}
              onChange={e => setNotes(e.target.value)}
            />
            <span className="char-count">{notes.length}/500</span>
          </section>
        </aside>
      </div>

      {status && <div className="inline-status">{status}</div>}
      {exportState === "error" && exportError && (
        <div className="inline-status error">{exportError}</div>
      )}

      <div className="stage-footer triple">
        <button className="secondary" onClick={onBack} type="button">← Back: Create / Edit</button>
        <div>
          <button
            className="secondary" type="button"
            onClick={() => void handleExportVideo()}
            disabled={exportState === "exporting"}
          >
            {exportState === "exporting" ? "Exporting…" : "Export Video ↓"}
          </button>
          <button className="secondary" type="button" onClick={() => flash("Draft saved.")}>Save as Draft</button>
        </div>
        <button className="primary" onClick={onNext} type="button">Next: Learn →</button>
      </div>
    </div>
  );
}
