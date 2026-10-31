import { DEFAULT_ANIMATION, DEFAULT_IMAGE_PROPS, DEFAULT_TEXT_PROPS } from './types'
import type {
  AnimationConfig, ElementConfig, ImageProps, PageConfig, SectionConfig, TextProps,
} from './types'

/**
 * The actual `/positioning` page, expressed as data instead of hard-coded JSX.
 *
 * SCOPE (disclosed, not hidden — see the session report): the Header and Hero are fully
 * atomized down to individual text/button/image elements (proving the "select the logo, move it,
 * resize it independently of the tagline" requirement exactly as the brief's own Section 7/33
 * examples describe). The Why-Positioning / Problem / Approach / Visible-Trusted-Chosen / CTA
 * sections are atomized at the SECTION-HEAD + CARD level (each heading, each stat/benefit card is
 * its own selectable, movable, resizable element) but their innermost icon+title+body triplets
 * are grouped one level up rather than split into three separate elements each — a first-pass
 * depth tradeoff, not a structural limitation (splitting further is adding more objects to this
 * same tree, not changing the model). The lead-capture form stays real, interactive React,
 * wired in via `custom: 'lead-capture-form'`.
 *
 * Every className below is copied verbatim from the current (not-yet-approved) PositioningLandingPage.css
 * so View Mode renders pixel-identical to what shipped in commit 41051be — this is a structural
 * migration, not a redesign (Section 28/35 of the brief).
 */

let n = 0
const uid = (prefix: string) => { n += 1; return `${prefix}-${n}` }

function baseDefaults(): Pick<
  ElementConfig,
  'x' | 'y' | 'width' | 'height' | 'zIndex' | 'visible' | 'locked' | 'positionOverridden' | 'sizeOverridden' | 'responsive' | 'animation' | 'interactions'
> {
  return {
    x: 0, y: 0, width: 'auto', height: 'auto', zIndex: 1,
    visible: true, locked: false, positionOverridden: false, sizeOverridden: false,
    responsive: {}, animation: { ...DEFAULT_ANIMATION }, interactions: [],
  }
}

function text(name: string, content: string, className: string, opts: Partial<TextProps> = {}, anim?: Partial<AnimationConfig>): ElementConfig {
  return {
    id: uid('text'), type: 'text', parentId: null, name, className,
    ...baseDefaults(),
    animation: anim ? { ...DEFAULT_ANIMATION, ...anim } : { ...DEFAULT_ANIMATION },
    text: { ...DEFAULT_TEXT_PROPS, content, ...opts },
  }
}

function button(name: string, label: string, className: string, href = '#', variant: 'primary' | 'secondary' | 'link' = 'primary', icon?: string): ElementConfig {
  return {
    id: uid('btn'), type: 'button', parentId: null, name, className,
    ...baseDefaults(),
    button: { label, href, variant, icon },
  }
}

function image(name: string, className: string, opts: Partial<ImageProps> = {}): ElementConfig {
  return {
    id: uid('img'), type: 'image', parentId: null, name, className,
    ...baseDefaults(),
    image: { ...DEFAULT_IMAGE_PROPS, ...opts },
  }
}

/** Pure decorative/atmospheric element (Section 9 — background, not editable-foreground content).
 * Renders nothing of its own; its className's existing CSS (e.g. a radial-gradient glow) is the
 * entire visual. Distinct from `image()`, which is a real content slot with a "no image set"
 * placeholder, replace/crop/fit controls, etc. */
function shape(name: string, className: string): ElementConfig {
  return { id: uid('shape'), type: 'shape', parentId: null, name, className, ...baseDefaults() }
}

function container(name: string, className: string, children: ElementConfig[]): ElementConfig {
  return {
    id: uid('box'), type: 'container', parentId: null, name, className,
    ...baseDefaults(),
    children,
  }
}

function badge(name: string, content: string, className: string): ElementConfig {
  return {
    id: uid('badge'), type: 'badge', parentId: null, name, className,
    ...baseDefaults(),
    text: { ...DEFAULT_TEXT_PROPS, content },
  }
}

