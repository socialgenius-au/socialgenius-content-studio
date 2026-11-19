import type { CSSProperties } from 'react'
import PostRenderer from '../../post-creator-v2/canvas/PostRenderer'
import type { PostDocument } from '../../../lib/postDocument'
import { withMediaToken } from '../../../api/mediaAccess'

/**
 * One slide drawn at any size. The wrapper is the size container PostRenderer needs (its type is sized in container-query units of the canvas's shorter side), so a thumbnail and
 * the full editing canvas look identical. Pass `width` (px) for a fixed size, or let it fill its parent's width.
 */
export default function SlideView({ doc, pageId, width, className, style, testId }: { doc: PostDocument; pageId: string; width?: number; className?: string; style?: CSSProperties; testId?: string }) {
  const { width: fw, height: fh } = doc.format
  return (
    <div
      className={className}
      data-testid={testId}
      data-slide-id={pageId}
      style={{ position: 'relative', width: width ?? '100%', aspectRatio: `${fw} / ${fh}`, containerType: 'size', overflow: 'hidden', background: '#fff', ...style }}
    >
      <PostRenderer document={doc} pageId={pageId} resolveUrl={withMediaToken} />
    </div>
  )
}
