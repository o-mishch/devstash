import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogFn } from 'pino'
import { anyOf } from '@/test/matchers'
import type {
  cancelAbandonedSubscription,
  cancelSubscriptionImmediately,
  constructStripeWebhookEvent,
  createPortalSession,
} from '@/lib/infra/stripe'
import type {
  fetchCheckoutSessionDetails,
  fetchLiveSubscriptionState,
  fetchSubscriptionDetails,
  getIntervalFromSub,
  retrieveStripeCharge,
  retrieveStripeCustomer,
} from '@/lib/billing/stripe-api'
import type { reconcileSubscriptionById } from '@/lib/billing/subscription/stripe-subscription-persist'
import type {
  clearStripeCustomerByCustomerId,
  clearStripeSubscriptionBySubId,
  resolveAppUserIdForSubscription,
  updateSubscriptionState,
  updateUserStripeSubscription,
} from '@/lib/billing/subscription/subscription-state'
import type { subscriptionShouldClearLocalLink } from '@/lib/billing/subscription/subscription-access'
import type { getUserIdByStripeCustomerId, getUserIdsByStripeSubscriptionId } from '@/lib/db/stripe'
import type { getUserById } from '@/lib/db/users'
import type {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  releaseStripeWebhookEvent,
} from '@/lib/billing/webhook/stripe-webhook-idempotency'
import type { getRedis } from '@/lib/infra/redis'
import type { sendBillingPaymentFailedEmail } from '@/lib/billing/emails/billing-payment-failed'
import type { sendBillingDisputeAdminEmail } from '@/lib/billing/emails/billing-dispute-admin'
import type { sendBillingTrialEndingEmail } from '@/lib/billing/emails/billing-trial-ending'
import type { sendBillingCheckoutPaymentFailedEmail } from '@/lib/billing/emails/billing-checkout-payment-failed'

const {
  mockConstructStripeWebhookEvent,
  mockCancelAbandonedSubscription,
  mockCreatePortalSession,
  mockFetchSubscriptionDetails,
  mockFetchCheckoutSessionDetails,
  mockFetchLiveSubscriptionState,
  mockGetIntervalFromSub,
  mockSendBillingPaymentFailedEmail,
  mockClaimStripeWebhookEvent,
  mockMarkStripeWebhookEventProcessed,
  mockReleaseStripeWebhookEvent,
  mockSubscriptionShouldClearLocalLink,
  mockUpdateUserStripeSubscription,
  mockUpdateSubscriptionState,
  mockClearStripeSubscriptionBySubId,
  mockReconcileSubscriptionById,
  mockStripeChargesRetrieve,
  mockStripeCustomersRetrieve,
  mockSendBillingDisputeAdminEmail,
  mockSendBillingTrialEndingEmail,
  mockSendBillingCheckoutPaymentFailedEmail,
  mockCancelSubscriptionImmediately,
  mockClearStripeCustomerByCustomerId,
  mockGetUserIdByStripeCustomerId,
  mockGetUserIdsByStripeSubscriptionId,
  mockResolveAppUserIdForSubscription,
} = vi.hoisted(() => ({
  mockConstructStripeWebhookEvent: vi.fn<typeof constructStripeWebhookEvent>(),
  mockCancelAbandonedSubscription: vi.fn<typeof cancelAbandonedSubscription>(),
  mockCreatePortalSession: vi.fn<typeof createPortalSession>(),
  mockFetchSubscriptionDetails: vi.fn<typeof fetchSubscriptionDetails>(),
  mockFetchCheckoutSessionDetails: vi.fn<typeof fetchCheckoutSessionDetails>(),
  mockFetchLiveSubscriptionState: vi.fn<typeof fetchLiveSubscriptionState>(),
  mockGetIntervalFromSub: vi.fn<typeof getIntervalFromSub>(),
  mockSendBillingPaymentFailedEmail: vi.fn<typeof sendBillingPaymentFailedEmail>(),
  mockClaimStripeWebhookEvent: vi.fn<typeof claimStripeWebhookEvent>(),
  mockMarkStripeWebhookEventProcessed: vi.fn<typeof markStripeWebhookEventProcessed>(),
  mockReleaseStripeWebhookEvent: vi.fn<typeof releaseStripeWebhookEvent>(),
  mockSubscriptionShouldClearLocalLink: vi.fn<typeof subscriptionShouldClearLocalLink>(),
  mockUpdateUserStripeSubscription: vi.fn<typeof updateUserStripeSubscription>(),
  mockUpdateSubscriptionState: vi.fn<typeof updateSubscriptionState>(),
  mockClearStripeSubscriptionBySubId: vi.fn<typeof clearStripeSubscriptionBySubId>(),
  mockReconcileSubscriptionById: vi.fn<typeof reconcileSubscriptionById>(),
  mockStripeChargesRetrieve: vi.fn<typeof retrieveStripeCharge>(),
  mockStripeCustomersRetrieve: vi.fn<typeof retrieveStripeCustomer>(),
  mockSendBillingDisputeAdminEmail: vi.fn<typeof sendBillingDisputeAdminEmail>(),
  mockSendBillingTrialEndingEmail: vi.fn<typeof sendBillingTrialEndingEmail>(),
  mockSendBillingCheckoutPaymentFailedEmail: vi.fn<typeof sendBillingCheckoutPaymentFailedEmail>(),
  mockCancelSubscriptionImmediately: vi.fn<typeof cancelSubscriptionImmediately>(),
  mockClearStripeCustomerByCustomerId: vi.fn<typeof clearStripeCustomerByCustomerId>(),
  mockGetUserIdByStripeCustomerId: vi.fn<typeof getUserIdByStripeCustomerId>(),
  mockGetUserIdsByStripeSubscriptionId: vi.fn<typeof getUserIdsByStripeSubscriptionId>(),
  mockResolveAppUserIdForSubscription: vi.fn<typeof resolveAppUserIdForSubscription>(),
}))

