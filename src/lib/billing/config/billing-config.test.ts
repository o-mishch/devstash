import type Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseBillingPeriodParam } from './billing-pricing'
import {
  getStripeEventDescription,
  ORPHAN_RECONCILE_INTERVAL_MS,
  REQUIRED_STRIPE_WEBHOOK_EVENTS,
  shouldPassiveSyncBilling,
  shouldRunOrphanReconcile,
  SUBSCRIPTION_DISPLAY_LIVE_CHECK_MS,
  subscriptionNeedsBillingPortalRecovery,
  validateStripeWebhookConfiguration,
} from './billing-config'
import type { StripeWebhookEndpointSummary } from './stripe-webhook-config'

const { mockWebhookEndpointsList } = vi.hoisted(() => ({
  mockWebhookEndpointsList: vi.fn<
    (params?: Stripe.WebhookEndpointListParams) => Promise<{ data: StripeWebhookEndpointSummary[] }>
  >(),
}))

vi.mock('@/lib/infra/stripe', () => ({
  stripe: {
    webhookEndpoints: {
      list: mockWebhookEndpointsList,
    },
  },
}))
import { SUBSCRIPTION_UPSERT_SOURCE_EVENTS } from '../subscription/stripe-subscription-persist'

describe('parseBillingPeriodParam', () => {
  it('parses monthly from search params', () => {
    expect(parseBillingPeriodParam('monthly')).toBe('monthly')
  })

  it('defaults to yearly for missing or invalid values', () => {
    expect(parseBillingPeriodParam(undefined)).toBe('yearly')
    expect(parseBillingPeriodParam('invalid')).toBe('yearly')
  })
})

describe('getStripeEventDescription', () => {
  it('returns the configured description for required webhook events', () => {
    expect(getStripeEventDescription('invoice.paid')).toContain('invoice payment attempt succeeds')
  })

  it('falls back to the raw event type when no description is configured', () => {
    expect(getStripeEventDescription('invoice.payment_succeeded')).toBe('invoice.payment_succeeded')
  })
})

describe('REQUIRED_STRIPE_WEBHOOK_EVENTS', () => {
  it('includes every subscription upsert source event', () => {
    for (const eventType of SUBSCRIPTION_UPSERT_SOURCE_EVENTS) {
      expect(REQUIRED_STRIPE_WEBHOOK_EVENTS).toContain(eventType)
    }
  })

  it('includes the minimum Stripe subscription webhook events', () => {
    expect(REQUIRED_STRIPE_WEBHOOK_EVENTS).toEqual(
      expect.arrayContaining([
        'checkout.session.completed',
        'invoice.paid',
        'invoice.payment_failed',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.payment_attempt_required',
        'charge.refunded',
        'charge.dispute.closed',
        'customer.deleted',
      ]),
    )
  })
})

describe('subscriptionNeedsBillingPortalRecovery', () => {
  it('returns true for billing states that block new checkout', () => {
    expect(subscriptionNeedsBillingPortalRecovery('past_due')).toBe(true)
    expect(subscriptionNeedsBillingPortalRecovery('unpaid')).toBe(true)
    expect(subscriptionNeedsBillingPortalRecovery('paused')).toBe(true)
  })

  it('returns false for active or ended subscriptions', () => {
    expect(subscriptionNeedsBillingPortalRecovery('active')).toBe(false)
    expect(subscriptionNeedsBillingPortalRecovery('canceled')).toBe(false)
    expect(subscriptionNeedsBillingPortalRecovery(null)).toBe(false)
  })
})

describe('shouldPassiveSyncBilling', () => {
  const now = Date.UTC(2026, 5, 8, 12, 0, 0)

  it('skips sync when the user has no local subscription id', () => {
    expect(shouldPassiveSyncBilling({
      email: 'user@example.com',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      isPro: false,
      stripeLastSyncAt: null,
      stripeCurrentPeriodEnd: null,
    }, now)).toBe(false)
  })

  it('skips sync when Pro state was synced recently', () => {
    expect(shouldPassiveSyncBilling({
      email: 'user@example.com',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      isPro: true,
      stripeLastSyncAt: new Date(now - 60_000),
      stripeCurrentPeriodEnd: new Date(now + 86_400_000),
    }, now)).toBe(false)
  })

  it('syncs when the last Stripe sync is older than the display threshold', () => {
    expect(shouldPassiveSyncBilling({
      email: 'user@example.com',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      isPro: true,
      stripeLastSyncAt: new Date(now - SUBSCRIPTION_DISPLAY_LIVE_CHECK_MS - 1),
      stripeCurrentPeriodEnd: new Date(now + 86_400_000),
    }, now)).toBe(true)
  })
})

