import { ShowcaseMedia } from './StudioShowcase'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, UserPlus, Users } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { FilterBar } from '@/components/common/FilterBar'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useClient } from '@/contexts/ClientContext'
import { opsService } from '@/services/opsService'
import { leadService } from '@/services/leadService'

const industryPhotos = [
  { match: /car|motor|automotive/i, url: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=900&q=85', alt: 'Automotive photography' },
  { match: /grocery|supermarket|produce/i, url: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=85', alt: 'Fresh produce and grocery shelves' },
  { match: /packaging/i, url: 'https://images.pexels.com/photos/4393669/pexels-photo-4393669.jpeg?auto=compress&cs=tinysrgb&w=900', alt: 'Packaging industry sample photograph' },
]
function PortfolioPhoto({ industry }: { industry: string }) {
  const photo = industryPhotos.find(item => item.match.test(industry))
  return photo ? <img className="sg-portfolio-photo" src={photo.url} alt={photo.alt} loading="lazy" /> : <ShowcaseMedia asset={/property|real estate/i.test(industry)?'property':/health|beauty|fitness|wellness/i.test(industry)?'wellness':'workspace'} label="Illustrative industry photography" />
}
interface Attention {
  overdueTasks: number
  newLeads: number
}

export default function ClientsPage() {
  const { clients, loading } = useClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [attention, setAttention] = useState<Record<string, Attention>>({})

  useEffect(() => {
    if (clients.length === 0) return
    let cancelled = false
    Promise.all(
      clients.map(async c => {
        const [tasks, leads] = await Promise.all([opsService.list(c.id), leadService.list(c.id)])
        return [c.id, { overdueTasks: tasks.filter(t => t.overdue).length, newLeads: leads.filter(l => l.stage === 'new').length }] as const
      })
    ).then(pairs => {
      if (!cancelled) setAttention(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [clients])

  const filtered = useMemo(
    () => clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.industry.toLowerCase().includes(search.toLowerCase())),
    [clients, search]
  )

  return (
    <div className="sg-portfolio-page flex flex-col gap-5">
      <style>{`
.sg-portfolio-page{color:#f5e9d2}
body:has(.sg-portfolio-page) #root{background:#0b0b0b}
body:has(.sg-portfolio-page) #root div:has(>aside[aria-label="Main navigation"]){background:#0b0b0b;color:#f5e9d2}
body:has(.sg-portfolio-page) aside[aria-label="Main navigation"]{background:#11100e;color:#f5e9d2;border-color:#65502c}
body:has(.sg-portfolio-page) aside[aria-label="Main navigation"] nav a{color:#e5d6b8}
body:has(.sg-portfolio-page) aside[aria-label="Main navigation"] nav a[aria-current="page"]{background:linear-gradient(110deg,#f3d58a,#b88634);color:#17120b;box-shadow:none}
body:has(.sg-portfolio-page) aside[aria-label="Main navigation"] nav button{color:#c8a86b}
body:has(.sg-portfolio-page) #root header{background:#15120e;border-color:#65502c;color:#f5e9d2}
.sg-portfolio-page h1{font-family:Georgia,serif;color:#f2d28b;font-size:32px}
.sg-portfolio-page .sg-portfolio-visual{background:linear-gradient(145deg,#201b13,#101010);border:1px solid #755b31;color:#f5e9d2;transition:transform .2s,border-color .2s}
.sg-portfolio-page .sg-portfolio-visual:hover{transform:translateY(-3px);border-color:#f0c76c}
.sg-portfolio-page .sg-portfolio-photo,.sg-portfolio-page .sg-showcase-media{width:100%;height:190px;object-fit:cover;display:block}
.sg-portfolio-page input{background:#181510;border-color:#755b31;color:#f5e9d2}
.sg-portfolio-page .text-muted-foreground{color:#c7bba6}
.sg-portfolio-page button.bg-sg-forest{background:linear-gradient(110deg,#f3d58a,#b88634);color:#17120b}
`}</style>
      <PageHeader
        title="Client Portfolio"
        description="Every client workspace Social Genius manages."
        actions={
          <Button size="sm" className="gap-1.5 bg-sg-forest text-sg-ivory hover:bg-sg-forest/90" onClick={() => navigate('/clients/new')}>
            <UserPlus className="h-3.5 w-3.5" /> New Client
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[['Total clients',clients.length],['Positioning started',clients.filter(c=>c.positioningStatus!=='not_started').length],['Not started',clients.filter(c=>c.positioningStatus==='not_started').length]].map(([label,value])=><div key={label} style={{background:'#191611',border:'1px solid #755b31',borderRadius:12,padding:16}}><div style={{color:'#c7bba6',fontSize:12}}>{label}</div><strong style={{fontSize:28,color:'#f2d28b'}}>{value}</strong></div>)}</div>
      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search clients or industry…" />

      {loading ? (
        <LoadingState rows={3} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No clients found" description="Try a different search term." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(c => (
            <Card
              key={c.id}
              className="sg-portfolio-visual cursor-pointer overflow-hidden transition-colors hover:border-primary/50"
              onClick={() => navigate(`/clients/${c.id}/overview`)}
            >
              <PortfolioPhoto industry={c.industry} />
              <CardHeader className="flex-row items-center gap-2.5 space-y-0">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                  style={{ background: c.color }}
                >
                  {c.logoInitial}
                </div>
                <div className="flex flex-col leading-tight">
                  <CardTitle>{c.name}</CardTitle>
                  <span className="text-[11px] text-muted-foreground">{c.industry} · {c.location}</span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pt-0">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">{c.contact.name}</span>
                  {c.positioningStatus !== 'not_started' ? (
                    <StatusBadge status={c.positioningStatus} />
                  ) : (
                    <Badge variant="secondary">Positioning not started</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.goals.slice(0, 2).map(g => (
                    <Badge key={g} variant="outline" className="font-normal">{g}</Badge>
                  ))}
                </div>
                {(attention[c.id]?.overdueTasks ?? 0) > 0 || (attention[c.id]?.newLeads ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(attention[c.id]?.overdueTasks ?? 0) > 0 && (
                      <Badge variant="destructive" className="gap-1 font-normal">
                        <AlertTriangle className="h-3 w-3" /> {attention[c.id].overdueTasks} overdue
                      </Badge>
                    )}
                    {(attention[c.id]?.newLeads ?? 0) > 0 && (
                      <Badge variant="accent" className="gap-1 font-normal">
                        <UserPlus className="h-3 w-3" /> {attention[c.id].newLeads} new lead{attention[c.id].newLeads === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