vi.mock('@/lib/infra/stripe', () => ({
  constructStripeWebhookEvent: mockConstructStripeWebhookEvent,
  cancelAbandonedSubscription: mockCancelAbandonedSubscription,
  cancelSubscriptionImmediately: mockCancelSubscriptionImmediately,
  isChargeFullyRefunded: (charge: { refunded?: boolean; amount_refunded?: number; amount?: number }) => (
    Boolean(charge.refunded) || ((charge.amount ?? 0) > 0 && (charge.amount_refunded ?? 0) >= (charge.amount ?? 0))
  ),
  createPortalSession: mockCreatePortalSession,
  stripe: {
    charges: {
      retrieve: mockStripeChargesRetrieve,
    },
    customers: {
      retrieve: mockStripeCustomersRetrieve,
    },
  },
}))

vi.mock('@/lib/billing/stripe-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/stripe-api')>()
  return {
    ...actual,
    fromStripeTs: (ts: number) => new Date(ts * 1000),
    fetchCheckoutSessionDetails: mockFetchCheckoutSessionDetails,
    fetchLiveSubscriptionState: mockFetchLiveSubscriptionState,
    fetchSubscriptionDetails: mockFetchSubscriptionDetails,
    retrieveStripeCharge: mockStripeChargesRetrieve,
    retrieveStripeCustomer: mockStripeCustomersRetrieve,
    getIntervalFromSub: mockGetIntervalFromSub,
    getPrimarySubscriptionItem: (sub: { items: { data: Array<{ current_period_end?: number }> } }) => sub.items.data[0],
    mapSubscriptionToDetails: vi.fn<typeof actual.mapSubscriptionToDetails>(),
  }
})

vi.mock('@/lib/billing/subscription/stripe-subscription-persist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/subscription/stripe-subscription-persist')>()
  return {
    ...actual,
    reconcileSubscriptionById: mockReconcileSubscriptionById,
  }
})

vi.mock('@/lib/billing/subscription/subscription-state', () => ({
  updateUserStripeSubscription: mockUpdateUserStripeSubscription,
  updateSubscriptionState: mockUpdateSubscriptionState,
  clearStripeSubscriptionBySubId: mockClearStripeSubscriptionBySubId,
  clearStripeCustomerByCustomerId: mockClearStripeCustomerByCustomerId,
  resolveAppUserIdForSubscription: mockResolveAppUserIdForSubscription,
}))

