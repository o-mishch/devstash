---
trigger: glob
globs:
  - src/**/*.ts
  - src/**/*.tsx
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
description: Next.js architecture for DevStash — where each mutation/fetch goes (route-handler client vs Server Actions vs exempt routes), the server/client bundle boundary (`import 'server-only'` vs `'use server'`), file organization, data fetching, and Zod validation. Loads when editing files under src/.
---

# Next.js Architecture

> Standing rules for the server/client architecture. When `context/current-feature.md` describes an in-flight migration that supersedes a rule here, the feature doc wins **for files in that feature's scope only** — update this doc once the migration lands. Language-level rules live in `coding-standards.md`; database rules in `database.md`.

## Next.js

- Server components by default; only use `'use client'` when needed (interactivity, hooks, browser APIs)
- Dynamic routes for item/collection pages

### Where each mutation / fetch goes

| Situation | Use |
|---|---|
| Data read in a Server Component | `src/lib/db/` helper (not `prisma.*` inline) |
| Mutation or data fetch from a client component | a **route handler** via `api` / `$api` (`@/lib/api/client`). **Never** a Server Action, **never** raw `fetch()`/`axios` |
| Webhook, third-party callback, redirect with a specific HTTP status | exempt explicit route (`apiRoute` / `authenticatedRoute`) — see `api-contract.md` |
| Redirect-terminating auth flow that can't be REST (OAuth sign-in, sign-out, account link) | Server Action — the **only** sanctioned use (still on the `ApiBody` envelope) |

The typed route-handler client is the default for all client-driven mutations and reads (full contract in `api-contract.md`). New code must not add Server Actions for ordinary mutations. A new endpoint is a new `src/app/api/<domain>/.../route.ts` + a `paths.ts` declaration + schemas, then `npm run openapi:gen` — not a Server Action and not a hand-edited generated type.

> **Client API:** `@/lib/api/client` exports `api` (openapi-fetch — `await api.POST('/path', { body, params })` → `{ data, error, response }`, never throws) and `$api` (openapi-react-query hooks). `ApiBody`/`ApiResponse` survive only for Server Actions and the exempt routes.
>
> **Exempt route wrappers** (`@/lib/api`): `authenticatedRoute(async (request, context, { userId, isPro }) => …)` (IDOR-safe `userId`) and `apiRoute(...)` remain for the exempt explicit routes only (NextAuth, Stripe webhook, S3/Stripe redirects). Feature route handlers use the `authedRoute` / `authedRouteWithParams` / `publicRoute` wrappers from `@/lib/api/route` instead.

## Server / Client Boundary

Next.js runs code in two runtimes: the Node.js server and the browser. Server Components and Server Actions are **frontend primitives** — they are part of the React component model and happen to run server-side. The boundary that matters here is the **browser bundle**: modules that use Node.js APIs or secret env vars must never end up in the client bundle.

### `'server-only'` guard

`server-only` is a bundler guard, not an architectural label. Add `import 'server-only'` as the **first line** of any module that uses Node.js APIs, secret env vars, or should never be shipped to the browser. This makes the Next.js bundler throw a build error if a client file accidentally imports it.

**It must be the `import` statement — not a bare string.** `server-only` is an installed npm package, not a compiler directive. Only `'use client'` / `'use server'` / `'use cache'` are recognised as bare-string directives; a bare `'server-only'` is just a discarded string expression that imports nothing and protects nothing. The guard fires only when the package is actually imported (its `"browser"` export throws at build time).

**Exception — build-time-reachable modules.** A module imported (transitively) by `next.config.ts` must **not** carry the guard, because the config loader evaluates the package's throwing browser export and `next build` fails before it starts. `src/env/validate-billing-env.ts` is exempt for this reason: it sits in the `next.config.ts` → `validate-billing-env.ts` chain. It holds no secrets (just `NODE_ENV` + `console.warn`), so leaving it unguarded is safe. Do not add `import 'server-only'` to it, and do not import the Pino `logger` into it — use `console.warn` directly. The logger itself (`src/lib/infra/pino.ts`) **is** `server-only`-guarded precisely because it is not in the build-time chain.

