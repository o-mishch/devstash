import type { SubscriptionInterval } from '@/generated/prisma'

/** Converts a Stripe Unix timestamp (seconds) to a JS Date (milliseconds). */
export function fromStripeTs(ts: number): Date {
  return new Date(ts * 1000)
}

/** Maps a Stripe billing interval string to the SubscriptionInterval enum value. */
export function stripeIntervalToEnum(interval?: string): SubscriptionInterval | undefined {
  if (interval === 'month') return 'month'
  if (interval === 'year') return 'year'
  return undefined
}