vi.mock('@/lib/db/stripe', () => ({
  getUserIdByStripeCustomerId: mockGetUserIdByStripeCustomerId,
  getUserIdsByStripeSubscriptionId: mockGetUserIdsByStripeSubscriptionId,
}))

vi.mock('@/lib/db/users', () => ({
  getUserById: vi.fn<typeof getUserById>((userId: string) => ({ id: userId })),
}))

vi.mock('@/lib/billing/webhook/stripe-webhook-idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/webhook/stripe-webhook-idempotency')>()
  return {
    ...actual,
    claimStripeWebhookEvent: mockClaimStripeWebhookEvent,
    markStripeWebhookEventProcessed: mockMarkStripeWebhookEventProcessed,
    releaseStripeWebhookEvent: mockReleaseStripeWebhookEvent,
  }
})

vi.mock('@/lib/infra/redis', () => ({
  getRedis: vi.fn<typeof getRedis>(() => null),
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn<LogFn>(), warn: vi.fn<LogFn>(), error: vi.fn<LogFn>() }) },
}))

vi.mock('@/lib/billing/emails/billing-payment-failed', () => ({
  sendBillingPaymentFailedEmail: mockSendBillingPaymentFailedEmail,
}))

vi.mock('@/lib/billing/emails/billing-dispute-admin', () => ({
  sendBillingDisputeAdminEmail: mockSendBillingDisputeAdminEmail,
}))

vi.mock('@/lib/billing/emails/billing-trial-ending', () => ({
  sendBillingTrialEndingEmail: mockSendBillingTrialEndingEmail,
}))

vi.mock('@/lib/billing/emails/billing-checkout-payment-failed', () => ({
  sendBillingCheckoutPaymentFailedEmail: mockSendBillingCheckoutPaymentFailedEmail,
}))

