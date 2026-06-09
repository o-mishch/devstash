'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BillingToggle } from '@/components/billing/billing-toggle'
import { PricingCardsDisplay, PricingProPrice } from '@/components/billing/pricing-cards-display'
import { CURRENT_PLAN_CTA_CLASSNAME, CURRENT_PLAN_LABEL } from '@/lib/billing/messages/billing-messages.client'
import type { BillingPeriod } from '@/lib/billing/config/billing-pricing.client'
import { FadeIn } from './FadeIn'
import { GradientCta } from './GradientCta'

interface PricingSectionInteractiveProps {
  freeFeatures: ReactNode
  proFeatures: ReactNode
  isAuthenticated?: boolean
  isPro?: boolean
}

export function PricingSectionInteractive({
  freeFeatures,
  proFeatures,
  isAuthenticated = false,
  isPro = false,
}: PricingSectionInteractiveProps) {
  const [billing, setBilling] = useState<BillingPeriod>('yearly')
  const isYearly = billing === 'yearly'
  const proHref = isAuthenticated ? `/upgrade?billing=${billing}` : '/register'

  const interactiveClassName =
    'outline-none focus-visible:ring-2 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg'

  const freeCardProps = {
    className: cn(interactiveClassName, 'hover:border-blue-500/30 hover:shadow-blue-500/10'),
  }

  const proCardProps = {
    className: cn(
      interactiveClassName,
      'focus-visible:ring-cyan-500 transition-colors hover:bg-card/90',
    ),
  }

  const freeCta = isAuthenticated ? (
    <div className={CURRENT_PLAN_CTA_CLASSNAME}>{CURRENT_PLAN_LABEL}</div>
  ) : (
    <Link
      href="/register"
      onClick={(e) => e.stopPropagation()}
      className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-center group-hover:border-blue-500/40 group-hover:text-foreground transition-colors')}
    >
      Get Started Free
    </Link>
  )

  const proCta = isAuthenticated && isPro ? (
    <Link
      href="/settings"
      onClick={(e) => e.stopPropagation()}
      className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-center group-hover:border-cyan-500/40 group-hover:text-foreground transition-colors')}
    >
      Manage Billing
    </Link>
  ) : (
    <GradientCta href={proHref} className="w-full h-9" onClick={(e) => e.stopPropagation()}>
      Get Pro
      <ArrowRight size={14} />
    </GradientCta>
  )

  return (
    <section id="pricing" className="py-24">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Pricing
          </p>
          <h2 className="mb-4 text-4xl font-bold md:text-5xl">
            Simple, honest{' '}
            <span className="bg-gradient-to-r from-blue-600 to-indigo-400 bg-clip-text text-transparent">
              pricing
            </span>
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
            proPrice={<PricingProPrice isYearly={isYearly} />}
            freeCta={freeCta}
            proCta={proCta}
            freeFeatures={freeFeatures}
            proFeatures={proFeatures}
            freeCardProps={freeCardProps}
            proCardProps={proCardProps}
          />
        </FadeIn>
      </div>
    </section>
  )
}
