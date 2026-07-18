import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { BillingToggle } from '@/components/billing/billing-toggle'
import { PricingCardsDisplay, PricingProPrice } from '@/components/billing/pricing-cards-display'
import { useSession } from '@/auth/session'
import type { BillingPeriod } from '@/lib/billing-pricing'
import { FadeIn } from './fade-in'
import { GradientCta, GRADIENT_TEXT_CLASS, MARKETING_CONTAINER } from './gradient-cta'

const INTERACTIVE_CLASSNAME =
  'outline-none focus-visible:ring-2 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg'

const FREE_CARD_CLASSNAME = cn(
  INTERACTIVE_CLASSNAME,
  'hover:border-blue-500/30 hover:shadow-blue-500/10',
)

const PRO_CARD_CLASSNAME = cn(
  INTERACTIVE_CLASSNAME,
  'focus-visible:ring-cyan-500 transition-colors hover:bg-card/90',
)

const CURRENT_PLAN_LABEL = 'Current plan'
// Shared shape for the card actions that aren't links — deliberately inert, no hover affordance.
const INERT_CTA_CLASSNAME =
  'flex w-full items-center justify-center rounded-xl border border-border px-6 py-2.5 text-sm font-medium text-muted-foreground'

// Reuses the Button 'outline' variant classes; rendered as a `<Link>`/`<a>` which already
// shows a pointer cursor by default, so no cursor-pointer utility needed. `lg` (h-9) matches
// the sibling Pro CTA's height so the two pricing cards' actions align.
const outlineButtonClassName = buttonVariants({ variant: 'outline', size: 'lg' })

export function PricingSectionInteractive(): ReactNode {
  const { data: session } = useSession()
  const isAuthenticated = session != null
  const isPro = isAuthenticated ? session.user.isPro : false

  const [billing, setBilling] = useState<BillingPeriod>('yearly')
  const isYearly = billing === 'yearly'

  // React Compiler auto-memoizes these — no manual useMemo needed.
  const freeCta = isAuthenticated ? (
    <div className={INERT_CTA_CLASSNAME}>{CURRENT_PLAN_LABEL}</div>
  ) : (
    <Link
      to="/register"
      className={cn(
        outlineButtonClassName,
        'w-full justify-center group-hover:border-blue-500/40 group-hover:text-foreground transition-colors',
      )}
    >
      Get Started Free
    </Link>
  )

  // Both signed-in Pro actions target Phase-5 routes that don't exist yet (`/upgrade`,
  // `/settings`), and the SPA is standalone on beta.devstash.one — Firebase rewrites any
  // unknown path into the shell, so linking there would dead-end every logged-in visitor on
  // a 404 rather than fall through to the old app. Show an inert label until Phase 5 ships
  // billing; `/register` stays a real link because anonymous visitors have a live path.
  // When `/upgrade` lands, restore the GradientCta here and forward the selected period via
  // `search={{ billing }}` (TanStack parses `to` as a pathname, so no `?billing=` in `to`).
  const proComingSoonLabel = isPro ? 'Manage billing — coming soon' : 'Get Pro — coming soon'
  const proCta = isAuthenticated ? (
    <div className={INERT_CTA_CLASSNAME}>{proComingSoonLabel}</div>
  ) : (
    <GradientCta href="/register" className="w-full" height="h-9">
      Get Pro
      <ArrowRight size={14} />
    </GradientCta>
  )

  const proPrice = <PricingProPrice isYearly={isYearly} />

  return (
    <section id="pricing" className="py-24">
      <div className={MARKETING_CONTAINER}>
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Pricing
          </p>
          <h2 className="mb-4 text-4xl font-bold md:text-5xl">
            Simple, honest <span className={GRADIENT_TEXT_CLASS}>pricing</span>
          </h2>
          <p className="text-lg text-muted-foreground">Start free. Upgrade when you need more.</p>
        </div>

        <FadeIn>
          <div className="mb-8 flex justify-center">
            <BillingToggle billing={billing} onChange={setBilling} />
          </div>
        </FadeIn>

        <FadeIn index={1}>
          <PricingCardsDisplay
            proPrice={proPrice}
            freeCta={freeCta}
            proCta={proCta}
            freeCardClassName={FREE_CARD_CLASSNAME}
            proCardClassName={PRO_CARD_CLASSNAME}
          />
        </FadeIn>
      </div>
    </section>
  )
}
