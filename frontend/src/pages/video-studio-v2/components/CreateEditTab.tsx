
import React, { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useStudio } from "../../../contexts/StudioContext";
import { assetsApi, videoStudioDraftsApi, generateApi, referenceVideosApi, transcribeApi } from "../../../api/client";
import {
  MEDIA_ASSET_DRAG_TYPE, dragKindMimeType,
  type MediaAssetDragPayload, type MediaAssetDragKind,
} from "../../../components/studio/dragTypes";
import {
  findActiveClip, probeVideoDuration, probeHasAudioTrack, computeEndTimeForSpeed,
  computeInsertTrimLeft, computeInsertTrimRight, defaultBrollAudioMode, composeTextBgColor, composeHexAlpha,
  parseSrtTranscript, autoSegmentPlainTranscript, snapToGuides, buildSnapTargets,
} from "../../../components/studio/videoPreviewUtils";
import type { CanvasFormatState, CanvasItemPosition } from "../../../contexts/StudioContext";
import type { Asset, VideoClip, TextOverlay, MediaOverlay, AudioTrack, LowerThird, Shape, SubtitleSegment, SubtitleStyle, ReferenceVideo } from "../../../types";
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
const MEDIA_TABS = ["All", "Videos", "Images", "Text", "Overlays", "Lower Thirds", "Shapes", "Subtitles", "Audio"] as const;

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

// Phase 1 (V2 Inserts/B-roll): starting canvas box for a newly-inserted V2 clip — a
// picture-in-picture-sized box in the bottom-right quadrant, the conventional B-roll/PiP
// starting position. Percent-of-canvas, same convention as MediaOverlay's own x/y/width/height.
const DEFAULT_INSERT_BOX = { insertX: 56, insertY: 56, insertWidth: 38, insertHeight: 38 };

// Phase 2 (Video Studio V2 — Lower Thirds): starting canvas box for a newly-added lower third —
// the conventional broadcast lower-third shape/position (a wide, short band low on the frame,
// left-aligned). Percent-of-canvas, same convention as MediaOverlay's own x/y/width/height.
const DEFAULT_LOWER_THIRD_BOX = { x: 5, y: 78, width: 55, height: 14 };

// Phase 3 (Video Studio V2 — Advanced Text Properties) — "TextArt / preset styles": each preset
// is a real bundle of the same fields the Properties controls above already write, applied in
// one click; there is no separate preset-rendering system. Every preset explicitly sets every
// field it cares about (including zeroing out ones a DIFFERENT preset would have set) so presets
// never partially layer on top of each other's leftovers.
const TEXT_STYLE_PRESETS: { name: string; apply: Partial<TextOverlay> }[] = [
  {
    name: "Bold Impact",
    apply: {
      strokeColor: "#000000", strokeWidth: 3, shadowColor: "#000000", shadowBlur: 4, shadowOffsetX: 2, shadowOffsetY: 2,
      bgColor: "transparent", useGradient: false,
    },
  },
  {
    name: "Clean Caption",
    apply: {
      strokeWidth: 0, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, useGradient: false,
      bgColor: "#000000", bgOpacity: 0.65, bgBorderRadius: 6, bgFullWidth: false, bgBlur: false,
    },
  },
  {
    name: "Neon Glow",
    apply: {
      strokeColor: "#12A656", strokeWidth: 1, shadowColor: "#2FE0E0", shadowBlur: 18, shadowOffsetX: 0, shadowOffsetY: 0,
      bgColor: "transparent", useGradient: false,
    },
  },
  {
    name: "Subtitle Bar",
    apply: {
      strokeWidth: 0, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, useGradient: false,
      bgColor: "#000000", bgOpacity: 0.75, bgFullWidth: true, bgBorderRadius: 0, bgBlur: false,
    },
  },
];

// Phase 4 (Video Studio V2 — Independent Shapes): one starting box + style per named kind the
// spec asks for — "rounded rectangle" isn't its own kind (see Shape's own type comment), so it
// isn't listed separately here either; picking it is Rectangle + dragging the Radius slider up.
const SHAPE_KIND_LABELS: Record<Shape["kind"], string> = {
  rectangle: "Rectangle", circle: "Circle", line: "Line", banner: "Banner", highlight: "Highlight",
};
function defaultShapeBox(kind: Shape["kind"]): Pick<Shape, "x" | "y" | "width" | "height" | "fillColor" | "opacity" | "borderRadius" | "fullWidth"> {
  switch (kind) {
    case "circle": return { x: 40, y: 35, width: 20, height: 20, fillColor: "#12A656", opacity: 1, borderRadius: undefined, fullWidth: false };
    case "line": return { x: 10, y: 50, width: 80, height: 0.6, fillColor: "#FFFFFF", opacity: 1, borderRadius: 0, fullWidth: false };
    case "banner": return { x: 0, y: 45, width: 100, height: 10, fillColor: "#000000", opacity: 0.7, borderRadius: 0, fullWidth: true };
    // "Highlight block" — a lower-opacity marker block meant to sit behind text (its default
    // `order`, set at creation below, already places it at the back of the layer stack).
    case "highlight": return { x: 10, y: 40, width: 60, height: 12, fillColor: "#FFE066", opacity: 0.55, borderRadius: 2, fullWidth: false };
    default: return { x: 20, y: 30, width: 40, height: 25, fillColor: "#12A656", opacity: 0.85, borderRadius: 4, fullWidth: false };
  }
}

// Phase 6 (Video Studio V2 — Safe Areas / Guides / Snapping). Insets are percent-of-canvas,
// nested from tightest to loosest so all four read as distinct rectangles at once: Margins (a
// simple practical "don't sit right at the edge" guide) inside Action-Safe inside Title-Safe —
// Action-Safe/Title-Safe are the classic broadcast-safe convention (90%/80% of frame). Platform
// Safe Zone is a clearly-labeled APPROXIMATION of where short-form vertical apps (Reels/TikTok/
// Shorts) typically overlay their own UI (caption band, action-button rail) — not a value taken
// from any single platform's published spec, since none of the three publish exact pixel specs
// as part of a public API; it exists as a rough placement aid, not a guarantee.
type GuideKey = "center" | "margins" | "actionSafe" | "titleSafe" | "platformSafeZone";
const GUIDE_LABELS: Record<GuideKey, string> = {
  center: "Centre lines", margins: "Margins", actionSafe: "Action-safe (90%)",
  titleSafe: "Title-safe (80%)", platformSafeZone: "Platform UI zone (approx.)",
};
const MARGIN_INSET_PCT = 3;
const ACTION_SAFE_INSET_PCT = 5;
const TITLE_SAFE_INSET_PCT = 10;
// Bottom caption/UI band + right action-button rail, shown only for vertical (9:16-ish) formats
// — the ratio those three apps' own feeds actually use.
const PLATFORM_SAFE_BOTTOM_PCT = 14;
const PLATFORM_SAFE_RIGHT_PCT = 8;

