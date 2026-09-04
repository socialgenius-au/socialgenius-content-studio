// Shared contract between the Media Library (drag source) and the Timeline (drop target)
// for dragging an already-uploaded asset onto the correct track (V1 Video / A1 Audio / O1
// Overlay). Kept in one place so both sides agree on the MIME key and payload shape.
export const MEDIA_ASSET_DRAG_TYPE = 'application/x-content-studio-media-asset'

// Media-to-timeline routing requirement: `kind` says which track the asset can land on
// (video -> V1, audio -> A1, image -> O1 — see CreateEditTab's insert*At helpers). It's
// carried both in the JSON payload (read on drop, via getData) AND as its own registered
// MIME type `${MEDIA_ASSET_DRAG_TYPE}:${kind}` (see dragKindMimeType below) — dataTransfer's
// real payload is only readable via getData() on the actual 'drop' event, never during
// 'dragover' (a deliberate browser security restriction), but the *list* of registered types
// IS readable during dragover — so encoding kind into the type string itself is what lets the
// timeline highlight the one correct track while the drag is still in flight.
export type MediaAssetDragKind = 'video' | 'audio' | 'image'

export function dragKindMimeType(kind: MediaAssetDragKind): string {
  return `${MEDIA_ASSET_DRAG_TYPE}:${kind}`
}

export interface MediaAssetDragPayload {
  assetId: number
  url: string
  name: string
  mimeType: string
  kind: MediaAssetDragKind
}
