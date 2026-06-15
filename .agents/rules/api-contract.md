---
trigger: glob
globs:
  - src/app/api/**/*
  - src/actions/**/*
  - src/types/api.ts
  - src/lib/api/**/*
paths:
  - "src/app/api/**/*"
  - "src/actions/**/*"
  - "src/types/api.ts"
  - "src/lib/api/**/*"
---

# API Contract

The client↔server contract for the eight feature domains is **oRPC** (contract-first, runtime-validated, end-to-end-typed). The legacy `ApiBody` envelope is **retained only** for Server Actions and the exempt explicit routes (see below).

## oRPC (default for all client-driven reads/mutations)

One Zod-backed **contract** per domain is the single source of truth for input, output, route, and typed errors.

```
src/lib/api/
  contract/   [C] shared — oc-based contracts (pure Zod, no server-only); the browser imports types only
  router/     [S] server-only — implement(contract) + .handler() bodies, lazy()-split per domain
  orpc.ts     [S] pub / authed implementers (authed injects IDOR-safe { userId, isPro })
  middleware.ts [S] enforceRateLimit(key, identifier) → ORPCError('TOO_MANY_REQUESTS')
  client.ts   [C] orpcClient + orpc (TanStack Query utils)
src/app/api/[...rest]/route.ts  [S] OpenAPIHandler.handle(request, { prefix: '/api' })  — Node runtime
```

Domains: `items` · `collections` · `profile` · `ai` · `search` · `upload` · `billing` · `auth` · `download`. The OpenAPI handler serves them as plain REST (`METHOD /api/path` from each procedure's `.route()`), so the surface is OpenAPI-spec-generatable (`src/lib/api/openapi.ts`).

**Dev-only API docs:** the catch-all handler mounts oRPC's `OpenAPIReferencePlugin` (Swagger UI) **only when `NODE_ENV !== 'production'`** — `GET /api/docs` (Swagger UI) + `GET /api/spec.json` (OpenAPI 3.x). In production the plugin is never registered, so both paths fall through to the router and 404. These two paths are served by the plugin before the per-procedure `authed` middleware, so `handle()` adds an explicit **session gate** in front of them (no session → 404), keeping the API contract unreadable by unauthenticated callers even on a non-localhost dev/preview host. Never expose these in production.

### Server: contract + handler

```ts
// contract/collections.ts  [C]
export const collectionsContract = {
  create: oc.route({ method: 'POST', path: '/collections', successStatus: 201 })
    .input(collectionFormSchema).output(collectionSchema),
}

// router/collections.ts  [S]
export const collectionsRouter = {
  create: authed.collections.create.handler(async ({ input, context }) => {
    if (!await canCreateCollection(context.userId, context.isPro))
      throw new ORPCError('FORBIDDEN', { message: '…upgrade to Pro.' })
    return createCollection(context.userId, input)   // userId from session, never input (IDOR-safe)
  }),
}
```

- **Output dates:** JSON has no `Date` — use `z.coerce.date<Date>()` in `.output(...)`. The client's `ResponseValidationPlugin` coerces responses back to real `Date`s.
- **Errors:** `throw new ORPCError(code, { message })`. `code` maps to the HTTP status natively (`UNAUTHORIZED`→401, `FORBIDDEN`→403, `NOT_FOUND`→404, `CONFLICT`→409, `BAD_REQUEST`→400, `TOO_MANY_REQUESTS`→429, `INTERNAL_SERVER_ERROR`→500). Input-validation failures surface as `BAD_REQUEST`, remapped to 422 at the HTTP layer.
- **Shared messages:** any error string used in more than one place lives in `ErrorMessage` (`src/lib/api/error-messages.ts`, `[C]`) so wording can't drift — both (1) strings used on **both** transports (oRPC + the `ApiResponse` envelope), e.g. `ErrorMessage.NOT_AUTHENTICATED`, `ErrorMessage.FILE_NOT_FOUND`, and (2) strings repeated across oRPC handlers in a domain, e.g. `ErrorMessage.ITEM_NOT_FOUND`, `ErrorMessage.COLLECTION_NOT_FOUND`. Bespoke single-site messages stay inline. (`deniedMessage()` in `rate-limit.ts` is the same idea for the 429 string.)
- **Typed errors** (only where the client branches on structured data): `oc.errors({ CODE: { status, data: schema } })`, then `errors.CODE({ data })` in the handler. Example: `auth.login` → `EMAIL_NOT_VERIFIED` carrying `{ email }`.
- **Rate limiting:** `await enforceRateLimit('<key>', context.userId)` at the top of the handler.
- A new domain is added in `contract/index.ts` + `router/index.ts` (lazy).

### Frontend

```ts
import { safe } from '@orpc/client'
import { orpcClient, orpc } from '@/lib/api/client'

// one-off call — resolves with typed output, throws ORPCError on failure
const { error, data } = await safe(orpcClient.collections.create(input))
if (!error) use(data)
else toast.error(error.message)   // error.code === 'FORBIDDEN' for the upgrade branch

// hooks — TanStack Query utils
const create = useMutation(orpc.collections.create.mutationOptions({ ... }))
const { data } = useInfiniteQuery({ ...orpc.items.list.infiniteOptions(...) })
```

- Components never call `useQueryClient()` directly — cache updaters live in the hook files (see `coding-standards.md`).
- For a built-in error code the client branches on, narrow with `error instanceof ORPCError && error.code === '…'`; for a declared typed error, narrow with `isDefinedError(error)`.
- Form-driven submits use `useOrpcFormAction(submit, { onSuccess })` (`src/hooks/use-orpc-form-action.ts`).
- Direct-to-S3 uploads (with progress) use `uploadToS3` (`src/lib/storage/s3-upload-client.ts`), **not** oRPC — the request goes straight to S3.

## Server Actions — still `ApiBody`

Redirect-terminating auth Server Actions (`src/actions/`) and their helpers remain on the `ApiBody` envelope (`src/types/api.ts`, `ApiResponse` builders). `parseOrFail` and `rateLimitAction`/`withRateLimit` serve these.

```ts
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'

export async function myAction(_prev: ApiBody<T | null> | null, formData: FormData): Promise<ApiBody<T | null>> {
  if (!valid) return ApiResponse.BAD_REQUEST('Validation failed')
  return ApiResponse.OK({ result })
}
```

## Exempt explicit routes — still `apiRoute` / `ApiResponse`

These never used the oRPC contract and keep their explicit `src/app/api/*/route.ts` files (different URL space, never shadowed by the catch-all):

| Route | Why exempt |
|-------|-----------|
| `api/auth/[...nextauth]` | NextAuth handler |
| `api/webhooks/stripe` | Raw body + signature verification |
| `api/download/[id]` | 3xx redirect to a signed S3 URL |
| `api/billing/checkout-return` | 3xx redirect to settings after Stripe |

They use `apiRoute` / `authenticatedRoute` (IDOR-safe `userId`), `ApiResponse`, and `apiRedirect` from `@/lib/api`.

## Rules

- **Client-driven reads/mutations** go through `orpcClient` / `orpc` (oRPC). Never `fetch()`/`axios`, never a Server Action for an ordinary mutation.
- **Never** add a new explicit `/api/*` JSON route — add a procedure to the contract instead. Explicit routes are only for the exempt cases above.
- `userId` always comes from `context` (session), never from input — IDOR-safe.
- Contract modules (`contract/**`) are `[C]` — never import `server-only` code into them; reuse the client-safe schemas in `src/lib/utils/validators.ts`.
- Server Actions that only redirect (OAuth, sign-out) and the exempt routes keep the envelope; do not migrate them.
