
import React, { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useStudio } from "../../../contexts/StudioContext";
import { assetsApi, videoStudioDraftsApi, generateApi, referenceVideosApi } from "../../../api/client";
import { MEDIA_ASSET_DRAG_TYPE, type MediaAssetDragPayload } from "../../../components/studio/dragTypes";
import { findActiveClip, probeVideoDuration, probeHasAudioTrack, computeEndTimeForSpeed } from "../../../components/studio/videoPreviewUtils";
import type { CanvasFormatState, CanvasItemPosition } from "../../../contexts/StudioContext";
import type { Asset, VideoClip, TextOverlay, MediaOverlay, AudioTrack, ReferenceVideo } from "../../../types";
import {
  CANVAS_PLATFORMS, findPlacement, fitCanvasBox, PENDING_REFRAME_NOTE, RESIZE_TARGET_PLATFORMS,
  defaultPlacementForPlatform, type CanvasPlacement,
} from "../data/canvasFormats";

const CREATION_MODES = ["AI Create (Text to Video)", "Templates", "Import External", "Blank Canvas", "My Drafts"];
// Instruction 5: restores "Audio" (Instruction 4 had dropped it along with "GIFs"). It needs
// no new branch below — "Audio" was never removed from assetKind/mediaItems' filtering, only
// its tab button was, so it falls straight into the same existing asset-grid branch that
// already renders Videos/Images via the untouched mediaItems/fileInputRef/"+ Add Media" path.
// "GIFs" stays out per this instruction ("Do not add GIFs yet").
const MEDIA_TABS = ["All", "Videos", "Images", "Text", "Overlays", "Audio"] as const;

// Instruction 3 scope: only canvas elements whose data model already carries (or can trivially
// carry, via CanvasItemPosition) a position are made draggable — the headline text and the
// overlay bar. Logo/Graphic/CTA have no position model yet ("missing element models" per the
// instruction) and are deliberately left selection-only, exactly as Instruction 2 left them.
const DRAGGABLE_CANVAS_ITEM_IDS = new Set(["ph-headline", "ph-badge"]);

// Instruction 10: the one shared trim rule across all four lanes — a clip can never be
// trimmed down to (near) zero width. Deliberately small since "keep a sensible minimum" is
// the only requirement, not a specific value.
const MIN_CLIP_DURATION = 0.2;

// STEP 7.9's own client/project identity label, extracted to a shared constant so buildProjectSnapshot
// (below) and the AI Prompt Generator's project context (Task 3) reference the exact same value
// instead of two copies that could drift. This project has no real, structured Brand Kit record
// wired into Video Studio V2 yet (Brief/Intelligence tabs are local, unpersisted mock state, and
// no `Brand` row exists for this client) — this is the one genuine, already-established piece of
// "who this project is for" identity this editor has, not a fabricated stand-in for a real Brand Kit.
const PROJECT_CLIENT_IDENTITY = { client: "ABC Tiles", campaign: "Builders Footfall Campaign" };

// Step 5 follow-up (Defect 2): the one shared canvas-resize floor — a Text/Overlay element can
// never be resized down to (near) zero, same "keep a sensible minimum" principle as
// MIN_CLIP_DURATION above, just in canvas % instead of timeline seconds.
const MIN_ELEMENT_SIZE_PCT = 4;
type ResizeCorner = "nw" | "ne" | "sw" | "se";

// STEP 7.9 (Save Draft + My Drafts): the complete, intentionally-saved project — everything
// listed in the Step 7.9 requirement (video/audio/text/overlay/timeline/canvas/format state)
// plus a lightweight "client/project identity" label. `clientIdentity` mirrors the two strings
// VideoStudioV2.tsx's sidebar "Current Project" card already shows (currently hardcoded mock
// values there too, not real state) — captured here so a draft records *what project it was*
// even though neither spot has a real editable field for it yet; if that ever becomes real
// state, both places would read from it together.
interface DraftProjectSnapshot {
  videoClips: VideoClip[];
  textOverlays: TextOverlay[];
  mediaOverlays: MediaOverlay[];
  audioTracks: AudioTrack[];
  mediaAssets: Asset[];
  canvasFormat: CanvasFormatState;
  timeline: ReturnType<typeof useStudio>["timeline"];
  canvasItemPositions: Record<string, CanvasItemPosition>;
  clientIdentity: { client: string; campaign: string };
}

// List-view shape returned by GET /video-studio-drafts/ — deliberately no project_json (see the
// backend schema's own comment); the full snapshot is only fetched when a specific draft is
// actually opened, via GET /video-studio-drafts/{id}.
interface DraftSummary {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

function assetKind(fileType: string): "Videos" | "Images" | "Audio" | null {
  if (fileType === "video") return "Videos";
  if (fileType === "image") return "Images";
  if (fileType === "audio") return "Audio";
  return null;
}

function formatTimecode(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Video Deconstructor — Stage 3 (Reference Video Technical Analysis). Aspect ratio is
// deliberately never persisted anywhere in technical_details (see the backend's own
// ffmpeg_svc.probe_technical_metadata docstring) — it's pure arithmetic on width/height, so it's
// computed here, at display time only, exactly like the Stage 3 design review promised.
function deriveAspectRatioLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height) || 1;
  return `${width / d}:${height / d}`;
}

