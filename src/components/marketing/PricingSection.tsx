'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FadeIn } from './FadeIn';
import { GradientCta } from './GradientCta';

type BillingPeriod = 'monthly' | 'yearly';

const FREE_FEATURES = [
  { included: true,  text: '50 items total' },
  { included: true,  text: '3 collections' },
  { included: true,  text: 'Snippets, Prompts, Commands, Notes, Links' },
  { included: true,  text: 'Full-text search' },
  { included: false, text: 'File & Image uploads' },
  { included: false, text: 'AI features' },
  { included: false, text: 'Data export' },
];

const PRO_FEATURES = [
  { included: true, text: 'Unlimited items' },
  { included: true, text: 'Unlimited collections' },
  { included: true, text: 'All item types including Files & Images' },
  { included: true, text: 'Full-text search' },
  { included: true, text: 'File & Image uploads' },
  { included: true, text: 'AI auto-tagging & summaries' },
  { included: true, text: 'Data export (JSON/ZIP)' },
];

const PRICING = {
  free: '0 PLN',
  monthly: '30 PLN',
  yearly: '270 PLN',
};

interface FeatureRowProps {
  included: boolean;
  text: string;
}

function FeatureRow({ included, text }: FeatureRowProps) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={included ? 'font-bold text-emerald-400' : 'text-muted-foreground'}>
        {included ? '✓' : '✕'}
      </span>
      <span className={included ? 'text-foreground' : 'text-foreground/60'}>{text}</span>
    </li>
  );
}

export function PricingSection() {
  const [billing, setBilling] = useState<BillingPeriod>('monthly');
  const isYearly = billing === 'yearly';

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
            <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
              <button
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                  !isYearly ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setBilling('monthly')}
              >
                Monthly
              </button>
              <button
                className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                  isYearly ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setBilling('yearly')}
              >
                Yearly
                <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                  isYearly ? 'bg-emerald-500/20 text-emerald-700' : 'bg-emerald-500/20 text-emerald-400'
                }`}>
                  Save 25%
                </span>
              </button>
            </div>
          </div>
        </FadeIn>

        <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">

          <FadeIn index={0}>
            <div 
              role="button"
              tabIndex={0}
              className="cursor-pointer group block h-full rounded-xl border border-white/10 bg-card p-6 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-all duration-200 hover:-translate-y-1 hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/10"
              onClick={() => setBilling('monthly')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setBilling('monthly')
                }
              }}
            >
              <div className="mb-6">
                <div className="mb-2 text-sm font-medium text-muted-foreground">Free</div>
                <div className="flex items-end gap-1">
                  <span className="text-5xl font-bold">{PRICING.free}</span>
                  <span className="mb-1 text-muted-foreground">/month</span>
                </div>
              </div>
              <ul className="mb-8 flex flex-col gap-3">
                {FREE_FEATURES.map(f => (
                  <FeatureRow key={f.text} {...f} />
                ))}
              </ul>
              <Link 
                href="/register" 
                onClick={(e) => e.stopPropagation()}
                className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-center group-hover:border-blue-500/40 group-hover:text-foreground transition-colors')}
              >
                Get Started Free
              </Link>
            </div>
          </FadeIn>

          <FadeIn index={1}>
            {/* Outer wrapper: relative so badge can be positioned here, no overflow-hidden */}
            <div
              className="relative h-full rounded-xl p-px transition-all duration-200 hover:-translate-y-1"
              style={{ background: 'linear-gradient(to bottom, rgba(59,130,246,0.6), rgba(6,182,212,0.4), rgba(255,255,255,0.06))' }}
            >
              {/* Badge on outer wrapper — not clipped */}
              <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
                <span className="whitespace-nowrap rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-cyan-500/25">
                  Most Popular
                </span>
              </div>

              {/* Inner card — overflow-hidden only clips the top glow, not the badge */}
              <div 
                role="button"
                tabIndex={0}
                className="cursor-pointer relative flex h-full flex-col overflow-hidden rounded-[11px] bg-card p-6 pt-7 outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 transition-colors hover:bg-card/90"
                onClick={() => setBilling('yearly')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setBilling('yearly')
                  }
                }}
              >
                {/* Subtle top glow inside */}
                <div aria-hidden className="pointer-events-none absolute left-0 top-0 h-32 w-full bg-gradient-to-b from-blue-500/8 to-transparent" />

                <div className="relative mb-6">
                  <div className="mb-2 text-sm font-medium text-muted-foreground">Pro</div>
                  <div className="flex items-end gap-1">
                    <span className="text-5xl font-bold">{isYearly ? PRICING.yearly : PRICING.monthly}</span>
                    <span className="mb-1 text-muted-foreground">/{isYearly ? 'year' : 'month'}</span>
                  </div>
                </div>

                <ul className="relative mb-8 flex flex-1 flex-col gap-3">
                  {PRO_FEATURES.map(f => (
                    <FeatureRow key={f.text} {...f} />
                  ))}
                </ul>

                <GradientCta href="/register" className="relative w-full h-9" onClick={(e) => e.stopPropagation()}>
                  Start Pro Trial
                  <ArrowRight size={14} />
                </GradientCta>
              </div>
            </div>
          </FadeIn>

        </div>
      </div>
    </section>
  );
}
