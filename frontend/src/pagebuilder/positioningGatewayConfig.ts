import { DEFAULT_ANIMATION, DEFAULT_IMAGE_PROPS, DEFAULT_TEXT_PROPS } from './types'
import type { ElementConfig, ImageProps, PageConfig, SectionConfig, TextProps } from './types'

/**
 * Social Genius gateway landing page — object/instance composition.
 *
 * IMPORTANT: this is intentionally NOT a flattened screenshot. Every visible item that a user may
 * reasonably want to edit is a real Page Builder object: logo, text, image, card/container, icon,
 * button and navigation. The reference artwork remains only a design reference asset.
 *
 * The same ElementConfig instances render in View Mode and Visual Editor mode, so an image selected
 * in Layers is the exact image shown to a visitor — it can be moved, resized, cropped, replaced and
 * tuned per breakpoint without rebuilding the page.
 */

let seq = 0
const id = (prefix: string) => `${prefix}-${++seq}`

function base(): Pick<ElementConfig,
  'x'|'y'|'width'|'height'|'zIndex'|'visible'|'locked'|'positionOverridden'|'sizeOverridden'|'responsive'|'animation'|'interactions'
> {
  return {
    x: 0, y: 0, width: 'auto', height: 'auto', zIndex: 1,
    visible: true, locked: false, positionOverridden: false, sizeOverridden: false,
    responsive: {}, animation: { ...DEFAULT_ANIMATION }, interactions: [],
  }
}

function text(name: string, content: string, className: string, opts: Partial<TextProps> = {}): ElementConfig {
  return { id: id('text'), type: 'text', parentId: null, name, className, ...base(), text: { ...DEFAULT_TEXT_PROPS, content, ...opts } }
}

function image(name: string, className: string, src: string | null, opts: Partial<ImageProps> = {}): ElementConfig {
  return {
    id: id('image'), type: 'image', parentId: null, name, className, ...base(),
    image: { ...DEFAULT_IMAGE_PROPS, src, ...opts },
  }
}

function button(name: string, label: string, className: string, href: string, variant: 'primary'|'secondary'|'link' = 'primary'): ElementConfig {
  return { id: id('button'), type: 'button', parentId: null, name, className, ...base(), button: { label, href, variant } }
}

function container(name: string, className: string, children: ElementConfig[]): ElementConfig {
  return { id: id('container'), type: 'container', parentId: null, name, className, ...base(), children }
}

function icon(name: string, glyph: string, className: string): ElementConfig {
  return { id: id('icon'), type: 'icon', parentId: null, name, className, ...base(), text: { ...DEFAULT_TEXT_PROPS, content: glyph } }
}

function navLink(label: string, href: string) {
  return button(`Nav — ${label}`, label, 'sgw-nav-link', href, 'link')
}

function feature(iconGlyph: string, label: string): ElementConfig {
  return container(`Feature — ${label}`, 'sgw-feature', [
    icon('Feature icon', iconGlyph, 'sgw-feature-icon'),
    text('Feature text', label, 'sgw-feature-text', { as: 'span' }),
  ])
}

function pillar(iconGlyph: string, title: string, copy: string): ElementConfig {
  return container(`Pillar — ${title}`, 'sgw-pillar', [
    icon(`${title} icon`, iconGlyph, 'sgw-pillar-icon'),
    text(`${title} title`, title, 'sgw-pillar-title', { as: 'h3' }),
    text(`${title} copy`, copy, 'sgw-pillar-copy', { as: 'p' }),
  ])
}

const nav: SectionConfig = {
  id: 'gateway-nav', name: 'Gateway Header', role: 'top-nav', layout: 'flow', className: 'sgw-header', sticky: 'sticky',
  elements: [
    container('Header inner', 'sgw-shell sgw-header-inner', [
      image('Official Social Genius Logo', 'sgw-logo', '/positioning-landing/social-genius-logo.png', {
        alt: 'Social Genius — The Positioning People', fit: 'contain', aspectRatioLocked: true,
      }),
      container('Navigation links', 'sgw-nav-links', [
        navLink('Home', '#gateway-hero'), navLink('About', '#gateway-perspective'), navLink('Solutions', '#gateway-options'),
        navLink('Success Stories', '#gateway-pillars'), navLink('Resources', '#gateway-footer'),
      ]),
      button('Contact CTA', 'Contact Us', 'sgw-contact-btn', 'mailto:hello@socialgenius.au?subject=Social%20Genius%20Enquiry', 'secondary'),
    ]),
  ],
}

const hero: SectionConfig = {
  id: 'gateway-hero', name: 'Gateway Hero', role: 'content', layout: 'flow', className: 'sgw-hero',
  backgroundLayer: {
    type: 'gradient',
    gradient: 'radial-gradient(circle at 70% 30%, rgba(43,92,111,.48), transparent 38%), linear-gradient(135deg,#061115 0%,#102b31 52%,#081114 100%)',
    opacity: 1,
  },
  elements: [
    container('Hero content', 'sgw-shell sgw-hero-inner', [
      text('Positioning eyebrow', 'POSITIONING IS EVERYTHING.™', 'sgw-eyebrow', { as: 'p' }),
      text('Hero headline', 'Every business has a next level.', 'sgw-title', { as: 'h1' }),
      text('Hero subheadline', 'Two ways to explore how Social Genius can help you go from invisible to unstoppable.', 'sgw-subtitle', { as: 'p' }),
    ]),
  ],
}

