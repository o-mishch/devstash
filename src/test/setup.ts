import { vi } from 'vitest'

process.env.STRIPE_SECRET_KEY ??= 'sk_test_vitest_dummy_key'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/billing/access/pro-access-resolution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/access/pro-access-resolution')>()
  return {
    ...actual,
    resolveProAccessBypassingCache: vi.fn().mockResolvedValue(false),
    getCachedVerifiedProAccess: vi.fn().mockResolvedValue(false),
  }
})

// Mock Next.js server modules unavailable outside the Next.js runtime
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers()),
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}))
