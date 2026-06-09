---
description: API contract rules for DevStash — ApiBody shape, apiRoute wrapper, apiFetch, and status codes. Loaded when working with API routes or server actions.
paths:
  - "src/app/api/**"
  - "src/actions/**"
  - "src/types/api.ts"
  - "src/lib/api/**"
---

# API Contract

**Every response between FE and BE must use the `ApiBody<T>` shape — no exceptions.**

```ts
// src/types/api.ts — client-safe, import freely
type ApiBody<T = null> = {
  status: ApiStatus   // string status code, never null
  data: T | null      // null on error or when no payload
  message: string | null  // null on success or when no message
}
```

## API Routes

Wrap the handler with `apiRoute()` from `src/lib/api.ts`. Centralises error handling — no per-route try/catch needed.

```ts
import { ApiResponse, apiRoute } from '@/lib/api'

export const POST = apiRoute(async (request) => {
  const { email } = await request.json()
  if (!email) return ApiResponse.BAD_REQUEST('Email is required')
  return ApiResponse.OK({ result })
})
```

## Server Actions

Return `ApiBody<T>` directly — same builders, plain object (not `NextResponse`).

```ts
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'

export async function myAction(
  _prev: ApiBody<MyData | null> | null,
  formData: FormData
): Promise<ApiBody<MyData | null>> {
  if (!valid) return ApiResponse.BAD_REQUEST('Validation failed')
  return ApiResponse.OK({ result })
}
```

## Frontend

Use `apiFetch` from `@/lib/api/api-fetch` — never raw `fetch()`.

```ts
import { apiFetch } from '@/lib/api/api-fetch'

const data = await apiFetch<MyData>('/api/...', {
  method: 'POST',
  body: { key: value },
})
if (data.status !== 'ok') {
  toast.error(data.message ?? 'Something went wrong.')
  return
}
```

## Status Codes

| Status              | HTTP | Meaning                       |
| ------------------- | ---- | ----------------------------- |
| `ok`                | 200  | Success                       |
| `created`           | 201  | Resource created              |
| `bad_request`       | 400  | Validation / client error     |
| `unauthorized`      | 401  | Not authenticated             |
| `forbidden`         | 403  | Authenticated but not allowed |
| `not_found`         | 404  | Resource not found            |
| `conflict`          | 409  | Duplicate / state conflict    |
| `validation_error`  | 422  | Schema / input validation     |
| `too_many_requests` | 429  | Rate limited                  |
| `internal_error`    | 500  | Server error                  |

## Redirects (API routes)

Inside `apiRoute` handlers, use `apiRedirect()` from `@/lib/api` — not raw `NextResponse.redirect()`.

```ts
import { apiRedirect, apiRoute } from '@/lib/api'

export const GET = apiRoute(async (request) => {
  return apiRedirect(new URL('/settings', request.url))
})
```

Raw `NextResponse.redirect` needs **strict justification** in code (comment) — e.g. route not wrapped in `apiRoute`, or framework middleware constraint.

`redirect()` from `next/navigation` in Server Components / Server Actions is separate and fine.

## Rules

- **Never** return raw `NextResponse.json()` from API routes — use `ApiResponse` + `apiRoute`
- **Never** return raw `NextResponse.redirect()` from API routes — use `apiRedirect` + `apiRoute`
- **Never** return plain booleans/strings from Server Actions that communicate status to the FE
- **Never** call `fetch()` directly from client components — always use `apiFetch`
- **Always** use named interfaces for response data types — no inline generics
- Server Actions that only redirect (OAuth, sign-out) are exempt
- API routes: errors caught by `apiRoute()` — no per-route try/catch needed
- Server Actions: use try/catch and return `ApiResponse.INTERNAL_ERROR()` on unexpected failures