function iconEl(name: string, iconName: string, className: string, size = 18): ElementConfig {
  return {
    id: uid('icon'), type: 'icon', parentId: null, name, className,
    ...baseDefaults(),
    width: size, height: size,
    text: { ...DEFAULT_TEXT_PROPS, content: iconName },
  }
}

/** One "icon + title + body" card, used by Why-Positioning / Problem stat lists (className
 * pl-stat-item) — kept as one container with three real children (icon, h3, p), each still
 * independently selectable/movable/resizable. */
function statItem(iconName: string, title: string, body: string): ElementConfig {
  return container(`Stat — ${title}`, 'pl-stat-item', [
    container('Icon badge', 'pl-stat-icon', [iconEl('Icon', iconName, '', 18)]),
    container('Stat body', 'pl-stat-body', [
      text('Title', title, '', { as: 'h3' }),
      text('Body', body, '', { as: 'p' }),
    ]),
  ])
}

function vtcCard(iconName: string, title: string, body: string): ElementConfig {
  return container(`Card — ${title}`, 'pl-vtc-card', [
    container('Icon badge', 'pl-vtc-icon', [iconEl('Icon', iconName, '', 22)]),
    text('Title', title, 'pl-vtc-title', { as: 'h3' }),
    text('Body', body, 'pl-vtc-text', { as: 'p' }),
  ])
}

function ctaPoint(iconName: string, body: string): ElementConfig {
  const el = container('CTA point', '', [
    iconEl('Check', iconName, '', 18),
    text('Point text', body, '', { as: 'span' }),
  ])
  el.tag = 'li'
  return el
}

// ------------------------------------------------------------------------------- NAV / HEADER --
const navSection: SectionConfig = {
  id: 'nav', name: 'Top Navigation', role: 'top-nav', layout: 'flow', className: 'pl-nav',
  elements: [
    container('Nav Inner', 'pl-container pl-nav-inner', [
      container('Brand Group', 'pl-brand', [
        // Independent from Brand Name/Tagline per the brief's own Section 7 — no logo artwork
        // exists yet, so this stays hidden by default (zero visual change to the shipped page)
        // but is fully present, selectable, and editable: once a real logo file is supplied,
        // toggling it visible and dropping the image in is all that's needed, no rebuild.
        (() => { const el = image('Logo', 'pl-logo', { alt: 'Social Genius logo' }); el.visible = false; el.width = 36; el.height = 36; return el })(),
        text('Brand Name', 'Social Genius', 'pl-brand-name'),
        text('Tagline', 'The Positioning People', 'pl-brand-tag'),
      ]),
      button('Nav CTA', 'Start Your Audit', 'pl-nav-cta', '#positioning-audit', 'secondary', 'arrow-right'),
    ]),
  ],
}

// ------------------------------------------------------------------------------------- HERO ----
const heroSection: SectionConfig = {
  id: 'hero', name: 'Hero', role: 'content', layout: 'flow', className: 'pl-hero',
  elements: [
    shape('Hero Glow', 'pl-hero-glow'),
    container('Hero Inner', 'pl-container pl-hero-inner', [
      container('Hero Left', '', [
        text('Eyebrow', 'Positioning is Everything', 'pl-eyebrow'),
        text('Headline', 'BE SEEN. BE TRUSTED. BE CHOSEN.', 'pl-h1', { as: 'h1' }, { preset: 'fade-in', trigger: 'page-load', durationMs: 700 }),
        text('Subhead', 'Before you spend more on content, get your positioning right. Great content aimed at the wrong position just gets you seen faster — by the wrong people, for the wrong reasons.', 'pl-subhead', { as: 'p' }),
        container('CTA Row', 'pl-cta-row', [
          button('Primary CTA', 'Start Your Positioning Audit', 'pl-btn-primary', '#positioning-audit', 'primary', 'arrow-right'),
          button('Secondary Link', 'See why positioning comes first', 'pl-link-secondary', '#why-positioning', 'link'),
        ]),
      ]),
      container('Hero Promise Card', 'pl-hero-card', [
        text('Promise Label', 'Our Promise', 'pl-hero-card-label'),
        text('Promise Text', 'We make you Visible, Trusted and Chosen.', 'pl-hero-card-text'),
      ]),
    ]),
  ],
}

