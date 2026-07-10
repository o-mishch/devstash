import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Logger } from 'pino'

// Narrow, test-shaped stand-ins for Stripe.Customer — the mocked resolved values here are
// deliberately partial fixtures, not full SDK objects, so we type against actual test usage
// rather than the real (much larger) Stripe.CustomerResource method signatures.
interface MockStripeCustomer {
  id?: string
  deleted?: boolean
  metadata?: Record<string, string>
}

interface UpdateCustomerParams {
  metadata: Record<string, string>
}

interface CreateCustomerParams {
  email: string
  metadata: Record<string, string>
}

interface IdempotencyOptions {
  idempotencyKey: string
}

const mockRetrieve = vi.fn<(customerId: string) => Promise<MockStripeCustomer>>()
const mockUpdate = vi.fn<(customerId: string, params: UpdateCustomerParams) => Promise<MockStripeCustomer>>()
const mockCreate = vi.fn<(params: CreateCustomerParams, options: IdempotencyOptions) => Promise<MockStripeCustomer>>()

vi.mock('stripe', () => ({
  default: class MockStripe {
    customers = { retrieve: mockRetrieve, update: mockUpdate, create: mockCreate }
  },
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: {
    child: () => ({
      warn: vi.fn<Logger['warn']>(),
      info: vi.fn<Logger['info']>(),
      error: vi.fn<Logger['error']>(),
    }),
  },
}))

import { isChargeFullyRefunded, ensureStripeCustomerUserId, createStripeCustomer } from '@/lib/infra/stripe'

describe('isChargeFullyRefunded', () => {
  it('returns true when charge.refunded is true', () => {
    expect(isChargeFullyRefunded({ refunded: true, amount_refunded: 0, amount: 1000 })).toBe(true)
  })

  it('returns true when amount_refunded >= amount', () => {
    expect(isChargeFullyRefunded({ refunded: false, amount_refunded: 1000, amount: 1000 })).toBe(true)
  })

  it('returns false for a zero-amount charge with no refund', () => {
    expect(isChargeFullyRefunded({ refunded: false, amount_refunded: 0, amount: 0 })).toBe(false)
  })
})

describe('ensureStripeCustomerUserId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
  })

  it('returns "deleted" when the customer was deleted in Stripe', async () => {
    mockRetrieve.mockResolvedValue({ id: 'cus_1', deleted: true })
    expect(await ensureStripeCustomerUserId('cus_1', 'user-1')).toBe('deleted')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns "linked" and skips the update when already tagged with this user', async () => {
    mockRetrieve.mockResolvedValue({ id: 'cus_1', metadata: { userId: 'user-1' } })
    expect(await ensureStripeCustomerUserId('cus_1', 'user-1')).toBe('linked')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns "foreign" and refuses the update when tagged with another user', async () => {
    mockRetrieve.mockResolvedValue({ id: 'cus_1', metadata: { userId: 'other-user' } })
    expect(await ensureStripeCustomerUserId('cus_1', 'user-1')).toBe('foreign')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('tags an untagged customer and returns "linked"', async () => {
    mockRetrieve.mockResolvedValue({ id: 'cus_1', metadata: {} })
    mockUpdate.mockResolvedValue({})
    expect(await ensureStripeCustomerUserId('cus_1', 'user-1')).toBe('linked')
    expect(mockUpdate).toHaveBeenCalledWith('cus_1', { metadata: { userId: 'user-1' } })
  })
})

describe('createStripeCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
  })

  it('creates a customer with userId metadata and a deterministic idempotency key', async () => {
    mockCreate.mockResolvedValue({ id: 'cus_new' })

    const customer = await createStripeCustomer({ email: 'user@example.com', userId: 'user-1' })

    expect(customer.id).toBe('cus_new')
    // Deterministic key derived from userId → two environments racing collapse to one customer.
    expect(mockCreate).toHaveBeenCalledWith(
      { email: 'user@example.com', metadata: { userId: 'user-1' } },
      { idempotencyKey: 'customer-create:user-1' },
    )
  })
})