| Folder / File | Why |
|---|---|
| `src/lib/db/` | Prisma queries + `'use cache'` — never safe in a browser bundle |
| `src/lib/infra/` | Redis, Prisma client, rate-limit, resend, cache — Node.js / server env |
| `src/lib/auth/` | bcrypt, crypto, DB user helpers — requires Node.js and secret env vars |
| `src/lib/billing/` | Stripe SDK, webhooks, subscription logic — secret keys, Node.js only |
| `src/lib/storage/` | S3 file uploads — secret keys, Node.js only |
| `src/lib/stripe/` | Stripe SDK client — secret key |
| `src/lib/app/` | App shell data fetchers (sidebar, action utils) — DB / session access |
| `src/lib/session.ts` | Session helpers — reads cookies / auth, Node.js only |
| `src/lib/api/index.ts` | Route wrappers — `NextRequest` / `NextResponse`, Node.js only |

```typescript
// ✅ correct — first line of any server-only module
import 'server-only'

import { prisma } from '@/lib/infra/prisma'

// ❌ wrong — bare string is a no-op; the module ships to the client unprotected
'server-only'
```

### `'use server'` vs `import 'server-only'`

These solve **opposite problems** and are frequently confused:

| | `import 'server-only'` | `'use server'` |
|---|---|---|
| **Purpose** | Prevent module from reaching client bundle | Expose server function as callable from client |
| **Enforcement** | Build error if a client file imports it | Next.js creates a network RPC endpoint |
| **Functions inside** | Normal server functions — not callable from client | Server Actions — callable from client via POST |
| **Use for** | DB helpers, secret env vars, Prisma, Node.js APIs | Redirect-terminating auth flows only (OAuth, sign-out, link) |

```typescript
// 'server-only' — bundler guard; function is NOT callable from client
import 'server-only'
export async function getData() {
  return fetch('...', { headers: { authorization: process.env.API_KEY } })
}

// 'use server' — creates a Server Action; callable from client components
'use server'
export async function createItem(formData: FormData) { ... }
```

