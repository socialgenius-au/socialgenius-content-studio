import { useState, type FormEvent } from 'react'
import {
  ArrowRight, Eye, ShieldCheck, Award, CheckCircle2, Compass, TrendingDown, Layers, Megaphone,
} from 'lucide-react'
import './PositioningLandingPage.css'

/**
 * Social Genius — Public Positioning Landing Page.
 *
 * PUBLIC route, mounted at /positioning WITHOUT RequireAuth/AppShell (own full-screen chrome,
 * same convention /studio and /video-studio-v2 already use) — this is the marketing page that
 * explains why positioning comes before content spend, distinct from the authenticated,
 * client-scoped strategist tool at /clients/:clientId/positioning (PositioningPage.tsx), which
 * this file never touches, imports from, or shares routes/state with.
 *
 * ARCHITECTURE PROVISION for the future chain
 *   Landing Page -> Positioning Audit intake -> lead/contact -> internal client positioning workspace
 * is kept possible without rebuilding this page: the only integration point is
 * `submitPositioningLead` below — a single, isolated function the form calls. Swapping its body
 * for a real POST (e.g. to a future /positioning-audit-leads endpoint) requires no change to any
 * component structure, copy, or layout above it. No audit questionnaire is built yet (out of
 * scope for this first version) — the CTA captures a lead only.
 */

type LeadFormState = { name: string; email: string; business: string; message: string }
type LeadFormErrors = Partial<Record<keyof LeadFormState, string>>

const EMPTY_FORM: LeadFormState = { name: '', email: '', business: '', message: '' }

// Isolated on purpose (see module docstring) — today this only simulates a network round trip so
// the success state is real to test; nothing is sent anywhere, and no data is fabricated as if a
// backend accepted it. Replace this ONE function's body to wire up a real intake endpoint later.
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

