# oRPC Migration

> **Status:** Specification — not yet implemented
> **Supersedes:** `context/features/ts-rest-migration-spec.md` (ts-rest is dormant — see §0).
> **Scope:** Replace the custom `ApiResponse` / `ApiBody` envelope + `apiRoute` wrappers + axios `api-fetch` verb helpers with [oRPC](https://orpc.unnoq.com) — contract-first, runtime-validated, end-to-end-typed procedures served over oRPC's **OpenAPI handler as plain REST** (real `METHOD /api/path` endpoints, OpenAPI-spec-generatable).
> **Response model:** oRPC native — success returns the procedure's typed `output`; errors are `ORPCError`s carrying `code` (→ HTTP status) + `message` + optional typed `data`. The uniform `{ status, data, message }` envelope is dropped.
> **Transport decision (§3):** OpenAPI handler (REST-native), chosen over the RPC protocol so a future **native mobile app** can consume a plain REST + OpenAPI surface without rewriting the procedures.

---

## 0. Why oRPC, not ts-rest

The original plan targeted ts-rest. The pre-implementation spike (2026-06-15) found ts-rest is **effectively dormant**:

- Last **stable** release `3.52.1` — 2025-03-04 (~15 months ago); peers `zod@^3`, `next@^12‖13‖14`, `react@^16‖17‖18`.
- Zod 4 / Standard Schema support exists **only** in `3.53.0-alpha`/`-rc.1`, last published 2025-06-02 and **frozen in RC for ~12 months** — never shipped stable.
- Not formally `deprecated` on npm, but the profile is a stalled project. Adopting a year-old RC of a dormant library across a production API layer is an unacceptable bet.

**oRPC** is the maintained, modern fit for the same goals: `@orpc/server` `1.14.6` published **2026-06-12**, stable 1.x line, no rigid Next/React peer locks, native **Standard Schema → Zod 4**, contract-first, first-class TanStack Query, and (bonus, not required) OpenAPI generation.

---

## 1. Overview

DevStash currently hand-rolls its client↔server contract in four pieces:

| Piece | File | Role |
|-------|------|------|
| Envelope builders | `src/lib/api/api-response.ts` | `ApiResponse.OK()/CREATED()/…` → `{ status, data, message }` |
| Route wrappers | `src/lib/api/index.ts` | `apiRoute` / `authenticatedRoute`, `HTTP_STATUS` map, error catch, IDOR-safe `userId` + `isPro` injection |
| HTTP client | `src/lib/api/api-fetch.ts` | axios `get/post/put/patch/del` → `Promise<ApiBody<T>>` |
| Wire type | `src/types/api.ts` | `ApiBody<T>`, `ApiStatus` |

The contract is **type-only**: `post<T>()` trusts the caller's `T` with no runtime guarantee, and there is no single source of truth shared by client and server. oRPC closes both gaps — one **contract** drives the server implementation, the client types, and runtime validation of both input and output.

```ts
// before
const res = await post<CollectionWithTypes>('/api/collections', input)
if (res.status === 'created' || res.status === 'ok') use(res.data)
else toast.error(res.message ?? 'Something went wrong.')

// after (oRPC) — one-off client call (real REST: POST /api/collections under the hood)
const { error, data } = await safe(orpcClient.collections.create(input))
if (!error) use(data)
else toast.error(error.message)

// after (oRPC) — hook (TanStack Query)
const create = useMutation(orpc.collections.create.mutationOptions({
  onSuccess: (data) => { /* typed */ },
  onError: (error) => toast.error(error.message),
}))
```

---

## 2. Goals

1. One Zod-backed **contract** per domain is the single source of truth for input, output, route, and typed errors.
2. **Runtime-validated** input and output on both ends (replaces manual `parseOrFail` + the type-only `post<T>()` assertion).
3. **End-to-end inference** — client call sites infer input/output from the contract; no manual generics.
4. Preserve all current behavior: session auth → 401, IDOR-safe `userId`, Pro gating → 403, rate limiting → 429, unhandled error → 500, a human-readable `message` on every error.
5. Migrate **incrementally**, domain by domain, with the oRPC handler and the legacy `/api/*` routes coexisting in **separate URL spaces** until each domain is moved.
6. Delete `api-response.ts`, `api-fetch.ts`, the `ApiResponse`/`apiRoute` surface of `index.ts`, and `src/types/api.ts` once all domains are migrated.

### Goals — mobile/REST forward-compatibility

Every procedure is designed for the OpenAPI surface (`.route({ method, path })` + `.output(...)`), so a complete OpenAPI 3.x spec is generatable via `@orpc/openapi` + `@orpc/zod` whenever a mobile/external client needs it. Wiring the generator + serving the spec JSON is **available but optional** for this migration (the web client doesn't need it); the hard requirement is that the procedures stay spec-generatable.

### Non-goals

- Building the mobile app itself, or hand-publishing/hosting the OpenAPI doc — the spec is generatable on demand; productionizing it is out of scope here.
- Migrating envelope-exempt routes (§6) into oRPC.
- Replacing Server Actions used for redirect-terminating auth flows (`src/actions/`).
- Bearer-token auth (session-cookie only today; oRPC client sends cookies via `credentials: 'include'`). When mobile lands, add a token auth strategy to the same procedures via middleware — additive.

---

## 3. Key decision — OpenAPI handler (plain REST), not the RPC protocol

oRPC defines procedures once (contract + handlers) and can serve them through either transport. They are **not** mutually exclusive over time — the same procedures can later be exposed both ways — but we pick one to build against now:

| | **OpenAPIHandler / OpenAPILink** (chosen) | RPCHandler / RPCLink |
|---|---|---|
| URLs | Real REST per `.route({ method, path })` → `POST /api/collections` | oRPC-internal under a prefix → `POST /rpc/collections/create` |
| Wire format | Plain JSON | oRPC's own (rich) |
| Native mobile (Swift/Kotlin) | ✅ idiomatic — consume the OpenAPI spec, codegen a client | ❌ awkward — needs oRPC's protocol |
| OpenAPI spec | ✅ generatable (`@orpc/openapi` + `@orpc/zod`) | ❌ none |
| `Date`/`Map`/`Set`/`BigInt` | JSON only → use `z.coerce.date<Date>()` etc. in `.output` (§6.1) | round-trip natively |
| Ceremony | Each procedure declares `.route()` + `.output()` | Lower |

**Choose OpenAPI.** A future **native mobile app** is anticipated and would consume a plain REST + OpenAPI surface. Designing for OpenAPI now (REST routes + output schemas) makes the API mobile-ready from day one and keeps the **web client fully type-safe** via `OpenAPILink` + TanStack Query (identical ergonomics to the RPC path). The cost is modest: per-procedure `.route()`/`.output()` and JSON `Date` handling via `z.coerce.date<Date>()`. The web client still calls a typed proxy (`orpcClient.collections.create(input)`) — the REST URL is an implementation detail of the link.

> Retrofitting REST routes onto an RPC-first design later would mean adding `.route()`/`.output()` to all ~31 procedures after the fact — avoided by choosing OpenAPI up front.

**Consequence for routing & coexistence:** the OpenAPI handler mounts a catch-all at `src/app/api/[...rest]/route.ts` with `prefix: '/api'`; procedures declare bare paths (`/collections` → `/api/collections`). Coexistence relies on **Next.js route precedence (static > dynamic > catch-all)**: an un-migrated domain keeps its explicit `src/app/api/<domain>/route.ts` (which wins over the catch-all); when migrated, that file is deleted and the request falls through to the catch-all → the contract. The 6 exempt routes (§8) keep their explicit files and are never shadowed. (This is the same proven coexistence model the prior ts-rest plan relied on.)
>
> **Alternative:** mount under a versioned prefix `prefix: '/api/v1'` (catch-all at `src/app/api/v1/[...rest]/route.ts`) for clean separation from all legacy `/api/*` routes (no precedence interaction) plus REST versioning. Default below is `/api` to preserve current URLs; switch to `/api/v1` if versioning is wanted before mobile.

---

## 4. Dependencies & version constraints

```bash
npm install @orpc/server @orpc/contract @orpc/client @orpc/openapi @orpc/openapi-client @orpc/zod @orpc/tanstack-query
```

| Package | Role |
|---------|------|
| `@orpc/contract` | `oc` — contract definitions (`.input`/`.output`/`.route`/`.errors`), `ContractRouterClient` type |
| `@orpc/server` | `implement`, `ORPCError`, `ValidationError`, `.use` middleware, `call` (testing), `onError` |
| `@orpc/openapi` | `OpenAPIHandler` (`@orpc/openapi/fetch`) for the route handler; `OpenAPIGenerator` for spec generation |
| `@orpc/client` | `createORPCClient`, `safe`, `isDefinedError`, `onError` |
| `@orpc/openapi-client` | `OpenAPILink` (`@orpc/openapi-client/fetch`), `JsonifiedClient` type |
| `@orpc/zod` | `ZodToJsonSchemaConverter` (`@orpc/zod/zod4`) for OpenAPI gen; `oz.openapi(...)` to enrich schemas (examples) |
| `@orpc/tanstack-query` | `createTanstackQueryUtils` → `queryOptions` / `infiniteOptions` / `mutationOptions` / `key` / `queryKey` |

- **Standard Schema / Zod 4** is native — reuse the repo's Zod 4 validators (`collectionFormSchema`, etc.) directly in the contract. No `zod/v3` compat.
- Versions: pin current stable (`@orpc/* 1.14.x`, verified present 2026-06-15). No Next/React peer constraints conflict with Next 16 / React 19.
- `axios` (`^1.18.0`) stays only until the last `api-fetch` consumer is migrated, then removed if unused (`grep -rln "from 'axios'" src`).

---

## 5. Architecture

### 5.1 Layout

```
src/lib/api/
  contract/
    index.ts          # { items, collections, profile, ai, search, upload, billing, auth }
    common.ts         # shared response schemas (collectionSchema, itemTypeSchema, …)
    collections.ts    # oc-based contract for the collections domain
    items.ts … auth.ts
  router/
    index.ts          # implement(contract) → router (pub / authed implementers)
    collections.ts    # .handler() implementations for contract.collections
    items.ts … auth.ts
  orpc.ts             # base implementers: `pub` (no auth) and `authed` (session→context)   [S]
  middleware.ts       # auth + rate-limit oRPC middleware                                    [S]
  client.ts           # createORPCClient(OpenAPILink) + createTanstackQueryUtils → `orpc`    [C]
  openapi.ts          # OpenAPIGenerator (optional spec generation; §7.1)                    [S]
src/app/api/[...rest]/route.ts   # OpenAPIHandler.handle(request, { prefix: '/api', context })
```

Domain DB helpers (`src/lib/db/*`), validators, logging, cache invalidation, Pro/usage checks are reused **unchanged** — only the transport wrapper changes.

### 5.2 Server/client boundary (per `nextjs-architecture.md`)

| Module | Guard | Why |
|---|---|---|
| `contract/**` | **[C] shared** — no `server-only` | Pure `oc` + Zod schemas; imported by both the handler and the browser client. **Must not import** server-only modules — reuse the client-safe schemas in `src/lib/utils/validators.ts`. |
| `client.ts` | **[C] shared** | Runs in the browser; imports only the contract type + `@orpc/client` |
| `orpc.ts`, `router/**`, `middleware.ts` | **[S] `server-only`** | Import `src/lib/db`, session, Pro, redis |
| `app/api/[...rest]/route.ts` | **[S]** (route handler) | Node.js runtime |

> The client imports `contract` for its **types only** (`ContractRouterClient<typeof contract>`). Because the contract is pure schemas with no server imports, this is browser-safe.

### 5.3 Contract-first (why, not router-first)

oRPC supports deriving the client from the server router directly (type-only import). We use **contract-first** (`@orpc/contract`) instead, because it keeps the Zod schemas in a `server-only`-free module the browser can import, matching the existing `ApiResponse` boundary. `router/**` then `implement(contract)` and only adds `.handler()` bodies — input/output schemas are not duplicated.

---

## 6. Server: contract, context, middleware, errors

### 6.1 Contract (example — collections)

```ts
// src/lib/api/contract/collections.ts   [C]
import { oc } from '@orpc/contract'
import { z } from 'zod'
import { collectionFormSchema } from '@/lib/utils/validators'
import { collectionSchema } from './common'

const updateCollectionInput = collectionFormSchema.partial().extend({ isFavorite: z.boolean().optional() })

export const collectionsContract = {
  list:   oc.route({ method: 'GET', path: '/collections' })
            .output(z.array(collectionSchema)),
  create: oc.route({ method: 'POST', path: '/collections' })
            .input(collectionFormSchema).output(collectionSchema),
  update: oc.route({ method: 'PATCH', path: '/collections/{id}' })
            .input(z.object({ id: z.string(), patch: updateCollectionInput })).output(collectionSchema),
  remove: oc.route({ method: 'DELETE', path: '/collections/{id}' })
            .input(z.object({ id: z.string() })),                             // no .output → 204/empty success
  toggleFavorite: oc.route({ method: 'PATCH', path: '/collections/{id}/favorite' })
            .input(z.object({ id: z.string(), isFavorite: z.boolean() })),
}
```

> **Path params** use OpenAPI `{id}` syntax and must appear in the `.input` schema (oRPC binds them from the URL). **JSON `Date`:** `collectionSchema.createdAt` is `z.coerce.date<Date>()` — the OpenAPI/JSON wire sends an ISO string and the client coerces it back to a real `Date` (the `JsonifiedClient` type reflects this). Same pattern for any `BigInt`/non-JSON output.

### 6.2 Base implementers + auth context

```ts
// src/lib/api/orpc.ts   [S]
import 'server-only'
import { implement, ORPCError } from '@orpc/server'
import { contract } from './contract'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'

export interface AuthedContext { userId: string; isPro: boolean }

export const pub = implement(contract)              // public procedures (auth domain, etc.)

export const authed = pub.use(async ({ next }) => {
  const session = await getCachedSession()
  if (!session?.user?.id) throw new ORPCError('UNAUTHORIZED', { message: 'Not authenticated.' })
  // IDOR-safe: userId comes from the session, never from input
  const isPro = await getCachedVerifiedProAccess(session.user.id)
  return next({ context: { userId: session.user.id, isPro } satisfies AuthedContext })
})
```

### 6.3 Handlers (example — collections)

```ts
// src/lib/api/router/collections.ts   [S]
import 'server-only'
import { ORPCError } from '@orpc/server'
import { authed } from '../orpc'
import { getAllCollections, createCollection, updateCollection, deleteCollection, getCollectionById, toggleCollectionFavorite } from '@/lib/db/collections'
import { canCreateCollection, FREE_TIER_COLLECTION_LIMIT } from '@/lib/db/usage'
import { invalidateCollectionsCache } from '@/lib/infra/cache'

// A plain object of implemented procedures; assembled into the contract-shaped router in router/index.ts
export const collectionsRouter = {
  list: authed.collections.list.handler(({ context }) => getAllCollections(context.userId)),

  create: authed.collections.create.handler(async ({ input, context }) => {
    if (!await canCreateCollection(context.userId, context.isPro))
      throw new ORPCError('FORBIDDEN', { message: `You have reached your free tier limit of ${FREE_TIER_COLLECTION_LIMIT} collections. Please upgrade to Pro.` })
    const created = await createCollection(context.userId, input)
    invalidateCollectionsCache(context.userId)
    return created
  }),

  update: authed.collections.update.handler(async ({ input, context }) => {
    if (!await getCollectionById(context.userId, input.id)) throw new ORPCError('NOT_FOUND', { message: 'Collection not found.' })
    const updated = await updateCollection(context.userId, input.id, input.patch)
    invalidateCollectionsCache(context.userId)
    return updated
  }),

  remove: authed.collections.remove.handler(async ({ input, context }) => {
    if (!await getCollectionById(context.userId, input.id)) throw new ORPCError('NOT_FOUND', { message: 'Collection not found.' })
    await deleteCollection(context.userId, input.id)
    invalidateCollectionsCache(context.userId)
  }),

  toggleFavorite: authed.collections.toggleFavorite.handler(async ({ input, context }) => {
    if (!await toggleCollectionFavorite(context.userId, input.id, input.isFavorite)) throw new ORPCError('NOT_FOUND', { message: 'Collection not found.' })
    invalidateCollectionsCache(context.userId)
  }),
}
```

The top-level router is assembled with `implement(contract).router(...)`, which type-enforces that every implemented procedure matches the contract. Per-domain `lazy()` keeps each domain code-split and speeds type inference (recommended for the 8-domain router):

```ts
// src/lib/api/router/index.ts   [S]
import 'server-only'
import { implement, lazy } from '@orpc/server'
import { contract } from '../contract'
import { collectionsRouter } from './collections'

const os = implement(contract)

export const router = os.router({
  collections: collectionsRouter,
  // as each domain migrates, code-split it:
  // items: lazy(() => import('./items').then(m => m.itemsRouter)),
  // profile: lazy(() => import('./profile').then(m => m.profileRouter)),
})
```

> Exact `.handler` / `.router` / `lazy` chaining is confirmed against the oRPC docs (`implement(contract)` → `os.<path>.handler()` → `os.router({...})`); pin the precise `lazy` resolver form during the spike against `@orpc/server@1.14.x`.

> **Middleware as named units (best practice):** define reusable middleware with `os.middleware(async ({ context, next }) => …)` and compose via `.use(...)` — applies especially to the rate-limit middleware (§6.7), so it can be attached per-procedure. The auth check above may also be extracted to a named `authMiddleware`.

### 6.4 Error mapping — `ORPCError` code → HTTP status (built-in)

`COMMON_ORPC_ERROR_DEFS` maps codes to statuses natively; `message` is a first-class field on every `ORPCError`. The old `ApiStatus` table maps 1:1:

| Old `ApiStatus` | oRPC | HTTP |
|---|---|---|
| `ok` / `created` | return the typed `output` | 200 |
| `bad_request` | `ORPCError('BAD_REQUEST')` | 400 |
| `unauthorized` | `ORPCError('UNAUTHORIZED')` | 401 |
| `forbidden` | `ORPCError('FORBIDDEN')` | 403 |
| `not_found` | `ORPCError('NOT_FOUND')` | 404 |
| `conflict` | `ORPCError('CONFLICT')` | 409 |
| `validation_error` | input validation → see §6.5 | 422 |
| `too_many_requests` | `ORPCError('TOO_MANY_REQUESTS')` | 429 |
| `internal_error` | thrown/unknown → oRPC normalizes | 500 |

Use typed `.errors({ CODE: { data: schema } })` **only** where the client must branch on structured error data; otherwise the standard `ORPCError(code, { message })` is enough (the client reads `error.message`).

### 6.5 Input-validation errors (preserve 422)

oRPC's automatic input validation throws `ORPCError('BAD_REQUEST')` (400) by default. To preserve the old `validation_error` → **422** with a clean message, remap it in the handler's `clientInterceptors` (documented oRPC pattern):

```ts
// in OpenAPIHandler({ clientInterceptors: [ onError(...) ] }) — see the §7 handler
if (error instanceof ORPCError && error.code === 'BAD_REQUEST' && error.cause instanceof ValidationError) {
  const zodError = new z.ZodError(error.cause.issues as z.core.$ZodIssue[])
  throw new ORPCError('INPUT_VALIDATION_FAILED', { status: 422, message: z.prettifyError(zodError), data: z.flattenError(zodError), cause: error.cause })
}
```

### 6.6 Unhandled errors (500) + logging

Replace `apiRoute`'s try/catch with an `onError` interceptor on the handler that logs via `logger.child({ tag: 'api' })`. oRPC normalizes non-`ORPCError` throws to `INTERNAL_SERVER_ERROR` (500) and never leaks internals to the client.

### 6.7 Rate limiting

Per-procedure middleware (oRPC `.use`) calling the existing `rateLimitAction(key, identifier)` from `src/lib/infra/rate-limit.ts`; throw `ORPCError('TOO_MANY_REQUESTS', { message })` on limit. The 22 currently rate-limited routes map 1:1.

---

## 7. Next.js handler (replaces the route wrappers)

```ts
// src/app/api/[...rest]/route.ts   [S]
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { onError, ORPCError, ValidationError } from '@orpc/server'
import { z } from 'zod'
import { router } from '@/lib/api/router'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api' })
const handler = new OpenAPIHandler(router, {
  // plugins: optional — none required same-origin. Candidates:
  //   • OpenAPIReferencePlugin (@orpc/openapi)  → serve interactive Scalar docs + spec.json (mobile/external surface)
  //   • CORSPlugin (@orpc/server/plugins)        → ONLY when a cross-origin client (native mobile) calls directly
  //   • Smart Coercion (experimental)            → optional DX; docs note explicit z.coerce is faster (§16). We use explicit z.coerce.
  interceptors: [onError((error) => log.error({ err: error }, 'orpc handler error'))],
  clientInterceptors: [
    onError((error) => {
      // preserve old validation_error → 422 with a clean message (§6.5)
      if (error instanceof ORPCError && error.code === 'BAD_REQUEST' && error.cause instanceof ValidationError) {
        const zodError = new z.ZodError(error.cause.issues as z.core.$ZodIssue[])
        throw new ORPCError('INPUT_VALIDATION_FAILED', { status: 422, message: z.prettifyError(zodError), data: z.flattenError(zodError), cause: error.cause })
      }
    }),
  ],
})

async function handle(request: Request) {
  const { matched, response } = await handler.handle(request, { prefix: '/api', context: {} })
  if (matched) return response
  return new Response('Not found', { status: 404 })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle

export const runtime = 'nodejs' // handler + middleware import server-only infra (db, session, redis)
```

Initial `context: {}` is empty — the `authed` middleware resolves the session lazily via `getCachedSession()` and populates `userId`/`isPro` per request (§6.2). Resolving auth **in middleware** (rather than in a `createContext`) means public procedures never pay for session resolution, and it reuses the project's request-cached `getCachedSession` + existing test mocks. `matched: false` only for paths not in the contract (legacy explicit routes win before reaching here anyway, per §3).

### 7.1 OpenAPI spec generation (optional, mobile-facing)

The spec is generatable from the same `router` whenever a mobile/external client needs it — no procedure changes:

```ts
// src/lib/api/openapi.ts   [S]
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { router } from './router'

export const openApiGenerator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] })
export const generateOpenApiSpec = () => openApiGenerator.generate(router, { info: { title: 'DevStash API', version: '1.0.0' } })
```

Optionally serve it from a small route (e.g. `GET /api/spec.json`) or a build script. Not required for the web migration — its only consumer is a future mobile/external client.

### 7.2 Deployment (Vercel)

The app targets Vercel. oRPC's `@orpc/openapi/fetch` handler is built on the Web Fetch `Request`/`Response` — exactly what Next.js App Router route handlers receive on Vercel — so no adapter changes are needed. Considerations specific to Vercel serverless:

- **Node runtime, not Edge.** The handler transitively imports Prisma/Neon, bcrypt, Upstash Redis, and session helpers — none Edge-compatible. `export const runtime = 'nodejs'` (§7) pins it; this matches every current `/api/*` route. Never set `runtime = 'edge'` on the catch-all.
- **Single function, many domains → keep `lazy()`.** The catch-all `/api/[...rest]` compiles to **one** serverless function bundling every migrated domain. Per-domain `lazy()` (§6.3) keeps each domain's code out of the cold-start working set until first hit — more valuable on Vercel than locally.
- **`maxDuration` covers the slowest domain.** All oRPC traffic shares one function, so its `maxDuration` must accommodate the longest procedure (the `ai` domain). Set `export const maxDuration = <n>` on the catch-all to match what the AI routes use today. (If AI ever needs streaming or a much larger budget, leave it as an explicit route instead of joining the catch-all.)
- **No large bodies through the function.** File uploads use S3 **presigned URLs** — the browser PUTs directly to S3; only the small presign request + metadata pass through the function, so Vercel request-body limits are a non-issue for the `upload` domain.
- **Cookies / same-origin.** The web client calls same-origin (`/api`) with `credentials: 'include'` — no CORS on Vercel. A future cross-origin mobile client would add `CORSPlugin` (§7) + token-auth middleware.

---

## 8. Exemptions — stay as explicit `/api/*` route files

Unchanged from the prior plan; these never used the JSON envelope and are **not** moved into oRPC (different URL space, never shadowed):

| Route | Why exempt |
|-------|-----------|
| `api/auth/[...nextauth]/route.ts` | NextAuth handler |
| `api/webhooks/stripe/route.ts` | Raw body + signature verification |
| `api/download/[id]/route.ts` | 3xx redirect to signed S3 URL |
| `api/billing/checkout`, `billing/portal`, `billing/checkout-return` | 3xx redirects to Stripe |

JSON billing endpoints that return a body (`billing/cancel`, `billing/reactivate`) and `download/[id]/url` (returns the signed URL as JSON) **are** migrated.

---

## 9. Client (replaces `api-fetch`)

```ts
// src/lib/api/client.ts   [C]
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { ContractRouterClient } from '@orpc/contract'
import { contract } from './contract'

const link = new OpenAPILink(contract, {
  url: typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api',
  // send the session cookie on same-origin requests
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: 'include' }),
})

// JsonifiedClient reflects JSON wire types (e.g. z.coerce.date → Date after coercion)
export const orpcClient: JsonifiedClient<ContractRouterClient<typeof contract>> = createORPCClient(link)
export const orpc = createTanstackQueryUtils(orpcClient)   // TanStack Query utils
```

`OpenAPILink` takes the **contract** (to map calls → REST `method`/`path`) plus the link options. The web client still calls a typed proxy — `orpcClient.collections.create(input)` issues `POST /api/collections` under the hood.

| Consumer kind | Today | After |
|---|---|---|
| Hooks (`use-infinite-items`, `use-global-search`, `use-create-item`, `use-update-item`, `use-pro-download-src`, `use-restricted-download`) | `get/post` + `useQuery`/`useInfiniteQuery` | `useQuery(orpc.<domain>.<op>.queryOptions(...))` / `useInfiniteQuery(orpc.<…>.infiniteOptions(...))` / `useMutation(orpc.<…>.mutationOptions(...))` |
| One-off mutations in components (~27 files) | `post/patch/del` | `safe(orpcClient.<domain>.<op>(input))` |
| `src/stores/editor-preferences.ts` | `api-fetch` | `orpcClient` |

**Call-site transformation** (applies everywhere):

```ts
// success/error: envelope status → oRPC safe()/throw
const res = await post<T>(url, body)
if (res.status === 'ok') use(res.data)        →   const { error, data } = await safe(orpcClient.x.y(input))
else toast(res.message)                            if (!error) use(data); else toast.error(error.message)
```

- **Error handling** uses `safe` + `isDefinedError` (typed errors) instead of axios `handleApiError`, which is deleted with `api-fetch`. For Pro-gate branches, check `error.code === 'FORBIDDEN'`.
- **Query keys**: oRPC supplies typed keys via `orpc.<domain>.key()` / `orpc.<domain>.<op>.queryKey({ input })`. Cache updaters (`setQueryData`/`invalidateQueries`) stay **inside the hook files** per `coding-standards.md`, using these key helpers.
- The shared `collection-form-dialog`'s `onSubmitAction` changes from returning `ApiBody<unknown>` to throwing on error (oRPC client throws `ORPCError`); the dialog wraps the call in `safe`/try-catch, reading `error.message` and `error.code === 'FORBIDDEN'` for the upgrade-prompt branch.

---

## 10. Files

### Create
- `src/app/api/[...rest]/route.ts`
- `src/lib/api/contract/*` (index + common + 8 domain contracts)
- `src/lib/api/router/*` (index + 8 domain routers)
- `src/lib/api/orpc.ts` (`pub` / `authed`)
- `src/lib/api/middleware.ts` (rate-limit middleware)
- `src/lib/api/client.ts`

### Migrate (per domain, then delete the explicit route)
- 37 `route.ts` files total → **~31 migrate** into oRPC; **6 stay exempt** (§8).
- ~34 client files importing `@/lib/api/api-fetch` (27 components + 6 hooks + 1 store).
- `rate-limit.ts`, `profile-helpers.ts` (`src/lib/app/profile-helpers.ts`), `toggle-route.ts` — drop `ApiResponse`. Also off-envelope: `src/lib/ai/description-generation.ts`, `src/lib/app/action-utils.ts`, `src/lib/billing/subscription/toggle-cancellation.ts`.
- `parseOrFail` stays only for the remaining Server Action consumers (`src/actions/auth/link.ts`, `session.ts`).

### Delete (final step, after all domains migrated)
- `src/lib/api/api-response.ts`, `src/lib/api/api-fetch.ts`, `src/lib/api/toggle-route.ts`
- `src/types/api.ts` (`ApiBody`, `ApiStatus`)
- `ApiResponse` / `apiRoute` / `authenticatedRoute` / `apiRedirect` / `HTTP_STATUS` exports in `src/lib/api/index.ts`
- `axios` dependency (if unused).

---

## 11. Validation mapping

The ~20 routes using `parseOrFail` move their schemas into the contract (`.input(...)`). oRPC validates input automatically before the handler runs — `parseOrFail` calls inside handlers are deleted. Schemas already in `src/lib/utils/validators.ts` (e.g. `collectionFormSchema`) are imported by the contract; inline route schemas move next to their contract entry.

---

## 12. Test plan

oRPC procedures are unit-testable without HTTP: call a procedure with `call(procedure, input, { context })` from `@orpc/server` (or make it `.callable()`), injecting a mocked `{ userId, isPro }` context.

| Surface | Change |
|---|---|
| ~16 API-layer test files | Re-point: invoke the oRPC procedure (or the router via `call`) and assert the returned `output`, or assert the thrown `ORPCError` `code`/`status`/`message` |
| Contract | Type-level test (`expectTypeOf`) that client inference matches handler input/output for one op per domain |
| Validation | Assert bad input rejects (422 + message after the §6.5 remap) |
| Auth | Assert no session → `ORPCError('UNAUTHORIZED')` (401); assert `userId` is taken from context/session, not input (IDOR) |
| Rate limit | Assert limited procedure → `ORPCError('TOO_MANY_REQUESTS')` (429) |
| Full suite | `npm run test:run` green; `npm run lint` green |

No component tests (per project rule). Verify per domain as it migrates.

---

## 13. Migration phases

1. **Spike (gate)** — install deps; build the `collections` contract (with `.route()`/`.output()`) + `orpc.ts` (`pub`/`authed`) + `router/collections.ts` + the `/api` OpenAPI handler + `client.ts` (`OpenAPILink`); migrate the collections hooks/components (create/edit/delete/favorite dialogs, header actions, the item-drawer collection picker `useQuery`); confirm Zod 4 input/output validation, the auth context, `ORPCError`→HTTP mapping, REST routing + catch-all/explicit-route coexistence, `z.coerce.date` round-trip, and TanStack Query integration work end to end. Sanity-check `generateOpenApiSpec()` produces a valid spec. Re-decide before the bulk rollout.
2. **Per-domain rollout** — items → profile → ai → search → upload → billing(JSON) → auth(JSON). Each: contract + router + middleware wiring + client call-site swaps + tests, then delete the explicit `route.ts`. Verify per domain.
3. **Teardown** — delete dead files/exports + `axios`; update `.agents/rules/api-contract.md` and `nextjs-architecture.md` to describe oRPC.

---

## 14. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| `implement(contract)` chaining shape differs from §6.3 in `1.14.x` | Confirm in the spike (it's the first thing built); adjust the router-construction idiom |
| Loss of uniform `message` | `message` is native on every `ORPCError`; unknown throws normalized to 500 with a generic message (§6.6) |
| Validation status drift (400 vs 422) | Remap `BAD_REQUEST`+`ValidationError` → 422 in `clientInterceptors` (§6.5) |
| Cookies not sent on API calls | `OpenAPILink` custom `fetch` with `credentials: 'include'` (§9) |
| Catch-all `[...rest]` vs explicit `/api/*` routes | Rely on Next.js precedence (static > dynamic > catch-all); confirm in the spike. Or use `prefix: '/api/v1'` for zero overlap (§3) |
| JSON loses `Date`/`BigInt` fidelity | `z.coerce.date<Date>()` / `z.coerce.bigint<bigint>()` in `.output`; `JsonifiedClient` types reflect it (§6.1) |
| Large client churn (~34 files) | Mechanical, type-checked transformation; migrate per domain so each change set is reviewable |
| TanStack cache rules drift | Keep updaters in hook files per `coding-standards.md`; use `orpc.<domain>.key()` typed keys |
| Edge runtime | Handler + middleware import `server-only` infra; keep on Node runtime (current default) |

---

## 15. Acceptance criteria

- [ ] `@orpc/{server,contract,client,openapi,openapi-client,zod,tanstack-query}` installed at stable `1.14.x`
- [ ] `src/app/api/[...rest]/route.ts` serves all migrated domains via `OpenAPIHandler` as plain REST; coexists with legacy/exempt explicit routes
- [ ] Every migrated procedure declares `.route()` + `.output()` and validates input and output against its contract (Zod 4); `generateOpenApiSpec()` yields a valid OpenAPI 3.x doc
- [ ] Web client uses `OpenAPILink` (`JsonifiedClient`) + TanStack Query utils
- [ ] Auth middleware reproduces session→401, IDOR-safe `userId`, Pro gating→403; rate-limited procedures → 429
- [ ] Every error carries a `message`; client branches read `error.message` / `error.code`
- [ ] All 6 exempt routes (§8) still resolve correctly
- [ ] All `@/lib/api/api-fetch` consumers migrated to `orpcClient` / `orpc` TanStack utils
- [ ] `api-response.ts`, `api-fetch.ts`, `toggle-route.ts`, `src/types/api.ts`, dead `index.ts` exports deleted; `axios` removed if unused
- [ ] `api-contract.md` + `nextjs-architecture.md` updated to document oRPC
- [ ] `npm run lint` and `npm run test:run` pass

---

## 16. oRPC best-practices alignment (per-package)

Verified against the oRPC docs (Context7 + orpc.unnoq.com, 2026-06-15). How each package's recommendations map onto DevStash:

| Package / topic | oRPC recommendation | DevStash decision |
|---|---|---|
| `@orpc/contract` | Contract-first when client/server separation or runtime validation matters; group with nested router objects; reuse Standard-Schema (Zod 4) validators | **Adopt contract-first** — keeps schemas in a `server-only`-free module (matches the existing `[C]`/`[S]` boundary); reuse `src/lib/utils/validators.ts` |
| `@orpc/server` build | `implement(contract)` → `os.<path>.handler()` → assemble with `os.router({...})`; type-enforced against contract | §6.3 — plain handler objects per domain, assembled in `router/index.ts` via `implement(contract).router(...)` |
| Router size | `lazy(() => import(...))` per sub-router for code-splitting + faster type inference | Code-split each of the 8 domains with `lazy()` (§6.3) |
| Middleware | Define named middleware via `os.middleware(...)`, compose with `.use()`; resolve auth in middleware **or** `createContext` | Auth + rate-limit as named middleware; **resolve session in middleware** via request-cached `getCachedSession()` (keeps public procedures free of session cost; reuses existing test mocks) |
| Context | Inject shared deps via `.$context<T>()` / `createContext`; only globally-safe context for the shared SSR client | Initial context empty; per-request `userId`/`isPro` injected by `authed` middleware. No global shared client (see SSR row) |
| Errors | Typed `.errors({ CODE: { data } })` for errors the **client branches on**; plain `throw new ORPCError(code, { message })` otherwise | Generic 401/403/404/409/429 via thrown `ORPCError`. Declare a typed error only where the client needs structured data (e.g. Pro-limit → upgrade prompt) so `isDefinedError` narrows it |
| `@orpc/openapi` handler | `OpenAPIHandler`; `{ matched, response }`; plugins for cross-cutting concerns | §7. No plugins required same-origin. `OpenAPIReferencePlugin` optional (Scalar docs); `CORSPlugin` only when a cross-origin mobile client calls directly |
| Coercion (`@orpc/zod`) | `ZodToJsonSchemaConverter` (`/zod4`) for the spec; **Smart Coercion plugin is DX sugar — explicit `z.coerce` is more efficient for complex schemas** | **Use explicit `z.coerce.date<Date>()`** on output dates; path-param ids are already `string` (no coercion). Smart Coercion plugin noted as an optional fallback, not default |
| `@orpc/openapi-client` | `OpenAPILink(contract, …)` + `JsonifiedClient<…>`; custom `fetch` for cookies | §9 — `credentials: 'include'` via custom `fetch`; browser-only |
| `@orpc/tanstack-query` | `createTanstackQueryUtils`; `queryOptions`/`infiniteOptions`/`mutationOptions`; typed keys via `.key()`/`.queryKey()`; `isDefinedError` in `onError` | §9 — hooks own `queryOptions`/`mutationOptions`; cache updaters stay in hook files using `orpc.<domain>.key()` (satisfies `coding-standards.md`) |
| SSR optimization | Recommended: server-side `createRouterClient` (no HTTP during SSR), browser falls back to the link | **N/A — deliberately not adopted.** RSC already fetches via `src/lib/db/*` helpers (not the API); the oRPC client is browser-only. No server router-client, no global `$client`. This is consistent with `nextjs-architecture.md` (RSC → db helpers; client → API) |
| Next.js runtime | Keep Node runtime; conditional import guard via `process.env.NEXT_RUNTIME` if needed | `export const runtime = 'nodejs'` on the handler route (server-only infra) |

**Net:** the migration adopts oRPC's idioms (contract-first, `implement().router()`, `lazy()` splitting, middleware-injected context, typed `ORPCError`, `JsonifiedClient` + TanStack utils, explicit `z.coerce`) rather than porting the old envelope's habits — while keeping the project's RSC-vs-client data-fetching split intact.

## 17. References

- oRPC contract-first: https://orpc.unnoq.com/docs/contract-first/define-contract
- OpenAPI getting started + handler: https://orpc.unnoq.com/docs/openapi/getting-started , /docs/openapi/openapi-handler
- OpenAPILink (client): https://orpc.unnoq.com/docs/openapi/client/openapi-link
- OpenAPI spec generation (`@orpc/openapi` + `@orpc/zod`): https://orpc.unnoq.com/docs/openapi/openapi-specification
- Non-JSON output types (`z.coerce.date`): https://orpc.unnoq.com/docs/openapi/advanced/expanding-type-support-for-openapi-link
- Server implementation & middleware: https://orpc.unnoq.com/docs/middleware
- Next.js adapter: https://orpc.unnoq.com/docs/adapters/next
- Error handling (`ORPCError`, `safe`, `isDefinedError`): https://orpc.unnoq.com/docs/error-handling , /docs/client/error-handling
- TanStack Query integration: https://orpc.unnoq.com/docs/integrations/tanstack-query
- Validation-error customization (422 remap): https://orpc.unnoq.com/docs/advanced/validation-errors
- Prior (rejected) plan: `context/features/ts-rest-migration-spec.md`
</content>
</invoke>
