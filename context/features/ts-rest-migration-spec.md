# ts-rest Migration

> **Status:** Specification — not yet implemented
> **Scope:** Replace the custom `ApiResponse` / `ApiBody` envelope + `apiRoute` wrappers + axios `api-fetch` verb helpers with [ts-rest](https://ts-rest.com) contract-first, runtime-validated, end-to-end-typed REST.
> **Response model:** **ts-rest native** — HTTP status code is the discriminator; the payload moves from `data` into ts-rest's `body`; `message` lives inside per-status error schemas. The uniform `{ status, data, message }` envelope is dropped.

---

## 1. Overview

DevStash currently hand-rolls its client↔server contract in three pieces:

| Piece | File | Role |
|-------|------|------|
| Envelope builders | `src/lib/api/api-response.ts` | `ApiResponse.OK()/CREATED()/…` → `{ status, data, message }` |
| Route wrappers | `src/lib/api/index.ts` | `apiRoute` / `authenticatedRoute`, `HTTP_STATUS` map, error catch, IDOR-safe `userId` + `isPro` injection |
| HTTP client | `src/lib/api/api-fetch.ts` | axios `get/post/put/patch/del` → `Promise<ApiBody<T>>` |
| Wire type | `src/types/api.ts` | `ApiBody<T>`, `ApiStatus` |

It works but the contract is **type-only**: `post<T>()` trusts the caller's `T` with no runtime guarantee the route returns it, and there is no single source of truth shared by client and server. ts-rest closes both gaps: one contract drives the route handler, the client types, and runtime validation of both request and response.

**The model change (decided):** we adopt ts-rest's native shape. The numeric HTTP status becomes the discriminator; the success payload (`data`) becomes ts-rest's `body`; the `message` string moves into a shared error body schema. Call sites switch from `result.status === 'ok' ? result.data` to `result.status === 200 ? result.body`.

```ts
// before
const res = await post<Collection>('/api/collections', input)
if (res.status === 'created' || res.status === 'ok') use(res.data)
else toast.error(res.message ?? 'Something went wrong.')

// after (ts-rest native)
const res = await tsr.collections.create.mutation({ body: input })
if (res.status === 201) use(res.body)
else toast.error(res.body.message)
```

---

## 2. Goals

1. One Zod-backed **contract** per domain is the single source of truth for path, method, params, query, request body, and per-status response bodies.
2. **Runtime-validated** requests and responses (replaces manual `parseOrFail` + the type-only `post<T>()` assertion).
3. **End-to-end inference** — client call sites infer body types from the contract; no manual generics.
4. Preserve all current behavior: session auth, IDOR-safe `userId`, Pro gating, rate limiting, error→500 mapping, the human-readable `message` on every error.
5. Migrate **incrementally**, domain by domain, with old explicit routes coexisting with the ts-rest catch-all until each is moved.
6. Delete `api-response.ts`, `api-fetch.ts`, the `ApiResponse`/`apiRoute` surface of `index.ts`, and `src/types/api.ts` once all domains are migrated.

### Non-goals

- OpenAPI generation (`@ts-rest/open-api`) — orthogonal, can follow later.
- Migrating envelope-exempt routes (see §6) into the contract.
- Replacing Server Actions used for redirect-terminating auth flows (`src/actions/`).
- Mobile/CLI bearer-token auth (no bearer auth exists in the codebase today; session-cookie only).

---

## 3. Dependencies & version constraints

```bash
npm install @ts-rest/core @ts-rest/serverless @ts-rest/react-query
```

| Package | Role |
|---------|------|
| `@ts-rest/core` | `initContract`, `initClient`, shared types |
| `@ts-rest/serverless` | `createNextHandler` (App Router), `tsr.middleware`, `TsRestResponse` |
| `@ts-rest/react-query` | TanStack Query v5 integration for hooks (`src/hooks/`) |

**Hard constraint — Zod 4.** This repo is on `zod@^4`. ts-rest accepts the **Standard Schema** spec (and therefore Zod 4) from **`@ts-rest/*` ≥ 3.53.0** — pin at least that. Zod 4 also materially improves TypeScript intellisense over Zod 3, which matters for a contract this size. Verify with a one-route spike before the bulk migration. Do **not** introduce `zod/v3` compat imports — stay on Zod 4 across contract, routes, and validators.

`axios` (`^1.18.0`) stays only until the last `api-fetch` consumer is migrated, then is removed if no other code uses it (verify with `grep -rln "from 'axios'" src`).

---

## 4. Architecture

### 4.1 Single catch-all handler + coexistence

ts-rest serverless mounts **one** App Router catch-all:

```
src/app/api/[...ts-rest]/route.ts   →  createNextHandler(contract, router, options)
```

Next.js route precedence is **static > dynamic > catch-all**, so existing explicit route files keep winning over the catch-all. This gives two free properties:

- **Exempt routes stay put** — `auth/[...nextauth]`, `webhooks/stripe`, redirects/streams (§6) remain their own files and are never shadowed by the catch-all.
- **Incremental migration** — a domain not yet in the contract keeps its explicit `route.ts` (which wins); when migrated, add it to the contract and delete the explicit file.

### 4.2 Layout

```
src/lib/api/
  contract/
    index.ts          # c.router({ items, collections, profile, ai, search, upload, billing, auth })
    common.ts         # errorBodySchema, commonErrorResponses, ApiContextSchema bits
    items.ts          # contract.items
    collections.ts
    profile.ts
    ai.ts
    search.ts
    upload.ts
    billing.ts
    auth.ts
  router/
    items.ts          # handlers implementing contract.items
    collections.ts
    …
  middleware.ts       # session + Pro + rate-limit ts-rest middleware
  client.ts           # initTsrReactQuery + plain initClient singletons
src/app/api/[...ts-rest]/route.ts
```

Domain DB helpers (`src/lib/db/*`), validation schemas, logging, cache invalidation, Pro/usage checks are reused **unchanged** — only the transport wrapper changes.

### 4.3 Server/client boundary (per `nextjs-architecture.md`)

| Module | Guard | Why |
|---|---|---|
| `contract/**` | **[C] shared** — no `server-only` | Zod schemas + route definitions; imported by both the handler and the browser client (like today's `api-response.ts`). **Must not import** server-only modules — keep contract schemas pure (reuse the client-safe schemas in `src/lib/utils/validators.ts`). |
| `client.ts` | **[C] shared** | Runs in the browser; only imports `contract` |
| `router/**`, `middleware.ts` | **[S] `server-only`** | Import `src/lib/db`, session, Pro, redis |
| `app/api/[...ts-rest]/route.ts` | **[S]** (route handler) | Node.js runtime |

---

## 5. Response model (normative for migrated routes)

### 5.1 Shared error body via `commonResponses`

`message` is preserved as a first-class field on **every** non-2xx response through one shared schema, attached **once** at the router level with ts-rest's `commonResponses` (idiomatic — avoids repeating error codes on every route):

```ts
// src/lib/api/contract/common.ts
import { z } from 'zod'
export const errorBodySchema = z.object({ message: z.string() })
```

```ts
// src/lib/api/contract/index.ts
export const contract = c.router(
  { items: itemsContract, collections: collectionsContract, /* …8 domains */ },
  {
    pathPrefix: '/api',           // routes declare paths without /api (§15)
    strictStatusCodes: true,      // handlers may only return declared codes
    commonResponses: {
      400: errorBodySchema, 401: errorBodySchema, 403: errorBodySchema,
      404: errorBodySchema, 409: errorBodySchema, 422: errorBodySchema,
      429: errorBodySchema, 500: errorBodySchema,
    },
  },
)
```

Endpoints then declare only their **success** body (and may narrow a specific error):

```ts
createCollection: {
  method: 'POST',
  path: '/collections',        // becomes /api/collections via pathPrefix
  body: collectionFormSchema,
  responses: { 201: collectionSchema },   // 4xx/5xx inherited from commonResponses
}
```

### 5.2 HTTP status mapping

The old `ApiStatus` → HTTP table in `index.ts` is deleted; handlers return numeric codes directly. Equivalences:

| Old `ApiStatus` | HTTP code returned by handler |
|---|---|
| `ok` | `200` |
| `created` | `201` |
| `bad_request` | `400` |
| `unauthorized` | `401` |
| `forbidden` | `403` |
| `not_found` | `404` |
| `conflict` | `409` |
| `validation_error` | `422` |
| `too_many_requests` | `429` |
| `internal_error` | `500` |

### 5.3 Validation errors (422)

ts-rest auto-rejects requests that fail body/query/param validation with its own error shape. Normalize it to `{ message }` via the handler `options.errorHandler` (or `requestValidationErrorHandler`) so clients keep reading `res.body.message`. Document the chosen hook in `middleware.ts`.

### 5.4 Returning errors from handlers (4xx)

Prefer throwing a **contract-checked** error over hand-building a response: `throw new TsRestResponseError(contract.<domain>.<op>, { status: 409, body: { message } })`. The status/body are type-checked against that endpoint's declared responses, so an undeclared code is a compile error. Use this for conflicts, forbidden, not-found, etc. raised deep in a service.

### 5.5 Unhandled errors (500)

Replaces the `try/catch` in `apiRoute`. Configure `options.errorHandler` to log via `logger.child({ tag: 'api' })` and return `TsRestResponse.fromJson({ message: 'Internal server error.' }, { status: 500 })`. No per-route try/catch (same guarantee as today).

---

## 6. Exemptions — stay as explicit route files

These never used the JSON envelope and are **not** moved into the contract (they win over the catch-all by route precedence):

| Route | Why exempt |
|-------|-----------|
| `auth/[...nextauth]/route.ts` | NextAuth handler |
| `webhooks/stripe/route.ts` | Raw request body + signature verification; provider format |
| `download/[id]/route.ts` | 3xx redirect to signed S3 URL |
| `billing/checkout/route.ts`, `billing/portal/route.ts`, `billing/checkout-return/route.ts` | 3xx redirects to Stripe |

JSON billing endpoints that return a body (`billing/cancel`, `billing/reactivate`) **are** migrated. Redirect-returning ones stay. If a redirect route later needs to live under the contract, ts-rest supports raw `TsRestResponse` returns — but default is to leave them as plain handlers.

---

## 7. Server middleware (replaces `authenticatedRoute`)

`authenticatedRoute` does three things that must be reproduced as ts-rest middleware: session check → 401, IDOR-safe `userId` injection, Pro resolution. Rate limiting is currently per-route; keep it per-route via route middleware keyed by the endpoint.

```ts
// src/lib/api/middleware.ts
import { tsr } from '@ts-rest/serverless/next'
import { TsRestResponse } from '@ts-rest/serverless'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'

export interface AuthContext { userId: string; isPro: boolean }

export const authMiddleware = tsr.middleware<AuthContext>(async (request) => {
  const session = await getCachedSession()
  if (!session?.user?.id) {
    return TsRestResponse.fromJson({ message: 'Not authenticated.' }, { status: 401 })
  }
  request.userId = session.user.id                                   // IDOR-safe: from session, never request
  request.isPro = await getCachedVerifiedProAccess(session.user.id)
})
```

- **Public endpoints** (auth/register, forgot-password, reset-password, resend-verification) use no auth middleware.
- **User-scoped endpoints** attach `authMiddleware`; handlers read `request.userId` / `request.isPro`.
- **Rate-limited endpoints** add a route-level middleware calling the existing `rateLimitAction(key, identifier)` from `src/lib/infra/rate-limit.ts`, returning 429 + `{ message }` on limit. The 22 routes currently rate-limited (see git inventory) map 1:1.
- `rate-limit.ts` and `profile-helpers.ts` and `toggle-route.ts` currently import `ApiResponse` — refactor them to return ts-rest results / plain `{ status, body }` or throw, depending on call context.

---

## 8. Client (replaces `api-fetch`)

Two singletons; no more axios verb helpers.

```ts
// src/lib/api/client.ts
import { initTsrReactQuery } from '@ts-rest/react-query/v5'
import { initClient } from '@ts-rest/core'
import { contract } from './contract'

const config = {
  baseUrl: '',                        // same-origin
  baseHeaders: {},
  credentials: 'include' as const,    // send the session cookie
  throwOnUnknownStatus: true,         // surface contract drift instead of silently typing as never
  validateResponse: process.env.NODE_ENV !== 'production', // catch contract/route mismatch in dev
}

export const tsrq = initTsrReactQuery(contract, config)  // hooks (TanStack Query)
export const tsr = initClient(contract, config)          // one-off component mutations
```

> Import hooks from `@ts-rest/react-query/v5` (not the bare package). `tsrq` also exposes an extended, fully type-safe `QueryClient` whose `fetchQuery`/`setQueryData`/`invalidateQueries` mirror the contract — use it inside hook files for the cache updaters that `coding-standards.md` requires to live there.

| Consumer kind | Today | After |
|---|---|---|
| Hooks using TanStack Query (`use-infinite-items`, `use-global-search`, `use-create-item`, `use-update-item`, `use-pro-download-src`, `use-restricted-download`) | `get/post` + `useQuery`/`useInfiniteQuery` | `tsrq.<domain>.<op>.useQuery / useInfiniteQuery / useMutation` |
| One-off mutations in components (~27 files importing `api-fetch`) | `post/patch/del` | `tsr.<domain>.<op>.mutation({ body, params })` |
| `src/stores/editor-preferences.ts` | `api-fetch` | `tsr` client |

**Call-site transformation** (applies everywhere):

```ts
// status check: string → numeric
if (res.status === 'ok')        →  if (res.status === 200)
if (res.status === 'created')   →  if (res.status === 201)
res.data                        →  res.body          // success branch only
res.message ?? 'fallback'       →  res.body.message  // error branch (narrowed)
```

Cache-updater rules from `coding-standards.md` still apply: `setQueryData`/`invalidateQueries` stay inside the hook files, using the contract-shaped `tsrq` query client.

**Query keys** stay hierarchical, matching today's structure (`['items']`, `['items', filters]`, `['collections', id]`) — ts-rest does not impose keys, so existing keys carry over unchanged.

**Error handling** uses ts-rest's type guards instead of ad-hoc checks. In hooks/components reading `error`:

```ts
import { isFetchError, isUnknownErrorResponse, exhaustiveGuard } from '@ts-rest/react-query/v5'

if (isFetchError(error)) toast.error('Network error. Please try again.')   // transport failure
else if (isUnknownErrorResponse(error, contractEndpoint)) toast.error('Unexpected error.')
else if (error.status === 403) { /* … */ }
else exhaustiveGuard(error)   // compile error if a declared status is unhandled
```

This replaces `api-fetch`'s `handleApiError` axios-error normalization, which is deleted with the file.

---

## 9. Files

### Create
- `src/app/api/[...ts-rest]/route.ts`
- `src/lib/api/contract/*` (index + common + 8 domain contracts)
- `src/lib/api/router/*` (8 domain routers)
- `src/lib/api/middleware.ts`
- `src/lib/api/client.ts`

### Migrate (per domain, then delete the explicit route)
- 37 `route.ts` files total → **~31 migrate** into the contract; **6 stay exempt** (§6).
- ~33 client files importing `@/lib/api/api-fetch` (27 components + 6 hooks + 1 store).
- `rate-limit.ts`, `profile-helpers.ts`, `toggle-route.ts` — drop `ApiResponse` usage.
- `session.ts` — drop `ApiResponse` from `requireAuthSessionWithRateLimit` (used by redirect Server Actions, which keep returning `ApiBody`-shaped objects **only if** those actions are out of scope; otherwise convert). Confirm during implementation.

### Delete (final step, after all domains migrated)
- `src/lib/api/api-response.ts`
- `src/lib/api/api-fetch.ts`
- `src/types/api.ts` (`ApiBody`, `ApiStatus`)
- The `ApiResponse` / `apiRoute` / `authenticatedRoute` / `apiRedirect` / `HTTP_STATUS` exports in `src/lib/api/index.ts` (file becomes a barrel for the contract/client or is removed).
- `axios` dependency (if unused elsewhere).

---

## 10. Validation mapping

The ~20 routes using `parseOrFail` move their schemas into the contract (`body` / `query` / `pathParams`). ts-rest validates automatically before the handler runs — `parseOrFail` calls inside handlers are deleted. Schemas already centralized in `src/lib/utils/validators.ts` (e.g. `collectionFormSchema`) are imported by the contract; inline route schemas move next to their contract entry. `parseOrFail` itself stays only for the remaining Server Action consumers (`src/actions/auth/link.ts`, `session.ts`).

---

## 11. Test plan

| Surface | Change |
|---|---|
| 16 test files mocking the API layer | Re-point mocks; route tests now call the ts-rest router/handler and assert numeric `status` + `body` (incl. `body.message` on errors) |
| Contract | Add a type-level test (`expectTypeOf`) that client inference matches handler returns for one endpoint per domain |
| Validation | Assert a bad body yields `422` + `{ message }` |
| Auth | Assert no session yields `401` + `{ message }`; assert `userId` is taken from session, not body (IDOR) |
| Rate limit | Assert limited endpoint yields `429` + `{ message }` |
| Full suite | `npm run test:run` green |
| Lint | `npm run lint` green |

No component tests (per project rule). Verify per domain as it migrates, not only at the end.

---

## 12. Migration phases

1. **Spike** — install deps, build the `collections` contract + router + catch-all handler, migrate `collections` hooks/components, confirm Zod 4 / Standard Schema works end to end (§3). Gate the rest on this.
2. **Per-domain rollout** — items → profile → ai → search → upload → billing(JSON) → auth(JSON). Each: contract + router + middleware wiring + client call-site swaps + tests, then delete the explicit `route.ts`.
3. **Teardown** — delete `api-response.ts`, `api-fetch.ts`, `src/types/api.ts`, dead `index.ts` exports, `axios`. Update `.agents/rules/api-contract.md` and `nextjs-architecture.md` to describe ts-rest as the contract.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| **Zod 4 / ts-rest incompatibility** | Spike first (§3, §12.1); fall back to `zod/v3` for contract schemas only if blocked |
| Catch-all shadows an exempt route | Rely on Next.js static>dynamic>catch-all precedence; keep exempt files explicit (§6); add a test hitting `/api/auth/...` and `/api/webhooks/stripe` post-migration |
| Loss of uniform `message` | Shared `errorBodySchema` on every endpoint (§5.1); normalize 422 + 500 to `{ message }` (§5.3–5.4) |
| Large client churn (~33 files) | Mechanical, type-checked transformation (§8); migrate per domain so each PR is reviewable |
| TanStack cache rules drift | Keep updaters in hook files per `coding-standards.md`; use `@ts-rest/react-query` query keys |
| Redirect/stream routes don't fit JSON contract | Leave as explicit handlers (§6); use `TsRestResponse` only if later folded in |
| Edge runtime | ts-rest handler + middleware import `server-only` infra (session, Pro, redis); keep on Node runtime (current default) |

---

## 14. Acceptance criteria

- [ ] `@ts-rest/core`, `@ts-rest/serverless`, `@ts-rest/react-query` installed at a Zod-4-compatible version
- [ ] `src/app/api/[...ts-rest]/route.ts` serves all migrated domains via `createNextHandler`
- [ ] Every migrated endpoint validates request (body/query/params) and response against its contract; `strictStatusCodes: true`
- [ ] Auth middleware reproduces session→401, IDOR-safe `userId`, Pro gating; rate-limited endpoints return `429`
- [ ] Every non-2xx response carries `{ message }`; client error branches read `res.body.message`
- [ ] All 6 exempt routes (§6) still resolve correctly (NextAuth, Stripe webhook, redirects/streams)
- [ ] All `@/lib/api/api-fetch` consumers migrated to `tsr` / `tsrq`; numeric status checks; `res.body` payload access
- [ ] `api-response.ts`, `api-fetch.ts`, `src/types/api.ts`, dead `index.ts` exports deleted; `axios` removed if unused
- [ ] `api-contract.md` + `nextjs-architecture.md` updated to document the ts-rest contract
- [ ] `npm run lint` and `npm run test:run` pass

---

## 15. ts-rest best-practices alignment

How each documented ts-rest recommendation maps onto DevStash and where it lands in this spec.

| ts-rest best practice | DevStash alignment | Where |
|---|---|---|
| Contract is the single Zod-backed source of truth, shared by client + server | One contract drives the catch-all handler **and** the `tsr`/`tsrq` clients; same Next.js bundle, so no separate package needed | §4, §5 |
| Split contracts by domain, combine with `c.router({ a, b })` | 8 domain contracts (`items`, `collections`, `profile`, `ai`, `search`, `upload`, `billing`, `auth`) combined in `contract/index.ts` | §4.2 |
| `pathPrefix` for organization/versioning | Root prefix `/api`; routes declare bare paths (`/collections`) | §5.1 |
| `commonResponses` for shared error shapes | `errorBodySchema` (`{ message }`) attached once at router level — preserves the uniform `message` clients rely on | §5.1 |
| `strictStatusCodes: true` | Set router-level; handlers can only return declared codes | §5.1 |
| Server response validation (`validateResponses`) | Enabled on `createNextHandler`; catches route/contract drift | §5.5, §7 |
| Client response validation (`validateResponse`) + `throwOnUnknownStatus` | On in dev (validate) and always (throw) — note the **non-JSON limitation**: ts-rest skips validation for non-JSON bodies, which is exactly why redirect/stream routes are exempt, not contracted | §6, §8 |
| Return contract-defined errors via `TsRestResponseError` / `TsRestResponse` | Used in middleware (401/429) and services (409 etc.) instead of hand-built bodies | §5.4, §7 |
| `@ts-rest/react-query/v5` import + extended type-safe `QueryClient` | `tsrq` for hooks; its query client used for in-hook cache updaters | §8 |
| Hierarchical query keys | Existing keys (`['items', filters]`, `['collections', id]`) carry over unchanged | §8 |
| Type-safe error guards (`isFetchError`, `isUnknownErrorResponse`, `exhaustiveGuard`) | Replace axios `handleApiError`; exhaustive handling enforced at compile time | §8 |
| Split client by domain for intellisense performance | Falls out of the per-domain contract structure; Zod 4 further reduces TS load | §3, §4.2 |
| `metadata` for route flags (role, public) | **Optional.** May tag routes (e.g. `{ public: true }`) to drive middleware selection — but metadata ships in the client bundle, so **no secrets**. Auth/Pro/rate-limit stay enforced in server middleware, never via metadata alone | §7 |
| Shared contract package in a monorepo | **N/A** — single Next.js repo. Colocated `src/lib/api/contract/` is imported by both the route handler and client code in the same build; documented adaptation, not a deviation | §4.2 |

**Net effect:** the migration doesn't just swap libraries — it adopts ts-rest's idioms (router-level `commonResponses`/`pathPrefix`/`strictStatusCodes`, `TsRestResponseError`, react-query v5 guards) rather than re-implementing the old envelope's habits on top of ts-rest.

---

## 16. References

- ts-rest contract & responses: https://ts-rest.com/docs/core/
- Next.js App Router serverless handler: https://ts-rest.com/docs/serverless/next
- Serverless middleware / context / `TsRestResponse`: https://ts-rest.com/docs/serverless/options
- React Query v5 integration: https://ts-rest.com/docs/react-query/v5
- Standard Schema / Zod 4 support: `@ts-rest/*` ≥ 3.52.0 release notes
- Current pattern this replaces: `context/features/apibod-lib-spec.md`
</content>
</invoke>
