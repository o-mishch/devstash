import { vi } from 'vitest'

process.env.STRIPE_SECRET_KEY ??= 'sk_test_vitest_dummy_key'
// Silence Pino output for modules that use the real logger (no per-test mock).
process.env.LOG_LEVEL = 'silent'

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
  // Framework implementation selectively throws only Next.js control-flow errors.
  // The default test double models the ordinary-error path by returning normally;
  // tests that exercise control flow can override it to throw their sentinel.
  unstable_rethrow: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers()),
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}))

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => Promise<unknown>>(fn: T) => fn,
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
}))
