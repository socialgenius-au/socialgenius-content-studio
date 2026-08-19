import { useEffect, useState } from 'react'
import { MessageCircle, Mail, Share2, Globe, AlertTriangle, Users, ShieldAlert, CheckCircle2, ArrowUpCircle, RotateCcw, ThumbsDown } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { inboxService } from '@/services/inboxService'
import type { CommunityOpportunity } from '@/mocks/conversations'
import type { AutomationLevel, Conversation } from '@/types/domain'

const CHANNEL_ICON = { whatsapp: MessageCircle, email: Mail, social: Share2, website: Globe } as const

const AUTOMATION_LABEL: Record<AutomationLevel, string> = {
  L1_ack: 'L1 — Acknowledgement',
  L2_info: 'L2 — Information Response',
  L3_qualify: 'L3 — Qualification',
  L4_nurture: 'L4 — Nurture',
  L5_human: 'L5 — Human Handover',
}

const AUTOMATION_VARIANT: Record<AutomationLevel, 'secondary' | 'accent' | 'warning'> = {
  L1_ack: 'secondary',
  L2_info: 'secondary',
  L3_qualify: 'accent',
  L4_nurture: 'accent',
  L5_human: 'warning',
}

function ConversationRow({ conv, onResolve, onEscalate }: { conv: Conversation; onResolve: () => void; onEscalate: () => void }) {
  const Icon = CHANNEL_ICON[conv.channel]
  const slaTone = conv.slaMinutesRemaining < 0 ? 'text-destructive' : conv.slaMinutesRemaining < 15 ? 'text-warning' : 'text-muted-foreground'
  const isResolved = conv.status === 'resolved'
  return (
    <Card className={`shadow-none ${isResolved ? 'opacity-60' : ''}`}>
      <CardContent className="flex flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-xs font-semibold text-foreground">{conv.contactName}</span>
              <span className="text-[10px] capitalize text-muted-foreground">{conv.channel}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isResolved && <Badge variant="success">Resolved</Badge>}
            <Badge variant={AUTOMATION_VARIANT[conv.automationLevel]}>{AUTOMATION_LABEL[conv.automationLevel]}</Badge>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">"{conv.lastMessage}"</p>

        {conv.escalationTrigger && (
          <div className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{conv.escalationTrigger}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-[10px] text-muted-foreground">AI confidence</span>
          <Progress value={conv.aiConfidence} className="h-1.5 flex-1" />
          <span className="w-9 shrink-0 text-right text-[10px] font-semibold text-foreground">{conv.aiConfidence}%</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>Last response {new Date(conv.lastResponseAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          <span className={slaTone}>
            {conv.slaMinutesRemaining < 0 ? `SLA breached ${Math.abs(conv.slaMinutesRemaining)}m ago` : `${conv.slaMinutesRemaining}m to SLA`}
          </span>
          <span>{conv.responsibleStaff}</span>
        </div>

        <div className="flex gap-1.5 border-t border-border pt-2">
          <Button size="sm" variant="outline" className="h-7 flex-1 gap-1 text-[11px]" onClick={onResolve}>
            {isResolved ? <RotateCcw className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
            {isResolved ? 'Reopen' : 'Mark resolved'}
          </Button>
          {conv.automationLevel !== 'L5_human' && !isResolved && (
            <Button size="sm" variant="outline" className="h-7 flex-1 gap-1 text-[11px] text-warning" onClick={onEscalate}>
              <ArrowUpCircle className="h-3 w-3" /> Escalate to human
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function CommunityCard({ opp, onSetStatus }: { opp: CommunityOpportunity; onSetStatus: (status: CommunityOpportunity['status']) => void }) {
  const relevanceVariant = opp.audienceRelevance === 'high' ? 'success' : opp.audienceRelevance === 'medium' ? 'warning' : 'secondary'
  const decided = opp.status !== 'pending'
  return (
    <Card className={`shadow-none ${opp.status === 'dismissed' ? 'opacity-60' : ''}`}>
      <CardContent className="flex flex-col gap-1.5 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">{opp.group}</span>
          <div className="flex items-center gap-1.5">
            {opp.status === 'contributed' && <Badge variant="success">Contributed</Badge>}
            {opp.status === 'dismissed' && <Badge variant="secondary">Dismissed</Badge>}
            <Badge variant={relevanceVariant}>{opp.audienceRelevance} relevance</Badge>
          </div>
        </div>
        <p className="text-xs text-foreground">{opp.topic}</p>
        <p className="text-[11px] text-muted-foreground">Group rules: {opp.groupRules}</p>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Promotion allowed:</span>
          <Badge variant={opp.promotionAllowed ? 'success' : 'secondary'}>{opp.promotionAllowed ? 'Yes' : 'No'}</Badge>
        </div>
        <p className="rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">Suggested contribution: {opp.suggestedContribution}</p>
        <div className="flex gap-1.5 border-t border-border pt-2">
          <Button size="sm" variant="outline" className="h-7 flex-1 gap-1 text-[11px]" disabled={decided} onClick={() => onSetStatus('contributed')}>
            <CheckCircle2 className="h-3 w-3" /> Mark contributed
          </Button>
          <Button size="sm" variant="outline" className="h-7 flex-1 gap-1 text-[11px]" disabled={decided} onClick={() => onSetStatus('dismissed')}>
            <ThumbsDown className="h-3 w-3" /> Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function InboxPage() {
  const { client, loading: clientLoading } = useClient()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [opportunities, setOpportunities] = useState<CommunityOpportunity[]>([])
  const [loading, setLoading] = useState(true)

  useAICompanionContext(client ? `Inbox & Nurture • ${client.name}` : 'Inbox & Nurture')

  useEffect(() => {
    if (!client) return
    setLoading(true)
    Promise.all([inboxService.listConversations(client.id), inboxService.listCommunityOpportunities(client.id)]).then(([c, o]) => {
      setConversations(c)
      setOpportunities(o)
      setLoading(false)
    })
  }, [client])

  const resolveConversation = (id: string) =>
    setConversations(prev => prev.map(c => (c.id === id ? { ...c, status: c.status === 'resolved' ? 'open' : 'resolved' } : c)))

  const escalateConversation = (id: string) =>
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, automationLevel: 'L5_human', escalationTrigger: 'Manually escalated by staff' } : c))
    )

  const setOpportunityStatus = (id: string, status: CommunityOpportunity['status']) =>
    setOpportunities(prev => prev.map(o => (o.id === id ? { ...o, status } : o)))

  if (clientLoading || !client) return <LoadingState rows={3} />

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Inbox & Nurture" description={`Unified conversations across WhatsApp, email, social and website for ${client.name}.`} />

      {loading ? (
        <LoadingState rows={4} />
      ) : (
        <Tabs defaultValue="conversations">
          <TabsList>
            <TabsTrigger value="conversations">Conversations</TabsTrigger>
            <TabsTrigger value="community">Community Opportunities</TabsTrigger>
          </TabsList>

          <TabsContent value="conversations">
            {conversations.length === 0 ? (
              <EmptyState icon={MessageCircle} title="No conversations yet" description="WhatsApp, email, social and website enquiries will appear here once connected." />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {conversations.map(c => (
                  <ConversationRow
                    key={c.id}
                    conv={c}
                    onResolve={() => resolveConversation(c.id)}
                    onEscalate={() => escalateConversation(c.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="community">
            <div className="mb-3 flex items-start gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>These are suggested contributions only — no automated posting. Every contribution requires staff review before it goes out, and only where the group's rules and platform permissions genuinely allow it.</span>
            </div>
            {opportunities.length === 0 ? (
              <EmptyState icon={Users} title="No community opportunities found" description="Relevant group discussions will surface here as they're identified." />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {opportunities.map(o => (
                  <CommunityCard key={o.id} opp={o} onSetStatus={status => setOpportunityStatus(o.id, status)} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
