import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'

export default function NewClientPage() {
  const navigate = useNavigate()
  const { createClient } = useClient()
  useAICompanionContext('New Client')

  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [location, setLocation] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [goals, setGoals] = useState('')
  const [targetCustomers, setTargetCustomers] = useState('')
  const [capabilitiesSummary, setCapabilitiesSummary] = useState('')
  const [constraintsSummary, setConstraintsSummary] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim() && industry.trim() && location.trim() && contactName.trim() && contactEmail.trim()

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    const client = await createClient({
      name: name.trim(),
      industry: industry.trim(),
      location: location.trim(),
      contact: { name: contactName.trim(), email: contactEmail.trim(), phone: contactPhone.trim() },
      goals: goals.split(/\n|,/).map(g => g.trim()).filter(Boolean),
      targetCustomers: targetCustomers.trim(),
      capabilitiesSummary: capabilitiesSummary.trim(),
      constraintsSummary: constraintsSummary.trim(),
    })
    navigate(`/clients/${client.id}/overview`)
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="New Client" description="Onboard a new client workspace. Positioning, strategy and service plan all start empty — nothing here is pre-filled or assumed." />

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Business</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="name">Business name</Label>
              <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Riverside Dental" required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" value={industry} onChange={e => setIndustry(e.target.value)} placeholder="e.g. Healthcare — Dental" required />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Toowoomba, QLD" required />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Primary contact</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="contactName">Name</Label>
              <Input id="contactName" value={contactName} onChange={e => setContactName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="contactEmail">Email</Label>
              <Input id="contactEmail" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="contactPhone">Phone</Label>
              <Input id="contactPhone" value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Intake notes</CardTitle>
            <CardDescription>Feeds the Client Overview snapshot — refine later once Strategic Intelligence and Positioning run.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="goals">Goals (one per line)</Label>
              <Textarea id="goals" value={goals} onChange={e => setGoals(e.target.value)} rows={3} placeholder={'Increase qualified enquiries\nReduce no-shows'} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="targetCustomers">Target customers</Label>
              <Textarea id="targetCustomers" value={targetCustomers} onChange={e => setTargetCustomers(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="capabilities">Capabilities</Label>
                <Textarea id="capabilities" value={capabilitiesSummary} onChange={e => setCapabilitiesSummary(e.target.value)} rows={2} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="constraints">Constraints</Label>
                <Textarea id="constraints" value={constraintsSummary} onChange={e => setConstraintsSummary(e.target.value)} rows={2} />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/clients')}>Cancel</Button>
          <Button type="submit" className="gap-1.5 bg-sg-forest text-sg-ivory hover:bg-sg-forest/90" disabled={!canSubmit || submitting}>
            <UserPlus className="h-3.5 w-3.5" /> {submitting ? 'Creating…' : 'Create client'}
          </Button>
        </div>
      </form>
    </div>
  )
}