const options: SectionConfig = {
  id: 'gateway-options', name: 'Choose Your Path', role: 'content', layout: 'flow', className: 'sgw-options-section',
  elements: [
    container('Options grid', 'sgw-shell sgw-options-grid', [
      container('Website option card', 'sgw-choice-card sgw-choice-card--light', [
        text('Option label', 'OPTION 1', 'sgw-option-label', { as: 'p' }),
        text('Website card heading', 'Explore Our Website', 'sgw-card-title', { as: 'h2' }),
        text('Website card copy', 'Get a clear overview of what we do, our solutions, industries and success stories.', 'sgw-card-copy', { as: 'p' }),
        image('Website visual', 'sgw-card-image sgw-card-image--website', null, { alt: 'Social Genius website preview', fit: 'cover', borderRadius: 14 }),
        container('Website features', 'sgw-feature-list', [
          feature('book-open', 'Learn about our approach'),
          feature('settings', 'Explore solutions for your industry'),
          feature('users', 'See real client results'),
          feature('file-text', 'Get in touch when you’re ready'),
        ]),
        button('Enter Website', 'Enter Website →', 'sgw-card-button sgw-card-button--dark', '/positioning?website=1', 'primary'),
      ]),
      container('OR divider', 'sgw-or-wrap', [text('OR', 'OR', 'sgw-or', { as: 'span' })]),
      container('Experience option card', 'sgw-choice-card sgw-choice-card--dark', [
        text('Option label', 'OPTION 2', 'sgw-option-label', { as: 'p' }),
        text('Experience card heading', 'Experience a New Perspective', 'sgw-card-title sgw-card-title--dark', { as: 'h2' }),
        text('Experience card copy', 'Step into an immersive journey and discover your business position in a whole new way.', 'sgw-card-copy sgw-card-copy--dark', { as: 'p' }),
        image('Experience visual', 'sgw-card-image sgw-card-image--experience', null, { alt: 'New perspective experience', fit: 'cover', borderRadius: 14 }),
        container('Experience features', 'sgw-feature-list sgw-feature-list--dark', [
          feature('compass', 'A guided, visual journey'),
          feature('lightbulb', 'Understand your position differently'),
          feature('chart-no-axes-column-increasing', 'See new opportunities'),
          feature('gem', 'Be inspired for what’s possible'),
        ]),
        button('Enter Experience', 'Enter the Experience →', 'sgw-card-button sgw-card-button--green', '/positioning?experience=1', 'primary'),
      ]),
    ]),
  ],
}

const pillars: SectionConfig = {
  id: 'gateway-pillars', name: 'Positioning Pillars', role: 'content', layout: 'flow', className: 'sgw-pillars-section',
  elements: [
    container('Pillars grid', 'sgw-shell sgw-pillars-grid', [
      pillar('bar-chart-3', 'VISIBLE', 'Be found by the right people.'),
      pillar('shield-check', 'TRUSTED', 'Build credibility and reputation.'),
      pillar('users', 'CHOSEN', 'Turn interest into customers.'),
      pillar('compass', 'UNSTOPPABLE', 'Create long-term value.'),
    ]),
  ],
}

const perspective: SectionConfig = {
  id: 'gateway-perspective', name: 'Perspective Quote', role: 'content', layout: 'flow', className: 'sgw-perspective-section',
  elements: [
    container('Perspective content', 'sgw-shell sgw-perspective', [
      text('Perspective quote', '“A different perspective can change everything.”', 'sgw-quote', { as: 'p' }),
      container('Quote accent', 'sgw-quote-accent', []),
    ]),
  ],
}

const footer: SectionConfig = {
  id: 'gateway-footer', name: 'Gateway Footer', role: 'footer', layout: 'flow', className: 'sgw-footer',
  elements: [
    container('Footer content', 'sgw-shell sgw-footer-inner', [
      text('Footer left', 'BUSINESSES\nPEOPLE\nCOMMUNITIES', 'sgw-footer-side', { as: 'p' }),
      image('Footer Social Genius Logo', 'sgw-footer-logo', '/positioning-landing/social-genius-logo.png', { alt: 'Social Genius', fit: 'contain' }),
      text('Footer right', 'A BRIGHTER\nMORE MEANINGFUL\nTOMORROW', 'sgw-footer-side sgw-footer-side--right', { as: 'p' }),
    ]),
  ],
}

const floating: SectionConfig = {
  id: 'gateway-floating', name: 'Floating Actions', role: 'floating', layout: 'freeform', className: 'sgw-floating-layer',
  elements: [
    button('Floating Start Experience', 'Start the Experience ↗', 'sgw-floating-cta', '/positioning?experience=1', 'primary'),
    button('Back to Top', '↑', 'sgw-scroll-btn sgw-scroll-btn--top', '#gateway-hero', 'secondary'),
    button('Go to Bottom', '↓', 'sgw-scroll-btn sgw-scroll-btn--bottom', '#gateway-footer', 'secondary'),
  ],
}

export const positioningGatewayConfig: PageConfig = {
  id: 'positioning-gateway',
  name: 'Social Genius — Gateway Landing Page',
  sections: [nav, hero, options, pillars, perspective, footer, floating],
}
