# Route Handlers + zod-to-openapi + openapi-fetch Migration

> **Status:** Specification — not yet implemented. Proposed alternative to the **completed** oRPC layer.
> **Supersedes (if adopted):** the oRPC implementation documented in `context/features/orpc-migration-spec.md` + `context/current-feature.md`.
> **Scope:** Replace oRPC (contract + router + `orpc.ts` + `middleware.ts` + catch-all `OpenAPIHandler` + `OpenAPILink` client) with **native Next.js Route Handlers**, an OpenAPI document **generated from Zod schemas** via [`zod-openapi`](https://github.com/samchungy/zod-openapi), and a **generated, typed client** via [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript) + [`openapi-fetch`](https://github.com/openapi-ts/openapi-typescript) (+ `openapi-react-query` for TanStack).
> **Response model:** REST-native — success returns the resource JSON with the right HTTP status; errors return `{ message }` (+ optional `data`) with the right status code. No oRPC `ORPCError`, no `{ status, data, message }` envelope.

---

## 0. Why this migration (the trade being made)

oRPC works and is fully implemented, but it has two structural properties this plan deliberately reverses (see the evaluation that motivated this spec):

1. **It replaces Next.js file-based routing.** A single catch-all `src/app/api/[...rest]/route.ts` + `OpenAPIHandler` owns all 9 domains. You lose per-route files, route colocation, segment config, and native `middleware.ts` path matching — Next conventions are traded for a parallel router framework.
2. **It is a sub-framework to learn.** `implement(contract)`, `pub`/`authed`, `lazy()` wiring, the 422 `clientInterceptor` remap, `ResponseValidationPlugin` — a contributor must learn oRPC before adding a field.

This plan keeps **REST + OpenAPI + a typed client** (the goals that killed the lightweight options last round) while restoring **native Next.js routing** and removing the framework. The cost is explicit and accepted:

| | oRPC (current) | This plan |
|---|---|---|
| Routing | One catch-all, framework-routed | **Native file-based `route.ts` per endpoint** |
| Client type-safety | Direct end-to-end inference from the contract | **Spec-mediated** — types **generated** from the OpenAPI doc (a codegen step) |
| OpenAPI spec | Generated from the router | Generated from the Zod schemas (`createDocument`) |
| Runtime output validation | Automatic (`ResponseValidationPlugin`) | **Opt-in** per response (see §6.4 — the one real regression to decide on) |
| `Date` on the client | Coerced back to `Date` | JSON `string` by default (see §6.4) |
| New dependency surface | 7 `@orpc/*` packages | 3 (`zod-openapi`, `openapi-fetch`, `openapi-react-query`) + 1 dev (`openapi-typescript`) |

> **This is not a clear "lighter" win** — it is a different point on the curve: native routing + spec-generated types vs. framework + direct inference. Adopt only if the routing-paradigm restoration is worth giving up direct inference. The migration is large (38 endpoints, 34 client files) and the layer it replaces is green.

### 0.1 Decision: derive the OpenAPI doc from handlers, or hand-declare paths? (DECIDED: Path A)

The dominant ecosystem best-practice is *don't hand-maintain an OpenAPI document parallel to your handlers — derive it*. That directly targets this spec's weakest point: the separate `openapi/paths.ts` declaration (§4.3), which can drift from the handlers. Two ways to satisfy it:

| | **Path A — hand-rolled helper + declared `paths.ts`** (chosen) | **Path B — `defineRoute` wrapper** |
|---|---|---|
| Spec source | `openapi/paths.ts` + `createDocument`, both importing the **same** Zod schema as the handler | A single `defineRoute({ method, pathParams, queryParams, requestBody, responses, action })` is *both* the runtime handler and the spec source ([`next-openapi-route-handler`](https://github.com/omermecitoglu/next-openapi-route-handler)) |
| Drift | Possible → guarded by shared schemas + a **mandatory `npm run openapi:gen` no-diff CI gate** + the path↔route registry check (§12) | Structurally impossible |
| Dependency risk | None beyond `zod-openapi` | A low-popularity, single-maintainer dep (52★, v2.0.2, + a peer generator pkg) — the **same maturity-risk class that disqualified ts-rest** last round |
| Fit with this project's dependency-conservatism | ✅ | ⚠️ |

**Decision: Path A.** Keep the hand-rolled `authedRoute`/`publicRoute` helpers and the declared `paths.ts`, but treat the shared Zod schema as the single source (handler + `paths.ts` import it) and enforce the no-diff gate so drift is caught in CI. This buys best-practice drift protection without taking on a ts-rest-shaped dependency. Revisit Path B only if `paths.ts` maintenance proves painful and `next-openapi-route-handler` has matured.

---

## 1. Overview

oRPC's single source of truth is the **contract** (`src/lib/api/contract/**`). This plan keeps the Zod schemas — they remain the source of truth — but drops the `oc.route()` wrapper and the `implement()`/router/handler machinery. Schemas feed two consumers:

1. **Route handlers** validate request input against the schema and return JSON.
2. **`zod-openapi`** assembles a static OpenAPI 3.1 document from the schemas + a per-domain path declaration. `openapi-typescript` turns that document into `paths` types; `openapi-fetch` is the typed client.

```ts
// before (oRPC) — call site infers from the contract directly
const { error, data } = await safe(orpcClient.collections.create(input))
if (!error) use(data); else toast.error(error.message)

// after — call site infers from the GENERATED `paths` types
const { data, error } = await api.POST('/collections', { body: input })
if (data) use(data); else toast.error(error.message)

// after — hook (openapi-react-query over TanStack Query)
const create = $api.useMutation('post', '/collections', {
  onSuccess: (data) => { /* typed from the spec */ },
  onError: (error) => toast.error(error.message),
})
```

---

## 2. Goals

1. **Native Next.js routing** — every endpoint is an explicit `src/app/api/<domain>/.../route.ts` (file = URL). Delete the catch-all.
2. **Zod schemas stay the single source of truth** for input, output, and the OpenAPI document.
3. **REST-native responses** — resource JSON + correct status on success; `{ message }` (+ optional `data`) + correct status on error. No envelope, no `ORPCError`.
4. **A generated OpenAPI 3.1 document** (`src/lib/api/openapi/spec.ts` → `npm run openapi:gen`) — mobile/external-ready, identical surface to today.
5. **A generated, typed client** — `openapi-typescript` → `paths` types; `openapi-fetch` + `openapi-react-query` for call sites and hooks. End-to-end *typed* (via codegen), even if not *inferred*.
6. **Preserve all current behavior**: session auth → 401, IDOR-safe `userId` (from session, never input), Pro gating → 403, rate limiting → 429, input validation → 422, unhandled → 500, a human-readable `message` on every error.
7. **Migrate incrementally**, domain by domain — restored explicit routes and the still-mounted oRPC catch-all coexist (a restored explicit `route.ts` wins over the catch-all by Next precedence) until the catch-all is deleted in teardown.
8. Remove oRPC (`@orpc/*`), `client.ts`'s `OpenAPILink`, `orpc.ts`, `router/**`, the contract's `oc.route()` usage, and the catch-all handler.

### Non-goals

- Building the mobile app or hosting the published spec (the doc is generatable; productionizing it is out of scope).
- Touching the exempt routes (§8) — they already are native route handlers and stay unchanged.
- Replacing redirect-terminating auth Server Actions in `src/actions/`.
- Bearer-token auth (session-cookie only; same-origin `credentials: 'include'`).
- Keeping the `{ status, data, message }` envelope for the migrated API (it survives only for Server Actions + exempt routes, unchanged).

---

## 3. Dependencies

```bash
npm install zod-openapi openapi-fetch openapi-react-query
npm install -D openapi-typescript
npm uninstall @orpc/server @orpc/contract @orpc/client @orpc/openapi @orpc/openapi-client @orpc/zod @orpc/tanstack-query
```

| Package | Role |
|---|---|
| `zod-openapi` | `createDocument()` + `.meta()` on Zod schemas → OpenAPI 3.1 doc. **Zod-4-native** (uses `.meta()`, not a separate registry). |
| `openapi-typescript` (dev) | CLI: OpenAPI doc → `paths` TypeScript types. Run in `openapi:gen`. |
| `openapi-fetch` | ~6 KB typed `fetch` wrapper: `createClient<paths>()` → `api.GET/POST/PATCH/DELETE(path, opts)`. |
| `openapi-react-query` | `createClient(fetchClient)` → `$api.useQuery/useMutation/useInfiniteQuery` over TanStack Query, typed from `paths`. |

- Reuse the repo's Zod 4 validators (`src/lib/utils/validators.ts`) and the existing response schemas in `src/lib/api/contract/common.ts` — they are already written and Zod-4-native.
- Verify current stable versions at implementation time via the `/context7-mcp` skill (`zod-openapi`, `openapi-typescript`).

---

## 4. Architecture

### 4.1 Layout

```
src/lib/api/
  schemas/                 [C] shared Zod schemas (renamed from contract/, oc.route() stripped)
    common.ts              # collectionSchema, lightItemSchema, … (reused as-is)
    collections.ts         # input/output schemas only — no `oc`
    items.ts … download.ts
  openapi/
    paths.ts               [C] per-domain path declarations referencing the schemas
    spec.ts                [S/script] createDocument(...) → OpenAPI 3.1 JSON
  route.ts                 [S] authedRoute() / publicRoute() helpers (auth + parse + rate-limit + 500-catch)
  http.ts                  [C] json()/problem() Response builders + status constants
  client.ts                [C] createClient<paths>() (openapi-fetch) + $api (openapi-react-query)
  error-messages.ts        [C] ErrorMessage (unchanged)
  index.ts                 [S] apiRoute/authenticatedRoute/ApiResponse — UNCHANGED (Server Actions + exempt routes)
  api-response.ts          [C] UNCHANGED

src/types/openapi.ts       generated by openapi-typescript (committed, regenerated via openapi:gen)

src/app/api/<domain>/.../route.ts   explicit Next.js route handlers (the migrated endpoints)
```

Domain DB helpers (`src/lib/db/*`), validators, logging, cache invalidation, Pro/usage checks, rate limiting are reused **unchanged** — only the transport wrapper changes.

### 4.2 Server/client boundary (per `nextjs-architecture.md`)

| Module | Guard | Why |
|---|---|---|
| `schemas/**`, `openapi/paths.ts`, `http.ts`, `client.ts`, `error-messages.ts`, `src/types/openapi.ts` | **[C]** | Pure Zod / pure types / browser fetch client — no server imports |
| `route.ts`, `openapi/spec.ts` (when imported by a route) | **[S] `server-only`** | Import session, db, redis, Pro checks |
| `src/app/api/**/route.ts` | **[S]** (route handler) | Node.js runtime (default) |

> `client.ts` imports **only** `src/types/openapi.ts` (generated types) + `openapi-fetch`/`openapi-react-query` — browser-safe, no schema import needed at runtime.

### 4.3 Why the spec is *declared*, not *derived*

With native route handlers, the OpenAPI document cannot be auto-extracted from the handler functions (they are plain `(req) => Response`). So `openapi/paths.ts` **declares** each `method + path → { request schema, response schema, status }` referencing the shared Zod schemas. This is the one piece of "contract" that survives — but it is *only* for spec/type generation, fully decoupled from the runtime handlers. The handler and the path declaration both import the same schema, so they cannot disagree on shape; a drift check (§9, §12) guards against a handler existing without a declared path and vice-versa.

---

## 5. Schemas (source of truth, oRPC-stripped)

Rename `src/lib/api/contract/` → `src/lib/api/schemas/` and remove the `oc.route().input().output()` wrappers, keeping the bare Zod schemas. `common.ts` is reused verbatim (it already has no `oc`). Example:

```ts
// src/lib/api/schemas/collections.ts   [C]
import { z } from 'zod'
import { collectionFormSchema } from '@/lib/utils/validators'
import { collectionSchema } from './common'

export const createCollectionInput = collectionFormSchema
export const updateCollectionInput = collectionFormSchema.partial().extend({ isFavorite: z.boolean().optional() })
export const collectionIdParam = z.object({ id: z.string() })
export const toggleFavoriteInput = z.object({ isFavorite: z.boolean() })
export { collectionSchema }   // output
```

Path params, query params, and bodies become **separate** schemas (route handlers parse each from its own source — `params`, `searchParams`, `request.json()`), unlike oRPC's single merged `.input`.

---

## 6. Server: route handlers

### 6.1 Helper (`src/lib/api/route.ts`) — replaces `orpc.ts` + `middleware.ts` + `authed`

A thin wrapper that does exactly what the `authed` implementer + rate-limit middleware did, returning plain JSON. Expected non-200 outcomes are **returned** via `problem()` (no thrown control-flow, per `coding-standards.md` — no custom Error subclasses, no `instanceof` routing). Only genuinely unexpected throws bubble to the 500 catch.

```ts
// src/lib/api/route.ts   [S]
import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit, deniedMessage, type RateLimitKey } from '@/lib/infra/rate-limit'
import { ErrorMessage } from './error-messages'
import { logger } from '@/lib/infra/pino'
import { json, problem } from './http'

const log = logger.child({ tag: 'api' })

interface AuthedCtx { userId: string; isPro: boolean; request: NextRequest }

interface AuthedRouteOptions {
  rateLimit?: RateLimitKey
}

// Returns a Next.js route-handler function. `handler` returns a NextResponse (via json()/problem()).
export function authedRoute(
  opts: AuthedRouteOptions,
  handler: (ctx: AuthedCtx) => Promise<NextResponse>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const session = await getCachedSession()
    if (!session?.user?.id) return problem(401, ErrorMessage.NOT_AUTHENTICATED)
    const userId = session.user.id

    if (opts.rateLimit) {
      const { success, retryAfter } = await checkRateLimit(opts.rateLimit, userId)
      if (!success) return problem(429, deniedMessage(retryAfter), undefined, { 'Retry-After': String(retryAfter) })
    }

    try {
      const isPro = await getCachedVerifiedProAccess(userId)
      return await handler({ userId, isPro, request })
    } catch (err) {
      log.error({ userId, err }, 'unhandled route error')
      return problem(500, 'Something went wrong. Please try again.')
    }
  }
}

// publicRoute(): same shape without the session gate (auth domain).
```

```ts
// src/lib/api/http.ts   [C]
import { NextResponse } from 'next/server'

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status })
}

// REST-native error body: { message } (+ optional structured data), correct status.
export function problem(status: number, message: string, data?: unknown, headers?: Record<string, string>) {
  return NextResponse.json(data === undefined ? { message } : { message, data }, { status, headers })
}

// Parse a Zod schema against a source; on failure return a 422 problem with a clean message.
export function parseOr422<T>(schema: z.ZodType<T>, value: unknown): { ok: true; data: T } | { ok: false; res: NextResponse } {
  const r = schema.safeParse(value)
  if (r.success) return { ok: true, data: r.data }
  return { ok: false, res: problem(422, z.prettifyError(r.error), z.flattenError(r.error)) }
}
```

### 6.2 Handler example (collections — full domain in one tree)

```ts
// src/app/api/collections/route.ts   [S]
import { authedRoute } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { createCollectionInput } from '@/lib/api/schemas/collections'
import { getAllCollections, createCollection } from '@/lib/db/collections'
import { canCreateCollection, FREE_TIER_COLLECTION_LIMIT } from '@/lib/db/usage'
import { invalidateCollectionsCache } from '@/lib/infra/cache'

export const GET = authedRoute({}, async ({ userId }) =>
  json(await getAllCollections(userId)),
)

export const POST = authedRoute({}, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(createCollectionInput, await request.json())
  if (!parsed.ok) return parsed.res
  if (!(await canCreateCollection(userId, isPro)))
    return problem(403, `You have reached your free tier limit of ${FREE_TIER_COLLECTION_LIMIT} collections. Please upgrade to Pro.`)
  const created = await createCollection(userId, parsed.data)   // userId from session — IDOR-safe
  invalidateCollectionsCache(userId)
  return json(created, 201)
})
```

```ts
// src/app/api/collections/[id]/route.ts   [S]  → PATCH + DELETE
// src/app/api/collections/[id]/favorite/route.ts   [S]  → PATCH
```

Path params come from the second handler arg (`{ params }`); since `authedRoute` wraps only `request`, routes needing params use a small variant `authedRouteWithParams<P>()` (or read `ctx.params` — finalize the helper signature in the spike). Each handler validates its own params/query/body with `parseOr422`.

### 6.3 Error mapping (replaces `ORPCError` codes)

| oRPC today | This plan |
|---|---|
| return typed output | `json(data)` / `json(data, 201)` |
| `ORPCError('BAD_REQUEST')` | `problem(400, msg)` |
| `ORPCError('UNAUTHORIZED')` | `problem(401, msg)` (handled by `authedRoute`) |
| `ORPCError('FORBIDDEN')` | `problem(403, msg)` |
| `ORPCError('NOT_FOUND')` | `problem(404, msg)` |
| `ORPCError('CONFLICT')` | `problem(409, msg)` |
| input validation → 422 | `parseOr422()` → `problem(422, prettifyError, flattenError)` |
| `ORPCError('TOO_MANY_REQUESTS')` | `problem(429, …, { 'Retry-After' })` (handled by `authedRoute`) |
| unknown throw → 500 | `authedRoute` 500 catch |
| typed error `EMAIL_NOT_VERIFIED` (login) | `problem(403, msg, { email })` — client reads `error.data.email` (see §10) |

`ErrorMessage` (`src/lib/api/error-messages.ts`) is reused unchanged.

### 6.4 ⚠️ Decision: `Date` and runtime output validation (DECIDED: Option A via `override`)

This is the **one real regression** vs oRPC's `ResponseValidationPlugin`:

- oRPC today coerces JSON responses back through the output schemas, so the client receives real `Date`s (matching `LightItem.createdAt: Date`, `CollectionWithTypes.createdAt: Date`, etc.) and gets runtime output validation for free.
- `NextResponse.json(...)` serializes `Date` → ISO string. So **the client receives strings and there is no runtime output check.**

**The Zod schemas do NOT need to change.** `zod-openapi` 5.x (Zod-4-native) has a built-in global output `override` — its own docs use the date case as the example. Keep `z.date()` / `z.coerce.date()` in the schemas; the generated doc emits `format: date-time`, and `openapi-typescript` maps that to `string`:

```ts
// src/lib/api/openapi/spec.ts — createDocument options
createDocument(doc, {
  override: ({ jsonSchema, zodSchema, io }) => {
    if (zodSchema._zod.def.type === 'date' && io === 'output') {
      jsonSchema.type = 'string'
      jsonSchema.format = 'date-time'
    }
  },
})
```

The honest matrix (note: `openapi-typescript`'s `transform` hook *can* emit a `Date` **type**, but the JSON runtime value is still a string — typing it `Date` without runtime revival is a **type lie**, so the only valid "Date" path is B, with real revival):

| Option | Date type on client | Runtime value | Output validation | Cost |
|---|---|---|---|---|
| **A. Accept strings (chosen)** | `string` | `string` ✅ honest | none | Change the ~4 hand-written domain-type date fields (`LightItem`, `CollectionWithTypes`, `ItemDetails`, `ItemSavedDetails`) to `string`; formatters already accept `string`. Schemas untouched (`override` handles the doc). Most consistent with "REST-native JSON". |
| **B. Revive + validate per response** | `Date` | `Date` ✅ honest | ✅ | A per-call `schema.parse(data)` in a client middleware/hook — re-adds the runtime framework this migration set out to drop (≈ the pre-oRPC `parseOrFail` model). Keeps domain types unchanged. Choose only if output validation is deemed essential — and note it narrows the migration's benefit. |
| ~~C. `transform` → `Date` type, no revival~~ | `Date` | `string` ❌ **lie** | none | **Rejected** — the type claims `Date` but the value is a string. |

**Decision: Option A** + the `zod-openapi` `override` above. Honest, zero runtime cost, schemas unchanged. Fall back to B only if a consumer genuinely needs runtime output validation.

### 6.5 Rate limiting / Pro gating / IDOR

- Rate limit: `authedRoute({ rateLimit: 'itemMutation' }, …)` — reuses `checkRateLimit` + `deniedMessage` (`src/lib/infra/rate-limit.ts`), unchanged.
- Pro gating: `problem(403, …)` after the `canCreateItem`/`canCreateCollection`/Pro-type checks (logic copied verbatim from the current routers).
- IDOR: `userId` always from `ctx.userId` (session), never from params/body — identical guarantee to `authed`.

---

## 7. OpenAPI document generation

**Best practice — register shared output schemas as reusable components.** Add `.meta({ id })` to every schema reused across endpoints (`collectionSchema`, `lightItemSchema`, `itemDetailsSchema`, …) so `zod-openapi` emits a single `components` entry + `$ref` instead of inlining the shape into all 38 operations. This keeps the doc and the generated `paths` types small and mobile-friendly. Pair with `reused: 'ref'` in the options.

```ts
// src/lib/api/schemas/common.ts   [C] — shared output schemas carry a component id
export const collectionSchema = z.object({ /* … */ }).meta({ id: 'Collection' })
export const lightItemSchema  = z.object({ /* … */ }).meta({ id: 'LightItem' })
```

```ts
// src/lib/api/openapi/paths.ts   [C] — declare each endpoint referencing the shared schemas
import { createCollectionInput, collectionSchema, /* … */ } from '../schemas/collections'

export const paths = {
  '/collections': {
    get:  { responses: { 200: { content: { 'application/json': { schema: z.array(collectionSchema) } } } } },
    post: { requestBody: { content: { 'application/json': { schema: createCollectionInput } } },
            responses: { 201: { content: { 'application/json': { schema: collectionSchema } } } } },
  },
  // … all 38 endpoints
}
```

```ts
// src/lib/api/openapi/spec.ts   — run by the openapi:gen script
import { createDocument } from 'zod-openapi'
import { paths } from './paths'

export const openApiDocument = createDocument(
  {
    openapi: '3.1.0',
    info: { title: 'DevStash API', version: '1.0.0' },
    paths,
  },
  {
    reused: 'ref', // reused schemas become $ref components, not inlined
    override: ({ jsonSchema, zodSchema, io }) => {
      // Date → date-time string in output context (see §6.4)
      if (zodSchema._zod.def.type === 'date' && io === 'output') {
        jsonSchema.type = 'string'
        jsonSchema.format = 'date-time'
      }
    },
  },
)
```

> Schemas with Zod-4 input/output divergence (a `.default()`, `.transform()`, or `z.coerce.date`) generate **separate** input/output components in `zod-openapi` 5.x; use `outputIdSuffix` to name them if both contexts appear. Most schemas here are symmetric, so this is rarely triggered.

```jsonc
// package.json
"scripts": {
  "openapi:gen": "tsx src/lib/api/openapi/generate.ts && openapi-typescript ./openapi.json -o ./src/types/openapi.ts"
}
```

`generate.ts` writes `openApiDocument` to `openapi.json`; `openapi-typescript` turns it into `src/types/openapi.ts`. Both `openapi.json` and `src/types/openapi.ts` are **committed**, and a CI/lint check (§12) fails if regenerating produces a diff (i.e. schemas changed but types weren't regenerated). Dev-only Swagger UI (replacing the current `OpenAPIReferencePlugin` at `/api/docs`) can serve `openapi.json` via a small dev-gated `src/app/api/docs/route.ts` — optional.

---

## 8. Exempt routes — unchanged

These are already native route handlers using `apiRoute`/`authenticatedRoute`/`ApiResponse` and are **not touched**:

| Route | Why exempt |
|---|---|
| `api/auth/[...nextauth]` | NextAuth handler |
| `api/webhooks/stripe` | Raw body + signature verification |
| `api/download/[id]` | 3xx redirect to a signed S3 URL |
| `api/billing/checkout-return` | 3xx redirect to settings after Stripe |

`src/lib/api/index.ts` (`apiRoute`, `authenticatedRoute`, `apiRedirect`, `HTTP_STATUS`), `api-response.ts`, and `src/types/api.ts` all **stay** — they still serve these routes + the Server Actions. (Same retained surface as today.)

---

## 9. Client (replaces `OpenAPILink` + `orpc` TanStack utils)

```ts
// src/lib/api/client.ts   [C]
import createFetchClient from 'openapi-fetch'
import createQueryClient from 'openapi-react-query'
import type { paths } from '@/types/openapi'

const fetchClient = createFetchClient<paths>({
  baseUrl: typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api',
  credentials: 'include',   // session cookie, same-origin — no auth middleware needed
})

// Best practice: centralize the cross-cutting concern (logging) in middleware, not at 34 call
// sites. openapi-fetch does NOT throw on non-2xx — it returns { data, error }; openapi-react-query
// re-throws that error so TanStack's `error` state holds the typed { message, data? } body.
fetchClient.use({
  onResponse({ response }) {
    if (!response.ok) log.warn({ url: response.url, status: response.status }, 'api error')
    return response
  },
})

export const api = fetchClient                 // one-off calls: api.POST('/collections', { body })
export const $api = createQueryClient(fetchClient)   // hooks: $api.useQuery('get', '/items', …)
```

| Consumer kind | oRPC today | After |
|---|---|---|
| Hooks (`use-infinite-items`, `use-global-search`, `use-create-item`, `use-update-item`, `use-pro-download-src`, `use-restricted-download`) | `orpcClient.*` + custom `useQuery`/`useInfiniteQuery` | `$api.useQuery/useInfiniteQuery/useMutation('get','/items', …)` (or keep manual TanStack + `api.GET(...)` where custom cache keys matter — see note) |
| One-off mutations in components (~28 files) | `safe(orpcClient.x.y(input))` | `const { data, error } = await api.POST('/path', { body })` |
| `src/stores/editor-preferences.ts` | `orpcClient.profile.updateEditorPreferences` | `api.PATCH('/profile/editor-preferences', { body })` |

**Call-site transformation:**

```ts
// oRPC                                          →   openapi-fetch
const { error, data } = await safe(orpcClient.collections.create(input))
if (!error) use(data); else toast.error(error.message)
//                                                →
const { data, error } = await api.POST('/collections', { body: input })
if (data) use(data); else toast.error(error.message)   // error is the { message, data? } body
```

- **Error shape:** `openapi-fetch` returns `{ data, error }`. On non-2xx, `error` is the parsed `{ message }` body. Read `error.message`; for the Pro-gate branch check `response.status === 403` (the `{ data }` from `useResponse`), and for login's unverified-email branch read `error.data.email` (§6.3). `openapi-fetch` exposes `response` alongside `{ data, error }` for status checks.
- **Cache updaters** stay **inside the hook files** per `coding-standards.md`. `use-infinite-items` keeps its manual `useInfiniteQuery` + custom `['items', JSON.stringify(params)]` keys (tightly coupled cache updaters) and only swaps the call to `api.GET('/items', { params: { query } })` — same as the oRPC migration kept them manual. (`$api.useInfiniteQuery` derives its own query key from method+path+params, which would **not** match the existing `['items']` key the updaters target — so the manual hook stays. Use `$api` for the simpler hooks only.)
- **`$api.useInfiniteQuery` maps cleanly to cursor pagination** where adopted: its `pageParamName` defaults to `'cursor'` and the page shape here is `ItemsPage = { items, nextCursor, hasMore }` → `getNextPageParam: (last) => last.nextCursor`, `initialPageParam: null`.
- **Date fields** arrive as `string` (Option A, §6.4) — update consumers/formatters accordingly.

---

## 10. Endpoint inventory (38 endpoints → explicit route files)

| Domain | Auth | Endpoints | Route files |
|---|---|---|---|
| collections | authed | `GET /collections`, `POST /collections` (201), `PATCH/DELETE /collections/{id}`, `PATCH /collections/{id}/favorite` | `collections/route.ts`, `collections/[id]/route.ts`, `collections/[id]/favorite/route.ts` |
| items | authed | `GET /items`, `POST /items` (201), `PATCH/DELETE /items/{id}`, `GET /items/{id}/details`, `GET /items/{id}/content`, `PATCH /items/{id}/favorite`, `PATCH /items/{id}/pinned` | `items/route.ts`, `items/[id]/route.ts`, `items/[id]/details/route.ts`, `items/[id]/content/route.ts`, `items/[id]/favorite/route.ts`, `items/[id]/pinned/route.ts` |
| profile | authed | `DELETE /profile`, `PATCH /profile/name`, `PATCH /profile/editor-preferences`, `PATCH+POST /profile/password`, `DELETE /profile/credentials`, `PATCH /profile/email`, `PATCH /profile/main-email`, `DELETE /profile/accounts/{id}` | one file per path (`password/route.ts` exports both PATCH + POST) |
| ai | authed | `POST /ai/description`, `POST /ai/tags`, `POST /ai/collection-description` | 3 files |
| search | authed | `GET /search` | `search/route.ts` |
| upload | authed | `POST /upload/url`, `DELETE /upload` | `upload/url/route.ts`, `upload/route.ts` |
| billing | authed | `POST /billing/checkout`, `POST /billing/portal`, `POST /billing/cancel`, `POST /billing/reactivate` | 4 files (checkout/portal return `{ url }` JSON — they migrate; only `checkout-return` is exempt) |
| auth | **public** | `POST /auth/login` (typed 403 `EMAIL_NOT_VERIFIED` w/ `{ email }`), `POST /auth/register`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/resend-verification` | 5 files via `publicRoute()` + rate limits |

Auth + register + forgot/reset-password keep their existing **rate limits** (login 5/15min, register/forgot 3/1h, reset 5/15min — `src/lib/infra/rate-limit.ts`).

---

## 11. Files

### Create
- `src/lib/api/route.ts` (`authedRoute`/`publicRoute` + a params variant), `src/lib/api/http.ts` (`json`/`problem`/`parseOr422`)
- `src/lib/api/openapi/paths.ts`, `openapi/spec.ts`, `openapi/generate.ts`
- `src/lib/api/client.ts` (rewritten — `openapi-fetch` + `openapi-react-query`)
- `src/types/openapi.ts` (generated, committed)
- `openapi.json` (generated, committed)
- 38 `src/app/api/<domain>/.../route.ts` files

### Modify
- `src/lib/api/contract/` → rename to `src/lib/api/schemas/`; strip `oc.route()`, keep the Zod schemas **including their `z.date()`/`z.coerce.date()`** (the `override` in §7 handles the doc); add `.meta({ id })` to reused output schemas in `common.ts`
- 34 client files (28 components + 6 hooks + 1 store) → `api`/`$api`
- **hand-written domain TS types** with dates → `string` (Option A, §6.4) — `src/types/item.ts`, `src/types/collection.ts`; the Zod schemas are **not** changed
- `package.json` scripts (`openapi:gen`), `.agents/rules/api-contract.md`, `nextjs-architecture.md`

### Delete (teardown)
- `src/app/api/[...rest]/route.ts` (the catch-all)
- `src/lib/api/orpc.ts`, `src/lib/api/middleware.ts`, `src/lib/api/router/**`, `src/lib/api/openapi.ts`
- `oc.route()` usage in the schemas; `@orpc/*` packages
- `src/hooks/use-orpc-form-action.ts` → replace with a `useApiFormAction` over `openapi-fetch` (same throwing/onSuccess contract)

### Keep unchanged
- `src/lib/api/index.ts` (`apiRoute`/`authenticatedRoute`/`apiRedirect`/`HTTP_STATUS`), `api-response.ts`, `src/types/api.ts`, `error-messages.ts` — Server Actions + exempt routes
- `src/lib/storage/s3-upload-client.ts` (direct-to-S3 XHR upload — never went through oRPC)
- All `src/lib/db/*`, Pro/usage/cache/rate-limit infra

---

## 12. Test plan

The current oRPC suites call procedures via `call(proc, input, { context })`. Route handlers are tested by **invoking the exported handler with a mocked `NextRequest`** and asserting the `NextResponse` status + JSON body (the request-cached session/Pro mocks already exist).

| Surface | Change |
|---|---|
| ~9 API-layer test files (per-domain) | Re-point: build a `NextRequest`, call `GET`/`POST`/… from the route module, assert `res.status` + `await res.json()` |
| Auth | No session → 401; `userId` taken from session not body (IDOR) |
| Pro gate | Free user on Pro action → 403 + message |
| Validation | Bad body → 422 + `{ message, data }` (prettify/flatten) |
| Rate limit | Over-limit → 429 + `Retry-After` |
| Typed error | `auth.login` unverified → 403 + `{ data: { email } }` |
| Spec/types drift | `npm run openapi:gen` produces **no git diff** (committed `openapi.json` + `src/types/openapi.ts` are in sync); a path declared with no route file (or vice-versa) fails a registry check |
| Full suite | `npm run test:run` + `npm run lint` green; `npm run build` (routing + catch-all removal touches Next routing → build required) |

No component tests (project rule). Verify per domain as it migrates.

---

## 13. Migration phases

1. **Spike (gate)** — install deps; convert **collections** (3 route files) + `route.ts`/`http.ts` helpers + `openapi/paths.ts` (collections only) + `openapi:gen` (with the §7 `override` + `reused: 'ref'`) + `client.ts` (with the §9 logging middleware); migrate collections hooks/components; **apply §6.4 Option A** (schemas keep `z.date()`; `override` → `date-time`; hand-written domain types → `string`). Confirm: native routing wins over the still-mounted catch-all, 401/403/404/422/429 paths, IDOR, `openapi-typescript` types match call sites (dates land as `string`), `openapi-react-query` hooks, spec generation is valid OpenAPI 3.1 with `$ref` components, and the no-diff drift check works. Re-decide before bulk rollout — this is a large migration off a working layer.
2. **Per-domain rollout** — items → profile → ai → search → upload → billing(JSON) → auth(public). Each: schemas (strip `oc`) + route files + path declarations + client swaps + tests, regenerate types, delete that domain from the oRPC `router/index.ts` + `contract/index.ts`. Verify per domain.
3. **Teardown** — delete the catch-all, `orpc.ts`, `middleware.ts`, `router/**`, `openapi.ts`, `oc` usage; `npm uninstall @orpc/*`; replace `use-orpc-form-action.ts`; rewrite `api-contract.md` + `nextjs-architecture.md` to document route handlers + generated client.

---

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Spec-mediated types drift from handlers** | `paths.ts` and handlers import the *same* Zod schema; commit generated `openapi.json` + `src/types/openapi.ts`; CI fails on regen diff; registry check pairs every path with a route file |
| **Loss of `Date` + runtime output validation (§6.4)** | **Decided: Option A** — schemas keep `z.date()`; `zod-openapi` `override` emits `date-time`→`string`; hand-written domain types become `string`. Fall back to B (per-response revive+parse) only if a consumer needs runtime output validation |
| **`paths.ts` drifts from handlers (§0.1)** | **Decided: Path A** — handler + `paths.ts` import the same Zod schema; mandatory `npm run openapi:gen` no-diff CI gate + path↔route registry check. (Path B / `defineRoute` rejected for dependency risk) |
| Path-param/query parsing now manual (3 sources, not one `.input`) | `parseOr422` per source in the helper; `authedRouteWithParams` for `{ id }` routes |
| `profile/password` PATCH+POST on one path | One `route.ts` exporting both `PATCH` and `POST` — native Next.js |
| Large client churn (34 files) | Mechanical, type-checked (generated `paths`); migrate per domain so each change set is reviewable |
| `openapi-fetch` error branching less ergonomic than `isDefinedError` | Use the returned `response.status` + `error.data` for the 2 structured branches (Pro 403, login 403 `{ email }`); everything else reads `error.message` |
| Re-introducing per-call validation (Option B) erodes the migration's benefit | If chosen, acknowledge the layer is "route handlers + Zod parse" — closer to the pre-oRPC `parseOrFail` model than to "lightweight REST" |
| Build-time routing changes | Run `npm run build` (catch-all removal + new explicit routes change Next routing) |

---

## 15. Acceptance criteria

- [ ] `zod-openapi`, `openapi-fetch`, `openapi-react-query` (+ dev `openapi-typescript`) installed; all `@orpc/*` removed
- [ ] All 38 endpoints served by explicit `src/app/api/<domain>/.../route.ts` files; catch-all `[...rest]/route.ts` deleted
- [ ] `authedRoute`/`publicRoute` reproduce session→401, IDOR-safe `userId`, Pro→403, rate-limit→429, validation→422, unknown→500; every error carries a `message`
- [ ] `npm run openapi:gen` produces a valid OpenAPI 3.1 doc with the 38 expected ops, reused schemas as `$ref` components (`.meta({ id })` + `reused: 'ref'`), and `date-time` strings (via `override`); `openapi.json` + `src/types/openapi.ts` committed and diff-clean in CI
- [ ] Web client uses `openapi-fetch` (`api`) + `openapi-react-query` (`$api`) with a centralized logging middleware; all 34 former oRPC consumers migrated
- [ ] §6.4 Option A applied consistently (Zod schemas keep dates; hand-written domain types → `string`; formatters accept strings)
- [ ] All 4 exempt routes still resolve; `index.ts`/`api-response.ts`/`src/types/api.ts` unchanged and still serve Server Actions
- [ ] `api-contract.md` + `nextjs-architecture.md` rewritten to document route handlers + generated client
- [ ] `npm run lint`, `npm run test:run`, `npm run build` all green

---

## 16. References

- `zod-openapi` v5.x (`createDocument`, `.meta({ id })`, `override`, `reused`, `outputIdSuffix`): https://github.com/samchungy/zod-openapi — verified via Context7 `/samchungy/zod-openapi`, 2026-06
- `openapi-fetch` (`{ data, error }`, `client.use()` middleware, `params: { path, query }`): https://openapi-ts.dev/openapi-fetch
- `openapi-react-query` (`useQuery`/`useMutation`/`useInfiniteQuery` w/ `pageParamName: 'cursor'`): https://openapi-ts.dev/openapi-react-query
- `openapi-typescript` (`date-time`→`string`; `transform` hook caveat, §6.4): https://openapi-ts.dev/node
- Route-handler-native OpenAPI generation (Path B, §0.1 — evaluated, rejected for dependency risk): https://github.com/omermecitoglu/next-openapi-route-handler
- Next.js Route Handlers: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- Current (to-be-replaced) oRPC layer: `context/features/orpc-migration-spec.md`
- Rejected lightweight/heavier alternatives (Hono, Zodios, tRPC, ts-rest): evaluation in conversation history
- Verify library APIs/versions at implementation time via the `/context7-mcp` skill
