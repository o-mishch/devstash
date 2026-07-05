import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRetrieve = vi.fn()
const mockUpdate = vi.fn()
const mockCreate = vi.fn()

vi.mock('stripe', () => ({
  default: class MockStripe {
    customers = { retrieve: mockRetrieve, update: mockUpdate, create: mockCreate }
  },
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
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
