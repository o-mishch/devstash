'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BillingToggle, PricingCards, type BillingPeriod } from '@/components/shared/pricing-cards'
import { FadeIn } from './FadeIn'
import { GradientCta } from './GradientCta'

export function PricingSection() {
  const [billing, setBilling] = useState<BillingPeriod>('monthly')

  const freeCta = (
    <Link
      href="/register"
      onClick={(e) => e.stopPropagation()}
      className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-center group-hover:border-blue-500/40 group-hover:text-foreground transition-colors')}
    >
      Get Started Free
    </Link>
  )

  const proCta = (
    <GradientCta href="/register" className="w-full h-9" onClick={(e) => e.stopPropagation()}>
      Get Pro
      <ArrowRight size={14} />
    </GradientCta>
  )

  return (
    <section id="pricing" className="py-24">
      <div className="container mx-auto max-w-6xl px-4">
        <FadeIn>
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
            <p className="mb-8 text-lg text-muted-foreground">Start free. Upgrade when you need more.</p>
            <BillingToggle billing={billing} onChange={setBilling} />
          </div>
        </FadeIn>

        <FadeIn index={1}>
          <PricingCards
            billing={billing}
            freeCta={freeCta}
            proCta={proCta}
            onCardSelect={setBilling}
          />
        </FadeIn>
      </div>
    </section>
  )
}

