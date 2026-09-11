import { useRef, type CSSProperties } from 'react'
import { usePageBuilder } from './PageBuilderContext'
import { EditableWrapper } from './EditableWrapper'
import { useElementAnimation } from './AnimationPresets'
import type { ElementConfig } from './types'
import { Icon } from './icons'
import { LeadCaptureForm } from './LeadCaptureForm'

/** Merges an element's base box-model fields with its active-breakpoint override (Section 12).
 *
 * BUG FIX (responsive-architecture audit): this previously fell through an UNSET tablet/mobile
 * override straight to the DESKTOP base value and then applied it as a real position/size
 * override regardless — i.e. "no mobile override" silently meant "reuse the desktop pixels
 * anyway," which is exactly backwards from the required behaviour ("absence of a mobile override
 * must NOT mean reuse desktop pixels blindly — it should mean participate in the responsive
 * parent layout"). `positionActive`/`sizeActive` now say explicitly, per breakpoint, whether an
 * override genuinely exists to apply: on desktop that's the element's own overridden flags; on
 * tablet/mobile it's "does THIS breakpoint's own override dict actually define x/y (or width/
 * height)" — never inherited from desktop. boxStyle() below only ever reads resolved.x/y/width/
 * height when the matching *Active flag is true. */
function useResolvedBox(element: ElementConfig) {
  const { breakpoint } = usePageBuilder()
  const isDesktop = breakpoint === 'desktop'
  const override = isDesktop ? undefined : element.responsive[breakpoint]
  return {
    x: isDesktop ? element.x : (override?.x ?? element.x),
    y: isDesktop ? element.y : (override?.y ?? element.y),
    width: isDesktop ? element.width : (override?.width ?? element.width),
    height: isDesktop ? element.height : (override?.height ?? element.height),
    visible: override?.visible ?? element.visible,
    align: override?.align,
    fontSizePx: override?.fontSizePx,
    positionActive: isDesktop ? element.positionOverridden : (override?.x !== undefined || override?.y !== undefined),
    sizeActive: isDesktop ? element.sizeOverridden : (override?.width !== undefined || override?.height !== undefined),
  }
}

function boxStyle(element: ElementConfig, resolved: ReturnType<typeof useResolvedBox>): CSSProperties {
  const style: CSSProperties = {
    zIndex: element.zIndex,
    background: element.background,
    padding: element.padding,
    margin: element.margin,
    overflow: element.overflow,
  }
  if (element.opacity !== undefined) style.opacity = element.opacity
  if (element.border !== undefined) style.border = element.border
  if (element.borderRadius !== undefined) style.borderRadius = element.borderRadius
  // Deliberate v1 rule (see types.ts docstring): only apply explicit position/size once the
  // element has actually been dragged/resized AT THE CURRENT BREAKPOINT — otherwise the page's own
  // normal-flow (now container-query-aware) CSS decides, so VIEW MODE looks exactly like today's
  // design until someone edits something, at every breakpoint independently.
  if (resolved.positionActive) {
    style.position = 'relative'
    style.left = resolved.x
    style.top = resolved.y
  }
  if (resolved.sizeActive) {
    if (typeof resolved.width === 'number') style.width = resolved.width
    if (typeof resolved.height === 'number') style.height = resolved.height
  }
  if (element.minWidth) style.minWidth = element.minWidth
  if (element.minHeight) style.minHeight = element.minHeight
  if (element.maxWidth) style.maxWidth = element.maxWidth
  if (element.maxHeight) style.maxHeight = element.maxHeight
  return style
}

