export const PRICING = {
  free: { price: '0', currency: 'PLN' },
  monthly: { price: '30', currency: 'PLN' },
  yearly: { price: '270', currency: 'PLN', savingsBadge: 'Save 25%' },
} as const

export interface Amount {
  price: string
  currency: string
}

/** Display form of a price. Structured `price`/`currency` stay the source of truth so
 * schema.org offers read them directly instead of re-parsing this string. */
export function formatAmount(amount: Amount): string {
  return `${amount.price} ${amount.currency}`
}

export type BillingPeriod = 'monthly' | 'yearly'