**Rule:** `src/actions/` uses `'use server'`; `src/lib/db/`, `src/lib/infra/`, etc. use `import 'server-only'`. Never add `'server-only'` to action files — client components must be able to import them (see [Where each mutation / fetch goes](#where-each-mutation--fetch-goes) for when a Server Action is permitted at all).

### Shared modules (no `'server-only'`)

| Folder / File | Why safe |
|---|---|
| `src/lib/utils/` | Pure TypeScript — constants, formatters, validators, no secret env vars |
| `src/lib/editor/` | Monaco config / themes — used in client editor components |
| `src/lib/api/schemas/**` | Bare Zod request/response schemas — browser-safe (imported by `paths.ts` + route handlers) |
| `src/lib/api/openapi/**` | `paths.ts` + `spec.ts` — pure schema declarations, no secrets |
| `src/lib/api/http.ts` | `json` / `noContent` / `problem` / `parseOr422` — pure Response builders |
| `src/lib/api/client.ts` | `api` + `$api` — browser route-handler client |
| `src/lib/api/api-response.ts` | `ApiResponse` builders / `ApiBody` type — shared by Server Actions + exempt routes |
| `src/types/` | Type definitions only |
| `src/stores/` | Zustand stores — client state, no server imports |
| `src/hooks/` | React hooks — client-only by design |
| `src/components/` | React components — RSC or `'use client'` |

### Never import Node.js-only modules from client files

A `'use client'` file must never import from `src/lib/db/`, `src/lib/infra/`, `src/lib/auth/`, `src/lib/billing/`, `src/lib/storage/`, `src/lib/stripe/`, `src/lib/session.ts`, or `src/lib/api/index.ts`.

```typescript
// ✅ correct — client component mutates via the typed route-handler client
'use client'
import { api } from '@/lib/api/client'

// ❌ wrong — client component imports server-only module directly
'use client'
import { prisma } from '@/lib/infra/prisma'
import { getItems } from '@/lib/db/items'
```

## File Organization

- Components: `src/components/[feature]/ComponentName.tsx`
- Pages: `src/app/[route]/page.tsx`
- Server Actions: `src/actions/[feature].ts`
- Types: `src/types/[feature].ts`
- Lib: domain and infrastructure under `src/lib/` — use the matching subfolder, not a flat root file. **S** = server-only (`'server-only'` required); **C** = shared (client + server safe):
  - `src/lib/db/` **[S]** — Prisma data access (all `prisma.*` calls except `auth.ts` adapter exception)
  - `src/lib/infra/` **[S]** — logger, prisma client, redis, rate-limit, cache, resend
  - `src/lib/auth/` **[S]** — auth service, tokens, pending OAuth link
  - `src/lib/billing/` **[S]** — Stripe billing, subscriptions, webhooks, checkout
  - `src/lib/storage/` **[S]** — file uploads (AWS S3)
  - `src/lib/stripe/` **[S]** — Stripe SDK client wrappers
  - `src/lib/app/` **[S]** — app shell helpers (sidebar data, action utils)
  - `src/lib/session.ts` **[S]** — session + action auth helpers (root exception)
  - `src/lib/api/index.ts` **[S]** — `apiRoute` route wrappers (exempt routes)
  - `src/lib/api/route.ts` **[S]** — `authedRoute` / `authedRouteWithParams` / `publicRoute` (feature route handlers)
  - `src/lib/api/http.ts` **[C]** — `json` / `noContent` / `problem` / `parseOr422` Response builders
  - `src/lib/api/schemas/**` **[C]** — bare Zod request/response schemas (browser-safe)
  - `src/lib/api/openapi/**` **[C]** — `paths.ts` + `spec.ts` (OpenAPI doc source)
  - `src/lib/api/client.ts` **[C]** — `api` + `$api` (browser route-handler client)
  - `src/lib/api/api-response.ts` **[C]** — `ApiResponse` builders (Server Actions + exempt routes)
  - `src/lib/editor/` **[C]** — editor themes and config
  - `src/lib/utils/` **[C]** — shared constants, formatters, validators (no DB/Stripe)
- Context definitions (`createContext`, hooks, reducers, types — no JSX): `src/context/[name]-context.tsx`
- Provider components (React components that render `<Context.Provider>`): `src/providers/[name]-provider.tsx`

## Data Fetching

- Server components fetch via `src/lib/db/` helpers (not `prisma.*` inline)
- Client components fetch and mutate via the route-handler client (`api` / `$api` from `@/lib/api/client`) — not Server Actions (see [Where each mutation / fetch goes](#where-each-mutation--fetch-goes))
- Never use `fetch()` or `axios` directly for our API — call `api` / `$api`. (Direct-to-S3 uploads with progress are the one exception: `uploadToS3` in `src/lib/storage/s3-upload-client.ts`.)

## Validation

All external inputs (JSON bodies, query params, path params) must be validated with Zod before use.

**Route handlers** (the default): parse each source — body (`await request.json()`), query (`request.nextUrl.searchParams`), path params (`ctx.params`) — with `parseOr422(schema, value)` from `@/lib/api/http`, which returns `{ ok: false, res }` (a ready-made 422 `problem`) on failure. The schema lives in `src/lib/api/schemas/<domain>.ts` and is the same one `paths.ts` references. Reuse the client-safe validators in `src/lib/utils/validators.ts` where they fit.

```ts
// schemas/items.ts  [C]
export const createItemInput = z.object({ /* … */ })

// app/api/items/route.ts  [S] — parse, then userId from session (IDOR-safe)
export const POST = authedRoute({ rateLimit: 'itemMutation' }, async ({ userId, request }) => {
  const parsed = parseOr422(createItemInput, await request.json())
  if (!parsed.ok) return parsed.res
  return json(await createItem(userId, parsed.data), 201)
})
```

**Server Actions and exempt routes** keep `parseOrFail` (from `@/lib/utils/validators`), which returns a ready-made `ApiResponse.VALIDATION_ERROR` body on failure.
