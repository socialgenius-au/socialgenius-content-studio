import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingState } from '@/components/common/LoadingState'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import type { Client } from '@/types/domain'

interface BrandKit {
  visual: { colors: { label: string; hex: string }[]; fonts: string; logoStyle: string; imageStyle: string; videoStyle: string; thumbnailStyle: string; intro: string; outro: string; lowerThird: string; watermark: string }
  voice: { tone: string; formality: string; humour: string; wordsToUse: string[]; wordsToAvoid: string[]; ctaStyle: string; sentenceStyle: string; personality: string }
  commercial: { services: string[]; offers: string[]; targetAudiences: string[]; locations: string[]; differentiators: string[]; proof: string[]; certifications: string[]; testimonials: string[]; guarantees: string[] }
  content: { hashtags: string[]; ctaPatterns: string[]; handles: string[]; links: string[]; disclaimers: string[]; mandatoryInclusions: string[] }
}

function buildBrandKit(client: Client): BrandKit {
  if (client.id === 'abc-motors') {
    return {
      visual: {
        colors: [
          { label: 'Forest', hex: '#1E3D2A' },
          { label: 'Warranty Gold', hex: '#C89A2E' },
          { label: 'Ivory', hex: '#F5F0E8' },
          { label: 'Trust Lime', hex: '#A8D93B' },
        ],
        fonts: 'Inter (headlines, bold) + Inter (body) — no serif; keeps the brand feeling plain-spoken, not corporate.',
        logoStyle: 'Wordmark + shield icon, always on forest green or ivory background.',
        imageStyle: 'Natural daylight yard photography, real inventory only — no stock cars.',
        videoStyle: 'Handheld walkaround style, inspection report shown on screen, warm colour grade.',
        thumbnailStyle: 'Vehicle hero shot + bold warranty/proof text overlay, gold accent bar.',
        intro: '2s logo sting on forest green, no voiceover.',
        outro: 'Warranty badge + phone number + "Book your inspection" CTA card.',
        lowerThird: 'Gold underline bar, forest text on ivory chip.',
        watermark: 'Small shield logo, bottom-right, 40% opacity.',
      },
      voice: {
        tone: 'Warm, plain-spoken, quietly confident — never salesy.',
        formality: 'Conversational, first-name friendly, avoids jargon.',
        humour: 'Light and dry, used sparingly — never at the buyer\'s expense.',
        wordsToUse: ['inspected', 'warrantied', 'no surprises', 'proof', 'honest'],
        wordsToAvoid: ['cheapest', 'unbeatable deal', 'today only', 'no haggling needed (implies haggling elsewhere)'],
        ctaStyle: 'Low-pressure, offer-based ("Get your free inspection report") rather than urgency-based.',
        sentenceStyle: 'Short sentences, second person ("you"), concrete numbers over adjectives.',
        personality: 'The mechanic friend who tells you the truth, not the salesperson who wants the close.',
      },
      commercial: {
        services: ['Used vehicle sales', 'In-house finance', 'Pre-purchase inspection', 'Warranty support'],
        offers: ['Free pre-purchase inspection report', 'Finance pre-approval in 60 seconds'],
        targetAudiences: [client.targetCustomers],
        locations: [client.location],
        differentiators: ['3-point independent inspection on every car', '3-month included warranty', 'Finance pre-approval before you visit'],
        proof: ['212 Google reviews at 4.8★', '38 warranty claims honoured, zero disputes, last 12 months'],
        certifications: ['Licensed motor dealer, QLD'],
        testimonials: ['"They showed me the inspection report before I even asked." — Grace L.'],
        guarantees: ['3-month warranty on every vehicle sold'],
      },
      content: {
        hashtags: ['#ABCMotors', '#UsedCarsBrisbane', '#BuyingConfidence'],
        ctaPatterns: ['Get your free inspection report', 'Check your finance pre-approval', 'Book a no-pressure walkthrough'],
        handles: ['@abcmotorsbrisbane'],
        links: ['abcmotors.example.com/inspection-report'],
        disclaimers: ['Finance subject to approval. Terms and conditions apply.'],
        mandatoryInclusions: ['Warranty period must be stated in every vehicle post', 'Phone number in every GBP post'],
      },
    }
  }
  return {
    visual: {
      colors: [
        { label: 'Primary', hex: client.color },
        { label: 'Ivory', hex: '#F5F0E8' },
        { label: 'Charcoal', hex: '#232420' },
      ],
      fonts: 'Not yet defined — pending Brand Kit workshop with client.',
      logoStyle: 'Placeholder — awaiting logo asset.',
      imageStyle: 'Not yet defined.',
      videoStyle: 'Not yet defined.',
      thumbnailStyle: 'Not yet defined.',
      intro: 'Not yet defined.',
      outro: 'Not yet defined.',
      lowerThird: 'Not yet defined.',
      watermark: 'Not yet defined.',
    },
    voice: {
      tone: 'Not yet defined.',
      formality: 'Not yet defined.',
      humour: 'Not yet defined.',
      wordsToUse: [],
      wordsToAvoid: [],
      ctaStyle: 'Not yet defined.',
      sentenceStyle: 'Not yet defined.',
      personality: 'Not yet defined.',
    },
    commercial: {
      services: [],
      offers: [],
      targetAudiences: client.targetCustomers ? [client.targetCustomers] : [],
      locations: client.location ? [client.location] : [],
      differentiators: [],
      proof: [],
      certifications: [],
      testimonials: [],
      guarantees: [],
    },
    content: {
      hashtags: [],
      ctaPatterns: [],
      handles: [],
      links: [],
      disclaimers: [],
      mandatoryInclusions: [],
    },
  }
}

