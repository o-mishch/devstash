'use client'

import { useCallback } from 'react'
import { cn } from '@/lib/utils'
import type { BillingPeriod } from '@/lib/billing/config/billing-pricing.client'
import { PRICING } from '@/lib/billing/config/billing-pricing.client'
import { SlideIndicator } from '@/components/shared/slide-indicator'

export type { BillingPeriod }

interface BillingToggleProps {
  billing: BillingPeriod
  onChange: (b: BillingPeriod) => void
}

export function BillingToggle({ billing, onChange }: BillingToggleProps) {
  const isYearly = billing === 'yearly'
  const handleMonthlyClick = useCallback(() => onChange('monthly'), [onChange])
  const handleYearlyClick = useCallback(() => onChange('yearly'), [onChange])
  return (
    <div className="relative inline-grid grid-cols-2 rounded-lg border border-border bg-card p-1">
      <button
        type="button"
        className={cn(
          'relative flex items-center justify-center rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-300',
          !isYearly ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={handleMonthlyClick}
      >
        {!isYearly && <SlideIndicator layoutId="billingToggleIndicator" />}
        <span className="relative z-10">Monthly</span>
      </button>
      <button
        type="button"
        className={cn(
          'relative flex items-center justify-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-300',
          isYearly ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={handleYearlyClick}
      >
        {isYearly && <SlideIndicator layoutId="billingToggleIndicator" />}
        <span className="relative z-10 flex items-center justify-center gap-2">
          Yearly
          <span
            className={cn(
              'rounded-full px-1.5 py-0 text-sm font-medium transition-colors duration-300',
              isYearly
                ? 'bg-emerald-950/70 text-emerald-400'
                : 'bg-emerald-500/20 text-emerald-400',
            )}
          >
            {PRICING.yearly.savingsBadge}
          </span>
        </span>
      </button>
    </div>
  )
}
