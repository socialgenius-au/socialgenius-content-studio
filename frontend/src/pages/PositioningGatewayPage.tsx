import { ArrowDown, ArrowUp, Compass, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import './PositioningGatewayPage.css'

const jump = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * Approved Social Genius gateway landing page.
 *
 * The supplied artwork is deliberately retained as the locked visual reference while the
 * interactive/navigation layer is implemented as real DOM controls. The official Social Genius
 * logo is overlaid from the user-supplied logo asset (never regenerated). The existing Page
 * Builder/Visual Editor remains available at ?edit=1 / ?studio=1 and the existing public page is
 * reachable through ?website=1 / ?experience=1.
 */
export default function PositioningGatewayPage() {
  return (
    <main className="sg-gateway" id="top" aria-label="Social Genius landing page">
      <div className="sg-gateway-stage">
        <img
          className="sg-gateway-art"
          src="/positioning-landing/landing-reference.png"
          alt="Social Genius — Every business has a next level"
        />

        {/* Cover the generated mark in the visual reference and use the real brand asset. */}
        <div className="sg-gateway-logo-mask sg-gateway-logo-mask--top" aria-hidden="true" />
        <button className="sg-gateway-brand" onClick={() => jump('top')} aria-label="Back to top">
          <img src="/positioning-landing/social-genius-logo.png" alt="Social Genius" />
        </button>

        <nav className="sg-gateway-nav" aria-label="Landing page navigation">
          <button onClick={() => jump('top')}>Home</button>
          <button onClick={() => jump('perspective')}>About</button>
          <button onClick={() => jump('options')}>Solutions</button>
          <button onClick={() => jump('proof')}>Success Stories</button>
          <button onClick={() => jump('resources')}>Resources</button>
          <a href="mailto:hello@socialgenius.au?subject=Social%20Genius%20Enquiry">Contact Us</a>
        </nav>

        <section id="options" className="sg-gateway-anchor sg-gateway-anchor--options" aria-label="Choose your Social Genius experience">
          <Link className="sg-hotspot sg-hotspot--website" to="/positioning?website=1" aria-label="Enter the Social Genius website">
            <span className="sg-sr-only">Enter Website</span>
          </Link>
          <Link className="sg-hotspot sg-hotspot--experience" to="/positioning?experience=1" aria-label="Enter the Social Genius positioning experience">
            <span className="sg-sr-only">Enter the Experience</span>
          </Link>
        </section>

        <div id="proof" className="sg-gateway-anchor sg-gateway-anchor--proof" aria-hidden="true" />
        <div id="perspective" className="sg-gateway-anchor sg-gateway-anchor--perspective" aria-hidden="true" />
        <div id="resources" className="sg-gateway-anchor sg-gateway-anchor--resources" aria-hidden="true" />

        {/* Replace the generated footer mark with the official logo as well. */}
        <div className="sg-gateway-logo-mask sg-gateway-logo-mask--footer" aria-hidden="true" />
        <div className="sg-gateway-footer-logo">
          <img src="/positioning-landing/social-genius-logo.png" alt="Social Genius" />
        </div>
      </div>

      <Link className="sg-floating-cta" to="/positioning?experience=1">
        <Compass size={19} aria-hidden="true" />
        <span>Start the Experience</span>
        <ExternalLink size={16} aria-hidden="true" />
      </Link>

      <div className="sg-scroll-controls" aria-label="Page controls">
        <button onClick={() => jump('top')} title="Back to top" aria-label="Back to top">
          <ArrowUp size={19} />
        </button>
        <button onClick={() => jump('footer')} title="Go to bottom" aria-label="Go to bottom">
          <ArrowDown size={19} />
        </button>
      </div>
      <div id="footer" className="sg-bottom-anchor" aria-hidden="true" />
    </main>
  )
}
