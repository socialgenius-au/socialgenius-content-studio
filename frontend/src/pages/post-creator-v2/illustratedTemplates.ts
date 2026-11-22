import type { Background, DocumentFormat, ImageElement, PostDocument, PostElement, PostPage, TextStyle } from '../../lib/postDocument'
import { makeImage, makeShape, makeText, newSlide } from '../../lib/carousel/ops'
import { customFormat } from '../../lib/carousel/formats'

const art = '/post-creator-v2/art/'
export const postBrandMark = art + 'gold-tree.svg'
export const starterFormat: DocumentFormat = customFormat(1080, 1010)
const gold = '#ffda00'
const white = '#ffffff'

export const illustratedTemplates = [
  { id: 'growth', name: 'Grow your business', category: 'Business' },
  { id: 'ai', name: 'AI Automation', category: 'Business' },
  { id: 'position', name: 'Positioning & Strategy', category: 'Marketing' },
  { id: 'mentor', name: 'Mentoring & Coaching', category: 'Education' },
  { id: 'people', name: 'The Positioning People', category: 'Business' },
  { id: 'content', name: 'Content That Converts', category: 'Marketing' },
] as const

type TemplateId = typeof illustratedTemplates[number]['id']

const gradient = (first: string, last: string, angle = 145): Background => ({
  kind: 'gradient', angle, stops: [{ offset: 0, color: first }, { offset: 1, color: last }],
})

export function illustratedPage(id: TemplateId, format: DocumentFormat): PostPage {
  const text = (content: string, x: number, y: number, width: number, fontSize: number, style: Partial<TextStyle> = {}) =>
    makeText(format, { name: content.replace(/\n/g, ' '), content, x, y, width,
      style: { fontFamily: 'Arial, sans-serif', fontSize, fontWeight: 800, lineHeight: .94, align: 'left', color: white, ...style } })
  const image = (file: string, name: string, x: number, y: number, width: number, height: number, options: Partial<ImageElement> = {}) =>
    makeImage({ name, alt: name, x, y, width, height, fit: 'contain', source: { kind: 'asset', url: art + file }, ...options })

  let background: Background
  let layers: PostElement[]
  switch (id) {
    case 'growth':
      background = { kind: 'image', source: { kind: 'asset', url: art + 'glow.svg' }, fit: 'cover' }
      layers = [
        image('gold-tree.svg', 'Social Genius tree', .052, .022, .127, .133),
        text('Social Genius', .2, .045, .51, .055, { letterSpacing: -.0025 }),
        text('The Positioning People', .2, .105, .46, .032, { color: gold, letterSpacing: -.0015 }),
        text('GROW\nYOUR\nBUSINESS', .055, .218, .495, .101, { fontWeight: 900, letterSpacing: -.005 }),
        text('WITH', .055, .490, .45, .079, { fontWeight: 900, letterSpacing: -.003 }),
        { ...text('SOCIAL GENIUS', .055, .558, .49, .092, { color: gold, fontFamily: 'Barlow Condensed, Arial, sans-serif', fontWeight: 700, letterSpacing: -.0015 }), maxLines: 1 },
        image('portrait.webp', 'Business portrait', .552, .092, .43, .635, { fit: 'cover', zoom: 1.4, focal: { x: .5, y: .36 } }),
        image('ribbon.svg', 'Gold ribbon', 0, .476, 1, .396, { fit: 'cover', locked: true }),
        ...[
          { x: .092, icon: 'gear.svg', label: 'Automate\nYour Operations' },
          { x: .382, icon: 'target.svg', label: 'Position\nYour Business' },
          { x: .668, icon: 'growth-chart.svg', label: 'Grow\nWith Coaching' },
        ].flatMap(({ x, icon, label }) => [
          image(icon, label.split('\n')[0] + ' icon', x + .105, .78, .074, .078),
          text(label, x, .875, .284, .034, { align: 'center', lineHeight: 1.16, letterSpacing: -.001 }),
        ]),
        ...[.385, .667].map(x => makeShape({ name: 'Divider', x, y: .797, width: .002, height: .154, fill: white })),
      ]
      break
    case 'ai':
      background = gradient('#020917', '#082355')
      layers = [image('chip.svg', 'AI processor', .52, .31, .49, .63),
        text('AI', .09, .12, .55, .2), text('AUTOMATION', .09, .34, .88, .102),
        text('FOR', .09, .49, .55, .092, { color: '#47e7ed', fontWeight: 400 }),
        text('BUSINESS', .09, .63, .7, .10)]
      break
    case 'position':
      background = gradient('#101b29', '#251129')
      layers = [image('ribbon.svg', 'Gold ribbon', 0, .62, 1, .38, { fit: 'cover' }),
        image('target.svg', 'Bullseye', .54, .17, .46, .76),
        text('POSITIONING', .07, .17, .9, .117), text('THAT\nGETS YOU\nCLIENTS', .07, .34, .60, .109, { lineHeight: 1.08 })]
      break
    case 'mentor':
      background = gradient('#031a2a', '#ec9c18', 167)
      layers = [image('coach.svg', 'Climbers', .25, .25, .77, .76, { fit: 'cover' }),
        text('MENTORING\n& COACHING', .09, .20, .85, .114, { lineHeight: 1.15 })]
      break
    case 'people':
      background = gradient('#2a1a0d', '#121117')
      layers = [image('gold-tree.svg', 'Social Genius tree', .38, .11, .24, .29),
        text('THE', 0, .43, 1, .09, { align: 'center' }),
        text('POSITIONING', 0, .55, 1, .124, { align: 'center', color: gold }),
        text('PEOPLE', 0, .71, 1, .125, { align: 'center' })]
      break
    case 'content':
      background = gradient('#031322', '#271649')
      layers = [image('laptop.svg', 'Video on laptop', .40, .43, .58, .59),
        text('CONTENT\nTHAT\nCONVERTS', .09, .16, .85, .116, { lineHeight: 1.13 })]
  }
  return newSlide(background, layers, illustratedTemplates.find(t => t.id === id)?.name)
}

export function withIllustratedStarter(doc: PostDocument): PostDocument {
  const format = starterFormat
  return { ...doc, format, pages: illustratedTemplates.slice(0, 4).map(t => illustratedPage(t.id, format)) }
}
