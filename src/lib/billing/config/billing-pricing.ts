import 'server-only'

export const REQUIRED_STRIPE_PRICE_ENV_KEYS = ['STRIPE_PRICE_ID_MONTHLY', 'STRIPE_PRICE_ID_YEARLY'] as const

export {
  PRICING,
  billingPeriodToInterval,
  getSubscriptionIntervalInfo,
  intervalToBillingPeriod,
  parseBillingPeriodParam,
  type BillingPeriod,
  type SubscriptionIntervalInfo,
} from './billing-pricing.client'

function buildAllowedCheckoutPriceIds(): Set<string> {
  return new Set(
    [
      process.env.STRIPE_PRICE_ID_MONTHLY,
      process.env.STRIPE_PRICE_ID_YEARLY,
    ].filter((value): value is string => Boolean(value)),
  )
}

let allowedCheckoutPriceIds: Set<string> | null = null

export function getAllowedCheckoutPriceIds(): Set<string> {
  allowedCheckoutPriceIds ??= buildAllowedCheckoutPriceIds()
  return allowedCheckoutPriceIds
}

export function isAllowedCheckoutPriceId(priceId: string): boolean {
  return getAllowedCheckoutPriceIds().has(priceId)
}

export interface CheckoutPriceIds {
  monthly: string | undefined
  yearly: string | undefined
}

function readCheckoutPriceIds(): CheckoutPriceIds {
  return {
    monthly: process.env.STRIPE_PRICE_ID_MONTHLY,
    yearly: process.env.STRIPE_PRICE_ID_YEARLY,
  }
}

/** Whether both monthly and yearly Stripe price IDs are configured for checkout. */
export function isStripeCheckoutConfigured(): boolean {
  return getAllowedCheckoutPriceIds().size === REQUIRED_STRIPE_PRICE_ENV_KEYS.length
}

export interface CheckoutConfig extends CheckoutPriceIds {
  configured: boolean
}

/** Checkout price IDs and whether upgrade checkout is available — for settings and upgrade UI. */
export function getCheckoutConfig(): CheckoutConfig {
  const { monthly, yearly } = readCheckoutPriceIds()
  return {
    configured: isStripeCheckoutConfigured(),
    monthly,
    yearly,
  }
}
