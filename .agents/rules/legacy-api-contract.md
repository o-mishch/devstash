---
trigger: glob
globs:
  - src/app/api/**/*
  - src/actions/**/*
  - src/types/actions.ts
  - src/lib/api/**/*
paths:
  - "src/app/api/**/*"
  - "src/actions/**/*"
  - "src/types/actions.ts"
  - "src/lib/api/**/*"
description: Client↔server contract for DevStash — Next.js Route Handlers with Zod schemas as the source of truth, generated OpenAPI 3.1 doc and typed client (`api`/`$api`), the route wrappers, and the `ActionState` envelope used only for Server Actions. Loads when editing API routes, server actions, or `src/lib/api/`.
---

# API Contract

The client↔server contract for the nine feature domains is **native Next.js Route Handlers** with **Zod** schemas as the single source of truth, an **OpenAPI 3.1** document generated from those schemas (`zod-openapi`), and a **generated, typed client** (`openapi-typescript` → `openapi-fetch` + `openapi-react-query`). The `ActionState` envelope is **used only** for Server Actions (see below).

## Route Handlers (default for all client-driven reads/mutations)

Every endpoint is an explicit `src/app/api/<domain>/.../route.ts` (file = URL). Bare Zod schemas validate input; success returns resource JSON with the right status, errors return `{ message }` (+ optional `data`) with the right status.

```
src/lib/api/
  route.ts    [S] authedRoute / authedRouteWithParams<P> / publicRoute — session gate, optional
              rate limit, Pro resolution, single 500 catch (inject IDOR-safe { userId, isPro })
  http.ts     [C] json() / noContent() / problem(status, message, data?, headers?) / parseOr422()
  schemas/    [C] bare Zod request/response schemas per domain (no server-only); the source of truth
  openapi/    [C] paths.ts (method+path → schemas/status) + spec.ts (createDocument)
  client.ts   [C] api (openapi-fetch) + $api (openapi-react-query), credentials: 'include'
  error-messages.ts [C] ErrorMessage — strings shared across transports / repeated across handlers
scripts/generate-openapi.ts   build-tooling — writes openapi.json
openapi.json + src/types/openapi.ts   generated, committed; a no-diff CI gate keeps them fresh
```

The OpenAPI doc and the handlers import the **same** Zod schemas, so their shapes can't disagree; `npm run openapi:gen` regenerates `openapi.json` + `src/types/openapi.ts` and must produce **no git diff**.

Domains: `items` · `collections` · `profile` · `ai` · `search` · `upload` · `billing` · `auth` · `download`.

### Server: route handler + path declaration

```ts
// schemas/collections.ts  [C]
export const createCollectionInput = z.object({ name: z.string().min(1), description: z.string().nullable() })
export const collectionSchema = z.object({ /* … */ createdAt: z.coerce.date<Date>() }).meta({ id: 'Collection' })

// app/api/collections/route.ts  [S]
export const POST = authedRoute({}, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(createCollectionInput, await request.json())
  if (!parsed.ok) return parsed.res
  if (!(await canCreateCollection(userId, isPro))) return problem(403, '…upgrade to Pro.')
  return json(await createCollection(userId, parsed.data), 201) // userId from session, never input (IDOR-safe)
})

// openapi/paths.ts  [C] — same schemas the handler imports
'/collections': { post: {
  requestBody: { content: { 'application/json': { schema: createCollectionInput } } },
  responses: { 201: { /* collectionSchema */ }, 401: unauthorized, 403: problem('…'), 422: problem('…') },
} }
```

