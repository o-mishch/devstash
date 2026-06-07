'use client'

import type { ReactNode, KeyboardEvent } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PRICING } from '@/lib/utils/constants'

export type BillingPeriod = 'monthly' | 'yearly'

export const FREE_FEATURES = [
  { included: true,  text: '50 items total' },
  { included: true,  text: '3 collections' },
  { included: true,  text: 'Snippets, Prompts, Commands, Notes, Links' },
  { included: true,  text: 'Full-text search' },
  { included: false, text: 'File & Image uploads' },
  { included: false, text: 'AI features' },
  { included: false, text: 'Data export' },
]

export const PRO_FEATURES = [
  { included: true, text: 'Unlimited items' },
  { included: true, text: 'Unlimited collections' },
  { included: true, text: 'All item types including Files & Images' },
  { included: true, text: 'Full-text search' },
  { included: true, text: 'File & Image uploads' },
  { included: true, text: 'AI auto-tagging & summaries' },
  { included: true, text: 'Data export (JSON/ZIP)' },
]

interface FeatureRowProps {
  included: boolean
  text: string
}

function FeatureRow({ included, text }: FeatureRowProps) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {included
        ? <Check className="size-4 shrink-0 text-emerald-400" />
        : <X className="size-4 shrink-0 text-muted-foreground/50" />
      }
      <span className={included ? 'text-foreground' : 'text-foreground/50'}>{text}</span>
    </li>
  )
}

interface BillingToggleProps {
  billing: BillingPeriod
  onChange: (b: BillingPeriod) => void
}

export function BillingToggle({ billing, onChange }: BillingToggleProps) {
  const isYearly = billing === 'yearly'
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      <button
        className={cn(
          'rounded-md px-4 py-1.5 text-sm font-medium transition-all',
          !isYearly ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
        onClick={() => onChange('monthly')}
      >
        Monthly
      </button>
      <button
        className={cn(
          'flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-all',
          isYearly ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
        onClick={() => onChange('yearly')}
      >
        Yearly
        <span className={cn(
          'rounded-full px-1.5 py-0 text-sm font-medium',
          isYearly
            ? 'bg-emerald-950/70 text-emerald-400'
            : 'bg-emerald-500/20 text-emerald-400'
        )}>
          Save 25%
        </span>
      </button>
    </div>
  )
}

export interface PricingCardsProps {
  billing: BillingPeriod
  freeCta: ReactNode
  proCta: ReactNode
  /** When provided, clicking a card selects that billing period (marketing mode). */
  onCardSelect?: (b: BillingPeriod) => void
}

export function PricingCards({ billing, freeCta, proCta, onCardSelect }: PricingCardsProps) {
  const isYearly = billing === 'yearly'

  function handleCardKeyDown(e: KeyboardEvent, b: BillingPeriod) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onCardSelect?.(b)
    }
  }

  const freeCardProps = onCardSelect
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: () => onCardSelect('monthly'),
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleCardKeyDown(e, 'monthly'),
      }
    : {}

  const proCardProps = onCardSelect
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: () => onCardSelect('yearly'),
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleCardKeyDown(e, 'yearly'),
      }
    : {}

  return (
    <div className="mx-auto grid max-w-3xl gap-6 pt-3 md:grid-cols-2">
      {/* Free card — shown below Pro on mobile, left column on desktop */}
      <div
        {...freeCardProps}
        className={cn(
          'group order-2 block h-full rounded-xl border border-white/10 bg-card p-6 md:order-1',
          onCardSelect && 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-all duration-200 hover:-translate-y-1 hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/10'
        )}
      >
        <div className="mb-6">
          <div className="mb-2 text-sm font-medium text-muted-foreground">Free</div>
          <div className="flex items-end gap-1">
            <span className="text-5xl font-bold">{PRICING.free.amount}</span>
            <span className="mb-1 text-muted-foreground">/month</span>
          </div>
        </div>
        <ul className="mb-8 flex flex-col gap-3">
          {FREE_FEATURES.map(f => <FeatureRow key={f.text} {...f} />)}
        </ul>
        {freeCta}
      </div>

      {/* Pro card — shown first on mobile, right column on desktop */}
      <div
        className="pricing-pro-border relative order-1 h-full rounded-xl p-px transition-all duration-200 hover:-translate-y-1 md:order-2"
      >
        <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
          <span className="whitespace-nowrap rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-cyan-500/25">
            Recommended
          </span>
        </div>

        <div
          {...proCardProps}
          className={cn(
            'relative flex h-full flex-col overflow-hidden rounded-[11px] bg-card p-6 pt-7',
            onCardSelect && 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 transition-colors hover:bg-card/90'
          )}
        >
          <div aria-hidden className="pointer-events-none absolute left-0 top-0 h-32 w-full bg-gradient-to-b from-blue-500/8 to-transparent" />

          <div className="relative mb-6">
            <div className="mb-2 text-sm font-medium text-muted-foreground">Pro</div>
            <div className="flex items-end gap-1">
              <span className="text-5xl font-bold">
                {isYearly ? PRICING.yearly.amount : PRICING.monthly.amount}
              </span>
              <span className="mb-1 text-muted-foreground">/{isYearly ? 'year' : 'month'}</span>
            </div>
          </div>

          <ul className="relative mb-8 flex flex-1 flex-col gap-3">
            {PRO_FEATURES.map(f => <FeatureRow key={f.text} {...f} />)}
          </ul>

          <div className="relative">{proCta}</div>
        </div>
      </div>
    </div>
  )
}
