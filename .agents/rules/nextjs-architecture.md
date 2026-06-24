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

### `?skeleton=true` on every screen (required)

Every page in the app **must** honor a `?skeleton=true` query param by rendering its loading skeleton instead of real content — a manual preview of the `loading.tsx` state (used to design/verify skeletons without throttling). This is a hard requirement for **all** routes, including dynamic ones (`/parse/[jobId]`, `/items/[type]`, `/collections/[id]`).

**Pattern** (matches `dashboard/page.tsx`):

```ts
export default async function FooPage(props: {
  searchParams: Promise<{ skeleton?: string }>   // (merge with the page's other params)
}) {
  const searchParams = await props.searchParams
  const forceSkeleton = searchParams.skeleton === 'true'
  // ...auth/redirect guards still run...
  if (forceSkeleton) return <FooSkeleton />        // the SAME skeleton loading.tsx renders
  // ...real data fetch + render...
}
```

Rules:
- The skeleton must be the **same** component the route's `loading.tsx` (or layout Suspense fallback) renders — never a second, divergent skeleton.
- `forceSkeleton` is evaluated **after** the auth/ownership guards (`redirect('/sign-in')`, Pro gate) but **before** any heavy data fetch, so the preview never depends on real data and never leaks a protected page to a signed-out user.
- A page that has no skeleton yet must get one (a reusable component, also wired into `loading.tsx`) — "no skeleton" is not an exemption.
- Dynamic-segment pages are included: resolve the param, run guards, then branch on `forceSkeleton` before the snapshot/db read.

### Where each mutation / fetch goes

| Situation                                                                                 | Use                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Data read in a Server Component                                                           | `src/lib/db/` helper (not `prisma.*` inline)                                                                            |
| Mutation or data fetch from a client component                                            | a **route handler** via `api` / `$api` (`@/lib/api/client`). **Never** a Server Action, **never** raw `fetch()`/`axios` |
| Webhook, third-party callback, redirect with a specific HTTP status                       | exempt explicit route (using the modern route wrappers) — see `api-contract.md`                                         |
| Redirect-terminating auth flow that can't be REST (OAuth sign-in, sign-out, account link) | Server Action — the **only** sanctioned use (returns `ActionState` or redirects directly)                               |

The typed route-handler client is the default for all client-driven mutations and reads (full contract in `api-contract.md`). New code must not add Server Actions for ordinary mutations. A new endpoint is a new `src/app/api/<domain>/.../route.ts` + a `paths.ts` declaration + schemas, then `npm run openapi:gen` — not a Server Action and not a hand-edited generated type.

> **Client API:** `@/lib/api/client` exports `api` (openapi-fetch — `await api.POST('/path', { body, params })` → `{ data, error, response }`, never throws) and `$api` (openapi-react-query hooks).
>
> **Exempt route wrappers** use the same modern wrappers (`authedRoute`, `authedRouteWithParams`, `publicRoute`) from `@/lib/api/route` and return standard JSON or redirect (`apiRedirect`).

## Server / Client Boundary

Next.js runs code in two runtimes: the Node.js server and the browser. Server Components and Server Actions are **frontend primitives** — they are part of the React component model and happen to run server-side. The boundary that matters here is the **browser bundle**: modules that use Node.js APIs or secret env vars must never end up in the client bundle.

### `'server-only'` guard

`server-only` is a bundler guard, not an architectural label. Add `import 'server-only'` as the **first line** of any module that uses Node.js APIs, secret env vars, or should never be shipped to the browser. This makes the Next.js bundler throw a build error if a client file accidentally imports it.

**It must be the `import` statement — not a bare string.** `server-only` is an installed npm package, not a compiler directive. Only `'use client'` / `'use server'` / `'use cache'` are recognised as bare-string directives; a bare `'server-only'` is just a discarded string expression that imports nothing and protects nothing. The guard fires only when the package is actually imported (its `"browser"` export throws at build time).

