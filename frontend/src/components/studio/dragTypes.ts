// Shared contract between the Media Library (drag source) and the Timeline (drop target)
// for dragging an already-uploaded asset onto V1 Main Video. Kept in one place so both
// sides agree on the MIME key and payload shape.
export const MEDIA_ASSET_DRAG_TYPE = 'application/x-content-studio-media-asset'

export interface MediaAssetDragPayload {
  assetId: number
  url: string
  name: string
  mimeType: string
}
