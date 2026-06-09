import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

const {
  mockFetchSubscriptionDetails,
  mockPersistSubscriptionFromStripe,
  mockResolveAppUserIdForSubscription,
  mockCancelSubscriptionImmediately,
  mockIsChargeFullyRefunded,
  mockStripeChargesRetrieve,
  mockReconcileSubscriptionById,
  mockApplySubscriptionStateWithBackfill,
  mockClearStripeSubscriptionBySubId,
  mockSendBillingDisputeAdminEmail,
  mockCreatePortalSession,
  mockSendBillingPaymentFailedEmail,
  mockSendBillingTrialEndingEmail,
  mockStripeCustomersRetrieve,
  mockUpsertSubscriptionStateFromObject,
  mockClearStripeCustomerByCustomerId,
  mockGetUserIdByStripeCustomerId,
} = vi.hoisted(() => ({
  mockFetchSubscriptionDetails: vi.fn(),
  mockPersistSubscriptionFromStripe: vi.fn(),
  mockResolveAppUserIdForSubscription: vi.fn(),
  mockCancelSubscriptionImmediately: vi.fn(),
  mockIsChargeFullyRefunded: vi.fn(),
  mockStripeChargesRetrieve: vi.fn(),
  mockReconcileSubscriptionById: vi.fn(),
  mockApplySubscriptionStateWithBackfill: vi.fn(),
  mockClearStripeSubscriptionBySubId: vi.fn(),
  mockSendBillingDisputeAdminEmail: vi.fn(),
  mockCreatePortalSession: vi.fn(),
  mockSendBillingPaymentFailedEmail: vi.fn(),
  mockSendBillingTrialEndingEmail: vi.fn(),
  mockStripeCustomersRetrieve: vi.fn(),
  mockUpsertSubscriptionStateFromObject: vi.fn(),
  mockClearStripeCustomerByCustomerId: vi.fn(),
  mockGetUserIdByStripeCustomerId: vi.fn(),
}))

vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/lib/billing/stripe-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/stripe-api')>()
  return {
    ...actual,
    fetchSubscriptionDetails: mockFetchSubscriptionDetails,
    retrieveStripeCharge: mockStripeChargesRetrieve,
    retrieveStripeCustomer: mockStripeCustomersRetrieve,
  }
})

vi.mock('@/lib/stripe', () => ({
  cancelAbandonedSubscription: vi.fn(),
  cancelSubscriptionImmediately: mockCancelSubscriptionImmediately,
  createPortalSession: mockCreatePortalSession,
  isChargeFullyRefunded: mockIsChargeFullyRefunded,
  stripe: {
    charges: {
      retrieve: mockStripeChargesRetrieve,
    },
  },
}))

vi.mock('@/lib/billing/subscription/stripe-subscription-persist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/subscription/stripe-subscription-persist')>()
  return {
    ...actual,
    applySubscriptionStateWithBackfill: mockApplySubscriptionStateWithBackfill,
    persistSubscriptionFromStripe: mockPersistSubscriptionFromStripe,
    reconcileSubscriptionById: mockReconcileSubscriptionById,
    upsertSubscriptionStateFromObject: mockUpsertSubscriptionStateFromObject,
  }
})

vi.mock('@/lib/billing/subscription/subscription-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/subscription/subscription-state')>()
  return {
    ...actual,
    clearStripeSubscriptionBySubId: mockClearStripeSubscriptionBySubId,
    clearStripeCustomerByCustomerId: mockClearStripeCustomerByCustomerId,
    resolveAppUserIdForSubscription: mockResolveAppUserIdForSubscription,
  }
})

vi.mock('@/lib/db/stripe', () => ({
  getUserIdByStripeCustomerId: mockGetUserIdByStripeCustomerId,
}))

vi.mock('@/lib/billing/emails/billing-payment-failed', () => ({
  sendBillingPaymentFailedEmail: mockSendBillingPaymentFailedEmail,
}))

vi.mock('@/lib/billing/emails/billing-checkout-payment-failed', () => ({
  sendBillingCheckoutPaymentFailedEmail: vi.fn(),
}))

vi.mock('@/lib/billing/emails/billing-trial-ending', () => ({
  sendBillingTrialEndingEmail: mockSendBillingTrialEndingEmail,
}))