**Exception — build-time-reachable modules.** A module imported (transitively) by `next.config.ts` must **not** carry the guard, because the config loader evaluates the package's throwing browser export and `next build` fails before it starts. `src/env/validate-billing-env.ts` is exempt for this reason: it sits in the `next.config.ts` → `validate-billing-env.ts` chain. It holds no secrets (just `NODE_ENV` + `console.warn`), so leaving it unguarded is safe. Do not add `import 'server-only'` to it, and do not import the Pino `logger` into it — use `console.warn` directly. The logger itself (`src/lib/infra/pino.ts`) **is** `server-only`-guarded precisely because it is not in the build-time chain.

| Folder / File          | Why                                                                    |
| ---------------------- | ---------------------------------------------------------------------- |
| `src/lib/db/`          | Prisma queries + `'use cache'` — never safe in a browser bundle        |
| `src/lib/infra/`       | Redis, Prisma client, rate-limit, resend, cache, Stripe SDK adapter — Node.js / server env |
| `src/lib/auth/`        | bcrypt, crypto, DB user helpers — requires Node.js and secret env vars |
| `src/lib/billing/`     | Stripe webhooks, subscription logic — secret keys, Node.js only        |
| `src/lib/storage/`     | S3 file uploads — secret keys, Node.js only                            |
| `src/lib/ai/`          | OpenAI client + tag/description generation — secret key, Node.js only   |
| `src/lib/emails/`      | Resend transactional senders (link / credential / verify / reset)       |
| `src/lib/services/`    | App shell data fetchers (sidebar, action utils) — DB / session access  |
| `src/lib/session.ts`   | Session helpers — reads cookies / auth, Node.js only                   |
| `src/lib/api/index.ts` | Route wrappers — `NextRequest` / `NextResponse`, Node.js only          |

```typescript
// ✅ correct — first line of any server-only module
import 'server-only'

import { prisma } from '@/lib/infra/prisma'

// ❌ wrong — bare string is a no-op; the module ships to the client unprotected
'server-only'
```

### `'use server'` vs `import 'server-only'`

These solve **opposite problems** and are frequently confused:

|                      | `import 'server-only'`                             | `'use server'`                                               |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| **Purpose**          | Prevent module from reaching client bundle         | Expose server function as callable from client               |
| **Enforcement**      | Build error if a client file imports it            | Next.js creates a network RPC endpoint                       |
| **Functions inside** | Normal server functions — not callable from client | Server Actions — callable from client via POST               |
| **Use for**          | DB helpers, secret env vars, Prisma, Node.js APIs  | Redirect-terminating auth flows only (OAuth, sign-out, link) |

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

| Folder / File                 | Why safe                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `src/lib/utils/`              | Pure TypeScript — constants, formatters, validators, no secret env vars                    |
| `src/lib/dom/`                | Browser-effect helpers (View Transitions, DOM triggers) — client-only, no secrets          |
| `src/lib/api/schemas/**`      | Bare Zod request/response schemas — browser-safe (imported by `paths.ts` + route handlers) |
| `src/lib/api/openapi/**`      | `paths.ts` + `spec.ts` — pure schema declarations, no secrets                              |
| `src/lib/api/http.ts`         | `json` / `noContent` / `problem` / `parseOr422` — pure Response builders                   |
| `src/lib/api/client.ts`       | `api` + `$api` — browser route-handler client                                              |
| `src/lib/api/query-keys.ts`   | TanStack Query key registry — client-only key factory over `$api`; never imported server-side |
| `src/types/`                  | Type definitions only                                                                      |
| `src/stores/`                 | Zustand stores — client state, no server imports                                           |
| `src/hooks/`                  | React hooks — client-only by design; organized into `ai/`, `items/`, `billing/`, `profile/`, `editor/`, `ui/` |
| `src/components/`             | React components — RSC or `'use client'`                                                   |

### Never import Node.js-only modules from client files