function TagList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(i => (
        <Badge key={i} variant="outline">{i}</Badge>
      ))}
    </div>
  )
}

export default function BrandKitPage() {
  const { client, loading } = useClient()
  useAICompanionContext(`Brand Kit • ${client?.name ?? '…'}`)

  if (loading || !client) return <LoadingState rows={5} />

  const kit = buildBrandKit(client)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={`Brand Kit — ${client.name}`} description="The foundation every other module pulls from: visual identity, voice, commercial facts, and content rules." />

      <Tabs defaultValue="visual">
        <TabsList>
          <TabsTrigger value="visual">Visual Identity</TabsTrigger>
          <TabsTrigger value="voice">Voice Identity</TabsTrigger>
          <TabsTrigger value="commercial">Commercial Identity</TabsTrigger>
          <TabsTrigger value="content">Content Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="visual" className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Colours</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {kit.visual.colors.map(c => (
                <div key={c.hex} className="flex flex-col items-center gap-1">
                  <div className="h-12 w-12 rounded-lg border border-border" style={{ background: c.hex }} />
                  <span className="text-[10px] font-medium text-muted-foreground">{c.label}</span>
                  <span className="text-[10px] text-muted-foreground">{c.hex}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {([
              ['Fonts', kit.visual.fonts], ['Logo style', kit.visual.logoStyle], ['Image style', kit.visual.imageStyle],
              ['Video style', kit.visual.videoStyle], ['Thumbnail style', kit.visual.thumbnailStyle], ['Intro', kit.visual.intro],
              ['Outro', kit.visual.outro], ['Lower third', kit.visual.lowerThird], ['Watermark', kit.visual.watermark],
            ] as [string, string][]).map(([label, value]) => (
              <Card key={label}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription></CardHeader><CardContent className="pt-0 text-sm">{value}</CardContent></Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="voice" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card><CardHeader className="pb-2"><CardTitle>Tone</CardTitle></CardHeader><CardContent className="pt-0 text-sm">{kit.voice.tone}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle>Formality</CardTitle></CardHeader><CardContent className="pt-0 text-sm">{kit.voice.formality}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle>Humour</CardTitle></CardHeader><CardContent className="pt-0 text-sm">{kit.voice.humour}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle>Brand personality</CardTitle></CardHeader><CardContent className="pt-0 text-sm">{kit.voice.personality}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle>CTA style</CardTitle></CardHeader><CardContent className="pt-0 text-sm">{kit.voice.ctaStyle}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle>Sentence style</CardTitle></CardHeader><CardContent className="pt-0 text-sm">{kit.voice.sentenceStyle}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle>Words to use</CardTitle></CardHeader><CardContent className="pt-0"><TagList items={kit.voice.wordsToUse} empty="Not yet defined." /></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle>Words to avoid</CardTitle></CardHeader><CardContent className="pt-0"><TagList items={kit.voice.wordsToAvoid} empty="Not yet defined." /></CardContent></Card>
        </TabsContent>

        <TabsContent value="commercial" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {([
            ['Services / products', kit.commercial.services], ['Offers', kit.commercial.offers],
            ['Target audiences', kit.commercial.targetAudiences], ['Locations', kit.commercial.locations],
            ['Differentiators', kit.commercial.differentiators], ['Proof', kit.commercial.proof],
            ['Certifications', kit.commercial.certifications], ['Testimonials', kit.commercial.testimonials],
            ['Guarantees', kit.commercial.guarantees],
          ] as [string, string[]][]).map(([label, items]) => (
            <Card key={label}>
              <CardHeader className="pb-2"><CardTitle>{label}</CardTitle></CardHeader>
              <CardContent className="pt-0"><TagList items={items} empty="Not yet defined." /></CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="content" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {([
            ['Hashtags', kit.content.hashtags], ['CTA patterns', kit.content.ctaPatterns], ['Handles', kit.content.handles],
            ['Links', kit.content.links], ['Disclaimers', kit.content.disclaimers], ['Mandatory inclusions', kit.content.mandatoryInclusions],
          ] as [string, string[]][]).map(([label, items]) => (
            <Card key={label}>
              <CardHeader className="pb-2"><CardTitle>{label}</CardTitle></CardHeader>
              <CardContent className="pt-0"><TagList items={items} empty="Not yet defined." /></CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  )
}
