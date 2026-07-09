import type { DeepMockProxy } from 'vitest-mock-extended'
import type { prisma } from '@/lib/infra/prisma'

/**
 * Shared `vi.mock('@/lib/infra/prisma', …)` factory body.
 *
 * Each test file keeps its own `vi.mock('@/lib/infra/prisma', …)` call — the module
 * path must be a literal at the call site because `vi.mock` is hoisted above imports.
 * The factory body, however, is identical everywhere, so it lives here. Import it
 * *inside* the async factory (not at module scope) so the hoist doesn't outrun it:
 *
 * ```ts
 * vi.mock('@/lib/infra/prisma', async () => (await import('@/test/prisma-mock')).createPrismaMockModule())
 * ```
 */
export async function createPrismaMockModule(): Promise<{ prisma: DeepMockProxy<typeof prisma> }> {
  const { mockDeep } = await import('vitest-mock-extended')
  return { prisma: mockDeep<typeof prisma>() }
}

/**
 * Typed view of the mocked `prisma` import as a `DeepMockProxy` for `.mockResolvedValue(...)` etc.
 * `vi.mock` swaps the runtime value but not the static type the `prisma` import resolves to (that's
 * inherent to how module mocking interacts with TypeScript — the type checker never sees the swap),
 * so this asserts the type callers already know to be true from `createPrismaMockModule` above.
 */
export function asPrismaMock(client: typeof prisma): DeepMockProxy<typeof prisma> {
  return client as DeepMockProxy<typeof prisma>
}