// Video Deconstructor — Stage 4. Matches the exact "00:00.000" mm:ss.mmm format requested for
// the chronological shot list — deliberately more precise than formatTimecode above (m:ss, no
// ms), since a shot's exact boundary is the whole point of this listing.
function formatShotTimecode(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m.toString().padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

export default function CreateEditTab({ onNext, onBack }: { onNext?: () => void; onBack?: () => void }) {
  const {
    videoClips, addVideoClip: rawAddVideoClip, updateVideoClip: rawUpdateVideoClip, removeVideoClip: rawRemoveVideoClip,
    textOverlays, addTextOverlay: rawAddTextOverlay, updateTextOverlay: rawUpdateTextOverlay, removeTextOverlay: rawRemoveTextOverlay,
    audioTracks, addAudioTrack: rawAddAudioTrack, updateAudioTrack: rawUpdateAudioTrack, removeAudioTrack: rawRemoveAudioTrack,
    mediaOverlays, addMediaOverlay: rawAddMediaOverlay, updateMediaOverlay: rawUpdateMediaOverlay, removeMediaOverlay: rawRemoveMediaOverlay,
    mediaAssets, addMediaAsset, removeMediaAsset, uploadAsset,
    timeline, setTimeline,
    selectedElement, setSelectedElement,
    chatMessages, chatLoading, sendChatMessage,
    canvasFormat, setCanvasFormat, canvasVersions, addCanvasVersion,
    canvasItemPositions, setCanvasItemPosition,
  } = useStudio();

  // Step 6: Undo/Redo. No history architecture existed anywhere before this — the ↶/↷ canvas-
  // toolbar buttons were plain <button>s with no onClick at all, same "dead placeholder" state
  // Split/Delete/Ripple Delete were in before Step 5. This is snapshot-based (the four content
  // arrays only — timeline/selectedElement are playhead/selection, not content, so they're
  // deliberately excluded per this step's spec) and lives entirely in this component: the
  // stacks are refs (undo/redo don't themselves need to trigger a render — restoring a snapshot
  // already does, via the underlying setVideoClips/etc. calls), with one small `historyTick`
  // counter purely so the ↶/↷ buttons' disabled state re-renders when the stacks change.
  // Restoring a snapshot removes every current item and re-adds the snapshot's items via the
  // RAW (non-history-pushing) add/remove actions — a deliberate choice over adding a new bulk-
  // "replace the whole array" action to the shared StudioContext, so this step touches zero
  // lines of StudioContext.tsx (used by legacy /studio too) and can't regress it.
  type EditorSnapshot = { videoClips: VideoClip[]; textOverlays: TextOverlay[]; mediaOverlays: MediaOverlay[]; audioTracks: AudioTrack[] };
  const MAX_HISTORY = 50;
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const currentEditorState = (): EditorSnapshot => ({
    videoClips: [...videoClips], textOverlays: [...textOverlays], mediaOverlays: [...mediaOverlays], audioTracks: [...audioTracks],
  });
  // Called at the start of every mutating action (via the wrapped add/update/remove functions
  // below) — captures what the content looked like right BEFORE this action, so Undo can put it
  // back. A fresh action always invalidates the old redo branch, same as every other editor.
  const pushHistory = () => {
    undoStackRef.current.push(currentEditorState());
    if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift();
    redoStackRef.current = [];
    setHistoryTick(v => v + 1);
  };
  const applyEditorSnapshot = (snap: EditorSnapshot) => {
    videoClips.forEach(c => rawRemoveVideoClip(c.id));
    snap.videoClips.forEach(c => rawAddVideoClip(c));
    textOverlays.forEach(t => rawRemoveTextOverlay(t.id));
    snap.textOverlays.forEach(t => rawAddTextOverlay(t));
    mediaOverlays.forEach(o => rawRemoveMediaOverlay(o.id));
    snap.mediaOverlays.forEach(o => rawAddMediaOverlay(o));
    audioTracks.forEach(a => rawRemoveAudioTrack(a.id));
    snap.audioTracks.forEach(a => rawAddAudioTrack(a));
    // If whatever was selected no longer exists in the restored state, fall back to no
    // selection rather than leave Properties/Layers pointing at a stale id.
    if (selectedElement) {
      const stillExists =
        (selectedElement.type === "clip" && selectedElement.lane === "video" && snap.videoClips.some(c => c.id === selectedElement.id)) ||
        (selectedElement.type === "text" && snap.textOverlays.some(t => t.id === selectedElement.id)) ||
        (selectedElement.type === "overlay" && snap.mediaOverlays.some(o => o.id === selectedElement.id)) ||
        (selectedElement.type === "audio" && snap.audioTracks.some(a => a.id === selectedElement.id)) ||
        selectedElement.type === "canvasItem"; // has no backing array to check against — leave as-is
      if (!stillExists) setSelectedElement(null);
    }
  };
  const handleUndo = () => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    redoStackRef.current.push(currentEditorState());
    applyEditorSnapshot(prev);
    setHistoryTick(v => v + 1);
  };
  const handleRedo = () => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(currentEditorState());
    applyEditorSnapshot(next);
    setHistoryTick(v => v + 1);
  };
  // Every existing call site in this file keeps calling addVideoClip/updateVideoClip/etc. by
  // these exact names, completely unchanged — only the destructuring above (renamed to
  // raw*) and these wrappers are new, so nothing downstream needed to be touched or re-audited.
  const addVideoClip = (c: VideoClip) => { pushHistory(); rawAddVideoClip(c); };
  const updateVideoClip = (id: string, upd: Partial<VideoClip>) => { pushHistory(); rawUpdateVideoClip(id, upd); };
  const removeVideoClip = (id: string) => { pushHistory(); rawRemoveVideoClip(id); };
  const addTextOverlay = (t: TextOverlay) => { pushHistory(); rawAddTextOverlay(t); };
  const updateTextOverlay = (id: string, upd: Partial<TextOverlay>) => { pushHistory(); rawUpdateTextOverlay(id, upd); };
  const removeTextOverlay = (id: string) => { pushHistory(); rawRemoveTextOverlay(id); };
  const addMediaOverlay = (o: MediaOverlay) => { pushHistory(); rawAddMediaOverlay(o); };
  const updateMediaOverlay = (id: string, upd: Partial<MediaOverlay>) => { pushHistory(); rawUpdateMediaOverlay(id, upd); };
  const removeMediaOverlay = (id: string) => { pushHistory(); rawRemoveMediaOverlay(id); };
  const addAudioTrack = (a: AudioTrack) => { pushHistory(); rawAddAudioTrack(a); };
  const updateAudioTrack = (id: string, upd: Partial<AudioTrack>) => { pushHistory(); rawUpdateAudioTrack(id, upd); };
  const removeAudioTrack = (id: string) => { pushHistory(); rawRemoveAudioTrack(id); };

  const [mode, setMode] = useState(CREATION_MODES[0]);
  const [mediaTab, setMediaTab] = useState<typeof MEDIA_TABS[number]>("All");
  const [search, setSearch] = useState("");
  const [rightTab, setRightTab] = useState<"Properties" | "Layers" | "Adjustments">("Properties");
  const [chatInput, setChatInput] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [customW, setCustomW] = useState(canvasFormat.width);
  const [customH, setCustomH] = useState(canvasFormat.height);
  const [resizePicker, setResizePicker] = useState(false);
  const [resizeTargets, setResizeTargets] = useState<Set<string>>(new Set());
  const [resizeStatus, setResizeStatus] = useState<string | null>(null);
  const [showAllVersions, setShowAllVersions] = useState(false);
  // Focus Mode: purely local UI state — which panels are visible/drawered. Never touches
  // StudioContext, so canvas format, clips, timeline position and selection are untouched by
  // entering/exiting it, exactly as required.
  const [focusMode, setFocusMode] = useState(false);
  const [drawer, setDrawer] = useState<null | "media" | "properties" | "aiTools">(null);
  const toggleDrawer = (which: "media" | "properties" | "aiTools") => setDrawer(d => (d === which ? null : which));
  // STEP 7 (Platform Canvas / Full-Screen Video Acceptance): purely local UI state — which clip
  // (if any) currently has the drag-to-reposition handle armed on the canvas, and whether the
  // Fit/Fill/Crop & Reposition dropdown is open. Neither ever touches StudioContext directly;
  // they only gate which handlers respond to canvas interaction and which menu renders.
  const [cropMenuOpen, setCropMenuOpen] = useState(false);
  const [repositionClipId, setRepositionClipId] = useState<string | null>(null);
  // STEP 7 (Keyboard Shortcuts): reference panel visibility — purely local UI state, same as
  // the two above.
  const [shortcutsPanelOpen, setShortcutsPanelOpen] = useState(false);

  // AI Tools — AI Prompt Generator (first of six AI Tools cards; the other five and Quick
  // Actions stay unimplemented for now, on purpose). Purely local UI/request state — nothing
  // here is persisted with the project (a generated prompt is a one-off aid, not project data),
  // so Save Draft/Undo/Redo/export are all untouched by this feature entirely.
  const [promptGenOpen, setPromptGenOpen] = useState(false);
  const [promptGenInstruction, setPromptGenInstruction] = useState("");
  const [promptGenLoading, setPromptGenLoading] = useState(false);
  const [promptGenResult, setPromptGenResult] = useState<string | null>(null);
  const [promptGenError, setPromptGenError] = useState<string | null>(null);
  const [promptGenCopied, setPromptGenCopied] = useState(false);

  // Video Deconstructor — Stage 2 (Reference Video Ingestion) ONLY. Wires up "Import External"
  // — previously a dead creation-mode button; `mode` (see the comment above `draftId` below)
  // "was never read anywhere" until now. Reuses the exact same uploadAsset() call every other
  // media tab in this file already uses (fileInputRef's onChange, handleFiles, etc.) — this
  // never introduces a second upload path or touches the existing /upload/ endpoint. After the
  // upload succeeds, the resulting asset_id is wrapped into an immutable ReferenceVideo + its
  // initial "pending" VideoAnalysis via the new /reference-videos/ endpoint. No scene, shot,
  // text, hook, transcript, or any other analysis happens here — see
  // backend/app/routers/reference_videos.py's own module docstring for exact scope. Purely
  // local UI/request state, same as promptGen* above — nothing here is part of the saved
  // project snapshot (Save Draft/Undo/Redo/export are all untouched).
  const [refIngestBusy, setRefIngestBusy] = useState(false);
  const [refIngestError, setRefIngestError] = useState<string | null>(null);
  const [refIngestResult, setRefIngestResult] = useState<ReferenceVideo | null>(null);

  // Video Deconstructor — Stage 3 (Reference Video Technical Analysis) ONLY. Wires up the
  // (until now genuinely disabled — see the fix noted below on the button itself) "Analyse
  // Reference" button. Deterministic technical facts only — no scene/shot/hook/transcript/any
  // other analysis; see backend/app/routers/reference_videos.py's own module docstring and
  // app/services/ffmpeg_svc.probe_technical_metadata for exact scope and certainty treatment.
  // `refAnalyzeBusy` covers only the in-flight request; the actual lifecycle shown to the user
  // (Ready for Analysis / Analysing / Technical Analysis Complete / Analysis Failed) is read
  // straight off refIngestResult.latest_analysis.status, which this response replaces in place.
  const [refAnalyzeBusy, setRefAnalyzeBusy] = useState(false);
  const [refAnalyzeError, setRefAnalyzeError] = useState<string | null>(null);
  const [refIngestRestoring, setRefIngestRestoring] = useState(false);

  // Video Deconstructor — Stage 4 (Deterministic Shot/Cut Boundary Detection) ONLY. Wires up
  // "Analyse Structure". No scene grouping, no transcription/OCR/visual AI, no reconstruction —
  // see backend/app/routers/reference_videos.py's own module docstring and
  // app/services/ffmpeg_svc.detect_shot_boundary_candidates/build_shot_segments for exact scope.
  // The Stage-3 "Technical Analysis Complete" section is read from
  // refIngestResult.latest_analysis.pass_status.technical_probe, NOT from the top-level status
  // field — Stage 4 running/failing must never make Stage 3's already-trustworthy results
  // disappear from view (top-level status legitimately flips to "running" while Stage 4 works).
  const [refAnalyzeStructureBusy, setRefAnalyzeStructureBusy] = useState(false);
  const [refAnalyzeStructureError, setRefAnalyzeStructureError] = useState<string | null>(null);

  // Video Deconstructor — Stage 5 (Visual Evidence / Representative Frames) ONLY. Same
  // independent busy/error pair as Stage 4 above — a running/failed Stage-5 pass must never hide
  // Stage 3's or Stage 4's already-complete results (read from pass_status.visual_evidence, not
  // the top-level status field, same reasoning as structureStatus below).
  const [refAnalyzeFramesBusy, setRefAnalyzeFramesBusy] = useState(false);
  const [refAnalyzeFramesError, setRefAnalyzeFramesError] = useState<string | null>(null);

  // Reference Preview defect fix (Shot rows reported not clickable / no visible feedback):
  // which Shot's row is currently selected (highlighted), purely local UI state — never written
  // to any Shot record, never affects the editor. refPreviewTime/refPreviewDuration mirror the
  // Reference Preview <video>'s own currentTime/duration via native timeupdate/loadedmetadata
  // events (not requestAnimationFrame — a plain media event, so this works regardless of
  // whether rAF is throttled), rendered as an explicit, high-contrast text readout so a click's
  // effect is unmistakable even if the small preview thumbnail change itself goes unnoticed.
  const [selectedShotId, setSelectedShotId] = useState<number | null>(null);
  const [refPreviewTime, setRefPreviewTime] = useState(0);
  const [refPreviewDuration, setRefPreviewDuration] = useState(0);
  // Stage 5 (Visual Evidence): which representative-frame thumbnail is selected, independent of
  // selectedShotId above — clicking a specific frame highlights THAT frame, not just its parent
  // Shot row (both can be true at once: the Shot row and one of its own frames).
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);

  // Defect fix (post-Stage-3 Manual Test 1): refIngestResult above was ONLY ever set by a fresh
  // upload/analyze response — nothing ever read an already-ingested ReferenceVideo back from
  // the backend, so it reset to null on every remount (a page reload, or simply leaving and
  // re-entering this tab) even though Stage 2 had genuinely persisted it server-side. This
  // restores it the first time "Import External" is opened and nothing has been loaded into
  // this session yet — never re-uploads, never creates a ReferenceVideo or VideoAnalysis (GET
  // only). Guarded by a ref (not just refIngestResult itself), same "run once" pattern
  // seededVersionsRef above already uses, so this can't re-fire and clobber a result the user
  // just produced by uploading or analysing in this same session.
  const refIngestRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (mode !== "Import External" || refIngestRestoreAttemptedRef.current || refIngestResult) return;
    refIngestRestoreAttemptedRef.current = true;
    setRefIngestRestoring(true);
    (async () => {
      try {
        const { data } = await referenceVideosApi.list();
        const latest = (data as ReferenceVideo[])[0]; // newest first, per the backend's own ordering
        if (latest) setRefIngestResult(latest);
      } catch {
        // Best-effort restoration only — on failure the panel simply stays at its normal
        // "Upload Reference Video" idle state; nothing else in the editor is affected.
      } finally {
        setRefIngestRestoring(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // STEP 7.6 defect fix: the speaker icon under the preview was a plain <span> — decorative,
  // no click handler at all. This is purely a PREVIEW listening convenience (like a video
  // player's own mute button), kept as local UI state rather than a saved data-model field on
  // any clip/track — deliberately NOT the same thing as an AudioTrack's own `volume` (see the
  // muted-application effect below, which ORs this on top of each element's own saved
  // mute/volume rather than overwriting it).
  const [previewMuted, setPreviewMuted] = useState(false);

  // STEP 7.9 (Save Draft + My Drafts): "My Drafts" previously did nothing but highlight itself
  // — `mode` (below) was never read anywhere. This is a durable, intentionally-saved project
  // (backend `video_studio_drafts` table), deliberately separate from the automatic
  // refresh/crash-recovery persistence in VideoStudioV2.tsx's ProjectPersistence (Requirement
  // 10/12) — that system is untouched by any of this. draftId is the backend row this session
  // is currently attached to (null = "never saved yet" / "unsaved new project"); saving again
  // with a non-null draftId updates that same row (PUT) instead of creating a duplicate
  // (Requirement 8).
  const [draftId, setDraftId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [showSaveDraft, setShowSaveDraft] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [showMyDrafts, setShowMyDrafts] = useState(false);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState<string | null>(null);

  const buildProjectSnapshot = (): DraftProjectSnapshot => ({
    videoClips, textOverlays, mediaOverlays, audioTracks, mediaAssets,
    canvasFormat, timeline, canvasItemPositions,
    clientIdentity: PROJECT_CLIENT_IDENTITY,
  });

  // Removes every current clip/text/overlay/audio-track (leaves mediaAssets and canvasFormat/
  // timeline/canvasItemPositions alone — those get explicitly overwritten by applyDraftSnapshot
  // right after, when opening a draft; New Draft below calls this alone, on purpose, so a brand
  // new project keeps the current canvas format rather than silently resetting it to default).
  // Also drops Undo/Redo history — undoing "past" a full project swap into whatever was loaded
  // before it would be more confusing than useful, so both stacks start clean.
  const clearLiveProject = () => {
    videoClips.forEach(c => rawRemoveVideoClip(c.id));
    textOverlays.forEach(t => rawRemoveTextOverlay(t.id));
    mediaOverlays.forEach(o => rawRemoveMediaOverlay(o.id));
    audioTracks.forEach(a => rawRemoveAudioTrack(a.id));
    setSelectedElement(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryTick(v => v + 1);
  };

  const applyDraftSnapshot = (snap: DraftProjectSnapshot) => {
    clearLiveProject();
    (snap.videoClips ?? []).forEach(c => rawAddVideoClip(c));
    (snap.textOverlays ?? []).forEach(t => rawAddTextOverlay(t));
    (snap.mediaOverlays ?? []).forEach(o => rawAddMediaOverlay(o));
    (snap.audioTracks ?? []).forEach(a => rawAddAudioTrack(a));
    // mediaAssets only has an additive action (no bulk replace) — skip any id already present
    // rather than duplicate entries already in the Media panel.
    const existingAssetIds = new Set(mediaAssets.map(a => a.id));
    (snap.mediaAssets ?? []).forEach(a => { if (!existingAssetIds.has(a.id)) addMediaAsset(a); });
    if (snap.canvasFormat) setCanvasFormat(snap.canvasFormat);
    if (snap.timeline) setTimeline(snap.timeline);
    Object.entries(snap.canvasItemPositions ?? {}).forEach(([id, pos]) => setCanvasItemPosition(id, pos));
  };

  // Requirement 9: a safe way to start a fresh project without touching any already-saved
  // draft row on the backend — this only ever clears the LIVE in-editor state (the same thing
  // a refresh would lose anyway, absent Step 7's separate auto-recovery system) and forgets
  // which draft this session was attached to. Nothing under video-studio-drafts is deleted or
  // modified by this action.
  const handleNewDraft = () => {
    if (!window.confirm("Start a new project? This clears the current editor (any Saved Draft is not affected — you can reopen it from My Drafts).")) return;
    clearLiveProject();
    setDraftId(null);
    setDraftName("");
    setDraftStatus(null);
  };

  const defaultDraftName = () => {
    const d = new Date();
    return `ABC Tiles — Builders Footfall Campaign (${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
  };

  const openSaveDraft = () => {
    setSaveNameInput(draftName || defaultDraftName());
    setShowSaveDraft(true);
  };

  // Requirement 8: reuses draftId (if this session already opened/saved one) so saving again
  // updates the same backend row via PUT rather than POSTing a new duplicate every time.
  // STEP 7 (Keyboard Shortcuts): extracted from handleConfirmSaveDraft below so Ctrl+S can
  // trigger the exact same save operation without going through the name-entry modal at all —
  // same order of operations, same state updates, one source of truth for "how a draft is
  // actually saved" either way.
  const performSaveDraft = async (name: string): Promise<boolean> => {
    setDraftBusy(true);
    setDraftStatus(null);
    try {
      const project_json = buildProjectSnapshot();
      if (draftId != null) {
        await videoStudioDraftsApi.update(draftId, { name, project_json });
      } else {
        const { data } = await videoStudioDraftsApi.create({ name, project_json });
        setDraftId((data as { id: number }).id);
      }
      setDraftName(name);
      setDraftStatus(`Saved "${name}"`);
      return true;
    } catch {
      setDraftStatus("Save failed — please try again.");
      return false;
    } finally {
      setDraftBusy(false);
    }
  };

  const handleConfirmSaveDraft = async () => {
    const ok = await performSaveDraft(saveNameInput.trim() || defaultDraftName());
    if (ok) setShowSaveDraft(false);
  };

  // STEP 7 (Keyboard Shortcuts): Ctrl+S — saves immediately with this session's existing draft
  // name (if any) or a fresh default, deliberately NOT reusing saveNameInput (that belongs only
  // to the modal's own text field and could hold stale text from an abandoned/cancelled modal
  // session) — Ctrl+S always saves under a real, current name, never a leftover draft of one.
  const handleQuickSaveDraft = () => {
    if (draftBusy) return;
    void performSaveDraft(draftName || defaultDraftName());
  };

  const openMyDrafts = async () => {
    setShowMyDrafts(true);
    setDraftsLoading(true);
    setDraftsError(null);
    try {
      const { data } = await videoStudioDraftsApi.list();
      setDrafts(data as DraftSummary[]);
    } catch {
      setDraftsError("Could not load drafts — please try again.");
    } finally {
      setDraftsLoading(false);
    }
  };

  // Requirement 6/7: full reconstruction, then the session is attached to this draft's id so
  // continuing to edit and Saving again (Requirement 7/8) updates this same row.
  const handleOpenDraft = async (id: number) => {
    setDraftBusy(true);
    setDraftsError(null);
    try {
      const { data } = await videoStudioDraftsApi.get(id);
      const full = data as { id: number; name: string; project_json: DraftProjectSnapshot };
      applyDraftSnapshot(full.project_json);
      setDraftId(full.id);
      setDraftName(full.name);
      setDraftStatus(`Opened "${full.name}"`);
      setShowMyDrafts(false);
    } catch {
      setDraftsError("Could not open that draft — please try again.");
    } finally {
      setDraftBusy(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const refIngestFileInputRef = useRef<HTMLInputElement>(null);
  // Reference Preview (post-Stage-4 UI gap fix): a SEPARATE <video> element, own ref, own
  // native controls, own playhead — deliberately NOT videoRef (the editor's own V1 element).
  // Used only to inspect the analysed ReferenceVideo itself (e.g. verify a detected Shot
  // boundary against the actual footage); never reads or writes timeline.currentTime, never
  // touches videoClips, and is unaffected by (and has no effect on) the editor project/timeline.
  const refPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const previewRegionRef = useRef<HTMLDivElement>(null);
  const [regionSize, setRegionSize] = useState({ w: 320, h: 400 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Step 5 follow-up (Overlay audio): multiple video-backed Overlays could exist at once (even
  // if only one is in its active timeline window at a time), so this is a live id→element map
  // rather than a single ref, populated by a callback ref on each rendered overlay <video>.
  const overlayVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  // Direct inline text editing on canvas: which TextOverlay (if any) is currently in edit mode
  // — same id→element ref-map convention as overlayVideoRefs above, so the caret-placement
  // effect can reach the actual contentEditable DOM node right after entering edit mode.
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const textEditRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Drag-to-move (Instruction 3): the placeholder box we measure against, plus a "latest
  // canvasBox" ref so the window-level move/up listeners (attached once per drag) always read
  // current dimensions instead of a stale closure — same pattern as activeVideoClipRef below.
  const videoPreviewBoxRef = useRef<HTMLDivElement>(null);
  const canvasBoxRef = useRef({ w: 1, h: 1 });
  const dragSessionRef = useRef<{
    id: string; boxW: number; boxH: number; elW: number; elH: number;
    startClientX: number; startClientY: number; origXPct: number; origYPct: number;
  } | null>(null);
  // Instruction 7: same drag-session shape as dragSessionRef above, but for real TextOverlay
  // items — writes into the TextOverlay's own existing x/y (%) fields via updateTextOverlay
  // instead of the canvasItemPositions map, since TextOverlay already has real position fields.
  const dragTextSessionRef = useRef<{
    id: string; boxW: number; boxH: number; elW: number; elH: number;
    startClientX: number; startClientY: number; origX: number; origY: number;
  } | null>(null);
  // Step 5 follow-up (Defect 2): identical drag-session shape again, this time for real
  // MediaOverlay items — writes into MediaOverlay's own existing x/y (%) fields via
  // updateMediaOverlay. MediaOverlay was left selection-only when Instruction 6 first put it on
  // canvas; this finally gives it the same body-drag Text already had since Instruction 7.
  const dragOverlaySessionRef = useRef<{
    id: string; boxW: number; boxH: number; elW: number; elH: number;
    startClientX: number; startClientY: number; origX: number; origY: number;
  } | null>(null);
  // Step 5 follow-up (Defect 2): resize sessions, one per lane type again (same convention as
  // dragTextSessionRef/dragOverlaySessionRef above). Text has no `height` field in its data
  // model (its box height is implicit — content + width + fontSize + line-height, via existing
  // CSS) so its resize session only ever tracks/changes x + width; Overlay has real width AND
  // height fields, so its session tracks both.
  const resizeTextSessionRef = useRef<{
    id: string; boxW: number; startClientX: number; corner: ResizeCorner;
    origX: number; origWidth: number;
  } | null>(null);
  const resizeOverlaySessionRef = useRef<{
    id: string; boxW: number; boxH: number; startClientX: number; startClientY: number; corner: ResizeCorner;
    origX: number; origY: number; origWidth: number; origHeight: number;
  } | null>(null);
  // STEP 7 (Platform Canvas / Full-Screen Video Acceptance): drag-to-reposition session for a
  // clip in Fill mode — same "session ref + boxW/boxH + origin" shape as dragOverlaySessionRef
  // above, just writing into VideoClip's cropOffsetX/Y instead of MediaOverlay's x/y.
  const cropDragSessionRef = useRef<{
    id: string; boxW: number; boxH: number; startClientX: number; startClientY: number;
    origOffsetX: number; origOffsetY: number;
  } | null>(null);
  const cropDragMovedRef = useRef(false);
  // Step 6: same "only push history once an actual move happens" guard as ClipBlock's
  // gestureStartedRef — a plain click-to-select on a canvas Text/Overlay item (mousedown with
  // no following mousemove) must never push a no-op snapshot onto the undo stack.
  const textDragMovedRef = useRef(false);
  const textResizeMovedRef = useRef(false);
  const overlayDragMovedRef = useRef(false);
  const overlayResizeMovedRef = useRef(false);
  // Step 5 follow-up (Defect 1): the Properties panel's existing text-content field is already
  // fully wired (value/onChange → updateTextOverlay — verified working) — the real gap found
  // was that double-clicking the Text item ON THE CANVAS, the most natural place a user would
  // try to edit it, did nothing at all (canvas text was mouseDown-for-drag only, no keyboard
  // path whatsoever). This ref lets a canvas double-click hand off focus to that existing field
  // instead of building a second, inline-editable text system on the canvas.
  const textPropsTextareaRef = useRef<HTMLTextAreaElement>(null);
  const activeVideoClipRef = useRef<VideoClip | null>(null);
  const videoClipsRef = useRef(videoClips);
  videoClipsRef.current = videoClips;
  // Instruction 13: lets the rAF tick loop below read the LATEST markOut (it isn't in that
  // effect's own dependency array, so without a ref it would use a stale value captured at
  // playback-start if markOut changed mid-play) — same "ref mirrors state for a running rAF
  // loop" pattern as activeVideoClipRef/videoClipsRef above.
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  // Instruction 13 (Playhead/IN/OUT): architecture note — none of .timeline/.track/.track-lane/
  // .time-ruler carry their own `position`, so an absolutely-positioned child of any of them
  // resolves against the nearest ACTUAL positioned ancestor, which is .editor-shell (confirmed
  // by direct measurement: a clip's rendered left px matched editor-shell-relative math, not
  // track-lane-relative math). That's a pre-existing quirk of how ClipBlock already renders —
  // out of scope to change here (would touch existing clip positioning). To avoid adding
  // `position:relative` to any existing timeline element (which would shift clips' resolved
  // containing block, however slightly), the Playhead/IN/OUT are rendered as new siblings
  // directly inside .editor-shell, with their vertical placement computed from real measured
  // pixels (via these refs) rather than CSS alone — zero existing CSS rules touched.
  const editorShellRef = useRef<HTMLDivElement>(null);
  const timelineSectionRef = useRef<HTMLElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [timelineGeom, setTimelineGeom] = useState({ top: 0, height: 0, rulerTop: 0, rulerHeight: 0, rulerLeft: 0, rulerWidth: 0 });
  useEffect(() => {
    const shellEl = editorShellRef.current;
    const timelineEl = timelineSectionRef.current;
    const rulerEl = rulerRef.current;
    if (!shellEl || !timelineEl || !rulerEl) return;
    const update = () => {
      const shellRect = shellEl.getBoundingClientRect();
      const timelineRect = timelineEl.getBoundingClientRect();
      const rulerRect = rulerEl.getBoundingClientRect();
      setTimelineGeom({
        top: timelineRect.top - shellRect.top, height: timelineRect.height,
        rulerTop: rulerRect.top - shellRect.top, rulerHeight: rulerRect.height,
        rulerLeft: rulerRect.left - shellRect.left, rulerWidth: rulerRect.width,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(timelineEl);
    return () => ro.disconnect();
  }, [focusMode]);

  const activeVideoClip = findActiveClip(videoClips, timeline.currentTime);
  activeVideoClipRef.current = activeVideoClip;
  const hasRealSrc = !!activeVideoClip?.url;
  const activeClipId = activeVideoClip?.id ?? null;

  // Instruction 9: which AudioTrack (if any) is within its own active window right now — a
  // plain range check, same shape as findActiveClip's core check, but deliberately WITHOUT its
  // "freeze on the last clip past the end" behaviour: audio should simply stop when its own
  // window ends, not hold on indefinitely, and it never drives the shared clock (the video's
  // own rAF tick loop below remains the one clock source — audio only ever follows it).
  const activeAudioTrack = audioTracks.find(a => timeline.currentTime >= a.startTime && timeline.currentTime < a.endTime) ?? null;
  const activeAudioId = activeAudioTrack?.id ?? null;

  // STEP 7.6A defect fix: once a video's audio has been separated onto its own A1 AudioTrack
  // (same assetId — see the "Instruction 12" mirroring in handleDrop below), A1 becomes the
  // sole, authoritative source for that audio: its own volume/mute controls are meaningless if
  // V1's <video> is ALSO still playing that same audio, unmuted, straight from the source file.
  // That's the exact duplicate-audio path Sameena's 0%-is-still-audible report traced to — V1
  // was never muted at all, separated or not. This is intentionally NOT tied to previewMuted:
  // it's "this clip's audio now lives on A1", true regardless of whether the preview is muted.
  const videoHasSeparatedAudio = !!activeVideoClip
    && audioTracks.some(a => activeVideoClip.assetId != null && a.assetId === activeVideoClip.assetId);

  const authoredEnds = [
    ...videoClips.map(c => c.endTime),
    ...textOverlays.map(o => o.endTime),
    ...audioTracks.map(t => t.endTime),
    ...mediaOverlays.map(o => o.endTime),
  ];
  const effectiveDuration = Math.max(timeline.duration || 0, ...authoredEnds, 15);

  // Measures the actual available preview region (not a guessed constant) so the canvas can
  // use however much real space the editor-shell grid gives it — the same amount regardless
  // of orientation. A landscape (16:9) canvas naturally ends up wide-and-short and a portrait
  // (9:16) canvas naturally ends up tall-and-narrow from this one calculation; no orientation
  // branching needed, and no risk of silently capping landscape to a portrait-shaped box.
  useEffect(() => {
    const el = previewRegionRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setRegionSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // Re-runs the synchronous measurement immediately when Focus Mode toggles, rather than
    // relying solely on the ResizeObserver to notice the grid change — entering/exiting Focus
    // Mode is a known, deterministic moment the available space changes, so there's no reason
    // to wait a frame for it.
  }, [focusMode]);

  // Seeds the version chip row once with the approved reference's default quick-access set
  // (Instagram, Facebook, TikTok, YouTube, LinkedIn, X, Pinterest) — purely a starting
  // selection of shortcuts, not a claim that the user has actually created those versions.
  // Guarded by a ref (not canvasVersions.length) so StrictMode's dev-only double-invoke can't
  // seed it twice.
  const seededVersionsRef = useRef(false);
  useEffect(() => {
    if (seededVersionsRef.current || canvasVersions.length > 1) return
    seededVersionsRef.current = true
    const seeds: [string, string][] = [
      ["instagram", "reel_story"], ["facebook", "feed_portrait"], ["tiktok", "vertical"],
      ["youtube", "standard"], ["linkedin", "portrait_video"], ["x", "landscape"], ["pinterest", "pin"],
    ]
    seeds.forEach(([platformKey, placementKey]) => {
      const placement = findPlacement(platformKey, placementKey)
      if (!placement) return
      const label = `${CANVAS_PLATFORMS.find(p => p.key === platformKey)?.label ?? platformKey} - ${placement.label}`
      addCanvasVersion({ platformKey, placementKey, label, ratio: placement.ratio, width: placement.width, height: placement.height })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Multi-platform canvas: switching format only ever changes the frame the same master
  // timeline is fitted into (fitCanvasBox never stretches) — it never touches videoClips,
  // textOverlays, audioTracks or mediaOverlays. Each format is remembered non-destructively
  // in canvasVersions so switching back doesn't lose anything. ----
  const EDIT_MARGIN = 10; // sensible editing margin around the canvas, per spec section 11 — trimmed to the minimum that still reads as a margin, since panel widths can't be touched to reclaim more
  const canvasBox = fitCanvasBox(
    canvasFormat.ratio === "CUSTOM" ? customW : canvasFormat.width,
    canvasFormat.ratio === "CUSTOM" ? customH : canvasFormat.height,
    Math.max(regionSize.w - EDIT_MARGIN * 2, 100),
    Math.max(regionSize.h - EDIT_MARGIN * 2, 100)
  );
  const rawW = canvasFormat.ratio === "CUSTOM" ? customW : canvasFormat.width;
  const rawH = canvasFormat.ratio === "CUSTOM" ? customH : canvasFormat.height;
  const orientation = rawW === rawH ? "square" : rawW > rawH ? "landscape" : "portrait";
  canvasBoxRef.current = canvasBox;

  const applyPlacement = (platformKey: string, placement: CanvasPlacement) => {
    const label = `${CANVAS_PLATFORMS.find(p => p.key === platformKey)?.label ?? platformKey} - ${placement.label}`;
    const next: CanvasFormatState = {
      platformKey, placementKey: placement.key, label,
      ratio: placement.ratio, width: placement.width, height: placement.height,
    };
    setCanvasFormat(next);
    addCanvasVersion(next);
    if (placement.ratio === "CUSTOM") { setCustomW(placement.width); setCustomH(placement.height); }
  };

  const handleFormatSelect = (value: string) => {
    const [platformKey, placementKey] = value.split("|");
    const placement = findPlacement(platformKey, placementKey);
    if (placement) applyPlacement(platformKey, placement);
  };

  const applyCustomSize = (w: number, h: number) => {
    setCustomW(w); setCustomH(h);
    const next: CanvasFormatState = {
      platformKey: "website", placementKey: "custom", label: "Website / General - Custom Size",
      ratio: "CUSTOM", width: w, height: h,
    };
    setCanvasFormat(next);
    addCanvasVersion(next);
  };

  const toggleResizeTarget = (key: string) => setResizeTargets(p => {
    const next = new Set(p);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // "Resize for Platforms" — prepares the architecture (versions get created, each platform's
  // default placement is added non-destructively) without pretending real AI reframing ran.
  const runResizeForPlatforms = () => {
    resizeTargets.forEach(key => {
      const placement = defaultPlacementForPlatform(key);
      if (placement) applyPlacement(key, placement);
    });
    setResizeStatus(`${resizeTargets.size} version${resizeTargets.size === 1 ? "" : "s"} added. ${PENDING_REFRAME_NOTE}`);
    setResizePicker(false);
    setResizeTargets(new Set());
    setTimeout(() => setResizeStatus(null), 6000);
  };

  // ---- STEP 7 LIVE PLAYBACK ENGINE FAILURE — master-clock rearchitecture. ----
  // Root cause of the freeze / repeating-audio-fragment / "O1 plays but V1 doesn't" reports:
  // timeline.currentTime — meant to be the ONE global playhead every media element follows —
  // was actually being DERIVED from V1's own <video>.currentTime every rAF frame (see the old
  // "tick" loop this replaced). That inverts the intended master/slave relationship: V1's video
  // is supposed to be a SLAVE that seeks itself to match the global playhead (that's exactly
  // what the applyOffset/scrub-sync effects below do, correctly, in that direction), not the
  // SOURCE the playhead is read from. The moment V1's own element stalls, gets reseeked
  // mid-flight (e.g. the backward seek a split clip's own trimIn requires when Video 2 takes
  // over — see videoPreviewUtils.ts), or simply free-runs oddly across a tab visibility change,
  // the "global" clock silently inherits whatever V1's element happens to be doing — including
  // going nowhere. A1's own sync effects are innocent bystanders in this: they correctly follow
  // timeline.currentTime, so once THAT froze, A1 kept getting yanked back to the same frozen
  // target every frame — which is exactly what a repeating fraction-of-a-second audio loop is.
  //
  // The fix: timeline.currentTime now advances from a real, independent wall clock
  // (performance.now()), never from any <video>/<audio> element's own currentTime. Every media
  // element (V1's <video>, A1's <audio>, overlay <video>s) is purely a SLAVE that reconciles
  // itself to timeline.currentTime — that direction was already correct in the effects below
  // and is untouched here. Which clip is "active" is now purely findActiveClip(videoClips,
  // timeline.currentTime) reacting to the independently-advancing clock, not something this
  // loop decides by watching any element's playback position — so clip hand-off, overlap
  // regions, and the exact end of the last clip are all just the SAME one time comparison,
  // wherever it happens to fall, with no separate "did a clip end" heuristic to get out of sync.
  //
  // This also directly fixes the tab-visibility symptom: requestAnimationFrame genuinely does
  // not fire (or fires at a throttled rate) while the tab is hidden, in every real browser, not
  // just this project's own code — that's a browser-level behaviour, not something to work
  // around. A clock that measured "wall time since the last tick" would lose that hidden time
  // outright. Anchoring instead to "wall time since the CURRENT play session started" means the
  // very next tick after returning to the tab computes the full, correct elapsed real time in
  // one step — playback resumes exactly where it should, with no catch-up animation, no
  // restart, and no drift, regardless of how long the tab was hidden.
  useEffect(() => {
    if (!hasRealSrc || !timeline.playing) return;
    let rafId: number;
    // Anchor: at this wall-clock instant, the timeline was at this position. Re-anchored fresh
    // every time this effect (re)starts — i.e. on every play/pause toggle and on every genuine
    // clip-availability change — so a scrub that happens while paused, or a play/pause toggle,
    // is picked up automatically without this loop needing to know why currentTime changed.
    const anchorWallMs = performance.now();
    const anchorTimelineSeconds = timelineRef.current.currentTime;
    const tick = () => {
      const elapsedSeconds = (performance.now() - anchorWallMs) / 1000;
      const newTime = anchorTimelineSeconds + elapsedSeconds;
      // Stop point: the end of V1's own authored coverage (last video clip's endTime — matches
      // the previous architecture's stopping behaviour exactly) or an explicit IN/OUT mark,
      // whichever is reached first. Purely a comparison against known clip metadata — no media
      // element read of any kind.
      const clips = videoClipsRef.current;
      const lastVideoEnd = clips.length > 0 ? Math.max(...clips.map(c => c.endTime)) : 0;
      const markOut = timelineRef.current.markOut;
      const stopAt = markOut !== null ? Math.min(markOut, lastVideoEnd) : lastVideoEnd;
      if (newTime >= stopAt) {
        setTimeline({ currentTime: stopAt, playing: false });
        return; // this play session is over — no more ticks, no watchdog poke below
      }
      setTimeline({ currentTime: newTime });
      // Watchdog: if the active clip's <video> should be playing but the browser hasn't
      // actually started it yet (its own play() call, in the offset/seek effect below, fires
      // from a loadedmetadata callback rather than synchronously inside a user gesture, so a
      // browser can in principle race or decline it), keep nudging it. Purely a one-way poke —
      // it never reads the element's currentTime, so it cannot feed back into this clock.
      const vid = videoRef.current;
      if (vid && vid.paused && vid.readyState >= 2) vid.play().catch(() => {});
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRealSrc, timeline.playing, setTimeline]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !hasRealSrc) return;
    // Clip hand-off is now purely a function of the wall-clock-driven timeline.currentTime
    // crossing into the next clip's range (see the master clock above and findActiveClip) —
    // never of any single <video> element's own native "ended" state, which the previous
    // architecture used as one of two competing hand-off triggers. If the browser still fires
    // its own 'ended' (e.g. the authored clip metadata slightly overstates the real file's
    // usable length), the only correct response is: if we should still be playing, try to
    // resume — wherever the video needs to seek to lands via the offset/scrub-sync effects
    // below, and once the master clock's own comparison crosses into the next clip's territory,
    // activeClipId switches on its own regardless of what this element is doing.
    const onEnded = () => {
      if (timelineRef.current.playing) vid.play().catch(() => {});
    };
    vid.addEventListener("ended", onEnded);
    return () => vid.removeEventListener("ended", onEnded);
  }, [hasRealSrc]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !hasRealSrc || !activeVideoClip) return;
    const clip = activeVideoClip;
    const speed = clip.speed || 1;
    const applyOffset = () => {
      // Instruction 10: + clip.trimIn so playback begins from the correct point in the
      // ORIGINAL source once trimmed (e.g. trim first 3s → source offset starts at 3, not 0) —
      // clip.duration itself is never touched, so this stays fully non-destructive.
      // Step 5 follow-up (Speed): the elapsed-timeline-time portion is scaled by `speed` so a
      // 2x clip's source position advances twice as fast per timeline second (1x is unchanged).
      const offset = Math.max(0, timeline.currentTime - clip.startTime) * speed + clip.trimIn;
      if (Math.abs(vid.currentTime - offset) > 0.05) vid.currentTime = offset;
      vid.playbackRate = speed;
      if (timeline.playing) vid.play().catch(() => {});
    };
    if (vid.readyState >= 1) applyOffset();
    else vid.addEventListener("loadedmetadata", applyOffset, { once: true });
    return () => vid.removeEventListener("loadedmetadata", applyOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClipId, hasRealSrc, activeVideoClip?.speed]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !hasRealSrc || !activeVideoClip) return;
    const speed = activeVideoClip.speed || 1;
    const targetLocal = Math.max(0, timeline.currentTime - activeVideoClip.startTime) * speed + activeVideoClip.trimIn;
    if (Math.abs(vid.currentTime - targetLocal) > 0.35 && vid.readyState >= 1) vid.currentTime = targetLocal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.currentTime, hasRealSrc, activeClipId]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (timeline.playing) vid.play().catch(() => {});
    else vid.pause();
  }, [timeline.playing]);

  // ---- Instruction 9: real audio playback, following the SAME offset/seek/play-pause pattern
  // as the video sync effects above — but purely reactive to timeline.currentTime/playing,
  // never driving them. This is what keeps Audio's timing genuinely independent of Video: it
  // plays only inside its own [startTime, endTime) window, wherever that is relative to V1. ----
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !activeAudioTrack) return;
    const track = activeAudioTrack;
    const applyOffset = () => {
      // Instruction 10: + track.trimIn, same non-destructive-offset principle as video —
      // trim first 5s of a 20s source, place at timeline 3s → at timeline 3s this correctly
      // resolves to source time 5s, not 0s.
      const offset = Math.max(0, timeline.currentTime - track.startTime) + track.trimIn;
      if (Math.abs(el.currentTime - offset) > 0.05) el.currentTime = offset;
      if (timeline.playing) el.play().catch(() => {});
    };
    if (el.readyState >= 1) applyOffset();
    else el.addEventListener("loadedmetadata", applyOffset, { once: true });
    return () => el.removeEventListener("loadedmetadata", applyOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudioId]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !activeAudioTrack) return;
    const targetLocal = Math.max(0, timeline.currentTime - activeAudioTrack.startTime) + activeAudioTrack.trimIn;
    if (Math.abs(el.currentTime - targetLocal) > 0.35 && el.readyState >= 1) el.currentTime = targetLocal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.currentTime, activeAudioId]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (timeline.playing && activeAudioTrack) el.play().catch(() => {});
    else el.pause();
  }, [timeline.playing, activeAudioId]);

  // STEP 7.6 defect fix (STEP 7.6A follow-up): apply the preview-mute toggle to every element
  // that can actually produce preview sound — the main <video> (its own embedded audio, if
  // any) and the A1 <audio> element. Reapplied on every relevant dependency change because
  // both elements are conditionally rendered (hasRealSrc / activeAudioTrack), so a fresh DOM
  // node — with the browser's own default `muted = false` — can mount after the toggle was
  // already set. This only ever sets the live DOM `.muted` property; it never reads or writes
  // activeAudioTrack.volume or any saved clip field, so the A1 clip's own volume property
  // (Instruction 6/7) stays completely independent of this preview convenience.
  //
  // STEP 7.6A: V1 is ADDITIONALLY always muted whenever videoHasSeparatedAudio is true — not
  // OR'd conditionally on previewMuted's value alone. This is the fix for the reported "0% A1
  // still faintly audible" defect: V1 was never muted at all before, separated audio or not,
  // so it kept playing the source file's original audio in parallel with A1 regardless of A1's
  // volume. This is deliberately NOT "globally mute the preview" (Instruction 4) — an
  // un-separated video (no matching A1 track) is untouched by this term and still only follows
  // previewMuted, exactly as before.
  //
  // STEP 7 (Original Video Audio controls): activeVideoClip?.muted is a THIRD, independent
  // reason V1 can be muted — the clip's own saved on/off toggle (Properties → Audio), set by
  // the user regardless of whether this clip's audio has been separated to A1. OR'd in exactly
  // like the other two terms, never replacing them: whichever of the three is true, V1 is
  // muted; none of them ever touch each other's underlying state.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = previewMuted || videoHasSeparatedAudio || (activeVideoClip?.muted ?? false);
    if (audioRef.current) audioRef.current.muted = previewMuted;
  }, [previewMuted, hasRealSrc, activeAudioId, videoHasSeparatedAudio, activeVideoClip?.muted]);

  // STEP 7 (Original Video Audio controls): V1's own volume — same "own effect, never touches
  // .muted" separation the A1 volume effect below already established. Only meaningful while
  // V1 isn't muted by one of the three reasons above, but is still safe to always apply: a
  // muted element's .volume has no audible effect regardless of its value.
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = activeVideoClip?.volume ?? 1;
  }, [activeVideoClip?.volume, activeClipId]);

  // STEP 7.6 (Audio Volume): the A1 <audio> element's own `.volume` was never wired to
  // activeAudioTrack.volume at all — the field existed on the data model since Step 1 but had
  // no UI and no playback effect, so it was fully inert. Kept as its own effect (distinct from
  // the mute effect above) so this clip-level volume and the preview-wide mute stay visibly
  // independent in the code, exactly as they must stay independent in behaviour — this never
  // touches `.muted`, and the mute effect above never touches `.volume`. Reruns whenever the
  // active track's own volume value changes (a slider drag) as well as on track switch/mount.
  useEffect(() => {
    if (audioRef.current && activeAudioTrack) audioRef.current.volume = activeAudioTrack.volume;
  }, [activeAudioTrack?.volume, activeAudioId]);

  // Step 5 follow-up (Defect: Overlay video audio): a video-backed Overlay's own <video> was
  // previously rendered `muted autoPlay loop`, playing independently on a loop of its own, never
  // reading timeline.currentTime/playing at all — so it was both silent and unsynchronised by
  // construction. This follows the exact same offset/seek/play-pause pattern the V1 Video and
  // A1 Audio sync effects above already use (no second playback engine): only mounted overlays
  // (the existing startTime/endTime filter in overlayLayer already handles visibility) get
  // synced here, each against its OWN startTime — same "independent of V1" principle Audio
  // already established. MediaOverlay has no trimIn/speed (unlike VideoClip), so the offset is
  // the plain elapsed-timeline-time formula, same shape as Audio's own (minus trimIn, which
  // Overlay doesn't have either — it always plays its source from wherever it currently is).
  useEffect(() => {
    mediaOverlays.forEach(o => {
      const el = overlayVideoRefs.current.get(o.id);
      if (!el) return; // not currently mounted (outside its own timeline range) — nothing to sync
      const offset = Math.max(0, timeline.currentTime - o.startTime);
      if (Math.abs(el.currentTime - offset) > 0.15) el.currentTime = offset;
      // STEP 7.6: preview-mute ORs on top of the overlay's own saved mute — toggling the
      // preview speaker off never touches/clears `o.muted` itself.
      el.muted = previewMuted || (o.muted ?? false);
      el.volume = o.volume ?? 1;
      if (timeline.playing) el.play().catch(() => {});
      else el.pause();
    });
  }, [timeline.currentTime, timeline.playing, mediaOverlays, previewMuted]);

  // ---- Media: real upload + drag source, same pattern as the working /studio Media Library ----
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const asset = await uploadAsset(file);
        addMediaAsset(asset);
      } catch {
        // uploadAsset already surfaces a chat error message
      }
    }
  };

  // ---- Video Deconstructor — Stage 2 (Reference Video Ingestion) ONLY: upload one video via
  // the exact same uploadAsset() call handleFiles above already uses, then wrap the resulting
  // asset in an immutable ReferenceVideo + pending VideoAnalysis. Ingestion only — no analysis
  // of any kind runs here (see backend/app/routers/reference_videos.py's own docstring). ----
  const handleImportExternalFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setRefIngestBusy(true);
    setRefIngestError(null);
    setRefIngestResult(null);
    try {
      const asset = await uploadAsset(file);
      // The underlying file is a genuine video asset too — usable anywhere in this editor like
      // any other uploaded video (drag onto V1, etc.), same as every other media-tab upload.
      addMediaAsset(asset);
      const { data } = await referenceVideosApi.ingest(asset.id);
      setRefIngestResult(data as ReferenceVideo);
    } catch (err) {
      // Same "read the backend's real detail message" convention the AI Prompt Generator
      // (runAiPromptGeneration, above) already established — never a generic message when the
      // backend gave a specific, actionable reason (e.g. "not a video" / "asset not found").
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setRefIngestError(detail || "Could not import this reference video — please try again.");
    } finally {
      setRefIngestBusy(false);
    }
  };

  // ---- Video Deconstructor — Stage 3 (Reference Video Technical Analysis) ONLY. Runs the
  // deterministic ffmpeg-based technical probe against the SAME already-ingested
  // ReferenceVideo — never re-uploads, never touches the file. Safe to call again after a
  // failure (creates a fresh analysis version server-side) or after success (idempotent,
  // returns the same completed result) — this handler itself has no special-casing for either,
  // it just always calls analyze() and replaces refIngestResult with whatever comes back. ----
  const handleAnalyzeReference = async () => {
    if (!refIngestResult) return;
    setRefAnalyzeBusy(true);
    setRefAnalyzeError(null);
    try {
      const { data } = await referenceVideosApi.analyze(refIngestResult.id);
      setRefIngestResult(data as ReferenceVideo);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setRefAnalyzeError(detail || "Could not analyse this reference video — please try again.");
    } finally {
      setRefAnalyzeBusy(false);
    }
  };

  // ---- Video Deconstructor — Stage 4 (Deterministic Shot/Cut Boundary Detection) ONLY. Same
  // "always call, replace refIngestResult with whatever comes back" shape as
  // handleAnalyzeReference above — safe to call again after a failure (retries in place
  // server-side) or after success (idempotent, returns the same completed shots). ----
  const handleAnalyzeStructure = async () => {
    if (!refIngestResult) return;
    setRefAnalyzeStructureBusy(true);
    setRefAnalyzeStructureError(null);
    try {
      const { data } = await referenceVideosApi.analyzeStructure(refIngestResult.id);
      setRefIngestResult(data as ReferenceVideo);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setRefAnalyzeStructureError(detail || "Could not analyse this reference video's structure — please try again.");
    } finally {
      setRefAnalyzeStructureBusy(false);
    }
  };

  // ---- Video Deconstructor — Stage 5 (Visual Evidence / Representative Frames) ONLY. Same
  // "always call, replace refIngestResult with whatever comes back" shape as
  // handleAnalyzeStructure above — safe to call again after a failure (retries in place
  // server-side) or after success (idempotent, returns the same completed frames). ----
  const handleAnalyzeFrames = async () => {
    if (!refIngestResult) return;
    setRefAnalyzeFramesBusy(true);
    setRefAnalyzeFramesError(null);
    try {
      const { data } = await referenceVideosApi.analyzeFrames(refIngestResult.id);
      setRefIngestResult(data as ReferenceVideo);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setRefAnalyzeFramesError(detail || "Could not extract visual evidence for this reference video — please try again.");
    } finally {
      setRefAnalyzeFramesBusy(false);
    }
  };

  // Reference Preview (post-Stage-4 UI gap fix): seeks ONLY the independent reference player —
  // never timeline.currentTime, never videoRef (the editor's own V1 element). Pauses at the
  // target so a boundary can be inspected frame-by-frame rather than immediately playing past
  // it, matching the actual use case ("visually inspect the reference immediately before/after
  // that boundary"). Also records which Shot is "selected" (for the row's own highlight) and
  // updates refPreviewTime immediately — not just via the video's own timeupdate event — so the
  // on-screen readout reflects the new position the instant a row is clicked, not on the next
  // ~250ms timeupdate tick.
  const handleSeekReferencePreview = (shotId: number, seconds: number) => {
    setSelectedShotId(shotId);
    const vid = refPreviewVideoRef.current;
    if (!vid) return;
    vid.currentTime = seconds;
    vid.pause();
    setRefPreviewTime(seconds);
  };

  // Stage 5 (Visual Evidence): identical seek behaviour to handleSeekReferencePreview above (same
  // ref, same independence from the editor — see that function's own comment), plus tracking
  // which specific frame thumbnail is selected so ITS OWN card can be highlighted, not just its
  // parent Shot row's.
  const handleSeekReferencePreviewToFrame = (shotId: number, frameId: number, seconds: number) => {
    setSelectedFrameId(frameId);
    handleSeekReferencePreview(shotId, seconds);
  };

  // ---- Text tab (Instruction 4): reuses the exact existing TextOverlay data model and
  // addTextOverlay action already used by legacy /studio's TextOverlayEditor — same field
  // defaults, same shared StudioContext array. No new architecture. Newly-added text is
  // selected immediately so the ALREADY-EXISTING selectedText editor in Properties (added
  // before this instruction) is what you use to refine it — not a new editing UI. ----
  const handleAddText = () => {
    const overlay: TextOverlay = {
      id: crypto.randomUUID(),
      text: "New Text",
      x: 5, y: 80, width: 90,
      startTime: timeline.currentTime,
      endTime: Math.min(timeline.currentTime + 5, effectiveDuration || timeline.currentTime + 5),
      fontFamily: "Inter", fontSize: 48, bold: true, italic: false,
      color: "#FFFFFF", bgColor: "transparent", bgOpacity: 0.7, animation: "fade_in",
    };
    addTextOverlay(overlay);
    setSelectedElement({ type: "text", id: overlay.id });
  };

  // ---- Overlays tab (Instruction 4): reuses the exact existing MediaOverlay data model,
  // addMediaOverlay action and upload pattern already used by legacy /studio's
  // MediaOverlayEditor. No new architecture. ----
  const overlayFileInputRef = useRef<HTMLInputElement>(null);
  const handleAddOverlayFile = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const asset = await uploadAsset(file);
      const overlay: MediaOverlay = {
        id: crypto.randomUUID(), url: assetsApi.previewUrl(asset.file_path), assetId: asset.id,
        x: 10, y: 10, width: 30, height: 30, opacity: 1,
        startTime: timeline.currentTime,
        endTime: Math.min(timeline.currentTime + 5, effectiveDuration || timeline.currentTime + 5),
      };
      addMediaOverlay(overlay);
    } catch {
      // uploadAsset already surfaces a chat error message
    }
  };

  // ---- Audio → A1 timeline (Instruction 9): reuses the exact existing AudioTrack model and
  // addAudioTrack action already used by legacy /studio's AudioTrackControls, including its
  // startTime insertion convention (append after the last existing audio track's endTime —
  // the same convention V1 video clips already use for themselves). Duration comes from the
  // real file via probeVideoDuration — already used for V1 video clips, and generic enough to
  // read real duration off an audio-only file too (HTMLMediaElement.duration isn't video-
  // specific), so no new probing logic was needed. ----
  const handleAddAudioToTimeline = async (asset: Asset) => {
    const url = assetsApi.previewUrl(asset.file_path);
    const duration = await probeVideoDuration(url);
    const start = audioTracks.reduce((a, t) => Math.max(a, t.endTime), 0);
    const track: AudioTrack = {
      id: crypto.randomUUID(), assetId: asset.id, url,
      name: asset.original_filename.replace(/\.[^.]+$/, ""),
      volume: 1, startTime: start, endTime: start + duration,
      trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0, duck: false,
    };
    addAudioTrack(track);
    setSelectedElement({ type: "audio", id: track.id });
  };

  // ---- Media Library: Delete / Remove (new — the library grid previously had no way to
  // remove an uploaded item at all). Only ever removes this SESSION's local mediaAssets entry
  // (see StudioContext's own removeMediaAsset comment) — never the backend file/DB row, which
  // other saved drafts may still reference. ----
  const isAssetUsedOnTimeline = (assetId: number) =>
    videoClips.some(c => c.assetId === assetId) ||
    mediaOverlays.some(o => o.assetId === assetId) ||
    audioTracks.some(a => a.assetId === assetId);

  const handleDeleteMediaAsset = (asset: Asset) => {
    const used = isAssetUsedOnTimeline(asset.id);
    const confirmed = window.confirm(
      used
        ? "This media is currently used in the project. Removing it will also remove its timeline instances. Continue?"
        : "Remove this media from the library?"
    );
    if (!confirmed) return;

    if (used) {
      // One history entry covers every timeline instance this removes, so Undo brings all of
      // them back together — same "one pushHistory, then raw calls" pattern Ripple Delete and
      // layer-reorder already use for a single user action that touches several items at once.
      pushHistory();
      videoClips.filter(c => c.assetId === asset.id).forEach(c => rawRemoveVideoClip(c.id));
      mediaOverlays.filter(o => o.assetId === asset.id).forEach(o => rawRemoveMediaOverlay(o.id));
      audioTracks.filter(a => a.assetId === asset.id).forEach(a => rawRemoveAudioTrack(a.id));
      if (
        selectedElement &&
        ((selectedElement.type === "clip" && videoClips.find(c => c.id === selectedElement.id)?.assetId === asset.id) ||
          (selectedElement.type === "overlay" && mediaOverlays.find(o => o.id === selectedElement.id)?.assetId === asset.id) ||
          (selectedElement.type === "audio" && audioTracks.find(a => a.id === selectedElement.id)?.assetId === asset.id))
      ) {
        setSelectedElement(null);
      }
    }
    // The library-list entry itself is intentionally NOT part of Undo/Redo history — Step 6
    // scoped history to the four timeline content arrays only; this is a step above that (an
    // uploaded file leaving the library), same category as removing an upload has always been.
    removeMediaAsset(asset.id);
  };

  const mediaItems = useMemo(() => {
    return mediaAssets
      .map(a => ({ asset: a, kind: assetKind(a.file_type) }))
      .filter((m): m is { asset: Asset; kind: "Videos" | "Images" | "Audio" } => !!m.kind)
      .filter(m => mediaTab === "All" || m.kind === mediaTab)
      .filter(m => !search || m.asset.original_filename.toLowerCase().includes(search.toLowerCase()));
  }, [mediaAssets, mediaTab, search]);

  // ---- Timeline: real V1 drop target (Media Library → V1), same mechanism as /studio ----
  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropActive(false);
    const raw = e.dataTransfer.getData(MEDIA_ASSET_DRAG_TYPE);
    if (!raw) return;
    let payload: MediaAssetDragPayload;
    try { payload = JSON.parse(raw); } catch { return; }
    const duration = await probeVideoDuration(payload.url);
    const start = videoClips.reduce((a, c) => Math.max(a, c.endTime), 0);
    const clip: VideoClip = {
      id: crypto.randomUUID(), assetId: payload.assetId, url: payload.url, name: payload.name,
      duration, startTime: start, endTime: start + duration,
      trimIn: 0, trimOut: 0, colorGrade: "none", speed: 1,
      brightness: 0, contrast: 0, saturation: 0, transition: "cut", transitionDuration: 0.5,
    };
    addVideoClip(clip);

    // Instruction 12: if the video carries its own audio, mirror it onto A1 as a genuine,
    // independent AudioTrack — same startTime/endTime as the video initially (so they start
    // together and stay in sync until either is moved/trimmed independently), same assetId as
    // the video clip (the existing, lightweight "came from this source" link the data model
    // already supports — no new field, no grouping system), and the SAME file url: an <audio>
    // element given a video file's url already decodes just its audio track natively, so no
    // separate extraction/transcoding step exists or is needed. A silent video (probe resolves
    // false) creates nothing here — no empty/fake Audio clip.
    const hasAudio = await probeHasAudioTrack(payload.url);
    if (hasAudio) {
      const audioTrack: AudioTrack = {
        id: crypto.randomUUID(), assetId: payload.assetId, url: payload.url,
        name: `${payload.name} (Audio)`,
        volume: 1, startTime: start, endTime: start + duration,
        trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0, duck: false,
      };
      addAudioTrack(audioTrack);
    }
  };

  const seekRatio = (ratio: number) => setTimeline({ currentTime: Math.max(0, Math.min(1, ratio)) * effectiveDuration });

  // Instruction 13: Playhead scrubbing — extends the existing ruler click-to-seek (still the
  // exact same seekRatio math) into a continuous mousedown+move+up drag, so a plain click still
  // just jumps once (zero movement) and a drag scrubs continuously. Independent of every clip:
  // it only ever calls setTimeline, never touches videoClips/textOverlays/audioTracks/
  // mediaOverlays or any trim/move handler.
  const handleScrubMove = (e: MouseEvent) => {
    const rulerEl = rulerRef.current;
    if (!rulerEl) return;
    const rect = rulerEl.getBoundingClientRect();
    seekRatio((e.clientX - rect.left) / rect.width);
  };
  const handleScrubEnd = () => {
    window.removeEventListener("mousemove", handleScrubMove);
    window.removeEventListener("mouseup", handleScrubEnd);
  };
  const beginScrub = (e: React.MouseEvent) => {
    e.preventDefault(); // no native text-selection while scrubbing
    const rect = e.currentTarget.getBoundingClientRect();
    seekRatio((e.clientX - rect.left) / rect.width); // immediate jump on mousedown — covers a plain click
    window.addEventListener("mousemove", handleScrubMove);
    window.addEventListener("mouseup", handleScrubEnd);
  };
  // The Playhead's own grabber is a separate element from the ruler itself, but needs the exact
  // same drag math against the ruler's rect (not its own) — a tiny wrapper around beginScrub.
  const beginScrubFromGrabber = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rulerEl = rulerRef.current;
    if (!rulerEl) return;
    e.preventDefault();
    const rect = rulerEl.getBoundingClientRect();
    seekRatio((e.clientX - rect.left) / rect.width);
    window.addEventListener("mousemove", handleScrubMove);
    window.addEventListener("mouseup", handleScrubEnd);
  };

  // Instruction 13: IN/OUT range markers — reuse the existing timeline.markIn/markOut fields
  // (already part of TimelineState, never previously wired to anything). Purely a "range I want
  // to work/play within" annotation: never writes to any clip, never touches trimIn/trimOut.
  const markDragRef = useRef<"in" | "out" | null>(null);
  const handleMarkMove = (e: MouseEvent) => {
    const mode = markDragRef.current;
    const rulerEl = rulerRef.current;
    if (!mode || !rulerEl || effectiveDuration <= 0) return;
    const rect = rulerEl.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * effectiveDuration;
    if (mode === "in") {
      const maxIn = timeline.markOut ?? effectiveDuration;
      setTimeline({ markIn: Math.min(t, maxIn) });
    } else {
      const minOut = timeline.markIn ?? 0;
      setTimeline({ markOut: Math.max(t, minOut) });
    }
  };
  const handleMarkEnd = () => {
    markDragRef.current = null;
    window.removeEventListener("mousemove", handleMarkMove);
    window.removeEventListener("mouseup", handleMarkEnd);
  };
  const beginMarkDrag = (mode: "in" | "out") => (e: React.MouseEvent) => {
    e.stopPropagation(); // don't also start a ruler scrub on the same mousedown
    e.preventDefault();
    markDragRef.current = mode;
    window.addEventListener("mousemove", handleMarkMove);
    window.addEventListener("mouseup", handleMarkEnd);
  };

  const sendQuickPrompt = (text: string) => { void sendChatMessage(text); };

  const selectedClip = selectedElement?.type === "clip" && selectedElement.lane === "video"
    ? videoClips.find(c => c.id === selectedElement.id) ?? null
    : null;
  const selectedText = selectedElement?.type === "text"
    ? textOverlays.find(t => t.id === selectedElement.id) ?? null
    : null;
  // Overlay selection (extends the exact same real-data-model pattern as selectedClip/
  // selectedText above — id lookup into the array StudioContext already owns, nothing new).
  const selectedOverlay = selectedElement?.type === "overlay"
    ? mediaOverlays.find(o => o.id === selectedElement.id) ?? null
    : null;
  // STEP 7 (Platform Canvas / Full-Screen Video Acceptance): which clip the toolbar's Fit/Fill/
  // Crop & Reposition dropdown acts on — the explicitly selected clip if there is one (matching
  // every other per-clip control's precedence in this file), otherwise whichever clip the
  // preview is currently showing, so the toolbar (sitting right over the canvas) stays useful
  // without first requiring a timeline selection.
  const cropTargetClip = selectedClip ?? activeVideoClip;
  // Instruction 8: Audio's Timeline clip is now draggable, which requires it to select on
  // mousedown (same as every other lane) — so it needs to actually participate in the
  // selection-identification summary too, reusing the exact same mechanism every other type
  // already uses. Audio still has no canvas representation (sound has no position) and no
  // dedicated Properties editor — this is identification only, same as canvasItem's minimal case.
  const selectedAudio = selectedElement?.type === "audio"
    ? audioTracks.find(a => a.id === selectedElement.id) ?? null
    : null;
  const selectedCanvasItem = selectedElement?.type === "canvasItem" ? selectedElement : null;

  const overlayLabel = (o: MediaOverlay) => o.url.split(/[\\/]/).pop() || "Overlay";
  // Step 5 follow-up (Defect 3): MediaOverlay's data model has no stored media-kind field —
  // handleAddOverlayFile's own upload input already accepts "video/*,image/*" and stores
  // whatever real file was uploaded under the exact same generic `url`/`assetId` fields either
  // way, so the architecture already supports a video-backed Overlay with zero model change.
  // The actual gap was purely in rendering (see overlayLayer below): it only ever drew a fixed
  // 🖼 placeholder, for image AND video alike, never the real asset. This checks the URL's own
  // file extension (no new field needed) to decide which real media element to render.
  const isVideoOverlayUrl = (url: string) => /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i.test(url);

  // Step 5 follow-up (Filters/Adjust): ported verbatim from the already-approved, already-
  // shipped legacy /studio PreviewCanvas.getVideoFilter() (same brightness/contrast/saturation
  // formula, same colour-grade cases), extended with one new 'sepia' case per this step's
  // requested minimum set — reused here rather than re-derived, and shared by both VideoClip
  // and MediaOverlay since Step 5 gave MediaOverlay the exact same optional field shape. Every
  // field is optional/non-destructive: an element with none of them set renders with no filter
  // at all, identical to before this step.
  const getMediaFilter = (m: { colorGrade?: VideoClip["colorGrade"]; brightness?: number; contrast?: number; saturation?: number }) => {
    const filters: string[] = [];
    if (m.brightness) filters.push(`brightness(${1 + m.brightness / 100})`);
    if (m.contrast) filters.push(`contrast(${1 + m.contrast / 100})`);
    if (m.saturation) filters.push(`saturate(${1 + m.saturation / 100})`);
    switch (m.colorGrade) {
      case "bw": filters.push("grayscale(1)"); break;
      case "sepia": filters.push("sepia(0.8)"); break;
      case "warm": filters.push("sepia(0.3) saturate(1.2)"); break;
      case "cool": filters.push("hue-rotate(20deg) saturate(0.9)"); break;
      case "high_contrast": filters.push("contrast(1.4)"); break;
    }
    return filters.length ? filters.join(" ") : undefined;
  };

  // Step 5 follow-up (Transitions): "Fade" only — a plain fade-to/from-black at a clip's own
  // cut points, driven purely by the existing timeline clock (no second playback engine, no new
  // clip overlap). `.video-preview.real`'s own background is already solid black, so fading the
  // video element's opacity down naturally reveals black behind it — nothing else to composite.
  // True Crossfade/Dissolve (blending the OUTGOING clip's video WITH the incoming one) would
  // need two clips' source frames rendered and composited simultaneously during the overlap —
  // this architecture has exactly one <video ref={videoRef}> showing "the current clip" at any
  // moment (switched by source on cut), so that's a real second-video-element architecture
  // change, not implemented here — see the report.
  const getClipTransitionOpacity = (clip: VideoClip, t: number) => {
    if (clip.transition !== "fade_black" || clip.transitionDuration <= 0) return 1;
    const d = clip.transitionDuration;
    const intoClip = t - clip.startTime;
    const beforeEnd = clip.endTime - t;
    if (intoClip < d) return Math.max(0, Math.min(1, intoClip / d));
    if (beforeEnd < d) return Math.max(0, Math.min(1, beforeEnd / d));
    return 1;
  };

  // Selection identification shown at the top of Properties, regardless of which kind of
  // element is selected — satisfies "recognise what type was selected" without building any
  // deeper editor for it yet.
  const selectionSummary = selectedClip
    ? { kind: "Video", name: selectedClip.name || "V1 Video" }
    : selectedText
    ? { kind: "Text", name: selectedText.text.slice(0, 24) || "Headline" }
    : selectedOverlay
    ? { kind: "Overlay", name: overlayLabel(selectedOverlay) }
    : selectedAudio
    ? { kind: "Audio", name: selectedAudio.name }
    : selectedCanvasItem
    ? { kind: selectedCanvasItem.kind, name: selectedCanvasItem.name }
    : null;

  // Click-to-select for the canvas — real DOM elements with native click handling, so no
  // manual coordinate math is needed even though the preview itself is scaled to fit the
  // selected format (see fitCanvasBox above): the browser already resolves clicks against
  // wherever it actually rendered each element.
  const selectCanvasItem = (id: string, kind: string, name: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedElement({ type: "canvasItem", id, kind, name });
  };
  const isCanvasItemSelected = (id: string) => selectedCanvasItem?.id === id;

  // Guards against one edge case: dragging past the boundary clamp (element stops, pointer
  // keeps moving) can release the pointer off the element, over the canvas background — the
  // resulting click would otherwise deselect right after the drag, breaking "selection remains
  // after releasing" (Instruction 3 §7). Suppressed for exactly the one click following a drag.
  const justDraggedRef = useRef(false);
  const deselectCanvas = () => {
    if (justDraggedRef.current) { justDraggedRef.current = false; return; }
    setSelectedElement(null);
  };

  // Drag-to-move (Instruction 3) — selection-only elements (Logo, Graphic, CTA) never get
  // these handlers, so they stay exactly as Instruction 2 left them. Position is tracked as a
  // fraction of the canvas box, so a plain click (zero movement) is a no-op write of the same
  // value, and a real drag stays clamped so the element can't leave the canvas boundary.
  const handleCanvasItemDragMove = (e: MouseEvent) => {
    const s = dragSessionRef.current;
    if (!s) return;
    const dxPct = (e.clientX - s.startClientX) / s.boxW;
    const dyPct = (e.clientY - s.startClientY) / s.boxH;
    const maxXPct = Math.max(0, (s.boxW - s.elW) / s.boxW);
    const maxYPct = Math.max(0, (s.boxH - s.elH) / s.boxH);
    const nextXPct = Math.min(maxXPct, Math.max(0, s.origXPct + dxPct));
    const nextYPct = Math.min(maxYPct, Math.max(0, s.origYPct + dyPct));
    setCanvasItemPosition(s.id, { xPct: nextXPct, yPct: nextYPct });
  };
  const handleCanvasItemDragEnd = () => {
    dragSessionRef.current = null;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0); // clears after this tick's trailing click, if any
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleCanvasItemDragMove);
    window.removeEventListener("mouseup", handleCanvasItemDragEnd);
  };
  const beginCanvasItemDrag = (id: string, kind: string, name: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault(); // no native text-selection/ghost-drag while moving the element
    setSelectedElement({ type: "canvasItem", id, kind, name });
    if (!DRAGGABLE_CANVAS_ITEM_IDS.has(id)) return; // selected, but not one of this instruction's movable elements
    const boxEl = videoPreviewBoxRef.current;
    const el = e.currentTarget as HTMLElement;
    if (!boxEl) return;
    const boxRect = boxEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const existing = canvasItemPositions[id];
    const origXPct = existing ? existing.xPct : (elRect.left - boxRect.left) / boxRect.width;
    const origYPct = existing ? existing.yPct : (elRect.top - boxRect.top) / boxRect.height;
    dragSessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, elW: elRect.width, elH: elRect.height,
      startClientX: e.clientX, startClientY: e.clientY, origXPct, origYPct,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleCanvasItemDragMove);
    window.addEventListener("mouseup", handleCanvasItemDragEnd);
  };
  // Inline style override for a canvas item once it has been dragged at least once — before
  // that it renders exactly as the locked baseline laid it out (untouched CSS flow position).
  const canvasItemDragStyle = (id: string): React.CSSProperties | undefined => {
    const pos = canvasItemPositions[id];
    if (!pos) return undefined;
    return { position: "absolute", left: `${pos.xPct * 100}%`, top: `${pos.yPct * 100}%`, margin: 0, right: "auto", bottom: "auto" };
  };

  // Text drag-to-move (Instruction 7) — same percentage-delta-and-clamp approach as
  // handleCanvasItemDrag* above, but writes into TextOverlay's OWN existing x/y (%) fields via
  // the existing updateTextOverlay action, instead of the separate canvasItemPositions map.
  // TextOverlay already has real x/y for every item (set on creation in handleAddText), so —
  // unlike canvasItemPositions — there's no "undefined until first drag" state to handle.
  const handleTextDragMove = (e: MouseEvent) => {
    const s = dragTextSessionRef.current;
    if (!s) return;
    if (!textDragMovedRef.current) { pushHistory(); textDragMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const dyPct = ((e.clientY - s.startClientY) / s.boxH) * 100;
    const maxX = Math.max(0, 100 - (s.elW / s.boxW) * 100);
    const maxY = Math.max(0, 100 - (s.elH / s.boxH) * 100);
    const nextX = Math.min(maxX, Math.max(0, s.origX + dxPct));
    const nextY = Math.min(maxY, Math.max(0, s.origY + dyPct));
    rawUpdateTextOverlay(s.id, { x: nextX, y: nextY }); // Step 6: raw — history snapshot taken above, once, on the first tick of this gesture
  };
  const handleTextDragEnd = () => {
    dragTextSessionRef.current = null;
    justDraggedRef.current = true; // same guard as canvas-item drag — prevents a boundary-clamped release from deselecting
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleTextDragMove);
    window.removeEventListener("mouseup", handleTextDragEnd);
  };
  const beginTextDrag = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault(); // no native text-selection/ghost-drag while moving the element
    setSelectedElement({ type: "text", id });
    const boxEl = videoPreviewBoxRef.current;
    const el = e.currentTarget as HTMLElement;
    const overlay = textOverlays.find(t => t.id === id);
    if (!boxEl || !overlay) return;
    textDragMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    dragTextSessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, elW: elRect.width, elH: elRect.height,
      startClientX: e.clientX, startClientY: e.clientY, origX: overlay.x, origY: overlay.y,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleTextDragMove);
    window.addEventListener("mouseup", handleTextDragEnd);
  };
  // Step 5 follow-up (Defect 2): Text corner-resize — changes only x + width (TextOverlay has
  // no height field; its box height is implicit, driven by content/width/fontSize/line-height
  // via existing CSS, so resize never invents one). A "left" corner (nw/sw) keeps the box's
  // right edge fixed and drags the left edge; a "right" corner (ne/se) keeps the left edge
  // fixed and drags the right edge — same convention ClipBlock's trim handles already use for
  // timeline start/end. Font size is untouched by this — resizing the box never resizes the
  // text, preserving the existing font-size/box-width distinction the Properties panel already
  // treats as two separate controls.
  const handleTextResizeMove = (e: MouseEvent) => {
    const s = resizeTextSessionRef.current;
    if (!s) return;
    if (!textResizeMovedRef.current) { pushHistory(); textResizeMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const isLeft = s.corner === "nw" || s.corner === "sw";
    let nextWidth = isLeft ? s.origWidth - dxPct : s.origWidth + dxPct;
    nextWidth = Math.max(MIN_ELEMENT_SIZE_PCT, nextWidth);
    let nextX = s.origX;
    if (isLeft) {
      nextX = s.origX + (s.origWidth - nextWidth); // right edge stays put
      if (nextX < 0) { nextWidth += nextX; nextX = 0; } // clamp to canvas left edge
    } else if (nextX + nextWidth > 100) {
      nextWidth = 100 - nextX; // clamp to canvas right edge
    }
    rawUpdateTextOverlay(s.id, { x: nextX, width: Math.max(MIN_ELEMENT_SIZE_PCT, nextWidth) }); // Step 6: raw, see handleTextDragMove above
  };
  const handleTextResizeEnd = () => {
    resizeTextSessionRef.current = null;
    justDraggedRef.current = true; // same boundary-clamp-release guard as every other canvas drag
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleTextResizeMove);
    window.removeEventListener("mouseup", handleTextResizeEnd);
  };
  const beginTextResize = (id: string, corner: ResizeCorner) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const boxEl = videoPreviewBoxRef.current;
    const overlay = textOverlays.find(t => t.id === id);
    if (!boxEl || !overlay) return;
    textResizeMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    resizeTextSessionRef.current = {
      id, boxW: boxRect.width, startClientX: e.clientX, corner,
      origX: overlay.x, origWidth: overlay.width,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleTextResizeMove);
    window.addEventListener("mouseup", handleTextResizeEnd);
  };
  // Step 5 follow-up (Defect 2): Overlay drag-to-move — the exact same percentage-delta-and-
  // clamp approach as handleTextDragMove/beginTextDrag above, writing into MediaOverlay's OWN
  // existing x/y (%) fields via updateMediaOverlay instead of TextOverlay's. MediaOverlay was
  // rendered on canvas back in Instruction 6 as selection-only ("no drag/resize yet", per that
  // instruction's own comment) — this was never a regression, just a gap never closed. This is
  // purely a canvas X/Y move: it only ever calls updateMediaOverlay({x, y}), never touching
  // startTime/endTime, so it can never affect the overlay's timeline position — and conversely
  // the timeline's own body-drag (onMove in the O1 TrackRow) only ever writes startTime/endTime,
  // never x/y, so the two remain fully independent in both directions by construction.
  const handleOverlayDragMove = (e: MouseEvent) => {
    const s = dragOverlaySessionRef.current;
    if (!s) return;
    if (!overlayDragMovedRef.current) { pushHistory(); overlayDragMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const dyPct = ((e.clientY - s.startClientY) / s.boxH) * 100;
    const maxX = Math.max(0, 100 - (s.elW / s.boxW) * 100);
    const maxY = Math.max(0, 100 - (s.elH / s.boxH) * 100);
    const nextX = Math.min(maxX, Math.max(0, s.origX + dxPct));
    const nextY = Math.min(maxY, Math.max(0, s.origY + dyPct));
    rawUpdateMediaOverlay(s.id, { x: nextX, y: nextY }); // Step 6: raw, see handleTextDragMove above
  };
  const handleOverlayDragEnd = () => {
    dragOverlaySessionRef.current = null;
    justDraggedRef.current = true; // same guard as canvas-item/Text drag — prevents a boundary-clamped release from deselecting
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleOverlayDragMove);
    window.removeEventListener("mouseup", handleOverlayDragEnd);
  };
  const beginOverlayDrag = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault(); // no native text-selection/ghost-drag while moving the element
    setSelectedElement({ type: "overlay", id });
    const boxEl = videoPreviewBoxRef.current;
    const el = e.currentTarget as HTMLElement;
    const overlay = mediaOverlays.find(o => o.id === id);
    if (!boxEl || !overlay) return;
    overlayDragMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    dragOverlaySessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, elW: elRect.width, elH: elRect.height,
      startClientX: e.clientX, startClientY: e.clientY, origX: overlay.x, origY: overlay.y,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleOverlayDragMove);
    window.addEventListener("mouseup", handleOverlayDragEnd);
  };
  // STEP 7 (Platform Canvas / Full-Screen Video Acceptance): drag-to-reposition for a clip in
  // Fill mode — same percentage-delta-and-clamp shape as handleOverlayDragMove above, writing
  // into VideoClip's own cropOffsetX/Y instead of MediaOverlay's x/y. cropOffsetX/Y map directly
  // onto CSS object-position (see the <video> element's style below and build_clip_segment on
  // the export side), whose own convention is: increasing X% reveals more of the source's RIGHT
  // side (the source's right edge slides toward the container's right edge). Dragging the
  // VISIBLE CONTENT — i.e. what the user actually sees under their cursor — is the more
  // intuitive direction for a crop-reposition handle (matching how dragging a photo in a crop
  // tool moves the photo, not the window), so the sign is inverted: dragging right subtracts
  // from cropOffsetX, revealing more of the LEFT side, exactly as if the frame were being
  // pushed rightward under a fixed viewport.
  const handleCropDragMove = (e: MouseEvent) => {
    const s = cropDragSessionRef.current;
    if (!s) return;
    if (!cropDragMovedRef.current) { pushHistory(); cropDragMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const dyPct = ((e.clientY - s.startClientY) / s.boxH) * 100;
    const nextOffsetX = Math.min(100, Math.max(0, s.origOffsetX - dxPct));
    const nextOffsetY = Math.min(100, Math.max(0, s.origOffsetY - dyPct));
    rawUpdateVideoClip(s.id, { cropOffsetX: nextOffsetX, cropOffsetY: nextOffsetY }); // Step 6: raw during drag, see handleOverlayDragMove above
  };
  const handleCropDragEnd = () => {
    cropDragSessionRef.current = null;
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleCropDragMove);
    window.removeEventListener("mouseup", handleCropDragEnd);
  };
  const beginCropDrag = (clip: VideoClip) => (e: React.MouseEvent) => {
    if (repositionClipId !== clip.id) return; // only while this clip's reposition handle is armed
    e.stopPropagation();
    e.preventDefault();
    const boxEl = videoPreviewBoxRef.current;
    if (!boxEl) return;
    cropDragMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    cropDragSessionRef.current = {
      id: clip.id, boxW: boxRect.width, boxH: boxRect.height,
      startClientX: e.clientX, startClientY: e.clientY,
      origOffsetX: clip.cropOffsetX ?? 50, origOffsetY: clip.cropOffsetY ?? 50,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleCropDragMove);
    window.addEventListener("mouseup", handleCropDragEnd);
  };
  // STEP 7 (Platform Canvas / Full-Screen Video Acceptance): the three Fit/Fill/Crop &
  // Reposition actions the toolbar's Crop dropdown offers, applied to whichever clip is
  // currently selected on the timeline, falling back to whichever clip the preview is showing
  // right now if none is selected — so the toolbar (right next to the canvas) stays useful
  // without first requiring a trip to select a clip, while a real selection still takes
  // precedence, consistent with every other per-clip control in this file. "Fit" and "Fill"
  // are one-shot, discrete actions (pushHistory via the existing updateVideoClip wrapper, same
  // as every other clip-property change in this file); "Crop & Reposition" additionally arms
  // the drag handle above without itself changing history (arming isn't a data change).
  const applyClipFitMode = (clip: VideoClip, mode: "fit" | "fill") => {
    updateVideoClip(clip.id, mode === "fit"
      ? { fitMode: "fit" }
      : { fitMode: "fill", cropOffsetX: clip.cropOffsetX ?? 50, cropOffsetY: clip.cropOffsetY ?? 50 });
    setRepositionClipId(null);
    setCropMenuOpen(false);
  };
  const enterCropReposition = (clip: VideoClip) => {
    if (clip.fitMode !== "fill") {
      updateVideoClip(clip.id, { fitMode: "fill", cropOffsetX: clip.cropOffsetX ?? 50, cropOffsetY: clip.cropOffsetY ?? 50 });
    }
    setRepositionClipId(clip.id);
    setCropMenuOpen(false);
  };
  // Step 5 follow-up (Defect 2): Overlay corner-resize — same left/right-edge-fixed convention
  // as Text's resize above, extended to the vertical axis too since MediaOverlay already has a
  // real `height` field (unlike Text). No aspect-ratio lock: the current data model has no
  // stored aspect ratio for the underlying asset (MediaOverlay never recorded the image's
  // natural dimensions), so free-form width/height resize is the correct behaviour without
  // inventing new tracking — the report calls this out explicitly rather than silently
  // pretending aspect-lock exists.
  const handleOverlayResizeMove = (e: MouseEvent) => {
    const s = resizeOverlaySessionRef.current;
    if (!s) return;
    if (!overlayResizeMovedRef.current) { pushHistory(); overlayResizeMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const dyPct = ((e.clientY - s.startClientY) / s.boxH) * 100;
    const isLeft = s.corner === "nw" || s.corner === "sw";
    const isTop = s.corner === "nw" || s.corner === "ne";
    let nextWidth = Math.max(MIN_ELEMENT_SIZE_PCT, isLeft ? s.origWidth - dxPct : s.origWidth + dxPct);
    let nextHeight = Math.max(MIN_ELEMENT_SIZE_PCT, isTop ? s.origHeight - dyPct : s.origHeight + dyPct);
    let nextX = isLeft ? s.origX + (s.origWidth - nextWidth) : s.origX;
    let nextY = isTop ? s.origY + (s.origHeight - nextHeight) : s.origY;
    if (isLeft && nextX < 0) { nextWidth += nextX; nextX = 0; }
    if (isTop && nextY < 0) { nextHeight += nextY; nextY = 0; }
    if (!isLeft && nextX + nextWidth > 100) nextWidth = 100 - nextX;
    if (!isTop && nextY + nextHeight > 100) nextHeight = 100 - nextY;
    rawUpdateMediaOverlay(s.id, { // Step 6: raw, see handleTextDragMove above
      x: nextX, y: nextY,
      width: Math.max(MIN_ELEMENT_SIZE_PCT, nextWidth), height: Math.max(MIN_ELEMENT_SIZE_PCT, nextHeight),
    });
  };
  const handleOverlayResizeEnd = () => {
    resizeOverlaySessionRef.current = null;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleOverlayResizeMove);
    window.removeEventListener("mouseup", handleOverlayResizeEnd);
  };
  const beginOverlayResize = (id: string, corner: ResizeCorner) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const boxEl = videoPreviewBoxRef.current;
    const overlay = mediaOverlays.find(o => o.id === id);
    if (!boxEl || !overlay) return;
    overlayResizeMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    resizeOverlaySessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, startClientX: e.clientX, startClientY: e.clientY, corner,
      origX: overlay.x, origY: overlay.y, origWidth: overlay.width, origHeight: overlay.height,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleOverlayResizeMove);
    window.addEventListener("mouseup", handleOverlayResizeEnd);
  };
  // Shared corner-handle renderer for both Text and Overlay canvas items — only rendered when
  // the element is selected, matching the existing "handles appear on selection" convention
  // ClipBlock's timeline trim handles already use.
  const resizeHandles = (onCorner: (corner: ResizeCorner) => (e: React.MouseEvent) => void) => (
    <>
      <div className="canvas-resize-handle nw" onMouseDown={onCorner("nw")} />
      <div className="canvas-resize-handle ne" onMouseDown={onCorner("ne")} />
      <div className="canvas-resize-handle sw" onMouseDown={onCorner("sw")} />
      <div className="canvas-resize-handle se" onMouseDown={onCorner("se")} />
    </>
  );

  // Layers reorder: the Layers-tab list, unlike the canvas stack above, always lists every
  // Text/Overlay regardless of whether the playhead is currently inside its range — same
  // "list everything" convention the existing Layers tab already used before this change.
  // Sorted descending (highest `order` first) so top-of-list reads as "front-most", matching
  // the same visual-editor convention (Photoshop/Figma-style layer panels) the canvas's own
  // ascending paint-order sort is the mirror image of.
  type VisualLayerRef = { type: "text" | "overlay"; id: string; order: number; label: string };
  const layersListVisual: VisualLayerRef[] = [
    ...textOverlays.map(t => ({ type: "text" as const, id: t.id, order: t.order ?? 0, label: `🔤 ${t.text.slice(0, 20)}` })),
    ...mediaOverlays.map(o => ({ type: "overlay" as const, id: o.id, order: o.order ?? 0, label: `🖼 ${overlayLabel(o)}` })),
  ].sort((a, b) => b.order - a.order);

  const dragLayerRef = useRef<{ type: "text" | "overlay"; id: string } | null>(null);
  // Dropping onto a row reassigns every visual layer's `order` in one pass — simplest way to
  // guarantee no two elements ever collide on the same order value after a reorder, and it
  // never touches anything else on either object (timing, position, size, media, filters, etc
  // are all separate fields, untouched here).
  const reorderVisualLayers = (dragged: { type: "text" | "overlay"; id: string }, targetIndex: number) => {
    const withoutDragged = layersListVisual.filter(l => !(l.type === dragged.type && l.id === dragged.id));
    const draggedEntry = layersListVisual.find(l => l.type === dragged.type && l.id === dragged.id);
    if (!draggedEntry) return;
    withoutDragged.splice(targetIndex, 0, draggedEntry);
    const n = withoutDragged.length;
    // Step 6: one drop reassigns every layer's `order` in a loop — one pushHistory() before the
    // loop, then raw updates inside it, so the whole reorder is one undo step, not one per layer.
    pushHistory();
    withoutDragged.forEach((l, i) => {
      const order = n - i; // index 0 (top of list) gets the highest order = front-most on canvas
      if (l.type === "text") rawUpdateTextOverlay(l.id, { order });
      else rawUpdateMediaOverlay(l.id, { order });
    });
  };

  // Overlay canvas rendering (Instruction 6, now with Defect-2's drag wired in): real
  // MediaOverlay items using its own existing x/y/width/height (%) fields — same convention
  // legacy /studio's MediaOverlayEditor already uses. Gated to its own startTime/endTime
  // (Instruction 8), same as textLayer below.
  // Layers reorder: each visual (canvas-rendered) element now carries its own `order` — higher
  // paints later, i.e. more in front. Video has no `order` field at all and is rendered as its
  // own separate base layer beneath this stack (see the JSX below, unchanged) — "remain the
  // background/base visual layer" is automatic, not something reorder logic needs to enforce.
  // Audio never had any canvas presence and still doesn't participate here.
  const overlayEntries = mediaOverlays
    .filter(o => timeline.currentTime >= o.startTime && timeline.currentTime < o.endTime)
    .map(o => ({
      order: o.order ?? 0,
      node: (
    <div
      key={o.id}
      className={`canvas-overlay-item canvas-selectable canvas-movable ${selectedElement?.type === "overlay" && selectedElement.id === o.id ? "canvas-el-selected" : ""}`}
      style={{ left: `${o.x}%`, top: `${o.y}%`, width: `${o.width}%`, height: `${o.height}%` }}
      onMouseDown={beginOverlayDrag(o.id)}
      onClick={e => e.stopPropagation()}
      title="Overlay — click and drag to move"
    >
      {isVideoOverlayUrl(o.url) ? (
        <video
          ref={el => { if (el) overlayVideoRefs.current.set(o.id, el); else overlayVideoRefs.current.delete(o.id); }}
          src={o.url} className="canvas-overlay-media" playsInline
          style={{ filter: getMediaFilter(o) }}
        />
      ) : (
        <img src={o.url} className="canvas-overlay-media" alt="" draggable={false} style={{ filter: getMediaFilter(o) }} />
      )}
      {selectedElement?.type === "overlay" && selectedElement.id === o.id && resizeHandles(corner => beginOverlayResize(o.id, corner))}
    </div>
      ),
    }));

  // Direct inline text editing on canvas: double-click now genuinely edits the text in place
  // (Step 5 had bridged double-click to the Properties textarea instead, deliberately avoiding
  // a second text system — this request specifically asks for that second system, so the
  // contentEditable div below IS the same TextOverlay.text state, not a separate one; the
  // Properties textarea (still present, untouched) reads/writes the exact same field, so
  // they're automatically synchronized by React re-rendering both from one source of truth).
  // caretRangeFromPoint places the cursor at the actual double-click position rather than
  // always at the start/end, matching "click at a particular position ... and type there".
  const enterTextEditMode = (id: string, currentText: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const clickX = e.clientX, clickY = e.clientY;
    setSelectedElement({ type: "text", id });
    setEditingTextId(id);
    // setTimeout (not requestAnimationFrame — same choice focusTextProperties made before this)
    // so the focus/caret placement below reliably runs after React commits the contentEditable
    // change, regardless of tab visibility/rAF throttling.
    setTimeout(() => {
      const el = textEditRefs.current.get(id);
      if (!el) return;
      // React just re-rendered this div's children as `null` (see textEntries below — while
      // editing, content is deliberately NOT driven by t.text as a child, so nothing here
      // fights the live DOM on every keystroke); reseed the actual DOM text ourselves before
      // placing the caret, since the div is genuinely empty at this exact point.
      el.innerText = currentText;
      el.focus();
      const caretRangeFromPoint = (document as unknown as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint;
      const range = caretRangeFromPoint?.call(document, clickX, clickY);
      const sel = window.getSelection();
      if (range && sel && el.contains(range.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }, 0);
  };

  // Exits edit mode and commits whatever's currently in the DOM one last time — onInput below
  // already keeps state live on every keystroke, but this guards against a browser blur firing
  // without a final input event (e.g. blurring mid-composition).
  const exitTextEditMode = (id: string) => (e: React.FocusEvent<HTMLDivElement>) => {
    rawUpdateTextOverlay(id, { text: e.currentTarget.innerText });
    setEditingTextId(null);
  };

  // Text canvas rendering (Instruction 7): real TextOverlay items had the exact same "never
  // rendered on canvas" gap that MediaOverlay had before Instruction 6 — the Text tab and
  // Layers already listed them, but the canvas itself never drew one.
  // Instruction 8: gated to its own startTime/endTime, same as overlayLayer above.
  const textEntries = textOverlays
    .filter(t => timeline.currentTime >= t.startTime && timeline.currentTime < t.endTime)
    .map(t => ({
      order: t.order ?? 0,
      node: (
    <div
      key={t.id}
      ref={el => { if (el) textEditRefs.current.set(t.id, el); else textEditRefs.current.delete(t.id); }}
      className={`canvas-text-item canvas-selectable canvas-movable ${selectedElement?.type === "text" && selectedElement.id === t.id ? "canvas-el-selected" : ""} ${editingTextId === t.id ? "canvas-text-editing" : ""}`}
      style={{
        left: `${t.x}%`, top: `${t.y}%`, width: `${t.width}%`,
        color: t.color, fontFamily: t.fontFamily, fontSize: t.fontSize,
        fontWeight: t.bold ? 700 : 400, fontStyle: t.italic ? "italic" : "normal",
      }}
      contentEditable={editingTextId === t.id}
      suppressContentEditableWarning
      // Instruction 10: while editing, mousedown must do nothing but let the browser's own
      // native click-to-place-caret / drag-to-select-text behaviour run — starting a drag
      // session here (like every other state) would move the whole element instead.
      onMouseDown={editingTextId === t.id ? e => e.stopPropagation() : beginTextDrag(t.id)}
      onClick={e => e.stopPropagation()}
      onDoubleClick={editingTextId === t.id ? undefined : enterTextEditMode(t.id, t.text)}
      // Step 6: one history snapshot for the whole edit session (mirrors the Properties
      // textarea's own onFocus={pushHistory} exactly), not one per keystroke.
      onFocus={editingTextId === t.id ? pushHistory : undefined}
      // Instruction 7/8: live on every keystroke, via the SAME field the Properties textarea
      // reads/writes — the two stay synchronized because both render from this one source of
      // truth, not because of any bridging code between them.
      onInput={editingTextId === t.id ? e => rawUpdateTextOverlay(t.id, { text: e.currentTarget.innerText }) : undefined}
      // Instruction 9: clicking anywhere else moves focus off this div, which fires blur
      // natively — no extra "click outside" listener needed.
      onBlur={editingTextId === t.id ? exitTextEditMode(t.id) : undefined}
      onKeyDown={editingTextId === t.id ? e => e.stopPropagation() : undefined}
      title={editingTextId === t.id ? undefined : "Text — click and drag to move, double-click to edit"}
    >
      {editingTextId === t.id ? null : t.text}
      {selectedElement?.type === "text" && selectedElement.id === t.id && editingTextId !== t.id && resizeHandles(corner => beginTextResize(t.id, corner))}
    </div>
      ),
    }));

  // Ascending sort: lowest `order` paints first (furthest back), highest paints last (furthest
  // front) — plain DOM paint order, no z-index needed. Ties (both default to 0, e.g. before any
  // reorder has ever happened) keep Array.sort's stable ordering, which preserves the exact
  // pre-existing "all Overlays behind all Text" look until the user actually reorders something.
  const visualLayers = [...overlayEntries, ...textEntries]
    .sort((a, b) => a.order - b.order)
    .map(e => e.node);

  // Instruction 10: trim handlers, one pair per lane type. Video/Audio use their existing
  // trimIn/trimOut fields — the clip's own probed `duration` (Video) is never touched, kept as
  // the immutable full-source reference, which is exactly what makes this non-destructive.
  // Text/Overlay have no "source" to reveal/hide, so trimming them is just moving the visible
  // start/end window — no equivalent ceiling, only the shared MIN_CLIP_DURATION floor.
  // Step 6: these fire on every mousemove tick of a trim drag (via ClipBlock's onTrimLeft/
  // onTrimRight), so they intentionally use the RAW update actions — history for the whole
  // trim gesture is captured once, in ClipBlock's onGestureStart, not once per tick.
  const trimVideoLeft = (c: VideoClip, proposedStart: number) => {
    const minStart = Math.max(0, c.startTime - c.trimIn); // can't reveal source earlier than exists
    const maxStart = c.endTime - MIN_CLIP_DURATION;
    const finalStart = Math.min(maxStart, Math.max(minStart, proposedStart));
    rawUpdateVideoClip(c.id, { startTime: finalStart, trimIn: c.trimIn + (finalStart - c.startTime) });
  };
  const trimVideoRight = (c: VideoClip, proposedEnd: number) => {
    const maxEnd = c.endTime + c.trimOut; // can't reveal source later than exists
    const minEnd = c.startTime + MIN_CLIP_DURATION;
    const finalEnd = Math.max(minEnd, Math.min(maxEnd, proposedEnd));
    rawUpdateVideoClip(c.id, { endTime: finalEnd, trimOut: c.trimOut + (c.endTime - finalEnd) });
  };
  const trimAudioLeft = (a: AudioTrack, proposedStart: number) => {
    const minStart = Math.max(0, a.startTime - a.trimIn);
    const maxStart = a.endTime - MIN_CLIP_DURATION;
    const finalStart = Math.min(maxStart, Math.max(minStart, proposedStart));
    rawUpdateAudioTrack(a.id, { startTime: finalStart, trimIn: a.trimIn + (finalStart - a.startTime) });
  };
  const trimAudioRight = (a: AudioTrack, proposedEnd: number) => {
    const maxEnd = a.endTime + a.trimOut;
    const minEnd = a.startTime + MIN_CLIP_DURATION;
    const finalEnd = Math.max(minEnd, Math.min(maxEnd, proposedEnd));
    rawUpdateAudioTrack(a.id, { endTime: finalEnd, trimOut: a.trimOut + (a.endTime - finalEnd) });
  };
  const trimTextLeft = (t: TextOverlay, proposedStart: number) =>
    rawUpdateTextOverlay(t.id, { startTime: Math.max(0, Math.min(proposedStart, t.endTime - MIN_CLIP_DURATION)) });
  const trimTextRight = (t: TextOverlay, proposedEnd: number) =>
    rawUpdateTextOverlay(t.id, { endTime: Math.max(t.startTime + MIN_CLIP_DURATION, proposedEnd) });
  const trimOverlayLeft = (o: MediaOverlay, proposedStart: number) =>
    rawUpdateMediaOverlay(o.id, { startTime: Math.max(0, Math.min(proposedStart, o.endTime - MIN_CLIP_DURATION)) });
  const trimOverlayRight = (o: MediaOverlay, proposedEnd: number) =>
    rawUpdateMediaOverlay(o.id, { endTime: Math.max(o.startTime + MIN_CLIP_DURATION, proposedEnd) });

  // Step 5: Split / Delete / Ripple Delete. The scissors (✂), delete (⌫) and one of the two
  // previously-inert mock icons (◫, repurposed for Ripple Delete — ◩ and ⧉ stay untouched/
  // inert, since "duplicate" is explicitly out of scope for this step) were pure decoration
  // before this — plain <button type="button"> with no onClick at all, wired to nothing. There
  // was no split/delete/ripple/undo/redo logic anywhere in this file or in StudioContext before
  // this step; removeVideoClip/removeTextOverlay/removeMediaOverlay/removeAudioTrack already
  // existed on StudioContext (used by legacy /studio) but were never imported/called here.
  //
  // Split validity (§5): rejects "no selection", "playhead outside clip", "at the exact start",
  // "at the exact end", and "resulting segment would be ~zero duration" all with the same one
  // check per type — reusing MIN_CLIP_DURATION (the existing trim-floor constant) as the split
  // margin, so a split is only allowed strictly enough inside the clip that both halves clear
  // the same minimum any trim already enforces. No error, no state change, just returns.
  //
  // Source-time correctness (§2): only Video/Audio carry trimIn/trimOut. Moving the body of a
  // clip already never touches trimIn/trimOut (see onMove above) — only startTime/endTime move
  // together. Splitting keeps that invariant for the shared boundary: the left half's new
  // trimOut grows by exactly the timeline span removed from its right (endTime→p), and the
  // right half's new trimIn grows by exactly the timeline span removed from its left
  // (startTime→p) — so `sourceTime = trimIn + (timelineTime - startTime)` lands on the exact
  // same source frame approaching p from the left half as it does leaving p on the right half.
  // No new asset/upload is created — the right half is a shallow copy of the same clip (same
  // assetId/url), just a new id and new startTime/trimIn.
  // Step 6: each branch below does an update + an add to accomplish ONE split — pushHistory()
  // once, only after the validity checks pass (an invalid/no-op split must never pollute
  // history with a snapshot nothing actually changed from), then raw calls for both halves, so
  // Undo reverses a whole split in one click, merging the two pieces back into the original.
  const handleSplitAtPlayhead = () => {
    const p = timeline.currentTime;
    if (!selectedElement) return;
    if (selectedElement.type === "clip" && selectedElement.lane === "video") {
      const c = videoClips.find(v => v.id === selectedElement.id);
      if (!c || p <= c.startTime + MIN_CLIP_DURATION || p >= c.endTime - MIN_CLIP_DURATION) return;
      pushHistory();
      const rightId = crypto.randomUUID();
      rawUpdateVideoClip(c.id, { endTime: p, trimOut: c.trimOut + (c.endTime - p) });
      rawAddVideoClip({ ...c, id: rightId, startTime: p, trimIn: c.trimIn + (p - c.startTime) });
      setSelectedElement({ type: "clip", lane: "video", id: rightId });
    } else if (selectedElement.type === "audio") {
      const a = audioTracks.find(x => x.id === selectedElement.id);
      if (!a || p <= a.startTime + MIN_CLIP_DURATION || p >= a.endTime - MIN_CLIP_DURATION) return;
      pushHistory();
      const rightId = crypto.randomUUID();
      rawUpdateAudioTrack(a.id, { endTime: p, trimOut: a.trimOut + (a.endTime - p) });
      rawAddAudioTrack({ ...a, id: rightId, startTime: p, trimIn: a.trimIn + (p - a.startTime) });
      setSelectedElement({ type: "audio", id: rightId });
    } else if (selectedElement.type === "text") {
      const t = textOverlays.find(x => x.id === selectedElement.id);
      if (!t || p <= t.startTime + MIN_CLIP_DURATION || p >= t.endTime - MIN_CLIP_DURATION) return;
      pushHistory();
      const rightId = crypto.randomUUID();
      rawUpdateTextOverlay(t.id, { endTime: p });
      rawAddTextOverlay({ ...t, id: rightId, startTime: p }); // independent copy — editing one afterwards can never touch the other
      setSelectedElement({ type: "text", id: rightId });
    } else if (selectedElement.type === "overlay") {
      const o = mediaOverlays.find(x => x.id === selectedElement.id);
      if (!o || p <= o.startTime + MIN_CLIP_DURATION || p >= o.endTime - MIN_CLIP_DURATION) return;
      pushHistory();
      const rightId = crypto.randomUUID();
      rawUpdateMediaOverlay(o.id, { endTime: p });
      rawAddMediaOverlay({ ...o, id: rightId, startTime: p }); // same underlying asset/url, independent timeline segment
      setSelectedElement({ type: "overlay", id: rightId });
    }
  };

  // Normal Delete (§7/§17): removes only the selected element via the existing remove* action —
  // it never touches any other element's startTime/endTime, so the gap it leaves is a natural
  // side effect of simply not closing it, not special-cased "gap" logic of its own.
  const handleDeleteSelected = () => {
    if (!selectedElement) return;
    if (selectedElement.type === "clip" && selectedElement.lane === "video") removeVideoClip(selectedElement.id);
    else if (selectedElement.type === "audio") removeAudioTrack(selectedElement.id);
    else if (selectedElement.type === "text") removeTextOverlay(selectedElement.id);
    else if (selectedElement.type === "overlay") removeMediaOverlay(selectedElement.id);
    else return;
    setSelectedElement(null); // Properties/Layers fall back to their existing "nothing selected" state
  };

  // Ripple Delete (§8/§9): removes the selected element, then shifts every OTHER element on the
  // SAME lane whose startTime is at/after the deleted element's endTime left by exactly the
  // deleted duration — no other lane is touched. A small epsilon absorbs float drift from prior
  // drag/trim/split operations when deciding "at/after".
  const RIPPLE_EPSILON = 1e-6;
  // Step 6: one remove + a forEach of updates to accomplish ONE ripple-delete — pushHistory()
  // once, after the (already-existing) "does the selected element even still exist" guard,
  // then raw calls throughout, so Undo restores the deleted element AND every shifted
  // neighbour's original position in one click.
  const handleRippleDeleteSelected = () => {
    if (!selectedElement) return;
    if (selectedElement.type === "clip" && selectedElement.lane === "video") {
      const c = videoClips.find(v => v.id === selectedElement.id);
      if (!c) return;
      pushHistory();
      const dur = c.endTime - c.startTime;
      rawRemoveVideoClip(c.id);
      videoClips.forEach(v => { if (v.id !== c.id && v.startTime >= c.endTime - RIPPLE_EPSILON) rawUpdateVideoClip(v.id, { startTime: v.startTime - dur, endTime: v.endTime - dur }); });
    } else if (selectedElement.type === "audio") {
      const a = audioTracks.find(x => x.id === selectedElement.id);
      if (!a) return;
      pushHistory();
      const dur = a.endTime - a.startTime;
      rawRemoveAudioTrack(a.id);
      audioTracks.forEach(x => { if (x.id !== a.id && x.startTime >= a.endTime - RIPPLE_EPSILON) rawUpdateAudioTrack(x.id, { startTime: x.startTime - dur, endTime: x.endTime - dur }); });
    } else if (selectedElement.type === "text") {
      const t = textOverlays.find(x => x.id === selectedElement.id);
      if (!t) return;
      pushHistory();
      const dur = t.endTime - t.startTime;
      rawRemoveTextOverlay(t.id);
      textOverlays.forEach(x => { if (x.id !== t.id && x.startTime >= t.endTime - RIPPLE_EPSILON) rawUpdateTextOverlay(x.id, { startTime: x.startTime - dur, endTime: x.endTime - dur }); });
    } else if (selectedElement.type === "overlay") {
      const o = mediaOverlays.find(x => x.id === selectedElement.id);
      if (!o) return;
      pushHistory();
      const dur = o.endTime - o.startTime;
      rawRemoveMediaOverlay(o.id);
      mediaOverlays.forEach(x => { if (x.id !== o.id && x.startTime >= o.endTime - RIPPLE_EPSILON) rawUpdateMediaOverlay(x.id, { startTime: x.startTime - dur, endTime: x.endTime - dur }); });
    } else {
      return;
    }
    setSelectedElement(null);
  };

  // STEP 7 (Keyboard Shortcuts): [ and ] — trim the selected element's start/end to the current
  // playhead as one discrete action, reusing the exact same trim*Left/trim*Right functions the
  // drag handles already call (see beginTrim/handleTrimMove above) rather than re-deriving the
  // clamp/trimIn math a second time. A drag pushes history once at gesture-start via
  // onGestureStart; a keyboard trim IS the whole gesture in one keypress, so it pushes here,
  // once, only after confirming the selected element still exists.
  const trimSelectedStartToPlayhead = () => {
    if (!selectedElement) return;
    const p = timeline.currentTime;
    if (selectedElement.type === "clip" && selectedElement.lane === "video") {
      const c = videoClips.find(v => v.id === selectedElement.id);
      if (!c) return;
      pushHistory(); trimVideoLeft(c, p);
    } else if (selectedElement.type === "audio") {
      const a = audioTracks.find(x => x.id === selectedElement.id);
      if (!a) return;
      pushHistory(); trimAudioLeft(a, p);
    } else if (selectedElement.type === "text") {
      const t = textOverlays.find(x => x.id === selectedElement.id);
      if (!t) return;
      pushHistory(); trimTextLeft(t, p);
    } else if (selectedElement.type === "overlay") {
      const o = mediaOverlays.find(x => x.id === selectedElement.id);
      if (!o) return;
      pushHistory(); trimOverlayLeft(o, p);
    }
  };
  const trimSelectedEndToPlayhead = () => {
    if (!selectedElement) return;
    const p = timeline.currentTime;
    if (selectedElement.type === "clip" && selectedElement.lane === "video") {
      const c = videoClips.find(v => v.id === selectedElement.id);
      if (!c) return;
      pushHistory(); trimVideoRight(c, p);
    } else if (selectedElement.type === "audio") {
      const a = audioTracks.find(x => x.id === selectedElement.id);
      if (!a) return;
      pushHistory(); trimAudioRight(a, p);
    } else if (selectedElement.type === "text") {
      const t = textOverlays.find(x => x.id === selectedElement.id);
      if (!t) return;
      pushHistory(); trimTextRight(t, p);
    } else if (selectedElement.type === "overlay") {
      const o = mediaOverlays.find(x => x.id === selectedElement.id);
      if (!o) return;
      pushHistory(); trimOverlayRight(o, p);
    }
  };

  // STEP 7 (Keyboard Shortcuts): Copy/Paste/Duplicate — this editor had no clipboard concept at
  // all before this; clipboardRef holds a plain data snapshot (never a live reference into
  // videoClips/etc., so later edits to the original can never leak into a later paste) of
  // whichever one element was selected at the moment of Copy. Paste places a fresh copy (new
  // id, same duration) starting at the current playhead, on the same lane it was copied from;
  // Duplicate is the one-key equivalent of copy-then-paste-immediately-after the original
  // (placed at the original's own endTime, not the playhead) — the standard editor convention
  // for the two being distinct actions rather than Duplicate just being Copy+Paste.
  const clipboardRef = useRef<
    | { kind: "clip"; data: VideoClip }
    | { kind: "audio"; data: AudioTrack }
    | { kind: "text"; data: TextOverlay }
    | { kind: "overlay"; data: MediaOverlay }
    | null
  >(null);
  const copySelected = () => {
    if (!selectedElement) return;
    if (selectedElement.type === "clip" && selectedElement.lane === "video") {
      const c = videoClips.find(v => v.id === selectedElement.id);
      if (c) clipboardRef.current = { kind: "clip", data: c };
    } else if (selectedElement.type === "audio") {
      const a = audioTracks.find(x => x.id === selectedElement.id);
      if (a) clipboardRef.current = { kind: "audio", data: a };
    } else if (selectedElement.type === "text") {
      const t = textOverlays.find(x => x.id === selectedElement.id);
      if (t) clipboardRef.current = { kind: "text", data: t };
    } else if (selectedElement.type === "overlay") {
      const o = mediaOverlays.find(x => x.id === selectedElement.id);
      if (o) clipboardRef.current = { kind: "overlay", data: o };
    }
  };
  const pasteClipboard = () => {
    const cb = clipboardRef.current;
    if (!cb) return;
    const p = timeline.currentTime;
    const id = crypto.randomUUID();
    if (cb.kind === "clip") {
      const dur = cb.data.endTime - cb.data.startTime;
      addVideoClip({ ...cb.data, id, startTime: p, endTime: p + dur });
      setSelectedElement({ type: "clip", lane: "video", id });
    } else if (cb.kind === "audio") {
      const dur = cb.data.endTime - cb.data.startTime;
      addAudioTrack({ ...cb.data, id, startTime: p, endTime: p + dur });
      setSelectedElement({ type: "audio", id });
    } else if (cb.kind === "text") {
      const dur = cb.data.endTime - cb.data.startTime;
      addTextOverlay({ ...cb.data, id, startTime: p, endTime: p + dur });
      setSelectedElement({ type: "text", id });
    } else if (cb.kind === "overlay") {
      const dur = cb.data.endTime - cb.data.startTime;
      addMediaOverlay({ ...cb.data, id, startTime: p, endTime: p + dur });
      setSelectedElement({ type: "overlay", id });
    }
  };
  const duplicateSelected = () => {
    if (!selectedElement) return;
    const id = crypto.randomUUID();
    if (selectedElement.type === "clip" && selectedElement.lane === "video") {
      const c = videoClips.find(v => v.id === selectedElement.id);
      if (!c) return;
      const dur = c.endTime - c.startTime;
      addVideoClip({ ...c, id, startTime: c.endTime, endTime: c.endTime + dur });
      setSelectedElement({ type: "clip", lane: "video", id });
    } else if (selectedElement.type === "audio") {
      const a = audioTracks.find(x => x.id === selectedElement.id);
      if (!a) return;
      const dur = a.endTime - a.startTime;
      addAudioTrack({ ...a, id, startTime: a.endTime, endTime: a.endTime + dur });
      setSelectedElement({ type: "audio", id });
    } else if (selectedElement.type === "text") {
      const t = textOverlays.find(x => x.id === selectedElement.id);
      if (!t) return;
      const dur = t.endTime - t.startTime;
      addTextOverlay({ ...t, id, startTime: t.endTime, endTime: t.endTime + dur });
      setSelectedElement({ type: "text", id });
    } else if (selectedElement.type === "overlay") {
      const o = mediaOverlays.find(x => x.id === selectedElement.id);
      if (!o) return;
      const dur = o.endTime - o.startTime;
      addMediaOverlay({ ...o, id, startTime: o.endTime, endTime: o.endTime + dur });
      setSelectedElement({ type: "overlay", id });
    }
  };

  // STEP 7 (Keyboard Shortcuts): arrow-key nudge for the two "movable canvas element" types
  // (Text/Overlay — the ones with an x/y canvas position at all; a VideoClip has none, it
  // always occupies the whole canvas). Clamped against the SAME edges dragging already
  // respects: Overlay stores both width and height so both axes clamp precisely; Text only
  // ever stored width (its box height has always been implicit/unmeasured — see
  // dragTextSessionRef's own live-measured elH for why the drag path can be more precise than a
  // keyboard nudge can without a fresh DOM read), so its Y nudge clamps only to the plain
  // 0-100 canvas bounds, same generosity a drag falls back to without a measurement in hand.
  const CANVAS_NUDGE_SMALL_PCT = 0.5;
  const CANVAS_NUDGE_LARGE_PCT = 5;
  const nudgeSelectedCanvasElement = (dx: number, dy: number) => {
    if (selectedElement?.type === "text") {
      const t = textOverlays.find(x => x.id === selectedElement.id);
      if (!t) return;
      const maxX = Math.max(0, 100 - t.width);
      updateTextOverlay(t.id, { x: Math.min(maxX, Math.max(0, t.x + dx)), y: Math.min(100, Math.max(0, t.y + dy)) });
    } else if (selectedElement?.type === "overlay") {
      const o = mediaOverlays.find(x => x.id === selectedElement.id);
      if (!o) return;
      const maxX = Math.max(0, 100 - o.width);
      const maxY = Math.max(0, 100 - o.height);
      updateMediaOverlay(o.id, { x: Math.min(maxX, Math.max(0, o.x + dx)), y: Math.min(maxY, Math.max(0, o.y + dy)) });
    }
  };
  // STEP 7 (Keyboard Shortcuts): Left/Right step by exactly one frame when there's no movable
  // canvas element to nudge instead — 1/30s, matching ffmpeg_svc.py's own hardcoded `-r 30`
  // export frame rate, so "one frame" means the same real duration in the preview as it will in
  // the exported file.
  const FRAME_SECONDS = 1 / 30;
  const stepPlayheadByFrame = (deltaFrames: number) => {
    setTimeline({ currentTime: Math.max(0, Math.min(effectiveDuration, timeline.currentTime + deltaFrames * FRAME_SECONDS)) });
  };

  // ---- STEP 7 (Keyboard Shortcuts): global editor shortcuts. ----
  // Deliberately re-subscribes on every render (no dependency array) rather than the
  // ref-mirroring pattern the master-clock rAF loop above uses — that pattern exists there
  // specifically so ONE long-lived effect survives across many renders without tearing down;
  // a keydown listener has no such constraint, and removeEventListener+addEventListener every
  // render is cheap, so this stays a plain closure over whatever selectedElement/videoClips/
  // timeline/etc. the current render already has — always current, no staleness to guard
  // against, and no new refs needed for state this effect doesn't otherwise touch.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Critical safeguard: never fire while the user is typing anywhere — Text field, AI
      // Assistant, search, project/draft name, any future input this editor adds. Checked by
      // element kind, not by which specific field it is, so nothing needs listing by name.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const mod = e.ctrlKey || e.metaKey; // metaKey too, so Cmd on macOS gets the same shortcuts for free

      // Ctrl/Cmd combos first — checked ahead of the plain-key switch below so e.g. Ctrl+S
      // never also matches a bare "s" case.
      if (mod) {
        switch (e.code) {
          case "KeyZ":
            e.preventDefault();
            if (e.shiftKey) handleRedo(); else handleUndo();
            return;
          case "KeyS":
            e.preventDefault(); // the one browser default every shortcut here must suppress — native Save Page must never appear
            handleQuickSaveDraft();
            return;
          case "KeyC":
            e.preventDefault();
            copySelected();
            return;
          case "KeyV":
            e.preventDefault();
            pasteClipboard();
            return;
          case "KeyD":
            e.preventDefault();
            duplicateSelected();
            return;
          default:
            return; // no other Ctrl/Cmd combo is an editor shortcut — never swallow the browser's own (e.g. Ctrl+T, Ctrl+W)
        }
      }

      switch (e.code) {
        case "Space":
          e.preventDefault(); // browser default here is "activate the focused button" (e.g. re-clicking Play), not scroll — still not what Space should do in an editor
          setTimeline({ playing: !timeline.playing });
          break;
        case "KeyS":
          handleSplitAtPlayhead();
          break;
        case "BracketLeft":
          trimSelectedStartToPlayhead();
          break;
        case "BracketRight":
          trimSelectedEndToPlayhead();
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault(); // Backspace with no focused input can navigate back in some browsers
          if (e.shiftKey) handleRippleDeleteSelected(); else handleDeleteSelected();
          break;
        case "KeyC":
          if (selectedClip) enterCropReposition(selectedClip);
          break;
        case "KeyF":
          if (selectedClip) applyClipFitMode(selectedClip, e.shiftKey ? "fit" : "fill");
          break;
        case "KeyR":
          // "Resize/Transform" has exactly one meaning in this editor for a video clip — Crop &
          // Reposition (Text/Overlay already expose resize directly via their own corner
          // handles the instant they're selected, with no separate mode to enter) — so R is
          // deliberately the same action as C for a selected clip, and a safe no-op otherwise
          // rather than a fabricated mode that wouldn't visibly do anything.
          if (selectedClip) enterCropReposition(selectedClip);
          break;
        case "KeyV":
          // "Select/Move" is this editor's only normal state — there's no separate mode to
          // switch INTO, so V's one real, honest action is switching OUT of the one special
          // mode that exists (Crop & Reposition), same as Escape/Done below.
          setRepositionClipId(null);
          break;
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          const isMovableCanvasSelection = selectedElement?.type === "text" || selectedElement?.type === "overlay";
          if (isMovableCanvasSelection) {
            e.preventDefault();
            const nudge = e.shiftKey ? CANVAS_NUDGE_LARGE_PCT : CANVAS_NUDGE_SMALL_PCT;
            const dx = e.code === "ArrowLeft" ? -nudge : e.code === "ArrowRight" ? nudge : 0;
            const dy = e.code === "ArrowUp" ? -nudge : e.code === "ArrowDown" ? nudge : 0;
            nudgeSelectedCanvasElement(dx, dy);
          } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
            e.preventDefault();
            stepPlayheadByFrame(e.code === "ArrowLeft" ? -1 : 1);
          }
          // ArrowUp/ArrowDown with no movable canvas element selected: no defined action —
          // left alone rather than guessing at one.
          break;
        }
        case "Home":
          e.preventDefault();
          setTimeline({ currentTime: 0 });
          break;
        case "End":
          e.preventDefault();
          setTimeline({ currentTime: effectiveDuration });
          break;
        case "Escape":
          // Cancel whichever of this editor's own special modes/overlays is currently open —
          // never touches selection itself, only the crop-reposition handle and its dropdown.
          if (repositionClipId !== null) setRepositionClipId(null);
          if (cropMenuOpen) setCropMenuOpen(false);
          if (shortcutsPanelOpen) setShortcutsPanelOpen(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Extracted so the exact same panel markup renders both in its normal grid column (Normal
  // Mode) and inside a Focus Mode drawer overlay — one implementation, two mount points, no
  // behavioural difference between them.
  const mediaPanelBody = (
    <>
      <div className="asset-head"><b>Media</b><select defaultValue="all"><option value="all">All Media</option></select></div>
      <input className="search" placeholder="Search media..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className="subtabs compact">
        {MEDIA_TABS.map(t => <button key={t} className={mediaTab === t ? "active" : ""} onClick={() => setMediaTab(t)} type="button">{t}</button>)}
      </div>
      <input ref={fileInputRef} type="file" accept="video/*,image/*,audio/*" multiple style={{ display: "none" }}
        onChange={e => { void handleFiles(e.target.files); e.target.value = ""; }} />
      <input ref={overlayFileInputRef} type="file" accept="video/*,image/*" style={{ display: "none" }}
        onChange={e => { void handleAddOverlayFile(e.target.files?.[0]); e.target.value = ""; }} />

      {mediaTab === "Text" ? (
        <div className="media-grid">
          {textOverlays.map(o => (
            <div
              key={o.id}
              className={`media-card text-card ${selectedElement?.type === "text" && selectedElement.id === o.id ? "canvas-el-selected" : ""}`}
              onClick={() => setSelectedElement({ type: "text", id: o.id })}
              title="Click to select — edit it in the Properties panel"
            >
              <div className="fake-media text-swatch">{o.text.slice(0, 40) || "Text"}</div>
              <small>{o.text.slice(0, 24) || "Text overlay"}</small>
            </div>
          ))}
          <button className="add-media" type="button" onClick={handleAddText}>+<br />Add Text</button>
        </div>
      ) : mediaTab === "Overlays" ? (
        <div className="media-grid">
          {mediaOverlays.map((o, i) => (
            <div
              key={o.id}
              className={`media-card ${selectedElement?.type === "overlay" && selectedElement.id === o.id ? "canvas-el-selected" : ""}`}
              onClick={() => setSelectedElement({ type: "overlay", id: o.id })}
              title="Overlay — click to select"
            >
              <div className="fake-media overlay-swatch" data-index={i + 1}>🖼</div>
              <small>{overlayLabel(o)}</small>
            </div>
          ))}
          <button className="add-media" type="button" onClick={() => overlayFileInputRef.current?.click()}>+<br />Add Overlay</button>
        </div>
      ) : mediaTab === "Audio" ? (
        <div className="media-grid">
          {mediaItems.map(({ asset }, i) => (
            <div className="media-card" key={asset.id} title={asset.original_filename}>
              <button
                type="button" className="media-card-delete"
                onClick={e => { e.stopPropagation(); handleDeleteMediaAsset(asset); }}
                title="Remove from Media Library"
              >🗑</button>
              <div className="fake-media" data-index={i + 1} />
              <small>{asset.original_filename}</small>
              <button
                type="button"
                className="add-to-timeline-btn"
                onClick={e => { e.stopPropagation(); void handleAddAudioToTimeline(asset); }}
                title="Add this audio to the A1 timeline"
              >
                + Add to Timeline
              </button>
            </div>
          ))}
          <button className="add-media" type="button" onClick={() => fileInputRef.current?.click()}>+<br />Add Media</button>
          {/* Instruction 14: Audio must also surface what's ALREADY on the A1 timeline — most
              importantly the audio Step 1 auto-extracts from an uploaded video, which was never
              a mediaAssets entry at all (it's created directly as an AudioTrack, sharing the
              video's own assetId/url), so it could never appear in the plain uploaded-files grid
              above. This reads the exact same existing audioTracks array A1 itself renders from
              — not a new list, no new model — and reuses the exact same selection action A1's
              own clips already use, so clicking one here is indistinguishable from clicking it
              on the timeline. */}
          {audioTracks.length > 0 && (
            <>
              <div className="media-grid-divider">On A1 Timeline</div>
              {audioTracks.map((a, i) => (
                <div
                  key={a.id}
                  className={`media-card ${selectedElement?.type === "audio" && selectedElement.id === a.id ? "canvas-el-selected" : ""}`}
                  onClick={() => setSelectedElement({ type: "audio", id: a.id })}
                  title="Audio already on the A1 timeline — click to select"
                >
                  <div className="fake-media overlay-swatch" data-index={i + 1}>🎵</div>
                  <small>{a.name}</small>
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="media-grid">
          {mediaItems.map(({ asset, kind }, i) => (
            <div
              className="media-card"
              key={asset.id}
              draggable={kind === "Videos"}
              title={kind === "Videos" ? `${asset.original_filename} — drag onto V1` : asset.original_filename}
              onDragStart={kind === "Videos" ? (e) => {
                const payload: MediaAssetDragPayload = {
                  assetId: asset.id, url: assetsApi.previewUrl(asset.file_path),
                  name: asset.original_filename, mimeType: asset.mime_type,
                };
                e.dataTransfer.setData(MEDIA_ASSET_DRAG_TYPE, JSON.stringify(payload));
                e.dataTransfer.effectAllowed = "copy";
              } : undefined}
            >
              <button
                type="button" className="media-card-delete"
                onClick={e => { e.stopPropagation(); handleDeleteMediaAsset(asset); }}
                title="Remove from Media Library"
              >🗑</button>
              <div className="fake-media" data-index={i + 1} />
              <small>{asset.original_filename}</small>
            </div>
          ))}
          <button className="add-media" type="button" onClick={() => fileInputRef.current?.click()}>+<br />Add Media</button>
        </div>
      )}
    </>
  );

  // Video Deconstructor — Stage 2 (Reference Video Ingestion) ONLY. Shown instead of
  // mediaPanelBody when the "Import External" creation mode is active (see assetPanelBody just
  // below). Ingestion only — "Analyse Reference" is deliberately disabled; a later stage wires
  // it up to real analysis.
  const importExternalPanelBody = (
    <>
      <div className="asset-head"><b>Import External</b></div>
      <p className="empty-hint">
        Bring in a reference video to analyse later — angles, hooks, structure, on-screen text,
        and more. This step only imports it; analysing it is a separate, later step.
      </p>
      <input
        ref={refIngestFileInputRef} type="file" accept="video/*" style={{ display: "none" }}
        onChange={e => { void handleImportExternalFile(e.target.files); e.target.value = ""; }}
      />

      {/* Defect fix (post-Stage-3 Manual Test 1): briefly shown while checking for an already-
          ingested reference (see refIngestRestoreAttemptedRef's effect above) — without this,
          the upload button flashed on screen for a moment even when a reference already existed,
          which is exactly the restoration gap that was reported. */}
      {refIngestRestoring ? (
        <p className="empty-hint">Checking for an existing reference…</p>
      ) : (
        <button
          className="add-media" type="button"
          onClick={() => refIngestFileInputRef.current?.click()}
          disabled={refIngestBusy}
        >
          {refIngestBusy ? "Uploading…" : <>⬆<br />Upload Reference Video</>}
        </button>
      )}

      {refIngestError && <p className="inline-status error">{refIngestError}</p>}

      {refIngestResult && !refIngestError && (() => {
        const details = refIngestResult.technical_details;
        const passStatus = refIngestResult.latest_analysis.pass_status || {};
        // Stage 4 fix: Stage 3's own results are gated on ITS OWN pass state, never on the
        // top-level `status` field — that field legitimately becomes "running"/"complete" again
        // around Stage 4's own pass, and must never make Stage 3's already-trustworthy,
        // still-valid results disappear from view while Stage 4 works (or if it fails).
        const technicalProbeStatus = passStatus.technical_probe ?? "pending";
        const structureStatus = passStatus.scene_segmentation; // undefined until first attempted
        const frameStatus = passStatus.visual_evidence; // undefined until first attempted (Stage 5)
        const statusLabel: Record<string, string> = {
          pending: "Ready for Analysis",
          running: "Analysing…",
          complete: "Technical Analysis Complete",
          failed: "Analysis Failed",
        };
        return (
          <div className="media-card" style={{ padding: 12, cursor: "default" }}>
            <h4 style={{ margin: "0 0 8px" }}>Reference uploaded</h4>
            <p className="clip-name">{refIngestResult.original_filename}</p>

            {/* Reference Preview (post-Stage-4 UI gap fix): an INDEPENDENT player for the
                analysed ReferenceVideo itself — deliberately separate from the centre editor
                preview (which shows Sameena's own project timeline, not this reference). Native
                <video controls> is the smallest correct implementation: play/pause, a seek bar,
                and current-time/duration all come for free, no custom player UI needed. Never
                reads or writes timeline.currentTime/videoClips — clicking a Shot below only ever
                calls refPreviewVideoRef.current.currentTime, never touches the editor. */}
            <video
              ref={refPreviewVideoRef}
              src={assetsApi.previewUrl(refIngestResult.asset_file_path)}
              controls
              onTimeUpdate={(e) => setRefPreviewTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setRefPreviewDuration(e.currentTarget.duration)}
              onSeeked={(e) => setRefPreviewTime(e.currentTarget.currentTime)}
              style={{ width: "100%", maxHeight: 220, borderRadius: 6, background: "#000", marginBottom: 4 }}
            />
            {/* Explicit current-position readout (Stage-4 Shot-02-not-clickable fix, requirement 6):
                native <video controls> already shows a scrubber, but its own time text is too small/
                imprecise for Sameena to visually confirm a boundary like 30.100s against a Shot's
                exact start_time — this mirrors formatShotTimecode's own mm:ss.mmm precision. */}
            <p className="empty-hint" style={{ margin: "0 0 10px", fontSize: 11, textAlign: "right" }}>
              Reference Preview: {formatShotTimecode(refPreviewTime)} / {formatShotTimecode(refPreviewDuration)}
            </p>

            <p className="selection-summary-label">Status: {statusLabel[technicalProbeStatus] ?? technicalProbeStatus}</p>

            {/* pending/failed -> a real, clickable action (previously a permanently-disabled
                button — see the Stage-2 defect-fix note this replaced). running is included
                defensively (e.g. a page reload mid-request would show it via a re-fetch) even
                though the normal click-and-wait flow below never leaves it visible for long. */}
            {(technicalProbeStatus === "pending" || technicalProbeStatus === "failed") && (
              <button
                className="primary wide" type="button"
                onClick={() => void handleAnalyzeReference()}
                disabled={refAnalyzeBusy}
              >
                {refAnalyzeBusy ? "Analysing…" : technicalProbeStatus === "failed" ? "Retry Analysis →" : "Analyse Reference →"}
              </button>
            )}
            {technicalProbeStatus === "running" && !refAnalyzeBusy && (
              <button className="secondary wide" type="button" disabled style={{ opacity: 0.6, cursor: "not-allowed" }}>
                Analysing…
              </button>
            )}

            {refAnalyzeError && <p className="inline-status error">{refAnalyzeError}</p>}
            {technicalProbeStatus === "failed" && refIngestResult.latest_analysis.error && !refAnalyzeError && (
              <p className="inline-status error">{refIngestResult.latest_analysis.error}</p>
            )}

            {technicalProbeStatus === "complete" && details && (
              <div style={{ marginTop: 12 }}>
                <p className="selection-summary-label">Technical Analysis</p>
                {[
                  ["Duration", details.container.duration_seconds != null ? formatTimecode(details.container.duration_seconds) : "Not determined"],
                  ["Resolution", details.video.width && details.video.height ? `${details.video.width}×${details.video.height}` : "Not determined"],
                  ["Aspect Ratio", details.video.width && details.video.height ? deriveAspectRatioLabel(details.video.width, details.video.height) : "Not determined"],
                  ["Frame Rate", details.video.frame_rate != null ? `${details.video.frame_rate} fps` : "Not determined"],
                  ["Video Codec", details.video.codec_name ?? "Not determined"],
                  ...(details.video.bitrate_kbps != null ? [["Video Bitrate", `${details.video.bitrate_kbps} kb/s`]] : []),
                  ["Audio Present", details.audio.present ? "Yes" : "No"],
                  ...(details.audio.present ? [
                    ["Audio Codec", details.audio.codec_name ?? "Not determined"],
                    ["Channels", details.audio.channel_layout ?? (details.audio.channels != null ? String(details.audio.channels) : "Not determined")],
                    ["Sample Rate", details.audio.sample_rate_hz != null ? `${details.audio.sample_rate_hz} Hz` : "Not determined"],
                  ] as [string, string][] : []),
                  ["Container/Format", details.container.format_name ?? "Not determined"],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--v-line)" }}>
                    <span style={{ color: "var(--v-muted)" }}>{label}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            )}

            {/* Video Deconstructor — Stage 4 (Deterministic Shot/Cut Boundary Detection) ONLY.
                Only ever shown once Stage 3 has genuinely completed — structural analysis
                depends on Stage 3's own duration fact and is refused server-side otherwise. */}
            {technicalProbeStatus === "complete" && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--v-line)" }}>
                <p className="selection-summary-label">
                  {structureStatus === "complete" ? "Structural Analysis Complete"
                    : structureStatus === "running" ? "Analysing Structure…"
                    : structureStatus === "failed" ? "Structural Analysis Failed"
                    : "Structure"}
                </p>

                {(structureStatus === undefined || structureStatus === "pending" || structureStatus === "failed") && (
                  <button
                    className="primary wide" type="button"
                    onClick={() => void handleAnalyzeStructure()}
                    disabled={refAnalyzeStructureBusy}
                  >
                    {refAnalyzeStructureBusy ? "Analysing Structure…" : structureStatus === "failed" ? "Retry Structure Analysis →" : "Analyse Structure →"}
                  </button>
                )}
                {structureStatus === "running" && !refAnalyzeStructureBusy && (
                  <button className="secondary wide" type="button" disabled style={{ opacity: 0.6, cursor: "not-allowed" }}>
                    Analysing Structure…
                  </button>
                )}

                {refAnalyzeStructureError && <p className="inline-status error">{refAnalyzeStructureError}</p>}
                {structureStatus === "failed" && refIngestResult.latest_analysis.error && !refAnalyzeStructureError && (
                  <p className="inline-status error">{refIngestResult.latest_analysis.error}</p>
                )}

                {structureStatus === "complete" && (
                  <div style={{ marginTop: 10 }}>
                    <p className="clip-name">Detected Shots: {refIngestResult.shots.length}</p>
                    <p className="empty-hint" style={{ padding: "0 0 8px", fontSize: 11 }}>
                      Click a shot to seek the Reference Preview above to its start — for visually
                      checking a detected boundary against the actual footage.
                    </p>
                    {refIngestResult.shots.map(shot => (
                      <div key={shot.id} style={{ marginBottom: 6 }}>
                        <button
                          type="button"
                          className={`shot-row${selectedShotId === shot.id ? " active" : ""}`}
                          onClick={() => handleSeekReferencePreview(shot.id, shot.start_time)}
                          title={`Seek Reference Preview to ${formatShotTimecode(shot.start_time)}`}
                          style={{ fontSize: 12 }}
                        >
                          <b>Shot {String(shot.order + 1).padStart(2, "0")}</b>
                          <div>{formatShotTimecode(shot.start_time)} → {formatShotTimecode(shot.end_time)}</div>
                          <div style={{ color: "var(--v-muted)" }}>{(shot.end_time - shot.start_time).toFixed(3)} sec</div>
                        </button>

                        {/* Video Deconstructor — Stage 5 (Visual Evidence / Representative
                            Frames) ONLY. Nested as a SIBLING of the Shot's own button above, not
                            a child — a <button> cannot legally contain another <button>. Each
                            thumbnail seeks the SAME independent Reference Preview, never the
                            editor, via the same handleSeekReferencePreview used by the Shot row
                            itself; the frame's own exact timestamp (not the shot's start_time) is
                            what makes clicking a specific frame meaningfully different from
                            clicking the shot row. */}
                        {frameStatus === "complete" && shot.frames.length > 0 && (
                          <div style={{ padding: "4px 0 0 8px" }}>
                            <p className="empty-hint" style={{ margin: "0 0 4px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>
                              Visual Evidence · {shot.frames.length} frame{shot.frames.length === 1 ? "" : "s"}
                            </p>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {shot.frames.map(frame => (
                                <button
                                  key={frame.id}
                                  type="button"
                                  className={`shot-row${selectedFrameId === frame.id ? " active" : ""}`}
                                  onClick={() => handleSeekReferencePreviewToFrame(shot.id, frame.id, frame.timestamp)}
                                  title={`Seek Reference Preview to ${formatShotTimecode(frame.timestamp)}`}
                                  style={{ width: 64, padding: 4, textAlign: "center", userSelect: "none" }}
                                >
                                  {/* Manual test defect (thumbnail click did nothing in Sameena's
                                      real browser): <img> is natively draggable in Chrome by
                                      default — same root cause this file already fixed once for
                                      the Crop & Reposition <video> (see that fix's own comment a
                                      few hundred lines below). A real physical mousedown+tiny-
                                      move+mouseup on the image starts the browser's OWN native
                                      drag gesture instead of firing a click at all — invisible to
                                      an automated *synthetic* click (never a real OS-level drag),
                                      which is exactly why this passed every automated check yet
                                      failed for a real person. draggable={false} plus
                                      pointer-events:none (the image is decorative inside an
                                      already-clickable button — same pattern
                                      .canvas-overlay-media already uses elsewhere in this file's
                                      own CSS) makes the ENTIRE card's mousedown/click always land
                                      on the <button> itself, never the <img>. */}
                                  <img
                                    src={assetsApi.previewUrl(frame.asset_file_path)}
                                    alt={`Shot ${shot.order + 1} frame at ${formatShotTimecode(frame.timestamp)}`}
                                    draggable={false}
                                    style={{ width: "100%", height: 40, objectFit: "cover", borderRadius: 4, display: "block", pointerEvents: "none" }}
                                  />
                                  <div style={{ fontSize: 9, marginTop: 3, color: "var(--v-muted)" }}>
                                    {formatShotTimecode(frame.timestamp)}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--v-line)" }}>
                      <p className="selection-summary-label">
                        {frameStatus === "complete" ? "Visual Evidence Complete"
                          : frameStatus === "running" ? "Extracting Visual Evidence…"
                          : frameStatus === "failed" ? "Visual Evidence Extraction Failed"
                          : "Visual Evidence"}
                      </p>
                      {(frameStatus === undefined || frameStatus === "pending" || frameStatus === "failed") && (
                        <button
                          className="primary wide" type="button"
                          onClick={() => void handleAnalyzeFrames()}
                          disabled={refAnalyzeFramesBusy}
                        >
                          {refAnalyzeFramesBusy ? "Extracting…" : frameStatus === "failed" ? "Retry Visual Evidence →" : "Extract Visual Evidence →"}
                        </button>
                      )}
                      {frameStatus === "running" && !refAnalyzeFramesBusy && (
                        <button className="secondary wide" type="button" disabled style={{ opacity: 0.6, cursor: "not-allowed" }}>
                          Extracting…
                        </button>
                      )}
                      {refAnalyzeFramesError && <p className="inline-status error">{refAnalyzeFramesError}</p>}
                      {frameStatus === "failed" && refIngestResult.latest_analysis.error && !refAnalyzeFramesError && (
                        <p className="inline-status error">{refIngestResult.latest_analysis.error}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </>
  );

  // Swapped into both places mediaPanelBody normally renders (the asset-panel aside and its
  // focus-mode drawer equivalent) so "Import External" behaves consistently in both.
  const assetPanelBody = mode === "Import External" ? importExternalPanelBody : mediaPanelBody;

  // Defect fix (Video Editor Playback Regression, found via Sameena's Stage-4 manual test):
  // the Speed control below used to write ONLY the `speed` field, leaving `endTime` fixed at
  // whatever it was under the PREVIOUS speed. A clip's endTime/trimIn/trimOut together define
  // its own already-trimmed, valid source range (Instruction 10's own
  // "sourceTime = trimIn + elapsed*speed" formula, in the offset-sync effect above) — so a clip
  // whose endTime was set while speed=1 and is then switched to a faster speed keeps asking
  // that formula for source positions well past the footage its own trim boundary said this
  // clip should ever show, by the time playback reaches its (unchanged) endTime. That plays
  // footage the user had deliberately trimmed away for the remainder of the clip's own
  // timeline span — exactly the kind of "V1 stops looking right" symptom reported. Recomputing
  // endTime here keeps THIS ONE clip's own start/end/speed/trim relationship internally
  // consistent — it deliberately never touches any OTHER clip's own startTime/endTime (the
  // smallest fix that corrects this clip without touching a neighbour's authored timing): if an
  // adjacent clip was contiguous before, a speed change may now leave a small gap or overlap
  // next to it, both of which findActiveClip already resolves deterministically (see
  // videoPreviewUtils.ts and its own Manual Test 7.2 fix note) — a visible timing nudge at
  // worst, never a clip that fails to hand off or a dropped frame.
  const handleClipSpeedChange = (clip: VideoClip, newSpeed: VideoClip["speed"]) => {
    updateVideoClip(clip.id, { speed: newSpeed, endTime: computeEndTimeForSpeed(clip, newSpeed) });
  };

  const propertiesPanelBody = (
    <>
      <div className="subtabs compact">
        {(["Properties", "Layers", "Adjustments"] as const).map(t => (
          <button key={t} className={rightTab === t ? "active" : ""} onClick={() => setRightTab(t)} type="button">{t}</button>
        ))}
      </div>

      {rightTab === "Properties" && (
        <>
          {selectionSummary && (
            <div className="selection-summary">
              <span className="selection-summary-label">Selected Element</span>
              <span>Type: {selectionSummary.kind}</span>
              <span>Name: {selectionSummary.name}</span>
            </div>
          )}
        {selectedText ? (
          <>
            <h4>Text</h4>
            {/* Step 6: onFocus pushes one history snapshot when the field is first entered (not
                per keystroke); onChange (fires on every keystroke) uses the raw action, so
                typing/editing a whole sentence is one undo step, not one per character. */}
            <textarea ref={textPropsTextareaRef} value={selectedText.text}
              onFocus={pushHistory}
              onChange={e => rawUpdateTextOverlay(selectedText.id, { text: e.target.value })} />
            <select value={selectedText.fontFamily} onChange={e => updateTextOverlay(selectedText.id, { fontFamily: e.target.value })}>
              <option>Inter</option><option>Montserrat</option><option>Poppins</option>
            </select>
            <div className="row">
              <select value={selectedText.bold ? "Bold" : "Regular"} onChange={e => updateTextOverlay(selectedText.id, { bold: e.target.value === "Bold" })}>
                <option>Regular</option><option>Bold</option>
              </select>
              <select value={String(selectedText.fontSize)} onChange={e => updateTextOverlay(selectedText.id, { fontSize: Number(e.target.value) })}>
                {[24, 32, 48, 56, 72, 96].map(s => <option key={s}>{s}</option>)}
              </select>
              <input type="color" value={selectedText.color} onChange={e => updateTextOverlay(selectedText.id, { color: e.target.value })} />
            </div>
            <h4>Transform</h4>
            <div className="row">
              <input value={`X ${Math.round(selectedText.x)}`} readOnly /><input value={`Y ${Math.round(selectedText.y)}`} readOnly />
            </div>
          </>
        ) : selectedClip ? (
          <>
            <h4>Clip</h4>
            <p className="clip-name">{selectedClip.name || "Untitled clip"}</p>
            <label className="stack-field"><span>Filter</span>
              <select value={selectedClip.colorGrade} onChange={e => updateVideoClip(selectedClip.id, { colorGrade: e.target.value as VideoClip["colorGrade"] })}>
                <option value="none">None</option><option value="bw">Grayscale</option><option value="sepia">Sepia</option>
                <option value="warm">Warm</option><option value="cool">Cool</option><option value="high_contrast">High Contrast</option>
              </select>
            </label>
            {/* Step 5 follow-up (Speed): `speed` already existed on VideoClip (default 1) but was
                never exposed anywhere in this tab or applied to real playback — wired to
                vid.playbackRate + the speed-aware offset math in the sync effects above. */}
            <label className="stack-field"><span>Speed</span>
              <select value={String(selectedClip.speed)} onChange={e => handleClipSpeedChange(selectedClip, Number(e.target.value) as VideoClip["speed"])}>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => <option key={s} value={s}>{s}×</option>)}
              </select>
            </label>
            {/* Step 5 follow-up (Transitions): `transition`/`transitionDuration` already existed
                on VideoClip but were never exposed or rendered anywhere. Only "None"/"Fade" are
                offered here — Crossfade/Dissolve would need a second, simultaneously-playing
                video element (this architecture has exactly one <video> showing "the current
                clip" at a time) and isn't implemented; see the report. "Fade" reuses the
                existing 'fade_black' enum value and fades to/from the preview's own black
                background at this clip's own start/end, via getClipTransitionOpacity above. */}
            <label className="stack-field"><span>Transition</span>
              <select value={selectedClip.transition === "fade_black" ? "fade_black" : "cut"}
                onChange={e => updateVideoClip(selectedClip.id, { transition: e.target.value as VideoClip["transition"] })}>
                <option value="cut">None</option><option value="fade_black">Fade</option>
              </select>
            </label>
            {selectedClip.transition === "fade_black" && (
              <label className="stack-field"><span>Transition Duration</span>
                <select value={String(selectedClip.transitionDuration)} onChange={e => updateVideoClip(selectedClip.id, { transitionDuration: Number(e.target.value) })}>
                  {[0.25, 0.5, 1].map(d => <option key={d} value={d}>{d}s</option>)}
                </select>
              </label>
            )}
            {/* Step 7 (Original Video Audio controls): this clip's OWN embedded audio only —
                same checkbox+slider pattern Overlay Audio already uses below, applied to V1
                instead. Independent of A1's own volume, other clips, and overlay audio (each
                is its own separate field on its own object) — and additive to, not a
                replacement for, the existing "muted once separated to A1" auto-mute rule. */}
            <h4>Audio</h4>
            <label className="stack-field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" checked={!(selectedClip.muted ?? false)}
                onChange={e => updateVideoClip(selectedClip.id, { muted: !e.target.checked })} />
              <span>Original Audio</span>
            </label>
            <label className="stack-field"><span>Volume — {Math.round((selectedClip.volume ?? 1) * 100)}%</span>
              {/* Step 6: onMouseDown pushes one history snapshot at the start of a drag; onChange
                  (continuous) uses the raw action — same pattern as every other slider here. */}
              <input type="range" min={0} max={100} value={Math.round((selectedClip.volume ?? 1) * 100)}
                onMouseDown={pushHistory}
                onChange={e => rawUpdateVideoClip(selectedClip.id, { volume: Number(e.target.value) / 100 })} />
            </label>
          </>
        ) : selectedOverlay ? (
          <>
            <h4>Overlay</h4>
            <p className="clip-name">{overlayLabel(selectedOverlay)}</p>
            <label className="stack-field"><span>Filter</span>
              <select value={selectedOverlay.colorGrade ?? "none"} onChange={e => updateMediaOverlay(selectedOverlay.id, { colorGrade: e.target.value as VideoClip["colorGrade"] })}>
                <option value="none">None</option><option value="bw">Grayscale</option><option value="sepia">Sepia</option>
                <option value="warm">Warm</option><option value="cool">Cool</option><option value="high_contrast">High Contrast</option>
              </select>
            </label>
            {/* Step 5 follow-up (Overlay audio): only meaningful for a video-backed Overlay — an
                image has no audio track to control. */}
            {isVideoOverlayUrl(selectedOverlay.url) && (
              <>
                <label className="stack-field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                  <input type="checkbox" checked={selectedOverlay.muted ?? false}
                    onChange={e => updateMediaOverlay(selectedOverlay.id, { muted: e.target.checked })} />
                  <span>Mute Overlay Audio</span>
                </label>
                <label className="stack-field"><span>Overlay Volume</span>
                  {/* Step 6: onMouseDown pushes one history snapshot at the start of a drag; onChange
                      (which fires continuously while dragging) uses the raw action so a single
                      slider drag is one undo step, not one per tick — same pattern as the
                      brightness/contrast/saturation sliders below. */}
                  <input type="range" min={0} max={100} value={Math.round((selectedOverlay.volume ?? 1) * 100)}
                    onMouseDown={pushHistory}
                    onChange={e => rawUpdateMediaOverlay(selectedOverlay.id, { volume: Number(e.target.value) / 100 })} />
                </label>
              </>
            )}
            <p className="empty-hint">Detailed Overlay properties (crop, opacity) aren't built yet — selection only, for now.</p>
          </>
        ) : selectedAudio ? (
          <>
            <h4>Audio</h4>
            <p className="clip-name">{selectedAudio.name}</p>
            {/* STEP 7.6: A1 clip volume — separate from the preview 🔊 mute/unmute button
                (Instruction 7): this changes selectedAudio.volume, a saved clip property that
                persists (Step 7) and undoes (Step 6, via pushHistory below); the preview mute
                button changes neither — it only ever flips a live DOM .muted flag. Same
                slider pattern as Overlay Volume above (onMouseDown = one history snapshot per
                drag, onChange = the raw/continuous update), plus a live "NN%" readout per
                Instruction 2. */}
            <label className="stack-field"><span>Volume — {Math.round(selectedAudio.volume * 100)}%</span>
              <input type="range" min={0} max={100} value={Math.round(selectedAudio.volume * 100)}
                onMouseDown={pushHistory}
                onChange={e => rawUpdateAudioTrack(selectedAudio.id, { volume: Number(e.target.value) / 100 })} />
            </label>
            <p className="empty-hint">Other Audio properties (fade in/out, ducking) aren't built yet — selection only, for now.</p>
          </>
        ) : selectedCanvasItem ? (
          <>
            <p className="empty-hint">Detailed properties for this element aren't built yet — selection only, for now.</p>
            {DRAGGABLE_CANVAS_ITEM_IDS.has(selectedCanvasItem.id) && (
              <>
                <h4>Position</h4>
                <div className="row">
                  {(() => {
                    const pos = canvasItemPositions[selectedCanvasItem.id];
                    const x = pos ? Math.round(pos.xPct * rawW) : null;
                    const y = pos ? Math.round(pos.yPct * rawH) : null;
                    return (
                      <>
                        <input value={x === null ? "X Default" : `X ${x}`} readOnly />
                        <input value={y === null ? "Y Default" : `Y ${y}`} readOnly />
                      </>
                    );
                  })()}
                </div>
              </>
            )}
          </>
        ) : (
          <p className="empty-hint">Select a clip, text, or overlay on the timeline to edit its properties.</p>
        )}
        </>
      )}

      {rightTab === "Layers" && (
        <ul className="layers-list">
          {/* Video stays the fixed background/base layer — not draggable, not part of
              layersListVisual's reorderable stack, per this step's requirement. */}
          {videoClips.map(c => (
            <li key={c.id} className={selectedElement?.type === "clip" && selectedElement.id === c.id ? "active" : ""}
              onClick={() => setSelectedElement({ type: "clip", lane: "video", id: c.id })}>🎬 {c.name || "Clip"}</li>
          ))}
          {/* Layers reorder: Text and Overlay rows, interleaved by their shared `order` field,
              each draggable. Native HTML5 drag-and-drop — no new library. Dropping row A onto
              row B moves A to B's current position in this list (and therefore in canvas paint
              order); it never touches startTime/endTime/position/size/media/filters. */}
          {layersListVisual.map((l, i) => (
            <li key={`${l.type}-${l.id}`}
              className={`draggable-layer ${selectedElement?.type === l.type && selectedElement.id === l.id ? "active" : ""}`}
              draggable
              onDragStart={() => { dragLayerRef.current = { type: l.type, id: l.id }; }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const dragged = dragLayerRef.current;
                dragLayerRef.current = null;
                if (dragged) reorderVisualLayers(dragged, i);
              }}
              onClick={() => setSelectedElement({ type: l.type, id: l.id })}
              title="Drag to change front/back order"
            >
              {l.label}
            </li>
          ))}
          {audioTracks.map(a => (
            <li key={a.id} className={selectedElement?.type === "audio" && selectedElement.id === a.id ? "active" : ""}
              onClick={() => setSelectedElement({ type: "audio", id: a.id })}>🎵 {a.name}</li>
          ))}
          {videoClips.length + textOverlays.length + audioTracks.length + mediaOverlays.length === 0 && (
            <p className="empty-hint">No layers yet.</p>
          )}
        </ul>
      )}

      {rightTab === "Adjustments" && (
        selectedClip ? (
          <>
            {(["brightness", "contrast", "saturation"] as const).map(k => (
              <label key={k} className="stack-field">
                <span style={{ textTransform: "capitalize" }}>{k}</span>
                {/* Step 6: onMouseDown = one history snapshot per drag; onChange (continuous) = raw */}
                <input type="range" min={-50} max={50} value={selectedClip[k]}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateVideoClip(selectedClip.id, { [k]: Number(e.target.value) } as Partial<VideoClip>)} />
              </label>
            ))}
          </>
        ) : selectedOverlay ? (
          // Step 5 follow-up (Adjust): same three sliders, same -50..+50 range/formula as Video's
          // above — extended to Overlay per this step's requirement ("must work on Video, Image,
          // visual Overlay"), since MediaOverlay now carries the identical optional field shape.
          <>
            {(["brightness", "contrast", "saturation"] as const).map(k => (
              <label key={k} className="stack-field">
                <span style={{ textTransform: "capitalize" }}>{k}</span>
                <input type="range" min={-50} max={50} value={selectedOverlay[k] ?? 0}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateMediaOverlay(selectedOverlay.id, { [k]: Number(e.target.value) } as Partial<MediaOverlay>)} />
              </label>
            ))}
          </>
        ) : <p className="empty-hint">Select a video clip or overlay to adjust brightness, contrast and saturation.</p>
      )}
    </>
  );

  // AI Prompt Generator — Task 3 (project context). Everything here is real, live editor state;
  // nothing is invented. Deliberately excludes a Brand Kit lookup: no `Brand` row exists for
  // this client in this environment (confirmed by inspection), and Video Studio V2 has no
  // brand_id anywhere in its own data model to look one up by, so sending one would mean
  // guessing which brand this project belongs to — PROJECT_CLIENT_IDENTITY's plain client/
  // campaign label is the one real "who this is for" fact this editor actually has.
  const buildAiPromptContext = () => {
    const ctx: Record<string, unknown> = {
      client: PROJECT_CLIENT_IDENTITY.client,
      campaign: PROJECT_CLIENT_IDENTITY.campaign,
      platform_format: canvasFormat.label,
      aspect_ratio: canvasFormat.ratio,
      canvas_width: canvasFormat.width,
      canvas_height: canvasFormat.height,
      project_duration_seconds: Math.round(effectiveDuration),
      video_clip_count: videoClips.length,
    };
    const targetClip = selectedClip ?? activeVideoClip;
    if (targetClip) ctx.selected_media_name = targetClip.name;
    const existingText = textOverlays.map(t => t.text).filter(Boolean);
    if (existingText.length) ctx.existing_on_screen_text = existingText;
    return ctx;
  };

  const runAiPromptGeneration = async () => {
    const instruction = promptGenInstruction.trim();
    if (!instruction) return;
    setPromptGenLoading(true);
    setPromptGenError(null);
    setPromptGenCopied(false);
    try {
      const { data } = await generateApi.prompt({ instruction, context: buildAiPromptContext() });
      setPromptGenResult((data as { prompt: string }).prompt);
    } catch (err) {
      // Same "read the backend's real detail message" convention ReviewTab's export error
      // handling already established — never a generic "something went wrong" when the
      // backend gave a specific, actionable reason (Task 4: missing config vs. call failure).
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPromptGenError(detail || "Could not generate a prompt — please try again.");
      setPromptGenResult(null);
    } finally {
      setPromptGenLoading(false);
    }
  };

  const closeAiPromptGenerator = () => {
    setPromptGenOpen(false);
    setPromptGenInstruction("");
    setPromptGenResult(null);
    setPromptGenError(null);
    setPromptGenLoading(false);
    setPromptGenCopied(false);
  };

  const copyAiPromptResult = async () => {
    if (!promptGenResult) return;
    try {
      await navigator.clipboard.writeText(promptGenResult);
      setPromptGenCopied(true);
      setTimeout(() => setPromptGenCopied(false), 1800);
    } catch {
      // Clipboard permission denied/unavailable — the text is still fully visible and
      // selectable in the result area, so this fails quietly rather than blocking anything.
    }
  };

  const aiToolsPanelBody = (
    <>
      <h3>✦ AI Tools</h3>
      {[
        ["AI Prompt Generator", "Generate on-brand prompts"],
        ["AI Image Generator", "Create custom images"],
        ["AI Hook Suggestion", "Get better hooks"],
        ["AI Script Writer", "Write engaging scripts"],
        ["AI Caption Generator", "Create captions & hashtags"],
        ["AI Thumbnail Ideas", "Generate thumbnails"],
      ].map(([t, d]) =>
        // AI Prompt Generator only, first of these six — the other five stay exactly as they
        // were (dead, honestly labeled) until each is implemented and approved individually.
        t === "AI Prompt Generator" ? (
          <button key={t} type="button" onClick={() => setPromptGenOpen(true)}><b>{t}</b><small>{d}</small></button>
        ) : (
          <button key={t} type="button" title="Not yet connected to a generation backend"><b>{t}</b><small>{d}</small></button>
        )
      )}
      <h3>Quick Actions</h3>
      {["Remove Background", "Auto Enhance"].map(x => (
        <button key={x} type="button" title="Not yet connected to a generation backend">{x}</button>
      ))}
      <button type="button" onClick={() => setResizePicker(v => !v)}>Resize for Platforms</button>
      {resizePicker && (
        <div className="resize-picker">
          <p className="resize-note">Architecture only — {PENDING_REFRAME_NOTE}</p>
          {RESIZE_TARGET_PLATFORMS.map(key => {
            const group = CANVAS_PLATFORMS.find(p => p.key === key)!;
            return (
              <label key={key} className="resize-target-row">
                <input type="checkbox" checked={resizeTargets.has(key)} onChange={() => toggleResizeTarget(key)} />
                {group.label}
              </label>
            );
          })}
          <button className="primary" type="button" disabled={resizeTargets.size === 0} onClick={runResizeForPlatforms}>
            Generate {resizeTargets.size || ""} Version{resizeTargets.size === 1 ? "" : "s"}
          </button>
        </div>
      )}
      {resizeStatus && <p className="resize-status">{resizeStatus}</p>}
      <button type="button" title="Not yet connected to a generation backend">Generate Video (External)</button>
    </>
  );

  return (
    <div className="stage-page create-page">
      <div className="creation-modes">
        {CREATION_MODES.map(x => (
          <button
            className={mode === x ? "active" : ""}
            onClick={() => { setMode(x); if (x === "My Drafts") void openMyDrafts(); }}
            key={x} type="button"
          >{x}</button>
        ))}
        {/* STEP 7.9: Save Draft — the one new action button this step adds to this row; every
            other button here is unchanged. */}
        <button type="button" className="primary save-draft-btn" onClick={openSaveDraft} disabled={draftBusy}>
          💾 Save Draft
        </button>
        <button type="button" onClick={handleNewDraft} disabled={draftBusy} title="Start a new project without affecting any saved draft">
          + New
        </button>
        {draftStatus && <span className="draft-status">{draftStatus}</span>}
        <div className="canvas-size">
          Canvas Size
          <select
            value={`${canvasFormat.platformKey}|${canvasFormat.placementKey}`}
            onChange={e => handleFormatSelect(e.target.value)}
            title={`${canvasFormat.ratio} · ${canvasFormat.width}×${canvasFormat.height}`}
          >
            {CANVAS_PLATFORMS.map(p => (
              <optgroup label={p.label} key={p.key}>
                {p.placements.map(pl => (
                  <option key={pl.key} value={`${p.key}|${pl.key}`}>
                    {pl.label} — {pl.width}×{pl.height} ({pl.ratio})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {canvasFormat.ratio === "CUSTOM" && (
            <span className="custom-size-inputs">
              <input type="number" min={1} value={customW} onChange={e => applyCustomSize(Number(e.target.value) || 1, customH)} />×
              <input type="number" min={1} value={customH} onChange={e => applyCustomSize(customW, Number(e.target.value) || 1)} />
            </span>
          )}
          <button type="button">⛶</button>
        </div>
      </div>

      <div className="canvas-versions">
        {(showAllVersions ? canvasVersions : canvasVersions.slice(0, 7)).map(v => (
          <button
            key={`${v.platformKey}|${v.placementKey}`}
            type="button"
            className={v.platformKey === canvasFormat.platformKey && v.placementKey === canvasFormat.placementKey ? "active" : ""}
            onClick={() => setCanvasFormat(v)}
            title={`${v.width}×${v.height}`}
          >
            {v.label} ({v.ratio})
          </button>
        ))}
        {canvasVersions.length > 7 && (
          <button type="button" onClick={() => setShowAllVersions(v => !v)}>
            {showAllVersions ? "Show Less" : "+ More"}
          </button>
        )}
      </div>

      <div className={`editor-shell ${focusMode ? "focus-mode" : ""}`} ref={editorShellRef}>
        <aside className="asset-panel">{assetPanelBody}</aside>

        <section className="preview-area">
          <div className="canvas-toolbar">
            <button type="button" onClick={handleUndo} disabled={undoStackRef.current.length === 0} title="Undo">↶</button>
            <button type="button" onClick={handleRedo} disabled={redoStackRef.current.length === 0} title="Redo">↷</button>
            <button type="button">✋</button>
            <button className="active" type="button">⌁</button>
            <span className="zoom-readout" title="Actual scale of the canvas as displayed">{Math.round((canvasBox.w / rawW) * 100)}%</span>
            {/* STEP 7 (Platform Canvas / Full-Screen Video Acceptance): was a fully dead
                placeholder button (no onClick at all) — the same "decorative control" pattern
                already found and fixed for the preview mute speaker and Undo/Redo before this
                project's Step 5/6. Acts on cropTargetClip (selected clip, else whatever the
                preview is currently showing); disabled with no clip loaded since there's nothing
                to apply Fit/Fill to yet. */}
            <span className="crop-mode-menu">
              <button
                type="button"
                disabled={!cropTargetClip}
                onClick={() => setCropMenuOpen(v => !v)}
                title="How the video fills the platform canvas"
              >
                Crop⌄
              </button>
              {cropMenuOpen && cropTargetClip && (
                <div className="crop-mode-dropdown">
                  <button
                    type="button"
                    className={(cropTargetClip.fitMode ?? "fit") === "fit" ? "active" : ""}
                    onClick={() => applyClipFitMode(cropTargetClip, "fit")}
                  >
                    Fit — show the whole frame, bars where ratios differ
                  </button>
                  <button
                    type="button"
                    className={cropTargetClip.fitMode === "fill" && repositionClipId !== cropTargetClip.id ? "active" : ""}
                    onClick={() => applyClipFitMode(cropTargetClip, "fill")}
                  >
                    Fill — cover the canvas, no bars (crops to fit)
                  </button>
                  <button
                    type="button"
                    className={repositionClipId === cropTargetClip.id ? "active" : ""}
                    onClick={() => enterCropReposition(cropTargetClip)}
                  >
                    Crop &amp; Reposition — drag to choose what's cropped
                  </button>
                </div>
              )}
            </span>
            <button
              type="button"
              className={focusMode ? "active" : ""}
              title={focusMode ? "Exit Focus Mode" : "Expand editing canvas"}
              onClick={() => { setFocusMode(v => !v); setDrawer(null); }}
            >
              ⛶
            </button>
            {/* STEP 7 (Keyboard Shortcuts): the one new control this step adds — everything
                else in this toolbar is unchanged. Staff won't remember shortcuts on day one, so
                this stays visible rather than being buried in a menu. */}
            <button type="button" className={shortcutsPanelOpen ? "active" : ""} title="Keyboard Shortcuts" onClick={() => setShortcutsPanelOpen(v => !v)}>
              ?
            </button>
          </div>

          {focusMode && (
            <div className="focus-tabs">
              <button type="button" className={drawer === "media" ? "active" : ""} onClick={() => toggleDrawer("media")}>▤ Media</button>
              <button type="button" className={drawer === "properties" ? "active" : ""} onClick={() => toggleDrawer("properties")}>≡ Properties</button>
              <button type="button" className={drawer === "aiTools" ? "active" : ""} onClick={() => toggleDrawer("aiTools")}>✦ AI Tools</button>
            </div>
          )}

          <div className={`preview-canvas-region orientation-${orientation}`} ref={previewRegionRef} onClick={deselectCanvas}>
            {hasRealSrc ? (
              <div
                ref={videoPreviewBoxRef}
                className={`video-preview real canvas-selectable ${selectedClip?.id === activeVideoClip!.id ? "canvas-el-selected" : ""}`}
                style={{ width: canvasBox.w, height: canvasBox.h }}
                onClick={e => { e.stopPropagation(); setSelectedElement({ type: "clip", lane: "video", id: activeVideoClip!.id }); }}
                title={`${activeVideoClip!.name || "Video"} — click to select`}
              >
                <video ref={videoRef} src={activeVideoClip!.url} className="real-video-el" playsInline
                  // Manual test defect (Crop & Reposition drag not working in real Chrome):
                  // <video> (like <img>) is natively draggable in Chrome by default — a real,
                  // physical mousedown+drag on it starts the browser's OWN HTML5 drag-and-drop
                  // gesture (dragstart/drag/dragend), which takes over the pointer and stops
                  // dispatching ordinary 'mousemove' events for the gesture's duration. That
                  // silently starved handleCropDragMove's window-level 'mousemove' listener of
                  // any events at all, so cropOffsetX/Y never updated — reproduced exactly this
                  // way: a real physical drag produced nothing, while an earlier *synthetic*
                  // dispatchEvent('mousedown'/'mousemove') test (not a real, trusted OS-level
                  // gesture) never triggered native drag detection in the first place, so it
                  // never exposed this. draggable={false} disables the browser's native drag
                  // entirely, so this element's mousedown->mousemove->mouseup sequence reaches
                  // beginCropDrag/handleCropDragMove exactly like any other draggable canvas
                  // element in this file (Text/Overlay, neither of which is a native-draggable
                  // element to begin with, which is why they never needed this).
                  draggable={false}
                  onMouseDown={beginCropDrag(activeVideoClip!)}
                  style={{
                    filter: getMediaFilter(activeVideoClip!),
                    opacity: getClipTransitionOpacity(activeVideoClip!, timeline.currentTime),
                    // STEP 7 (Platform Canvas / Full-Screen Video Acceptance): 'fit' (undefined/
                    // default, so every clip authored before this feature renders exactly as it
                    // always did) keeps the long-standing object-fit:contain from this class's
                    // own CSS rule — this inline style only overrides it once a clip explicitly
                    // opts into 'fill'. objectPosition mirrors cropOffsetX/Y directly (both
                    // 0-100, CSS's own percentage convention) so preview and export share the
                    // exact same crop-position math (see build_clip_segment on the export side).
                    ...(activeVideoClip!.fitMode === "fill"
                      ? { objectFit: "cover", objectPosition: `${activeVideoClip!.cropOffsetX ?? 50}% ${activeVideoClip!.cropOffsetY ?? 50}%` }
                      : {}),
                    cursor: repositionClipId === activeVideoClip!.id ? "move" : undefined,
                  }} />
                {repositionClipId === activeVideoClip!.id && (
                  <div className="crop-reposition-hint" onClick={e => e.stopPropagation()}>
                    Drag the video to choose what's cropped
                    <button type="button" onClick={() => setRepositionClipId(null)}>Done</button>
                  </div>
                )}
                {visualLayers}
              </div>
            ) : (
              <div ref={videoPreviewBoxRef} className="video-preview" style={{ width: canvasBox.w, height: canvasBox.h }} onClick={deselectCanvas}>
                <div
                  className={`preview-brand canvas-selectable ${isCanvasItemSelected("ph-logo") ? "canvas-el-selected" : ""}`}
                  onClick={selectCanvasItem("ph-logo", "Logo", "ABC Tiles Logo")}
                  title="Logo — click to select"
                >
                  ◇ ABC TILES
                </div>
                <div
                  className={`preview-copy canvas-selectable canvas-movable ${isCanvasItemSelected("ph-headline") ? "canvas-el-selected" : ""}`}
                  style={canvasItemDragStyle("ph-headline")}
                  onMouseDown={beginCanvasItemDrag("ph-headline", "Text", "Headline")}
                  onClick={e => e.stopPropagation()}
                  title="Text — click and drag to move"
                >
                  WHY BUILDERS<br />CHOOSE US<br /><strong>EVERY TIME</strong>
                </div>
                <div
                  className={`preview-badge canvas-selectable canvas-movable ${isCanvasItemSelected("ph-badge") ? "canvas-el-selected" : ""}`}
                  style={canvasItemDragStyle("ph-badge")}
                  onMouseDown={beginCanvasItemDrag("ph-badge", "Overlay", "Stock / Service / Solutions Bar")}
                  onClick={e => e.stopPropagation()}
                  title="Overlay — click and drag to move"
                >
                  STOCK • SERVICE • SOLUTIONS
                </div>
                <div
                  className={`preview-icons canvas-selectable ${isCanvasItemSelected("ph-icons") ? "canvas-el-selected" : ""}`}
                  onClick={selectCanvasItem("ph-icons", "Graphic", "Feature Icons")}
                  title="Graphic — click to select"
                >
                  <span>✓<b>RELIABLE<br />STOCK</b></span>
                  <span>▣<b>FAST<br />DELIVERY</b></span>
                  <span>♙<b>TRADE<br />SUPPORT</b></span>
                </div>
                <div
                  className={`preview-cta canvas-selectable ${isCanvasItemSelected("ph-cta") ? "canvas-el-selected" : ""}`}
                  onClick={selectCanvasItem("ph-cta", "CTA", "Visit Showroom CTA")}
                  title="CTA — click to select"
                >
                  {activeVideoClip ? activeVideoClip.name : "VISIT OUR SHOWROOM TODAY"}
                </div>
                {visualLayers}
              </div>
            )}
          </div>

          {/* Instruction 9: no visual UI (no waveform/controls requested) — purely the real
              playback engine for whichever AudioTrack is active right now. */}
          {activeAudioTrack && <audio ref={audioRef} src={activeAudioTrack.url} />}

          <div className="transport">
            <button
              type="button"
              onClick={() => {
                // Instruction 13: a small, local addition — if paused and sitting before IN,
                // pressing Play jumps to IN first, rather than redesigning playback to make IN
                // itself the "start of the world". Only applies when starting playback fresh.
                if (!timeline.playing && timeline.markIn !== null && timeline.currentTime < timeline.markIn) {
                  setTimeline({ currentTime: timeline.markIn, playing: true });
                } else {
                  setTimeline({ playing: !timeline.playing });
                }
              }}
            >
              {timeline.playing ? "⏸" : "▶"}
            </button>
            <button type="button" onClick={() => seekRatio(0)}>◀◀</button>
            <button type="button" onClick={() => seekRatio(1)}>▶▶</button>
            <span>{formatTimecode(timeline.currentTime)} / {formatTimecode(effectiveDuration)}</span>
            <button
              type="button"
              className={`preview-mute-btn ${previewMuted ? "muted" : ""}`}
              onClick={() => setPreviewMuted(m => !m)}
              title={previewMuted ? "Unmute preview" : "Mute preview"}
              aria-label={previewMuted ? "Unmute preview" : "Mute preview"}
              aria-pressed={previewMuted}
            >
              {previewMuted ? "🔇" : "🔊"}
            </button>
            <button type="button" onClick={() => videoRef.current?.requestFullscreen?.()}>⛶</button>
          </div>
        </section>

        <aside className="properties-panel">{propertiesPanelBody}</aside>

        <aside className="ai-tools-panel">{aiToolsPanelBody}</aside>

        {focusMode && drawer === "media" && (
          <div className="focus-drawer left">
            <div className="focus-drawer-head"><b>Media</b><button type="button" onClick={() => setDrawer(null)}>×</button></div>
            {assetPanelBody}
          </div>
        )}
        {focusMode && drawer === "properties" && (
          <div className="focus-drawer right">
            <div className="focus-drawer-head"><b>Properties</b><button type="button" onClick={() => setDrawer(null)}>×</button></div>
            {propertiesPanelBody}
          </div>
        )}
        {focusMode && drawer === "aiTools" && (
          <div className="focus-drawer right">
            <div className="focus-drawer-head"><b>AI Tools</b><button type="button" onClick={() => setDrawer(null)}>×</button></div>
            {aiToolsPanelBody}
          </div>
        )}

        <section
          className={`timeline ${dropActive ? "drop-active" : ""}`}
          ref={timelineSectionRef}
          onDragOver={e => { if (e.dataTransfer.types.includes(MEDIA_ASSET_DRAG_TYPE)) { e.preventDefault(); setDropActive(true); } }}
          onDragLeave={() => setDropActive(false)}
          onDrop={handleDrop}
        >
          <div className="timeline-toolbar">
            <button type="button">+ Add Track</button><button type="button">⧉</button>
            <button type="button" onClick={handleDeleteSelected} title="Delete selected clip (leaves the gap on this lane)">⌫</button>
            <button type="button" onClick={handleSplitAtPlayhead} title="Split selected clip at the playhead">✂</button>
            <button type="button" onClick={handleRippleDeleteSelected} title="Ripple Delete selected clip (closes the gap on this lane)">◫</button>
            <button type="button">◩</button>
          </div>
          <div className="time-ruler" ref={rulerRef} onMouseDown={beginScrub}>
            {Array.from({ length: 6 }).map((_, i) => <span key={i}>{formatTimecode((i / 5) * effectiveDuration)}</span>)}
          </div>

          <TrackRow label="V1 Video">
            {videoClips.map(c => (
              <ClipBlock key={c.id} start={c.startTime} end={c.endTime} total={effectiveDuration}
                selected={selectedElement?.type === "clip" && selectedElement.id === c.id}
                onClick={() => setSelectedElement({ type: "clip", lane: "video", id: c.id })}
                onMove={newStart => rawUpdateVideoClip(c.id, { startTime: newStart, endTime: newStart + (c.endTime - c.startTime) })}
                onTrimLeft={p => trimVideoLeft(c, p)} onTrimRight={p => trimVideoRight(c, p)} onGestureStart={pushHistory}
                color="blue" label={c.name || "Clip"} />
            ))}
          </TrackRow>
          <TrackRow label="T1 Text">
            {textOverlays.map(t => (
              <ClipBlock key={t.id} start={t.startTime} end={t.endTime} total={effectiveDuration}
                selected={selectedElement?.type === "text" && selectedElement.id === t.id}
                onClick={() => setSelectedElement({ type: "text", id: t.id })}
                onMove={newStart => rawUpdateTextOverlay(t.id, { startTime: newStart, endTime: newStart + (t.endTime - t.startTime) })}
                onTrimLeft={p => trimTextLeft(t, p)} onTrimRight={p => trimTextRight(t, p)} onGestureStart={pushHistory}
                color="purple" label={t.text} />
            ))}
          </TrackRow>
          <TrackRow label="O1 Overlay">
            {mediaOverlays.map(o => (
              <ClipBlock key={o.id} start={o.startTime} end={o.endTime} total={effectiveDuration}
                selected={selectedElement?.type === "overlay" && selectedElement.id === o.id}
                onClick={() => setSelectedElement({ type: "overlay", id: o.id })}
                onMove={newStart => rawUpdateMediaOverlay(o.id, { startTime: newStart, endTime: newStart + (o.endTime - o.startTime) })}
                onTrimLeft={p => trimOverlayLeft(o, p)} onTrimRight={p => trimOverlayRight(o, p)} onGestureStart={pushHistory}
                color="pink" label="Overlay" />
            ))}
          </TrackRow>
          <TrackRow label="A1 Audio">
            {audioTracks.map(a => (
              <ClipBlock key={a.id} start={a.startTime} end={a.endTime} total={effectiveDuration}
                selected={selectedElement?.type === "audio" && selectedElement.id === a.id}
                onClick={() => setSelectedElement({ type: "audio", id: a.id })}
                onMove={newStart => rawUpdateAudioTrack(a.id, { startTime: newStart, endTime: newStart + (a.endTime - a.startTime) })}
                onTrimLeft={p => trimAudioLeft(a, p)} onTrimRight={p => trimAudioRight(a, p)} onGestureStart={pushHistory}
                color="aqua" label={a.name} />
            ))}
          </TrackRow>
        </section>

        <div className="ai-assistant">
          <b>✦ AI Assistant</b>
          <input
            placeholder="Ask AI anything about your video..."
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && chatInput.trim()) { void sendChatMessage(chatInput); setChatInput(""); } }}
          />
          <button type="button" disabled={chatLoading || !chatInput.trim()} onClick={() => { void sendChatMessage(chatInput); setChatInput(""); }}>➤</button>
          <button type="button" onClick={() => sendQuickPrompt("Improve this scene")}>Improve this scene</button>
          <button type="button" onClick={() => sendQuickPrompt("Shorten video to 10s")}>Shorten video to 10s</button>
          <button type="button" onClick={() => sendQuickPrompt("Add stronger CTA")}>Add stronger CTA</button>
          <button type="button" onClick={() => sendQuickPrompt("Suggest bg music")}>Suggest bg music</button>
        </div>
        {chatMessages.length > 1 && (
          <div className="ai-chat-log">
            {chatMessages.slice(-3).map(m => <p key={m.id}><b>{m.role === "user" ? "You" : "AI"}:</b> {m.content}</p>)}
          </div>
        )}

        {/* Instruction 13: Playhead + IN/OUT — rendered here (siblings of the panels, direct
            children of .editor-shell) rather than nested inside .timeline/.track-lane, per the
            architecture note above. Horizontal position matches exactly what the ruler's own
            click math already computes (same rulerLeft/rulerWidth); vertical position/height
            come from real measured pixels (timelineGeom), not CSS inheritance. */}
        {effectiveDuration > 0 && timelineGeom.height > 0 && (
          <>
            <div
              className="timeline-playhead"
              style={{ left: timelineGeom.rulerLeft + (timeline.currentTime / effectiveDuration) * timelineGeom.rulerWidth, top: timelineGeom.top, height: timelineGeom.height }}
              title={`Playhead — ${formatTimecode(timeline.currentTime)}`}
            >
              <div className="timeline-playhead-grabber" onMouseDown={beginScrubFromGrabber} />
            </div>
            <div
              className="timeline-mark timeline-mark-in"
              style={{ left: timelineGeom.rulerLeft + ((timeline.markIn ?? 0) / effectiveDuration) * timelineGeom.rulerWidth, top: timelineGeom.rulerTop, height: timelineGeom.rulerHeight }}
              onMouseDown={beginMarkDrag("in")}
              title={`IN — ${formatTimecode(timeline.markIn ?? 0)} (working range start)`}
            />
            <div
              className="timeline-mark timeline-mark-out"
              style={{ left: timelineGeom.rulerLeft + ((timeline.markOut ?? effectiveDuration) / effectiveDuration) * timelineGeom.rulerWidth, top: timelineGeom.rulerTop, height: timelineGeom.rulerHeight }}
              onMouseDown={beginMarkDrag("out")}
              title={`OUT — ${formatTimecode(timeline.markOut ?? effectiveDuration)} (working range end)`}
            />
          </>
        )}
      </div>

      <div className="stage-footer">
        <button className="secondary" onClick={onBack} type="button">← Back: Creative Lab</button>
        <button className="primary" onClick={onNext} type="button">Next: Review →</button>
      </div>

      {/* STEP 7.9: Save Draft — overlay, doesn't rearrange the approved screen underneath it. */}
      {showSaveDraft && (
        <div className="draft-modal-overlay" onClick={() => !draftBusy && setShowSaveDraft(false)}>
          <div className="draft-modal" onClick={e => e.stopPropagation()}>
            <h3>{draftId != null ? "Save Draft" : "Save New Draft"}</h3>
            <label className="stack-field"><span>Draft name</span>
              <input
                type="text" value={saveNameInput} autoFocus
                onChange={e => setSaveNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void handleConfirmSaveDraft(); }}
              />
            </label>
            {draftId != null && (
              <p className="empty-hint">Saving updates your existing draft — it won't create a duplicate.</p>
            )}
            <div className="draft-modal-actions">
              <button type="button" onClick={() => setShowSaveDraft(false)} disabled={draftBusy}>Cancel</button>
              <button type="button" className="primary" onClick={() => void handleConfirmSaveDraft()} disabled={draftBusy}>
                {draftBusy ? "Saving…" : "Save Draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 7 (Keyboard Shortcuts): compact reference panel — reuses the exact same
          draft-modal-overlay/draft-modal visual treatment as Save Draft/My Drafts above rather
          than inventing new modal styling. Purely a reference list; no field to fill in, so
          just a Close button. */}
      {shortcutsPanelOpen && (
        <div className="draft-modal-overlay" onClick={() => setShortcutsPanelOpen(false)}>
          <div className="draft-modal shortcuts-modal" onClick={e => e.stopPropagation()}>
            <h3>Keyboard Shortcuts</h3>
            <ul className="shortcuts-list">
              <li><span>Play / Pause</span><kbd>Space</kbd></li>
              <li><span>Split at playhead</span><kbd>S</kbd></li>
              <li><span>Trim start to playhead</span><kbd>[</kbd></li>
              <li><span>Trim end to playhead</span><kbd>]</kbd></li>
              <li><span>Delete selected</span><kbd>Delete</kbd> / <kbd>Backspace</kbd></li>
              <li><span>Ripple Delete</span><kbd>Shift</kbd>+<kbd>Delete</kbd></li>
              <li><span>Undo</span><kbd>Ctrl</kbd>+<kbd>Z</kbd></li>
              <li><span>Redo</span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></li>
              <li><span>Copy</span><kbd>Ctrl</kbd>+<kbd>C</kbd></li>
              <li><span>Paste</span><kbd>Ctrl</kbd>+<kbd>V</kbd></li>
              <li><span>Duplicate</span><kbd>Ctrl</kbd>+<kbd>D</kbd></li>
              <li><span>Crop &amp; Reposition</span><kbd>C</kbd></li>
              <li><span>Fill canvas</span><kbd>F</kbd></li>
              <li><span>Fit video</span><kbd>Shift</kbd>+<kbd>F</kbd></li>
              <li><span>Resize / Transform</span><kbd>R</kbd></li>
              <li><span>Select / Move</span><kbd>V</kbd></li>
              <li><span>Nudge selected element</span><kbd>Arrow keys</kbd></li>
              <li><span>Fine nudge</span><kbd>Shift</kbd>+<kbd>Arrow</kbd></li>
              <li><span>Previous / next frame</span><kbd>←</kbd> / <kbd>→</kbd></li>
              <li><span>Go to beginning</span><kbd>Home</kbd></li>
              <li><span>Go to end</span><kbd>End</kbd></li>
              <li><span>Save Draft</span><kbd>Ctrl</kbd>+<kbd>S</kbd></li>
              <li><span>Cancel crop/resize mode</span><kbd>Esc</kbd></li>
            </ul>
            <p className="empty-hint">Shortcuts act on whatever's currently selected, and never fire while typing.</p>
            <div className="draft-modal-actions">
              <button type="button" onClick={() => setShortcutsPanelOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* AI Tools — AI Prompt Generator. Same draft-modal-overlay/draft-modal visual language as
          Save Draft/My Drafts/Shortcuts above — no new modal styling introduced, per "do not
          redesign the AI Tools panel / Create/Edit screen". Closing while a generation is in
          flight is blocked (same convention as Save Draft's own draftBusy guard) so a request
          can't be abandoned mid-flight and silently resolve into a closed panel. */}
      {promptGenOpen && (
        <div className="draft-modal-overlay" onClick={() => !promptGenLoading && closeAiPromptGenerator()}>
          <div className="draft-modal ai-prompt-gen-modal" onClick={e => e.stopPropagation()}>
            <h3>✦ AI Prompt Generator</h3>
            <label className="stack-field">
              <span>Instruction</span>
              <textarea
                placeholder='e.g. "Create a promotional video concept for ABC Tiles" or "Give me a prompt for a 15-second Instagram Reel promoting this product."'
                value={promptGenInstruction}
                onChange={e => setPromptGenInstruction(e.target.value)}
                disabled={promptGenLoading}
                rows={3}
              />
            </label>
            <p className="empty-hint">
              Uses this project's own context automatically — platform ({canvasFormat.label}), duration (~{Math.round(effectiveDuration)}s){(selectedClip ?? activeVideoClip) ? `, selected media (${(selectedClip ?? activeVideoClip)!.name})` : ""}.
            </p>
            <div className="draft-modal-actions">
              <button type="button" onClick={closeAiPromptGenerator} disabled={promptGenLoading}>Cancel</button>
              <button className="primary" type="button" onClick={runAiPromptGeneration} disabled={promptGenLoading || !promptGenInstruction.trim()}>
                {promptGenLoading ? "Generating…" : "Generate"}
              </button>
            </div>

            {promptGenError && <p className="inline-status error">{promptGenError}</p>}

            {promptGenResult && !promptGenError && (
              <div className="ai-prompt-result">
                <label className="stack-field">
                  <span>Generated Prompt</span>
                  <textarea value={promptGenResult} readOnly rows={6} />
                </label>
                <div className="draft-modal-actions">
                  <button type="button" onClick={copyAiPromptResult}>{promptGenCopied ? "✓ Copied" : "Copy"}</button>
                  <button type="button" onClick={runAiPromptGeneration} disabled={promptGenLoading}>Regenerate</button>
                  <button className="primary" type="button" onClick={closeAiPromptGenerator}>Close</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* STEP 7.9: My Drafts — intentionally-saved projects (backend-durable), NOT the
          automatic refresh-recovery snapshot (Requirement 10) — that keeps working on its own,
          untouched by this panel. */}
      {showMyDrafts && (
        <div className="draft-modal-overlay" onClick={() => setShowMyDrafts(false)}>
          <div className="draft-modal" onClick={e => e.stopPropagation()}>
            <h3>My Drafts</h3>
            {draftsLoading ? (
              <p className="empty-hint">Loading drafts…</p>
            ) : draftsError ? (
              <p className="empty-hint">{draftsError}</p>
            ) : drafts.length === 0 ? (
              <p className="empty-hint">No saved drafts yet — use Save Draft to create one.</p>
            ) : (
              <ul className="draft-list">
                {drafts.map(d => (
                  <li key={d.id} className="draft-list-item">
                    <div className="draft-meta">
                      <strong>{d.name}</strong>
                      <small>Last saved {new Date(d.updated_at).toLocaleString()}</small>
                    </div>
                    <button type="button" className="primary" disabled={draftBusy} onClick={() => void handleOpenDraft(d.id)}>
                      Open / Continue Editing
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="draft-modal-actions">
              <button type="button" onClick={() => setShowMyDrafts(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrackRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="track"><div className="track-label">{label}<span>◉ 🔒</span></div><div className="track-lane">{children}</div></div>;
}

// Instruction 8: horizontal drag-to-reposition, generic across all four lanes — the caller
// (CreateEditTab) supplies onMove, which decides which update*(id, {startTime, endTime})
// action to call; ClipBlock itself only ever computes a proposed new start time from pixels
// dragged against its OWN track-lane's current pixel width, never touching browser-pixel
// values in the stored result. Each ClipBlock instance owns its own drag session (a ref, not
// shared), so dragging one clip can never move another — no track-level state exists at all.
function ClipBlock({ start, end, total, color, label, selected, onClick, onMove, onTrimLeft, onTrimRight, onGestureStart }: {
  start: number; end: number; total: number; color: string; label: string; selected?: boolean;
  onClick?: () => void;
  onMove?: (newStart: number) => void;
  // Instruction 10: reports the pointer's raw proposed new start/end (seconds, unclamped) —
  // the caller applies its own clamping and decides which fields to update (trimIn/trimOut for
  // Video/Audio, plain startTime/endTime for Text/Overlay), since those rules genuinely differ
  // per type. ClipBlock only ever converts pixels dragged against its own lane's live width.
  onTrimLeft?: (proposedStart: number) => void;
  onTrimRight?: (proposedEnd: number) => void;
  // Step 6: fired exactly once, at the very start of a body-drag or trim gesture (never on the
  // intermediate mousemove ticks onMove/onTrimLeft/onTrimRight fire on) — lets the caller record
  // one "before" history snapshot per whole gesture instead of one per pixel dragged.
  onGestureStart?: () => void;
}) {
  const leftPct = total > 0 ? (start / total) * 100 : 0;
  const widthPct = total > 0 ? Math.max(((end - start) / total) * 100, 1.5) : 10;
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ laneWidth: number; startClientX: number; origStart: number } | null>(null);
  const trimRef = useRef<{ laneWidth: number; startClientX: number; origValue: number; mode: "left" | "right" } | null>(null);
  // Step 6: onGestureStart must fire only if a drag/trim ACTUALLY happens — a plain click that
  // selects the clip and releases without moving must never push a no-op history snapshot (that
  // would silently inflate the undo stack with an entry Undo can't visibly do anything for).
  // Reset to false on mousedown, flipped true (and onGestureStart fired) on the first real move.
  const gestureStartedRef = useRef(false);
  const trimGestureStartedRef = useRef(false);

  const handleMove = (e: MouseEvent) => {
    const s = dragRef.current;
    if (!s || total <= 0) return;
    if (!gestureStartedRef.current) { onGestureStart?.(); gestureStartedRef.current = true; }
    const dTime = ((e.clientX - s.startClientX) / s.laneWidth) * total;
    onMove?.(Math.max(0, s.origStart + dTime)); // §"BOUNDARIES": minimum start is 0.00s, no upper clamp — extending duration is allowed, not truncated
  };
  const handleEnd = () => {
    dragRef.current = null;
    setDragging(false);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleMove);
    window.removeEventListener("mouseup", handleEnd);
  };
  const handleDown = (e: React.MouseEvent) => {
    onClick?.(); // selection happens immediately on mousedown, same convention as canvas drag (Instructions 3/7) — clip stays selected whether or not a drag follows
    if (!onMove) return;
    e.preventDefault(); // no native text-selection while dragging
    const lane = (e.currentTarget as HTMLElement).parentElement;
    if (!lane) return;
    gestureStartedRef.current = false;
    dragRef.current = { laneWidth: lane.getBoundingClientRect().width, startClientX: e.clientX, origStart: start };
    setDragging(true);
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleEnd);
  };

  // Trim handles — deliberately separate refs/listeners from body-drag above, and each
  // handle's onMouseDown stops propagation so it never also triggers the body-drag handler on
  // the same mousedown (moving the whole clip and trimming an edge can never happen together).
  const handleTrimMove = (e: MouseEvent) => {
    const s = trimRef.current;
    if (!s || total <= 0) return;
    if (!trimGestureStartedRef.current) { onGestureStart?.(); trimGestureStartedRef.current = true; }
    const dTime = ((e.clientX - s.startClientX) / s.laneWidth) * total;
    const proposed = s.origValue + dTime;
    if (s.mode === "left") onTrimLeft?.(proposed); else onTrimRight?.(proposed);
  };
  const handleTrimEnd = () => {
    trimRef.current = null;
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleTrimMove);
    window.removeEventListener("mouseup", handleTrimEnd);
  };
  const beginTrim = (mode: "left" | "right") => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClick?.(); // stays selected through the trim, same convention as body-drag
    const lane = (e.currentTarget as HTMLElement).closest(".track-lane") as HTMLElement | null;
    if (!lane) return;
    trimGestureStartedRef.current = false;
    trimRef.current = {
      laneWidth: lane.getBoundingClientRect().width, startClientX: e.clientX,
      origValue: mode === "left" ? start : end, mode,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleTrimMove);
    window.addEventListener("mouseup", handleTrimEnd);
  };

  return (
    <div
      className={`clip ${color} ${selected ? "selected" : ""} ${onMove ? "draggable-clip" : ""}`}
      style={{ position: "absolute", left: `${leftPct}%`, width: `${widthPct}%` }}
      onMouseDown={handleDown}
      title={label}
    >
      {label}
      {dragging && <span className="clip-drag-badge">{formatTimecode(start)}</span>}
      {selected && onTrimLeft && <div className="clip-trim-handle left" onMouseDown={beginTrim("left")} title="Drag to trim start" />}
      {selected && onTrimRight && <div className="clip-trim-handle right" onMouseDown={beginTrim("right")} title="Drag to trim end" />}
    </div>
  );
}