vi.mock('@/lib/utils/url', () => ({
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('@/lib/billing/emails/billing-dispute-admin', () => ({
  sendBillingDisputeAdminEmail: mockSendBillingDisputeAdminEmail,
}))

import {
  getSubscriptionIdFromInvoice,
  handleChargeDisputeClosed,
  handleChargeRefunded,
  handleCheckoutSessionCompleted,
  handleCustomerDeleted,
  handleInvoiceBillingRecovery,
  handleInvoicePaid,
  handleSubscriptionDeleted,
  handleSubscriptionTrialWillEnd,
  processStripeWebhookEvent,
} from './stripe-webhook-event-handlers'
import { SUBSCRIPTION_UPSERT_SOURCE_EVENTS } from '../subscription/stripe-subscription-persist'

const periodEnd = new Date('2026-07-01T00:00:00.000Z')

const activeSubscription = {
  status: 'active' as const,
  userId: 'user-1',
  customerId: 'cus_123',
  currentPeriodEnd: periodEnd,
  cancelAtPeriodEnd: false,
  interval: 'month' as const,
  startDate: new Date('2026-01-01T00:00:00.000Z'),
}

function makeSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_123',
    mode: 'subscription',
    subscription: 'sub_123',
    customer: 'cus_123',
    client_reference_id: 'user-1',
    payment_status: 'paid',
    ...overrides,
  } as Stripe.Checkout.Session
}

function makeCharge(overrides: Partial<Stripe.Charge> = {}): Stripe.Charge {
  return {
    id: 'ch_123',
    amount: 1000,
    amount_refunded: 0,
    invoice: {
      parent: { subscription_details: { subscription: 'sub_123' } },
    } as Stripe.Invoice,
    ...overrides,
  } as Stripe.Charge
}

function makeInvoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: 'inv_123',
    customer: 'cus_123',
    period_end: Math.floor(periodEnd.getTime() / 1000),
    parent: { subscription_details: { subscription: 'sub_123' } },
    ...overrides,
  } as Stripe.Invoice
}

function makeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_123',
    status: 'trialing',
    customer: 'cus_123',
    trial_end: 1_749_403_200,
    items: {
      data: [{
        current_period_end: 1_749_403_200,
        price: { id: 'price_monthly', recurring: { interval: 'month' } },
      }],
    },
    ...overrides,
  } as Stripe.Subscription
}

describe('getSubscriptionIdFromInvoice', () => {
  it('reads the subscription from the invoice parent field', () => {
    const invoice = {
      parent: { subscription_details: { subscription: 'sub_parent' } },
    } as Stripe.Invoice

    expect(getSubscriptionIdFromInvoice(invoice)).toBe('sub_parent')
  })

  it('falls back to the legacy invoice.subscription field', () => {
    const invoice = {
      subscription: 'sub_legacy',
    } as Stripe.Invoice & { subscription: string }

    expect(getSubscriptionIdFromInvoice(invoice)).toBe('sub_legacy')
  })

  it('falls back to subscription line items', () => {
    const invoice = {
      lines: {
        data: [{
          parent: { subscription_item_details: { subscription: 'sub_line' } },
        }],
      },
    } as Stripe.Invoice

    expect(getSubscriptionIdFromInvoice(invoice)).toBe('sub_line')
  })

  it('falls back to invoice item line parent subscription', () => {
    const invoice = {
      lines: {
        data: [{
          parent: { invoice_item_details: { subscription: 'sub_invoice_item' } },
        }],
      },
    } as Stripe.Invoice

    expect(getSubscriptionIdFromInvoice(invoice)).toBe('sub_invoice_item')
  })
})

describe('handleCheckoutSessionCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchSubscriptionDetails.mockResolvedValue({ userId: 'user-1' })
    mockPersistSubscriptionFromStripe.mockResolvedValue({
      persisted: true,
      grantsAccess: true,
      outcome: 'updated',
    })
  })

  it('persists subscription when checkout session belongs to a user', async () => {
    await handleCheckoutSessionCompleted(makeSession(), false)

    expect(mockPersistSubscriptionFromStripe).toHaveBeenCalledWith(
      'user-1',
      'sub_123',
      'cus_123',
      false,
      'paid',
    )
  })

  it('retries when subscription id is missing from the session', async () => {
    await expect(
      handleCheckoutSessionCompleted(makeSession({ subscription: null }), false),
    ).rejects.toThrow(Error)
  })

  it('retries when app user cannot be resolved', async () => {
    mockResolveAppUserIdForSubscription.mockResolvedValue(null)

    await expect(
      handleCheckoutSessionCompleted(makeSession({ client_reference_id: null }), false),
    ).rejects.toThrow(Error)
  })

  it('retries when persist fails', async () => {
    mockPersistSubscriptionFromStripe.mockResolvedValue({
      persisted: false,
      grantsAccess: false,
      outcome: null,
    })

    await expect(handleCheckoutSessionCompleted(makeSession(), false))
      .rejects.toThrow(Error)
  })
})