- **Helpers:** `authedRoute(opts, handler)` for static paths; `authedRouteWithParams<P>(opts, handler)` for dynamic segments (`ctx.params` is the awaited `Promise<P>`); `publicRoute(handler)` for unauthenticated routes (auth domain — no session gate; rate-limit inline).
- **Validation:** path params, query (`request.nextUrl.searchParams`), and body (`await request.json()`) parse from their **own** sources via `parseOr422` → 422 with `z.prettifyError` + `z.flattenError`.
- **Errors:** *expected* non-200s are **returned** via `problem(status, message, data?, headers?)` — no thrown control flow (`legacy-coding-standards.md`: no custom Error subclasses, no `instanceof` routing). Only unexpected throws hit the single 500 catch in the wrapper.
- **Output dates:** keep `z.date()` / `z.coerce.date<Date>()` in schemas; `spec.ts`'s `override` emits `date-time` in the output context so the generated client types the field as `string` (the honest JSON wire type). Per-field, flip the matching hand-written domain TS type to `string` only where the value is rendered from a client fetch.
- **Reusable components:** add `.meta({ id })` to shared output schemas so they become `$ref` components instead of inlining across operations. (Do **not** set `reused: 'ref'` — in `zod-openapi` v6 it also hoists repeated primitives into anonymous `__schemaN` components.)
- **Rate limiting:** `authedRoute({ rateLimit: '<key>' })` gates by `userId` (429 + `Retry-After`) before the handler. When Pro/validation must gate first (ai, upload) or the key is IP-based (auth), call `checkRateLimit` inline instead.
- **AI routes:** every budget-consuming `POST /ai/*` needs a `LIMIT_CONFIG` rate-limit key (consumed via `runProAiGeneration`) **and** a client call routed through `useAiMutation` (`src/hooks/ai/use-ai-usage.ts`), so the dashboard AI Usage meter refetches after a token is spent. This is enforced at **compile time, not by lint**: `src/lib/api/ai-mutation-paths.ts` declares the closed `AiMutationPath` union, `src/lib/api/client.ts` omits those paths from the public `api`/`$api` clients (so calling one directly is a type error), and `useAiMutation`'s narrowed `aiMutationClient` is the sole caller. `/ai/*` endpoints that don't spend budget (e.g. brain-dump commit routes) are deliberately excluded from the union and stay reachable through the public client.
- **Typed errors** (only where the client branches on structured data): return `problem(status, message, data)` and declare a dedicated response schema with that `data` shape. Example: `auth/login` → 403 `{ message, data: { email } }`.
- **Shared messages:** strings used on both transports or repeated across a domain's handlers live in `ErrorMessage` (`src/lib/api/error-messages.ts`, `[C]`) — e.g. `ErrorMessage.NOT_AUTHENTICATED`, `ErrorMessage.FILE_NOT_FOUND`, `ErrorMessage.ITEM_NOT_FOUND`. Bespoke single-site messages stay inline. (`deniedMessage()` in `rate-limit.ts` is the same idea for the 429 string.)

### Frontend

```ts
import { api, $api } from '@/lib/api/client'

// one-off call — openapi-fetch returns { data, error, response }; never throws
const { data, error, response } = await api.POST('/collections', { body: input })
if (!error) use(data)
else toast.error(error.message)               // response.status === 403 for the upgrade branch

// hooks — openapi-react-query re-throws so TanStack's `error` holds the typed body
const create = $api.useMutation('post', '/collections')
const list = $api.useQuery('get', '/collections')
```

- Path/query params go under `params: { path: { id }, query: { … } }`; the body under `body`.
- Components never call `useQueryClient()` directly — cache updaters live in the hook files (see `legacy-coding-standards.md`). `use-infinite-items` keeps its manual `useInfiniteQuery` + custom `['items']` keys.
- **Typed errors:** narrow on the structured member — e.g. `if ('data' in error && error.data)` for `auth/login`'s 403 — and/or read `response.status`.
- Form-driven submits use `useApiFormAction(submit, { onSuccess })` (`src/hooks/ui/use-api-form-action.ts`), where `submit` throws `new Error(error.message)` on failure.
- Direct-to-S3 uploads (with progress) use `uploadToS3` (`src/lib/storage-client/s3-upload-client.ts`), **not** the api client — the request goes straight to S3.

## Server Actions — `ActionState`

Redirect-terminating auth Server Actions (`src/actions/`) and their helpers use the `ActionState` interface (`src/types/actions.ts`). `parseOrFail` and `rateLimitAction`/`withRateLimit` serve these actions. Server Actions aren't HTTP/OpenAPI endpoints (no URL), so they are not registered in the OpenAPI document.

```ts
import type { ActionState } from '@/types/actions'

export async function myAction(_prev: ActionState | null, formData: FormData): Promise<ActionState> {
  if (!valid) return { success: false, message: 'Validation failed' }
  return { success: true }
}
```

## Exempt explicit routes — standard Next.js route wrappers

These don't fit the typed-JSON model and keep their explicit `src/app/api/*/route.ts` files:

| Route | Why exempt | Wrapper & Builders |
|-------|-----------|--------------------|
| `api/auth/[...nextauth]` | NextAuth handler | Native NextAuth handler |
| `api/webhooks/stripe` | Raw body + signature verification | `publicRoute()`, `json()`, `problem()` |
| `api/download/[id]` | 3xx redirect to a signed S3 URL | `authedRouteWithParams()`, `apiRedirect()` |
| `api/billing/checkout-return` | 3xx redirect to settings after Stripe | `publicRoute()`, `apiRedirect()` |

## Rules

- **Client-driven reads/mutations** go through `api` / `$api` (`@/lib/api/client`). Never `fetch()`/`axios`, never a Server Action for an ordinary mutation.
- **A new endpoint is a new `route.ts` + a `paths.ts` declaration + schemas** — both importing the same Zod schema; then `npm run openapi:gen`. Do not hand-edit `openapi.json` or `src/types/openapi.ts`.
- `userId` always comes from the session (`ctx.userId`), never from input — see `security-principles.md § IDOR prevention` and `legacy-security.md` for the mechanics.
- Schema modules (`schemas/**`) are `[C]` — never import `server-only` code into them; reuse the client-safe schemas in `src/lib/utils/validators.ts`.
- Server Actions that only redirect (OAuth, sign-out) do not return action states and redirect directly.
