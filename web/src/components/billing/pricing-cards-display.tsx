import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PRICING, formatAmount } from '@/lib/billing-pricing'
import {
  PricingFeatureList,
  FREE_PRICING_FEATURES,
  PRO_PRICING_FEATURES,
} from '@/components/billing/pricing-feature-lists'

interface PricingProPriceProps {
  isYearly: boolean
}

export function PricingProPrice({ isYearly }: PricingProPriceProps): ReactNode {
  return (
    <div className="relative h-14 overflow-hidden">
      <div
        className={cn(
          'absolute inset-0 flex items-end gap-1 transition-all duration-500 ease-in-out',
          isYearly ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100',
        )}
      >
        <span className="text-5xl font-bold">{formatAmount(PRICING.monthly)}</span>
        <span className="mb-1 text-muted-foreground">/month</span>
      </div>
      <div
        className={cn(
          'absolute inset-0 flex items-end gap-1 transition-all duration-500 ease-in-out',
          isYearly ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0',
        )}
      >
        <span className="text-5xl font-bold">{formatAmount(PRICING.yearly)}</span>
        <span className="mb-1 text-muted-foreground">/year</span>
      </div>
    </div>
  )
}

interface PricingCardsDisplayProps {
  proPrice: ReactNode
  freeCta: ReactNode
  proCta: ReactNode
  freeCardClassName?: string
  proCardClassName?: string
}

export function PricingCardsDisplay({
  proPrice,
  freeCta,
  proCta,
  freeCardClassName,
  proCardClassName,
}: PricingCardsDisplayProps): ReactNode {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 pt-3 md:grid-cols-2">
      <div
        className={cn(
          'group order-2 block h-full rounded-xl border border-border bg-card p-6 md:order-1',
          freeCardClassName,
        )}
      >
        <div className="mb-6">
          <div className="mb-2 text-sm font-medium text-muted-foreground">Free</div>
          <div className="flex items-end gap-1">
            <span className="text-5xl font-bold">{formatAmount(PRICING.free)}</span>
            <span className="mb-1 text-muted-foreground">/month</span>
          </div>
        </div>
        <PricingFeatureList features={FREE_PRICING_FEATURES} />
        {freeCta}
      </div>

      <div className="relative order-1 h-full rounded-xl p-px transition-all duration-200 hover:-translate-y-1 md:order-2 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--color-blue-500)_60%,transparent),color-mix(in_oklab,var(--color-cyan-500)_40%,transparent),var(--border))]">
        <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
          <span className="whitespace-nowrap rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-cyan-500/25">
            Recommended
          </span>
        </div>

        <div
          className={cn(
            'relative flex h-full flex-col overflow-hidden rounded-[11px] bg-card p-6 pt-7',
            proCardClassName,
          )}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-32 w-full bg-gradient-to-b from-blue-500/8 to-transparent"
          />

          <div className="relative mb-6">
            <div className="mb-2 text-sm font-medium text-muted-foreground">Pro</div>
            {proPrice}
          </div>

          <div className="relative mb-8 flex flex-1 flex-col">
            <PricingFeatureList features={PRO_PRICING_FEATURES} />
          </div>

          <div className="relative">{proCta}</div>
        </div>
      </div>
    </div>
  )
}