// STEP 7.9 (Save Draft + My Drafts): the complete, intentionally-saved project — everything
// listed in the Step 7.9 requirement (video/audio/text/overlay/timeline/canvas/format state)
// plus a lightweight "client/project identity" label. `clientIdentity` mirrors the two strings
// VideoStudioV2.tsx's sidebar "Current Project" card already shows (currently hardcoded mock
// values there too, not real state) — captured here so a draft records *what project it was*
// even though neither spot has a real editable field for it yet; if that ever becomes real
// state, both places would read from it together.
interface DraftProjectSnapshot {
  videoClips: VideoClip[];
  // Phase 1 (V2 Inserts/B-roll) — Requirement 7: V2 clips must survive Save/Refresh/Reopen.
  additionalVideoClips: VideoClip[];
  textOverlays: TextOverlay[];
  mediaOverlays: MediaOverlay[];
  audioTracks: AudioTrack[];
  // Phase 2 (Video Studio V2 — Lower Thirds): survives Save/Refresh/Reopen, same as every
  // other real V2 timeline content array.
  lowerThirds: LowerThird[];
  // Phase 4 (Video Studio V2 — Independent Shapes): survives Save/Refresh/Reopen too.
  shapes: Shape[];
  // Phase 5 (Video Studio V2 — Subtitles / Transcript): segments AND the global style both
  // survive Save/Refresh/Reopen.
  subtitles: SubtitleSegment[];
  subtitleStyle: SubtitleStyle;
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

// Media-to-timeline routing requirement: which track a media-library asset targets, derived
// from the same file_type classification assetKind already uses — one source of truth for
// "what kind of thing is this" shared by the drag-source grid and the drop-target routing.
function dragKindForAssetKind(kind: "Videos" | "Images" | "Audio"): MediaAssetDragKind {
  return kind === "Videos" ? "video" : kind === "Audio" ? "audio" : "image";
}

// Computer -> Timeline direct drop: a real OS file carries a browser-reported MIME type (e.g.
// "video/mp4"), not a file_type — same three-way split as _classify() on the backend
// (backend/app/routers/upload.py), kept independent since this only ever needs to decide
// which timeline track a *dropped* file should become, not persist a classification.
function dragKindForMime(mime: string): MediaAssetDragKind | null {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
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
    // Phase 1 (V2 Inserts/B-roll): additionalVideoClips already existed on StudioContext with
    // full CRUD (see StudioContext.tsx) but had no consumer anywhere in Video Studio V2 until
    // now — reused as-is, same "raw + history-wrapped" pattern as every other lane below.
    additionalVideoClips, addAdditionalVideoClip: rawAddAdditionalVideoClip,
    updateAdditionalVideoClip: rawUpdateAdditionalVideoClip, removeAdditionalVideoClip: rawRemoveAdditionalVideoClip,
    textOverlays, addTextOverlay: rawAddTextOverlay, updateTextOverlay: rawUpdateTextOverlay, removeTextOverlay: rawRemoveTextOverlay,
    audioTracks, addAudioTrack: rawAddAudioTrack, updateAudioTrack: rawUpdateAudioTrack, removeAudioTrack: rawRemoveAudioTrack,
    mediaOverlays, addMediaOverlay: rawAddMediaOverlay, updateMediaOverlay: rawUpdateMediaOverlay, removeMediaOverlay: rawRemoveMediaOverlay,
    // Phase 2 (Video Studio V2 — Lower Thirds): lowerThirds already existed on StudioContext
    // with full CRUD (legacy /studio's own LowerThirdBuilder.tsx already uses it) but had no
    // canvas/timeline presence in Video Studio V2 until now — same "raw + history-wrapped"
    // pattern as every other lane below.
    lowerThirds, addLowerThird: rawAddLowerThird, updateLowerThird: rawUpdateLowerThird, removeLowerThird: rawRemoveLowerThird,
    // Phase 4 (Video Studio V2 — Independent Shapes): brand-new on StudioContext (added
    // alongside this phase) — same "raw + history-wrapped" pattern as every other lane.
    shapes, addShape: rawAddShape, updateShape: rawUpdateShape, removeShape: rawRemoveShape,
    // Phase 5 (Video Studio V2 — Subtitles / Transcript): brand-new on StudioContext (added
    // alongside this phase) — same "raw + history-wrapped" pattern as every other lane.
    subtitles, addSubtitle: rawAddSubtitle, updateSubtitle: rawUpdateSubtitle, removeSubtitle: rawRemoveSubtitle,
    subtitleStyle, setSubtitleStyle,
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
  // Phase 1: additionalVideoClips (V2) joins the four content arrays Undo/Redo already covers —
  // same rules, same reasoning (playhead/selection stay excluded), just a fifth array.
  // Phase 2: lowerThirds joins the content arrays Undo/Redo covers — same rules as V2's own
  // additionalVideoClips addition before it.
  // Phase 5: subtitles joins the content arrays too. subtitleStyle (the global default) is
  // deliberately NOT part of this — same "settings, not content" treatment canvasFormat/timeline
  // already get; a subtitleStyle edit isn't reverted by Undo, consistent with those.
  type EditorSnapshot = { videoClips: VideoClip[]; additionalVideoClips: VideoClip[]; textOverlays: TextOverlay[]; mediaOverlays: MediaOverlay[]; audioTracks: AudioTrack[]; lowerThirds: LowerThird[]; shapes: Shape[]; subtitles: SubtitleSegment[] };
  const MAX_HISTORY = 50;
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const currentEditorState = (): EditorSnapshot => ({
    videoClips: [...videoClips], additionalVideoClips: [...additionalVideoClips],
    textOverlays: [...textOverlays], mediaOverlays: [...mediaOverlays], audioTracks: [...audioTracks],
    lowerThirds: [...lowerThirds], shapes: [...shapes], subtitles: [...subtitles],
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
    additionalVideoClips.forEach(c => rawRemoveAdditionalVideoClip(c.id));
    snap.additionalVideoClips.forEach(c => rawAddAdditionalVideoClip(c));
    textOverlays.forEach(t => rawRemoveTextOverlay(t.id));
    snap.textOverlays.forEach(t => rawAddTextOverlay(t));
    mediaOverlays.forEach(o => rawRemoveMediaOverlay(o.id));
    snap.mediaOverlays.forEach(o => rawAddMediaOverlay(o));
    audioTracks.forEach(a => rawRemoveAudioTrack(a.id));
    snap.audioTracks.forEach(a => rawAddAudioTrack(a));
    lowerThirds.forEach(l => rawRemoveLowerThird(l.id));
    snap.lowerThirds.forEach(l => rawAddLowerThird(l));
    shapes.forEach(s => rawRemoveShape(s.id));
    snap.shapes.forEach(s => rawAddShape(s));
    subtitles.forEach(s => rawRemoveSubtitle(s.id));
    snap.subtitles.forEach(s => rawAddSubtitle(s));
    // If whatever was selected no longer exists in the restored state, fall back to no
    // selection rather than leave Properties/Layers pointing at a stale id.
    if (selectedElement) {
      const stillExists =
        (selectedElement.type === "clip" && selectedElement.lane === "video" && snap.videoClips.some(c => c.id === selectedElement.id)) ||
        (selectedElement.type === "clip" && selectedElement.lane === "additional" && snap.additionalVideoClips.some(c => c.id === selectedElement.id)) ||
        (selectedElement.type === "text" && snap.textOverlays.some(t => t.id === selectedElement.id)) ||
        (selectedElement.type === "overlay" && snap.mediaOverlays.some(o => o.id === selectedElement.id)) ||
        (selectedElement.type === "audio" && snap.audioTracks.some(a => a.id === selectedElement.id)) ||
        (selectedElement.type === "lowerThird" && snap.lowerThirds.some(l => l.id === selectedElement.id)) ||
        (selectedElement.type === "shape" && snap.shapes.some(s => s.id === selectedElement.id)) ||
        (selectedElement.type === "subtitle" && snap.subtitles.some(s => s.id === selectedElement.id)) ||
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
  const addAdditionalVideoClip = (c: VideoClip) => { pushHistory(); rawAddAdditionalVideoClip(c); };
  const updateAdditionalVideoClip = (id: string, upd: Partial<VideoClip>) => { pushHistory(); rawUpdateAdditionalVideoClip(id, upd); };
  const removeAdditionalVideoClip = (id: string) => { pushHistory(); rawRemoveAdditionalVideoClip(id); };
  const addTextOverlay = (t: TextOverlay) => { pushHistory(); rawAddTextOverlay(t); };
  const updateTextOverlay = (id: string, upd: Partial<TextOverlay>) => { pushHistory(); rawUpdateTextOverlay(id, upd); };
  const removeTextOverlay = (id: string) => { pushHistory(); rawRemoveTextOverlay(id); };
  const addMediaOverlay = (o: MediaOverlay) => { pushHistory(); rawAddMediaOverlay(o); };
  const updateMediaOverlay = (id: string, upd: Partial<MediaOverlay>) => { pushHistory(); rawUpdateMediaOverlay(id, upd); };
  const removeMediaOverlay = (id: string) => { pushHistory(); rawRemoveMediaOverlay(id); };
  const addLowerThird = (l: LowerThird) => { pushHistory(); rawAddLowerThird(l); };
  const updateLowerThird = (id: string, upd: Partial<LowerThird>) => { pushHistory(); rawUpdateLowerThird(id, upd); };
  const removeLowerThird = (id: string) => { pushHistory(); rawRemoveLowerThird(id); };
  const addShape = (s: Shape) => { pushHistory(); rawAddShape(s); };
  const updateShape = (id: string, upd: Partial<Shape>) => { pushHistory(); rawUpdateShape(id, upd); };
  const removeShape = (id: string) => { pushHistory(); rawRemoveShape(id); };
  const addSubtitle = (s: SubtitleSegment) => { pushHistory(); rawAddSubtitle(s); };
  const updateSubtitle = (id: string, upd: Partial<SubtitleSegment>) => { pushHistory(); rawUpdateSubtitle(id, upd); };
  const removeSubtitle = (id: string) => { pushHistory(); rawRemoveSubtitle(id); };
  const addAudioTrack = (a: AudioTrack) => { pushHistory(); rawAddAudioTrack(a); };
  const updateAudioTrack = (id: string, upd: Partial<AudioTrack>) => { pushHistory(); rawUpdateAudioTrack(id, upd); };
  const removeAudioTrack = (id: string) => { pushHistory(); rawRemoveAudioTrack(id); };

  const [mode, setMode] = useState(CREATION_MODES[0]);
  const [mediaTab, setMediaTab] = useState<typeof MEDIA_TABS[number]>("All");
  const [search, setSearch] = useState("");
  const [rightTab, setRightTab] = useState<"Properties" | "Layers" | "Adjustments">("Properties");
  const [chatInput, setChatInput] = useState("");
  const [dropActive, setDropActive] = useState(false);
  // Media-to-timeline routing requirement (Drop Target Feedback): which track is the valid
  // destination for whatever's currently being dragged over the timeline — video/audio/image
  // route to exactly one track each (V1/A1/O1), so knowing the kind is enough to know, and
  // highlight, the one correct track; there's no per-pixel "which row is the pointer over"
  // hit-testing to do. null while nothing compatible is being dragged over the timeline.
  const [dragOverKind, setDragOverKind] = useState<MediaAssetDragKind | null>(null);
  // Canvas Video Drop addendum: same "is a compatible drag currently over this drop target"
  // feedback flag as the timeline's own dropActive, scoped to the canvas/preview region.
  const [canvasDropActive, setCanvasDropActive] = useState(false);
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
  // Phase 1 (V2 Inserts/B-roll): same "crop-reposition handle armed" flag as repositionClipId
  // above, for whichever V2 clip (if any) currently has it armed.
  const [insertRepositionId, setInsertRepositionId] = useState<string | null>(null);
  // Phase 6 (Video Studio V2 — Safe Areas / Guides / Snapping): purely local, view-only UI
  // state, same category as cropMenuOpen above — which guide overlays are visible and whether
  // dragging snaps to them. Deliberately not part of the saved project (a viewing aid, not
  // project data — the same "settings, not content" treatment canvasFormat's own local UI
  // toggles already get) and defaults to the two most broadly useful guides already on.
  const [guidesMenuOpen, setGuidesMenuOpen] = useState(false);
  const [guidesEnabled, setGuidesEnabled] = useState<Record<GuideKey, boolean>>({
    center: true, margins: false, actionSafe: true, titleSafe: false, platformSafeZone: false,
  });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const toggleGuide = (key: GuideKey) => setGuidesEnabled(p => ({ ...p, [key]: !p[key] }));
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

  // Video Deconstructor — Stage 6 (OCR / On-Screen Text / Captions) ONLY. Same independent
  // busy/error pair as Stage 4/5 above — read from pass_status.text_analysis, never hides
  // Stage 3/4/5's already-complete results.
  const [refAnalyzeTextBusy, setRefAnalyzeTextBusy] = useState(false);
  const [refAnalyzeTextError, setRefAnalyzeTextError] = useState<string | null>(null);

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
  // Stage 6 (Text Analysis): same independent-selection pattern as selectedFrameId above, for
  // OCR text-occurrence rows.
  const [selectedTextElementId, setSelectedTextElementId] = useState<number | null>(null);

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
    videoClips, additionalVideoClips, textOverlays, mediaOverlays, audioTracks, lowerThirds, shapes, subtitles, subtitleStyle, mediaAssets,
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
    additionalVideoClips.forEach(c => rawRemoveAdditionalVideoClip(c.id));
    textOverlays.forEach(t => rawRemoveTextOverlay(t.id));
    mediaOverlays.forEach(o => rawRemoveMediaOverlay(o.id));
    audioTracks.forEach(a => rawRemoveAudioTrack(a.id));
    lowerThirds.forEach(l => rawRemoveLowerThird(l.id));
    shapes.forEach(s => rawRemoveShape(s.id));
    subtitles.forEach(s => rawRemoveSubtitle(s.id));
    setSelectedElement(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryTick(v => v + 1);
  };

  const applyDraftSnapshot = (snap: DraftProjectSnapshot) => {
    clearLiveProject();
    (snap.videoClips ?? []).forEach(c => rawAddVideoClip(c));
    (snap.additionalVideoClips ?? []).forEach(c => rawAddAdditionalVideoClip(c));
    (snap.textOverlays ?? []).forEach(t => rawAddTextOverlay(t));
    (snap.mediaOverlays ?? []).forEach(o => rawAddMediaOverlay(o));
    (snap.audioTracks ?? []).forEach(a => rawAddAudioTrack(a));
    (snap.lowerThirds ?? []).forEach(l => rawAddLowerThird(l));
    (snap.shapes ?? []).forEach(s => rawAddShape(s));
    (snap.subtitles ?? []).forEach(s => rawAddSubtitle(s));
    if (snap.subtitleStyle) setSubtitleStyle(snap.subtitleStyle);
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
  // Phase 1 (V2 Inserts/B-roll): the second, real, independently-playing <video> element — see
  // its own sync effects below, which follow the exact same reactive pattern Audio already uses
  // (react to timeline.currentTime/playing, never drive them; only V1's own clock does that).
  const insertVideoRef = useRef<HTMLVideoElement>(null);
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
  // Phase 1 (V2 Inserts/B-roll): identical drag/resize session shapes to Overlay's own above,
  // writing into VideoClip's new insertX/Y/Width/Height fields instead of MediaOverlay's x/y/
  // width/height — same free-form resize (no aspect lock), same reasoning as Overlay's own.
  const dragInsertSessionRef = useRef<{
    id: string; boxW: number; boxH: number; elW: number; elH: number;
    startClientX: number; startClientY: number; origX: number; origY: number;
  } | null>(null);
  const resizeInsertSessionRef = useRef<{
    id: string; boxW: number; boxH: number; startClientX: number; startClientY: number; corner: ResizeCorner;
    origX: number; origY: number; origWidth: number; origHeight: number;
  } | null>(null);
  const insertDragMovedRef = useRef(false);
  const insertResizeMovedRef = useRef(false);
  // Same "crop reposition" session as V1's cropDragSessionRef, writing into the SAME
  // cropOffsetX/Y fields (VideoClip already has them) on an additionalVideoClips entry instead.
  const insertCropDragSessionRef = useRef<{
    id: string; boxW: number; boxH: number; startClientX: number; startClientY: number;
    origOffsetX: number; origOffsetY: number;
  } | null>(null);
  const insertCropDragMovedRef = useRef(false);
  // Phase 2 (Video Studio V2 — Lower Thirds): identical drag/resize session shapes to Overlay's
  // own above, writing into LowerThird's new x/y/width/height fields.
  const dragLowerThirdSessionRef = useRef<{
    id: string; boxW: number; boxH: number; elW: number; elH: number;
    startClientX: number; startClientY: number; origX: number; origY: number;
  } | null>(null);
  const resizeLowerThirdSessionRef = useRef<{
    id: string; boxW: number; boxH: number; startClientX: number; startClientY: number; corner: ResizeCorner;
    origX: number; origY: number; origWidth: number; origHeight: number;
  } | null>(null);
  const lowerThirdDragMovedRef = useRef(false);
  const lowerThirdResizeMovedRef = useRef(false);
  // Phase 4 (Video Studio V2 — Independent Shapes): identical drag/resize session shapes again,
  // writing into Shape's x/y/width/height.
  const dragShapeSessionRef = useRef<{
    id: string; boxW: number; boxH: number; elW: number; elH: number;
    startClientX: number; startClientY: number; origX: number; origY: number;
  } | null>(null);
  const resizeShapeSessionRef = useRef<{
    id: string; boxW: number; boxH: number; startClientX: number; startClientY: number; corner: ResizeCorner;
    origX: number; origY: number; origWidth: number; origHeight: number;
  } | null>(null);
  const shapeDragMovedRef = useRef(false);
  const shapeResizeMovedRef = useRef(false);
  // Phase 5 (Video Studio V2 — Subtitles / Transcript): move session shaped like Shape's own
  // above (real x/y/width move); resize is width-only, same convention as Text's own
  // resizeTextSessionRef — a subtitle's box height is implicit from its wrapped text content,
  // not a stored field, exactly like Text.
  const dragSubtitleSessionRef = useRef<{
    id: string; boxW: number; boxH: number; elW: number; elH: number;
    startClientX: number; startClientY: number; origX: number; origY: number;
  } | null>(null);
  const resizeSubtitleSessionRef = useRef<{
    id: string; boxW: number; startClientX: number; corner: ResizeCorner;
    origX: number; origWidth: number;
  } | null>(null);
  const subtitleDragMovedRef = useRef(false);
  const subtitleResizeMovedRef = useRef(false);
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
  // Phase 1 (V2 Inserts/B-roll): same findActiveClip utility V1 uses, over additionalVideoClips
  // — a real second "which clip is showing right now" computation, not a stand-in.
  const activeAdditionalClip = findActiveClip(additionalVideoClips, timeline.currentTime);
  const activeAdditionalClipId = activeAdditionalClip?.id ?? null;

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

  // Phase 6 (Video Studio V2 — Safe Areas / Guides / Snapping): the raw guide LINES currently
  // enabled, in canvas percent — independent of aspect ratio for every guide except the
  // platform safe zone, which only makes sense for the vertical (9:16-ish) formats those apps
  // actually use. Shared by both the visual overlay render and the snap-target math below, so
  // "what's drawn" and "what you snap to" can never drift apart.
  const isVerticalFormat = canvasFormat.height > canvasFormat.width;
  const guideXs: number[] = [
    ...(guidesEnabled.center ? [50] : []),
    ...(guidesEnabled.margins ? [MARGIN_INSET_PCT, 100 - MARGIN_INSET_PCT] : []),
    ...(guidesEnabled.actionSafe ? [ACTION_SAFE_INSET_PCT, 100 - ACTION_SAFE_INSET_PCT] : []),
    ...(guidesEnabled.titleSafe ? [TITLE_SAFE_INSET_PCT, 100 - TITLE_SAFE_INSET_PCT] : []),
    ...(guidesEnabled.platformSafeZone && isVerticalFormat ? [100 - PLATFORM_SAFE_RIGHT_PCT] : []),
  ];
  const guideYs: number[] = [
    ...(guidesEnabled.center ? [50] : []),
    ...(guidesEnabled.margins ? [MARGIN_INSET_PCT, 100 - MARGIN_INSET_PCT] : []),
    ...(guidesEnabled.actionSafe ? [ACTION_SAFE_INSET_PCT, 100 - ACTION_SAFE_INSET_PCT] : []),
    ...(guidesEnabled.titleSafe ? [TITLE_SAFE_INSET_PCT, 100 - TITLE_SAFE_INSET_PCT] : []),
    ...(guidesEnabled.platformSafeZone && isVerticalFormat ? [100 - PLATFORM_SAFE_BOTTOM_PCT] : []),
  ];
  // The one place every draggable canvas element's move-handler calls into the shared
  // buildSnapTargets/snapToGuides pair — snapEnabled=false (or a drag that's landed outside
  // every threshold) always falls through to the raw, un-snapped value untouched, exactly the
  // "should help but should NOT prevent free positioning" requirement.
  const snapAxis = (rawValue: number, size: number, guides: number[]): number =>
    snapEnabled ? snapToGuides(rawValue, buildSnapTargets(guides, size)) : rawValue;

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

  // ---- Phase 1 (V2 Inserts/B-roll): real playback for the second video layer — purely
  // reactive to timeline.currentTime/playing, exactly like Audio's own sync effects just below
  // (never V1's own master rAF clock, which stays untouched — Requirement 10/11: V1 must remain
  // unchanged). This is what keeps V2 genuinely independent of V1: it plays only inside its own
  // [startTime, endTime) window, wherever that sits relative to V1, and V1's own stop-point
  // (end of its last clip) is unaffected by whatever V2 is doing. ----
  useEffect(() => {
    const vid = insertVideoRef.current;
    if (!vid || !activeAdditionalClip) return;
    const clip = activeAdditionalClip;
    const speed = clip.speed || 1;
    const applyOffset = () => {
      const offset = Math.max(0, timeline.currentTime - clip.startTime) * speed + clip.trimIn;
      if (Math.abs(vid.currentTime - offset) > 0.05) vid.currentTime = offset;
      vid.playbackRate = speed;
      if (timeline.playing) vid.play().catch(() => {});
    };
    if (vid.readyState >= 1) applyOffset();
    else vid.addEventListener("loadedmetadata", applyOffset, { once: true });
    return () => vid.removeEventListener("loadedmetadata", applyOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAdditionalClipId, activeAdditionalClip?.speed]);

  useEffect(() => {
    const vid = insertVideoRef.current;
    if (!vid || !activeAdditionalClip) return;
    const speed = activeAdditionalClip.speed || 1;
    const targetLocal = Math.max(0, timeline.currentTime - activeAdditionalClip.startTime) * speed + activeAdditionalClip.trimIn;
    if (Math.abs(vid.currentTime - targetLocal) > 0.35 && vid.readyState >= 1) vid.currentTime = targetLocal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.currentTime, activeAdditionalClipId]);

  useEffect(() => {
    const vid = insertVideoRef.current;
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

  // ---- Video Deconstructor — Stage 6 (OCR / On-Screen Text / Captions) ONLY. Same
  // "always call, replace refIngestResult with whatever comes back" shape as handleAnalyzeFrames
  // above — safe to call again after a failure (retries in place server-side) or after success
  // (idempotent, returns the same completed text occurrences). ----
  const handleAnalyzeText = async () => {
    if (!refIngestResult) return;
    setRefAnalyzeTextBusy(true);
    setRefAnalyzeTextError(null);
    try {
      const { data } = await referenceVideosApi.analyzeText(refIngestResult.id);
      setRefIngestResult(data as ReferenceVideo);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setRefAnalyzeTextError(detail || "Could not analyse on-screen text for this reference video — please try again.");
    } finally {
      setRefAnalyzeTextBusy(false);
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

  // Stage 6 (Text Analysis): same seek behaviour, tracking which text occurrence is selected.
  const handleSeekReferencePreviewToText = (shotId: number, textElementId: number, seconds: number) => {
    setSelectedTextElementId(textElementId);
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

  // ---- Media-to-timeline insertion (Media Library / OS file → V1 Video / A1 Audio / O1
  // Overlay): the one real "turn an asset into a timeline clip" implementation, shared by
  // drag-and-drop (dropTime = drop position), click-to-add ("+ Add to Timeline" — startTime =
  // playhead), and Computer → Timeline direct drop (Instruction 2 — upload then insert). Each
  // helper takes an explicit startTime rather than assuming "append at the end" or "always
  // 0:00", exactly per the "insert at the corresponding time, never force 00:00" requirement. ----

  // V1 Video. Reuses the exact same probeVideoDuration/probeHasAudioTrack + "mirror embedded
  // audio onto A1" behaviour the original drag-only handleDrop already had (Instruction 12) —
  // that logic is unchanged, just extracted so click-to-add gets it too.
  const insertVideoClipAt = async (assetId: number, url: string, name: string, startTime: number) => {
    const duration = await probeVideoDuration(url);
    const clip: VideoClip = {
      id: crypto.randomUUID(), assetId, url, name,
      duration, startTime, endTime: startTime + duration,
      trimIn: 0, trimOut: 0, colorGrade: "none", speed: 1,
      brightness: 0, contrast: 0, saturation: 0, transition: "cut", transitionDuration: 0.5,
    };
    addVideoClip(clip);
    setSelectedElement({ type: "clip", lane: "video", id: clip.id });

    const hasAudio = await probeHasAudioTrack(url);
    if (hasAudio) {
      const audioTrack: AudioTrack = {
        id: crypto.randomUUID(), assetId, url, name: `${name} (Audio)`,
        volume: 1, startTime, endTime: startTime + duration,
        trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0, duck: false,
      };
      addAudioTrack(audioTrack);
    }
  };

  // Phase 1 (V2 Inserts/B-roll) — Requirement 9: unlike V1 (which auto-mirrors detected audio
  // straight onto A1, no question asked — the source video IS the project's main audio), a V2
  // insert's own embedded audio is never auto-mixed in. If audio is detected, this only ever
  // records the SAFE DEFAULT (`brollAudio: 'muted'`) on the clip itself — the video plays back
  // silently until the user explicitly chooses "Keep" in Properties (applyBrollAudioChoice
  // above), which is the one and only place a B-roll AudioTrack ever gets created.
  const insertAdditionalVideoClipAt = async (assetId: number, url: string, name: string, startTime: number) => {
    const duration = await probeVideoDuration(url);
    const hasAudio = await probeHasAudioTrack(url);
    const clip: VideoClip = {
      id: crypto.randomUUID(), assetId, url, name,
      duration, startTime, endTime: startTime + duration,
      trimIn: 0, trimOut: 0, colorGrade: "none", speed: 1,
      brightness: 0, contrast: 0, saturation: 0, transition: "cut", transitionDuration: 0.5,
      ...DEFAULT_INSERT_BOX,
      brollAudio: defaultBrollAudioMode(hasAudio),
    };
    addAdditionalVideoClip(clip);
    setSelectedElement({ type: "clip", lane: "additional", id: clip.id });
  };

  // A1 Audio (Instruction 9's original model, now taking an explicit startTime instead of
  // always appending after the last audio track).
  const insertAudioTrackAt = async (assetId: number, url: string, name: string, startTime: number) => {
    const duration = await probeVideoDuration(url);
    const track: AudioTrack = {
      id: crypto.randomUUID(), assetId, url,
      name: name.replace(/\.[^.]+$/, ""),
      volume: 1, startTime, endTime: startTime + duration,
      trimIn: 0, trimOut: 0, fadeIn: 0, fadeOut: 0, duck: false,
    };
    addAudioTrack(track);
    setSelectedElement({ type: "audio", id: track.id });
  };

  // O1 Overlay — an uploaded image has no intrinsic duration, so this reuses the exact same
  // fixed 5s-or-until-project-end default handleAddOverlayFile already established for the
  // Overlays tab's own "+ Add Overlay" upload, just anchored at startTime instead of always
  // "now". Images still route to O1 Overlay, not V2 — Phase 1 (V2 Inserts/B-roll) is VIDEO
  // only, per its own spec ("A REAL second video layer... do not simulate V2 using an image").
  const insertImageOverlayAt = (assetId: number, url: string, startTime: number) => {
    const overlay: MediaOverlay = {
      id: crypto.randomUUID(), url, assetId,
      x: 10, y: 10, width: 30, height: 30, opacity: 1,
      startTime, endTime: Math.min(startTime + 5, effectiveDuration || startTime + 5),
    };
    addMediaOverlay(overlay);
    setSelectedElement({ type: "overlay", id: overlay.id });
  };

  // Click-to-Add fallback (Instruction 3): no drop position exists for a click, so it inserts
  // at the current playhead (timeline.currentTime) — the track is chosen automatically from
  // the asset's own kind, exactly like drag-and-drop routes by the same kind.
  const handleAddAssetToTimeline = async (asset: Asset, kind: "Videos" | "Images" | "Audio") => {
    const url = assetsApi.previewUrl(asset.file_path);
    const startTime = timeline.currentTime;
    if (kind === "Videos") await insertVideoClipAt(asset.id, url, asset.original_filename, startTime);
    else if (kind === "Audio") await insertAudioTrackAt(asset.id, url, asset.original_filename, startTime);
    else insertImageOverlayAt(asset.id, url, startTime);
  };

  // Phase 1 — "Canvas Intent" requirement: an explicit, unambiguous "Add as B-roll (V2)" choice
  // for a Media Library video, distinct from handleAddAssetToTimeline's own Video path (which
  // always means "Add as Main Video" -> V1). Never guesses intent from anything implicit.
  const handleAddAssetAsBroll = async (asset: Asset) => {
    await insertAdditionalVideoClipAt(asset.id, assetsApi.previewUrl(asset.file_path), asset.original_filename, timeline.currentTime);
  };

  // ---- Media Library: Delete / Remove (new — the library grid previously had no way to
  // remove an uploaded item at all). Only ever removes this SESSION's local mediaAssets entry
  // (see StudioContext's own removeMediaAsset comment) — never the backend file/DB row, which
  // other saved drafts may still reference. ----
  const isAssetUsedOnTimeline = (assetId: number) =>
    videoClips.some(c => c.assetId === assetId) ||
    additionalVideoClips.some(c => c.assetId === assetId) ||
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
      additionalVideoClips.filter(c => c.assetId === asset.id).forEach(c => rawRemoveAdditionalVideoClip(c.id));
      mediaOverlays.filter(o => o.assetId === asset.id).forEach(o => rawRemoveMediaOverlay(o.id));
      audioTracks.filter(a => a.assetId === asset.id).forEach(a => rawRemoveAudioTrack(a.id));
      if (
        selectedElement &&
        ((selectedElement.type === "clip" && selectedElement.lane === "video" && videoClips.find(c => c.id === selectedElement.id)?.assetId === asset.id) ||
          (selectedElement.type === "clip" && selectedElement.lane === "additional" && additionalVideoClips.find(c => c.id === selectedElement.id)?.assetId === asset.id) ||
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

  // ---- Timeline: real drop target for Media Library assets AND raw OS files (Instructions 1
  // & 2), routed to whichever of V1 Video / A1 Audio / O1 Overlay matches the dragged kind. ----

  // Instruction 7 (Timeline Positioning): converts a drop's horizontal client position into a
  // timeline second, against the SAME ruler element (and identical left/width math) the
  // existing playhead scrub/seek already uses — so a drop lines up with the ruler's own
  // timecodes exactly as displayed, with no separate/drifting position system. This timeline
  // has no zoom or horizontal scroll of its own (the ruler always spans the full
  // 0..effectiveDuration range), so that's the entire calculation — nothing to additionally
  // account for.
  const computeDropTime = (e: DragEvent<HTMLElement>): number => {
    const rulerEl = rulerRef.current;
    if (!rulerEl || effectiveDuration <= 0) return 0;
    const rect = rulerEl.getBoundingClientRect();
    return Math.max(0, ((e.clientX - rect.left) / rect.width) * effectiveDuration);
  };

  // Instruction 6 (Drop Target Feedback): identifies what's being dragged WITHOUT reading
  // dataTransfer's actual payload (browsers only allow getData() on the real 'drop' event, not
  // during 'dragover') — a Media Library asset advertises its kind as its own MIME type (see
  // dragKindMimeType in dragTypes.ts), and a real OS file drag exposes each file's type on
  // dataTransfer.items even mid-drag, in every browser this editor targets.
  const detectDragKind = (e: DragEvent<HTMLElement>): MediaAssetDragKind | null => {
    const types = e.dataTransfer.types;
    if (types.includes(dragKindMimeType("video"))) return "video";
    if (types.includes(dragKindMimeType("audio"))) return "audio";
    if (types.includes(dragKindMimeType("image"))) return "image";
    if (types.includes("Files")) {
      const mime = e.dataTransfer.items?.[0]?.type;
      if (mime) return dragKindForMime(mime);
    }
    return null;
  };

  // Canvas Video Drop addendum ("Reuse Existing Implementation"): the one shared "what was
  // actually dropped" resolver for every drop target in this editor (Timeline AND Canvas) —
  // reused rather than duplicated, per that requirement. Reads an already-uploaded Media
  // Library payload as-is (Media Library → Canvas/Timeline: "do NOT upload it again, reuse the
  // existing Asset"), or uploads+libraries a raw OS file first (Computer → Canvas/Timeline).
  // Returns null for anything neither path recognises (e.g. a non-media OS file) — each caller
  // decides what "no match" (or "wrong kind for this drop target") means for itself.
  const resolveDroppedMediaSource = async (
    e: DragEvent<HTMLElement>
  ): Promise<{ assetId: number; url: string; name: string; kind: MediaAssetDragKind } | null> => {
    const raw = e.dataTransfer.getData(MEDIA_ASSET_DRAG_TYPE);
    if (raw) {
      let payload: MediaAssetDragPayload;
      try { payload = JSON.parse(raw); } catch { return null; }
      return { assetId: payload.assetId, url: payload.url, name: payload.name, kind: payload.kind };
    }
    const file = e.dataTransfer.files?.[0];
    if (!file) return null;
    const kind = dragKindForMime(file.type || "");
    if (!kind) return null; // unsupported file type for a direct drop (e.g. a PDF) — silently ignored, same as an unrecognised drag today
    const asset = await uploadAsset(file); // may throw — uploadAsset already surfaces a chat error message; callers just stop on catch
    addMediaAsset(asset);
    return { assetId: asset.id, url: assetsApi.previewUrl(asset.file_path), name: asset.original_filename, kind };
  };

  // ---- Timeline: real drop target for Media Library assets AND raw OS files (Instructions 1
  // & 2), routed to whichever of V1 Video / A1 Audio / O1 Overlay matches the dragged kind. ----
  const handleDrop = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDropActive(false);
    setDragOverKind(null);
    const dropTime = computeDropTime(e);
    let source;
    try { source = await resolveDroppedMediaSource(e); } catch { return; }
    if (!source) return;
    if (source.kind === "audio") await insertAudioTrackAt(source.assetId, source.url, source.name, dropTime);
    else if (source.kind === "image") insertImageOverlayAt(source.assetId, source.url, dropTime);
    else await insertVideoClipAt(source.assetId, source.url, source.name, dropTime);
  };

  // Phase 1 — "Canvas Intent" requirement ("A video must be able to be intentionally added to
  // V2 rather than V1... provide an explicit choice rather than guessing"): dropping specifically
  // on the V2 Insert/B-roll timeline row is unambiguous by construction — a distinct row is the
  // explicit choice the requirement asks for, no guessing involved. stopPropagation keeps this
  // from ALSO triggering the section-level handleDrop above (which would otherwise insert the
  // same drop onto V1 too). Only video is accepted here — same "V2 is video-only" rule as
  // insertAdditionalVideoClipAt itself.
  const handleDropOnV2Row = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    setDragOverKind(null);
    const dropTime = computeDropTime(e);
    let source;
    try { source = await resolveDroppedMediaSource(e); } catch { return; }
    if (!source || source.kind !== "video") return;
    await insertAdditionalVideoClipAt(source.assetId, source.url, source.name, dropTime);
  };

  // ---- Canvas Video Drop addendum, extended for Phase 1's "Canvas -> V2" requirement: dropping
  // a VIDEO directly onto the main preview/canvas is MAIN VIDEO insertion (V1 + its own embedded
  // A1 audio) UNLESS a V1 clip is already active at the current playhead — in which case the
  // canvas is visibly already showing a main video, so a second video dropped there can only
  // sensibly mean B-roll/overlay footage layered over it, not "replace the main video" (which
  // has its own explicit path: drop directly on the V1 timeline row). This is a deterministic
  // read of existing, visible state, not a guess — the "Canvas Intent" requirement's own
  // "explicit choice rather than guessing" is satisfied by TIMELINE ROW targeting (V1 row / V2
  // row / the "+ Add as B-roll" button all remain unambiguous regardless of state); this rule is
  // additionally what makes the CANVAS SURFACE itself behave the way a user would actually
  // expect it to, without adding a modal or a modifier-key gesture nothing else in this editor
  // uses. Audio/image canvas drop remains out of scope — see the addendum's own comment above. ----
  const handleCanvasVideoDrop = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setCanvasDropActive(false);
    let source;
    try { source = await resolveDroppedMediaSource(e); } catch { return; }
    if (!source || source.kind !== "video") return;
    if (activeVideoClip) await insertAdditionalVideoClipAt(source.assetId, source.url, source.name, timeline.currentTime);
    else await insertVideoClipAt(source.assetId, source.url, source.name, timeline.currentTime);
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
  // Phase 1 (V2 Inserts/B-roll): same pattern as selectedClip above, over additionalVideoClips
  // instead — the 'additional' lane StudioContext's SelectedElement type already reserved.
  const selectedAdditionalClip = selectedElement?.type === "clip" && selectedElement.lane === "additional"
    ? additionalVideoClips.find(c => c.id === selectedElement.id) ?? null
    : null;
  const selectedText = selectedElement?.type === "text"
    ? textOverlays.find(t => t.id === selectedElement.id) ?? null
    : null;
  // Overlay selection (extends the exact same real-data-model pattern as selectedClip/
  // selectedText above — id lookup into the array StudioContext already owns, nothing new).
  const selectedOverlay = selectedElement?.type === "overlay"
    ? mediaOverlays.find(o => o.id === selectedElement.id) ?? null
    : null;
  // Phase 2 (Video Studio V2 — Lower Thirds): same pattern as selectedOverlay above.
  const selectedLowerThird = selectedElement?.type === "lowerThird"
    ? lowerThirds.find(l => l.id === selectedElement.id) ?? null
    : null;
  // Phase 4 (Video Studio V2 — Independent Shapes): same pattern.
  const selectedShape = selectedElement?.type === "shape"
    ? shapes.find(s => s.id === selectedElement.id) ?? null
    : null;
  // Phase 5 (Video Studio V2 — Subtitles / Transcript): same pattern.
  const selectedSubtitle = selectedElement?.type === "subtitle"
    ? subtitles.find(s => s.id === selectedElement.id) ?? null
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

  // Phase 3 (Video Studio V2 — Advanced Text Properties): the full canvas render style for a
  // TextOverlay, computed from every field this phase adds plus the two that already existed
  // but were previously dead on canvas (bgColor/bgOpacity) — matching, byte-for-byte, the exact
  // hex+alpha composition legacy /studio's own PreviewCanvas.tsx already uses for those two
  // fields (`${bgColor}${Math.round(bgOpacity*255).toString(16).padStart(2,'0')}`), so a project
  // opened in either editor renders the same background chip.
  //
  // Gradient text fill and the background chip are mutually exclusive on this one element: both
  // would need the CSS `background` property (gradient uses background-clip:text; the chip uses
  // a plain background-color), and this architecture renders the chip and the text as the same
  // element (contentEditable targets it directly), not text-in-a-wrapping-span. Choosing a
  // gradient fill intentionally skips the background chip rather than silently fighting it —
  // documented here and in the Properties panel, not a silent gap.
  const getTextRenderStyle = (t: TextOverlay): React.CSSProperties => {
    const gradientActive = !!(t.useGradient && t.gradientFrom && t.gradientTo);
    const base: React.CSSProperties = {
      left: `${t.x}%`, top: `${t.y}%`, width: `${t.width}%`,
      fontFamily: t.fontFamily, fontSize: t.fontSize,
      fontWeight: t.bold ? 700 : 400, fontStyle: t.italic ? "italic" : "normal",
      textDecoration: t.underline ? "underline" : "none",
      textAlign: t.align ?? "left",
      letterSpacing: t.letterSpacing ? `${t.letterSpacing}px` : undefined,
      lineHeight: t.lineSpacing ?? undefined,
      opacity: t.opacity ?? 1,
      WebkitTextStroke: t.strokeWidth ? `${t.strokeWidth}px ${t.strokeColor ?? "#000000"}` : undefined,
      textShadow: (t.shadowBlur || t.shadowOffsetX || t.shadowOffsetY)
        ? `${t.shadowOffsetX ?? 0}px ${t.shadowOffsetY ?? 0}px ${Math.max(0, t.shadowBlur ?? 0)}px ${t.shadowColor ?? "#000000"}`
        : undefined,
      padding: `${t.bgPadding ?? 2}px ${(t.bgPadding ?? 2) + 4}px`,
      borderRadius: t.bgBorderRadius ?? 3,
      border: t.bgBorderWidth ? `${t.bgBorderWidth}px solid ${t.bgBorderColor ?? "#000000"}` : undefined,
      backdropFilter: t.bgBlur ? "blur(6px)" : undefined,
      WebkitBackdropFilter: t.bgBlur ? "blur(6px)" : undefined,
      // "Banner" shape (Requirement: pill / rectangle / banner): the background spans the full
      // canvas width regardless of the text's own (narrower) width — left/right pulled back to
      // the canvas edges via negative margins matched to the box's own left offset.
      ...(t.bgFullWidth ? { marginLeft: `-${t.x}%`, marginRight: `-${100 - t.x - t.width}%`, textAlign: t.align ?? "center" } : {}),
    };
    if (gradientActive) {
      return {
        ...base,
        color: "transparent",
        backgroundImage: `linear-gradient(90deg, ${t.gradientFrom}, ${t.gradientTo})`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      };
    }
    return {
      ...base,
      color: t.color,
      background: composeTextBgColor(t.bgColor, t.bgOpacity ?? 1),
    };
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
    : selectedAdditionalClip
    ? { kind: "B-roll", name: selectedAdditionalClip.name || "V2 Insert" }
    : selectedText
    ? { kind: "Text", name: selectedText.text.slice(0, 24) || "Headline" }
    : selectedOverlay
    ? { kind: "Overlay", name: overlayLabel(selectedOverlay) }
    : selectedLowerThird
    ? { kind: "Lower Third", name: selectedLowerThird.name || "Lower Third" }
    : selectedShape
    ? { kind: "Shape", name: SHAPE_KIND_LABELS[selectedShape.kind] }
    : selectedSubtitle
    ? { kind: "Subtitle", name: selectedSubtitle.text.slice(0, 24) || "Subtitle" }
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
    const widthPct = (s.elW / s.boxW) * 100;
    const maxX = Math.max(0, 100 - widthPct);
    const maxY = Math.max(0, 100 - (s.elH / s.boxH) * 100);
    const rawX = Math.min(maxX, Math.max(0, s.origX + dxPct));
    const rawY = Math.min(maxY, Math.max(0, s.origY + dyPct));
    // Phase 6: Text has no stored height, so its Y axis snaps as a bare line (size=0 — see
    // buildSnapTargets' own comment on that degrade-gracefully case).
    const nextX = snapAxis(rawX, widthPct, guideXs);
    const nextY = snapAxis(rawY, 0, guideYs);
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
    const widthPct = (s.elW / s.boxW) * 100;
    const heightPct = (s.elH / s.boxH) * 100;
    const maxX = Math.max(0, 100 - widthPct);
    const maxY = Math.max(0, 100 - heightPct);
    const rawX = Math.min(maxX, Math.max(0, s.origX + dxPct));
    const rawY = Math.min(maxY, Math.max(0, s.origY + dyPct));
    const nextX = snapAxis(rawX, widthPct, guideXs);
    const nextY = snapAxis(rawY, heightPct, guideYs);
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

  // ==== Phase 2 (Video Studio V2 — Lower Thirds) — canvas move/resize ====
  // Identical percentage-delta-and-clamp drag/resize to MediaOverlay's own beginOverlayDrag/
  // beginOverlayResize above, writing into LowerThird's new x/y/width/height instead — same
  // "canvas position and size must persist" guarantee, since these write through
  // updateLowerThird/rawUpdateLowerThird, the same StudioContext-backed array Save Draft and
  // buildProjectSnapshot already read.
  const handleLowerThirdDragMove = (e: MouseEvent) => {
    const s = dragLowerThirdSessionRef.current;
    if (!s) return;
    if (!lowerThirdDragMovedRef.current) { pushHistory(); lowerThirdDragMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const dyPct = ((e.clientY - s.startClientY) / s.boxH) * 100;
    const widthPct = (s.elW / s.boxW) * 100;
    const heightPct = (s.elH / s.boxH) * 100;
    const maxX = Math.max(0, 100 - widthPct);
    const maxY = Math.max(0, 100 - heightPct);
    const rawX = Math.min(maxX, Math.max(0, s.origX + dxPct));
    const rawY = Math.min(maxY, Math.max(0, s.origY + dyPct));
    const nextX = snapAxis(rawX, widthPct, guideXs);
    const nextY = snapAxis(rawY, heightPct, guideYs);
    rawUpdateLowerThird(s.id, { x: nextX, y: nextY });
  };
  const handleLowerThirdDragEnd = () => {
    dragLowerThirdSessionRef.current = null;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleLowerThirdDragMove);
    window.removeEventListener("mouseup", handleLowerThirdDragEnd);
  };
  const beginLowerThirdDrag = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedElement({ type: "lowerThird", id });
    const boxEl = videoPreviewBoxRef.current;
    const el = e.currentTarget as HTMLElement;
    const lt = lowerThirds.find(l => l.id === id);
    if (!boxEl || !lt) return;
    lowerThirdDragMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    dragLowerThirdSessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, elW: elRect.width, elH: elRect.height,
      startClientX: e.clientX, startClientY: e.clientY,
      origX: lt.x ?? DEFAULT_LOWER_THIRD_BOX.x, origY: lt.y ?? DEFAULT_LOWER_THIRD_BOX.y,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleLowerThirdDragMove);
    window.addEventListener("mouseup", handleLowerThirdDragEnd);
  };
  const handleLowerThirdResizeMove = (e: MouseEvent) => {
    const s = resizeLowerThirdSessionRef.current;
    if (!s) return;
    if (!lowerThirdResizeMovedRef.current) { pushHistory(); lowerThirdResizeMovedRef.current = true; }
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
    rawUpdateLowerThird(s.id, {
      x: nextX, y: nextY,
      width: Math.max(MIN_ELEMENT_SIZE_PCT, nextWidth), height: Math.max(MIN_ELEMENT_SIZE_PCT, nextHeight),
    });
  };
  const handleLowerThirdResizeEnd = () => {
    resizeLowerThirdSessionRef.current = null;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleLowerThirdResizeMove);
    window.removeEventListener("mouseup", handleLowerThirdResizeEnd);
  };
  const beginLowerThirdResize = (id: string, corner: ResizeCorner) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const boxEl = videoPreviewBoxRef.current;
    const lt = lowerThirds.find(l => l.id === id);
    if (!boxEl || !lt) return;
    lowerThirdResizeMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    resizeLowerThirdSessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, startClientX: e.clientX, startClientY: e.clientY, corner,
      origX: lt.x ?? DEFAULT_LOWER_THIRD_BOX.x, origY: lt.y ?? DEFAULT_LOWER_THIRD_BOX.y,
      origWidth: lt.width ?? DEFAULT_LOWER_THIRD_BOX.width, origHeight: lt.height ?? DEFAULT_LOWER_THIRD_BOX.height,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleLowerThirdResizeMove);
    window.addEventListener("mouseup", handleLowerThirdResizeEnd);
  };
  // "+ Add Lower Third" (mirrors handleAddText's own creation pattern — no upload, an authored
  // element created directly at the current playhead with sensible defaults, immediately
  // selected so Properties is where the user refines it).
  const handleAddLowerThird = () => {
    const lt: LowerThird = {
      id: crypto.randomUUID(), name: "New Lower Third", title: "",
      animation: "slide_left", duration: 5, positionY: DEFAULT_LOWER_THIRD_BOX.y, showLogo: false,
      startTime: timeline.currentTime,
      endTime: Math.min(timeline.currentTime + 5, effectiveDuration || timeline.currentTime + 5),
      ...DEFAULT_LOWER_THIRD_BOX,
    };
    addLowerThird(lt);
    setSelectedElement({ type: "lowerThird", id: lt.id });
  };

  // Phase 4 (Video Studio V2 — Independent Shapes): "the user can place a shape BEHIND text" —
  // a new shape's default `order` is one less than the current back-most layer across the whole
  // shared stack (Text/Overlay/LowerThird/Shape), so it starts out-of-the-box behind everything
  // already on canvas, directly serving that use case — still freely reorderable afterward via
  // the Layers tab, same as any other layer.
  const handleAddShape = (kind: Shape["kind"]) => {
    const allOrders = [...textOverlays, ...mediaOverlays, ...lowerThirds, ...shapes].map(l => l.order ?? 0);
    const backOrder = allOrders.length ? Math.min(...allOrders) - 1 : 0;
    const box = defaultShapeBox(kind);
    const shape: Shape = {
      id: crypto.randomUUID(), kind, ...box,
      startTime: timeline.currentTime,
      endTime: Math.min(timeline.currentTime + 5, effectiveDuration || timeline.currentTime + 5),
      order: backOrder,
    };
    addShape(shape);
    setSelectedElement({ type: "shape", id: shape.id });
  };

  // ==== Phase 4 (Video Studio V2 — Independent Shapes) — canvas move/resize ====
  const handleShapeDragMove = (e: MouseEvent) => {
    const s = dragShapeSessionRef.current;
    if (!s) return;
    if (!shapeDragMovedRef.current) { pushHistory(); shapeDragMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const dyPct = ((e.clientY - s.startClientY) / s.boxH) * 100;
    const widthPct = (s.elW / s.boxW) * 100;
    const heightPct = (s.elH / s.boxH) * 100;
    const maxX = Math.max(0, 100 - widthPct);
    const maxY = Math.max(0, 100 - heightPct);
    const rawX = Math.min(maxX, Math.max(0, s.origX + dxPct));
    const rawY = Math.min(maxY, Math.max(0, s.origY + dyPct));
    const nextX = snapAxis(rawX, widthPct, guideXs);
    const nextY = snapAxis(rawY, heightPct, guideYs);
    rawUpdateShape(s.id, { x: nextX, y: nextY });
  };
  const handleShapeDragEnd = () => {
    dragShapeSessionRef.current = null;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleShapeDragMove);
    window.removeEventListener("mouseup", handleShapeDragEnd);
  };
  const beginShapeDrag = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedElement({ type: "shape", id });
    const boxEl = videoPreviewBoxRef.current;
    const el = e.currentTarget as HTMLElement;
    const shape = shapes.find(s => s.id === id);
    if (!boxEl || !shape) return;
    shapeDragMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    dragShapeSessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, elW: elRect.width, elH: elRect.height,
      startClientX: e.clientX, startClientY: e.clientY, origX: shape.x, origY: shape.y,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleShapeDragMove);
    window.addEventListener("mouseup", handleShapeDragEnd);
  };
  const handleShapeResizeMove = (e: MouseEvent) => {
    const s = resizeShapeSessionRef.current;
    if (!s) return;
    if (!shapeResizeMovedRef.current) { pushHistory(); shapeResizeMovedRef.current = true; }
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
    rawUpdateShape(s.id, {
      x: nextX, y: nextY,
      width: Math.max(MIN_ELEMENT_SIZE_PCT, nextWidth), height: Math.max(MIN_ELEMENT_SIZE_PCT, nextHeight),
    });
  };
  const handleShapeResizeEnd = () => {
    resizeShapeSessionRef.current = null;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleShapeResizeMove);
    window.removeEventListener("mouseup", handleShapeResizeEnd);
  };
  const beginShapeResize = (id: string, corner: ResizeCorner) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const boxEl = videoPreviewBoxRef.current;
    const shape = shapes.find(s => s.id === id);
    if (!boxEl || !shape) return;
    shapeResizeMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    resizeShapeSessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, startClientX: e.clientX, startClientY: e.clientY, corner,
      origX: shape.x, origY: shape.y, origWidth: shape.width, origHeight: shape.height,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleShapeResizeMove);
    window.addEventListener("mouseup", handleShapeResizeEnd);
  };

  // ==== Phase 5 (Video Studio V2 — Subtitles / Transcript) — canvas move/resize ====
  const handleSubtitleDragMove = (e: MouseEvent) => {
    const s = dragSubtitleSessionRef.current;
    if (!s) return;
    if (!subtitleDragMovedRef.current) { pushHistory(); subtitleDragMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const dyPct = ((e.clientY - s.startClientY) / s.boxH) * 100;
    const widthPct = (s.elW / s.boxW) * 100;
    const maxX = Math.max(0, 100 - widthPct);
    const maxY = Math.max(0, 100 - (s.elH / s.boxH) * 100);
    const rawX = Math.min(maxX, Math.max(0, s.origX + dxPct));
    const rawY = Math.min(maxY, Math.max(0, s.origY + dyPct));
    // Phase 6: Subtitle has no stored height either (see Text's own handler) — bare line-snap.
    const nextX = snapAxis(rawX, widthPct, guideXs);
    const nextY = snapAxis(rawY, 0, guideYs);
    rawUpdateSubtitle(s.id, { x: nextX, y: nextY });
  };
  const handleSubtitleDragEnd = () => {
    dragSubtitleSessionRef.current = null;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleSubtitleDragMove);
    window.removeEventListener("mouseup", handleSubtitleDragEnd);
  };
  const beginSubtitleDrag = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedElement({ type: "subtitle", id });
    const boxEl = videoPreviewBoxRef.current;
    const el = e.currentTarget as HTMLElement;
    const sub = subtitles.find(s => s.id === id);
    if (!boxEl || !sub) return;
    subtitleDragMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    dragSubtitleSessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, elW: elRect.width, elH: elRect.height,
      startClientX: e.clientX, startClientY: e.clientY, origX: sub.x, origY: sub.y,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleSubtitleDragMove);
    window.addEventListener("mouseup", handleSubtitleDragEnd);
  };
  // Width-only resize — same convention as Text's own beginTextResize (a subtitle's box height
  // is implicit from its wrapped text content, not a stored field).
  const handleSubtitleResizeMove = (e: MouseEvent) => {
    const s = resizeSubtitleSessionRef.current;
    if (!s) return;
    if (!subtitleResizeMovedRef.current) { pushHistory(); subtitleResizeMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const isLeft = s.corner === "nw" || s.corner === "sw";
    let nextWidth = Math.max(MIN_ELEMENT_SIZE_PCT, isLeft ? s.origWidth - dxPct : s.origWidth + dxPct);
    let nextX = s.origX;
    if (isLeft) {
      nextX = s.origX + (s.origWidth - nextWidth);
      if (nextX < 0) { nextWidth += nextX; nextX = 0; }
    } else if (nextX + nextWidth > 100) {
      nextWidth = 100 - nextX;
    }
    rawUpdateSubtitle(s.id, { x: nextX, width: Math.max(MIN_ELEMENT_SIZE_PCT, nextWidth) });
  };
  const handleSubtitleResizeEnd = () => {
    resizeSubtitleSessionRef.current = null;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleSubtitleResizeMove);
    window.removeEventListener("mouseup", handleSubtitleResizeEnd);
  };
  const beginSubtitleResize = (id: string, corner: ResizeCorner) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const boxEl = videoPreviewBoxRef.current;
    const sub = subtitles.find(s => s.id === id);
    if (!boxEl || !sub) return;
    subtitleResizeMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    resizeSubtitleSessionRef.current = {
      id, boxW: boxRect.width, startClientX: e.clientX, corner,
      origX: sub.x, origWidth: sub.width,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleSubtitleResizeMove);
    window.addEventListener("mouseup", handleSubtitleResizeEnd);
  };

  // Requirement (SUBTITLE DATA MODEL — "global style ... inherited ... per-segment override"):
  // the one place a segment's real, resolved style is computed — canvas render and (later)
  // export should both call this rather than duplicating the merge.
  const resolveSubtitleStyle = (seg: SubtitleSegment): SubtitleStyle => ({ ...subtitleStyle, ...seg.styleOverride });

  const DEFAULT_SUBTITLE_BOX = { x: 10, y: 82, width: 80 };

  // Requirement (AUTOMATIC TRANSCRIPT GENERATION — "wire it into the V2 editor properly"): calls
  // the REAL backend Whisper endpoint (backend/app/routers/transcribe.py, confirmed working by
  // inspection) against the current V1 source video's own asset — the only new backend call this
  // phase makes; everything else (segment creation, canvas/timeline wiring) is real V2
  // architecture, not a mock. One pushHistory covers the whole batch of segments this creates,
  // same "one user action" convention Ripple Delete/layer-reorder already use.
  const [captionGenBusy, setCaptionGenBusy] = useState(false);
  const [captionGenError, setCaptionGenError] = useState<string | null>(null);
  const captionSourceClip = selectedClip ?? activeVideoClip;
  const handleGenerateCaptions = async () => {
    const assetId = captionSourceClip?.assetId;
    if (!assetId) { setCaptionGenError("Select or play a V1 clip with an uploaded source file first."); return; }
    setCaptionGenBusy(true);
    setCaptionGenError(null);
    try {
      const { data } = await transcribeApi.transcribe(assetId);
      const result = data as { segments: { id: number; start: number; end: number; text: string }[] };
      const clipStart = captionSourceClip.startTime;
      if (!result.segments?.length) { setCaptionGenError("No speech detected in this clip."); return; }
      pushHistory();
      result.segments.forEach((seg, i) => {
        // Whisper's own segment times are relative to the SOURCE FILE; anchoring at the clip's
        // own timeline startTime keeps captions aligned with where this clip actually plays —
        // exactly the same startTime-relative offset convention every other source-anchored
        // element in this file (video/audio playback offset) already uses.
        rawAddSubtitle({
          id: crypto.randomUUID(), text: seg.text.trim(),
          startTime: clipStart + seg.start, endTime: clipStart + seg.end,
          ...DEFAULT_SUBTITLE_BOX, order: -(i + 1),
        });
      });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setCaptionGenError(typeof detail === "string" ? detail : "Could not generate captions — please try again.");
    } finally {
      setCaptionGenBusy(false);
    }
  };

  // Requirement (PASTE TRANSCRIPT — Options A & B): real parsing logic, extracted as pure,
  // independently-tested functions in videoPreviewUtils.ts (parseSrtTranscript /
  // autoSegmentPlainTranscript) — see their own comments there for exactly which spec
  // requirement each covers.
  const [pasteTranscriptText, setPasteTranscriptText] = useState("");
  const handlePasteTranscript = () => {
    const raw = pasteTranscriptText.trim();
    if (!raw) return;
    const srtSegments = parseSrtTranscript(raw);
    const segments = srtSegments.length > 0 ? srtSegments : autoSegmentPlainTranscript(raw, timeline.currentTime);
    if (!segments.length) return;
    pushHistory();
    segments.forEach((seg, i) => {
      rawAddSubtitle({ id: crypto.randomUUID(), text: seg.text, startTime: seg.start, endTime: seg.end, ...DEFAULT_SUBTITLE_BOX, order: -(i + 1) });
    });
    setPasteTranscriptText("");
  };

  // Requirement (EDIT TRANSCRIPT/SUBTITLES — "merge segments"): this editor has no multi-select,
  // so "merge" is the well-defined single-selection equivalent — combine the selected segment
  // with whichever OTHER segment starts soonest at/after its own end (its natural neighbour in
  // playback order), concatenating text and spanning both segments' time range. "Split segments"
  // reuses the existing generic split-at-playhead mechanism every other lane already has (see
  // handleSplitAtPlayhead's own subtitle branch) rather than a second implementation.
  const handleMergeSubtitleWithNext = (seg: SubtitleSegment) => {
    const next = subtitles
      .filter(s => s.id !== seg.id && s.startTime >= seg.endTime - 1e-6)
      .sort((a, b) => a.startTime - b.startTime)[0];
    if (!next) return;
    pushHistory();
    rawUpdateSubtitle(seg.id, { text: `${seg.text} ${next.text}`.trim(), endTime: next.endTime });
    rawRemoveSubtitle(next.id);
  };

  // ==== Phase 1 (V2 Inserts/B-roll) — canvas move/resize/crop/fit ====
  // Requirement 5 ("move anywhere on canvas", "resize"): identical percentage-delta-and-clamp
  // drag/resize as MediaOverlay's own beginOverlayDrag/beginOverlayResize above, writing into
  // VideoClip's new insertX/Y/Width/Height instead of MediaOverlay's x/y/width/height. Requirement
  // 6 ("canvas position and size must persist"): these write through updateAdditionalVideoClip/
  // rawUpdateAdditionalVideoClip — the same StudioContext-backed array Save Draft/export-prep
  // already read (see buildProjectSnapshot above) — never a separate canvas-only position store.
  const handleInsertDragMove = (e: MouseEvent) => {
    const s = dragInsertSessionRef.current;
    if (!s) return;
    if (!insertDragMovedRef.current) { pushHistory(); insertDragMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const dyPct = ((e.clientY - s.startClientY) / s.boxH) * 100;
    const widthPct = (s.elW / s.boxW) * 100;
    const heightPct = (s.elH / s.boxH) * 100;
    const maxX = Math.max(0, 100 - widthPct);
    const maxY = Math.max(0, 100 - heightPct);
    const rawX = Math.min(maxX, Math.max(0, s.origX + dxPct));
    const rawY = Math.min(maxY, Math.max(0, s.origY + dyPct));
    const nextX = snapAxis(rawX, widthPct, guideXs);
    const nextY = snapAxis(rawY, heightPct, guideYs);
    rawUpdateAdditionalVideoClip(s.id, { insertX: nextX, insertY: nextY });
  };
  const handleInsertDragEnd = () => {
    dragInsertSessionRef.current = null;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleInsertDragMove);
    window.removeEventListener("mouseup", handleInsertDragEnd);
  };
  const beginInsertDrag = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedElement({ type: "clip", lane: "additional", id });
    const boxEl = videoPreviewBoxRef.current;
    const el = e.currentTarget as HTMLElement;
    const clip = additionalVideoClips.find(c => c.id === id);
    if (!boxEl || !clip) return;
    insertDragMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    dragInsertSessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, elW: elRect.width, elH: elRect.height,
      startClientX: e.clientX, startClientY: e.clientY,
      origX: clip.insertX ?? DEFAULT_INSERT_BOX.insertX, origY: clip.insertY ?? DEFAULT_INSERT_BOX.insertY,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleInsertDragMove);
    window.addEventListener("mouseup", handleInsertDragEnd);
  };
  const handleInsertResizeMove = (e: MouseEvent) => {
    const s = resizeInsertSessionRef.current;
    if (!s) return;
    if (!insertResizeMovedRef.current) { pushHistory(); insertResizeMovedRef.current = true; }
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
    rawUpdateAdditionalVideoClip(s.id, {
      insertX: nextX, insertY: nextY,
      insertWidth: Math.max(MIN_ELEMENT_SIZE_PCT, nextWidth), insertHeight: Math.max(MIN_ELEMENT_SIZE_PCT, nextHeight),
    });
  };
  const handleInsertResizeEnd = () => {
    resizeInsertSessionRef.current = null;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleInsertResizeMove);
    window.removeEventListener("mouseup", handleInsertResizeEnd);
  };
  const beginInsertResize = (id: string, corner: ResizeCorner) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const boxEl = videoPreviewBoxRef.current;
    const clip = additionalVideoClips.find(c => c.id === id);
    if (!boxEl || !clip) return;
    insertResizeMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    resizeInsertSessionRef.current = {
      id, boxW: boxRect.width, boxH: boxRect.height, startClientX: e.clientX, startClientY: e.clientY, corner,
      origX: clip.insertX ?? DEFAULT_INSERT_BOX.insertX, origY: clip.insertY ?? DEFAULT_INSERT_BOX.insertY,
      origWidth: clip.insertWidth ?? DEFAULT_INSERT_BOX.insertWidth, origHeight: clip.insertHeight ?? DEFAULT_INSERT_BOX.insertHeight,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleInsertResizeMove);
    window.addEventListener("mouseup", handleInsertResizeEnd);
  };
  // Requirement 5 ("crop", "fit/fill"): identical to V1's own applyClipFitMode/enterCropReposition/
  // beginCropDrag/handleCropDragMove above, over an additionalVideoClips entry — same
  // cropOffsetX/Y fields VideoClip already has, just scoped to V2's own (smaller, positioned)
  // box instead of the full canvas frame at render time (see the insert layer's own JSX below).
  const applyInsertFitMode = (clip: VideoClip, mode: "fit" | "fill") => {
    updateAdditionalVideoClip(clip.id, mode === "fit"
      ? { fitMode: "fit" }
      : { fitMode: "fill", cropOffsetX: clip.cropOffsetX ?? 50, cropOffsetY: clip.cropOffsetY ?? 50 });
    setInsertRepositionId(null);
  };
  const enterInsertCropReposition = (clip: VideoClip) => {
    if (clip.fitMode !== "fill") {
      updateAdditionalVideoClip(clip.id, { fitMode: "fill", cropOffsetX: clip.cropOffsetX ?? 50, cropOffsetY: clip.cropOffsetY ?? 50 });
    }
    setInsertRepositionId(clip.id);
  };
  const handleInsertCropDragMove = (e: MouseEvent) => {
    const s = insertCropDragSessionRef.current;
    if (!s) return;
    if (!insertCropDragMovedRef.current) { pushHistory(); insertCropDragMovedRef.current = true; }
    const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;
    const dyPct = ((e.clientY - s.startClientY) / s.boxH) * 100;
    const nextOffsetX = Math.min(100, Math.max(0, s.origOffsetX - dxPct));
    const nextOffsetY = Math.min(100, Math.max(0, s.origOffsetY - dyPct));
    rawUpdateAdditionalVideoClip(s.id, { cropOffsetX: nextOffsetX, cropOffsetY: nextOffsetY });
  };
  const handleInsertCropDragEnd = () => {
    insertCropDragSessionRef.current = null;
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleInsertCropDragMove);
    window.removeEventListener("mouseup", handleInsertCropDragEnd);
  };
  const beginInsertCropDrag = (clip: VideoClip) => (e: React.MouseEvent) => {
    if (insertRepositionId !== clip.id) return;
    e.stopPropagation();
    e.preventDefault();
    const boxEl = videoPreviewBoxRef.current;
    if (!boxEl) return;
    insertCropDragMovedRef.current = false;
    const boxRect = boxEl.getBoundingClientRect();
    insertCropDragSessionRef.current = {
      id: clip.id, boxW: boxRect.width, boxH: boxRect.height,
      startClientX: e.clientX, startClientY: e.clientY,
      origOffsetX: clip.cropOffsetX ?? 50, origOffsetY: clip.cropOffsetY ?? 50,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleInsertCropDragMove);
    window.addEventListener("mouseup", handleInsertCropDragEnd);
  };
  // Requirement 9 (B-roll audio): 'keep' mirrors the clip's audio onto a real, independent
  // AudioTrack via the exact same architecture V1's own embedded-audio separation already uses
  // (addAudioTrack) — never a bespoke "V2 audio" concept. Switching away from 'keep' removes
  // that same track. brollAudioTrackId makes this idempotent: clicking "Keep" repeatedly (or
  // after a refresh where it's already kept) never stacks duplicate tracks.
  const applyBrollAudioChoice = (clip: VideoClip, mode: NonNullable<VideoClip["brollAudio"]>) => {
    if (mode === "keep") {
      if (clip.brollAudioTrackId && audioTracks.some(a => a.id === clip.brollAudioTrackId)) {
        updateAdditionalVideoClip(clip.id, { brollAudio: "keep" });
        return;
      }
      pushHistory();
      const track: AudioTrack = {
        id: crypto.randomUUID(), assetId: clip.assetId, url: clip.url,
        name: `${clip.name || "B-roll"} (Audio)`,
        volume: 1, startTime: clip.startTime, endTime: clip.endTime,
        trimIn: clip.trimIn, trimOut: clip.trimOut, fadeIn: 0, fadeOut: 0, duck: false,
      };
      rawAddAudioTrack(track);
      rawUpdateAdditionalVideoClip(clip.id, { brollAudio: "keep", brollAudioTrackId: track.id });
    } else {
      if (clip.brollAudioTrackId && audioTracks.some(a => a.id === clip.brollAudioTrackId)) {
        pushHistory();
        rawRemoveAudioTrack(clip.brollAudioTrackId);
        rawUpdateAdditionalVideoClip(clip.id, { brollAudio: mode, brollAudioTrackId: undefined });
      } else {
        updateAdditionalVideoClip(clip.id, { brollAudio: mode, brollAudioTrackId: undefined });
      }
    }
  };

  // Layers reorder: the Layers-tab list, unlike the canvas stack above, always lists every
  // Text/Overlay regardless of whether the playhead is currently inside its range — same
  // "list everything" convention the existing Layers tab already used before this change.
  // Sorted descending (highest `order` first) so top-of-list reads as "front-most", matching
  // the same visual-editor convention (Photoshop/Figma-style layer panels) the canvas's own
  // ascending paint-order sort is the mirror image of.
  // Phase 2: "lowerThird" joins the same shared paint-order space text/overlay already use —
  // interleaves freely with either, matching the spec's own layering example ("...overlay image
  // -> lower third -> text -> logo/watermark").
  // Phase 4: "shape" joins the same shared paint-order space too — satisfies "place a shape
  // behind text" as a normal drag in this exact list (its default order, set at creation, only
  // decides where it STARTS; this reorder mechanism is what lets it move afterward).
  // Phase 5: "subtitle" joins the same shared paint-order space too — its z-order is this exact
  // reorder, satisfying the spec's own "layer/zIndex" field on the subtitle data model.
  type VisualLayerRef = { type: "text" | "overlay" | "lowerThird" | "shape" | "subtitle"; id: string; order: number; label: string };
  const layersListVisual: VisualLayerRef[] = [
    ...textOverlays.map(t => ({ type: "text" as const, id: t.id, order: t.order ?? 0, label: `🔤 ${t.text.slice(0, 20)}` })),
    ...mediaOverlays.map(o => ({ type: "overlay" as const, id: o.id, order: o.order ?? 0, label: `🖼 ${overlayLabel(o)}` })),
    ...lowerThirds.map(l => ({ type: "lowerThird" as const, id: l.id, order: l.order ?? 0, label: `▭ ${l.name || "Lower Third"}` })),
    ...shapes.map(sh => ({ type: "shape" as const, id: sh.id, order: sh.order ?? 0, label: `◆ ${SHAPE_KIND_LABELS[sh.kind]}` })),
    ...subtitles.map(s => ({ type: "subtitle" as const, id: s.id, order: s.order ?? 0, label: `💬 ${s.text.slice(0, 20)}` })),
  ].sort((a, b) => b.order - a.order);

  const dragLayerRef = useRef<{ type: "text" | "overlay" | "lowerThird" | "shape" | "subtitle"; id: string } | null>(null);
  // Dropping onto a row reassigns every visual layer's `order` in one pass — simplest way to
  // guarantee no two elements ever collide on the same order value after a reorder, and it
  // never touches anything else on either object (timing, position, size, media, filters, etc
  // are all separate fields, untouched here).
  const reorderVisualLayers = (dragged: { type: "text" | "overlay" | "lowerThird" | "shape" | "subtitle"; id: string }, targetIndex: number) => {
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
      else if (l.type === "overlay") rawUpdateMediaOverlay(l.id, { order });
      else if (l.type === "lowerThird") rawUpdateLowerThird(l.id, { order });
      else if (l.type === "shape") rawUpdateShape(l.id, { order });
      else rawUpdateSubtitle(l.id, { order });
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
      style={getTextRenderStyle(t)}
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

  // Phase 2 (Video Studio V2 — Lower Thirds): real LowerThird items on canvas — same
  // "gated to its own startTime/endTime, draggable/resizable via x/y/width/height" pattern as
  // Overlay/Text above. Content is edited via Properties (name/title fields), not inline on
  // canvas, same simpler convention Overlay itself uses (Text alone has the richer
  // double-click-to-edit-in-place system). `endTime`/x/y/width/height are always set by
  // handleAddLowerThird for anything created in Video Studio V2 — the `?? DEFAULT_LOWER_THIRD_BOX`
  // fallback exists only for type-safety against legacy /studio's older LowerThird shape (which
  // predates these fields and has no endTime at all — such an item simply never satisfies the
  // startTime/endTime filter below, so it's excluded from V2's canvas rather than rendered with
  // guessed timing).
  const lowerThirdEntries = lowerThirds
    .filter(l => l.endTime !== undefined && timeline.currentTime >= l.startTime && timeline.currentTime < l.endTime)
    .map(l => ({
      order: l.order ?? 0,
      node: (
    <div
      key={l.id}
      className={`canvas-lowerthird-item canvas-selectable canvas-movable ${selectedElement?.type === "lowerThird" && selectedElement.id === l.id ? "canvas-el-selected" : ""}`}
      style={{
        left: `${l.x ?? DEFAULT_LOWER_THIRD_BOX.x}%`, top: `${l.y ?? DEFAULT_LOWER_THIRD_BOX.y}%`,
        width: `${l.width ?? DEFAULT_LOWER_THIRD_BOX.width}%`, height: `${l.height ?? DEFAULT_LOWER_THIRD_BOX.height}%`,
      }}
      onMouseDown={beginLowerThirdDrag(l.id)}
      onClick={e => e.stopPropagation()}
      title="Lower Third — click and drag to move"
    >
      <span className="lowerthird-bar" />
      <span className="lowerthird-text">
        <b>{l.name || "Name"}</b>
        {l.title && <small>{l.title}</small>}
      </span>
      {selectedElement?.type === "lowerThird" && selectedElement.id === l.id && resizeHandles(corner => beginLowerThirdResize(l.id, corner))}
    </div>
      ),
    }));

  // Phase 4 (Video Studio V2 — Independent Shapes): real Shape items on canvas — same
  // gated-to-startTime/endTime, draggable/resizable pattern as every other real visual layer.
  // 'circle' overrides borderRadius with a hard 50%; 'banner'/fullWidth extends the box to the
  // full canvas width via negative margins, same technique TextOverlay.bgFullWidth uses.
  const shapeEntries = shapes
    .filter(sh => timeline.currentTime >= sh.startTime && timeline.currentTime < sh.endTime)
    .map(sh => {
      return {
        order: sh.order ?? 0,
        node: (
    <div
      key={sh.id}
      className={`canvas-shape-item canvas-selectable canvas-movable ${selectedElement?.type === "shape" && selectedElement.id === sh.id ? "canvas-el-selected" : ""}`}
      style={{
        left: `${sh.x}%`, top: `${sh.y}%`, width: `${sh.width}%`, height: `${sh.height}%`,
        background: composeHexAlpha(sh.fillColor, sh.opacity),
        borderRadius: sh.kind === "circle" ? "50%" : sh.borderRadius ?? 0,
        border: sh.borderWidth ? `${sh.borderWidth}px solid ${sh.borderColor ?? "#000000"}` : undefined,
        ...(sh.fullWidth ? { marginLeft: `-${sh.x}%`, marginRight: `-${100 - sh.x - sh.width}%` } : {}),
      }}
      onMouseDown={beginShapeDrag(sh.id)}
      onClick={e => e.stopPropagation()}
      title={`${SHAPE_KIND_LABELS[sh.kind]} — click and drag to move`}
    >
      {selectedElement?.type === "shape" && selectedElement.id === sh.id && resizeHandles(corner => beginShapeResize(sh.id, corner))}
    </div>
        ),
      };
    });

  // Phase 5 (Video Studio V2 — Subtitles / Transcript) — Requirement (SUBTITLES AS REAL CANVAS
  // ELEMENTS): real, positioned, resolveSubtitleStyle-styled boxes, same gated-to-startTime/
  // endTime pattern as every other real visual layer — never fixed to one position.
  const subtitleEntries = subtitles
    .filter(s => timeline.currentTime >= s.startTime && timeline.currentTime < s.endTime)
    .map(s => {
      const style = resolveSubtitleStyle(s);
      return {
        order: s.order ?? 0,
        node: (
    <div
      key={s.id}
      className={`canvas-subtitle-item canvas-selectable canvas-movable ${selectedElement?.type === "subtitle" && selectedElement.id === s.id ? "canvas-el-selected" : ""}`}
      style={{
        left: `${s.x}%`, top: `${s.y}%`, width: `${s.width}%`,
        color: style.color, fontFamily: style.fontFamily, fontSize: style.fontSize, textAlign: style.align,
        background: composeTextBgColor(style.bgColor, style.bgOpacity),
        WebkitTextStroke: style.outlineWidth ? `${style.outlineWidth}px ${style.outlineColor ?? "#000000"}` : undefined,
        textShadow: style.shadowBlur ? `0px 0px ${style.shadowBlur}px ${style.shadowColor ?? "#000000"}` : undefined,
      }}
      onMouseDown={beginSubtitleDrag(s.id)}
      onClick={e => e.stopPropagation()}
      title="Subtitle — click and drag to move"
    >
      {s.text}
      {selectedElement?.type === "subtitle" && selectedElement.id === s.id && resizeHandles(corner => beginSubtitleResize(s.id, corner))}
    </div>
        ),
      };
    });

  // Ascending sort: lowest `order` paints first (furthest back), highest paints last (furthest
  // front) — plain DOM paint order, no z-index needed. Ties (both default to 0, e.g. before any
  // reorder has ever happened) keep Array.sort's stable ordering, which preserves the exact
  // pre-existing "all Overlays behind all Text" look until the user actually reorders something.
  const visualLayers = [...overlayEntries, ...textEntries, ...lowerThirdEntries, ...shapeEntries, ...subtitleEntries]
    .sort((a, b) => a.order - b.order)
    .map(e => e.node);

  // Phase 6 (Video Studio V2 — Safe Areas / Guides / Snapping) — the visual guide overlay
  // itself: pure display, pointer-events:none throughout so it can never intercept a click or
  // drag meant for a real canvas element beneath it, rendered as the topmost layer (above
  // visualLayers) so a guide is never hidden behind whatever it's helping to align. Draws
  // exactly the same lines guideXs/guideYs already compute for snapping — what's drawn and
  // what's snapped-to can never drift apart, since both read the same two arrays.
  const guideOverlay = (guideXs.length > 0 || guideYs.length > 0 || (guidesEnabled.platformSafeZone && isVerticalFormat)) && (
    <div className="canvas-guides" aria-hidden="true">
      {guideXs.map((g, i) => <div key={`x${i}`} className="canvas-guide-line vertical" style={{ left: `${g}%` }} />)}
      {guideYs.map((g, i) => <div key={`y${i}`} className="canvas-guide-line horizontal" style={{ top: `${g}%` }} />)}
      {guidesEnabled.platformSafeZone && isVerticalFormat && (
        <>
          <div className="canvas-guide-band bottom" style={{ height: `${PLATFORM_SAFE_BOTTOM_PCT}%` }} title="Platform UI zone (approx.)" />
          <div className="canvas-guide-band right" style={{ width: `${PLATFORM_SAFE_RIGHT_PCT}%` }} title="Platform UI zone (approx.)" />
        </>
      )}
    </div>
  );

  // Phase 1 (V2 Inserts/B-roll) — Requirement 4 ("V2 must be a REAL second video layer... The
  // preview/canvas must render V1 + V2 + other visual layers... Do not simulate V2 using an
  // image"): a genuine second <video> element (insertVideoRef, synced by its own effects above),
  // positioned/sized by the clip's own insertX/Y/Width/Height, rendered as its own layer between
  // V1 (the fixed base) and the O1/T1 stack above — matching the layering the specs' own example
  // gives ("Main video -> B-roll/insert -> overlay -> text"). Rendered in BOTH preview branches
  // (hasRealSrc true/false) exactly like visualLayers already is, right before it, so V2 shows
  // even on a frame where V1 has no active clip (e.g. V1 trimmed shorter than a V2 insert).
  // Always muted at the DOM level — its own embedded audio never plays directly; audibility only
  // ever comes through a real, independent AudioTrack when brollAudio is 'keep' (Requirement 9).
  const insertLayer = activeAdditionalClip ? (
    <div
      key={activeAdditionalClip.id}
      className={`canvas-insert-item canvas-selectable canvas-movable ${selectedElement?.type === "clip" && selectedElement.lane === "additional" && selectedElement.id === activeAdditionalClip.id ? "canvas-el-selected" : ""}`}
      style={{
        left: `${activeAdditionalClip.insertX ?? DEFAULT_INSERT_BOX.insertX}%`,
        top: `${activeAdditionalClip.insertY ?? DEFAULT_INSERT_BOX.insertY}%`,
        width: `${activeAdditionalClip.insertWidth ?? DEFAULT_INSERT_BOX.insertWidth}%`,
        height: `${activeAdditionalClip.insertHeight ?? DEFAULT_INSERT_BOX.insertHeight}%`,
        opacity: (activeAdditionalClip.opacity ?? 100) / 100,
      }}
      onMouseDown={beginInsertDrag(activeAdditionalClip.id)}
      onClick={e => e.stopPropagation()}
      title={`${activeAdditionalClip.name || "B-roll"} — click and drag to move`}
    >
      <video
        ref={insertVideoRef} src={activeAdditionalClip.url} className="canvas-insert-media" playsInline muted
        draggable={false}
        onMouseDown={beginInsertCropDrag(activeAdditionalClip)}
        style={{
          filter: getMediaFilter(activeAdditionalClip),
          ...(activeAdditionalClip.fitMode === "fill"
            ? { objectFit: "cover", objectPosition: `${activeAdditionalClip.cropOffsetX ?? 50}% ${activeAdditionalClip.cropOffsetY ?? 50}%` }
            : {}),
          cursor: insertRepositionId === activeAdditionalClip.id ? "move" : undefined,
        }}
      />
      {insertRepositionId === activeAdditionalClip.id && (
        <div className="crop-reposition-hint" onClick={e => e.stopPropagation()}>
          Drag the video to choose what's cropped
          <button type="button" onClick={() => setInsertRepositionId(null)}>Done</button>
        </div>
      )}
      {selectedElement?.type === "clip" && selectedElement.lane === "additional" && selectedElement.id === activeAdditionalClip.id &&
        resizeHandles(corner => beginInsertResize(activeAdditionalClip.id, corner))}
    </div>
  ) : null;

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
  // Phase 1 (V2 Inserts/B-roll): identical trim math to trimVideoLeft/Right above, over an
  // additionalVideoClips entry instead of a V1 clip — via the pure, independently-tested
  // computeInsertTrimLeft/Right (videoPreviewUtils.ts) rather than a third inline duplicate.
  const trimInsertLeft = (c: VideoClip, proposedStart: number) => {
    rawUpdateAdditionalVideoClip(c.id, computeInsertTrimLeft(c, proposedStart, MIN_CLIP_DURATION));
  };
  const trimInsertRight = (c: VideoClip, proposedEnd: number) => {
    rawUpdateAdditionalVideoClip(c.id, computeInsertTrimRight(c, proposedEnd, MIN_CLIP_DURATION));
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
  // Phase 2: same shape as trimOverlayLeft/Right above — LowerThird has no source media to
  // reveal/hide (like Text), so this is just moving the visible start/end window.
  const trimLowerThirdLeft = (l: LowerThird, proposedStart: number) =>
    rawUpdateLowerThird(l.id, { startTime: Math.max(0, Math.min(proposedStart, (l.endTime ?? proposedStart) - MIN_CLIP_DURATION)) });
  const trimLowerThirdRight = (l: LowerThird, proposedEnd: number) =>
    rawUpdateLowerThird(l.id, { endTime: Math.max(l.startTime + MIN_CLIP_DURATION, proposedEnd) });
  // Phase 4: same shape again, for Shape (no legacy-shape optionality to guard against — Shape
  // is new, endTime is always required).
  const trimShapeLeft = (sh: Shape, proposedStart: number) =>
    rawUpdateShape(sh.id, { startTime: Math.max(0, Math.min(proposedStart, sh.endTime - MIN_CLIP_DURATION)) });
  const trimShapeRight = (sh: Shape, proposedEnd: number) =>
    rawUpdateShape(sh.id, { endTime: Math.max(sh.startTime + MIN_CLIP_DURATION, proposedEnd) });
  // Phase 5: same shape again, for SubtitleSegment (no legacy optionality — always required).
  const trimSubtitleLeft = (s: SubtitleSegment, proposedStart: number) =>
    rawUpdateSubtitle(s.id, { startTime: Math.max(0, Math.min(proposedStart, s.endTime - MIN_CLIP_DURATION)) });
  const trimSubtitleRight = (s: SubtitleSegment, proposedEnd: number) =>
    rawUpdateSubtitle(s.id, { endTime: Math.max(s.startTime + MIN_CLIP_DURATION, proposedEnd) });

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
    } else if (selectedElement.type === "clip" && selectedElement.lane === "additional") {
      // Phase 1: identical split logic to V1's own clip branch above, over additionalVideoClips.
      // A split right half never carries brollAudioTrackId forward — the right half is a NEW,
      // independent clip; if the left half's audio was 'kept', that AudioTrack still only covers
      // the left half's own (now-shorter) window (AudioTrack's own trim is untouched by this),
      // and the right half starts back at its safe 'muted' default rather than silently implying
      // it owns a track it doesn't.
      const c = additionalVideoClips.find(v => v.id === selectedElement.id);
      if (!c || p <= c.startTime + MIN_CLIP_DURATION || p >= c.endTime - MIN_CLIP_DURATION) return;
      pushHistory();
      const rightId = crypto.randomUUID();
      rawUpdateAdditionalVideoClip(c.id, { endTime: p, trimOut: c.trimOut + (c.endTime - p) });
      rawAddAdditionalVideoClip({
        ...c, id: rightId, startTime: p, trimIn: c.trimIn + (p - c.startTime),
        brollAudio: c.brollAudio === "keep" ? "muted" : c.brollAudio, brollAudioTrackId: undefined,
      });
      setSelectedElement({ type: "clip", lane: "additional", id: rightId });
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
    } else if (selectedElement.type === "lowerThird") {
      const l = lowerThirds.find(x => x.id === selectedElement.id);
      if (!l || l.endTime === undefined || p <= l.startTime + MIN_CLIP_DURATION || p >= l.endTime - MIN_CLIP_DURATION) return;
      pushHistory();
      const rightId = crypto.randomUUID();
      rawUpdateLowerThird(l.id, { endTime: p });
      rawAddLowerThird({ ...l, id: rightId, startTime: p });
      setSelectedElement({ type: "lowerThird", id: rightId });
    } else if (selectedElement.type === "shape") {
      const sh = shapes.find(x => x.id === selectedElement.id);
      if (!sh || p <= sh.startTime + MIN_CLIP_DURATION || p >= sh.endTime - MIN_CLIP_DURATION) return;
      pushHistory();
      const rightId = crypto.randomUUID();
      rawUpdateShape(sh.id, { endTime: p });
      rawAddShape({ ...sh, id: rightId, startTime: p });
      setSelectedElement({ type: "shape", id: rightId });
    } else if (selectedElement.type === "subtitle") {
      const s = subtitles.find(x => x.id === selectedElement.id);
      if (!s || p <= s.startTime + MIN_CLIP_DURATION || p >= s.endTime - MIN_CLIP_DURATION) return;
      pushHistory();
      const rightId = crypto.randomUUID();
      rawUpdateSubtitle(s.id, { endTime: p });
      rawAddSubtitle({ ...s, id: rightId, startTime: p });
      setSelectedElement({ type: "subtitle", id: rightId });
    }
  };

  // Normal Delete (§7/§17): removes only the selected element via the existing remove* action —
  // it never touches any other element's startTime/endTime, so the gap it leaves is a natural
  // side effect of simply not closing it, not special-cased "gap" logic of its own.
  const handleDeleteSelected = () => {
    if (!selectedElement) return;
    if (selectedElement.type === "clip" && selectedElement.lane === "video") removeVideoClip(selectedElement.id);
    else if (selectedElement.type === "clip" && selectedElement.lane === "additional") {
      // Phase 1 — Requirement 10: deleting V2 must never touch V1; removeAdditionalVideoClip
      // only ever writes to additionalVideoClips, same array-isolation every other lane already
      // has. Also cleans up a 'kept' B-roll audio track — deleting the video is a delete of
      // everything it owns, same "one user action, one pushHistory" pattern used elsewhere;
      // an audio track the user separately kept independent by trimming/moving/renaming it away
      // from this clip's own window is a normal A1 track by then, out of scope of this delete.
      const c = additionalVideoClips.find(v => v.id === selectedElement.id);
      if (c?.brollAudioTrackId && audioTracks.some(a => a.id === c.brollAudioTrackId)) {
        pushHistory();
        rawRemoveAdditionalVideoClip(selectedElement.id);
        rawRemoveAudioTrack(c.brollAudioTrackId);
      } else {
        removeAdditionalVideoClip(selectedElement.id);
      }
    }
    else if (selectedElement.type === "audio") removeAudioTrack(selectedElement.id);
    else if (selectedElement.type === "text") removeTextOverlay(selectedElement.id);
    else if (selectedElement.type === "overlay") removeMediaOverlay(selectedElement.id);
    else if (selectedElement.type === "lowerThird") removeLowerThird(selectedElement.id);
    else if (selectedElement.type === "shape") removeShape(selectedElement.id);
    else if (selectedElement.type === "subtitle") removeSubtitle(selectedElement.id);
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
    } else if (selectedElement.type === "clip" && selectedElement.lane === "additional") {
      // Phase 1: same ripple-delete shape as V1's own branch above, confined to
      // additionalVideoClips only — other V2 clips shift, V1/A1/T1/O1 are untouched.
      const c = additionalVideoClips.find(v => v.id === selectedElement.id);
      if (!c) return;
      pushHistory();
      const dur = c.endTime - c.startTime;
      rawRemoveAdditionalVideoClip(c.id);
      if (c.brollAudioTrackId && audioTracks.some(a => a.id === c.brollAudioTrackId)) rawRemoveAudioTrack(c.brollAudioTrackId);
      additionalVideoClips.forEach(v => { if (v.id !== c.id && v.startTime >= c.endTime - RIPPLE_EPSILON) rawUpdateAdditionalVideoClip(v.id, { startTime: v.startTime - dur, endTime: v.endTime - dur }); });
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
    } else if (selectedElement.type === "lowerThird") {
      const l = lowerThirds.find(x => x.id === selectedElement.id);
      if (!l || l.endTime === undefined) return;
      const lEndTime = l.endTime;
      pushHistory();
      const dur = lEndTime - l.startTime;
      rawRemoveLowerThird(l.id);
      lowerThirds.forEach(x => { if (x.id !== l.id && x.endTime !== undefined && x.startTime >= lEndTime - RIPPLE_EPSILON) rawUpdateLowerThird(x.id, { startTime: x.startTime - dur, endTime: x.endTime - dur }); });
    } else if (selectedElement.type === "shape") {
      const sh = shapes.find(x => x.id === selectedElement.id);
      if (!sh) return;
      pushHistory();
      const dur = sh.endTime - sh.startTime;
      rawRemoveShape(sh.id);
      shapes.forEach(x => { if (x.id !== sh.id && x.startTime >= sh.endTime - RIPPLE_EPSILON) rawUpdateShape(x.id, { startTime: x.startTime - dur, endTime: x.endTime - dur }); });
    } else if (selectedElement.type === "subtitle") {
      const s = subtitles.find(x => x.id === selectedElement.id);
      if (!s) return;
      pushHistory();
      const dur = s.endTime - s.startTime;
      rawRemoveSubtitle(s.id);
      subtitles.forEach(x => { if (x.id !== s.id && x.startTime >= s.endTime - RIPPLE_EPSILON) rawUpdateSubtitle(x.id, { startTime: x.startTime - dur, endTime: x.endTime - dur }); });
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
    } else if (selectedElement.type === "clip" && selectedElement.lane === "additional") {
      const c = additionalVideoClips.find(v => v.id === selectedElement.id);
      if (!c) return;
      pushHistory(); trimInsertLeft(c, p);
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
    } else if (selectedElement.type === "lowerThird") {
      const l = lowerThirds.find(x => x.id === selectedElement.id);
      if (!l) return;
      pushHistory(); trimLowerThirdLeft(l, p);
    } else if (selectedElement.type === "shape") {
      const sh = shapes.find(x => x.id === selectedElement.id);
      if (!sh) return;
      pushHistory(); trimShapeLeft(sh, p);
    } else if (selectedElement.type === "subtitle") {
      const s = subtitles.find(x => x.id === selectedElement.id);
      if (!s) return;
      pushHistory(); trimSubtitleLeft(s, p);
    }
  };
  const trimSelectedEndToPlayhead = () => {
    if (!selectedElement) return;
    const p = timeline.currentTime;
    if (selectedElement.type === "clip" && selectedElement.lane === "video") {
      const c = videoClips.find(v => v.id === selectedElement.id);
      if (!c) return;
      pushHistory(); trimVideoRight(c, p);
    } else if (selectedElement.type === "clip" && selectedElement.lane === "additional") {
      const c = additionalVideoClips.find(v => v.id === selectedElement.id);
      if (!c) return;
      pushHistory(); trimInsertRight(c, p);
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
    } else if (selectedElement.type === "lowerThird") {
      const l = lowerThirds.find(x => x.id === selectedElement.id);
      if (!l) return;
      pushHistory(); trimLowerThirdRight(l, p);
    } else if (selectedElement.type === "shape") {
      const sh = shapes.find(x => x.id === selectedElement.id);
      if (!sh) return;
      pushHistory(); trimShapeRight(sh, p);
    } else if (selectedElement.type === "subtitle") {
      const s = subtitles.find(x => x.id === selectedElement.id);
      if (!s) return;
      pushHistory(); trimSubtitleRight(s, p);
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
    | { kind: "additional"; data: VideoClip }
    | { kind: "audio"; data: AudioTrack }
    | { kind: "text"; data: TextOverlay }
    | { kind: "overlay"; data: MediaOverlay }
    | { kind: "lowerThird"; data: LowerThird }
    | { kind: "shape"; data: Shape }
    | { kind: "subtitle"; data: SubtitleSegment }
    | null
  >(null);
  const copySelected = () => {
    if (!selectedElement) return;
    if (selectedElement.type === "clip" && selectedElement.lane === "video") {
      const c = videoClips.find(v => v.id === selectedElement.id);
      if (c) clipboardRef.current = { kind: "clip", data: c };
    } else if (selectedElement.type === "clip" && selectedElement.lane === "additional") {
      const c = additionalVideoClips.find(v => v.id === selectedElement.id);
      if (c) clipboardRef.current = { kind: "additional", data: c };
    } else if (selectedElement.type === "audio") {
      const a = audioTracks.find(x => x.id === selectedElement.id);
      if (a) clipboardRef.current = { kind: "audio", data: a };
    } else if (selectedElement.type === "text") {
      const t = textOverlays.find(x => x.id === selectedElement.id);
      if (t) clipboardRef.current = { kind: "text", data: t };
    } else if (selectedElement.type === "overlay") {
      const o = mediaOverlays.find(x => x.id === selectedElement.id);
      if (o) clipboardRef.current = { kind: "overlay", data: o };
    } else if (selectedElement.type === "lowerThird") {
      const l = lowerThirds.find(x => x.id === selectedElement.id);
      if (l) clipboardRef.current = { kind: "lowerThird", data: l };
    } else if (selectedElement.type === "shape") {
      const sh = shapes.find(x => x.id === selectedElement.id);
      if (sh) clipboardRef.current = { kind: "shape", data: sh };
    } else if (selectedElement.type === "subtitle") {
      const s = subtitles.find(x => x.id === selectedElement.id);
      if (s) clipboardRef.current = { kind: "subtitle", data: s };
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
    } else if (cb.kind === "additional") {
      // Phase 1: a pasted copy never inherits the original's 'kept' audio track — two clips
      // can't share ownership of one AudioTrack (deleting/moving either would corrupt the
      // other's). Paste always starts from the same safe default a brand-new V2 insert gets.
      const dur = cb.data.endTime - cb.data.startTime;
      addAdditionalVideoClip({ ...cb.data, id, startTime: p, endTime: p + dur, brollAudio: cb.data.brollAudio === "keep" ? "muted" : cb.data.brollAudio, brollAudioTrackId: undefined });
      setSelectedElement({ type: "clip", lane: "additional", id });
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
    } else if (cb.kind === "lowerThird") {
      const dur = (cb.data.endTime ?? cb.data.startTime + 5) - cb.data.startTime;
      addLowerThird({ ...cb.data, id, startTime: p, endTime: p + dur });
      setSelectedElement({ type: "lowerThird", id });
    } else if (cb.kind === "shape") {
      const dur = cb.data.endTime - cb.data.startTime;
      addShape({ ...cb.data, id, startTime: p, endTime: p + dur });
      setSelectedElement({ type: "shape", id });
    } else if (cb.kind === "subtitle") {
      const dur = cb.data.endTime - cb.data.startTime;
      addSubtitle({ ...cb.data, id, startTime: p, endTime: p + dur });
      setSelectedElement({ type: "subtitle", id });
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
    } else if (selectedElement.type === "clip" && selectedElement.lane === "additional") {
      // Phase 1 — Requirement 5 ("duplicate where existing architecture supports it"): same
      // shape as V1's own duplicate above; same "never inherit the original's kept audio track"
      // rule paste already established (see pasteClipboard).
      const c = additionalVideoClips.find(v => v.id === selectedElement.id);
      if (!c) return;
      const dur = c.endTime - c.startTime;
      addAdditionalVideoClip({ ...c, id, startTime: c.endTime, endTime: c.endTime + dur, brollAudio: c.brollAudio === "keep" ? "muted" : c.brollAudio, brollAudioTrackId: undefined });
      setSelectedElement({ type: "clip", lane: "additional", id });
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
    } else if (selectedElement.type === "lowerThird") {
      const l = lowerThirds.find(x => x.id === selectedElement.id);
      if (!l || l.endTime === undefined) return;
      const dur = l.endTime - l.startTime;
      addLowerThird({ ...l, id, startTime: l.endTime, endTime: l.endTime + dur });
      setSelectedElement({ type: "lowerThird", id });
    } else if (selectedElement.type === "shape") {
      const sh = shapes.find(x => x.id === selectedElement.id);
      if (!sh) return;
      const dur = sh.endTime - sh.startTime;
      addShape({ ...sh, id, startTime: sh.endTime, endTime: sh.endTime + dur });
      setSelectedElement({ type: "shape", id });
    } else if (selectedElement.type === "subtitle") {
      const s = subtitles.find(x => x.id === selectedElement.id);
      if (!s) return;
      const dur = s.endTime - s.startTime;
      addSubtitle({ ...s, id, startTime: s.endTime, endTime: s.endTime + dur });
      setSelectedElement({ type: "subtitle", id });
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
    } else if (selectedElement?.type === "lowerThird") {
      // Phase 2: same clamp shape as Overlay's own above — LowerThird has real width/height too.
      const l = lowerThirds.find(x => x.id === selectedElement.id);
      if (!l) return;
      const w = l.width ?? DEFAULT_LOWER_THIRD_BOX.width;
      const h = l.height ?? DEFAULT_LOWER_THIRD_BOX.height;
      const maxX = Math.max(0, 100 - w);
      const maxY = Math.max(0, 100 - h);
      updateLowerThird(l.id, {
        x: Math.min(maxX, Math.max(0, (l.x ?? DEFAULT_LOWER_THIRD_BOX.x) + dx)),
        y: Math.min(maxY, Math.max(0, (l.y ?? DEFAULT_LOWER_THIRD_BOX.y) + dy)),
      });
    } else if (selectedElement?.type === "shape") {
      // Phase 4: same clamp shape again — Shape always has real width/height (never optional).
      const sh = shapes.find(x => x.id === selectedElement.id);
      if (!sh) return;
      const maxX = Math.max(0, 100 - sh.width);
      const maxY = Math.max(0, 100 - sh.height);
      updateShape(sh.id, { x: Math.min(maxX, Math.max(0, sh.x + dx)), y: Math.min(maxY, Math.max(0, sh.y + dy)) });
    } else if (selectedElement?.type === "subtitle") {
      // Phase 5: same "width only, Y clamps to plain 0-100" convention as Text's own branch —
      // a subtitle's box height is implicit from its content, never a measured/stored field.
      const s = subtitles.find(x => x.id === selectedElement.id);
      if (!s) return;
      const maxX = Math.max(0, 100 - s.width);
      updateSubtitle(s.id, { x: Math.min(maxX, Math.max(0, s.x + dx)), y: Math.min(100, Math.max(0, s.y + dy)) });
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
          const isMovableCanvasSelection = selectedElement?.type === "text" || selectedElement?.type === "overlay" || selectedElement?.type === "lowerThird" || selectedElement?.type === "shape" || selectedElement?.type === "subtitle";
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
      ) : mediaTab === "Lower Thirds" ? (
        // Phase 2 (Video Studio V2 — Lower Thirds): same "no upload, create + list + select"
        // shape as the Text tab above — a lower third is authored content, not an uploaded file.
        <div className="media-grid">
          {lowerThirds.map(l => (
            <div
              key={l.id}
              className={`media-card text-card ${selectedElement?.type === "lowerThird" && selectedElement.id === l.id ? "canvas-el-selected" : ""}`}
              onClick={() => setSelectedElement({ type: "lowerThird", id: l.id })}
              title="Click to select — edit it in the Properties panel"
            >
              <div className="fake-media text-swatch">{l.name || "Lower Third"}</div>
              <small>{l.title || "Lower third"}</small>
            </div>
          ))}
          <button className="add-media" type="button" onClick={handleAddLowerThird}>+<br />Add Lower Third</button>
        </div>
      ) : mediaTab === "Shapes" ? (
        // Phase 4 (Video Studio V2 — Independent Shapes): same "no upload, create + list +
        // select" shape as Text/Lower Thirds above — a shape is authored content too. One
        // add-button per named kind (Rectangle/Circle/Line/Banner/Highlight — see Shape's own
        // type comment for why "rounded rectangle" isn't a separate one) rather than a single
        // generic "+ Add Shape" that would then need a second picker step.
        <div className="media-grid">
          {shapes.map(sh => (
            <div
              key={sh.id}
              className={`media-card ${selectedElement?.type === "shape" && selectedElement.id === sh.id ? "canvas-el-selected" : ""}`}
              onClick={() => setSelectedElement({ type: "shape", id: sh.id })}
              title="Click to select — edit it in the Properties panel"
            >
              <div className="fake-media overlay-swatch" style={{ background: sh.fillColor }}>
                {sh.kind === "circle" ? "●" : sh.kind === "line" ? "▬" : sh.kind === "banner" ? "▭" : sh.kind === "highlight" ? "▧" : "▮"}
              </div>
              <small>{SHAPE_KIND_LABELS[sh.kind]}</small>
            </div>
          ))}
          {(Object.keys(SHAPE_KIND_LABELS) as Shape["kind"][]).map(kind => (
            <button key={kind} className="add-media" type="button" onClick={() => handleAddShape(kind)}>+<br />{SHAPE_KIND_LABELS[kind]}</button>
          ))}
        </div>
      ) : mediaTab === "Subtitles" ? (
        <div className="subtitles-panel">
          {/* Requirement (AUTOMATIC TRANSCRIPT GENERATION — "wire it into the V2 editor
              properly"): the real backend Whisper call, against V1's current source clip. */}
          <h4>Generate Captions</h4>
          <p className="empty-hint">
            {captionSourceClip ? `From: ${captionSourceClip.name || "V1 clip"}` : "Select or play a V1 clip with a source file first."}
          </p>
          <button type="button" className="add-media" disabled={captionGenBusy || !captionSourceClip?.assetId} onClick={() => void handleGenerateCaptions()}>
            {captionGenBusy ? "Transcribing…" : "Generate Captions from Audio"}
          </button>
          {captionGenError && <p className="empty-hint" style={{ color: "#c94d4d" }}>{captionGenError}</p>}

          {/* Requirement (PASTE TRANSCRIPT): Option A (SRT, real timestamps) or Option B (plain
              text, auto-segmented into subtitle-sized chunks) — see parseSrtTranscript/
              autoSegmentPlainTranscript's own comments for exactly which path a paste takes. */}
          <h4>Paste Transcript</h4>
          <textarea
            placeholder="Paste an SRT transcript (with timestamps) or plain text — plain text is auto-segmented into subtitle-sized chunks starting at the current playhead."
            value={pasteTranscriptText}
            onChange={e => setPasteTranscriptText(e.target.value)}
          />
          <button type="button" className="add-media" disabled={!pasteTranscriptText.trim()} onClick={handlePasteTranscript}>
            Add as Subtitles
          </button>

          {/* Requirement (SUBTITLE DATA MODEL — "global style ... inherited"). */}
          <h4>Global Style</h4>
          <div className="row">
            <select value={subtitleStyle.fontFamily} onChange={e => setSubtitleStyle({ ...subtitleStyle, fontFamily: e.target.value })}>
              <option>Inter</option><option>Montserrat</option><option>Poppins</option>
            </select>
            <select value={String(subtitleStyle.fontSize)} onChange={e => setSubtitleStyle({ ...subtitleStyle, fontSize: Number(e.target.value) })}>
              {[24, 28, 32, 36, 42, 48, 56].map(sz => <option key={sz} value={sz}>{sz}</option>)}
            </select>
            <input type="color" value={subtitleStyle.color} onChange={e => setSubtitleStyle({ ...subtitleStyle, color: e.target.value })} />
          </div>
          <div className="row align-row">
            {(["left", "center", "right"] as const).map(a => (
              <button key={a} type="button" className={subtitleStyle.align === a ? "active" : ""} onClick={() => setSubtitleStyle({ ...subtitleStyle, align: a })}>
                {a === "left" ? "⯇" : a === "center" ? "≡" : "⯈"}
              </button>
            ))}
          </div>
          <label className="stack-field"><span>Background — {Math.round(subtitleStyle.bgOpacity * 100)}%</span>
            <div className="row">
              <input type="color" value={subtitleStyle.bgColor === "transparent" ? "#000000" : subtitleStyle.bgColor}
                onChange={e => setSubtitleStyle({ ...subtitleStyle, bgColor: e.target.value })} />
              <input type="range" min={0} max={100} value={Math.round(subtitleStyle.bgOpacity * 100)}
                onChange={e => setSubtitleStyle({ ...subtitleStyle, bgOpacity: Number(e.target.value) / 100 })} />
            </div>
          </label>

          <h4>Segments</h4>
          <div className="media-grid">
            {subtitles.map(s => (
              <div
                key={s.id}
                className={`media-card text-card ${selectedElement?.type === "subtitle" && selectedElement.id === s.id ? "canvas-el-selected" : ""}`}
                onClick={() => setSelectedElement({ type: "subtitle", id: s.id })}
                title="Click to select — edit it in the Properties panel"
              >
                <div className="fake-media text-swatch">{s.text.slice(0, 40) || "Subtitle"}</div>
                <small>{formatTimecode(s.startTime)} – {formatTimecode(s.endTime)}</small>
              </div>
            ))}
            {subtitles.length === 0 && <p className="empty-hint">No subtitles yet — generate captions or paste a transcript above.</p>}
          </div>
        </div>
      ) : mediaTab === "Audio" ? (
        <div className="media-grid">
          {mediaItems.map(({ asset }, i) => (
            <div
              className="media-card"
              key={asset.id}
              draggable
              title={`${asset.original_filename} — drag onto A1`}
              onDragStart={e => {
                const payload: MediaAssetDragPayload = {
                  assetId: asset.id, url: assetsApi.previewUrl(asset.file_path),
                  name: asset.original_filename, mimeType: asset.mime_type, kind: "audio",
                };
                e.dataTransfer.setData(MEDIA_ASSET_DRAG_TYPE, JSON.stringify(payload));
                e.dataTransfer.setData(dragKindMimeType("audio"), "1");
                e.dataTransfer.effectAllowed = "copy";
              }}
            >
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
                onClick={e => { e.stopPropagation(); void handleAddAssetToTimeline(asset, "Audio"); }}
                title="Add this audio to the A1 timeline at the current playhead"
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
              draggable={kind === "Videos" || kind === "Images"}
              title={
                kind === "Videos" ? `${asset.original_filename} — drag onto V1 (Main Video) or V2 (B-roll)`
                  : kind === "Images" ? `${asset.original_filename} — drag onto O1`
                    : asset.original_filename
              }
              onDragStart={kind === "Videos" || kind === "Images" ? (e) => {
                const dragKind = dragKindForAssetKind(kind);
                const payload: MediaAssetDragPayload = {
                  assetId: asset.id, url: assetsApi.previewUrl(asset.file_path),
                  name: asset.original_filename, mimeType: asset.mime_type, kind: dragKind,
                };
                e.dataTransfer.setData(MEDIA_ASSET_DRAG_TYPE, JSON.stringify(payload));
                e.dataTransfer.setData(dragKindMimeType(dragKind), "1");
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
              {(kind === "Videos" || kind === "Images") && (
                <button
                  type="button"
                  className="add-to-timeline-btn"
                  onClick={e => { e.stopPropagation(); void handleAddAssetToTimeline(asset, kind); }}
                  title={kind === "Videos" ? "Add this video to V1 (Main Video) at the current playhead" : "Add this image to O1 at the current playhead"}
                >
                  + Add to Timeline
                </button>
              )}
              {/* Phase 1 — "Canvas Intent" requirement: an explicit, unambiguous alternative to
                  the button above, so choosing V1 vs. V2 is never a guess. */}
              {kind === "Videos" && (
                <button
                  type="button"
                  className="add-to-timeline-btn"
                  onClick={e => { e.stopPropagation(); void handleAddAssetAsBroll(asset); }}
                  title="Add this video to V2 (B-roll / Insert) at the current playhead"
                >
                  + Add as B-roll (V2)
                </button>
              )}
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
        const textStatus = passStatus.text_analysis; // undefined until first attempted (Stage 6)
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

                    {/* Video Deconstructor — Stage 6 (OCR / On-Screen Text / Captions) presentation
                        addition ONLY: the backend already computes recurring_elements (a video-
                        level cross-reference of Occurrence Groups that probably represent the same
                        real on-screen element reappearing) — this surfaces that ALREADY EXISTING
                        data additively, above the per-shot occurrence rows below, never replacing
                        or hiding any of them. Every value shown here is looked up directly from
                        data already present on refIngestResult (no new backend fields, no new
                        inference beyond a plain highest-confidence-member lookup and shot-number
                        formatting). */}
                    {textStatus === "complete" && refIngestResult.recurring_elements.length > 0 && (() => {
                      const textElementsById = new Map<number, { text: string; confidence_score: number | null; shotOrder: number }>();
                      for (const s of refIngestResult.shots) {
                        for (const te of s.text_elements) {
                          textElementsById.set(te.id, { text: te.text, confidence_score: te.confidence_score, shotOrder: s.order });
                        }
                      }
                      return (
                        <div style={{ marginBottom: 10 }}>
                          <p className="selection-summary-label">
                            Recurring/Persistent Elements · {refIngestResult.recurring_elements.length}
                          </p>
                          <p className="empty-hint" style={{ margin: "0 0 6px", fontSize: 10 }}>
                            Linked from individual occurrences below — probably the same on-screen element reappearing.
                          </p>
                          {refIngestResult.recurring_elements.map(re => {
                            const members = re.member_text_element_ids
                              .map(id => textElementsById.get(id))
                              .filter((m): m is { text: string; confidence_score: number | null; shotOrder: number } => m != null);
                            const representative = members.slice().sort(
                              (a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0)
                            )[0];
                            const shotNumbers = Array.from(new Set(members.map(m => m.shotOrder + 1))).sort((a, b) => a - b);
                            const isContiguous = shotNumbers.every((n, i) => i === 0 || n === shotNumbers[i - 1] + 1);
                            const shotLabel = shotNumbers.length === 0 ? null
                              : shotNumbers.length === 1 ? `Shot ${String(shotNumbers[0]).padStart(2, "0")}`
                              : isContiguous ? `Shot ${String(shotNumbers[0]).padStart(2, "0")}–${String(shotNumbers[shotNumbers.length - 1]).padStart(2, "0")}`
                              : `Shots ${shotNumbers.map(n => String(n).padStart(2, "0")).join(", ")}`;
                            return (
                              <div key={re.id} className="shot-row" style={{ fontSize: 11, marginBottom: 6, cursor: "default" }}>
                                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  &ldquo;{representative ? representative.text.trim() : "Unknown text"}&rdquo;
                                </div>
                                <div style={{ color: "var(--v-muted)", fontSize: 9 }}>
                                  {re.member_text_element_ids.length} occurrence{re.member_text_element_ids.length === 1 ? "" : "s"}
                                  {shotLabel && ` · ${shotLabel}`}
                                  {" · "}{formatShotTimecode(re.start_time)} → {formatShotTimecode(re.end_time)}
                                  {re.confidence_score != null && ` · ${Math.round(re.confidence_score * 100)}% text consistency`}
                                </div>
                                <div style={{ color: "var(--v-accent)", fontSize: 9, fontStyle: "italic", marginTop: 2 }}>
                                  Recurring/persistent element
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

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

                        {/* Video Deconstructor — Stage 6 (OCR / On-Screen Text / Captions) ONLY.
                            Same sibling-of-the-Shot-button nesting as Visual Evidence above.
                            Each row's thumbnail is the exact frame the text was read from
                            (Stage-5 frame reused, or a new Stage-6 supplementary frame) — same
                            draggable={false}+pointer-events:none fix already learned once in
                            Stage 5, applied here from the start rather than as a follow-up. */}
                        {textStatus === "complete" && shot.text_elements.length > 0 && (
                          <div style={{ padding: "4px 0 0 8px", marginTop: 4 }}>
                            <p className="empty-hint" style={{ margin: "0 0 4px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>
                              Text Analysis · {shot.text_elements.length} occurrence{shot.text_elements.length === 1 ? "" : "s"}
                            </p>
                            {shot.text_elements.map(te => (
                              <button
                                key={te.id}
                                type="button"
                                className={`shot-row${selectedTextElementId === te.id ? " active" : ""}`}
                                onClick={() => handleSeekReferencePreviewToText(shot.id, te.id, te.start_time)}
                                title={`Seek Reference Preview to ${formatShotTimecode(te.start_time)}`}
                                style={{ fontSize: 11, display: "flex", gap: 8, alignItems: "center" }}
                              >
                                {te.source_frame_asset_file_path && (
                                  <img
                                    src={assetsApi.previewUrl(te.source_frame_asset_file_path)}
                                    alt={`Evidence frame for detected text "${te.text.trim()}"`}
                                    draggable={false}
                                    style={{ width: 36, height: 24, objectFit: "cover", borderRadius: 3, flexShrink: 0, pointerEvents: "none" }}
                                  />
                                )}
                                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                                  <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    &ldquo;{te.text.trim()}&rdquo;
                                  </div>
                                  <div style={{ color: "var(--v-muted)", fontSize: 9 }}>
                                    {formatShotTimecode(te.start_time)} → {formatShotTimecode(te.end_time)}
                                    {te.confidence_score != null && ` · ${Math.round(te.confidence_score * 100)}% confidence`}
                                  </div>
                                </div>
                              </button>
                            ))}
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

                    {/* Video Deconstructor — Stage 6 (OCR / On-Screen Text / Captions) ONLY.
                        Gated on frameStatus (Stage 5) being complete, same "requires the
                        previous pass" pattern Stage 5's own section uses relative to Stage 4. */}
                    {frameStatus === "complete" && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--v-line)" }}>
                        <p className="selection-summary-label">
                          {textStatus === "complete" ? "Text Analysis Complete"
                            : textStatus === "running" ? "Analysing Text…"
                            : textStatus === "failed" ? "Text Analysis Failed"
                            : "Text Analysis"}
                        </p>
                        {(textStatus === undefined || textStatus === "pending" || textStatus === "failed") && (
                          <button
                            className="primary wide" type="button"
                            onClick={() => void handleAnalyzeText()}
                            disabled={refAnalyzeTextBusy}
                          >
                            {refAnalyzeTextBusy ? "Analysing Text…" : textStatus === "failed" ? "Retry Text Analysis →" : "Analyse Text →"}
                          </button>
                        )}
                        {textStatus === "running" && !refAnalyzeTextBusy && (
                          <button className="secondary wide" type="button" disabled style={{ opacity: 0.6, cursor: "not-allowed" }}>
                            Analysing Text…
                          </button>
                        )}
                        {refAnalyzeTextError && <p className="inline-status error">{refAnalyzeTextError}</p>}
                        {textStatus === "failed" && refIngestResult.latest_analysis.error && !refAnalyzeTextError && (
                          <p className="inline-status error">{refIngestResult.latest_analysis.error}</p>
                        )}
                      </div>
                    )}
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
              <input type="color" value={selectedText.color} onChange={e => updateTextOverlay(selectedText.id, { color: e.target.value })} disabled={!!selectedText.useGradient}
                title={selectedText.useGradient ? "Solid colour is unused while Gradient Fill is on" : "Text colour"} />
            </div>

            {/* Phase 3 — Requirement (TYPOGRAPHY): italic already rendered on canvas but had no
                control here (a real gap the audit called out); underline/alignment/letter and
                line spacing are new fields entirely. */}
            <h4>Typography</h4>
            <div className="row align-row">
              {(["left", "center", "right"] as const).map(a => (
                <button key={a} type="button" className={(selectedText.align ?? "left") === a ? "active" : ""}
                  onClick={() => updateTextOverlay(selectedText.id, { align: a })}>{a === "left" ? "⯇" : a === "center" ? "≡" : "⯈"}</button>
              ))}
              <button type="button" className={selectedText.italic ? "active" : ""}
                onClick={() => updateTextOverlay(selectedText.id, { italic: !selectedText.italic })} title="Italic"><i>I</i></button>
              <button type="button" className={selectedText.underline ? "active" : ""}
                onClick={() => updateTextOverlay(selectedText.id, { underline: !selectedText.underline })} title="Underline"><u>U</u></button>
            </div>
            <div className="row">
              <label className="stack-field"><span>Letter spacing — {selectedText.letterSpacing ?? 0}px</span>
                <input type="range" min={-2} max={20} value={selectedText.letterSpacing ?? 0}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateTextOverlay(selectedText.id, { letterSpacing: Number(e.target.value) })} />
              </label>
              <label className="stack-field"><span>Line spacing — {(selectedText.lineSpacing ?? 1.15).toFixed(2)}</span>
                <input type="range" min={0.8} max={2.5} step={0.05} value={selectedText.lineSpacing ?? 1.15}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateTextOverlay(selectedText.id, { lineSpacing: Number(e.target.value) })} />
              </label>
            </div>
            <label className="stack-field"><span>Opacity — {Math.round((selectedText.opacity ?? 1) * 100)}%</span>
              <input type="range" min={10} max={100} value={Math.round((selectedText.opacity ?? 1) * 100)}
                onMouseDown={pushHistory}
                onChange={e => rawUpdateTextOverlay(selectedText.id, { opacity: Number(e.target.value) / 100 })} />
            </label>

            {/* Requirement (TEXT EFFECTS): outline/stroke, shadow ("glow" reached via a 0-offset,
                larger-blur shadow — see getTextRenderStyle's own comment), gradient fill. */}
            <h4>Text Effects</h4>
            <label className="stack-field"><span>Outline / Stroke</span>
              <div className="row">
                <input type="color" value={selectedText.strokeColor ?? "#000000"}
                  onChange={e => updateTextOverlay(selectedText.id, { strokeColor: e.target.value })} />
                <input type="range" min={0} max={6} step={0.5} value={selectedText.strokeWidth ?? 0}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateTextOverlay(selectedText.id, { strokeWidth: Number(e.target.value) })} />
              </div>
            </label>
            <label className="stack-field"><span>Shadow / Glow</span>
              <div className="row">
                <input type="color" value={selectedText.shadowColor ?? "#000000"}
                  onChange={e => updateTextOverlay(selectedText.id, { shadowColor: e.target.value })} title="Shadow colour" />
                <input type="range" min={0} max={30} value={selectedText.shadowBlur ?? 0}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateTextOverlay(selectedText.id, { shadowBlur: Number(e.target.value) })} title="Blur — 0 offset + high blur reads as a glow" />
              </div>
              <div className="row">
                <input type="range" min={-15} max={15} value={selectedText.shadowOffsetX ?? 0}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateTextOverlay(selectedText.id, { shadowOffsetX: Number(e.target.value) })} title="Offset X" />
                <input type="range" min={-15} max={15} value={selectedText.shadowOffsetY ?? 0}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateTextOverlay(selectedText.id, { shadowOffsetY: Number(e.target.value) })} title="Offset Y" />
              </div>
            </label>
            <label className="stack-field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" checked={selectedText.useGradient ?? false}
                onChange={e => updateTextOverlay(selectedText.id, { useGradient: e.target.checked, gradientFrom: selectedText.gradientFrom ?? selectedText.color, gradientTo: selectedText.gradientTo ?? "#12A656" })} />
              <span>Gradient Fill</span>
            </label>
            {selectedText.useGradient && (
              <div className="row">
                <input type="color" value={selectedText.gradientFrom ?? selectedText.color} onChange={e => updateTextOverlay(selectedText.id, { gradientFrom: e.target.value })} />
                <input type="color" value={selectedText.gradientTo ?? "#12A656"} onChange={e => updateTextOverlay(selectedText.id, { gradientTo: e.target.value })} />
              </div>
            )}

            {/* Requirement (BACKGROUND / READABILITY): bgColor/bgOpacity already existed and are
                already real on canvas (see getTextRenderStyle) — this is their first Properties
                UI. bgBorderRadius doubles as the pill/rectangle/banner shape control. */}
            <h4>Background</h4>
            <div className="row">
              <input type="color" value={selectedText.bgColor === "transparent" ? "#000000" : selectedText.bgColor}
                onChange={e => updateTextOverlay(selectedText.id, { bgColor: e.target.value })} />
              <button type="button" className={selectedText.bgColor === "transparent" ? "active" : ""}
                onClick={() => updateTextOverlay(selectedText.id, { bgColor: selectedText.bgColor === "transparent" ? "#000000" : "transparent" })}>
                {selectedText.bgColor === "transparent" ? "Off" : "On"}
              </button>
            </div>
            {selectedText.bgColor !== "transparent" && (
              <>
                <label className="stack-field"><span>Background opacity — {Math.round(selectedText.bgOpacity * 100)}%</span>
                  <input type="range" min={0} max={100} value={Math.round(selectedText.bgOpacity * 100)}
                    onMouseDown={pushHistory}
                    onChange={e => rawUpdateTextOverlay(selectedText.id, { bgOpacity: Number(e.target.value) / 100 })} />
                </label>
                <div className="row align-row">
                  <button type="button" className={(selectedText.bgBorderRadius ?? 3) <= 4 && !selectedText.bgFullWidth ? "active" : ""}
                    onClick={() => updateTextOverlay(selectedText.id, { bgBorderRadius: 3, bgFullWidth: false })}>Rectangle</button>
                  <button type="button" className={(selectedText.bgBorderRadius ?? 3) >= 30 && !selectedText.bgFullWidth ? "active" : ""}
                    onClick={() => updateTextOverlay(selectedText.id, { bgBorderRadius: 999, bgFullWidth: false })}>Pill</button>
                  <button type="button" className={selectedText.bgFullWidth ? "active" : ""}
                    onClick={() => updateTextOverlay(selectedText.id, { bgFullWidth: !selectedText.bgFullWidth })}>Banner</button>
                </div>
                <div className="row">
                  <label className="stack-field"><span>Padding — {selectedText.bgPadding ?? 2}px</span>
                    <input type="range" min={0} max={30} value={selectedText.bgPadding ?? 2}
                      onMouseDown={pushHistory}
                      onChange={e => rawUpdateTextOverlay(selectedText.id, { bgPadding: Number(e.target.value) })} />
                  </label>
                  <label className="stack-field"><span>Radius — {selectedText.bgBorderRadius ?? 3}px</span>
                    <input type="range" min={0} max={40} value={Math.min(40, selectedText.bgBorderRadius ?? 3)}
                      onMouseDown={pushHistory}
                      onChange={e => rawUpdateTextOverlay(selectedText.id, { bgBorderRadius: Number(e.target.value) })} />
                  </label>
                </div>
                <label className="stack-field"><span>Border</span>
                  <div className="row">
                    <input type="color" value={selectedText.bgBorderColor ?? "#000000"}
                      onChange={e => updateTextOverlay(selectedText.id, { bgBorderColor: e.target.value })} />
                    <input type="range" min={0} max={6} step={0.5} value={selectedText.bgBorderWidth ?? 0}
                      onMouseDown={pushHistory}
                      onChange={e => rawUpdateTextOverlay(selectedText.id, { bgBorderWidth: Number(e.target.value) })} />
                  </div>
                </label>
                <label className="stack-field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                  <input type="checkbox" checked={selectedText.bgBlur ?? false}
                    onChange={e => updateTextOverlay(selectedText.id, { bgBlur: e.target.checked })} />
                  <span>Blur / translucent background</span>
                </label>
              </>
            )}

            {/* "TextArt / preset styles" — real presets over the real fields above (not a
                separate rendering system): one click sets a bundle of stroke/shadow/background
                values, exactly as if set by hand through the controls above. */}
            <h4>Style Presets</h4>
            <div className="row">
              {TEXT_STYLE_PRESETS.map(p => (
                <button key={p.name} type="button" onClick={() => updateTextOverlay(selectedText.id, p.apply)} title={p.name}>{p.name}</button>
              ))}
            </div>

            <h4>Animation</h4>
            {/* Field is real and persists/exports-ready for a later phase; it does not yet drive
                a live enter/exit animation on canvas — same scoping decision Lower Third's own
                Animation select already made in Phase 2. */}
            <select value={selectedText.animation} onChange={e => updateTextOverlay(selectedText.id, { animation: e.target.value as TextOverlay["animation"] })}>
              <option value="none">None</option><option value="fade_in">Fade In</option>
              <option value="slide_left">← Slide</option><option value="slide_right">→ Slide</option>
              <option value="slide_top">↓ Drop</option><option value="slide_bottom">↑ Rise</option>
              <option value="typewriter">Typewriter</option><option value="pop">Pop</option>
            </select>

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
        ) : selectedAdditionalClip ? (
          <>
            {/* Phase 1 (V2 Inserts/B-roll) — Requirement 8: the Properties panel showing this
                clip's REAL settings, same live-binding convention as every other selected type
                here (selectedClip/selectedOverlay/selectedAudio above) — nothing mocked. */}
            <h4>V2 Insert / B-roll</h4>
            <p className="clip-name">{selectedAdditionalClip.name || "Untitled clip"}</p>
            <label className="stack-field"><span>Filter</span>
              <select value={selectedAdditionalClip.colorGrade} onChange={e => updateAdditionalVideoClip(selectedAdditionalClip.id, { colorGrade: e.target.value as VideoClip["colorGrade"] })}>
                <option value="none">None</option><option value="bw">Grayscale</option><option value="sepia">Sepia</option>
                <option value="warm">Warm</option><option value="cool">Cool</option><option value="high_contrast">High Contrast</option>
              </select>
            </label>
            {/* Requirement 5 ("opacity where appropriate") — a control V1 has no equivalent of
                (V1 is always the fully-opaque base layer), meaningful for a B-roll insert
                composited over V1. */}
            <label className="stack-field"><span>Opacity — {Math.round(selectedAdditionalClip.opacity ?? 100)}%</span>
              <input type="range" min={10} max={100} value={Math.round(selectedAdditionalClip.opacity ?? 100)}
                onMouseDown={pushHistory}
                onChange={e => rawUpdateAdditionalVideoClip(selectedAdditionalClip.id, { opacity: Number(e.target.value) })} />
            </label>
            <h4>Fit / Crop</h4>
            <div className="row">
              <button type="button" className={(selectedAdditionalClip.fitMode ?? "fit") === "fit" ? "active" : ""}
                onClick={() => applyInsertFitMode(selectedAdditionalClip, "fit")}>Fit</button>
              <button type="button" className={selectedAdditionalClip.fitMode === "fill" && insertRepositionId !== selectedAdditionalClip.id ? "active" : ""}
                onClick={() => applyInsertFitMode(selectedAdditionalClip, "fill")}>Fill</button>
              <button type="button" className={insertRepositionId === selectedAdditionalClip.id ? "active" : ""}
                onClick={() => enterInsertCropReposition(selectedAdditionalClip)}>Crop &amp; Reposition</button>
            </div>
            <h4>Transform</h4>
            <div className="row">
              <input value={`X ${Math.round(selectedAdditionalClip.insertX ?? DEFAULT_INSERT_BOX.insertX)}%`} readOnly />
              <input value={`Y ${Math.round(selectedAdditionalClip.insertY ?? DEFAULT_INSERT_BOX.insertY)}%`} readOnly />
            </div>
            <div className="row">
              <input value={`W ${Math.round(selectedAdditionalClip.insertWidth ?? DEFAULT_INSERT_BOX.insertWidth)}%`} readOnly />
              <input value={`H ${Math.round(selectedAdditionalClip.insertHeight ?? DEFAULT_INSERT_BOX.insertHeight)}%`} readOnly />
            </div>
            {/* Requirement 9 (B-roll audio): only shown once embedded audio was actually
                detected (insertAdditionalVideoClipAt only ever sets brollAudio when
                probeHasAudioTrack confirmed it) — a silent B-roll clip has nothing to choose. */}
            {selectedAdditionalClip.brollAudio && (
              <>
                <h4>B-roll Audio</h4>
                <label className="stack-field"><span>This clip's embedded audio</span>
                  <select value={selectedAdditionalClip.brollAudio}
                    onChange={e => applyBrollAudioChoice(selectedAdditionalClip, e.target.value as NonNullable<VideoClip["brollAudio"]>)}>
                    <option value="keep">Keep — as an independent A1 track</option>
                    <option value="muted">Mute — silent, embedded</option>
                    <option value="removed">Removed — no audio</option>
                  </select>
                </label>
                <p className="empty-hint">
                  {selectedAdditionalClip.brollAudio === "keep"
                    ? "This clip's audio is on A1 as its own track — trim, mute, or delete it there independently of this video."
                    : "This clip plays back silent — its embedded audio is never mixed into the project."}
                </p>
              </>
            )}
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
        ) : selectedLowerThird ? (
          <>
            {/* Phase 2 (Video Studio V2 — Lower Thirds) — real, editable settings, same
                live-binding convention as every other selected type. Name/Title/animation are
                the exact same fields legacy /studio's LowerThirdBuilder.tsx already writes —
                this Properties panel is a second, real editor over that same data, not a
                parallel model. */}
            <h4>Lower Third</h4>
            <label className="stack-field"><span>Name / Speaker</span>
              <input value={selectedLowerThird.name} onFocus={pushHistory}
                onChange={e => rawUpdateLowerThird(selectedLowerThird.id, { name: e.target.value })} placeholder="e.g. Sameena Khan" />
            </label>
            <label className="stack-field"><span>Title / Role</span>
              <input value={selectedLowerThird.title} onFocus={pushHistory}
                onChange={e => rawUpdateLowerThird(selectedLowerThird.id, { title: e.target.value })} placeholder="e.g. Marketing Director" />
            </label>
            <label className="stack-field"><span>Animation</span>
              <select value={selectedLowerThird.animation} onChange={e => updateLowerThird(selectedLowerThird.id, { animation: e.target.value as LowerThird["animation"] })}>
                <option value="slide_left">← Slide In</option>
                <option value="fade_in">Fade In</option>
                <option value="pop_up">↑ Pop Up</option>
              </select>
            </label>
            <label className="stack-field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" checked={selectedLowerThird.showLogo}
                onChange={e => updateLowerThird(selectedLowerThird.id, { showLogo: e.target.checked })} />
              <span>Show brand logo</span>
            </label>
            <h4>Transform</h4>
            <div className="row">
              <input value={`X ${Math.round(selectedLowerThird.x ?? DEFAULT_LOWER_THIRD_BOX.x)}%`} readOnly />
              <input value={`Y ${Math.round(selectedLowerThird.y ?? DEFAULT_LOWER_THIRD_BOX.y)}%`} readOnly />
            </div>
            <div className="row">
              <input value={`W ${Math.round(selectedLowerThird.width ?? DEFAULT_LOWER_THIRD_BOX.width)}%`} readOnly />
              <input value={`H ${Math.round(selectedLowerThird.height ?? DEFAULT_LOWER_THIRD_BOX.height)}%`} readOnly />
            </div>
          </>
        ) : selectedShape ? (
          <>
            {/* Phase 4 (Video Studio V2 — Independent Shapes) — real fill/opacity/border/size/
                position/z-order controls (z-order is the shared Layers tab, same as Text/
                Overlay/Lower Third — no separate control needed here). */}
            <h4>{SHAPE_KIND_LABELS[selectedShape.kind]}</h4>
            <label className="stack-field"><span>Fill colour</span>
              <input type="color" value={selectedShape.fillColor}
                onChange={e => updateShape(selectedShape.id, { fillColor: e.target.value })} />
            </label>
            <label className="stack-field"><span>Opacity — {Math.round(selectedShape.opacity * 100)}%</span>
              <input type="range" min={0} max={100} value={Math.round(selectedShape.opacity * 100)}
                onMouseDown={pushHistory}
                onChange={e => rawUpdateShape(selectedShape.id, { opacity: Number(e.target.value) / 100 })} />
            </label>
            {selectedShape.kind !== "circle" && selectedShape.kind !== "line" && (
              <label className="stack-field"><span>Corner radius — {selectedShape.borderRadius ?? 0}px</span>
                <input type="range" min={0} max={60} value={selectedShape.borderRadius ?? 0}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateShape(selectedShape.id, { borderRadius: Number(e.target.value) })} />
              </label>
            )}
            <label className="stack-field"><span>Border</span>
              <div className="row">
                <input type="color" value={selectedShape.borderColor ?? "#000000"}
                  onChange={e => updateShape(selectedShape.id, { borderColor: e.target.value })} />
                <input type="range" min={0} max={10} value={selectedShape.borderWidth ?? 0}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateShape(selectedShape.id, { borderWidth: Number(e.target.value) })} />
              </div>
            </label>
            <label className="stack-field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" checked={selectedShape.fullWidth ?? false}
                onChange={e => updateShape(selectedShape.id, { fullWidth: e.target.checked })} />
              <span>Full width (banner)</span>
            </label>
            <h4>Transform</h4>
            <div className="row">
              <input value={`X ${Math.round(selectedShape.x)}%`} readOnly />
              <input value={`Y ${Math.round(selectedShape.y)}%`} readOnly />
            </div>
            <div className="row">
              <input value={`W ${Math.round(selectedShape.width)}%`} readOnly />
              <input value={`H ${Math.round(selectedShape.height)}%`} readOnly />
            </div>
            <p className="empty-hint">Layer order (front/behind text) is set in the Layers tab, same as every other visual element.</p>
          </>
        ) : selectedSubtitle ? (
          <>
            {/* Phase 5 (Video Studio V2 — Subtitles / Transcript) — Requirement (EDIT TRANSCRIPT/
                SUBTITLES): correct words, per-segment style override, merge with the next
                segment (split reuses the shared ✂ Split-at-playhead toolbar action — same
                mechanism every other lane already has, see handleSplitAtPlayhead's own
                subtitle branch), move/resize on canvas (above), adjust start/end (timeline trim
                handles). Nothing here is mocked — same live-binding convention as every other
                selected type. */}
            <h4>Subtitle</h4>
            <textarea value={selectedSubtitle.text} onFocus={pushHistory}
              onChange={e => rawUpdateSubtitle(selectedSubtitle.id, { text: e.target.value })} />
            <button type="button" onClick={() => handleMergeSubtitleWithNext(selectedSubtitle)} title="Combine this segment's text and timing with whichever segment plays next">
              Merge with Next Segment
            </button>
            <h4>Style</h4>
            <label className="stack-field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
              <input type="checkbox" checked={!!selectedSubtitle.styleOverride}
                onChange={e => updateSubtitle(selectedSubtitle.id, { styleOverride: e.target.checked ? {} : undefined })} />
              <span>Override global style for this segment</span>
            </label>
            {selectedSubtitle.styleOverride && (() => {
              const resolved = resolveSubtitleStyle(selectedSubtitle);
              const setOverride = (field: keyof SubtitleStyle, value: SubtitleStyle[keyof SubtitleStyle]) =>
                updateSubtitle(selectedSubtitle.id, { styleOverride: { ...selectedSubtitle.styleOverride, [field]: value } });
              return (
                <>
                  <div className="row">
                    <select value={resolved.fontFamily} onChange={e => setOverride("fontFamily", e.target.value)}>
                      <option>Inter</option><option>Montserrat</option><option>Poppins</option>
                    </select>
                    <select value={String(resolved.fontSize)} onChange={e => setOverride("fontSize", Number(e.target.value))}>
                      {[24, 28, 32, 36, 42, 48, 56].map(sz => <option key={sz} value={sz}>{sz}</option>)}
                    </select>
                    <input type="color" value={resolved.color} onChange={e => setOverride("color", e.target.value)} />
                  </div>
                  <div className="row align-row">
                    {(["left", "center", "right"] as const).map(a => (
                      <button key={a} type="button" className={resolved.align === a ? "active" : ""} onClick={() => setOverride("align", a)}>
                        {a === "left" ? "⯇" : a === "center" ? "≡" : "⯈"}
                      </button>
                    ))}
                  </div>
                  <label className="stack-field"><span>Background</span>
                    <div className="row">
                      <input type="color" value={resolved.bgColor === "transparent" ? "#000000" : resolved.bgColor} onChange={e => setOverride("bgColor", e.target.value)} />
                      <input type="range" min={0} max={100} value={Math.round(resolved.bgOpacity * 100)}
                        onMouseDown={pushHistory}
                        onChange={e => setOverride("bgOpacity", Number(e.target.value) / 100)} />
                    </div>
                  </label>
                  <label className="stack-field"><span>Outline</span>
                    <div className="row">
                      <input type="color" value={resolved.outlineColor ?? "#000000"} onChange={e => setOverride("outlineColor", e.target.value)} />
                      <input type="range" min={0} max={4} step={0.5} value={resolved.outlineWidth ?? 0}
                        onMouseDown={pushHistory}
                        onChange={e => setOverride("outlineWidth", Number(e.target.value))} />
                    </div>
                  </label>
                  <label className="stack-field"><span>Shadow</span>
                    <div className="row">
                      <input type="color" value={resolved.shadowColor ?? "#000000"} onChange={e => setOverride("shadowColor", e.target.value)} />
                      <input type="range" min={0} max={20} value={resolved.shadowBlur ?? 0}
                        onMouseDown={pushHistory}
                        onChange={e => setOverride("shadowBlur", Number(e.target.value))} />
                    </div>
                  </label>
                </>
              );
            })()}
            <h4>Transform</h4>
            <div className="row">
              <input value={`X ${Math.round(selectedSubtitle.x)}%`} readOnly />
              <input value={`Y ${Math.round(selectedSubtitle.y)}%`} readOnly />
            </div>
            <input value={`W ${Math.round(selectedSubtitle.width)}%`} readOnly />
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
            <li key={c.id} className={selectedElement?.type === "clip" && selectedElement.lane === "video" && selectedElement.id === c.id ? "active" : ""}
              onClick={() => setSelectedElement({ type: "clip", lane: "video", id: c.id })}>🎬 {c.name || "Clip"}</li>
          ))}
          {/* Phase 1 (V2 Inserts/B-roll): a second fixed layer, above Video and below the
              reorderable Text/Overlay stack — same "not draggable, not part of the shared
              `order` space" treatment Video itself gets above, one level up. */}
          {additionalVideoClips.map(c => (
            <li key={c.id} className={selectedElement?.type === "clip" && selectedElement.lane === "additional" && selectedElement.id === c.id ? "active" : ""}
              onClick={() => setSelectedElement({ type: "clip", lane: "additional", id: c.id })}>🎞 {c.name || "B-roll"}</li>
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
          {videoClips.length + additionalVideoClips.length + textOverlays.length + audioTracks.length + mediaOverlays.length + lowerThirds.length + shapes.length + subtitles.length === 0 && (
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
        ) : selectedAdditionalClip ? (
          // Phase 1: same three sliders/range/formula as V1's own above — getMediaFilter (used
          // by the insert layer's own render) already reads these generically off any VideoClip,
          // so this is purely exposing UI for a rendering path that already existed.
          <>
            {(["brightness", "contrast", "saturation"] as const).map(k => (
              <label key={k} className="stack-field">
                <span style={{ textTransform: "capitalize" }}>{k}</span>
                <input type="range" min={-50} max={50} value={selectedAdditionalClip[k]}
                  onMouseDown={pushHistory}
                  onChange={e => rawUpdateAdditionalVideoClip(selectedAdditionalClip.id, { [k]: Number(e.target.value) } as Partial<VideoClip>)} />
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
            {/* Phase 6 (Video Studio V2 — Safe Areas / Guides / Snapping): optional visual
                guides + a snap toggle — "Snapping should help but should NOT prevent free
                positioning", so this only ever offers ON/OFF for a soft, threshold-based
                magnetism (see snapAxis's own comment), never a hard constraint. */}
            <span className="crop-mode-menu">
              <button type="button" className={guidesMenuOpen ? "active" : ""} onClick={() => setGuidesMenuOpen(v => !v)} title="Safe-area guides and snapping">
                Guides⌄
              </button>
              {guidesMenuOpen && (
                <div className="crop-mode-dropdown">
                  {(Object.keys(GUIDE_LABELS) as GuideKey[]).map(key => (
                    <button key={key} type="button" className={guidesEnabled[key] ? "active" : ""} onClick={() => toggleGuide(key)}>
                      {guidesEnabled[key] ? "☑" : "☐"} {GUIDE_LABELS[key]}
                    </button>
                  ))}
                  <button type="button" className={snapEnabled ? "active" : ""} onClick={() => setSnapEnabled(v => !v)}>
                    {snapEnabled ? "☑" : "☐"} Snap to guides
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

          <div
            className={`preview-canvas-region orientation-${orientation} ${canvasDropActive ? "drop-active" : ""}`}
            ref={previewRegionRef}
            onClick={deselectCanvas}
            onDragOver={e => { if (detectDragKind(e) === "video") { e.preventDefault(); setCanvasDropActive(true); } }}
            onDragLeave={() => setCanvasDropActive(false)}
            onDrop={handleCanvasVideoDrop}
          >
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
                {insertLayer}
                {visualLayers}
                {guideOverlay}
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
                {insertLayer}
                {visualLayers}
                {guideOverlay}
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
          onDragOver={e => {
            const kind = detectDragKind(e);
            if (kind) { e.preventDefault(); setDropActive(true); setDragOverKind(kind); }
          }}
          onDragLeave={() => { setDropActive(false); setDragOverKind(null); }}
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

          <TrackRow label="V1 Video" highlight={dragOverKind === "video"}>
            {videoClips.map(c => (
              <ClipBlock key={c.id} start={c.startTime} end={c.endTime} total={effectiveDuration}
                selected={selectedElement?.type === "clip" && selectedElement.lane === "video" && selectedElement.id === c.id}
                onClick={() => setSelectedElement({ type: "clip", lane: "video", id: c.id })}
                onMove={newStart => rawUpdateVideoClip(c.id, { startTime: newStart, endTime: newStart + (c.endTime - c.startTime) })}
                onTrimLeft={p => trimVideoLeft(c, p)} onTrimRight={p => trimVideoRight(c, p)} onGestureStart={pushHistory}
                color="blue" label={c.name || "Clip"} />
            ))}
          </TrackRow>
          {/* Phase 1 (V2 Inserts/B-roll) — Requirement 1: a real second video timeline track,
              same ClipBlock/select/move/trim mechanics V1 already has, entirely independent
              (own array, own history, own drop target — see handleDropOnV2Row). */}
          <TrackRow
            label="V2 Insert / B-roll"
            highlight={dragOverKind === "video"}
            onLaneDragOver={e => { if (detectDragKind(e) === "video") { e.preventDefault(); e.stopPropagation(); setDropActive(true); setDragOverKind("video"); } }}
            onLaneDragLeave={() => { setDropActive(false); setDragOverKind(null); }}
            onLaneDrop={handleDropOnV2Row}
          >
            {additionalVideoClips.map(c => (
              <ClipBlock key={c.id} start={c.startTime} end={c.endTime} total={effectiveDuration}
                selected={selectedElement?.type === "clip" && selectedElement.lane === "additional" && selectedElement.id === c.id}
                onClick={() => setSelectedElement({ type: "clip", lane: "additional", id: c.id })}
                onMove={newStart => rawUpdateAdditionalVideoClip(c.id, { startTime: newStart, endTime: newStart + (c.endTime - c.startTime) })}
                onTrimLeft={p => trimInsertLeft(c, p)} onTrimRight={p => trimInsertRight(c, p)} onGestureStart={pushHistory}
                color="amber" label={c.name || "B-roll"} />
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
          <TrackRow label="O1 Overlay" highlight={dragOverKind === "image"}>
            {mediaOverlays.map(o => (
              <ClipBlock key={o.id} start={o.startTime} end={o.endTime} total={effectiveDuration}
                selected={selectedElement?.type === "overlay" && selectedElement.id === o.id}
                onClick={() => setSelectedElement({ type: "overlay", id: o.id })}
                onMove={newStart => rawUpdateMediaOverlay(o.id, { startTime: newStart, endTime: newStart + (o.endTime - o.startTime) })}
                onTrimLeft={p => trimOverlayLeft(o, p)} onTrimRight={p => trimOverlayRight(o, p)} onGestureStart={pushHistory}
                color="pink" label="Overlay" />
            ))}
          </TrackRow>
          {/* Phase 2 (Video Studio V2 — Lower Thirds): same ClipBlock/select/move/trim mechanics
              every other real lane already has. Only lower thirds with a real endTime (i.e.
              every one created in Video Studio V2 — see handleAddLowerThird) render here; a
              legacy-shaped one from /studio's own LowerThirdBuilder (no endTime) has no defined
              duration for a timeline clip and is correctly left off this row rather than guessed. */}
          <TrackRow label="LT1 Lower Third">
            {lowerThirds.filter((l): l is LowerThird & { endTime: number } => l.endTime !== undefined).map(l => (
              <ClipBlock key={l.id} start={l.startTime} end={l.endTime} total={effectiveDuration}
                selected={selectedElement?.type === "lowerThird" && selectedElement.id === l.id}
                onClick={() => setSelectedElement({ type: "lowerThird", id: l.id })}
                onMove={newStart => rawUpdateLowerThird(l.id, { startTime: newStart, endTime: newStart + (l.endTime - l.startTime) })}
                onTrimLeft={p => trimLowerThirdLeft(l, p)} onTrimRight={p => trimLowerThirdRight(l, p)} onGestureStart={pushHistory}
                color="teal" label={l.name || "Lower Third"} />
            ))}
          </TrackRow>
          {/* Phase 4 (Video Studio V2 — Independent Shapes): same ClipBlock mechanics again. */}
          <TrackRow label="SH1 Shapes">
            {shapes.map(sh => (
              <ClipBlock key={sh.id} start={sh.startTime} end={sh.endTime} total={effectiveDuration}
                selected={selectedElement?.type === "shape" && selectedElement.id === sh.id}
                onClick={() => setSelectedElement({ type: "shape", id: sh.id })}
                onMove={newStart => rawUpdateShape(sh.id, { startTime: newStart, endTime: newStart + (sh.endTime - sh.startTime) })}
                onTrimLeft={p => trimShapeLeft(sh, p)} onTrimRight={p => trimShapeRight(sh, p)} onGestureStart={pushHistory}
                color="lime" label={SHAPE_KIND_LABELS[sh.kind]} />
            ))}
          </TrackRow>
          {/* Phase 5 (Video Studio V2 — Subtitles / Transcript): same ClipBlock mechanics again. */}
          <TrackRow label="CC1 Subtitles">
            {subtitles.map(s => (
              <ClipBlock key={s.id} start={s.startTime} end={s.endTime} total={effectiveDuration}
                selected={selectedElement?.type === "subtitle" && selectedElement.id === s.id}
                onClick={() => setSelectedElement({ type: "subtitle", id: s.id })}
                onMove={newStart => rawUpdateSubtitle(s.id, { startTime: newStart, endTime: newStart + (s.endTime - s.startTime) })}
                onTrimLeft={p => trimSubtitleLeft(s, p)} onTrimRight={p => trimSubtitleRight(s, p)} onGestureStart={pushHistory}
                color="rose" label={s.text || "Subtitle"} />
            ))}
          </TrackRow>
          <TrackRow label="A1 Audio" highlight={dragOverKind === "audio"}>
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

// Drop Target Feedback requirement: `highlight` marks this row as the one valid destination
// for whatever's currently being dragged over the timeline (see dragOverKind in
// CreateEditTab). Optional and defaulting to no-highlight, so T1 Text (which nothing drags
// onto — text is authored via "+ Add Text", not dragged from the library) needs no change.
function TrackRow({ label, children, highlight, onLaneDrop, onLaneDragOver, onLaneDragLeave }: {
  label: string; children: React.ReactNode; highlight?: boolean;
  // Phase 1 (V2 Inserts/B-roll): optional row-specific drop target — used ONLY by the V2 row,
  // so a video dropped there is unambiguously "add as B-roll", never routed through the
  // section-level handleDrop (which is what every other row still relies on, unchanged).
  onLaneDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onLaneDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onLaneDragLeave?: () => void;
}) {
  return (
    <div className={`track ${highlight ? "track-drop-target" : ""}`}>
      <div className="track-label">{label}<span>◉ 🔒</span></div>
      <div className="track-lane" onDrop={onLaneDrop} onDragOver={onLaneDragOver} onDragLeave={onLaneDragLeave}>{children}</div>
    </div>
  );
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