vi.mock('@/lib/api/route', () => ({
  publicRoute: (handler: (ctx: { request: Request }) => Promise<Response>) =>
    async (request: Request) => {
      try {
        return await handler({ request })
      } catch {
        return new Response(JSON.stringify({ message: 'Something went wrong. Please try again.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    },
}))

vi.mock('@/lib/api/http', () => ({
  json: (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  problem: (status: number, message: string, data?: unknown) =>
    new Response(JSON.stringify(data === undefined ? { message } : { message, data }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}))


import * as webhookHandlers from '@/lib/billing/webhook/stripe-webhook-event-handlers'
import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  mockCancelAbandonedSubscription.mockResolvedValue(undefined)
  mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/recover' })
  mockSendBillingPaymentFailedEmail.mockResolvedValue('sent')
  mockClaimStripeWebhookEvent.mockResolvedValue(true)
  mockMarkStripeWebhookEventProcessed.mockResolvedValue(undefined)
  mockReleaseStripeWebhookEvent.mockResolvedValue(undefined)
  mockUpdateUserStripeSubscription.mockResolvedValue(undefined)
  mockUpdateSubscriptionState.mockResolvedValue({ count: 1 })
  mockClearStripeSubscriptionBySubId.mockResolvedValue({ count: 1 })
  mockReconcileSubscriptionById.mockResolvedValue({
    status: 'active',
    currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
  })
  mockStripeChargesRetrieve.mockResolvedValue({ invoice: null })
  mockStripeCustomersRetrieve.mockResolvedValue({ email: 'user@example.com' })
  mockSendBillingDisputeAdminEmail.mockResolvedValue(true)
  mockSendBillingTrialEndingEmail.mockResolvedValue('sent')
  mockSendBillingCheckoutPaymentFailedEmail.mockResolvedValue('sent')
  mockSubscriptionShouldClearLocalLink.mockImplementation((status: string | null | undefined) => (
    status === 'incomplete_expired' || status === 'canceled'
  ))
  mockGetUserIdByStripeCustomerId.mockResolvedValue(null)
  mockGetUserIdsByStripeSubscriptionId.mockResolvedValue(['user-1'])
  mockResolveAppUserIdForSubscription.mockImplementation((input: {
    subscriptionUserId?: string | null
  }) => input.subscriptionUserId?.trim() ?? null)
})

async function postEvent(event: unknown) {
  mockConstructStripeWebhookEvent.mockReturnValue(event)

  return POST(
    new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
      headers: { 'stripe-signature': 'sig_test' },
    }) as never,
  )
}

describe('Stripe webhook route', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const response = await POST(
      new Request('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        body: '{}',
      }) as never,
    )

    expect(response.status).toBe(400)
    expect(mockConstructStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('returns 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')

    const response = await POST(
      new Request('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'sig_test' },
      }) as never,
    )

    expect(response.status).toBe(500)
    expect(mockConstructStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('returns 400 when signature verification fails', async () => {
    mockConstructStripeWebhookEvent.mockImplementation(() => {
      throw new Error('Invalid signature')
    })

    const response = await POST(
      new Request('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'sig_bad' },
      }) as never,
    )

    expect(response.status).toBe(400)
    expect(mockClaimStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('marks webhook events processed on the happy path', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'active',
      userId: 'user_123',
      cancelAtPeriodEnd: false,
    })

    const response = await postEvent({
      id: 'evt_happy',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_123',
          period_end: 1_783_200_000,
          customer: 'cus_123',
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockMarkStripeWebhookEventProcessed).toHaveBeenCalledWith('evt_happy', 'invoice.paid')
  })

  it('skips duplicate webhook events before processing side effects', async () => {
    mockClaimStripeWebhookEvent.mockResolvedValue(false)

    const response = await postEvent({
      id: 'evt_duplicate',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_123',
          period_end: 1_783_200_000,
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateSubscriptionState).not.toHaveBeenCalled()
    expect(mockMarkStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('stores the subscription but does not grant Pro on unpaid checkout completion', async () => {
    mockUpdateSubscriptionState.mockResolvedValue({ count: 0 })
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'incomplete',
      userId: 'user_123',
    })

    const response = await postEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          mode: 'subscription',
          client_reference_id: 'user_123',
          customer: 'cus_123',
          subscription: 'sub_123',
          payment_status: 'unpaid',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateUserStripeSubscription).toHaveBeenCalledWith(
      'user_123',
      expect.objectContaining({
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        isPro: false,
      }),
    )
  })

  it('grants Pro on checkout completion when payment is not required', async () => {
    mockUpdateSubscriptionState.mockResolvedValue({ count: 0 })
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'active',
      userId: 'user_123',
    })

    const response = await postEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_promo',
          mode: 'subscription',
          client_reference_id: 'user_123',
          customer: 'cus_123',
          subscription: 'sub_123',
          payment_status: 'no_payment_required',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateUserStripeSubscription).toHaveBeenCalledWith(
      'user_123',
      expect.objectContaining({
        stripeSubscriptionId: 'sub_123',
        isPro: true,
      }),
    )
  })

  it('grants Pro when async payment later succeeds', async () => {
    mockUpdateSubscriptionState.mockResolvedValue({ count: 0 })
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'active',
      userId: 'user_123',
    })

    const response = await postEvent({
      type: 'checkout.session.async_payment_succeeded',
      data: {
        object: {
          id: 'cs_123',
          mode: 'subscription',
          client_reference_id: 'user_123',
          customer: 'cus_123',
          subscription: 'sub_123',
          payment_status: 'paid',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateUserStripeSubscription).toHaveBeenCalledWith(
      'user_123',
      expect.objectContaining({
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        isPro: true,
      }),
    )
  })

  it('marks the user as Pro on invoice.paid renewals and initial settlement', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'active',
      userId: 'user_123',
      cancelAtPeriodEnd: false,
    })

    const response = await postEvent({
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_123',
          period_end: 1_783_200_000,
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({
        isPro: true,
        stripeCancelAtPeriodEnd: false,
        stripeSubscriptionInterval: 'month',
      }),
    )
  })

  it('sends a billing recovery email when invoice payment fails', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'past_due',
      userId: 'user_123',
    })

    const response = await postEvent({
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_failed',
          customer: 'cus_123',
          customer_email: 'user@example.com',
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
    expect(mockCreatePortalSession).toHaveBeenCalledWith('cus_123', expect.stringContaining('/settings'))
    expect(mockSendBillingPaymentFailedEmail).toHaveBeenCalledWith({
      invoiceId: 'in_failed',
      portalUrl: 'https://billing.stripe.com/session/recover',
      to: 'user@example.com',
    })
  })

  it('notifies the customer and clears abandoned checkout subscriptions when async payment fails', async () => {
    const response = await postEvent({
      type: 'checkout.session.async_payment_failed',
      data: {
        object: {
          id: 'cs_failed',
          customer: 'cus_123',
          customer_details: { email: 'user@example.com' },
          subscription: 'sub_incomplete',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockCreatePortalSession).toHaveBeenCalledWith('cus_123', expect.stringContaining('/settings'))
    expect(mockSendBillingCheckoutPaymentFailedEmail).toHaveBeenCalledWith({
      sessionId: 'cs_failed',
      portalUrl: 'https://billing.stripe.com/session/recover',
      to: 'user@example.com',
    })
    expect(mockCancelAbandonedSubscription).toHaveBeenCalledWith('sub_incomplete')
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith('sub_incomplete', anyOf(Date))
  })

  it('clears abandoned checkout subscriptions when the session expires', async () => {
    const response = await postEvent({
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired',
          customer: 'cus_123',
          subscription: 'sub_incomplete',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockCancelAbandonedSubscription).toHaveBeenCalledWith('sub_incomplete')
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith('sub_incomplete', anyOf(Date))
  })

  it('backfills the local subscription from customer.subscription.created metadata', async () => {
    mockUpdateSubscriptionState.mockResolvedValueOnce({ count: 0 })
    mockGetIntervalFromSub.mockReturnValue('month')

    const response = await postEvent({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_created',
          status: 'trialing',
          customer: 'cus_123',
          start_date: 1_780_876_800,
          metadata: { userId: 'user_123' },
          items: {
            data: [{
              current_period_end: 1_783_200_000,
            }],
          },
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateUserStripeSubscription).toHaveBeenCalledWith(
      'user_123',
      expect.objectContaining({
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_created',
        isPro: true,
      }),
    )
  })

  it('retains the local subscription link when customer.subscription.created is incomplete', async () => {
    mockGetIntervalFromSub.mockReturnValue('month')
    mockUpdateSubscriptionState.mockResolvedValueOnce({ count: 1 })

    const response = await postEvent({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_incomplete',
          status: 'incomplete',
          customer: 'cus_123',
          start_date: 1_780_876_800,
          metadata: { userId: 'user_123' },
          items: {
            data: [{
              current_period_end: 1_783_200_000,
            }],
          },
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_incomplete',
      expect.objectContaining({
        isPro: false,
      }),
    )
    expect(mockClearStripeSubscriptionBySubId).not.toHaveBeenCalled()
  })

  it('does not grant Pro on invoice.paid when the subscription is no longer entitled', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'unpaid',
      userId: 'user_123',
    })

    const response = await postEvent({
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_stale',
          period_end: 1_783_200_000,
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
    expect(mockUpdateSubscriptionState).not.toHaveBeenCalled()
    expect(mockUpdateUserStripeSubscription).not.toHaveBeenCalled()
  })

  it('revokes access when Stripe emits customer.subscription.paused', async () => {
    mockGetIntervalFromSub.mockReturnValue('month')

    const response = await postEvent({
      type: 'customer.subscription.paused',
      data: {
        object: {
          id: 'sub_paused',
          status: 'paused',
          items: {
            data: [{ current_period_end: 1_783_200_000 }],
          },
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_paused',
      expect.objectContaining({
        isPro: false,
        stripeCurrentPeriodEnd: new Date(1_783_200_000 * 1000),
        stripeSubscriptionInterval: 'month',
      }),
    )
  })

  it('backfills the local subscription when invoice.paid arrives before checkout completion', async () => {
    mockUpdateSubscriptionState.mockResolvedValueOnce({ count: 0 })
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'active',
      userId: 'user_123',
    })

    const response = await postEvent({
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_456',
          customer: 'cus_123',
          period_end: 1_783_200_000,
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateUserStripeSubscription).toHaveBeenCalledWith(
      'user_123',
      expect.objectContaining({
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        isPro: true,
      }),
    )
  })

  it('revokes access when a subscription update moves to a non-entitled state', async () => {
    mockGetIntervalFromSub.mockReturnValue('month')

    const response = await postEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          status: 'paused',
          items: {
            data: [{ current_period_end: 1_783_200_000 }],
          },
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({
        isPro: false,
        stripeCurrentPeriodEnd: new Date(1_783_200_000 * 1000),
        stripeSubscriptionInterval: 'month',
      }),
    )
    expect(mockClearStripeSubscriptionBySubId).not.toHaveBeenCalled()
  })

  it('restores a resumed subscription even when the local row was previously cleared', async () => {
    mockUpdateSubscriptionState.mockResolvedValueOnce({ count: 0 })
    mockGetIntervalFromSub.mockReturnValue('month')

    const response = await postEvent({
      type: 'customer.subscription.resumed',
      data: {
        object: {
          id: 'sub_resumed',
          status: 'active',
          customer: 'cus_123',
          start_date: 1_780_876_800,
          metadata: { userId: 'user_123' },
          items: {
            data: [{
              current_period_end: 1_783_200_000,
            }],
          },
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateUserStripeSubscription).toHaveBeenCalledWith(
      'user_123',
      expect.objectContaining({
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_resumed',
        isPro: true,
      }),
    )
  })

  it('revokes access when Stripe emits customer.subscription.deleted', async () => {
    const response = await postEvent({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_deleted',
          items: {
            data: [{ current_period_end: 1_783_200_000 }],
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith(
      'sub_deleted',
      new Date(1_783_200_000 * 1000),
    )
    expect(mockUpdateUserStripeSubscription).not.toHaveBeenCalled()
  })

  it('acknowledges invoice.payment_succeeded without mutating local subscription state', async () => {
    const response = await postEvent({
      id: 'evt_123',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_succeeded',
          period_end: 1_783_200_000,
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateSubscriptionState).not.toHaveBeenCalled()
    expect(mockUpdateUserStripeSubscription).not.toHaveBeenCalled()
    expect(mockMarkStripeWebhookEventProcessed).toHaveBeenCalledWith('evt_123', 'invoice.payment_succeeded')
  })

  it('sends a billing recovery email when invoice payment action is required', async () => {
    const response = await postEvent({
      type: 'invoice.payment_action_required',
      data: {
        object: {
          id: 'in_action_required',
          customer: 'cus_123',
          customer_email: 'user@example.com',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockCreatePortalSession).toHaveBeenCalledWith('cus_123', expect.stringContaining('/settings'))
    expect(mockSendBillingPaymentFailedEmail).toHaveBeenCalledWith({
      invoiceId: 'in_action_required',
      portalUrl: 'https://billing.stripe.com/session/recover',
      to: 'user@example.com',
    })
  })

  it('reconciles subscription state when a pending update is applied', async () => {
    mockGetIntervalFromSub.mockReturnValue('year')

    const response = await postEvent({
      type: 'customer.subscription.pending_update_applied',
      data: {
        object: {
          id: 'sub_updated',
          status: 'active',
          items: {
            data: [{ current_period_end: 1_783_200_000 }],
          },
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_updated',
      expect.objectContaining({
        isPro: true,
        stripeCurrentPeriodEnd: new Date(1_783_200_000 * 1000),
        stripeSubscriptionInterval: 'year',
      }),
    )
  })

  it('reconciles subscription state when a trial is about to end', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'trialing',
      userId: 'user_123',
    })

    const response = await postEvent({
      type: 'customer.subscription.trial_will_end',
      data: {
        object: {
          id: 'sub_trial',
          status: 'trialing',
          trial_end: 1_783_200_000,
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_trial')
    expect(mockUpdateSubscriptionState).not.toHaveBeenCalled()
  })

  it('ignores non-subscription checkout sessions', async () => {
    const response = await postEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_payment',
          mode: 'payment',
          client_reference_id: 'user_123',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateUserStripeSubscription).not.toHaveBeenCalled()
  })

  it('reconciles subscription state after a partial charge refund', async () => {
    const response = await postEvent({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_refunded',
          amount: 1200,
          amount_refunded: 500,
          refunded: false,
          invoice: {
            parent: { subscription_details: { subscription: 'sub_123' } },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockCancelSubscriptionImmediately).not.toHaveBeenCalled()
    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
  })

  it('reconciles and revokes access after a full charge refund when still entitled', async () => {
    const response = await postEvent({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_refunded',
          amount: 1200,
          amount_refunded: 1200,
          refunded: true,
          invoice: {
            parent: { subscription_details: { subscription: 'sub_123' } },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockCancelSubscriptionImmediately).toHaveBeenCalledWith('sub_123')
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith('sub_123', anyOf(Date))
  })

  it('handles customer.updated by logging the change and ignoring DB writes because app email is the source of truth', async () => {
    const response = await postEvent({
      type: 'customer.updated',
      data: {
        object: {
          id: 'cus_updated',
          object: 'customer',
          email: 'billing@example.com',
          metadata: { userId: 'user_123' },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockGetUserIdByStripeCustomerId).not.toHaveBeenCalled()
  })

  it('defers period-end writes on routine customer.subscription.updated renewals', async () => {
    mockGetIntervalFromSub.mockReturnValue('month')

    const response = await postEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_renewed',
          status: 'active',
          customer: 'cus_123',
          start_date: 1_780_876_800,
          metadata: { userId: 'user_123' },
          items: {
            data: [{ current_period_end: 1_783_200_000 }],
          },
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_renewed',
      expect.not.objectContaining({
        stripeCurrentPeriodEnd: anyOf(Date),
      }),
    )
  })

  it('clears local billing links when Stripe deletes a customer', async () => {
    const response = await postEvent({
      type: 'customer.deleted',
      data: {
        object: {
          id: 'cus_deleted',
          object: 'customer',
          deleted: true,
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockClearStripeCustomerByCustomerId).toHaveBeenCalledWith('cus_deleted')
  })

  it('alerts admins and reconciles subscription state when a dispute is created', async () => {
    mockStripeChargesRetrieve.mockResolvedValue({
      id: 'ch_disputed',
      invoice: {
        parent: { subscription_details: { subscription: 'sub_123' } },
      },
    })

    const response = await postEvent({
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_created',
          charge: 'ch_disputed',
          amount: 1200,
          currency: 'usd',
          reason: 'fraudulent',
          status: 'needs_response',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockSendBillingDisputeAdminEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: 'dp_created',
        chargeId: 'ch_disputed',
        subscriptionId: 'sub_123',
      }),
    )
    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
  })

  it('reconciles subscription state when a dispute is won', async () => {
    mockStripeChargesRetrieve.mockResolvedValue({
      id: 'ch_disputed',
      invoice: {
        parent: { subscription_details: { subscription: 'sub_123' } },
      },
    })

    const response = await postEvent({
      type: 'charge.dispute.closed',
      data: {
        object: {
          id: 'dp_won',
          charge: 'ch_disputed',
          status: 'won',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockStripeChargesRetrieve).toHaveBeenCalledWith('ch_disputed')
    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
    expect(mockCancelSubscriptionImmediately).not.toHaveBeenCalled()
  })

  it('reconciles and revokes access when a dispute is lost and subscription stays entitled', async () => {
    mockStripeChargesRetrieve.mockResolvedValue({
      id: 'ch_disputed',
      invoice: {
        parent: { subscription_details: { subscription: 'sub_123' } },
      },
    })
    mockSubscriptionShouldClearLocalLink.mockReturnValue(true)

    const response = await postEvent({
      type: 'charge.dispute.closed',
      data: {
        object: {
          id: 'dp_closed',
          charge: 'ch_disputed',
          status: 'lost',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockStripeChargesRetrieve).toHaveBeenCalledWith('ch_disputed')
    expect(mockCancelSubscriptionImmediately).toHaveBeenCalledWith('sub_123')
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith('sub_123', anyOf(Date))
  })

  it('sends a billing recovery email when invoice payment attempt is required', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'past_due',
      userId: 'user_123',
    })

    const response = await postEvent({
      type: 'invoice.payment_attempt_required',
      data: {
        object: {
          id: 'in_attempt_required',
          customer: 'cus_123',
          customer_email: 'user@example.com',
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockSendBillingPaymentFailedEmail).toHaveBeenCalled()
  })

  it('reconciles subscription state when pending update expires', async () => {
    mockGetIntervalFromSub.mockReturnValue('year')

    const response = await postEvent({
      type: 'customer.subscription.pending_update_expired',
      data: {
        object: {
          id: 'sub_pending_expired',
          status: 'active',
          items: {
            data: [{ current_period_end: 1_783_200_000 }],
          },
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_pending_expired',
      expect.objectContaining({
        isPro: true,
        stripeCurrentPeriodEnd: new Date(1_783_200_000 * 1000),
        stripeSubscriptionInterval: 'year',
      }),
    )
    expect(mockCreatePortalSession).not.toHaveBeenCalled()
    expect(mockSendBillingPaymentFailedEmail).not.toHaveBeenCalled()
  })

  it('releases the webhook claim when checkout completion cannot resolve the app user', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'active',
      userId: null,
    })

    const response = await postEvent({
      id: 'evt_checkout_retry',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_orphan',
          mode: 'subscription',
          customer: 'cus_123',
          subscription: 'sub_123',
          payment_status: 'paid',
        },
      },
    })

    expect(response.status).toBe(500)
    expect(mockReleaseStripeWebhookEvent).toHaveBeenCalledWith('evt_checkout_retry')
    expect(mockMarkStripeWebhookEventProcessed).not.toHaveBeenCalled()
    expect(mockUpdateUserStripeSubscription).not.toHaveBeenCalled()
  })

  it('retries when handler fails permanently and releases the claim', async () => {
    const processSpy = vi.spyOn(webhookHandlers, 'processStripeWebhookEvent').mockRejectedValueOnce(new Error('permanent failure'))

    const response = await postEvent({
      id: 'evt_permanent',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_perm',
          period_end: 1_783_200_000,
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(500)
    expect(mockReleaseStripeWebhookEvent).toHaveBeenCalledWith('evt_permanent')
    expect(mockMarkStripeWebhookEventProcessed).not.toHaveBeenCalled()
    processSpy.mockRestore()
  })

  it('retries when processed mark fails after a successful handler', async () => {
    mockMarkStripeWebhookEventProcessed.mockRejectedValueOnce(
      new Error('Failed to mark webhook event evt_mark_failed as processed'),
    )

    const response = await postEvent({
      id: 'evt_mark_failed',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_mark_failed',
          period_end: 1_783_200_000,
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(500)
    expect(mockMarkStripeWebhookEventProcessed).toHaveBeenCalledWith('evt_mark_failed', 'invoice.paid')
    expect(mockReleaseStripeWebhookEvent).toHaveBeenCalledWith('evt_mark_failed')
  })

  it('retries invoice.paid when customer exists but no linkable app user exists', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'cus_123',
      interval: 'month',
      status: 'active',
      userId: null,
      cancelAtPeriodEnd: false,
    })
    mockUpdateSubscriptionState.mockResolvedValue({ count: 0 })

    const response = await postEvent({
      id: 'evt_invoice_orphan',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_orphan',
          period_end: 1_783_200_000,
          customer: 'cus_123',
          parent: {
            subscription_details: {
              subscription: 'sub_123',
            },
          },
        },
      },
    })

    expect(response.status).toBe(500)
    expect(mockReleaseStripeWebhookEvent).toHaveBeenCalledWith('evt_invoice_orphan')
    expect(mockMarkStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })
})
