---
trigger: glob
globs:
  - src/**/*.test.ts
  - src/test/**/*
  - vitest.config*
paths:
  - "src/**/*.test.ts"
  - "src/test/**/*"
  - "vitest.config*"
description: Vitest testing conventions for DevStash — what to test, mocking patterns, and test file structure. Loads when editing test files.
---

# Testing

We use **Vitest** for unit tests. Tests target route handlers, server/lib services, and utilities — no component tests.

- Test files: `src/**/*.test.ts` (no `.tsx`)
- Run: `npm run test:run` (single run) or `npm test` (watch)
- Coverage: `npm run test:coverage`

## What to test

- `src/lib/**/*.ts` — utilities and service logic (auth, billing, ai, etc.) get tests; mock heavy dependencies (`prisma`, `next-auth`, `resend`, `stripe`, etc.) with `vi.mock()`
- `src/app/api/**/route.ts` — route handlers: assert auth (401), validation (422), rate-limit (429), Pro gating, status codes, and that services are called scoped to the session `userId`
- `src/lib/db/*.ts` — test logic-bearing helpers (usage limits, ordering, page shaping) with mocked `prisma`; skip pure where-building / login-resolution / sync glue (e.g. `users.ts`) — that's integration territory
- `src/actions/*.ts` — the remaining redirect-terminating auth actions: test validation logic and return values

## Mocking patterns

Next.js server modules (`next/navigation`, `next/headers`, `next/cache`) are pre-mocked in `src/test/setup.ts`.

**Prisma** is mocked with [`vitest-mock-extended`](https://www.npmjs.com/package/vitest-mock-extended)'s `mockDeep()` — a deep, type-safe proxy that auto-mocks every model/method, so tests never hand-list `{ user: { findUnique: vi.fn() } }`. The factory body and the typed cast live in the shared `@/test/prisma-mock` helper (`createPrismaMockModule` + `asPrismaMock`); each file keeps its own `vi.mock('@/lib/infra/prisma', …)` call because the module path must be a literal at the hoisted call site, and the helper is `await import`-ed *inside* the factory so hoisting doesn't outrun it. Reset the proxy with `mockReset()` in `beforeEach`:

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { mockReset } from 'vitest-mock-extended'

vi.mock('@/lib/infra/prisma', async () => (await import('@/test/prisma-mock')).createPrismaMockModule())

import { prisma } from '@/lib/infra/prisma'
import { asPrismaMock } from '@/test/prisma-mock'

const prismaMock = asPrismaMock(prisma)

describe('myAction', () => {
  beforeEach(() => mockReset(prismaMock))

  it('returns BAD_REQUEST when email is missing', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    const result = await myAction(null, new FormData())
    expect(result.status).toBe('bad_request')
  })
})
```

- Access methods off `prismaMock` (`prismaMock.user.findUnique.mockResolvedValue(...)`), not the imported `prisma`. Prisma's return types are strict — cast fixture rows with `as unknown as never` when a partial row won't satisfy the full model type.
- **Interactive transactions:** wire `$transaction` to invoke its callback with the same mock, in `beforeEach` after `mockReset` (reset wipes the implementation):
  ```ts
  prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock))
  ```
- Non-Prisma dependencies (`next-auth`, `resend`, `stripe`, service modules) still use plain `vi.mock()` + `vi.fn()`.

Other services (`next-auth`, `resend`, `stripe`, etc.) are mocked with `vi.mock()` and reset with `vi.clearAllMocks()`.

## Lint: type-aware + Vitest rules apply to tests

Test files are **not** exempt from linting. `eslint.config.mjs` runs `typescript-eslint recommendedTypeChecked` (error level) here too, plus `@vitest/eslint-plugin`'s recommended rules (`valid-expect`, `no-focused-tests`, `no-disabled-tests`, correct hook usage, …).

- **Typed asymmetric matchers.** Vitest types `expect.objectContaining`, `arrayContaining`, `stringContaining`, `anything`, `expect.any` as `(expected: any) => any`, which trips `no-unsafe-*`. Use the typed wrappers in `src/test/matchers.ts` (`objectContaining`, `arrayContaining`, `stringContaining`, `anything`, `anyOf(Ctor)`, plus a typed `readJson<T>()`) inside `toEqual(...)` / `toHaveBeenCalledWith(...)` instead of `expect.*` directly.
- **No `any` in specs.** Type mocked return values and parsed JSON explicitly (`readJson<T>()` for response bodies); don't let `any` flow from `vi.fn()` results or `res.json()` into assertions.
- **No floating promises.** `await` every async assertion / mock call, or `void` it deliberately.
- **No focused/disabled tests committed** — `it.only` / `describe.skip` are lint errors.
