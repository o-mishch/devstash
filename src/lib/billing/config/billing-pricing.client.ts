import type { SubscriptionInterval } from '@/generated/prisma'

/** Display prices for marketing/settings UI — keep in sync with Stripe Price objects when amounts change. */
export const PRICING = {
  free:    { amount: '0 PLN' },
  monthly: { amount: '30 PLN',  label: '30 PLN / month' },
  yearly:  { amount: '270 PLN', label: '270 PLN / year · save 25%', savingsBadge: 'Save 25%' },
} as const

export type BillingPeriod = 'monthly' | 'yearly'

const BILLING_PERIOD_VALUES = new Set<BillingPeriod>(['monthly', 'yearly'])

/** Parses `?billing=` from marketing → upgrade navigation. Defaults to yearly. */
export function parseBillingPeriodParam(value: string | null | undefined): BillingPeriod {
  if (value && BILLING_PERIOD_VALUES.has(value as BillingPeriod)) {
    return value as BillingPeriod
  }
  return 'yearly'
}

export function billingPeriodToInterval(period: BillingPeriod): SubscriptionInterval {
  return period === 'yearly' ? 'year' : 'month'
}

export function intervalToBillingPeriod(interval: SubscriptionInterval | null | undefined): BillingPeriod {
  return interval === 'year' ? 'yearly' : 'monthly'
}

export interface SubscriptionIntervalInfo {
  label: string
  price: string
  unit: string
}

const SUBSCRIPTION_INTERVAL_INFO: Record<SubscriptionInterval, SubscriptionIntervalInfo> = {
  year: { label: 'Yearly', price: PRICING.yearly.amount, unit: 'year' },
  month: { label: 'Monthly', price: PRICING.monthly.amount, unit: 'month' },
}

const UNKNOWN_SUBSCRIPTION_INTERVAL_INFO: SubscriptionIntervalInfo = {
  label: 'Pro',
  price: '—',
  unit: '',
}

// Accepts a plain `string` (the interval as it arrives over JSON from GET /billing/context) as well as the
// typed enum; an unrecognized value falls back to the neutral "Pro" info rather than indexing undefined.
export function getSubscriptionIntervalInfo(interval: string | null): SubscriptionIntervalInfo {
  if (!interval) return UNKNOWN_SUBSCRIPTION_INTERVAL_INFO
  return SUBSCRIPTION_INTERVAL_INFO[interval as SubscriptionInterval] ?? UNKNOWN_SUBSCRIPTION_INTERVAL_INFO
}