describe('shouldRunOrphanReconcile', () => {
  const now = Date.UTC(2026, 5, 8, 12, 0, 0)

  it('runs when the user has email but no local subscription id', () => {
    expect(shouldRunOrphanReconcile({
      email: 'user@example.com',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      isPro: false,
      stripeLastSyncAt: null,
      stripeCurrentPeriodEnd: null,
    }, now)).toBe(true)
  })

  it('skips when orphan reconcile ran recently', () => {
    expect(shouldRunOrphanReconcile({
      email: 'user@example.com',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      isPro: false,
      stripeLastSyncAt: new Date(now - 60_000),
      stripeCurrentPeriodEnd: null,
    }, now)).toBe(false)
  })

  it('runs again after the orphan reconcile interval', () => {
    expect(shouldRunOrphanReconcile({
      email: 'user@example.com',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      isPro: false,
      stripeLastSyncAt: new Date(now - ORPHAN_RECONCILE_INTERVAL_MS - 1),
      stripeCurrentPeriodEnd: null,
    }, now)).toBe(true)
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('validateStripeWebhookConfiguration', () => {
  it('reports missing required events for the app webhook endpoint', async () => {
    mockWebhookEndpointsList.mockResolvedValue({
      data: [{
        id: 'we_123',
        url: 'https://example.com/api/webhooks/stripe',
        enabled_events: ['checkout.session.completed', 'invoice.paid'],
      }],
    })

    const result = await validateStripeWebhookConfiguration()

    expect(result.ok).toBe(false)
    expect(result.endpoints[0]?.missingEvents.length).toBeGreaterThan(0)
    expect(result.endpoints[0]?.missingEvents).toEqual(
      expect.arrayContaining(['customer.subscription.deleted']),
    )
  })

  it('passes when every required event is enabled', async () => {
    mockWebhookEndpointsList.mockResolvedValue({
      data: [{
        id: 'we_123',
        url: 'https://example.com/api/webhooks/stripe',
        enabled_events: [...REQUIRED_STRIPE_WEBHOOK_EVENTS],
      }],
    })

    const result = await validateStripeWebhookConfiguration()

    expect(result.ok).toBe(true)
    expect(result.endpoints[0]?.missingEvents).toEqual([])
  })
})

describe('getCheckoutConfig', () => {
  const originalMonthly = process.env.STRIPE_PRICE_ID_MONTHLY
  const originalYearly = process.env.STRIPE_PRICE_ID_YEARLY

  afterEach(() => {
    process.env.STRIPE_PRICE_ID_MONTHLY = originalMonthly
    process.env.STRIPE_PRICE_ID_YEARLY = originalYearly
    vi.resetModules()
  })

  it('returns configured true with both price IDs', async () => {
    process.env.STRIPE_PRICE_ID_MONTHLY = 'price_monthly'
    process.env.STRIPE_PRICE_ID_YEARLY = 'price_yearly'
    vi.resetModules()
    const { getCheckoutConfig: loadCheckoutConfig } = await import('./billing-pricing')

    expect(loadCheckoutConfig()).toEqual({
      configured: true,
      monthly: 'price_monthly',
      yearly: 'price_yearly',
    })
  })

  it('returns configured false when a price ID is missing', async () => {
    process.env.STRIPE_PRICE_ID_MONTHLY = 'price_monthly'
    process.env.STRIPE_PRICE_ID_YEARLY = ''
    vi.resetModules()
    const { getCheckoutConfig: loadCheckoutConfig } = await import('./billing-pricing')

    expect(loadCheckoutConfig()).toEqual({
      configured: false,
      monthly: 'price_monthly',
      yearly: '',
    })
  })
})
