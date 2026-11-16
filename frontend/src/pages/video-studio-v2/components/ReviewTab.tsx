
import React, { useEffect, useState } from "react";
import { assessProject } from "../learn/assessment";
import { buildRecommendations } from "../learn/recommendations";
import { useStudio } from "../../../contexts/StudioContext";
import { fitCanvasBox } from "../data/canvasFormats";
import { findActiveClip } from "../../../components/studio/videoPreviewUtils";
import { videoExportApi } from "../../../api/client";
import { checkReconstructionExport } from "../blueprint/exportGuard";
import { useBlueprintPlan } from "../blueprint/blueprintPlanStore";
import { buildExportTextOverlays } from "../export/textOverlayExport";
import { validCanvasBackground } from "../export/canvasBackground";
import { validCanvasBackdrop } from "../export/canvasBackdrop";
import { buildExportInserts, buildExportLowerThirds, buildExportShapes, buildExportSubtitles, buildExportSubtitleStyle, exportNotices, missingInsertSources } from "../export/layerExport";

export default function ReviewTab({ onNext, onBack }: { onNext?: () => void; onBack?: () => void }) {
  const { canvasFormat, videoClips, additionalVideoClips, textOverlays, mediaOverlays, shapes, lowerThirds, subtitles, subtitleStyle, audioTracks, timeline } = useStudio();
  const activeClip = findActiveClip(videoClips, timeline.currentTime);
  const hasRealSrc = !!activeClip?.url;
  // Same fit-not-stretch box used in Create/Edit, sized for Review's preview card instead.
  const canvasBox = fitCanvasBox(canvasFormat.width, canvasFormat.height, 300, 420);

  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const flash = (msg: string, ms = 2000) => { setStatus(msg); setTimeout(() => setStatus(null), ms); };

  // STEP 7.15F: real export/render. "Export Video" previously just called flash("Video
  // exported.") with zero actual rendering — see the backend report for the root cause
  // (ffmpeg was never actually installed in this environment, so no ffmpeg_svc.py function
  // could ever have worked here regardless of what the button did).
  const [exportState, setExportState] = useState<"idle" | "exporting" | "error">("idle");
  // Opt-in (default: the exporter's existing behaviour). Applies to the next export only; it is not saved in the draft.
  const [edgePolicy, setEdgePolicy] = useState<"shorten" | "hold_incoming">("shorten");
  const [exportError, setExportError] = useState<string | null>(null);
  const blueprintPlan = useBlueprintPlan();                                  // null unless this project came from a blueprint
  const [exportSeconds, setExportSeconds] = useState(0);
  const assessment = assessProject({
    canvas: { width: canvasFormat.width, height: canvasFormat.height },
    clips: videoClips.map(c => ({ startTime: c.startTime, endTime: c.endTime, assetId: c.assetId ?? null, muted: c.muted })),
    texts: textOverlays.map(t => ({ text: t.text, startTime: t.startTime, endTime: t.endTime, fontSize: t.fontSize, color: t.color, bgColor: t.bgColor, bgOpacity: t.bgOpacity })),
    audioTrackCount: audioTracks.length, plan: blueprintPlan,
  });
  const recommendations = buildRecommendations(assessment);
  // Group only identical scene-specific recommendations; preserve distinct advice and caveats.
  const groupedRecommendations = recommendations.reduce<Array<{ key: string; basis: string; text: string; caveat: string; scenes: number[] }>>((groups, recommendation) => {
    const match = recommendation.text.match(/\bscene\s+(\d+)\b/i);
    const scene = match ? Number(match[1]) : null;
    const normalized = scene == null ? recommendation.text : recommendation.text.replace(/\bscene\s+\d+\b/gi, "the affected scene");
    const group = scene == null ? undefined : groups.find(item => item.text === normalized && item.basis === recommendation.basis && item.caveat === recommendation.caveat);
    if (group && scene != null) {
      if (!group.scenes.includes(scene)) group.scenes.push(scene);
    } else {
      groups.push({ key: recommendation.key, basis: recommendation.basis, text: normalized, caveat: recommendation.caveat, scenes: scene == null ? [] : [scene] });
    }
    return groups;
  }, []);
  const readiness = checkReconstructionExport(textOverlays, videoClips, blueprintPlan?.scenes ?? []);
  const missingAssets = videoClips.filter(c => c.assetId == null).length;
  const missingInserts = missingInsertSources(additionalVideoClips);
  const canExport = videoClips.length > 0 && missingAssets === 0 && missingInserts === 0 && readiness.ok;
  useEffect(() => {
    if (exportState !== "exporting") return;
    setExportSeconds(0);
    const t = window.setInterval(() => setExportSeconds(n => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [exportState]);

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
    if (missingInsertSources(additionalVideoClips) > 0) {
      setExportState("error");
      setExportError("One or more B-roll clips have no uploaded source video and can't be rendered yet.");
      return;
    }
    // M1 (Reconstructor): a reconstruction project must not export placeholder wording, and its clips must not leave gaps the exporter would silently collapse.
    // Projects that did not come from a blueprint are never affected (the check returns ok before looking at them).
    const blocked = checkReconstructionExport(textOverlays, videoClips, blueprintPlan?.scenes ?? []);
    if (!blocked.ok) {
      setExportState("error");
      setExportError(blocked.message);
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
        // M2.1b: every text property the exporter supports (width/wrapping, alignment, bold/underline/spacing, opacity, stroke, shadow, gradient, background chip),
        // not just the first seven. See export/textOverlayExport.ts for the field-by-field mapping.
        text_overlays: buildExportTextOverlays(textOverlays),
        // M2.2b: shapes and lower thirds the editor draws were never sent, so they were missing from every MP4. Each carries the shared `order` the export now stacks by.
        shapes: buildExportShapes(shapes),
        lower_thirds: buildExportLowerThirds(lowerThirds),
        // M2.2b: V2 inserts / B-roll and subtitles were drawn in the editor but never sent either.
        additional_video_clips: buildExportInserts(additionalVideoClips),
        subtitles: buildExportSubtitles(subtitles),
        subtitle_style: buildExportSubtitleStyle(subtitleStyle),
        ...(validCanvasBackground(canvasFormat.background) ? { canvas_background: validCanvasBackground(canvasFormat.background) } : {}),
        transition_edge_policy: edgePolicy,
        ...(validCanvasBackdrop(canvasFormat.backdrop) ? { canvas_backdrop: validCanvasBackdrop(canvasFormat.backdrop) } : {}),
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
      const notices = exportNotices({ inserts: additionalVideoClips });
      flash(notices.length ? `Video exported — check your downloads. Note: ${notices.join(" ")}` : "Video exported — check your downloads.", notices.length ? 12000 : 2000);
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
      <div className="review-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", alignItems: "start", gap: 16 }}>
        <section className="card quality" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <h3>Production Readiness — Measured Checks</h3>
          <p><strong>{canExport ? "Ready for export checks" : "Not ready to export"}</strong></p>
          <p>No AI quality or audience performance score is available. These checks use this project's actual timeline and export safeguards.</p>
          <ul><li>{videoClips.length} timeline clips; {missingAssets} missing source assets</li><li>{missingInserts} B-roll inserts without sources</li><li>{textOverlays.length} text overlays; {audioTracks.length} separate audio tracks</li><li>{readiness.ok ? "Reconstruction export checks passed" : readiness.message}</li></ul>
          <h4>Project observations</h4>
          {assessment.findings.map(f => <div className="criteria" key={f.id} style={{ display: "block", overflowWrap: "anywhere", marginBottom: 12 }}><strong>{f.title} ({f.kind})</strong><p>{f.finding}</p><small>{f.reasoning}</small></div>)}
        </section>
        <section className="card review-preview" style={{ minWidth: 0 }}>
          <h3>Video Preview</h3>
          {hasRealSrc ? (
            <div className="video-preview review real" style={{ width: canvasBox.w, height: canvasBox.h }}>
              <video src={activeClip!.url} className="real-video-el" playsInline controls />
            </div>
          ) : (
            <div className="video-preview review" style={{ width: canvasBox.w, height: canvasBox.h }}>
              <div className="preview-copy">No source clip at this playhead. Open Create / Edit to inspect the timeline.</div>
            </div>
          )}
          <div className="canvas-dims">{canvasFormat.label} — {canvasFormat.width}×{canvasFormat.height} ({canvasFormat.ratio})</div>
          <p>This preview shows the current source clip, not a rendered composite. Export the MP4 to inspect final overlays and audio.</p>
        </section>

        <section className="mid-stack" style={{ minWidth: 0 }}>
          <section className="card">
            <h3>Recommendations — Not Performance Predictions</h3>
            {groupedRecommendations.length ? <ul className="check-list">{groupedRecommendations.map(r => <li key={r.key}><strong>{r.basis === "evidence" ? "Production observation" : "Hypothesis to test"}:</strong> {r.text}{r.scenes.length > 0 && <span> (Scene{r.scenes.length > 1 ? "s" : ""} {r.scenes.sort((a, b) => a - b).join(", ")})</span>}<p><small>{r.caveat}</small></p></li>)}</ul> : <p>No specific recommendations from the available checks.</p>}
            <p>Suggestions are advisory; nothing is automatically applied. Make changes in Create / Edit.</p>
          </section>
          <section className="card"><h3>Publishing</h3><p>Social publishing and scheduling are not connected here. Export the video to publish through your chosen platform.</p></section>
        </section>
        <aside className="right-stack" style={{ minWidth: 0 }}>
          <section className="card"><h3>Not yet measured</h3><p>Viewer retention, engagement, conversion, emotional impact and brand fit have not been measured. No numerical scores are shown.</p></section>
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
      {exportState === "exporting" && (
        <div className="inline-status" role="status" data-testid="export-progress">
          Rendering your video… {Math.floor(exportSeconds / 60)}:{String(exportSeconds % 60).padStart(2, "0")} elapsed.
          {" "}It is built on the server and the download starts by itself when it is ready — keep this page open. Long or high-resolution videos can take several minutes.
        </div>
      )}
      {exportState === "error" && exportError && (
        <div className="inline-status error">{exportError}</div>
      )}

      {videoClips.some(c => c.transition === "dissolve") && (
        <label className="stack-field" data-testid="edge-policy">
          <span>Dissolves where a clip has no spare footage</span>
          <select value={edgePolicy} onChange={e => setEdgePolicy(e.target.value as "shorten" | "hold_incoming")}>
            <option value="shorten">Shorten the dissolve (default)</option>
            <option value="hold_incoming">Hold the incoming clip’s first frame while it fades in</option>
          </select>
        </label>
      )}

      <div className="stage-footer triple">
        <button className="secondary" onClick={onBack} type="button">← Back: Create / Edit</button>
        <div>
          <button
            className="secondary" type="button"
            onClick={() => void handleExportVideo()}
            disabled={exportState === "exporting"}
          >
            {exportState === "exporting" ? `Exporting… ${Math.floor(exportSeconds / 60)}:${String(exportSeconds % 60).padStart(2, "0")}` : "Export Video ↓"}
          </button>
          <span>Save drafts in Create / Edit.</span>
        </div>
        <button className="primary" onClick={onNext} type="button">Next: Learn →</button>
      </div>
    </div>
  );
}
