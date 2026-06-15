---
trigger: glob
globs:
  - src/**/*.ts
  - src/**/*.tsx
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
description: Next.js architecture for DevStash — where each mutation/fetch goes (REST routes + api-fetch verb helpers vs Server Actions), the server/client bundle boundary (`import 'server-only'` vs `'use server'`), file organization, data fetching, and Zod validation. Loads when editing files under src/.
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
| Mutation or data fetch from a client component | a verb helper (`get`/`post`/`patch`/`del` from `@/lib/api/api-fetch`) → REST route. **Never** a Server Action, **never** raw `fetch()` |
| Webhook, file upload, third-party callback, specific HTTP status/headers, mobile/CLI endpoint | REST route (`apiRoute` / `authenticatedRoute`) |
| Redirect-terminating auth flow that can't be REST (OAuth sign-in, sign-out, account link) | Server Action — the **only** sanctioned use |

REST routes + the `api-fetch` verb helpers are the default for all client-driven mutations and reads. New code must not add Server Actions for ordinary mutations — they exist only for the redirect flows above (NextAuth `signIn`/`signOut` set cookies + redirect internally and cannot be expressed as a REST response).

> **Client HTTP API:** `@/lib/api/api-fetch` exports verb helpers, **not** an `apiFetch` symbol — `get<T>(url, options?)`, `post<T>(url, body?, options?)`, `put<T>(…)`, `patch<T>(…)`, `del<T>(url, options?)`, each returning `Promise<ApiBody<T>>`. Body goes as the **second positional arg**, not `{ method, body }`.
>
> **Route wrappers** (`@/lib/api`): use `authenticatedRoute(async (request, context, { userId, isPro }) => …)` for anything touching user data — it runs the session + Pro check and injects an **IDOR-safe `userId`** (from the session, never the request). Use bare `apiRoute(...)` only for genuinely public routes (e.g. unauthenticated auth endpoints).

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
| `src/lib/api/api-fetch.ts` | HTTP client verb helpers (`get`/`post`/`put`/`patch`/`del`) — browser and Node.js safe |
| `src/lib/api/api-response.ts` | `ApiBody` type helpers — shared by FE and BE |
| `src/types/` | Type definitions only |
| `src/stores/` | Zustand stores — client state, no server imports |
| `src/hooks/` | React hooks — client-only by design |
| `src/components/` | React components — RSC or `'use client'` |

### Never import Node.js-only modules from client files

A `'use client'` file must never import from `src/lib/db/`, `src/lib/infra/`, `src/lib/auth/`, `src/lib/billing/`, `src/lib/storage/`, `src/lib/stripe/`, `src/lib/session.ts`, or `src/lib/api/index.ts`.

```typescript
// ✅ correct — client component mutates via an api-fetch verb helper → REST route
'use client'
import { post } from '@/lib/api/api-fetch'

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
  - `src/lib/api/index.ts` **[S]** — `apiRoute` route wrappers
  - `src/lib/api/api-response.ts` **[C]** — `ApiResponse` builders (shared by FE and BE)
  - `src/lib/api/api-fetch.ts` **[C]** — HTTP client verb helpers (`get`/`post`/`put`/`patch`/`del`)
  - `src/lib/editor/` **[C]** — editor themes and config
  - `src/lib/utils/` **[C]** — shared constants, formatters, validators (no DB/Stripe)
- Context definitions (`createContext`, hooks, reducers, types — no JSX): `src/context/[name]-context.tsx`
- Provider components (React components that render `<Context.Provider>`): `src/providers/[name]-provider.tsx`

## Data Fetching

- Server components fetch via `src/lib/db/` helpers (not `prisma.*` inline)
- Client components fetch and mutate via the `api-fetch` verb helpers → REST routes (not Server Actions — see [Where each mutation / fetch goes](#where-each-mutation--fetch-goes))
- Never use `fetch()` or `axios` directly — always use the `get`/`post`/`patch`/`del` helpers from `src/lib/api/api-fetch.ts` for HTTP requests from client code

## Validation

All external inputs (query params, JSON bodies, route params) must be validated with Zod before use. Define schemas inline in the route file; extract to `src/lib/utils/validators.ts` only when the same schema is reused by 2+ files (e.g. a route + a client hook).

Inside a route, validate with `parseOrFail` (from `@/lib/utils/validators`) — it returns the ready-made `ApiResponse.VALIDATION_ERROR` body on failure, so there's no manual `safeParse`/`flatten` plumbing:

```typescript
import { z } from 'zod'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail } from '@/lib/utils/validators'

const createItemSchema = z.object({
  title: z.string().min(1).max(255),
  type: z.enum(['snippet', 'prompt', 'command', 'note', 'link']),
  content: z.string().optional(),
})

// authenticatedRoute injects an IDOR-safe userId (from the session, never the body)
export const POST = authenticatedRoute(async (request, _context, { userId }) => {
  const parsed = parseOrFail(createItemSchema, await request.json())
  if (!parsed.success) return parsed.response

  // use parsed.data + userId from here on
  return ApiResponse.CREATED(await createItem(userId, parsed.data))
})
```