A `'use client'` file must never import from `src/lib/db/`, `src/lib/infra/`, `src/lib/auth/`, `src/lib/billing/`, `src/lib/storage/`, `src/lib/services/`, `src/lib/session.ts`, or `src/lib/api/route.ts`.

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
  - `src/lib/infra/` **[S]** — logger, prisma client, redis, rate-limit, cache, resend, Stripe SDK adapter (`stripe.ts`)
  - `src/lib/auth/` **[S]** — auth service, tokens, pending OAuth link
  - `src/lib/billing/` **[S]** — Stripe billing, subscriptions, webhooks, checkout (domain logic; the raw SDK adapter lives in `infra/stripe.ts`)
  - `src/lib/storage/` **[S]** — file uploads (AWS S3)
  - `src/lib/ai/` **[S]** — OpenAI client + tag/description generation (secret key; pure response parsers are the shared exception)
  - `src/lib/emails/` **[S]** — transactional email senders + templates (Resend via `infra`); all outbound sends go through `sendEmail()` which no-ops when `DISABLE_EMAIL_VERIFICATION=true` (see `security.md`)
  - `src/lib/services/` **[S]** — app shell helpers (sidebar data, profile action utils)
  - `src/lib/session.ts` **[S]** — session + action auth helpers (root exception)
  - `src/lib/api/route.ts` **[S]** — `authedRoute` / `authedRouteWithParams` / `publicRoute` (route handlers and wrappers)
  - `src/lib/api/http.ts` **[C]** — `json` / `noContent` / `problem` / `parseOr422` Response builders
  - `src/lib/api/schemas/**` **[C]** — bare Zod request/response schemas (browser-safe)
  - `src/lib/api/openapi/**` **[C]** — `paths.ts` + `spec.ts` (OpenAPI doc source)
  - `src/lib/api/client.ts` **[C]** — `api` + `$api` (browser route-handler client)
  - `src/lib/api/query-keys.ts` **[C]** — central TanStack Query key registry (client-only; the FE mirror of the server `CacheTags` boundary — never cross-import)
  - `src/lib/dom/` **[C]** — browser-effect helpers, DOM utilities, Monaco theme — client-only, no secrets
  - `src/lib/storage-client/` **[C]** — client-side S3 upload helpers (`s3-upload-client.ts`, `upload-file-item-client.ts`) — browser XHR with progress tracking, no secret keys
  - `src/lib/utils/` **[C]** — shared constants, formatters, validators (no DB/Stripe)
- Hooks: `src/hooks/<domain>/use-name.ts` — domain folders: `ai/`, `items/`, `billing/`, `profile/`, `editor/`, `ui/`
- Zustand stores (client UI state): `src/stores/[name]-store.ts` — **never** `createContext`

## State Management

**Never use `createContext` / `React.createContext`.** All client state lives in Zustand stores under `src/stores/`; there is no `src/context/` directory. `src/providers/` holds **only** composition wrappers for third-party providers (`QueryClientProvider`, `next-themes`) and store-connected mount points (item drawer, upgrade prompt) — never an app-authored React Context.

| State type | Tool | Package |
|---|---|---|
| Pure UI state (modals, drawers, selections, non-server flags) | Zustand store in `src/stores/` | `zustand` |
| Server / async data (items, collections, user profile, editor prefs, pages) | `$api` hooks; or `useQuery` / `useInfiniteQuery` for non-API data | `@tanstack/react-query` |
| Long lists / grids | `TanStackVirtualGrid` (`src/components/items/tanstack-virtual-grid.tsx`) | `@tanstack/react-virtual` |

**Zustand is for pure UI state only** — it must never hold server-derived data (user profile fields, feature flags, editor preferences, billing state). Server-derived state belongs in TanStack Query, seeded from SSR via a hydrator hook that calls `setQueryData` in a `useLayoutEffect`. New Zustand stores must not replicate DB-persisted values.