// ---------------------------------------------------------------------------- WHY POSITIONING --
const whyPositioningSection: SectionConfig = {
  id: 'why-positioning', name: 'Why Positioning Matters', role: 'content', layout: 'flow', className: 'pl-section',
  elements: [
    container('Section Body', 'pl-container pl-two-col', [
      container('Section Head', 'pl-section-head', [
        text('Kicker', 'Why Positioning Matters', 'pl-kicker'),
        text('Heading', 'Content works only when people already know why you’re the one to choose.', 'pl-h2', { as: 'h2' }),
        text('Lede', 'Positioning is the answer to one question, decided before a single post goes out: why should the right person choose you over every other option in front of them? Get that answer right, and everything you create afterwards — your content, your ads, your sales conversations — does more with less.', 'pl-lede', { as: 'p' }),
      ]),
      container('Stat List', 'pl-stat-list', [
        statItem('eye', 'It’s the filter everything else passes through', 'Your offer, your messaging, your visuals — all of it either reinforces a clear position or quietly dilutes it.'),
        statItem('compass', 'It’s decided once, then defended everywhere', 'A strong position doesn’t change every campaign — it gives every campaign a reason to exist.'),
        statItem('award', 'It’s what makes "choosing you" feel obvious', 'Customers rarely compare on every feature. They compare on who feels like the safe, right choice.'),
      ]),
    ]),
  ],
}

// -------------------------------------------------------------------------------- THE PROBLEM --
const problemSection: SectionConfig = {
  id: 'problem', name: 'The Problem', role: 'content', layout: 'flow', className: 'pl-section pl-section-alt',
  elements: [
    container('Section Body', 'pl-container', [
      container('Section Head', 'pl-section-head', [
        text('Kicker', 'The Problem', 'pl-kicker'),
        text('Heading', 'Spending on content before positioning is spending to blend in faster.', 'pl-h2', { as: 'h2' }),
        text('Lede', 'More videos, more posts, more ad spend — without a clear position behind it, all of that effort just makes an unclear message louder. It doesn’t make you more visible in the way that matters; it makes you easier to scroll past.', 'pl-lede', { as: 'p' }),
      ]),
      container('Two Column', 'pl-two-col', [
        container('Column A', 'pl-stat-list', [
          statItem('trending-down', 'Content spend with no compounding return', 'Every piece starts from zero because nothing is building toward a single, recognisable position.'),
          statItem('layers', 'Messaging that changes every campaign', 'Without a fixed position, every new campaign reinvents what you stand for — and customers never get to know it.'),
        ]),
        container('Column B', 'pl-stat-list', [
          statItem('megaphone', 'Louder, not clearer', 'More volume rarely fixes an unclear message — it just puts the same confusion in front of more people.'),
          statItem('shield-check', 'Trust that never quite builds', 'People trust a position they recognise. If it shifts every month, there’s nothing consistent enough to trust.'),
        ]),
      ]),
    ]),
  ],
}

// ------------------------------------------------------------------------------------ QUOTE ----
const quoteSection: SectionConfig = {
  id: 'quote', name: 'Quote', role: 'content', layout: 'flow', className: 'pl-section',
  elements: [
    container('Quote Body', 'pl-container pl-quote', [
      text('Quote Mark', '“', 'pl-quote-mark'),
      text('Quote Text', 'Positioning is Everything.', 'pl-quote-text', { as: 'p' }, { preset: 'fade-in', trigger: 'viewport-enter', durationMs: 800 }),
    ]),
  ],
}

