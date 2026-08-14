import { useEffect, useState } from 'react'
import { ImageOff, Upload } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingState } from '@/components/common/LoadingState'
import { EmptyState } from '@/components/common/EmptyState'
import { EditableField } from '@/components/common/EditableField'
import { EditableTagList } from '@/components/common/EditableTagList'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { brandKitService } from '@/services/brandKitService'
import { CHANNEL_APPLICATIONS, type BrandKit, type ChannelApplication } from '@/types/domain'

const stripEnd = (s: string) => s.replace(/[.\s]+$/, '')

function channelBlurb(kit: BrandKit, channel: ChannelApplication): string {
  const primary = kit.visual.colors[0]?.label
  const cta = kit.content.ctaPatterns[0]
  const tone = stripEnd(kit.voice.tone)
  const imageStyle = stripEnd(kit.visual.imageStyle)
  const videoStyle = stripEnd(kit.visual.videoStyle)
  const ctaStyle = stripEnd(kit.voice.ctaStyle)
  if (!primary && !kit.voice.tone) return 'Not yet defined for this client.'
  switch (channel) {
    case 'Letterhead':
      return `${primary ?? 'Primary colour'} header/footer bar, logo top-left, ${kit.voice.formality || 'brand tone'} throughout.`
    case 'Email':
      return `${primary ?? 'Primary colour'} accent header, sign-off in ${tone || 'brand tone'}, CTA styled as "${cta ?? 'brand CTA'}".`
    case 'WhatsApp':
      return `Short, ${kit.voice.sentenceStyle || 'brand-appropriate'} messages. CTA pattern: "${cta ?? '—'}". No emoji unless client-approved.`
    case 'WhatsApp Status':
      return `Vertical 9:16 crop of the latest proof-point graphic, ${primary ?? 'primary'} accent, 24h shelf life.`
    case 'Social posts':
      return `${imageStyle || 'Brand-approved imagery'}. Caption in ${tone || 'brand tone'}. Mandatory inclusions applied.`
    case 'Reels':
      return `${videoStyle || 'Brand video style'}. Hook in first 2s. CTA "${cta ?? '—'}" as on-screen text + caption.`
    case 'Stories':
      return `Full-bleed vertical, ${primary ?? 'primary'} sticker accents, link sticker to top CTA.`
    case 'Thumbnails':
      return kit.visual.thumbnailStyle || 'Not yet defined for this client.'
    case 'Blogs':
      return `${kit.voice.formality || 'Brand tone'}, long-form. Mandatory inclusions placed in the closing paragraph.`
    case 'Reports':
      return `${primary ?? 'Primary'} cover page, Inter typography, client-facing tone — no internal jargon.`
    case 'Presentations':
      return `Brand deck theme, one proof point per slide (${kit.commercial.proof.length || 0} available).`
    case 'Proposals':
      return `Formal register. Guarantees stated explicitly. Certifications listed on the cover page.`
    case 'Business cards':
      return `${primary ?? 'Primary'} background or reverse, logo + handle "${kit.content.handles[0] ?? '—'}".`
    case 'Exhibition materials':
      return `Large-format hero image (${imageStyle || 'brand imagery'}), headline in ${ctaStyle || 'brand CTA style'}.`
    default:
      return 'Not yet defined for this client.'
  }
}

