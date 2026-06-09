import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWarn } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
}))

vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ warn: mockWarn, info: vi.fn(), error: vi.fn() }),
}))

describe('validateStripeBillingEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('warns in development when Stripe price IDs are missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('STRIPE_PRICE_ID_MONTHLY', '')
    vi.stubEnv('STRIPE_PRICE_ID_YEARLY', '')
    vi.resetModules()

    const { validateStripeBillingEnv } = await import('./validate-billing-env')

    expect(() => validateStripeBillingEnv()).not.toThrow()
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Missing Stripe billing'))
  })

  it('throws in production when Stripe price IDs are missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('STRIPE_PRICE_ID_MONTHLY', '')
    vi.stubEnv('STRIPE_PRICE_ID_YEARLY', '')
    vi.resetModules()

    const { validateStripeBillingEnv } = await import('./validate-billing-env')

    expect(() => validateStripeBillingEnv()).toThrow(/Missing Stripe billing/)
  })

  it('throws in production when Redis is not configured', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('STRIPE_PRICE_ID_MONTHLY', 'price_m')
    vi.stubEnv('STRIPE_PRICE_ID_YEARLY', 'price_y')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    vi.resetModules()

    const { validateStripeBillingEnv } = await import('./validate-billing-env')

    expect(() => validateStripeBillingEnv()).toThrow(/rate limiting/)
  })

  it('passes in production when Stripe prices and Redis are configured', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('STRIPE_PRICE_ID_MONTHLY', 'price_m')
    vi.stubEnv('STRIPE_PRICE_ID_YEARLY', 'price_y')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token')
    vi.resetModules()

    const { validateStripeBillingEnv } = await import('./validate-billing-env')

    expect(() => validateStripeBillingEnv()).not.toThrow()
  })

  it('throws in production when Stripe secret keys are missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('STRIPE_PRICE_ID_MONTHLY', 'price_m')
    vi.stubEnv('STRIPE_PRICE_ID_YEARLY', 'price_y')
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    vi.resetModules()

    const { validateStripeBillingEnv } = await import('./validate-billing-env')

    expect(() => validateStripeBillingEnv()).toThrow(/Missing Stripe secret/)
  })
})