function LeadCaptureForm() {
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

function scrollToAudit() {
  document.getElementById('positioning-audit')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function PositioningLandingPage() {
  return (
    <div className="pl-page">
      <nav className="pl-nav">
        <div className="pl-container pl-nav-inner">
          <div className="pl-brand">
            <span className="pl-brand-name">Social Genius</span>
            <span className="pl-brand-tag">The Positioning People</span>
          </div>
          <button className="pl-nav-cta" onClick={scrollToAudit}>
            Start Your Audit <ArrowRight size={15} />
          </button>
        </div>
      </nav>

      {/* ---------------------------------------------------------------- HERO --- */}
      <header className="pl-hero">
        <div className="pl-hero-glow" aria-hidden="true" />
        <div className="pl-container pl-hero-inner">
          <div>
            <div className="pl-eyebrow">Positioning is Everything</div>
            <h1 className="pl-h1">
              BE SEEN<span className="pl-dot">.</span> BE TRUSTED<span className="pl-dot">.</span> BE CHOSEN<span className="pl-dot">.</span>
            </h1>
            <p className="pl-subhead">
              Before you spend more on content, get your positioning right. Great content aimed at
              the wrong position just gets you seen faster — by the wrong people, for the wrong
              reasons.
            </p>
            <div className="pl-cta-row">
              <button className="pl-btn-primary" onClick={scrollToAudit}>
                Start Your Positioning Audit <ArrowRight size={17} />
              </button>
              <a className="pl-link-secondary" href="#why-positioning">See why positioning comes first</a>
            </div>
          </div>
          <div className="pl-hero-card">
            <div className="pl-hero-card-label">Our Promise</div>
            <div className="pl-hero-card-text">We make you Visible, Trusted and Chosen.</div>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------- WHY POSITIONING --- */}
      <section className="pl-section" id="why-positioning">
        <div className="pl-container pl-two-col">
          <div className="pl-section-head" style={{ marginBottom: 0 }}>
            <div className="pl-kicker">Why Positioning Matters</div>
            <h2 className="pl-h2">Content works only when people already know why you’re the one to choose.</h2>
            <p className="pl-lede">
              Positioning is the answer to one question, decided before a single post goes out:
              why should the right person choose you over every other option in front of them?
              Get that answer right, and everything you create afterwards — your content, your ads,
              your sales conversations — does more with less.
            </p>
          </div>
          <div className="pl-stat-list">
            <div className="pl-stat-item">
              <div className="pl-stat-icon"><Eye size={18} /></div>
              <div className="pl-stat-body">
                <h3>It’s the filter everything else passes through</h3>
                <p>Your offer, your messaging, your visuals — all of it either reinforces a clear position or quietly dilutes it.</p>
              </div>
            </div>
            <div className="pl-stat-item">
              <div className="pl-stat-icon"><Compass size={18} /></div>
              <div className="pl-stat-body">
                <h3>It’s decided once, then defended everywhere</h3>
                <p>A strong position doesn’t change every campaign — it gives every campaign a reason to exist.</p>
              </div>
            </div>
            <div className="pl-stat-item">
              <div className="pl-stat-icon"><Award size={18} /></div>
              <div className="pl-stat-body">
                <h3>It’s what makes "choosing you" feel obvious</h3>
                <p>Customers rarely compare on every feature. They compare on who feels like the safe, right choice.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- PROBLEM --- */}
      <section className="pl-section pl-section-alt">
        <div className="pl-container">
          <div className="pl-section-head">
            <div className="pl-kicker">The Problem</div>
            <h2 className="pl-h2">Spending on content before positioning is spending to blend in faster.</h2>
            <p className="pl-lede">
              More videos, more posts, more ad spend — without a clear position behind it, all of
              that effort just makes an unclear message louder. It doesn’t make you more visible
              in the way that matters; it makes you easier to scroll past.
            </p>
          </div>
          <div className="pl-two-col">
            <div className="pl-stat-list">
              <div className="pl-stat-item">
                <div className="pl-stat-icon"><TrendingDown size={18} /></div>
                <div className="pl-stat-body">
                  <h3>Content spend with no compounding return</h3>
                  <p>Every piece starts from zero because nothing is building toward a single, recognisable position.</p>
                </div>
              </div>
              <div className="pl-stat-item">
                <div className="pl-stat-icon"><Layers size={18} /></div>
                <div className="pl-stat-body">
                  <h3>Messaging that changes every campaign</h3>
                  <p>Without a fixed position, every new campaign reinvents what you stand for — and customers never get to know it.</p>
                </div>
              </div>
            </div>
            <div className="pl-stat-list">
              <div className="pl-stat-item">
                <div className="pl-stat-icon"><Megaphone size={18} /></div>
                <div className="pl-stat-body">
                  <h3>Louder, not clearer</h3>
                  <p>More volume rarely fixes an unclear message — it just puts the same confusion in front of more people.</p>
                </div>
              </div>
              <div className="pl-stat-item">
                <div className="pl-stat-icon"><ShieldCheck size={18} /></div>
                <div className="pl-stat-body">
                  <h3>Trust that never quite builds</h3>
                  <p>People trust a position they recognise. If it shifts every month, there’s nothing consistent enough to trust.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- QUOTE --- */}
      <section className="pl-section">
        <div className="pl-container pl-quote">
          <div className="pl-quote-mark">“</div>
          <p className="pl-quote-text">Positioning is Everything.</p>
        </div>
      </section>

      {/* -------------------------------------------------------------- APPROACH --- */}
      <section className="pl-section pl-section-alt">
        <div className="pl-container">
          <div className="pl-section-head">
            <div className="pl-kicker">Our Approach</div>
            <h2 className="pl-h2">We start with your position — not your next post.</h2>
            <p className="pl-lede">
              Before we produce anything, we run a Positioning Audit: a clear-eyed look at how
              you’re currently seen, how your category expects you to sound, and where a real,
              defensible position for you actually sits. Everything we build afterwards is aimed
              at that one position — deliberately, not by accident.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- V/T/C --- */}
      <section className="pl-section">
        <div className="pl-container">
          <div className="pl-section-head">
            <div className="pl-kicker">The Outcome</div>
            <h2 className="pl-h2">Visible, Trusted and Chosen — in that order.</h2>
            <p className="pl-lede">Each one depends on the one before it. Skip a step, and the next one gets harder to earn.</p>
          </div>
          <div className="pl-vtc-grid">
            <div className="pl-vtc-card">
              <div className="pl-vtc-icon"><Eye size={22} /></div>
              <div className="pl-vtc-title">Be Seen</div>
              <p className="pl-vtc-text">
                Show up in front of the right people, saying something specific enough to actually
                register — not another version of what every competitor is already saying.
              </p>
            </div>
            <div className="pl-vtc-card">
              <div className="pl-vtc-icon"><ShieldCheck size={22} /></div>
              <div className="pl-vtc-title">Be Trusted</div>
              <p className="pl-vtc-text">
                A consistent, credible position — held over time — is what turns attention into
                confidence. Trust is built by repetition of something clear, not by novelty.
              </p>
            </div>
            <div className="pl-vtc-card">
              <div className="pl-vtc-icon"><Award size={22} /></div>
              <div className="pl-vtc-title">Be Chosen</div>
              <p className="pl-vtc-text">
                When the moment to decide arrives, a clear position removes the doubt that keeps
                people comparing — and makes choosing you feel like the obvious call.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- CTA --- */}
      <section className="pl-cta-section" id="positioning-audit">
        <div className="pl-container pl-cta-grid">
          <div>
            <div className="pl-kicker">Get Started</div>
            <h2 className="pl-h2">Get your positioning right — before your next piece of content.</h2>
            <p className="pl-lede">
              A Positioning Audit tells you, plainly, where you stand today and what’s standing
              between you and being Seen, Trusted and Chosen. No jargon, no lock-in — just clarity
              you can act on.
            </p>
            <ul className="pl-cta-points">
              <li><CheckCircle2 size={18} /> A clear view of how you’re currently positioned in your category</li>
              <li><CheckCircle2 size={18} /> Where your current content is (and isn’t) reinforcing that position</li>
              <li><CheckCircle2 size={18} /> A concrete next step — with or without working with us afterwards</li>
            </ul>
          </div>
          <LeadCaptureForm />
        </div>
      </section>

      <footer className="pl-footer">
        <div className="pl-container pl-footer-inner">
          <span className="pl-footer-tag"><span className="pl-footer-brand">Social Genius</span> — The Positioning People</span>
          <span className="pl-footer-tag">Positioning is Everything.</span>
        </div>
      </footer>
    </div>
  )
}