export default function BrandKitPage() {
  const { client, loading: clientLoading } = useClient()
  useAICompanionContext(`Brand Kit • ${client?.name ?? '…'}`)

  const [kit, setKit] = useState<BrandKit | null | undefined>(undefined)

  useEffect(() => {
    if (!client) return
    setKit(undefined)
    brandKitService.get(client.id).then(k => setKit(k ?? null))
  }, [client])

  if (clientLoading || !client || kit === undefined) return <LoadingState rows={5} />
  if (!kit) return <EmptyState title="No brand kit yet" description="Set one up once onboarding is complete." />

  const setVisual = (patch: Partial<BrandKit['visual']>) => setKit({ ...kit, visual: { ...kit.visual, ...patch } })
  const setVoice = (patch: Partial<BrandKit['voice']>) => setKit({ ...kit, voice: { ...kit.voice, ...patch } })
  const setCommercial = (patch: Partial<BrandKit['commercial']>) => setKit({ ...kit, commercial: { ...kit.commercial, ...patch } })
  const setContent = (patch: Partial<BrandKit['content']>) => setKit({ ...kit, content: { ...kit.content, ...patch } })

  const VISUAL_STYLE_FIELDS: { label: string; key: keyof BrandKit['visual'] }[] = [
    { label: 'Fonts', key: 'fonts' }, { label: 'Logo style', key: 'logoStyle' }, { label: 'Image style', key: 'imageStyle' },
    { label: 'Video style', key: 'videoStyle' }, { label: 'Thumbnail style', key: 'thumbnailStyle' }, { label: 'Intro', key: 'intro' },
    { label: 'Outro', key: 'outro' }, { label: 'Lower third', key: 'lowerThird' }, { label: 'Watermark', key: 'watermark' },
  ]
  const VOICE_TEXT_FIELDS: { label: string; key: keyof BrandKit['voice']; multiline?: boolean }[] = [
    { label: 'Tone', key: 'tone' }, { label: 'Formality', key: 'formality' }, { label: 'Humour', key: 'humour' },
    { label: 'Brand personality', key: 'personality', multiline: true }, { label: 'CTA style', key: 'ctaStyle' }, { label: 'Sentence style', key: 'sentenceStyle' },
  ]
  const COMMERCIAL_FIELDS: { label: string; key: keyof BrandKit['commercial'] }[] = [
    { label: 'Services / products', key: 'services' }, { label: 'Offers', key: 'offers' },
    { label: 'Target audiences', key: 'targetAudiences' }, { label: 'Locations', key: 'locations' },
    { label: 'Differentiators', key: 'differentiators' }, { label: 'Proof', key: 'proof' },
    { label: 'Certifications', key: 'certifications' }, { label: 'Testimonials', key: 'testimonials' }, { label: 'Guarantees', key: 'guarantees' },
  ]
  const CONTENT_FIELDS: { label: string; key: keyof BrandKit['content'] }[] = [
    { label: 'Hashtags', key: 'hashtags' }, { label: 'CTA patterns', key: 'ctaPatterns' }, { label: 'Handles', key: 'handles' },
    { label: 'Links', key: 'links' }, { label: 'Disclaimers', key: 'disclaimers' }, { label: 'Mandatory inclusions', key: 'mandatoryInclusions' },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Brand Kit — ${client.name}`}
        description="The foundation every other module pulls from: visual identity, voice, commercial facts, content rules, and channel applications. Click any field to edit."
      />

      <Tabs defaultValue="visual">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="visual">Visual Identity</TabsTrigger>
          <TabsTrigger value="voice">Voice Identity</TabsTrigger>
          <TabsTrigger value="commercial">Commercial Identity</TabsTrigger>
          <TabsTrigger value="content">Content Rules</TabsTrigger>
          <TabsTrigger value="channels">Channel Applications</TabsTrigger>
        </TabsList>

        <TabsContent value="visual" className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Logo & Favicon</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {['Primary logo', 'Icon / favicon', 'Reversed (light-on-dark)'].map(label => (
                <div key={label} className="flex flex-col items-center gap-1.5">
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-muted-foreground">
                    <ImageOff className="h-5 w-5" />
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
                  <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" disabled title="Asset upload isn't built yet">
                    <Upload className="h-2.5 w-2.5" /> Upload
                  </Button>
                </div>
              ))}
              <p className="w-full text-xs text-muted-foreground">No logo asset on file for {client.name} yet — placeholders shown above. Supply final files when ready.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Colours</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {kit.visual.colors.map((c, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="h-12 w-12 rounded-lg border border-border" style={{ background: c.hex || '#eee' }} />
                  <EditableField
                    value={c.label}
                    onChange={v => setVisual({ colors: kit.visual.colors.map((cc, ci) => (ci === i ? { ...cc, label: v } : cc)) })}
                    className="px-1 py-0 text-center"
                    textClassName="text-[10px] font-medium text-muted-foreground"
                  />
                  <span className="text-[10px] text-muted-foreground">{c.hex}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {VISUAL_STYLE_FIELDS.map(({ label, key }) => (
              <Card key={label}>
                <CardHeader className="pb-2"><CardDescription>{label}</CardDescription></CardHeader>
                <CardContent className="pt-0">
                  <EditableField
                    value={kit.visual[key] as string}
                    onChange={v => setVisual({ [key]: v } as Partial<BrandKit['visual']>)}
                    multiline
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="voice" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {VOICE_TEXT_FIELDS.map(({ label, key, multiline }) => (
            <Card key={label}>
              <CardHeader className="pb-2"><CardTitle>{label}</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <EditableField value={kit.voice[key] as string} onChange={v => setVoice({ [key]: v } as Partial<BrandKit['voice']>)} multiline={multiline} />
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader className="pb-2"><CardTitle>Words to use</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <EditableTagList items={kit.voice.wordsToUse} onChange={v => setVoice({ wordsToUse: v })} variant="success" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle>Words to avoid</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <EditableTagList items={kit.voice.wordsToAvoid} onChange={v => setVoice({ wordsToAvoid: v })} variant="destructive" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commercial" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {COMMERCIAL_FIELDS.map(({ label, key }) => (
            <Card key={label}>
              <CardHeader className="pb-2"><CardTitle>{label}</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <EditableTagList items={kit.commercial[key] as string[]} onChange={v => setCommercial({ [key]: v } as Partial<BrandKit['commercial']>)} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="content" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {CONTENT_FIELDS.map(({ label, key }) => (
            <Card key={label}>
              <CardHeader className="pb-2"><CardTitle>{label}</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <EditableTagList items={kit.content[key] as string[]} onChange={v => setContent({ [key]: v } as Partial<BrandKit['content']>)} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="channels" className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">How the brand kit above translates into each real-world/channel output. Descriptions update automatically as you edit visual/voice/content fields.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CHANNEL_APPLICATIONS.map(channel => (
              <Card key={channel} className="shadow-none">
                <CardHeader className="pb-2"><CardTitle className="text-sm">{channel}</CardTitle></CardHeader>
                <CardContent className="pt-0 text-xs text-muted-foreground">{channelBlurb(kit, channel)}</CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
