---
trigger: glob
globs:
  - src/**/*.test.ts
  - src/test/**/*
  - vitest.config*
  - src/lib/**/*.ts
  - src/actions/**/*.ts
  - src/app/api/**/route.ts
paths:
  - "src/**/*.test.ts"
  - "src/test/**/*"
  - "vitest.config*"
  - "src/lib/**/*.ts"
  - "src/actions/**/*.ts"
  - "src/app/api/**/route.ts"
description: Vitest testing conventions for DevStash — what to test, mocking patterns, and test file structure. Loads when editing test files or the src/ source files they cover.
---

# Testing

We use **Vitest** for unit tests (in the Next.js `src/` workspace). Tests target route handlers, server/lib services, and utilities — no component tests.

> **Scope:** these conventions cover the Next.js app (`src/**`) only. The **`web/` Vite SPA is deliberately not covered by tests** — no Vitest, no test runner, no config. Frontend logic is validated by `tsc --noEmit` + `oxlint` + a prod `build`; runtime behavior is verified in a browser. Do not add tests or a test runner under `web/`. (The Go backend has its own coverage-gated suite — see `go-coding-standards.md § Testing`.)

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

Test files are **not** exempt from linting. `.oxlintrc.json` applies the same type-aware `typescript/*` rules (error level) here too, plus a `vitest/*` batch in the `**/*.test.ts` override — `valid-expect`, `valid-expect-in-promise`, `valid-title`, `valid-describe-callback`, `no-identical-title`, `no-conditional-expect`, `no-standalone-expect`, `no-commented-out-tests`, `require-mock-type-parameters`, `prefer-called-exactly-once-with`, and others.

- **Typed asymmetric matchers.** Vitest types `expect.objectContaining`, `arrayContaining`, `stringContaining`, `anything`, `expect.any` as `(expected: any) => any`, which trips `no-unsafe-*`. Use the typed wrappers in `src/test/matchers.ts` (`objectContaining`, `arrayContaining`, `stringContaining`, `anything`, `anyOf(Ctor)`, plus a typed `readJson<T>()`) inside `toEqual(...)` / `toHaveBeenCalledWith(...)` instead of `expect.*` directly.
- **No `any` in specs.** Type mocked return values and parsed JSON explicitly (`readJson<T>()` for response bodies); don't let `any` flow from `vi.fn()` results or `res.json()` into assertions.
- **No floating promises.** `await` every async assertion / mock call, or `void` it deliberately.
- **Never commit a focused or disabled test** (`it.only`, `describe.skip`). This is **not** lint-enforced — `no-focused-tests`/`no-disabled-tests` are deliberately not enabled, so nothing will catch it for you. Check before you commit.