describe('handleChargeRefunded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchSubscriptionDetails.mockResolvedValue({
      status: 'active',
      currentPeriodEnd: periodEnd,
    })
    mockReconcileSubscriptionById.mockResolvedValue({ status: 'active' })
    mockClearStripeSubscriptionBySubId.mockResolvedValue({ count: 1 })
    mockCancelSubscriptionImmediately.mockResolvedValue(undefined)
  })

  it('returns early when charge has no linked subscription', async () => {
    await handleChargeRefunded(makeCharge({ invoice: null }))

    expect(mockCancelSubscriptionImmediately).not.toHaveBeenCalled()
    expect(mockReconcileSubscriptionById).not.toHaveBeenCalled()
  })

  it('cancels Stripe subscription and revokes local access on a full refund when still entitled', async () => {
    mockIsChargeFullyRefunded.mockReturnValue(true)
    mockReconcileSubscriptionById.mockResolvedValue({ status: 'active', currentPeriodEnd: periodEnd })

    await handleChargeRefunded(makeCharge({ amount_refunded: 1000 }))

    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
    expect(mockCancelSubscriptionImmediately).toHaveBeenCalledWith('sub_123')
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith('sub_123', periodEnd)
  })

  it('reconciles without clearing when full refund leaves subscription entitled', async () => {
    mockIsChargeFullyRefunded.mockReturnValue(true)
    mockReconcileSubscriptionById.mockResolvedValue({ status: 'canceled' })

    await handleChargeRefunded(makeCharge({ amount_refunded: 1000 }))

    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
    expect(mockClearStripeSubscriptionBySubId).not.toHaveBeenCalled()
  })

  it('reconciles without revoking on a partial refund', async () => {
    mockIsChargeFullyRefunded.mockReturnValue(false)

    await handleChargeRefunded(makeCharge({ amount_refunded: 500 }))

    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
    expect(mockCancelSubscriptionImmediately).not.toHaveBeenCalled()
    expect(mockClearStripeSubscriptionBySubId).not.toHaveBeenCalled()
  })
})

describe('handleChargeDisputeClosed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStripeChargesRetrieve.mockResolvedValue(makeCharge())
    mockFetchSubscriptionDetails.mockResolvedValue({
      status: 'active',
      currentPeriodEnd: periodEnd,
    })
    mockClearStripeSubscriptionBySubId.mockResolvedValue({ count: 1 })
    mockCancelSubscriptionImmediately.mockResolvedValue(undefined)
    mockReconcileSubscriptionById.mockResolvedValue({ status: 'active' })
  })

  it('revokes local access when dispute is lost', async () => {
    mockReconcileSubscriptionById.mockResolvedValue({ status: 'active', currentPeriodEnd: periodEnd })

    await handleChargeDisputeClosed({
      id: 'dp_123',
      charge: 'ch_123',
      status: 'lost',
    } as Stripe.Dispute)

    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
    expect(mockCancelSubscriptionImmediately).toHaveBeenCalledWith('sub_123')
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith('sub_123', periodEnd)
  })

  it('reconciles subscription when dispute is won', async () => {
    await handleChargeDisputeClosed({
      id: 'dp_123',
      charge: 'ch_123',
      status: 'won',
    } as Stripe.Dispute)

    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
    expect(mockCancelSubscriptionImmediately).not.toHaveBeenCalled()
  })

  it('throws when charge retrieval fails', async () => {
    mockStripeChargesRetrieve.mockResolvedValue(null)

    await expect(
      handleChargeDisputeClosed({
        id: 'dp_123',
        charge: 'ch_123',
        status: 'lost',
      } as Stripe.Dispute),
    ).rejects.toThrow(/could not retrieve charge/)
  })
})

describe('handleInvoicePaid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchSubscriptionDetails.mockResolvedValue(activeSubscription)
    mockApplySubscriptionStateWithBackfill.mockResolvedValue({ rowsUpdated: 1 })
  })

  it('updates subscription period end on a successful renewal', async () => {
    await handleInvoicePaid(makeInvoice())

    expect(mockApplySubscriptionStateWithBackfill).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      isPro: true,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      subscriptionInterval: 'month',
      userId: 'user-1',
      customerId: 'cus_123',
      subscriptionStart: activeSubscription.startDate,
    })
  })

  it('throws when local state is not updated for a linkable user', async () => {
    mockApplySubscriptionStateWithBackfill.mockResolvedValue({ rowsUpdated: 0 })

    await expect(handleInvoicePaid(makeInvoice())).rejects.toThrow(Error)
  })

  it('retries when customer exists but no linkable app user exists', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue({ ...activeSubscription, userId: null })
    mockApplySubscriptionStateWithBackfill.mockResolvedValue({ rowsUpdated: 0 })

    await expect(handleInvoicePaid(makeInvoice())).rejects.toThrow(Error)
  })

  it('skips retry when no customer or user can be linked', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue({ ...activeSubscription, userId: null, customerId: null })
    mockApplySubscriptionStateWithBackfill.mockResolvedValue({ rowsUpdated: 0 })

    await expect(handleInvoicePaid(makeInvoice({ customer: null, parent: undefined }))).resolves.toBeUndefined()
  })

  it('returns early when subscription ID is missing', async () => {
    await handleInvoicePaid(makeInvoice({ parent: undefined }))

    expect(mockFetchSubscriptionDetails).not.toHaveBeenCalled()
    expect(mockApplySubscriptionStateWithBackfill).not.toHaveBeenCalled()
  })

  it('throws when subscription details cannot be fetched', async () => {
    mockFetchSubscriptionDetails.mockResolvedValue(null)

    await expect(handleInvoicePaid(makeInvoice())).rejects.toThrow(Error)
  })
})

