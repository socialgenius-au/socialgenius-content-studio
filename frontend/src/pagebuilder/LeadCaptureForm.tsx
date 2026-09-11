import { useState, type FormEvent } from 'react'
import { CheckCircle2 } from 'lucide-react'

/**
 * Extracted unchanged from the original PositioningLandingPage.tsx (same validation, same
 * simulated submit, same success state) — the one piece of the page that is genuinely
 * interactive React rather than a plain text/image/button element, so it's wired into the page
 * config via `ElementConfig.custom === 'lead-capture-form'` (see ElementRenderer.tsx) instead of
 * being decomposed into the generic element model.
 */
type LeadFormState = { name: string; email: string; business: string; message: string }
type LeadFormErrors = Partial<Record<keyof LeadFormState, string>>

const EMPTY_FORM: LeadFormState = { name: '', email: '', business: '', message: '' }

async function submitPositioningLead(_data: LeadFormState): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 550))
}

function validate(data: LeadFormState): LeadFormErrors {
  const errors: LeadFormErrors = {}
  if (!data.name.trim()) errors.name = 'Please tell us your name.'
  if (!data.email.trim()) errors.email = 'Please add an email address.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'That email doesn’t look right.'
  if (!data.business.trim()) errors.business = 'Please add your business name.'
  return errors
}

export function LeadCaptureForm() {
  const [form, setForm] = useState<LeadFormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<LeadFormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const field = (key: keyof LeadFormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm(f => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const nextErrors = validate(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      await submitPositioningLead(form)
      setSubmitted(true)
    } catch {
      setSubmitError('Something went wrong sending this — please try again in a moment.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="pl-form-card">
        <div className="pl-success">
          <div className="pl-success-icon"><CheckCircle2 size={26} /></div>
          <h3>Request received</h3>
          <p>
            Thanks{form.name ? `, ${form.name.split(' ')[0]}` : ''} — we’ll be in touch shortly
            to arrange your Positioning Audit.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form className="pl-form-card" onSubmit={handleSubmit} noValidate>
      <div className="pl-form-title">Start Your Positioning Audit</div>
      <div className="pl-form-sub">A short, no-obligation conversation about where your positioning stands today.</div>

      <div className="pl-field">
        <label htmlFor="pl-name">Name</label>
        <input id="pl-name" value={form.name} onChange={field('name')} placeholder="Your full name" />
        {errors.name && <span className="pl-field-error">{errors.name}</span>}
      </div>
      <div className="pl-field">
        <label htmlFor="pl-email">Email</label>
        <input id="pl-email" type="email" value={form.email} onChange={field('email')} placeholder="you@business.com" />
        {errors.email && <span className="pl-field-error">{errors.email}</span>}
      </div>
      <div className="pl-field">
        <label htmlFor="pl-business">Business name</label>
        <input id="pl-business" value={form.business} onChange={field('business')} placeholder="Your business" />
        {errors.business && <span className="pl-field-error">{errors.business}</span>}
      </div>
      <div className="pl-field">
        <label htmlFor="pl-message">What made you look into positioning? (optional)</label>
        <textarea id="pl-message" rows={3} value={form.message} onChange={field('message')} placeholder="A sentence or two is plenty" />
      </div>

      {submitError && <p className="pl-field-error" style={{ marginBottom: 12 }}>{submitError}</p>}

      <button type="submit" className="pl-form-submit" disabled={submitting}>
        {submitting ? 'Sending…' : 'Request My Positioning Audit'}
      </button>
      <p className="pl-form-note">No spam. No commitment. Just clarity on where you stand.</p>
    </form>
  )
}
