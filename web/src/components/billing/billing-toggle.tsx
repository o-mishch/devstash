import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PRICING } from '@/lib/billing-pricing'
import type { BillingPeriod } from '@/lib/billing-pricing'

interface BillingToggleProps {
  billing: BillingPeriod
  onChange: (b: BillingPeriod) => void
}

export function BillingToggle({ billing, onChange }: BillingToggleProps): ReactNode {
  const isYearly = billing === 'yearly'

  return (
    <div className="relative inline-grid grid-cols-2 rounded-lg border border-border bg-card p-1 select-none">
      {/* CSS-based slide indicator */}
      <div
        className={cn(
          'absolute top-1 bottom-1 rounded-md bg-primary transition-all duration-200 ease-out z-0',
          isYearly ? 'left-[calc(50%+4px)] right-1' : 'left-1 right-[calc(50%+4px)]',
        )}
      />

      <button
        type="button"
        aria-pressed={!isYearly}
        className={cn(
          'relative z-10 flex items-center justify-center rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-300',
          isYearly ? 'text-muted-foreground hover:text-foreground' : 'text-primary-foreground',
        )}
        onClick={() => onChange('monthly')}
      >
        <span className="relative z-10">Monthly</span>
      </button>
      <button
        type="button"
        aria-pressed={isYearly}
        className={cn(
          'relative z-10 flex items-center justify-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-300',
          isYearly ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={() => onChange('yearly')}
      >
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