describe('handleInvoiceBillingRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/portal' })
    mockSendBillingPaymentFailedEmail.mockResolvedValue(true)
  })

  it('reconciles subscription state and sends recovery email', async () => {
    await handleInvoiceBillingRecovery(makeInvoice({ customer_email: 'user@example.com' }), 'invoice.payment_failed')

    expect(mockReconcileSubscriptionById).toHaveBeenCalledWith('sub_123')
    expect(mockCreatePortalSession).toHaveBeenCalled()
    expect(mockSendBillingPaymentFailedEmail).toHaveBeenCalled()
  })
})

describe('handleSubscriptionDeleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears local subscription link with period end when available', async () => {
    await handleSubscriptionDeleted(makeSubscription({ status: 'canceled' }))

    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith(
      'sub_123',
      new Date(1_749_403_200 * 1000),
    )
  })
})

describe('handleSubscriptionTrialWillEnd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReconcileSubscriptionById.mockResolvedValue(undefined)
    mockStripeCustomersRetrieve.mockResolvedValue({ email: 'user@example.com' })
    mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/portal' })
    mockSendBillingTrialEndingEmail.mockResolvedValue(true)
  })

  it('sends trial ending email only while subscription is still trialing', async () => {
    await handleSubscriptionTrialWillEnd(makeSubscription({ status: 'trialing' }))

    expect(mockCreatePortalSession).toHaveBeenCalled()
    expect(mockSendBillingTrialEndingEmail).toHaveBeenCalled()
  })

  it('skips trial email when subscription is no longer trialing', async () => {
    await handleSubscriptionTrialWillEnd(makeSubscription({ status: 'active' }))

    expect(mockCreatePortalSession).not.toHaveBeenCalled()
    expect(mockSendBillingTrialEndingEmail).not.toHaveBeenCalled()
  })
})

describe('handleCustomerDeleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserIdByStripeCustomerId.mockResolvedValue('user-1')
  })

  it('clears local customer link when Stripe customer is deleted', async () => {
    await handleCustomerDeleted({ id: 'cus_123', deleted: true } as Stripe.DeletedCustomer)

    expect(mockClearStripeCustomerByCustomerId).toHaveBeenCalledWith('cus_123')
  })
})

describe('sendBillingPortalRecoveryEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when portal session creation fails', async () => {
    mockCreatePortalSession.mockRejectedValue(new Error('Stripe unavailable'))

    const { sendBillingPortalRecoveryEmail } = await import('./stripe-webhook-event-handlers')

    await expect(
      sendBillingPortalRecoveryEmail({
        sourceEvent: 'invoice.payment_failed',
        customerId: 'cus_123',
        email: 'user@example.com',
        contextId: 'inv_123',
        sendEmail: vi.fn(),
      }),
    ).rejects.toThrow('billing recovery portal session failed')
  })
})

describe('processStripeWebhookEvent', () => {
  const subscription = { id: 'sub_123', status: 'active' } as Stripe.Subscription

  function makeEvent(type: Stripe.Event.Type): Stripe.Event {
    return {
      id: 'evt_123',
      type,
      data: { object: subscription },
    } as Stripe.Event
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpsertSubscriptionStateFromObject.mockResolvedValue(undefined)
  })

  it.each(SUBSCRIPTION_UPSERT_SOURCE_EVENTS)(
    'routes %s to upsertSubscriptionStateFromObject',
    async (eventType) => {
      await processStripeWebhookEvent(makeEvent(eventType))

      expect(mockUpsertSubscriptionStateFromObject).toHaveBeenCalledWith(subscription, eventType)
    },
  )

  it('ignores unhandled event types so extra Stripe subscriptions do not retry forever', async () => {
    await expect(processStripeWebhookEvent(makeEvent('payment_intent.succeeded'))).resolves.toBeUndefined()
  })
})