// --------------------------------------------------------------------------------- APPROACH ----
const approachSection: SectionConfig = {
  id: 'approach', name: 'Our Approach', role: 'content', layout: 'flow', className: 'pl-section pl-section-alt',
  elements: [
    container('Section Body', 'pl-container', [
      container('Section Head', 'pl-section-head', [
        text('Kicker', 'Our Approach', 'pl-kicker'),
        text('Heading', 'We start with your position — not your next post.', 'pl-h2', { as: 'h2' }),
        text('Lede', 'Before we produce anything, we run a Positioning Audit: a clear-eyed look at how you’re currently seen, how your category expects you to sound, and where a real, defensible position for you actually sits. Everything we build afterwards is aimed at that one position — deliberately, not by accident.', 'pl-lede', { as: 'p' }),
      ]),
    ]),
  ],
}

// -------------------------------------------------------------------------------------- VTC ----
const vtcSection: SectionConfig = {
  id: 'vtc', name: 'Visible / Trusted / Chosen', role: 'content', layout: 'flow', className: 'pl-section',
  elements: [
    container('Section Body', 'pl-container', [
      container('Section Head', 'pl-section-head', [
        text('Kicker', 'The Outcome', 'pl-kicker'),
        text('Heading', 'Visible, Trusted and Chosen — in that order.', 'pl-h2', { as: 'h2' }),
        text('Lede', 'Each one depends on the one before it. Skip a step, and the next one gets harder to earn.', 'pl-lede', { as: 'p' }),
      ]),
      container('VTC Grid', 'pl-vtc-grid', [
        vtcCard('eye', 'Be Seen', 'Show up in front of the right people, saying something specific enough to actually register — not another version of what every competitor is already saying.'),
        vtcCard('shield-check', 'Be Trusted', 'A consistent, credible position — held over time — is what turns attention into confidence. Trust is built by repetition of something clear, not by novelty.'),
        vtcCard('award', 'Be Chosen', 'When the moment to decide arrives, a clear position removes the doubt that keeps people comparing — and makes choosing you feel like the obvious call.'),
      ]),
    ]),
  ],
}

// --------------------------------------------------------------------------------------- CTA ----
const ctaSection: SectionConfig = {
  id: 'positioning-audit', name: 'Get Started (CTA)', role: 'content', layout: 'flow', className: 'pl-cta-section',
  elements: [
    container('CTA Grid', 'pl-container pl-cta-grid', [
      container('CTA Copy', '', [
        text('Kicker', 'Get Started', 'pl-kicker'),
        text('Heading', 'Get your positioning right — before your next piece of content.', 'pl-h2', { as: 'h2' }),
        text('Lede', 'A Positioning Audit tells you, plainly, where you stand today and what’s standing between you and being Seen, Trusted and Chosen. No jargon, no lock-in — just clarity you can act on.', 'pl-lede', { as: 'p' }),
        (() => {
          const list = container('CTA Points', 'pl-cta-points', [
            ctaPoint('check-circle', 'A clear view of how you’re currently positioned in your category'),
            ctaPoint('check-circle', 'Where your current content is (and isn’t) reinforcing that position'),
            ctaPoint('check-circle', 'A concrete next step — with or without working with us afterwards'),
          ])
          list.tag = 'ul'
          return list
        })(),
      ]),
      { id: uid('form'), type: 'card', parentId: null, name: 'Lead Capture Form', custom: 'lead-capture-form', ...baseDefaults() },
    ]),
  ],
}

// ------------------------------------------------------------------------------------ FOOTER ----
const footerSection: SectionConfig = {
  id: 'footer', name: 'Footer', role: 'footer', layout: 'flow', className: 'pl-footer',
  elements: [
    container('Footer Inner', 'pl-container pl-footer-inner', [
      container('Footer Brand Line', 'pl-footer-tag', [
        text('Brand word', 'Social Genius', 'pl-footer-brand', { as: 'span' }),
        text('Rest of line', ' — The Positioning People', '', { as: 'span' }),
      ]),
      text('Footer Tagline', 'Positioning is Everything.', 'pl-footer-tag'),
    ]),
  ],
}

export const positioningPageConfig: PageConfig = {
  id: 'positioning',
  name: 'Social Genius — Positioning',
  sections: [
    navSection, heroSection, whyPositioningSection, problemSection, quoteSection,
    approachSection, vtcSection, ctaSection, footerSection,
  ],
}
