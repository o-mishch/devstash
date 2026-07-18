import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { PRICING } from '@/lib/billing-pricing'
import { OG_IMAGE_URL, SITE_NAME, SITE_URL, absoluteUrl } from '@/lib/site-config'
import { useSession } from '@/auth/session'
import { HomepageNav } from '@/components/marketing/homepage-nav'
import { PricingSectionInteractive } from '@/components/marketing/pricing-section-interactive'

import { HeroText } from '@/components/marketing/hero-text'
import { HeroVisual } from '@/components/marketing/hero-visual'
import { FeaturesGrid } from '@/components/marketing/features-grid'
import { AiSection } from '@/components/marketing/ai-section'
import { CtaSection } from '@/components/marketing/cta-section'
import { MarketingFooter } from '@/components/marketing/marketing-footer'

const HOME_TITLE = `${SITE_NAME} — Your developer knowledge hub`
const HOME_DESCRIPTION =
  'One fast, searchable place for your code snippets, terminal commands, AI prompts, markdown notes, files, and bookmarks. Capture, search, and reuse everything you know.'
const HOME_URL = absoluteUrl('/')

const homeJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  url: SITE_URL,
  description: HOME_DESCRIPTION,
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: PRICING.free.price,
      priceCurrency: PRICING.free.currency,
      availability: 'https://schema.org/InStock',
    },
    {
      '@type': 'Offer',
      name: 'Pro (monthly)',
      price: PRICING.monthly.price,
      priceCurrency: PRICING.monthly.currency,
      availability: 'https://schema.org/InStock',
    },
    {
      '@type': 'Offer',
      name: 'Pro (yearly)',
      price: PRICING.yearly.price,
      priceCurrency: PRICING.yearly.currency,
      availability: 'https://schema.org/InStock',
    },
  ],
})

export const Route = createFileRoute('/')({
  codeSplitGroupings: [],
  head: () => ({
    meta: [
      { title: HOME_TITLE },
      { name: 'description', content: HOME_DESCRIPTION },
      // Open Graph (unfurls on Slack/LinkedIn/Facebook). og:site_name/og:type inherit __root.
      { property: 'og:title', content: HOME_TITLE },
      { property: 'og:description', content: HOME_DESCRIPTION },
      { property: 'og:url', content: HOME_URL },
      { property: 'og:image', content: OG_IMAGE_URL },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: `${SITE_NAME} — developer knowledge hub` },
      // Twitter/X card
      // twitter:card forces the large-image layout on X; the rest fall back to og:* on
      // every other platform. No twitter:site/creator — DevStash has no X account.
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: HOME_TITLE },
      { name: 'twitter:description', content: HOME_DESCRIPTION },
      { name: 'twitter:image', content: OG_IMAGE_URL },
    ],
    links: [{ rel: 'canonical', href: HOME_URL }],
    scripts: [{ type: 'application/ld+json', children: homeJsonLd }],
  }),
  // Never show the pending spinner on the marketing page.
  // In production the page is prerendered as static HTML — it renders instantly.
  // In dev mode the component is in the main bundle (no code-split), so any delay
  // is from Vite's transform pipeline, not a meaningful user-visible wait.
  pendingMs: Infinity,
  pendingComponent: () => null,
  component: Home,
})

function Home(): ReactNode {
  const { data: session } = useSession()

  return (
    <>
      {/* Page-wide dot grid — fixed so it covers the whole marketing page, not just the hero. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 [background-image:radial-gradient(rgba(0,0,0,0.04)_1px,transparent_1px)] [background-size:24px_24px] dark:[background-image:radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)]"
      />
      <HomepageNav isAuthenticated={session != null} />
      <main className="min-h-dvh">
        <HeroText />
        <HeroVisual />
        <FeaturesGrid />
        <AiSection />
        <PricingSectionInteractive />
        <CtaSection />
      </main>
      <MarketingFooter />
    </>
  )
}
