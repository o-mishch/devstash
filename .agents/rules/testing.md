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

Next.js server modules (`next/navigation`, `next/headers`, `next/cache`) are pre-mocked in `src/test/setup.ts`. For per-test mocks:

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/infra/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}))

import { prisma } from '@/lib/infra/prisma'

describe('myAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns BAD_REQUEST when email is missing', async () => {
    const form = new FormData()
    const result = await myAction(null, form)
    expect(result.status).toBe('bad_request')
  })
})
```
