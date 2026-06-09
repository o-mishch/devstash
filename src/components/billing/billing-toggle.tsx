'use client'

import { cn } from '@/lib/utils'
import type { BillingPeriod } from '@/lib/billing/config/billing-pricing.client'
import { PRICING } from '@/lib/billing/config/billing-pricing.client'

export type { BillingPeriod }

interface BillingToggleProps {
  billing: BillingPeriod
  onChange: (b: BillingPeriod) => void
}

export function BillingToggle({ billing, onChange }: BillingToggleProps) {
  const isYearly = billing === 'yearly'
  return (
    <div className="relative inline-grid grid-cols-2 rounded-lg border border-border bg-card p-1">
      <div
        className={cn(
          'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-primary transition-transform duration-300 ease-in-out',
          isYearly && 'translate-x-[calc(100%+0.25rem)]',
        )}
      />
      <button
        type="button"
        className={cn(
          'relative z-10 rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-300',
          !isYearly ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={() => onChange('monthly')}
      >
        Monthly
      </button>
      <button
        type="button"
        className={cn(
          'relative z-10 flex items-center justify-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-300',
          isYearly ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={() => onChange('yearly')}
      >
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
      </button>
    </div>
  )
}