function ImageContent({ element }: { element: ElementConfig }) {
  const { mode, updateElement } = usePageBuilder()
  const img = element.image!
  const fileInputRef = useRef<HTMLInputElement>(null)

  const frameStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: typeof element.height === 'number' ? '100%' : 220,
    overflow: 'hidden',
    borderRadius: img.borderRadius,
    background: img.src ? undefined : 'repeating-linear-gradient(45deg, rgba(0,0,0,0.04), rgba(0,0,0,0.04) 10px, rgba(0,0,0,0.02) 10px, rgba(0,0,0,0.02) 20px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  const handleReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    updateElement(element.id, { image: { ...img, src: url } })
  }

  return (
    <div style={frameStyle}>
      {img.src ? (
        <img
          src={img.src}
          alt={img.alt}
          style={{
            width: `${100 * img.zoom}%`,
            height: `${100 * img.zoom}%`,
            objectFit: img.fit,
            objectPosition: `${img.focalX}% ${img.focalY}%`,
            opacity: img.opacity,
            transform: `rotate(${img.rotationDeg}deg)`,
            clipPath: `inset(${img.crop.top}% ${img.crop.right}% ${img.crop.bottom}% ${img.crop.left}%)`,
          }}
        />
      ) : mode === 'edit' ? (
        // "No image set" is an EDITOR affordance only — a real visitor in View Mode must never
        // see empty-state placeholder chrome (Section 2: the two modes stay genuinely separate).
        <span style={{ fontSize: 12, color: 'var(--pb-muted, #8a8a80)' }}>No image set</span>
      ) : null}
      {mode === 'edit' && (
        <>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleReplace} />
          <button
            className="pb-image-replace-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
          >
            {img.src ? 'Replace' : 'Add image'}
          </button>
        </>
      )}
    </div>
  )
}

/** Only fields the user has actually edited become inline styles — see the TextProps docstring
 * in types.ts for why an unconditional style object would silently break the existing CSS. */
function textStyle(t: NonNullable<ElementConfig['text']>, resolved: ReturnType<typeof useResolvedBox>): CSSProperties {
  const style: CSSProperties = { margin: 0 }
  const fontSize = resolved.fontSizePx ?? t.fontSizePx
  if (fontSize !== undefined) style.fontSize = fontSize
  if (t.fontWeight !== undefined) style.fontWeight = t.fontWeight
  if (t.lineHeight !== undefined) style.lineHeight = t.lineHeight
  if (t.letterSpacingPx !== undefined) style.letterSpacing = t.letterSpacingPx
  const align = resolved.align ?? t.align
  if (align !== undefined) style.textAlign = align
  if (t.color !== undefined) style.color = t.color
  if (t.background !== undefined) style.background = t.background
  if (t.fontFamily !== undefined) style.fontFamily = t.fontFamily
  return style
}

