Warning: truncated output (original token count: 104164)
Total output lines: 6728


import { validCanvasBackground } from "../export/canvasBackground";
import { clipFadeOpacity } from "../export/transitionFade";
import { blendPreviewAt, planBlendWindows, sourceTimeAt } from "../export/dissolveWindow";
import { previewBlurPx, validCanvasBackdrop } from "../export/canvasBackdrop";
import { durationCorrection } from "../export/measuredDuration";
import { draftExtrasForSave, emptyExtras, extrasNote, pickDraftExtras } from "../export/draftExtras";
import { EDITOR_DEFAULT_CANVAS_FORMAT, EDITOR_DEFAULT_SUBTITLE_STYLE } from "../blueprint/projectDefaults";
import BehindFootageLayer from "../export/BehindFootageLayer";
import { behindFootageRects } from "../export/behindFootagePreview";
import { isBehindFootage } from "../export/footageGeometry";
import { useVideoSizes } from "../export/useVideoSizes";
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
// C6 (Blueprint -> Video Studio V2): the active blueprint plan travels with every saved draft and is restored when one is opened.
import CreativeToolsPanel, { type CreativeTask } from "./CreativeToolsPanel";
import { getBlueprintPlan, setBlueprintPlan } from "../blueprint/blueprintPlanStore";
import { defaultDraftNameFor, identityForSave, isStoredIdentity, resolveProjectIdentity } from "../identity/projectIdentity";
import { getProjectContext, setProjectContext } from "../identity/projectContextStore";
import { isBlueprintPlan, type BlueprintPlan } from "../blueprint/blueprintPlan";
import { consumeOpenDraftHint } from "../blueprint/openDraftHint";
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

// Project identity is no longer a constant: it comes from the project itself (identity/projectIdentity.ts) -- the open draft, else the blueprint it was built from, else a neutral fallback.
const currentIdentityInput = () => ({ plan: getBlueprintPlan(), stored: getProjectContext().storedIdentity });

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