```typescript
// ✅ correct
import { useItemStore } from '@/stores/item-store'
const { selectedId, setSelectedId } = useItemStore()

// ❌ wrong — never create context
const ItemContext = createContext<ItemContextValue | null>(null)
export function ItemProvider({ children }: { children: ReactNode }) {
  return <ItemContext.Provider value={...}>{children}</ItemContext.Provider>
}
```

### Prefer self-sufficient TanStack components over prop-drilling server state

A reusable client component that needs shared, cacheable server state (collections, the user profile, item types — anything backed by a `$api` query) should **read it from its own TanStack hook**, not receive it through a prop drilled down from an ancestor. Reach for a prop only as an **override** for a curated subset or an SSR-seed.

**Why this is safe — and better:**
- **One request, not N.** TanStack dedupes by query key: every component calling the same hook shares one underlying `Query` and one in-flight fetch. Ten self-sourcing dropdowns cause one request, not ten.
- **No fetch on mount/open.** These caches are SSR-seeded app-wide (app chrome) with a long `staleTime`, so the component reads cache instantly. It only fetches if nothing seeded it — an acceptable lazy fallback.
- **Never stale.** It reflects create/rename/delete from anywhere, with no prop to thread or keep in sync.

**Reference — `CollectionSelector`** (`src/components/shared/collection-selector.tsx`): `collections` is an optional override; omit it and the component self-sources via `useCollections()`. It also owns its own create flow end-to-end (the create dialog + auto-select), so every call site is just `<CollectionSelector creatable selectedIds={…} onChange={…} />` — zero per-call wiring.

```tsx
// ✅ correct — self-sources from the shared, deduped, SSR-seeded cache
function CollectionSelector({ collections: override, selectedIds, onChange }: Props) {
  const self = useCollections({ enabled: override === undefined }) // disabled when an override is given
  const collections = override ?? self.collections
  // …
}

// ❌ wrong — every ancestor must fetch and drill the same list down
<CollectionSelector collections={collections} … />   // collections threaded through 3 layers
```

**Rules:**
- Self-source shared server state by default; expose an optional list prop only for curated/SSR-seed cases (disable the internal query with `enabled` when the override is present, so it never idles a fetch).
- **Do not gate the query on transient UI** (e.g. `enabled: open`) when the component renders cached data while "closed" — a multiselect shows its selected chips' names before it is ever opened, so it needs the data unconditionally. Lazy-on-open is fine only when nothing is shown until open.
- Cache **writes** still follow the updater rule in `coding-standards.md`: `setQueryData`/`invalidateQueries` live in the owning hook, never in the component.

### Virtualization (`@tanstack/react-virtual`)

Use the existing `TanStackVirtualGrid` for any long item list or grid — do not build a new virtualized component from scratch.

If a component must call `useVirtualizer` directly, it **must** add `'use no memo'` as the second directive (after `'use client'`). `useVirtualizer` returns unstable refs that the React Compiler must not memoize, and `// eslint-disable-next-line react-hooks/incompatible-library` is required on the call itself.

```typescript
'use client'
'use no memo'

import { useVirtualizer } from '@tanstack/react-virtual'

// eslint-disable-next-line react-hooks/incompatible-library
const virtualizer = useVirtualizer({ count, getScrollElement, estimateSize })
```

## Data Fetching

- Server components fetch via `src/lib/db/` helpers (not `prisma.*` inline)
- Client components fetch and mutate via the route-handler client (`api` / `$api` from `@/lib/api/client`) — not Server Actions (see [Where each mutation / fetch goes](#where-each-mutation--fetch-goes))
- Never use `fetch()` or `axios` directly for our API — call `api` / `$api`. (Direct-to-S3 uploads with progress are the one exception: `uploadToS3` in `src/lib/storage-client/s3-upload-client.ts`.)

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

**Server Actions** use `parseOrFail` (from `@/lib/utils/validators`), which returns a failed `ActionState` on failure.