function ElementContent({ element }: { element: ElementConfig }) {
  const resolved = useResolvedBox(element)

  switch (element.type) {
    case 'text': {
      const t = element.text!
      const Tag = t.as as keyof JSX.IntrinsicElements
      return <Tag className={element.className} style={textStyle(t, resolved)}>{t.content}</Tag>
    }
    case 'image':
      return <ImageContent element={element} />
    case 'button': {
      const b = element.button!
      const cls = element.className ?? (b.variant === 'primary' ? 'pl-btn-primary' : b.variant === 'secondary' ? 'pl-nav-cta' : 'pl-link-secondary')
      // Style overrides go directly on the <a>, not the wrapper — the class already paints an
      // opaque background/border-radius here, so a wrapper-level override would sit invisibly
      // underneath it (see ButtonProps' own docstring in types.ts).
      const btnStyle: CSSProperties = {}
      if (b.background !== undefined) btnStyle.background = b.background
      if (b.color !== undefined) btnStyle.color = b.color
      if (b.borderRadius !== undefined) btnStyle.borderRadius = b.borderRadius
      return (
        <a className={cls} href={b.href ?? '#'} style={Object.keys(btnStyle).length ? btnStyle : undefined}>
          {b.label}
          {b.icon && <Icon name={b.icon} size={16} />}
        </a>
      )
    }
    case 'icon':
      return <Icon name={element.text?.content ?? 'circle'} size={typeof element.width === 'number' ? element.width : 20} />
    case 'divider':
      return <hr className={element.className} style={{ border: 0, borderTop: '1px solid var(--pb-hairline, rgba(0,0,0,0.1))', width: '100%' }} />
    case 'shape':
      // Pure decorative/atmospheric background (Section 9 of the brief — a glow, gradient,
      // texture) — its own className/CSS supplies the entire visual (e.g. .pl-hero-glow's radial
      // gradient), so this renders NO content of its own. Unlike `image`, a shape never shows a
      // "no image set" placeholder — an empty decorative element isn't missing content, it just is
      // what it is.
      return <div className={element.className} aria-hidden="true" />
    case 'badge':
      return <span className={element.className ?? 'pb-badge'}>{element.text?.content}</span>
    case 'container':
    case 'card':
    case 'navigation': {
      if (element.custom === 'lead-capture-form') return <LeadCaptureForm />
      const Tag = (element.tag ?? 'div') as 'div' | 'ul' | 'li'
      // Container style overrides (Visual Editor V1) go directly on this Tag, not the outer
      // wrapper -- for a container like `.pl-hero-card` the CLASS itself paints the visible box
      // (background, radius), so a wrapper-level override one DOM level up would sit invisibly
      // underneath it (same reasoning as the button fix above).
      const boxOverride: CSSProperties = {}
      if (element.background !== undefined) boxOverride.background = element.background
      if (element.opacity !== undefined) boxOverride.opacity = element.opacity
      if (element.border !== undefined) boxOverride.border = element.border
      if (element.borderRadius !== undefined) boxOverride.borderRadius = element.borderRadius
      return (
        <Tag className={element.className} style={Object.keys(boxOverride).length ? boxOverride : undefined}>
          {element.children?.map(child => <RenderElement key={child.id} element={child} />)}
        </Tag>
      )
    }
    default:
      return null
  }
}

export function RenderElement({ element }: { element: ElementConfig }) {
  const { mode, selectedId } = usePageBuilder()
  const resolved = useResolvedBox(element)
  const ref = useRef<HTMLDivElement>(null)
  const { style: animStyle, handlers, isWired } = useElementAnimation(ref, element.animation, mode === 'edit')

  if (!resolved.visible && mode !== 'edit') return null

  // Breakpoint-aware (see useResolvedBox's own bug-fix docstring): whether an override is
  // "active" now depends on the CURRENT breakpoint, not just "was this ever edited on desktop" —
  // an element edited only at desktop takes the zero-wrapper fast path again at mobile if mobile
  // has no override of its own, exactly the "participate in the responsive parent layout" rule.
  // Container/Card style overrides (Visual Editor V1) live on the WRAPPER via boxStyle(), so they
  // must also force the wrapper to render in View Mode -- otherwise a background/opacity/border/
  // radius edit would work in the editor (which always renders the wrapper) and silently vanish
  // for a real visitor (the exact "control that doesn't actually work" the brief forbids).
  const hasStyleOverride = element.background !== undefined || element.opacity !== undefined
    || element.border !== undefined || element.borderRadius !== undefined
  const hasOverride = resolved.positionActive || resolved.sizeActive || hasStyleOverride
  const animationActive = isWired && element.animation.preset !== 'none'

  // Nothing edited, no animation, not in Edit Mode: render with ZERO extra DOM wrapper, so the
  // existing page's grid/flex direct-child CSS (e.g. .pl-hero-inner's two-column grid) sees
  // exactly the same child structure it always has — this is what keeps View Mode visually
  // identical to today's page until something is actually edited (see types.ts's own docstring).
  if (mode === 'view' && !hasOverride && !animationActive) {
    return <ElementContent element={element} />
  }

  const wrapperStyle: CSSProperties = {
    ...boxStyle(element, resolved),
    ...animStyle,
    opacity: !resolved.visible && mode === 'edit'
      ? 0.35
      : (animStyle.opacity as number | undefined),
  }

  return (
    <div ref={ref} style={wrapperStyle} {...handlers}>
      <EditableWrapper element={element} editMode={mode === 'edit'} selected={selectedId === element.id}>
        <ElementContent element={element} />
      </EditableWrapper>
    </div>
  )
}