// Additional one-click text looks use existing editable fields, so preview, draft
// persistence, undo/redo and export all follow the same rendering path.
const EXTRA_TEXT_STYLE_PRESETS: { name: string; apply: Partial<TextOverlay> }[] = [
  { name: "Gold Luxury", apply: { color: "#FFD700", fontFamily: "Montserrat", bold: true, useGradient: true, gradientFrom: "#FFF4AD", gradientTo: "#B8860B", strokeColor: "#352200", strokeWidth: 2, shadowColor: "#000000", shadowBlur: 8, shadowOffsetX: 3, shadowOffsetY: 3, bgColor: "transparent", bgOpacity: 0 } },
  { name: "3D Shadow", apply: { color: "#FFFFFF", bold: true, useGradient: false, strokeColor: "#141414", strokeWidth: 2, shadowColor: "#000000", shadowBlur: 2, shadowOffsetX: 7, shadowOffsetY: 7, bgColor: "transparent", bgOpacity: 0 } },
  { name: "Cinematic", apply: { color: "#FFFFFF", fontFamily: "Montserrat", bold: true, useGradient: false, strokeColor: "#000000", strokeWidth: 1, shadowColor: "#000000", shadowBlur: 10, shadowOffsetX: 0, shadowOffsetY: 3, bgColor: "#000000", bgOpacity: 0.45, bgBorderRadius: 2, bgFullWidth: true, bgBlur: false } },
  { name: "Outline Pop", apply: { color: "#FFFFFF", bold: true, useGradient: false, strokeColor: "#FF2468", strokeWidth: 5, shadowColor: "#000000", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, bgColor: "transparent", bgOpacity: 0 } },
  { name: "Retro Sunset", apply: { color: "#FFCC33", bold: true, useGradient: true, gradientFrom: "#FFDE59", gradientTo: "#FF4E50", strokeColor: "#5B1B64", strokeWidth: 3, shadowColor: "#5B1B64", shadowBlur: 0, shadowOffsetX: 4, shadowOffsetY: 4, bgColor: "transparent", bgOpacity: 0 } },
  { name: "Ice Gradient", apply: { color: "#D6FFFF", bold: true, useGradient: true, gradientFrom: "#FFFFFF", gradientTo: "#00C8FF", strokeColor: "#083C70", strokeWidth: 2, shadowColor: "#00C8FF", shadowBlur: 12, shadowOffsetX: 0, shadowOffsetY: 0, bgColor: "transparent", bgOpacity: 0 } },
  { name: "Minimal", apply: { color: "#FFFFFF", fontFamily: "Inter", bold: false, useGradient: false, strokeWidth: 0, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, bgColor: "transparent", bgOpacity: 0 } },
  { name: "Social Bold", apply: { color: "#FFFFFF", fontFamily: "Poppins", bold: true, useGradient: false, strokeColor: "#000000", strokeWidth: 4, shadowColor: "#000000", shadowBlur: 5, shadowOffsetX: 2, shadowOffsetY: 2, bgColor: "#FF006E", bgOpacity: 0.88, bgBorderRadius: 8, bgFullWidth: false, bgBlur: false } },
  { name: "Electric Blue", apply: { color: "#00E5FF", bold: true, useGradient: false, strokeColor: "#003D66", strokeWidth: 2, shadowColor: "#00D4FF", shadowBlur: 20, shadowOffsetX: 0, shadowOffsetY: 0, bgColor: "transparent", bgOpacity: 0 } },
  { name: "Elegant", apply: { color: "#F7E8D0", fontFamily: "Montserrat", bold: false, useGradient: false, strokeColor: "#4C3527", strokeWidth: 1, shadowColor: "#000000", shadowBlur: 3, shadowOffsetX: 1, shadowOffsetY: 2, bgColor: "transparent", bgOpacity: 0 } },
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
  // Reconstructor canvas colour: written only when the person chose a measured bar colour; applied as the background colour of the CURRENT canvas format, never as a format.
  canvasBackground?: string;
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
  // C6: the blueprint (scenes + traceability) this draft was created from; absent for drafts that did not come from one.
  blueprintPlan?: BlueprintPlan | null;
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

export default function CreateEditTab({ onNext, onBack, projectDialogRequest = 0 }: { onNext?: () => void; onBack?: () => void; projectDialogRequest?: number }) {
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
    mediaAssets, addMediaAsset, removeMediaAsset, uploadAsset, resetCanvasItemPositions,
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
  const [canvasTool, setCanvasTool] = useState<"select" | "pan">("select");
  const panStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
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
  // Four creative tools share one editor-side panel; no draft mutation or automatic AI calls.
  const [activeCreativeTask, setActiveCreativeTask] = useState<CreativeTask | null>(null);
  const [enhanceAssetId, setEnhanceAssetId] = useState<number | null>(null);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [enhanceSuccess, setEnhanceSuccess] = useState<string | null>(null);

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
  const [draftId, setDraftId] = useState<number | null>(() => getProjectContext().draftId);
  const [draftName, setDraftName] = useState<string>(() => getProjectContext().draftName);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [showSaveDraft, setShowSaveDraft] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [showMyDrafts, setShowMyDrafts] = useState(false);
  const [showProjectChooser, setShowProjectChooser] = useState(false);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState<string | null>(null);

  // Sidebar Open / Save Project must open real actions even when already in Create / Edit.
  // Request counter also works when navigating here from another workflow stage.
  useEffect(() => {
    if (projectDialogRequest > 0) setShowProjectChooser(true);
  }, [projectDialogRequest]);

  // Records the draft carries that this editor does not model (the Reconstructor's `*Reconstruction` records and its draft-level table): picked up when a draft is opened and written back on save, so a save from the editor no
  // longer drops them. Named keys below always win; nothing here edits a layer (see export/draftExtras.ts).
  const { reconstructionExtrasRef: draftExtrasRef } = useStudio();
  const buildProjectSnapshot = (): DraftProjectSnapshot => ({
    ...draftExtrasForSave(draftExtrasRef.current, { textOverlays, mediaOverlays, shapes }),
    videoClips, additionalVideoClips, textOverlays, mediaOverlays, audioTracks, lowerThirds, shapes, subtitles, subtitleStyle, mediaAssets,
    canvasFormat, timeline, canvasItemPositions,
    clientIdentity: identityForSave({ ...currentIdentityInput(), draftName }),
    blueprintPlan: getBlueprintPlan(),
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
    draftExtrasRef.current = pickDraftExtras(snap);
    clearLiveProject();
    (snap.videoClips ?? []).forEach(c => rawAddVideoClip(c));
    (snap.additionalVideoClips ?? []).forEach(c => rawAddAdditionalVideoClip(c));
    (snap.textOverlays ?? []).forEach(t => rawAddTextOverlay(t));
    (snap.mediaOverlays ?? []).forEach(o => rawAddMediaOverlay(o));
    (snap.audioTracks ?? []).forEach(a => rawAddAudioTrack(a));
    (snap.lowerThirds ?? []).forEach(l => rawAddLowerThird(l));
    (snap.shapes ?? []).forEach(s => rawAddShape(s));
    (snap.subtitles ?? []).forEach(s => rawAddSubtitle(s));
    // A draft that carries no subtitle style / canvas format (Reconstructor and blueprint drafts) starts from the editor's own, never from the project that happened to be open before it.
    setSubtitleStyle(snap.subtitleStyle ?? { ...EDITOR_DEFAULT_SUBTITLE_STYLE });
    // mediaAssets only has an additive action (no bulk replace) — skip any id already present
    // rather than duplicate entries already in the Media panel.
    const wantedAssetIds = new Set((snap.mediaAssets ?? []).map(a => a.id));
    mediaAssets.forEach(a => { if (!wantedAssetIds.has(a.id)) removeMediaAsset(a.id); });          // the previous project's media library does not follow into this one
    const existingAssetIds = new Set(mediaAssets.map(a => a.id));
    (snap.mediaAssets ?? []).forEach(a => { if (!existingAssetIds.has(a.id)) addMediaAsset(a); });
    setCanvasFormat(snap.canvasFormat ?? { ...EDITOR_DEFAULT_CANVAS_FORMAT });
    const reconstructorColour = validCanvasBackground(snap.canvasBackground);
    if (reconstructorColour) setCanvasFormat({ ...(snap.canvasFormat ?? EDITOR_DEFAULT_CANVAS_FORMAT), background: reconstructorColour });
    if (snap.timeline) setTimeline(snap.timeline);
    resetCanvasItemPositions();
    Object.entries(snap.canvasItemPositions ?? {}).forEach(([id, pos]) => setCanvasItemPosition(id, pos));
    setBlueprintPlan(isBlueprintPlan(snap.blueprintPlan) ? snap.blueprintPlan : null);
  };

  // Requirement 9: a safe way to start a fresh project without touching any already-saved
  // draft row on the backend — this only ever clears the LIVE in-editor state (the same thing
  // a refresh would lose anyway, absent Step 7's separate auto-recovery system) and forgets
  // which draft this session was attached to. Nothing under video-studio-drafts is deleted or
  // modified by this action.
  const handleNewDraft = () => {
    if (!window.confirm("Start a new project? This clears the current editor (any Saved Draft is not affected — you can reopen it from My Drafts).")) return;
    draftExtrasRef.current = emptyExtras();
    clearLiveProject();
    setBlueprintPlan(null);
    setDraftId(null);
    setDraftName("");
    setDraftStatus(null);
    setProjectContext(null);
  };

  const defaultDraftName = () => defaultDraftNameFor(resolveProjectIdentity(currentIdentityInput()));

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
      let savedId = draftId;
      if (draftId != null) {
        await videoStudioDraftsApi.update(draftId, { name, project_json });
      } else {
        const { data } = await videoStudioDraftsApi.create({ name, project_json });
        savedId = (data as { id: number }).id;
        setDraftId(savedId);
      }
      setDraftName(name);
      setProjectContext({ draftId: savedId, draftName: name, storedIdentity: project_json.clientIdentity });
      setDraftStatus(`Saved "${name}"${extrasNote(draftExtrasRef.current)}`);
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
      if ((full.project_json as { editor_version?: number }).editor_version === 3) {
        setDraftsError("Open this draft in Video Studio V3.");
        return;
      }
      applyDraftSnapshot(full.project_json);
      setDraftId(full.id);
      setDraftName(full.name);
      setProjectContext({ draftId: full.id, draftName: full.name, storedIdentity: isStoredIdentity(full.project_json?.clientIdentity) ? full.project_json.clientIdentity : null });
      setDraftStatus(`Opened "${full.name}"${extrasNote(draftExtrasRef.current)}`);
      setShowMyDrafts(false);
    } catch {
      setDraftsError("Could not open that draft — please try again.");
    } finally {
      setDraftBusy(false);
    }
  };

  // C6: arriving from "Use blueprint" -- open the draft that action just created (one-shot hint), so this session is attached to it.
  useEffect(() => {
    const id = consumeOpenDraftHint();
    if (id != null) void handleOpenDraft(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // D1: the extra, muted <video> that shows the OTHER clip of a dissolve while the timeline is inside the blend window (see the D1 block below).
  const blendVideoRef = useRef<HTMLVideoElement>(null);
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
  // Empty projects need a work area; authored projects show their actual duration.
  const effectiveDuration = Math.max(timeline.duration || 0, ...authoredEnds) || 15;

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
      ratio: placement.ratio, width: placement.width, height: placement.height, background: canvasFormat.background, backdrop: canvasFormat.backdrop,
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
      ratio: "CUSTOM", width: w, height: h, background: canvasFormat.background, backdrop: canvasFormat.backdrop,
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
    const vid = videoRef…64164 tokens truncated…ty * 100)}%</span>
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
            <label className="stack-field" style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }} title="Visible only where the footage is not (the bars of a Fit clip, gaps); never covers the picture">
              <input type="checkbox" data-testid="shape-behind-footage" checked={isBehindFootage(selectedShape)}
                onChange={e => updateShape(selectedShape.id, { behindFootage: e.target.checked } as Partial<Shape>)} />
              <span>Behind footage</span>
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
  // guessing which brand this project belongs to — the project identity's plain client/
  // campaign label is the one real "who this is for" fact this editor actually has.
  const buildAiPromptContext = () => {
    const identity = resolveProjectIdentity(currentIdentityInput());
    const ctx: Record<string, unknown> = {
      // a project with no identity sends none (never a placeholder or a demo client)
      ...(identity.source === "neutral" ? {} : { client: identity.client, campaign: identity.campaign }),
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

  const processImageAsset = async (operation: "enhance" | "background" | "complex") => {
    if (enhanceBusy || enhanceAssetId === null) return;
    const source = mediaAssets.find(asset => asset.id === enhanceAssetId && asset.file_type === "image");
    if (!source) {
      setEnhanceError("Select an uploaded image first.");
      return;
    }
    setEnhanceBusy(true);
    setEnhanceError(null);
    setEnhanceSuccess(null);
    try {
      const response = operation === "enhance"
        ? await assetsApi.autoEnhance(source.id)
        : operation === "complex" ? await assetsApi.removeComplexBackground(source.id)
        : await assetsApi.removeFlatBackground(source.id);
      const blob = new Blob([response.data], { type: "image/png" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${operation === "enhance" ? "enhanced" : operation === "complex" ? "foreground" : "no-background"}-${source.id}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Give the browser time to begin the download before revoking the URL.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setEnhanceSuccess(operation === "enhance"
        ? "Enhanced PNG downloaded. Your original image and draft are unchanged."
        : operation === "complex"
          ? "Foreground PNG downloaded. This is an approximate offline cutout; review its edges before use."
          : "Flat-colour background removal downloaded. Review the result; complex backgrounds are not supported.");
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setEnhanceError(typeof detail === "string" ? detail : "Enhancement failed. Your original image was not changed.");
    } finally {
      setEnhanceBusy(false);
    }
  };

  // Generated suggestions are never applied automatically. The user explicitly
  // chooses "Use in editor"; insert one editable title at the current playhead.
  // Long scripts remain in the editable tool output rather than being dumped
  // wholesale over the video preview.
  const useCreativeTextInEditor = (content: string, _task: CreativeTask) => {
    const firstLine = content.split(/\r?\n/).map(line => line.trim())
      .find(line => line.length > 0 && !/^[-*#]+$/.test(line));
    if (!firstLine) return;
    const title = firstLine.replace(/^[-*#\d.)\s]+/, "").slice(0, 140).trim();
    if (!title) return;
    const startTime = Math.max(0, timeline.currentTime);
    const remaining = effectiveDuration > startTime ? effectiveDuration - startTime : 5;
    const endTime = startTime + Math.min(5, remaining);
    const overlay: TextOverlay = {
      id: crypto.randomUUID(),
      text: title,
      x: 5, y: 80, width: 90,
      startTime,
      endTime,
      fontFamily: "Inter", fontSize: 48, bold: true, italic: false,
      color: "#FFFFFF", bgColor: "transparent", bgOpacity: 0.7, animation: "fade_in",
    };
    addTextOverlay(overlay);
    setSelectedElement({ type: "text", id: overlay.id });
  };

  const [imagePromptOpen, setImagePromptOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const [imageStatus, setImageStatus] = useState("");
  const requestGeneratedImage = async () => {
    if (!imagePrompt.trim() || imageBusy) return;
    setImageBusy(true);
    setImageError("");
    setImageStatus("");
    try {
      const response = await generateApi.image(imagePrompt.trim());
      const url = URL.createObjectURL(response.data as Blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "socialgenius-generated-image.png";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setImageStatus("Generated PNG downloaded. Upload it to your media library to use it in the video.");
    } catch (error) {
      const response = (error as { response?: { data?: unknown } })?.response;
      const blob = response?.data;
      if (blob instanceof Blob) {
        try {
          const parsed = JSON.parse(await blob.text()) as { detail?: string };
          setImageError(parsed.detail || "Image generation failed.");
        } catch {
          setImageError("Image generation failed. No image was saved.");
        }
      } else {
        setImageError("Image generation failed. No image was saved.");
      }
    } finally {
      setImageBusy(false);
    }
  };

  const aiToolsPanelBody = (
    <>
      <h3>✦ AI Tools</h3>
      <button type="button" onClick={() => setPromptGenOpen(true)}>
        <b>AI Prompt Generator</b><small>Generate on-brand prompts</small>
      </button>
      {([
        ["hook_generation", "AI Hook Suggestion", "Get better hooks"],
        ["script_generation", "AI Script Writer", "Write engaging scripts"],
        ["caption_generation", "AI Caption Generator", "Create captions & hashtags"],
        ["thumbnail_ideas", "AI Thumbnail Ideas", "Generate thumbnail concepts"],
      ] as const).map(([task, title, description]) => (
        <button key={task} type="button" aria-expanded={activeCreativeTask === task}
          onClick={() => setActiveCreativeTask(current => current === task ? null : task)}>
          <b>{title}</b><small>{description}</small>
        </button>
      ))}
      <button type="button" aria-expanded={imagePromptOpen} onClick={() => setImagePromptOpen(open => !open)}>
        <b>AI Image Generator</b><small>Generate a PNG when paid AI is authorised</small>
      </button>
      {imagePromptOpen && (
        <section aria-label="AI image generator">
          <label htmlFor="ai-image-prompt">Describe the image</label>
          <textarea id="ai-image-prompt" rows={3} maxLength={4000} value={imagePrompt}
            onChange={event => setImagePrompt(event.target.value)}
            placeholder="Subject, composition, style, colours and intended audience" />
          <p>One 1024×1024 PNG per request. Requires an image provider and explicit AI spending authorisation. No automatic charges or changes to your draft.</p>
          <button type="button" disabled={!imagePrompt.trim() || imageBusy}
            onClick={() => void requestGeneratedImage()}>
            {imageBusy ? "Generating…" : "Generate Image — Download PNG"}
          </button>
          {imageError && <p role="alert">{imageError}</p>}
          {imageStatus && <p role="status">{imageStatus}</p>}
        </section>
      )}
      {activeCreativeTask && (
        <CreativeToolsPanel key={activeCreativeTask} initialTask={activeCreativeTask}
          context={buildAiPromptContext()} onUseText={useCreativeTextInEditor} />
      )}
      <h3>Quick Actions</h3>
      <label className="stack-field">
        <span>Image to process</span>
        <select value={enhanceAssetId ?? ""} disabled={enhanceBusy}
          onChange={event => {
            setEnhanceAssetId(event.target.value ? Number(event.target.value) : null);
            setEnhanceError(null);
            setEnhanceSuccess(null);
          }}>
          <option value="">Select an uploaded image</option>
          {mediaAssets.filter(asset => asset.file_type === "image").map(asset => (
            <option key={asset.id} value={asset.id}>{asset.original_filename}</option>
          ))}
        </select>
      </label>
      <button type="button" disabled={enhanceBusy || enhanceAssetId === null}
        title="Removes only a near-uniform background connected to the image corners; not AI subject segmentation"
        onClick={() => void processImageAsset("background")}>
        Remove Flat Background — Download PNG
      </button>
      <button type="button" disabled={enhanceBusy || enhanceAssetId === null}
        title="Offline approximate foreground extraction for centrally positioned subjects; not AI semantic segmentation"
        onClick={() => void processImageAsset("complex")}>
        Remove Complex Background — Download PNG
      </button>
      <p className="empty-hint">Flat removal is best for solid backgrounds. Complex removal estimates a central foreground using offline GrabCut; review cutout edges. Originals are preserved.</p>

      <button type="button" disabled={enhanceBusy || enhanceAssetId === null}
        onClick={() => void processImageAsset("enhance")}>
        {enhanceBusy ? "Enhancing…" : "Auto Enhance — Download PNG"}
      </button>
      {enhanceError && <p role="alert" className="inline-status error">{enhanceError}</p>}
      {enhanceSuccess && <p role="status" className="inline-status">{enhanceSuccess}</p>}
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
            onClick={() => setCanvasFormat({ ...v, background: canvasFormat.background, backdrop: canvasFormat.backdrop })}
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
        <aside className="ai-tools-panel">{aiToolsPanelBody}</aside>

        <aside className="asset-panel">{assetPanelBody}</aside>

        <section className="preview-area">
          <div className="canvas-toolbar">
            <button type="button" onClick={handleUndo} disabled={undoStackRef.current.length === 0} title="Undo">↶</button>
            <button type="button" onClick={handleRedo} disabled={redoStackRef.current.length === 0} title="Redo">↷</button>
            <button type="button" className={canvasTool === "pan" ? "active" : ""} onClick={() => setCanvasTool("pan")} title="Pan canvas (drag to scroll)">✋</button>
            <button type="button" className={canvasTool === "select" ? "active" : ""} onClick={() => setCanvasTool("select")} title="Select canvas elements">⌁</button>
            <span className="zoom-readout" title="Actual scale of the canvas as displayed">{Math.round((canvasBox.w / rawW) * 100)}%</span>
            <label className="canvas-bg-control" title="Colour behind a letterboxed video (Fit) and in timeline gaps">
              <input type="color" data-testid="canvas-background" value={validCanvasBackground(canvasFormat.background) ?? "#000000"} onChange={e => setCanvasFormat({ ...canvasFormat, background: e.target.value })} />
              <button type="button" disabled={!canvasFormat.background} onClick={() => setCanvasFormat({ ...canvasFormat, background: undefined })}>Reset to black</button>
            </label>
            <label className="canvas-bg-control" title="What fills the bars of a letterboxed (Fit) video: the colour, or a blurred copy of the video itself. Blur makes exports take longer. The preview shows the active clip's backdrop only: during a dissolve the other clip's backdrop is not drawn (the MP4 has it).">
              <select data-testid="canvas-backdrop" value={canvasFormat.backdrop ?? "color"} onChange={e => setCanvasFormat({ ...canvasFormat, backdrop: validCanvasBackdrop(e.target.value) })}>
                <option value="color">Bars: colour</option>
                <option value="blur">Bars: blurred video</option>
              </select>
            </label>
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
            style={{ cursor: canvasTool === "pan" ? "grab" : undefined, overflow: canvasTool === "pan" ? "auto" : undefined }}
            onMouseDown={e => { if (canvasTool !== "pan") return; const el = previewRegionRef.current; if (!el) return; e.preventDefault(); panStartRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }; }}
            onMouseMove={e => { if (canvasTool !== "pan" || !panStartRef.current || !previewRegionRef.current) return; const p = panStartRef.current; previewRegionRef.current.scrollLeft = p.left - (e.clientX - p.x); previewRegionRef.current.scrollTop = p.top - (e.clientY - p.y); }}
            onMouseUp={() => { panStartRef.current = null; }}
            onMouseLeave={() => { panStartRef.current = null; }}
            onClick={e => { if (canvasTool === "pan") { e.stopPropagation(); return; } deselectCanvas(); }}
            onDragOver={e => { if (detectDragKind(e) === "video") { e.preventDefault(); setCanvasDropActive(true); } }}
            onDragLeave={() => setCanvasDropActive(false)}
            onDrop={handleCanvasVideoDrop}
          >
            {hasRealSrc ? (
              <div
                ref={videoPreviewBoxRef}
                className={`video-preview real canvas-selectable ${selectedClip?.id === activeVideoClip!.id ? "canvas-el-selected" : ""}`}
                style={{ width: canvasBox.w, height: canvasBox.h, ...(validCanvasBackground(canvasFormat.background) ? { background: validCanvasBackground(canvasFormat.background) } : {}) }}
                onClick={e => { e.stopPropagation(); setSelectedElement({ type: "clip", lane: "video", id: activeVideoClip!.id }); }}
                title={`${activeVideoClip!.name || "Video"} — click to select`}
              >
                {backdropClip && (
                  <video ref={backdropVideoRef} key={backdropClip.id} src={backdropClip.url} className="real-video-el" data-testid="canvas-backdrop-video" muted playsInline preload="auto" draggable={false}
                    style={{
                      position: "absolute", inset: 0, pointerEvents: "none", objectFit: "cover", transform: "scale(1.12)",
                      filter: `${getMediaFilter(backdropClip) ?? ""} blur(${previewBlurPx(canvasBox.w, canvasFormat.width)}px)`.trim(),
                    }} />
                )}
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
                    ...(backdropClip ? { position: "relative" as const } : {}),
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
                {blendPreview && blendOtherClip && (
                  <video ref={blendVideoRef} key={blendOtherClip.id} src={blendOtherClip.url} className="real-video-el" data-testid="dissolve-blend" muted playsInline preload="auto" draggable={false}
                    style={{
                      position: "absolute", inset: 0, pointerEvents: "none",
                      filter: getMediaFilter(blendOtherClip),
                      opacity: blendPreview.opacity,
                      ...(blendOtherClip.fitMode === "fill"
                        ? { objectFit: "cover", objectPosition: `${blendOtherClip.cropOffsetX ?? 50}% ${blendOtherClip.cropOffsetY ?? 50}%` }
                        : {}),
                    }} />
                )}
                {repositionClipId === activeVideoClip!.id && (
                  <div className="crop-reposition-hint" onClick={e => e.stopPropagation()}>
                    Drag the video to choose what's cropped
                    <button type="button" onClick={() => setRepositionClipId(null)}>Done</button>
                  </div>
                )}
                {behindLayer}
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
                {behindLayer}
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

          <TrackRow label="V1 Video" highlight={dragOverKind === "video"}
            onLaneDragOver={e => { if (detectDragKind(e) === "video") { e.preventDefault(); e.stopPropagation(); setDropActive(true); setDragOverKind("video"); } }}
            onLaneDragLeave={() => { setDropActive(false); setDragOverKind(null); }}
            onLaneDrop={handleDropOnV1Row}>
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

      {showProjectChooser && (
        <div className="draft-modal-overlay" onClick={() => setShowProjectChooser(false)}>
          <div className="draft-modal" onClick={e => e.stopPropagation()}>
            <h3>Open / Save Project</h3>
            <p className="empty-hint">Save your current video project or open a previously saved draft.</p>
            <div className="draft-modal-actions">
              <button type="button" onClick={() => setShowProjectChooser(false)}>Cancel</button>
              <button type="button" onClick={() => { setShowProjectChooser(false); void openMyDrafts(); }}>Open Saved Project</button>
              <button type="button" className="primary" onClick={() => { setShowProjectChooser(false); openSaveDraft(); }} disabled={draftBusy}>Save Current Project</button>
            </div>
          </div>
        </div>
      )}

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
