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

We use **Vitest** for unit tests. Tests target server actions and utilities only — no component tests.

- Test files: `src/**/*.test.ts` (no `.tsx`)
- Run: `npm run test:run` (single run) or `npm test` (watch)
- Coverage: `npm run test:coverage`

## What to test

- `src/lib/*.ts` — pure utility functions always get tests
- `src/actions/*.ts` — test validation logic and return values; mock heavy dependencies (`prisma`, `next-auth`, `resend`, etc.) with `vi.mock()`
- `src/lib/db/*.ts` — skip (DB query helpers; integration-test territory)

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
