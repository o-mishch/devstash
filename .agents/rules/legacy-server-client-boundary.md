---
trigger: glob
globs:
  - src/**/*.ts
  - src/**/*.tsx
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
description: The Next.js server/client bundle boundary for DevStash (legacy, maintenance-only) — the `import 'server-only'` guard, `'use server'` vs `'server-only'`, which shared modules stay unmarked, and the ban on importing Node.js-only modules from client files. Loads for files under src/. Split out of legacy-nextjs-architecture.md to stay under Antigravity's 12k per-file cap.
---

# Next.js Server / Client Boundary (legacy)

> `src/` is maintenance-only — see `boundary.md`. Routing, skeletons, and file organization live in `legacy-nextjs-architecture.md`; state and data fetching in `legacy-state-management.md`.


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
| `src/lib/api/route.ts` | Route wrappers — `NextRequest` / `NextResponse`, Node.js only          |

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

