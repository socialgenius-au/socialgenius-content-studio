import { Link } from 'react-router-dom'
import './StudioHomePreview.css'

const mediaRoot = '/studio-showcase'

export function ShowcaseMedia({ asset, video = false, label }: { asset: string; video?: boolean; label: string }) {
  return video
    ? <video className="sg-showcase-media" aria-label={label} controls playsInline preload="none" poster={`${mediaRoot}/${asset}.jpg`} src={`${mediaRoot}/${asset}.webm`} />
    : <img className="sg-showcase-media" src={`${mediaRoot}/${asset}.jpg`} alt={label} loading="lazy" />
}

export const showcaseTemplates = [
  { title: 'Special Offer', category: 'Promotions', asset: 'product', detail: 'Product offer with a clear call to action' },
  { title: 'New Arrival', category: 'Product', asset: 'product', detail: 'Product launch announcement' },
  { title: 'Business Growth', category: 'Business', asset: 'workspace', video: true, detail: 'Brand positioning video' },
  { title: 'Property Opportunity', category: 'Real Estate', asset: 'property', video: true, detail: 'Property spotlight video' },
  { title: 'Fitness & Wellness', category: 'Health & Wellness', asset: 'wellness', detail: 'Wellness education post' },
  { title: 'Mindset & Success', category: 'Education', asset: 'editorial', detail: 'Educational carousel' },
]

export function ShowcaseTemplates({ guest = false, query = '', category = 'All' }: { guest?: boolean; query?: string; category?: string }) {
  const visible = showcaseTemplates.filter(item =>
    (category === 'All' || item.category === category) &&
    `${item.title} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  return <div className="sg-template-grid">
    {visible.map(item => <article className="sg-showcase-card" key={item.title}>
      <ShowcaseMedia asset={item.asset} video={item.video} label={item.detail} />
      <div><small>{item.category}</small><h3>{item.title}</h3><p>{item.detail}</p>
        <Link to={guest ? '/login' : '/templates'}>{guest ? 'Sign in to create' : 'Open template library'} →</Link>
      </div>
    </article>)}
    {!visible.length && <p>No templates match your search.</p>}
  </div>
}

export function GuestHome() {
  return <div className="sg-home sg-public-home">
    <main className="sg-content">
      <header className="sg-top sg-public-top">
        <div className="sg-brand"><img className="sg-brand-logo" src="/social-genius-official-logo.svg" alt="" /><strong>Social Genius Content Studio</strong></div>
        <Link className="sg-showcase-cta" to="/login">Sign in</Link>
      </header>
      <section className="sg-hero sg-public-hero">
        <div className="sg-hero-copy"><p>Social Genius Content Studio</p><h1>Create content with a clear position.</h1><p>Plan campaigns, create posts and videos, and turn reference content into your own ideas.</p><a className="sg-showcase-cta" href="#guest-templates">Explore templates</a></div>
        <ShowcaseMedia asset="workspace" video label="Business growth sample video" />
      </section>
      <div className="sg-section-heading"><h2>What you can create</h2></div>
      <section className="sg-public-creation" aria-label="Creation formats">
        {[
          ['Social Post','product','Create campaign artwork for social media.'],
          ['Carousel','editorial','Tell a story across a sequence of slides.'],
          ['Video','property','Create short reels and longer videos.'],
        ].map(([title,asset,detail])=><article className="sg-showcase-card" key={title}>
          <ShowcaseMedia asset={asset} video={title==='Video'} label={detail} />
          <div><h3>{title}</h3><p>{detail}</p><Link to="/login">Sign in to create →</Link></div>
        </article>)}
      </section>
      <section id="guest-templates"><div className="sg-section-heading"><h2>Explore templates</h2></div><ShowcaseTemplates guest /></section>
    </main>
  </div>
}
